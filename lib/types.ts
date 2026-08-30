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
}

export interface CongestionResponse {
  demo: boolean;
  updatedAt: string;
  /** 조회에 성공한 장소 수 / 전체 장소 수 */
  resolved: number;
  total: number;
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
