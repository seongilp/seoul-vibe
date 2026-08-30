/**
 * 서울 API 장애를 재현하는 로컬 프록시 (검증 도구, 런타임 코드 아님).
 *
 * 왜 있는가: 이 업스트림의 장애는 우리가 만들 수도, 기다릴 수도 없다. stale 폴백이
 * 실제로 도는지 확인하려면 장애를 흉내 낸 서버로 앱을 향하게 하는 수밖에 없다.
 *
 * 쓰는 법:
 *   node scripts/outage-proxy.mjs                       # MODE_FILE, PROXY_PORT, PRIMARY_KEY 환경변수
 *   SEOUL_API_BASE=http://127.0.0.1:8099 npm run dev    # 앱을 프록시로 향하게 한다
 *   echo blackhole > <MODE_FILE>                        # 장애 시작
 *
 * mode 파일 내용으로 매 요청 동작을 바꾼다:
 *   fixture    - 정상 응답을 흉내 낸 고정 데이터를 돌려준다 (본 서버가 지금 죽어 있어서 필요)
 *   blackhole  - TCP 는 받아주고 응답을 영원히 안 보낸다 (실측된 장애 모드)
 *   flaky      - 요청 3건 중 2건만 통과, 나머지는 blackhole (부분 실패 재현)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PROXY_PORT) || 8099;
const MODE_FILE = process.env.MODE_FILE;
const here = path.dirname(fileURLToPath(import.meta.url));
/** 픽스처의 AREA_CD 가 앱의 장소 코드와 맞아야 해서 lib/areas.ts 에서 그대로 읽어 온다. */
const areasSrc = fs.readFileSync(path.join(here, '..', 'lib', 'areas.ts'), 'utf8');
const CD_BY_NM = Object.fromEntries(
  [...areasSrc.matchAll(/\{\s*cd:\s*'([^']+)',\s*nm:\s*'([^']+)'/g)].map((m) => [m[2], m[1]]),
);

let counter = 0;

function mode() {
  try {
    return fs.readFileSync(MODE_FILE, 'utf8').trim();
  } catch {
    return 'fixture';
  }
}

function clock() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

function ppltn(nm) {
  return {
    AREA_NM: nm,
    AREA_CD: CD_BY_NM[nm] ?? 'POI000',
    AREA_CONGEST_LVL: '보통',
    AREA_CONGEST_MSG: `${nm} 픽스처 응답입니다.`,
    AREA_PPLTN_MIN: '12000',
    AREA_PPLTN_MAX: '14000',
    MALE_PPLTN_RATE: '50.0',
    FEMALE_PPLTN_RATE: '50.0',
    RESNT_PPLTN_RATE: '30.0',
    NON_RESNT_PPLTN_RATE: '70.0',
    PPLTN_TIME: clock(),
    FCST_PPLTN: [{ FCST_TIME: clock(), FCST_CONGEST_LVL: '보통', FCST_PPLTN_MIN: '12000', FCST_PPLTN_MAX: '14000' }],
  };
}

const server = http.createServer((req, res) => {
  const m = mode();
  counter += 1;
  const parts0 = decodeURIComponent(req.url).split('/').filter(Boolean);
  const reqKey = parts0[0];

  /*
    exhaust 모드: 1번 키에는 ERROR-337(일일 한도 초과)을 준다. 그러면 앱이 2번 키로
    넘어가고 URL 이 바뀌어 Next fetch 캐시가 미스난다. 2번 키는 blackhole 로 받는다.
    dev 서버의 fetch 캐시가 절대 미스나지 않아 장애를 재현할 수 없는 문제를 이렇게 푼다.
  */
  if (m === 'exhaust' && reqKey === process.env.PRIMARY_KEY) {
    const text = JSON.stringify({ RESULT: { 'RESULT.CODE': 'ERROR-337', 'RESULT.MESSAGE': '일별 트래픽 제한 초과' } });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
    return;
  }

  const blackhole = m === 'blackhole' || m === 'exhaust' || (m === 'flaky' && counter % 3 === 0);

  if (blackhole) {
    // 응답을 아예 쓰지 않는다. 소켓은 열려 있고 첫 바이트가 오지 않는다.
    return;
  }

  // /{key}/json/{service}/{start}/{end}/{suffix}
  const parts = decodeURIComponent(req.url).split('/').filter(Boolean);
  const service = parts[2];
  const nm = parts[5] ?? '';

  let body;
  if (service === 'citydata_ppltn') {
    body = { 'SeoulRtd.citydata_ppltn': [ppltn(nm)] };
  } else if (service === 'citydata') {
    body = {
      CITYDATA: {
        AREA_NM: nm,
        AREA_CD: CD_BY_NM[nm] ?? 'POI000',
        LIVE_PPLTN_STTS: [ppltn(nm)],
        LIVE_CMRCL_STTS: null,
        ROAD_TRAFFIC_STTS: { AVG_ROAD_DATA: { ROAD_TRAFFIC_IDX: '원활', ROAD_TRAFFIC_SPD: '30.5' } },
        PRK_STTS: [{ PRK_NM: '픽스처주차장', CPCTY: '100', CUR_PRK_YN: 'Y', CUR_PRK_CNT: '42' }],
        SBIKE_STTS: [{ SBIKE_SPOT_NM: '픽스처대여소', SBIKE_PARKING_CNT: '5', SBIKE_RACK_CNT: '10' }],
        WEATHER_STTS: [{ TEMP: '25.5', HUMIDITY: '60', WIND_SPD: '1.2', MAX_TEMP: '28.0', MIN_TEMP: '20.0', PM10: '20', PM25: '10', AIR_IDX: '좋음' }],
        EVENT_STTS: [],
      },
    };
  } else {
    body = { rentBikeStatus: { row: [] } };
  }

  const text = JSON.stringify(body);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('proxy listening on ' + PORT + ' mode-file=' + MODE_FILE);
});
