import { neon } from '@neondatabase/serverless';

/**
 * stale 폴백의 2차 계층(L2): Neon Postgres 에 마지막 성공 스냅샷을 보관한다.
 *
 * 왜 필요한가: 1차인 메모리(StaleStore)는 함수 인스턴스마다 따로이고 콜드면 비어 있다.
 * 그래서 트래픽이 없다 살아난 첫 요청이나 배포 직후에는 fallback 이 없어, 업스트림이
 * 죽어 있으면 화면이 통째로 빈다. 인스턴스 밖 공용 저장소가 있으면 어느 인스턴스가
 * 받아 둔 스냅샷을 다른 인스턴스가, 심지어 콜드 스타트에서도 꺼내 쓸 수 있다.
 *
 * 설계 원칙 — DB 장애가 앱 장애가 되면 안 된다:
 *  - 모든 읽기는 실패하면 null 을 돌려준다(예외를 밖으로 던지지 않는다). 그러면 호출부는
 *    'L2 없음'으로 보고 지금까지처럼 동작한다.
 *  - 모든 쓰기는 fire-and-forget 다. 사용자 응답은 쓰기를 기다리지 않고, 쓰기가 실패해도
 *    응답에는 영향이 없다.
 *  - 읽기에는 마감시한을 건다. DB 가 느리게 매달리면 이미 실패 중인 폴백 경로가 더
 *    느려질 뿐이라, 짧게 끊고 정직한 실패로 넘어가는 게 낫다.
 */

export type SnapshotKind = 'ppltn' | 'citydata';

export interface DbSnapshot<T> {
  value: T;
  /** 이 값을 업스트림에서 실제로 받아온 시각(ms epoch). */
  at: number;
}

/** DB 읽기 마감시한(ms). 폴백 경로는 이미 사용자를 기다리게 하고 있으므로 짧게 끊는다. */
const READ_TIMEOUT_MS = Number(process.env.SEOUL_DB_READ_TIMEOUT_MS) || 2500;

/**
 * 지연 초기화. 모듈 최상위에서 neon(process.env.DATABASE_URL!) 을 부르면 env 가 없는
 * 빌드 타임에 next build 가 깨진다. 첫 사용 시점에만 만든다. Proxy 로 감싸지 않는다
 * — 드라이버가 내부에서 객체를 검사할 때 Proxy 가 그 검사를 깨뜨린다.
 */
let _sql: ReturnType<typeof neon> | null = null;
function getSql(): ReturnType<typeof neon> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null; // env 가 없으면 L2 자체를 비활성(메모리만으로 동작).
  if (!_sql) {
    // 왜 try/catch 인가: neon() 은 URL 이 형식에 안 맞으면 이 자리에서 즉시 throw 한다
    // (실측: "garbage"·"http://x" 는 생성 시점에 예외). 이 throw 가 밖으로 새면,
    // 업스트림까지 죽어 recall 이 호출되는 경로(상세 라우트의 catch 블록)에서 500 이 난다.
    // 'DB 장애가 앱 장애가 되면 안 된다'는 원칙대로, 여기서 삼키고 L2 를 비활성한다.
    try {
      _sql = neon(url);
    } catch {
      return null;
    }
  }
  return _sql;
}

/**
 * 스키마 보장(DDL). 런타임 경로에서 매 요청마다 DDL 을 치지 않도록 인스턴스당 한 번만
 * 실행하고 그 프로미스를 캐시한다. 실패하면(DB 콜드/장애) 캐시를 비워, 다음 요청이 다시
 * 시도하게 둔다 — 그 사이 읽기/쓰기는 어차피 null/드롭으로 안전하게 처리된다.
 *
 * 스키마가 단순해서 마이그레이션 도구는 도입하지 않는다. 키(kind+장소코드)로 UPSERT 하므로
 * 행 수가 장소 수 × 종류(약 121×2=242)를 절대 넘지 않는다 — 무한 증식이 구조적으로 불가능하다.
 */
let _schemaReady: Promise<boolean> | null = null;
function ensureSchema(sql: ReturnType<typeof neon>): Promise<boolean> {
  if (!_schemaReady) {
    _schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS stale_snapshots (
          kind TEXT NOT NULL,
          area_cd TEXT NOT NULL,
          collected_at TIMESTAMPTZ NOT NULL,
          payload JSONB NOT NULL,
          PRIMARY KEY (kind, area_cd)
        )
      `;
      return true;
    })().catch((error) => {
      // 다음 호출이 다시 시도하도록 캐시를 비운다.
      _schemaReady = null;
      throw error;
    });
  }
  return _schemaReady;
}

/** 프로미스에 마감시한을 씌운다. 시간 내 안 끝나면 fallback 값으로 resolve 한다(reject 아님). */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * 여러 스냅샷을 한 번의 UPSERT 로 저장한다(fire-and-forget).
 *
 * 왜 배치인가: 목록은 121곳을 한 번에 갱신한다. 121번 왕복하면 느리고 Neon 컴퓨트도
 * 낭비한다. 다중 VALUES 한 방으로 끝낸다. 배열 리터럴 대신 파라미터 플레이스홀더를 쓰는
 * 이유는 페이로드에 한글·따옴표·중괄호가 섞여 있어 배열 리터럴 이스케이프가 취약하기 때문이다.
 */
export async function persistSnapshots(
  kind: SnapshotKind,
  rows: { cd: string; at: number; payload: unknown }[],
): Promise<void> {
  if (rows.length === 0) return;
  const sql = getSql();
  if (!sql) return;
  try {
    await ensureSchema(sql);
    // ($1,$2,$3,$4),($5,$6,$7,$8)... 형태로 4열씩 묶는다.
    const values: unknown[] = [];
    const tuples = rows.map((row, i) => {
      const b = i * 4;
      values.push(kind, row.cd, new Date(row.at).toISOString(), JSON.stringify(row.payload));
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb)`;
    });
    const text =
      `INSERT INTO stale_snapshots (kind, area_cd, collected_at, payload) VALUES ` +
      tuples.join(', ') +
      ` ON CONFLICT (kind, area_cd) DO UPDATE SET collected_at = EXCLUDED.collected_at, payload = EXCLUDED.payload`;
    await sql.query(text, values);
  } catch {
    // 쓰기 실패는 조용히 삼킨다. 사용자 응답은 이미 나갔고, 다음 성공 때 다시 저장된다.
  }
}

/** 스냅샷 하나를 저장한다(상세용). fire-and-forget. */
export async function persistSnapshot(
  kind: SnapshotKind,
  cd: string,
  at: number,
  payload: unknown,
): Promise<void> {
  return persistSnapshots(kind, [{ cd, at, payload }]);
}

/**
 * 여러 키의 스냅샷을 읽는다. maxAgeMs 를 넘은 행은 제외한다. DB 장애/지연이면 빈 Map.
 * 오래된 걸 신선한 척 내주지 않도록 나이 필터는 SQL 에서 건다.
 */
export async function loadSnapshots<T>(
  kind: SnapshotKind,
  cds: string[],
  maxAgeMs: number,
): Promise<Map<string, DbSnapshot<T>>> {
  const out = new Map<string, DbSnapshot<T>>();
  if (cds.length === 0) return out;
  const sql = getSql();
  if (!sql) return out;
  try {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    // 스키마 보장과 조회를 하나의 마감시한 안에 넣는다. 콜드 인스턴스에서 DB 가 DDL 단계에
    // 매달려도 폴백 경로가 그만큼 늘어지지 않게, 통째로 끊고 정직한 실패로 넘어간다.
    const rows = await withTimeout(
      (async () => {
        await ensureSchema(sql);
        return (await sql`
          SELECT area_cd, collected_at, payload
          FROM stale_snapshots
          WHERE kind = ${kind} AND area_cd = ANY(${cds}) AND collected_at >= ${cutoff}
        `) as Record<string, unknown>[];
      })(),
      READ_TIMEOUT_MS,
      [] as Record<string, unknown>[],
    );
    for (const row of rows) {
      out.set(String(row.area_cd), {
        value: row.payload as T,
        at: new Date(row.collected_at as string).getTime(),
      });
    }
  } catch {
    // 읽기 실패는 'L2 없음'으로 처리한다. 호출부가 메모리만으로/실패로 넘어간다.
  }
  return out;
}

/** 스냅샷 하나를 읽는다(상세용). */
export async function loadSnapshot<T>(
  kind: SnapshotKind,
  cd: string,
  maxAgeMs: number,
): Promise<DbSnapshot<T> | null> {
  const map = await loadSnapshots<T>(kind, [cd], maxAgeMs);
  return map.get(cd) ?? null;
}

/**
 * 너무 오래된 행을 지운다(fire-and-forget). UPSERT 키 덕에 행 수는 이미 242 이하로
 * 묶여 있어 급하진 않지만, 만료된 행이 남아 저장량을 먹는 걸 정리한다. 매 요청마다 치면
 * 낭비라 호출부에서 낮은 확률로만 부른다.
 */
export async function cleanupOldSnapshots(maxAgeMs: number): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  try {
    await ensureSchema(sql);
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    await sql`DELETE FROM stale_snapshots WHERE collected_at < ${cutoff}`;
  } catch {
    // 정리는 실패해도 무해하다.
  }
}
