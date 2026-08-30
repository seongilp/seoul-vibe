import type { RawCmrclStts } from './commerce';
import { keepAlive } from './keep-alive';
import type { RawCityData, RawPpltn } from './seoul';
import { StaleStore } from './stale-cache';
import {
  cleanupOldSnapshots,
  loadSnapshot,
  loadSnapshots,
  persistSnapshot,
  persistSnapshots,
  type DbSnapshot,
} from './stale-db';

/**
 * 서울 API 응답의 마지막 성공본 보관소.
 *
 * 라우트 모듈이 아니라 여기에 두는 이유: 목록 라우트와 상세 라우트가 각자 인스턴스를
 * 만들면 같은 함수 인스턴스 안에서도 서로의 성공 이력을 못 본다. 저장소는 하나여야 한다.
 *
 * 2단 구조: 메모리(L1, StaleStore)가 1차, Neon(L2, stale-db)이 2차다.
 *  - 성공값은 메모리에 담고, 동시에 fire-and-forget 으로 Neon 에도 저장한다.
 *  - 폴백은 메모리부터 본다(빠르고 DB 를 안 친다). 메모리에 없을 때만 Neon 을 읽는다.
 *  - Neon 히트는 메모리에 다시 채워 넣어(warm) 다음 요청은 DB 를 안 치게 한다.
 * 이렇게 하면 콜드 인스턴스나 배포 직후에도 다른 인스턴스가 받아 둔 스냅샷을 살릴 수 있다.
 */

/**
 * 혼잡도(citydata_ppltn). 장소당 약 2KB 라 121곳을 다 들고 있어도 250KB 수준이다.
 * 그래서 상한을 전체 장소 수보다 넉넉히 잡아 사실상 evict 가 일어나지 않게 한다.
 */
export const ppltnStore = new StaleStore<RawPpltn>(200);

/**
 * 혼잡도 stale 의 최대 나이(ms). 영구 저장이 붙었으니 30분에서 다시 판단했다.
 *
 * 왜 여전히 짧게(60분) 가는가: 이 값의 알맹이는 **실시간 인구/혼잡도 등급**이다. 몇 시간 전
 * 붐빔/여유는 아예 다른 시간대의 이야기라, 저장이 영구든 아니든 의미가 낡는 속도는 그대로다.
 * 다만 30분은 실측 장애(몇 분~수십 분)의 대부분을 덮되 조금 더 긴 장애에서 콜드 인스턴스가
 * DB 에서 꺼낼 창이 좁았다. 60분으로 넓히면 그 창이 두 배가 되면서도, 하루 대부분의 시간대에서
 * 같은 '시간 밴드'를 벗어나지 않는다. 넘으면 stale 을 버리고 '미상'으로 정직하게 남긴다.
 */
export const PPLTN_STALE_MAX_AGE_MS =
  Number(process.env.SEOUL_PPLTN_STALE_MAX_AGE_MS) || 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* 상세(citydata) — 화면에 필요한 필드만 추려서 보관한다                */
/* ------------------------------------------------------------------ */

/**
 * 상세 패널(components/area-detail.tsx + commerce-panel.tsx)이 실제로 읽는 필드만.
 *
 * 왜 원본 통째로가 아닌가: 실측한 citydata 한 건은 약 125KB인데, 그중 화면이 쓰는 건
 * 9KB뿐이다(POI014 기준). 나머지는 충전소 48KB·전체 도로 상세 29KB·버스정류장 8KB처럼
 * 상세 패널이 아예 안 그리는 데이터다. 원본대로 담으면 30곳에서 20MB를 넘겨 상한을
 * 30곳으로 묶을 수밖에 없었고, 그래서 최근 눌러본 30곳을 벗어난 장소(가로수길 등)는
 * 장애 때 stale 이 없어 통째로 실패했다. 필요한 것만 추리면 9KB라 121곳을 전부 담아도
 * ~1.1MB다 — evict 를 사실상 없애면서 메모리는 오히려 원본 30곳(3.75MB)보다 적다.
 */
export interface StoredCityData {
  AREA_NM?: string;
  AREA_CD?: string;
  /** 날씨·대기질 카드. 첫 원소만 쓰므로 하나만 남긴다. */
  WEATHER_STTS?: Record<string, string>[];
  /** 도로 소통 카드는 평균값(AVG_ROAD_DATA)만 읽는다. 도로별 상세 배열(29KB)은 버린다. */
  ROAD_TRAFFIC_STTS?: { AVG_ROAD_DATA?: Record<string, string> };
  /** 주차장 카드. 잔여·수용 계산에 쓰는 세 필드만 남긴다. */
  PRK_STTS?: { CUR_PRK_YN?: string; CUR_PRK_CNT?: string; CPCTY?: string }[];
  /** 따릉이 카드. 대여 가능/거치대 두 필드만. */
  SBIKE_STTS?: { SBIKE_PARKING_CNT?: string; SBIKE_RACK_CNT?: string }[];
  /** 문화행사 카드. 상위 5건, 이름·기간·장소만. */
  EVENT_STTS?: { EVENT_NM?: string; EVENT_PERIOD?: string; EVENT_PLACE?: string }[];
  /** 상권 탭. commerce-panel 이 통째로 쓰므로 원본 그대로 둔다(약 0.6KB로 이미 작다). */
  LIVE_CMRCL_STTS?: RawCmrclStts | null;
}

/**
 * 원본 citydata 에서 상세 패널이 쓰는 필드만 골라 담는다.
 *
 * 신선한 응답(성공 경로)은 원본 그대로 내주고, 이 투영은 오직 stale 보관에만 쓴다.
 * 화면이 읽는 필드를 여기서 하나라도 빠뜨리면 그 카드가 stale 일 때만 조용히 사라지므로,
 * area-detail.tsx / commerce-panel.tsx 가 읽는 필드와 항상 맞춰야 한다.
 */
export function projectCityData(raw: RawCityData): StoredCityData {
  return {
    AREA_NM: raw.AREA_NM,
    AREA_CD: raw.AREA_CD,
    WEATHER_STTS: raw.WEATHER_STTS?.slice(0, 1),
    ROAD_TRAFFIC_STTS: raw.ROAD_TRAFFIC_STTS?.AVG_ROAD_DATA
      ? { AVG_ROAD_DATA: raw.ROAD_TRAFFIC_STTS.AVG_ROAD_DATA }
      : undefined,
    PRK_STTS: raw.PRK_STTS?.map((lot) => ({
      CUR_PRK_YN: lot.CUR_PRK_YN,
      CUR_PRK_CNT: lot.CUR_PRK_CNT,
      CPCTY: lot.CPCTY,
    })),
    SBIKE_STTS: raw.SBIKE_STTS?.map((spot) => ({
      SBIKE_PARKING_CNT: spot.SBIKE_PARKING_CNT,
      SBIKE_RACK_CNT: spot.SBIKE_RACK_CNT,
    })),
    EVENT_STTS: raw.EVENT_STTS?.slice(0, 5).map((event) => ({
      EVENT_NM: event.EVENT_NM,
      EVENT_PERIOD: event.EVENT_PERIOD,
      EVENT_PLACE: event.EVENT_PLACE,
    })),
    LIVE_CMRCL_STTS: raw.LIVE_CMRCL_STTS,
  };
}

/**
 * 상세는 투영 후 장소당 약 9KB라 121곳을 전부 담아도 ~1.1MB다. 전체 장소 수(121)에
 * 여유를 더한 130으로 잡아, 한 번이라도 성공한 장소는 인스턴스 수명 내내 evict 되지 않게 한다.
 */
export const cityDataStore = new StaleStore<StoredCityData>(130);

/**
 * 상세 stale 의 최대 나이(ms). 목록(citydata_ppltn)의 30분과 별개로 더 길게 잡는다.
 *
 * 왜 목록보다 긴가: 목록의 알맹이는 실시간 혼잡도 등급이라 30분만 지나도 출퇴근 전환에서
 * 방향이 뒤집힌다. 반면 상세 카드의 대부분(날씨·대기질·문화행사·상권·도로 안내 문구)은
 * 몇 시간 전 값도 충분히 쓸모 있다. 진짜 실시간성이 중요한 항목(주차 실시간 잔여)은
 * 애초에 대부분의 주차장이 제공하지 않아 화면에 거의 안 뜨고, 뜨더라도 수집 시각을
 * 배너로 못박아 신선한 척하지 않는다.
 *
 * 왜 항목별로 다른 수명을 안 주는가: 카드마다 나이를 따로 표시하면 사용자가 여러 시각을
 * 대조해야 해서 더 헷갈린다. 패널 전체에 '언제 받은 데이터인지' 한 시각만 붙이는 게 정직하고 단순하다.
 *
 * 왜 3시간인가: 실측된 장애는 몇 분~수십 분이지만, citydata 엔드포인트는 목록보다 훨씬
 * 자주 타임아웃난다(2026-08-30 19:48 실측: 목록 119/121 정상인데 상세는 대부분 504).
 * 즉 상세는 성공 이력을 쌓을 기회 자체가 드물어서, 어렵게 받아 둔 한 건을 30분 만에
 * 버리면 stale 이 거의 무용지물이 된다. 3시간이면 성공 이력 하나로 긴 장애 구간을 덮는다.
 * 이 값을 넘으면 stale 을 버리고 지금처럼 실패를 표시한다.
 */
export const CITYDATA_STALE_MAX_AGE_MS =
  Number(process.env.SEOUL_CITYDATA_STALE_MAX_AGE_MS) || 3 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* 2단(메모리 L1 + Neon L2) 오케스트레이션                              */
/* ------------------------------------------------------------------ */

/**
 * 상세 성공값을 저장한다. 메모리에 즉시 담고(투영), Neon 에는 fire-and-forget 으로 보낸다.
 * DB 쓰기를 await 하지 않으므로 사용자 응답이 느려지지 않는다. rejection 은 삼켜서
 * unhandledRejection 이 안 나게 한다.
 */
export function rememberCityData(cd: string, raw: RawCityData, at = Date.now()): Promise<void> {
  const projected = projectCityData(raw);
  cityDataStore.remember(cd, projected, at);
  // waitUntil 로 등록해 응답을 막지 않으면서도 쓰기가 끝까지 살아남게 한다.
  // 반환 프로미스는 테스트가 await 로 쓰기 완료를 기다릴 때만 쓴다(라우트는 무시).
  const write = persistSnapshot('citydata', cd, at, projected).catch(() => {});
  keepAlive(write);
  return write;
}

/**
 * 상세 stale 을 꺼낸다. 메모리 → Neon 순. Neon 히트는 메모리에 warm 한다.
 * 없거나 너무 오래됐으면 null(호출부가 정직하게 실패를 표시).
 */
export async function recallCityData(cd: string): Promise<DbSnapshot<StoredCityData> | null> {
  const mem = cityDataStore.recall(cd, CITYDATA_STALE_MAX_AGE_MS);
  if (mem) return { value: mem.value, at: mem.at };

  const db = await loadSnapshot<StoredCityData>('citydata', cd, CITYDATA_STALE_MAX_AGE_MS);
  if (db) {
    // 다음 요청은 DB 를 안 치도록 메모리를 채운다.
    cityDataStore.remember(cd, db.value, db.at);
    return db;
  }
  return null;
}

/**
 * 목록 성공값들을 저장한다. 메모리에 각각 담고, Neon 에는 한 번의 배치 UPSERT 로 보낸다.
 * fire-and-forget 이라 목록 응답을 지연시키지 않는다.
 */
export function rememberPpltnBatch(
  entries: { cd: string; value: RawPpltn }[],
  at = Date.now(),
): Promise<void> {
  for (const { cd, value } of entries) ppltnStore.remember(cd, value, at);
  const write = persistSnapshots(
    'ppltn',
    entries.map(({ cd, value }) => ({ cd, at, payload: value })),
  ).catch(() => {});
  keepAlive(write);
  return write;
}

/**
 * 목록의 결측 장소들에 대해 stale 을 꺼낸다. 먼저 메모리를 훑고(동기), 메모리에도 없는
 * 것만 Neon 에서 배치로 읽는다. Neon 히트는 메모리에 warm 한다.
 *
 * 왜 이 구조인가: 목록은 121곳을 한 번에 다루므로, 메모리 히트가 많으면 DB 를 아예 안 치거나
 * 소수 키만 조회한다. 결과는 cd→스냅샷 Map 으로, 라우트의 기존 stale/미상 분기가 그대로 쓴다.
 */
export async function recallPpltnBatch(cds: string[]): Promise<Map<string, DbSnapshot<RawPpltn>>> {
  const out = new Map<string, DbSnapshot<RawPpltn>>();
  const missing: string[] = [];

  for (const cd of cds) {
    const mem = ppltnStore.recall(cd, PPLTN_STALE_MAX_AGE_MS);
    if (mem) out.set(cd, { value: mem.value, at: mem.at });
    else missing.push(cd);
  }

  if (missing.length > 0) {
    const db = await loadSnapshots<RawPpltn>('ppltn', missing, PPLTN_STALE_MAX_AGE_MS);
    for (const [cd, hit] of db) {
      ppltnStore.remember(cd, hit.value, hit.at);
      out.set(cd, hit);
    }
  }
  return out;
}

/**
 * 만료된 Neon 행을 낮은 확률로 정리한다(fire-and-forget). UPSERT 키 덕에 행 수는 이미
 * 242 이하로 묶여 있어 급하지 않으므로, 매 요청마다가 아니라 가끔만 친다. 가장 긴 수명
 * (citydata 3시간)을 기준으로 그보다 오래된 건 어떤 종류든 이미 못 쓰는 값이라 지운다.
 */
export function maybeCleanupStale(probability = 0.02): void {
  if (Math.random() >= probability) return;
  void cleanupOldSnapshots(CITYDATA_STALE_MAX_AGE_MS).catch(() => {});
}
