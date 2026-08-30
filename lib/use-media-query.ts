'use client';

import { useSyncExternalStore } from 'react';

/** Tailwind 의 md 브레이크포인트(768px) 미만을 모바일로 본다. */
const MOBILE_QUERY = '(max-width: 767.98px)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * 모바일 여부.
 *
 * CSS 로 숨기는(md:hidden) 대신 렌더 자체를 갈라야 하는 이유가 있다. 시트와
 * 사이드 패널 양쪽에 AreaDetail 을 두고 한쪽만 숨기면 두 번 마운트되어
 * /api/area/{cd} 를 장소당 두 번 부른다. 서울 열린데이터광장 키는 일일 상한이
 * 있어서 이런 중복이 그대로 할당량 손실이 된다.
 *
 * effect + setState 대신 useSyncExternalStore 를 쓴다. 연쇄 렌더가 없고
 * 서버 스냅샷을 따로 줄 수 있어 하이드레이션 불일치도 안 난다.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    // 서버에는 뷰포트가 없다. 데스크톱으로 그려 두고 하이드레이션 후 정정한다.
    () => false,
  );
}
