import type { RawCmrclStts } from './commerce';
import type { RawCityData, RawPpltn } from './seoul';
import { StaleStore } from './stale-cache';

/**
 * 서울 API 응답의 마지막 성공본 보관소.
 *
 * 라우트 모듈이 아니라 여기에 두는 이유: 목록 라우트와 상세 라우트가 각자 인스턴스를
 * 만들면 같은 함수 인스턴스 안에서도 서로의 성공 이력을 못 본다. 저장소는 하나여야 한다.
 */

/**
 * 혼잡도(citydata_ppltn). 장소당 약 2KB 라 121곳을 다 들고 있어도 250KB 수준이다.
 * 그래서 상한을 전체 장소 수보다 넉넉히 잡아 사실상 evict 가 일어나지 않게 한다.
 */
export const ppltnStore = new StaleStore<RawPpltn>(200);

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
