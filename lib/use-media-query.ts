'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tailwind 의 lg 브레이크포인트(1024px) 미만을 '좁은 화면'으로 본다.
 *
 * 예전엔 md(768px) 기준이었는데, 좌측 목록이 `lg:block` 이라 768~1023px 구간에는
 * 바텀시트도 사이드바도 없어 121곳 목록에 닿을 방법이 아예 없었다. 지도 폴리곤
 * 클릭이 유일한 경로였고 작은 폴리곤은 사실상 못 누른다.
 * 목록의 lg 에 맞춰 시트 쪽을 넓히면 사각지대가 사라지고, 태블릿 폭에서 목록
 * 288px + 상세 384px 를 동시에 밀어 넣어 지도를 100px 로 찌그러뜨리는 일도 없다.
 */
const COMPACT_QUERY = '(max-width: 1023.98px)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(COMPACT_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * 좁은 화면(<1024px) 여부. 목록·상세를 바텀시트로 묶어 지도를 살리는 구간이다.
 *
 * CSS 로 숨기는(lg:hidden) 대신 렌더 자체를 갈라야 하는 이유가 있다. 시트와
 * 사이드 패널 양쪽에 AreaDetail 을 두고 한쪽만 숨기면 두 번 마운트되어
 * /api/area/{cd} 를 장소당 두 번 부른다. 서울 열린데이터광장 키는 일일 상한이
 * 있어서 이런 중복이 그대로 할당량 손실이 된다.
 *
 * effect + setState 대신 useSyncExternalStore 를 쓴다. 연쇄 렌더가 없고
 * 서버 스냅샷을 따로 줄 수 있어 하이드레이션 불일치도 안 난다.
 */
export function useIsCompact(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT_QUERY).matches,
    // 서버에는 뷰포트가 없다. 데스크톱으로 그려 두고 하이드레이션 후 정정한다.
    () => false,
  );
}
