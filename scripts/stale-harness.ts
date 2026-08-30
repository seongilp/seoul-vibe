/**
 * stale 폴백 통합 테스트 하네스 (일회성 검증용, 배포에는 포함되지 않는다).
 *
 * 쓰는 법 (scripts/outage-proxy.mjs 를 먼저 띄운다):
 *   npx esbuild scripts/stale-harness.ts --bundle --platform=node --format=cjs --outfile=/tmp/h.cjs
 *   MODE_FILE=/tmp/mode.txt SEOUL_API_BASE=http://127.0.0.1:8099 SEOUL_API_KEY=testkey \
 *     SEOUL_STALE_MAX_AGE_MS=60000 SEOUL_TIMEOUT_MS=1000 SEOUL_LIST_BUDGET_MS=3000 node /tmp/h.cjs
 *   COLD=1 을 주면 성공 이력이 없는 상태(콜드 + 장애)만 확인한다.
 *
 * 왜 Next 서버가 아니라 이걸로 하는가: dev 서버에서는 fetch Data Cache 가 절대
 * 미스가 나지 않아서 라우트가 업스트림 장애를 아예 못 본다. 여기서는 Next 런타임 밖이라
 * `next: { revalidate }` 가 무시되고 매번 실제 fetch 가 나간다 — 장애를 그대로 맞는다.
 */
import { GET as congestionGET } from '../app/api/congestion/route';
import { GET as areaGET } from '../app/api/area/[cd]/route';
import { writeFileSync } from 'node:fs';

const MODE_FILE = process.env.MODE_FILE!;

function setMode(mode: string) {
  writeFileSync(MODE_FILE, mode);
}

async function list() {
  const response = await congestionGET();
  const body = await response.json();
  return {
    resolved: body.resolved,
    stale: body.stale,
    missing: body.areas.filter((a: { level: string | null }) => a.level === null).length,
    cacheControl: response.headers.get('Cache-Control'),
    sample: body.areas.find((a: { stale: boolean }) => a.stale),
  };
}

async function detail(cd: string) {
  const response = await areaGET(new Request(`http://localhost/api/area/${cd}`), {
    params: Promise.resolve({ cd }),
  });
  const body = await response.json();
  return {
    status: response.status,
    stale: body.stale,
    staleAt: body.staleAt,
    error: body.error,
    message: body.message,
    cacheControl: response.headers.get('Cache-Control'),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (process.env.COLD) {
    // 성공 이력이 전혀 없는 새 인스턴스에서 장애를 맞는 경우.
    console.log('## 2. 콜드 + 장애 (성공 이력 없음)');
    setMode('blackhole');
    console.log('  목록:', await list());
    console.log('  상세:', await detail('POI014'));
    return;
  }

  console.log('## 1. 정상 → 장애 전이');
  setMode('fixture');
  const t0 = Date.now();
  console.log('  정상:', await list(), `(${Date.now() - t0}ms)`);
  console.log('  정상 상세:', await detail('POI014'));

  setMode('blackhole');
  const t1 = Date.now();
  console.log('  장애:', await list(), `(${Date.now() - t1}ms)`);
  console.log('  장애 상세:', await detail('POI014'));

  console.log('\n## 4. 부분 stale (3건 중 1건 blackhole)');
  setMode('fixture');
  await list(); // 전부 신선하게 채워 두고
  setMode('flaky');
  console.log('  부분:', await list());

  console.log('\n## 3. stale 만료 (SEOUL_STALE_MAX_AGE_MS 초과)');
  setMode('fixture');
  await list();
  await detail('POI014');
  const wait = Number(process.env.EXPIRY_WAIT_MS) || 0;
  console.log(`  ${wait}ms 대기 (STALE_MAX_AGE=${process.env.SEOUL_STALE_MAX_AGE_MS}ms)...`);
  await sleep(wait);
  setMode('blackhole');
  console.log('  만료 후 목록:', await list());
  console.log('  만료 후 상세:', await detail('POI014'));
}

void main();
