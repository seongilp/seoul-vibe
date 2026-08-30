import { NextResponse } from 'next/server';

import { AREA_BY_CD } from '@/lib/areas';
import { fetchCityData, isDemoMode, SAMPLE_AREA_NM, SeoulApiFailure } from '@/lib/seoul';

export const maxDuration = 30;
export const revalidate = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cd: string }> },
): Promise<NextResponse> {
  const { cd } = await params;
  const area = AREA_BY_CD.get(cd);

  if (!area) {
    return NextResponse.json({ error: `알 수 없는 장소 코드: ${cd}` }, { status: 404 });
  }

  const demo = isDemoMode();
  // 데모 모드에서 다른 장소를 요청하면 서울시가 광화문 데이터를 돌려준다.
  // 조용히 엉뚱한 지역 데이터를 보여주느니 명시적으로 거절한다.
  if (demo && area.nm !== SAMPLE_AREA_NM) {
    return NextResponse.json(
      {
        error: 'demo_area_unavailable',
        message: `샘플키로는 '${SAMPLE_AREA_NM}'만 조회할 수 있습니다. SEOUL_API_KEY 를 설정하세요.`,
      },
      { status: 409 },
    );
  }

  try {
    const data = await fetchCityData(area.nm);
    if (!data) {
      return NextResponse.json({ error: '데이터 없음' }, { status: 404 });
    }
    return NextResponse.json({ demo, area, data });
  } catch (error) {
    if (error instanceof SeoulApiFailure) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}
