/**
 * 마지막으로 성공한 업스트림 응답을 들고 있다가, 업스트림이 죽었을 때 대신 내주는 계층.
 *
 * 왜 필요한가: openapi.seoul.go.kr:8088 은 몇 분~수십 분 단위로 반복해서 죽는다.
 * 죽는 방식이 고약해서(TCP 는 30ms 만에 받아주고 첫 바이트를 영원히 안 보낸다)
 * 재시도나 타임아웃 조정으로는 못 건진다. 그럴 때마다 화면이 통째로 비는데,
 * 5분 전 데이터라도 보여주는 게 아무것도 안 보여주는 것보다 낫다.
 *
 * 왜 Next Data Cache 로 안 하는가: Data Cache 는 만료된 항목을 꺼내 쓸 수단을 주지 않는다.
 * revalidate 가 지나면 그냥 미스이고, 그 뒤 fetch 가 실패하면 예전 값에 손댈 방법이 없다.
 *
 * 왜 모듈 스코프 메모리인가: 의존성이 0 이고 새 유료 서비스가 붙지 않는다.
 * 자매 앱(ipyang `lib/animal-cache.ts`, gofish `lib/fishing-cache.ts`)도 같은 방식이다.
 *
 * 한계 — 이걸 알고 쓴다:
 *  - Vercel 함수 인스턴스마다 따로다. 인스턴스 A 가 받아 둔 값을 B 는 모른다.
 *  - 콜드 스타트면 비어 있다. 배포 직후나 트래픽이 없다 살아난 첫 요청은 fallback 이 없다.
 *  - 즉 "있으면 좋고 없으면 지금처럼 실패"인 최선노력 계층이다. 보장이 아니다.
 *  - 인스턴스 간 공유가 필요하면 외부 스토어(Blob/KV)로 옮겨야 하는데,
 *    그건 유료 서비스 추가라 사용자 승인 없이 하지 않는다.
 */

/**
 * stale 을 서빙할 수 있는 최대 나이(ms).
 *
 * 왜 30분인가: 이 앱의 알맹이는 **실시간 인구**다. 30분 전 혼잡도와 6시간 전 혼잡도는
 * 의미가 완전히 다르다 — 후자는 아예 다른 시간대의 이야기라 쓸모가 없다.
 *  - 업스트림 갱신 주기가 약 5분이므로 30분은 최대 6세대 묵은 값이다.
 *  - 서울시 혼잡도 등급은 보통 수십 분 단위로 움직인다. 30분이면 방향(붐빔/여유)은
 *    대체로 유지되면서, 출퇴근 전환(18:00 vs 18:40)처럼 등급이 뒤집히는 구간은 넘지 않는다.
 *  - 실측된 장애 구간이 몇 분~수십 분이었다. 30분이면 그 대부분을 덮는다.
 * 이 시간을 넘으면 stale 을 버리고 지금처럼 실패를 표시한다.
 * 오래된 걸 신선한 척 보여주느니 실패를 보여주는 게 낫다.
 */
export const STALE_MAX_AGE_MS = Number(process.env.SEOUL_STALE_MAX_AGE_MS) || 30 * 60 * 1000;

export interface StaleHit<T> {
  value: T;
  /** 이 값을 업스트림에서 실제로 받아온 시각(ms epoch). */
  at: number;
}

/**
 * 키별로 마지막 성공값 하나씩을 보관하는 LRU.
 *
 * 상한을 두는 이유: citydata 는 장소당 170KB 라 121곳을 다 들고 있으면 20MB 를 넘긴다.
 * 함수 메모리를 그런 식으로 태울 이유가 없다 — 사용자가 실제로 눌러 본 장소만 있으면 된다.
 */
export class StaleStore<T> {
  private readonly entries = new Map<string, StaleHit<T>>();

  constructor(private readonly limit: number) {}

  /** 성공한 값을 보관한다. 같은 키는 항상 최신으로 덮는다. */
  remember(key: string, value: T, at = Date.now()): void {
    // 재삽입으로 LRU 순서를 갱신한다(Map 은 삽입 순서를 유지한다).
    this.entries.delete(key);
    this.entries.set(key, { value, at });

    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** 아직 서빙해도 되는 값이면 돌려주고, 없거나 너무 오래됐으면 null. */
  recall(key: string, maxAgeMs = STALE_MAX_AGE_MS): StaleHit<T> | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > maxAgeMs) {
      // 만료된 건 들고 있어 봐야 메모리만 먹는다.
      this.entries.delete(key);
      return null;
    }
    return hit;
  }

  /** 테스트/진단용. 지금 몇 건을 들고 있는지. */
  get size(): number {
    return this.entries.size;
  }
}
