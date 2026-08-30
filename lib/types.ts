import type { AreaCategory } from './areas';

export interface ForecastPoint {
  time: string;
  level: string;
  min: number;
  max: number;
}

export interface AreaCongestion {
  cd: string;
  nm: string;
  cat: AreaCategory;
  lon: number;
  lat: number;
  /** 서울시 혼잡도 문자열. 조회 실패 시 null. */
  level: string | null;
  /** 여유=0 … 붐빔=3, 미상=-1. 지도 색상 정렬용. */
  rank: number;
  msg: string | null;
  min: number | null;
  max: number | null;
  observedAt: string | null;
  forecast: ForecastPoint[];
  /**
   * 이번 갱신에서 못 받아 마지막 성공값으로 대신 채운 장소인지.
   * true 면 화면이 반드시 '과거 데이터'라고 밝혀야 한다.
   */
  stale: boolean;
  /** stale 일 때, 그 값을 실제로 받아온 시각(ISO). 신선하면 null. */
  staleAt: string | null;
}

export interface CongestionResponse {
  demo: boolean;
  updatedAt: string;
  /** 이번 갱신에서 실제로 새로 받아온 장소 수 / 전체 장소 수 */
  resolved: number;
  total: number;
  /** 마지막 성공값으로 대신 채운 장소 수. resolved 와 겹치지 않는다. */
  stale: number;
  areas: AreaCongestion[];
}

export interface BikeStation {
  id: string;
  name: string;
  lon: number;
  lat: number;
  racks: number;
  parked: number;
}

export interface BikeResponse {
  demo: boolean;
  updatedAt: string;
  stations: BikeStation[];
}
