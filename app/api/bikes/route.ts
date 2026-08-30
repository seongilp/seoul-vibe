import { NextResponse } from 'next/server';

import { fetchBikeStations, isDemoMode, SeoulApiFailure } from '@/lib/seoul';
import type { BikeResponse, BikeStation } from '@/lib/types';

export const maxDuration = 30;
// 빌드 타임에 서울 API 를 부르지 않도록 정적 프리렌더를 막는다.
// 캐싱은 fetchBikeStations 내부 fetch 의 revalidate(60초)가 담당한다.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<BikeResponse | { error: string; message: string }>> {
  try {
    const rows = await fetchBikeStations();

    const stations: BikeStation[] = rows.flatMap((row) => {
      const lon = Number(row.stationLongitude);
      const lat = Number(row.stationLatitude);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
      return [
        {
          id: row.stationId,
          // 대여소명이 '458. 광화문역 5번출구' 형태라 앞 번호를 떼어낸다.
          name: row.stationName.replace(/^\d+\.\s*/, ''),
          lon,
          lat,
          racks: Number(row.rackTotCnt) || 0,
          parked: Number(row.parkingBikeTotCnt) || 0,
        },
      ];
    });

    return NextResponse.json(
      {
        demo: isDemoMode(),
        updatedAt: new Date().toISOString(),
        stations,
      },
      {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
      },
    );
  } catch (error) {
    if (error instanceof SeoulApiFailure) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}
