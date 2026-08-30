import { NextResponse } from 'next/server';

import { AREA_BY_CD } from '@/lib/areas';
import { fetchCityData, isDemoMode, SAMPLE_AREA_NM, SeoulApiFailure, TIMEOUT_CODE } from '@/lib/seoul';

export const maxDuration = 30;
export const revalidate = 300;

/**
 * 실패 응답은 절대 캐시되면 안 된다. 업스트림이 잠깐 흔들린 걸 CDN 이 붙잡고 있으면
 * 서버가 돌아온 뒤에도 사용자는 계속 오류를 본다. 성공 응답의 캐시는 건드리지 않는다.
 */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function failure(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: code, message }, { status, headers: NO_STORE });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cd: string }> },
): Promise<NextResponse> {
  const { cd } = await params;
  const area = AREA_BY_CD.get(cd);

  if (!area) {
    return failure('unknown_area', `알 수 없는 장소 코드: ${cd}`, 404);
  }

  const demo = isDemoMode();
  // 데모 모드에서 다른 장소를 요청하면 서울시가 광화문 데이터를 돌려준다.
  // 조용히 엉뚱한 지역 데이터를 보여주느니 명시적으로 거절한다.
  if (demo && area.nm !== SAMPLE_AREA_NM) {
    return failure(
      'demo_area_unavailable',
      `샘플키로는 '${SAMPLE_AREA_NM}'만 조회할 수 있습니다. SEOUL_API_KEY 를 설정하세요.`,
      409,
    );
  }

  try {
    const data = await fetchCityData(area.nm);
    if (!data) {
      return failure('no_data', `'${area.nm}' 상세 데이터가 비어 있습니다.`, 404);
    }
    return NextResponse.json({ demo, area, data });
  } catch (error) {
    if (error instanceof SeoulApiFailure) {
      // 타임아웃은 우리 잘못도, 사용자가 고칠 수 있는 것도 아니다. 원인을 그대로 말한다.
      const message =
        error.code === TIMEOUT_CODE
          ? '서울시 실시간 도시데이터 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.'
          : error.message;
      return failure(error.code, message, error.status);
    }
    throw error;
  }
}
