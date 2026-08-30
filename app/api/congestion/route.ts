import { NextResponse } from 'next/server';

import { AREAS } from '@/lib/areas';
import { mapWithConcurrency } from '@/lib/concurrent';
import {
  congestionRank,
  fetchPpltn,
  isDemoMode,
  SAMPLE_AREA_NM,
  UPSTREAM_REFRESH_SECONDS,
  type RawPpltn,
} from '@/lib/seoul';
import { maybeCleanupStale, recallPpltnBatch, rememberPpltnBatch } from '@/lib/seoul-stale';
import type { AreaCongestion, CongestionResponse, ForecastPoint } from '@/lib/types';

/** 121개 장소를 순회하므로 기본 타임아웃보다 넉넉히 잡는다. */
export const maxDuration = 60;
/**
 * 라우트 자체는 항상 실행한다. 정적 프리렌더되면 빌드 타임에 서울 API 를 121번
 * 호출하게 되고, 사용자의 새로고침도 CDN 캐시에 막혀 무의미해진다.
 * 캐싱은 업스트림 fetch 의 revalidate(UPSTREAM_REFRESH_SECONDS, 기본 900초)가 담당한다.
 */
export const dynamic = 'force-dynamic';

/** 서울 API 에 동시에 던지는 요청 수. 너무 올리면 상대 쪽에서 끊는다. */
const CONCURRENCY = 8;

/**
 * 121곳 전체에 주는 총 예산(ms).
 *
 * 왜 필요한가: 요청당 타임아웃(6초)만 있으면 업스트림이 통째로 먹통일 때
 * 121건 ÷ 동시 8건 = 16웨이브 × 6초 ≈ 96초가 걸려서 maxDuration(60초)을 넘고
 * 목록까지 504 로 죽는다. 그러면 지도에 아무것도 안 뜬다.
 * 마감시한을 하나 공유시키면 20초가 지난 순간 남은 요청이 즉시 실패하고,
 * 그때까지 받은 곳만이라도 그려진다. 못 받은 곳은 level=null 이라 목록에서
 * '정보 없음'으로 표시된다 — 결측을 결측으로 남긴다.
 *
 * 왜 20초인가: 캐시가 전부 빈 상태에서도 정상 업스트림이면 16웨이브 × 0.3초 ≈ 5초면
 * 끝난다. 20초는 그 4배 여유이면서 maxDuration 60초의 3분의 1이다.
 */
const BATCH_BUDGET_MS = Number(process.env.SEOUL_LIST_BUDGET_MS) || 20_000;

/** 일부만 받아온 응답의 캐시 수명(초). 정상 응답보다 훨씬 짧게 가져간다. */
const PARTIAL_CACHE_SECONDS = 30;

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toForecast(raw: RawPpltn): ForecastPoint[] {
  return (raw.FCST_PPLTN ?? []).map((point) => ({
    time: point.FCST_TIME,
    level: point.FCST_CONGEST_LVL,
    min: toNumber(point.FCST_PPLTN_MIN) ?? 0,
    max: toNumber(point.FCST_PPLTN_MAX) ?? 0,
  }));
}

export async function GET(): Promise<NextResponse<CongestionResponse>> {
  const demo = isDemoMode();
  // 샘플키는 어떤 장소를 넣어도 광화문·덕수궁만 돌려준다. 121번 호출할 이유가 없다.
  const targets = demo ? AREAS.filter((area) => area.nm === SAMPLE_AREA_NM) : AREAS;

  // 마감시한 하나를 모든 요청이 공유한다. 예산이 끝나면 남은 요청은 기다리지 않고 실패한다.
  const budget = AbortSignal.timeout(BATCH_BUDGET_MS);
  const settled = await mapWithConcurrency(targets, CONCURRENCY, (area) =>
    fetchPpltn(area.nm, { signal: budget }),
  );

  const resolvedByCd = new Map<string, RawPpltn>();
  settled.forEach((result) => {
    if (result.ok && result.value) resolvedByCd.set(result.value.AREA_CD, result.value);
  });

  // 이번에 받아온 것만 보관한다(메모리 L1 + Neon L2, DB 쓰기는 fire-and-forget).
  // 실패한 장소는 예전 값을 그대로 두고 나이만 먹게 둔다.
  rememberPpltnBatch([...resolvedByCd].map(([cd, value]) => ({ cd, value })));
  // 만료 행 정리는 가끔만(저확률) 친다. 매 요청 DELETE 는 낭비다.
  maybeCleanupStale();

  /*
    부분 stale: 121곳 중 일부만 실패하는 게 흔하다(동시 8건이라 웨이브마다 결과가 갈린다).
    실패한 장소만 골라서 마지막 성공값으로 메운다. 성공한 장소는 손대지 않는다.
    폴백은 메모리 → Neon 순으로 찾는다 — 콜드 인스턴스도 다른 인스턴스가 받아 둔 걸 살린다.
    메울 수 없으면(이력 없음 / 나이 초과) 지금까지처럼 level=null 로 남긴다 — 결측은 결측으로.
  */
  const missingCds = AREAS.filter((area) => !resolvedByCd.has(area.cd)).map((area) => area.cd);
  const fallbacks = await recallPpltnBatch(missingCds);
  let staleCount = 0;

  const areas: AreaCongestion[] = AREAS.map((area) => {
    const fresh = resolvedByCd.get(area.cd);
    const fallback = fresh ? null : fallbacks.get(area.cd) ?? null;
    if (fallback) staleCount += 1;
    const raw = fresh ?? fallback?.value;
    return {
      stale: Boolean(fallback),
      staleAt: fallback ? new Date(fallback.at).toISOString() : null,
      cd: area.cd,
      nm: area.nm,
      cat: area.cat,
      lon: area.lon,
      lat: area.lat,
      level: raw?.AREA_CONGEST_LVL ?? null,
      rank: congestionRank(raw?.AREA_CONGEST_LVL),
      msg: raw?.AREA_CONGEST_MSG ?? null,
      min: toNumber(raw?.AREA_PPLTN_MIN),
      max: toNumber(raw?.AREA_PPLTN_MAX),
      observedAt: raw?.PPLTN_TIME ?? null,
      forecast: raw ? toForecast(raw) : [],
    };
  });

  /*
    일부만 받아온 응답을 15분짜리 캐시에 넣으면, 업스트림이 1분 뒤 살아나도 사용자는
    15분 내내 반쯤 빈 지도를 본다. 결손이 있으면 캐시 수명을 30초로 줄여 빨리 회복시킨다.
    전부 받아온 정상 응답의 캐시 동작은 그대로다.
  */

  /*
    stale 로 메운 응답도 같은 이유로 짧게 캐시한다. 오히려 더 급하다 — 과거 데이터를
    15분 붙잡고 있으면 업스트림이 1분 뒤 살아나도 사용자는 계속 옛날 값을 본다.
    (staleCount>0 이면 resolved < targets 이므로 complete 는 이미 false 다. 명시만 해 둔다.)
  */
  /*
    브라우저에는 max-age=0 을 명시한다.

    왜: Vercel 엣지는 s-maxage / stale-while-revalidate 를 자기가 소비하고 클라이언트
    응답에서는 지워 버린다. 그래서 브라우저가 실제로 받는 헤더는 'public' 한 줄뿐이고,
    max-age 가 없으면 신선도가 정의되지 않아 크로미움이 휴리스틱 캐시로 재사용한다.
    실측에서 그 일이 났다 — 업스트림이 죽어 stale 로 바뀐 뒤에도 브라우저가 이전
    응답(41KB)을 1ms 만에 되돌려줘서 '과거값' 배너가 뜨지 않았다.
    max-age=0, must-revalidate 면 매번 되물어보되 그 요청은 CDN 캐시에서 끝나므로
    함수 호출은 늘지 않는다. s-maxage 는 그대로라 CDN 동작은 바뀌지 않는다.
  */
  const complete = resolvedByCd.size === targets.length && staleCount === 0;
  const clientFreshness = 'public, max-age=0, must-revalidate';
  const cacheControl = complete
    ? `${clientFreshness}, s-maxage=${UPSTREAM_REFRESH_SECONDS}, stale-while-revalidate=${UPSTREAM_REFRESH_SECONDS * 4}`
    : `${clientFreshness}, s-maxage=${PARTIAL_CACHE_SECONDS}`;

  return NextResponse.json(
    {
      demo,
      updatedAt: new Date().toISOString(),
      resolved: resolvedByCd.size,
      total: AREAS.length,
      stale: staleCount,
      areas,
    },
    {
      headers: {
        // CDN 이 같은 응답을 재사용하게 해서 함수 호출 자체를 줄인다.
        // Data Cache 가 업스트림을 막아주고, 이건 그 앞단에서 함수 실행을 막는다.
        'Cache-Control': cacheControl,
      },
    },
  );
}
