/**
 * 서울 열린데이터광장 실시간 도시데이터 클라이언트.
 *
 * 주의 (Vercel 배포 관련):
 * upstream 이 http://openapi.seoul.go.kr:8088 (평문 HTTP + 비표준 포트) 이라
 * 브라우저에서 직접 호출하면 https 배포에서 mixed content 로 차단된다.
 * 반드시 이 모듈을 서버(route handler)에서만 사용할 것. 인증키 은닉도 겸한다.
 */

import type { RawCmrclStts } from './commerce';

const BASE = 'http://openapi.seoul.go.kr:8088';

/** 샘플키는 '광화문·덕수궁' 한 곳만 응답한다. 키가 없으면 데모 모드로 동작. */
export const SAMPLE_KEY = 'sample';
export const SAMPLE_AREA_NM = '광화문·덕수궁';

/**
 * 인증키 목록. 앞이 주 키, 뒤는 예비 키다.
 *
 * 라운드로빈으로 매 호출마다 키를 바꾸면 안 된다. 키가 URL 경로에 들어가는 API 라
 * URL 이 매번 달라지고, Next 의 fetch 캐시가 전부 미스나서 오히려 호출량이 폭증한다.
 * 그래서 주 키를 고정해 쓰고, 일일 트래픽 초과(ERROR-337)나 키 오류(INFO-100)가
 * 났을 때만 다음 키로 넘어간다.
 */
/** 예비 키는 SEOUL_API_KEY_2, _3, ... 순으로 원하는 만큼 붙일 수 있다. */
const MAX_KEYS = 10;

export function getApiKeys(): string[] {
  const names = ['SEOUL_API_KEY'];
  for (let n = 2; n <= MAX_KEYS; n += 1) names.push(`SEOUL_API_KEY_${n}`);

  const keys = names
    .map((name) => process.env[name]?.trim())
    .filter((key): key is string => Boolean(key));

  // 같은 키를 두 번 넣으면 failover 가 무의미해지므로 중복은 걷어낸다.
  const unique = [...new Set(keys)];
  return unique.length > 0 ? unique : [SAMPLE_KEY];
}

export function getApiKey(): string {
  return getApiKeys()[activeKeyIndex] ?? SAMPLE_KEY;
}

export function isDemoMode(): boolean {
  return getApiKeys()[0] === SAMPLE_KEY;
}

/**
 * 현재 사용 중인 키의 인덱스. 워밍된 함수 인스턴스 안에서만 유지된다.
 * Vercel 함수는 언제든 새로 뜨므로 정확한 상태가 아니라 최선의 추정이다.
 */
let activeKeyIndex = 0;

/** 키 자체 문제로 실패한 코드들. 다른 키로 재시도할 가치가 있다. */
const KEY_EXHAUSTED_CODES = new Set([
  'ERROR-337', // 일별 트래픽 제한 초과
  'INFO-100', // 인증키가 유효하지 않음
]);

function advanceKey(): boolean {
  const total = getApiKeys().length;
  if (total < 2) return false;
  activeKeyIndex = (activeKeyIndex + 1) % total;
  return true;
}

/** 혼잡도 4단계. 서울시가 내려주는 문자열 그대로가 키다. */
export const CONGESTION_LEVELS = ['여유', '보통', '약간 붐빔', '붐빔'] as const;
export type CongestionLevel = (typeof CONGESTION_LEVELS)[number];

export function congestionRank(level: string | null | undefined): number {
  const i = CONGESTION_LEVELS.indexOf(level as CongestionLevel);
  return i < 0 ? -1 : i;
}

export interface SeoulApiError {
  code: string;
  message: string;
}

export class SeoulApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'SeoulApiFailure';
  }
}

/**
 * 서울 API는 실패해도 HTTP 200 에 에러 바디를 준다. RESULT.CODE 를 반드시 확인해야 한다.
 * 성공 코드는 INFO-000.
 */
function assertOk(body: unknown, context: string): void {
  const result = extractResult(body);
  if (!result) return;
  if (result.code === 'INFO-000') return;
  throw new SeoulApiFailure(result.code, `${context}: ${result.code} ${result.message}`);
}

function extractResult(body: unknown): SeoulApiError | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;

  // citydata 계열: { RESULT: { 'RESULT.CODE': ..., 'RESULT.MESSAGE': ... } }
  const direct = record.RESULT as Record<string, unknown> | undefined;
  if (direct) {
    const code = (direct['RESULT.CODE'] ?? direct.CODE) as string | undefined;
    const message = (direct['RESULT.MESSAGE'] ?? direct.MESSAGE) as string | undefined;
    if (code) return { code, message: message ?? '' };
  }

  // bikeList 계열: { rentBikeStatus: { RESULT: { CODE, MESSAGE } } }
  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value !== null && 'RESULT' in value) {
      const nested = (value as Record<string, unknown>).RESULT as Record<string, unknown>;
      const code = (nested['RESULT.CODE'] ?? nested.CODE) as string | undefined;
      const message = (nested['RESULT.MESSAGE'] ?? nested.MESSAGE) as string | undefined;
      if (code) return { code, message: message ?? '' };
    }
  }
  return null;
}

/**
 * 혼잡도 캐시 수명(초).
 *
 * 이 값이 곧 일일 API 호출량을 결정한다. 갱신 1회가 121콜이고, Next Data Cache 가
 * 도는 동안에는 방문자가 몇 명이든 업스트림 호출이 0 이기 때문이다.
 *   호출/일 = 121 × 86400 / TTL
 * 업스트림 자체는 약 5분 주기라 그보다 짧게 잡으면 같은 값을 다시 받아올 뿐이다.
 * SEOUL_CACHE_TTL 로 조정할 수 있다.
 */
export const UPSTREAM_REFRESH_SECONDS = Number(process.env.SEOUL_CACHE_TTL) || 900;

/** 상세 패널은 사용자가 누른 장소 1곳만 부르므로 더 신선하게 둬도 싸다. */
export const DETAIL_REFRESH_SECONDS = 300;

/**
 * 업스트림 fetch 하나당 허용하는 시간(ms).
 *
 * 왜 필요한가: 이 API 서버는 죽을 때 연결을 거절하지 않는다. TCP 는 30ms 만에 받아주고
 * 그 뒤로 첫 바이트를 영원히 안 보낸다(2026-08-30 관측: connect 0.03s, TTFB 무한).
 * 타임아웃이 없으면 함수는 maxDuration 까지 매달렸다가 504 FUNCTION_INVOCATION_TIMEOUT
 * 으로 죽는다. 사용자에게 30초 스켈레톤을 보여주느니 6초 만에 실패를 말하는 게 낫다.
 *
 * 왜 6초인가: 정상일 때 이 API 는 0.1~0.3초에 응답한다(citydata 는 본문 130~220KB).
 * 6초면 정상 지연의 20배 이상이라 멀쩡한 요청을 자를 위험이 사실상 없으면서,
 * 상세 라우트 예산(maxDuration 30초)의 5분의 1만 쓴다.
 */
export const UPSTREAM_TIMEOUT_MS = Number(process.env.SEOUL_TIMEOUT_MS) || 6000;

/** 타임아웃으로 잘렸을 때의 실패 코드. 라우트가 이 코드로 사용자 문구를 고른다. */
export const TIMEOUT_CODE = 'UPSTREAM_TIMEOUT';

interface FetchOptions {
  /** 초 단위 캐시 수명. */
  revalidate: number;
  /**
   * 호출자가 거는 상위 마감시한. 목록 라우트처럼 요청 수가 많을 때
   * 전체 예산을 넘기지 않도록 배치 전체에 하나를 공유시킨다.
   */
  signal?: AbortSignal;
}

async function callSeoul<T>(
  service: string,
  start: number,
  end: number,
  suffix: string,
  options: FetchOptions,
): Promise<T> {
  const attempts = getApiKeys().length;
  let lastFailure: SeoulApiFailure | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await callSeoulOnce<T>(service, start, end, suffix, options);
    } catch (error) {
      // 타임아웃은 KEY_EXHAUSTED_CODES 에 없으므로 여기서 즉시 재던져진다. 의도한 것이다.
      // 서버가 먹통이라 안 나오는 응답을 키만 바꿔 다시 기다리면 대기 시간만 키 개수만큼
      // 곱해져서(6초 × 3키 = 18초) 애초에 타임아웃을 건 이유가 사라진다.
      if (!(error instanceof SeoulApiFailure) || !KEY_EXHAUSTED_CODES.has(error.code)) throw error;
      lastFailure = error;
      if (!advanceKey()) break;
    }
  }

  throw lastFailure ?? new SeoulApiFailure('NO_KEY', `${service}: 사용 가능한 인증키가 없습니다.`);
}

async function callSeoulOnce<T>(
  service: string,
  start: number,
  end: number,
  suffix: string,
  { revalidate, signal }: FetchOptions,
): Promise<T> {
  const key = encodeURIComponent(getApiKey());
  const tail = suffix ? `/${encodeURIComponent(suffix)}` : '';
  const url = `${BASE}/${key}/json/${service}/${start}/${end}${tail}`;

  /*
    signal 은 Data Cache 를 깨지 않는다. 캐시 키는 url/method/headers/mode/redirect/
    credentials/referrer 로만 만들어지고(incremental-cache/index.js generateCacheKey),
    Next 는 백그라운드 재검증 때 signal 을 알아서 떼고 부른다(patch-fetch.js).
    그래서 타임아웃을 붙여도 캐시 히트 경로는 그대로다.
  */
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      signal: deadline,
      next: { revalidate },
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new SeoulApiFailure('HTTP_' + response.status, `${service} 응답 실패 (HTTP ${response.status})`);
    }

    // 본문 읽기도 같은 마감시한 안에 둔다. 헤더만 오고 본문이 멎는 경우가 있어서,
    // fetch 만 감싸면 여기서 다시 무한정 매달릴 수 있다.
    text = await response.text();
  } catch (error) {
    if (error instanceof SeoulApiFailure) throw error;
    // 상위 마감시한이 먼저 끊은 경우와 이 요청 자체가 느린 경우를 구분해서 말해준다.
    if (timeout.aborted) {
      throw new SeoulApiFailure(
        TIMEOUT_CODE,
        `${service}: 서울시 API 가 ${UPSTREAM_TIMEOUT_MS}ms 안에 응답하지 않았습니다.`,
        504,
      );
    }
    if (signal?.aborted) {
      throw new SeoulApiFailure(TIMEOUT_CODE, `${service}: 전체 응답 시간을 초과했습니다.`, 504);
    }
    throw error;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // 인증키 오류 등 일부 케이스는 XML 로 떨어진다.
    const code = /<(?:RESULT\.)?CODE>([^<]+)</.exec(text)?.[1] ?? 'NON_JSON_RESPONSE';
    const message = /<(?:RESULT\.)?MESSAGE>([^<]+)</.exec(text)?.[1] ?? text.slice(0, 200);
    throw new SeoulApiFailure(code, `${service}: ${message}`);
  }

  assertOk(body, service);
  return body as T;
}

/* ------------------------------------------------------------------ */
/* 실시간 인구/혼잡도 (citydata_ppltn) — 장소당 약 2KB, 목록 렌더링용   */
/* ------------------------------------------------------------------ */

export interface PpltnForecast {
  FCST_TIME: string;
  FCST_CONGEST_LVL: string;
  FCST_PPLTN_MIN: string;
  FCST_PPLTN_MAX: string;
}

export interface RawPpltn {
  AREA_NM: string;
  AREA_CD: string;
  AREA_CONGEST_LVL: string;
  AREA_CONGEST_MSG: string;
  AREA_PPLTN_MIN: string;
  AREA_PPLTN_MAX: string;
  MALE_PPLTN_RATE: string;
  FEMALE_PPLTN_RATE: string;
  RESNT_PPLTN_RATE: string;
  NON_RESNT_PPLTN_RATE: string;
  PPLTN_TIME: string;
  FCST_PPLTN?: PpltnForecast[];
  [key: string]: unknown;
}

export async function fetchPpltn(areaNm: string, options?: Partial<FetchOptions>): Promise<RawPpltn | null> {
  const body = await callSeoul<{ 'SeoulRtd.citydata_ppltn'?: RawPpltn[] }>(
    'citydata_ppltn',
    1,
    5,
    areaNm,
    { revalidate: UPSTREAM_REFRESH_SECONDS, ...options },
  );
  return body['SeoulRtd.citydata_ppltn']?.[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* 통합 도시데이터 (citydata) — 장소당 약 170KB, 상세 패널용            */
/* ------------------------------------------------------------------ */

export interface RawCityData {
  AREA_NM: string;
  AREA_CD: string;
  LIVE_PPLTN_STTS?: RawPpltn[];
  /** 실시간 상권. 카드 가맹점이 거의 없는 폴리곤(공원·고궁 등 39곳)에서는 null 로 온다. */
  LIVE_CMRCL_STTS?: RawCmrclStts | null;
  ROAD_TRAFFIC_STTS?: { AVG_ROAD_DATA?: Record<string, string> };
  PRK_STTS?: Record<string, string>[];
  SBIKE_STTS?: Record<string, string>[];
  WEATHER_STTS?: Record<string, string>[];
  CHARGER_STTS?: Record<string, string>[];
  EVENT_STTS?: Record<string, string>[];
  SUB_STTS?: Record<string, string>[];
  ACDNT_CNTRL_STTS?: Record<string, string>[];
  [key: string]: unknown;
}

export async function fetchCityData(areaNm: string, options?: Partial<FetchOptions>): Promise<RawCityData | null> {
  const body = await callSeoul<{ CITYDATA?: RawCityData }>('citydata', 1, 5, areaNm, {
    revalidate: DETAIL_REFRESH_SECONDS,
    ...options,
  });
  return body.CITYDATA ?? null;
}

/* ------------------------------------------------------------------ */
/* 따릉이 실시간 대여소 (bikeList) — 1회 최대 1000건                    */
/* ------------------------------------------------------------------ */

export interface RawBikeStation {
  stationId: string;
  stationName: string;
  stationLatitude: string;
  stationLongitude: string;
  rackTotCnt: string;
  parkingBikeTotCnt: string;
  shared: string;
}

const BIKE_PAGE_SIZE = 1000;
const BIKE_MAX_PAGES = 4;
/** 샘플키는 한 번에 5건까지만 허용한다 (ERROR-335). */
const BIKE_DEMO_PAGE_SIZE = 5;

/**
 * 따릉이는 페이지를 순차로 4번 받는다. 페이지마다 6초를 기다리면 24초라
 * maxDuration(30초)에 위험할 만큼 붙는다. 전체에 하나의 마감시한을 씌워 둔다.
 */
const BIKE_BUDGET_MS = 15_000;

export async function fetchBikeStations(options?: Partial<FetchOptions>): Promise<RawBikeStation[]> {
  const collected: RawBikeStation[] = [];
  const budget = AbortSignal.timeout(BIKE_BUDGET_MS);
  const demo = isDemoMode();
  const pageSize = demo ? BIKE_DEMO_PAGE_SIZE : BIKE_PAGE_SIZE;
  const maxPages = demo ? 1 : BIKE_MAX_PAGES;

  for (let page = 0; page < maxPages; page += 1) {
    const start = page * pageSize + 1;
    const end = start + pageSize - 1;
    const body = await callSeoul<{ rentBikeStatus?: { row?: RawBikeStation[] } }>(
      'bikeList',
      start,
      end,
      '',
      { revalidate: 60, signal: budget, ...options },
    );
    const rows = body.rentBikeStatus?.row ?? [];
    collected.push(...rows);
    if (rows.length < pageSize) break;
  }

  return collected;
}
