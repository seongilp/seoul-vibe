import { CONGESTION_LEVELS } from './seoul';

/**
 * 혼잡도 색상. app/globals.css 의 --congest-* 와 같은 값이어야 한다.
 * 지도는 canvas 라 CSS 변수를 읽지 못해서 hex 사본이 필요하다.
 */
export const CONGESTION_COLORS = ['#34d399', '#fbbf24', '#fb923c', '#f87171'] as const;
export const UNKNOWN_COLOR = '#52525b';

export function colorForRank(rank: number): string {
  return CONGESTION_COLORS[rank] ?? UNKNOWN_COLOR;
}

export const LEGEND = CONGESTION_LEVELS.map((level, rank) => ({
  level,
  rank,
  color: CONGESTION_COLORS[rank],
}));

/** 사람 수 범위를 '3.2만' 처럼 짧게. 사이드바 목록이 좁아서 필요하다. */
export function formatPeople(value: number | null): string {
  if (value === null) return '—';
  if (value >= 10000) return `${(value / 10000).toFixed(1)}만`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}천`;
  return String(value);
}

/** '2026-08-29 17:45' → '17:45' */
export function formatClock(value: string | null): string {
  if (!value) return '—';
  const match = /(\d{2}:\d{2})/.exec(value);
  return match ? match[1] : value;
}
