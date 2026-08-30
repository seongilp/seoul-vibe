/**
 * 동시 실행 수를 제한한 map. 서울 API 에 121개 요청을 한꺼번에 던지지 않기 위한 것.
 * 개별 실패는 삼키지 않고 결과 배열에 그대로 담아 호출자가 판단하게 한다.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results = new Array<{ ok: true; value: R } | { ok: false; error: unknown }>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
  return results;
}
