/**
 * 실시간 상권(LIVE_CMRCL_STTS) 파싱·포맷.
 *
 * 이 데이터는 이미 citydata 응답 안에 들어 있다. 상세 패널이 citydata 를 부르고 있으므로
 * 상권 탭을 붙여도 업스트림 호출이 늘지 않는다. 반대로 목록에 상권 배지를 뿌리려 하면
 * 121콜이 새로 생긴다(citydata_ppltn 에는 상권 필드가 아예 없다) — 그래서 상세 패널 전용이다.
 */

/**
 * 상권 활발도 4단계. 인구 혼잡도(여유/보통/약간 붐빔/붐빔)와 문자열이 다르다.
 * 겹치는 값이 '보통' 하나뿐이라 congestionRank() 를 재사용하면 나머지가 전부 -1 로 떨어진다.
 *
 * 정렬 순서는 서울시 정의서에서 확인하지 못했고, 업종별 '가맹점당 결제건수' 중앙값이
 * 이 순서로 단조증가하는 것을 보고 추정했다(docs/extension-research.md 1.2).
 */
export const CMRCL_LEVELS = ['한산한', '보통', '바쁜', '분주한'] as const;
export type CmrclLevel = (typeof CMRCL_LEVELS)[number];

export function cmrclRank(level: string | null | undefined): number {
  const i = CMRCL_LEVELS.indexOf(level as CmrclLevel);
  return i < 0 ? -1 : i;
}

/** 업종 목록. 관측된 대분류는 5종, 중분류는 10종이지만 전체 코드집합은 미확인이라 문자열 그대로 쓴다. */
export interface RawCmrclRsb {
  RSB_LRG_CTGR?: string;
  RSB_MID_CTGR?: string;
  RSB_PAYMENT_LVL?: string;
  RSB_SH_PAYMENT_CNT?: number | string;
  RSB_SH_PAYMENT_AMT_MIN?: number | string;
  RSB_SH_PAYMENT_AMT_MAX?: number | string;
  RSB_MCT_CNT?: number | string;
  /** 'YYYYMM'. 가맹점 수만 월 단위 과거 집계다. 아래 RSB_MCT_TIME 주석 참고. */
  RSB_MCT_TIME?: string;
}

/**
 * AREA_SH_PAYMENT_CNT 만 문자열이고 나머지 수치는 JSON number 로 온다.
 * 타입이 섞여 있어서 전부 number|string 으로 받고 toNumber() 로 통일한다.
 */
export interface RawCmrcl {
  AREA_CMRCL_LVL?: string;
  AREA_SH_PAYMENT_CNT?: string | number;
  AREA_SH_PAYMENT_AMT_MIN?: number | string;
  AREA_SH_PAYMENT_AMT_MAX?: number | string;
  CMRCL_MALE_RATE?: number | string;
  CMRCL_FEMALE_RATE?: number | string;
  CMRCL_10_RATE?: number | string;
  CMRCL_20_RATE?: number | string;
  CMRCL_30_RATE?: number | string;
  CMRCL_40_RATE?: number | string;
  CMRCL_50_RATE?: number | string;
  CMRCL_60_RATE?: number | string;
  CMRCL_PERSONAL_RATE?: number | string;
  CMRCL_CORPORATION_RATE?: number | string;
  /** 'YYYYMMDD HHMM'. 조회 시각과 거의 일치하는 진짜 실시간 기준 시각이다. */
  CMRCL_TIME?: string;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 연령대는 10~60대 6개 값 고정이다. 값이 통째로 빠지는 장소는 못 봤지만 결측은 0 으로 접는다. */
export const AGE_BANDS = ['10', '20', '30', '40', '50', '60'] as const;

export interface AgeSlice {
  /** '20대' */
  label: string;
  rate: number;
}

export function ageSlices(cmrcl: RawCmrcl): AgeSlice[] {
  return AGE_BANDS.map((band) => ({
    label: `${band}대`,
    rate: toNumber(cmrcl[`CMRCL_${band}_RATE` as keyof RawCmrcl]) ?? 0,
  }));
}

/**
 * 결제금액은 정확한 값이 아니라 구간(MIN~MAX)이다. 게다가 구간 폭이 금액대에 따라
 * 1만/5만/10만원으로 제각각이라 (MIN+MAX)/2 로 단일 숫자를 만들면 정밀도를 지어내는 셈이 된다.
 * 그래서 '7~8만원' 처럼 범위 그대로 보여준다.
 */
export function formatAmountRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min === null || max === null) return formatWon(min ?? max ?? 0);
  if (min === max) return formatWon(min);
  // 두 값이 같은 단위로 떨어질 때만 단위를 한 번 쓴다 ('7~8만원').
  const unit = min >= 10000 && max >= 10000 ? 10000 : 1;
  if (unit === 10000) return `${trim(min / 10000)}~${trim(max / 10000)}만원`;
  return `${min.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')}원`;
}

function formatWon(value: number): string {
  if (value >= 10000) return `${trim(value / 10000)}만원`;
  return `${value.toLocaleString('ko-KR')}원`;
}

/** 8.0 → '8', 7.5 → '7.5' */
function trim(value: number): string {
  return Number(value.toFixed(1)).toString();
}

/** '20260830 1040' → '08-30 10:40' */
export function formatCmrclTime(value: string | undefined): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})\s+(\d{2})(\d{2})$/.exec(value?.trim() ?? '');
  if (!match) return value?.trim() || null;
  const [, , mm, dd, hh, mi] = match;
  return `${mm}-${dd} ${hh}:${mi}`;
}

/**
 * '202607' → '2026년 7월'.
 * 가맹점 수(RSB_MCT_CNT)만 이 시점 기준이고 나머지 상권 값은 실시간이다. 조사 시점 기준으로
 * 2개월 전 값이었다. 라벨 없이 같은 줄에 두면 가맹점 수까지 실시간으로 읽힌다.
 */
export function formatMctTime(value: string | undefined): string | null {
  const match = /^(\d{4})(\d{2})$/.exec(value?.trim() ?? '');
  if (!match) return value?.trim() || null;
  return `${match[1]}년 ${Number(match[2])}월`;
}

/**
 * citydata 응답의 LIVE_CMRCL_STTS 그대로.
 *
 * 키 자체는 121곳 모두에 있고 값만 null 인 장소가 39곳이다(공원 33곳 전부 + 고궁 3 + 인구밀집 3).
 * 빈 객체/빈 배열이 아니라 null 이므로 falsy 검사로 갈라도 안전하다. 두 번 조회했을 때
 * 같은 39곳이 두 번 다 null 이었다 — 일시적 결측이 아니라 구조적이다.
 */
export type RawCmrclStts = RawCmrcl & { CMRCL_RSB?: RawCmrclRsb[] };
