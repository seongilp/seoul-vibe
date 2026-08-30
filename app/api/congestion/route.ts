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

  const settled = await mapWithConcurrency(targets, CONCURRENCY, (area) => fetchPpltn(area.nm));

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
        'Cache-Control': `public, s-maxage=${UPSTREAM_REFRESH_SECONDS}, stale-while-revalidate=${UPSTREAM_REFRESH_SECONDS * 4}`,
      },
    },
  );
}
