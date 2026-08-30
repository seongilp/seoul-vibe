import { waitUntil } from '@vercel/functions';

/**
 * 백그라운드 작업(Neon 쓰기 등)을 사용자 응답을 막지 않으면서 끝까지 살려 둔다.
 *
 * 왜 필요한가: Vercel 서버리스는 응답을 보낸 직후 인스턴스를 얼리거나 종료할 수 있다.
 * 그러면 `void promise` 로 던져 둔 쓰기가 완료되지 못하고 유실된다(실측: 응답 직후
 * 프로세스가 죽으면 Neon 에 아무것도 안 남았다). waitUntil 로 등록하면 플랫폼이 그 작업이
 * 끝날 때까지 인스턴스를 유지한다 — 응답은 이미 나갔으므로 사용자는 기다리지 않는다.
 *
 * 왜 try/catch 인가: waitUntil 은 요청 컨텍스트 밖(로컬 스크립트·테스트)에서 부르면 던진다.
 * 그럴 땐 조용히 무시한다 — 그 환경에서는 프로세스가 살아 있어 프로미스가 알아서 끝난다.
 */
export function keepAlive(promise: Promise<unknown>): void {
  try {
    waitUntil(promise);
  } catch {
    // 요청 컨텍스트 밖: 프로미스는 계속 돌게 두되 rejection 만 삼킨다.
    void promise.catch(() => {});
  }
}
