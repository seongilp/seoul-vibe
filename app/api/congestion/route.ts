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

  const areas: AreaCongestion[] = AREAS.map((area) => {
    const raw = resolvedByCd.get(area.cd);
    return {
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
  const complete = resolvedByCd.size === targets.length;
  const cacheControl = complete
    ? `public, s-maxage=${UPSTREAM_REFRESH_SECONDS}, stale-while-revalidate=${UPSTREAM_REFRESH_SECONDS * 4}`
    : `public, s-maxage=${PARTIAL_CACHE_SECONDS}`;

  return NextResponse.json(
    {
      demo,
      updatedAt: new Date().toISOString(),
      resolved: resolvedByCd.size,
      total: AREAS.length,
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
