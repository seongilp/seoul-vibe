'use client';

import { LEGEND, UNKNOWN_COLOR } from '@/lib/congestion';

const BIKE_LEGEND = [
  { label: '0대', color: '#ef4444' },
  { label: '1–3대', color: '#f59e0b' },
  { label: '4–11대', color: '#3182f6' },
  { label: '12대+', color: '#22d3ee' },
];

export function Legend({ showBikes }: { showBikes: boolean }) {
  return (
    /*
      모바일에서는 지도 위쪽에 가로로 눕힌다.
      바텀시트가 어느 높이에 있든 절대 겹치지 않는 자리는 상단뿐이다. 예전처럼
      좌하단에 두면 시트가 올라오는 순간 글자가 잘려 "여..." "보..." 만 남았다.
      가려질 때 숨기는 방법(occluded)도 썼었지만, 범례는 지도 색을 읽는 유일한
      열쇠라 상세를 보는 동안 사라지면 정작 필요할 때 없다 — 자리를 옮겨 살린다.
      우측 상단은 maplibre 줌 컨트롤 자리라 right-14 로 비켜 준다.
      sm 이상은 기존 좌하단 세로 배치를 그대로 유지한다(데스크톱 무변경).
    */
    <div className="pointer-events-none absolute top-2 right-14 left-2 z-10 sm:top-auto sm:right-auto sm:bottom-6 sm:left-4">
      <div className="bg-card/85 border-border inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-2.5 py-1.5 text-[10px] backdrop-blur sm:flex-col sm:items-start sm:gap-1.5 sm:p-3 sm:text-xs">
        <p className="text-muted-foreground font-medium sm:mb-0.5">실시간 혼잡도</p>

        {LEGEND.map(({ level, color }) => (
          <span key={level} className="flex items-center gap-1.5">
            <span
              className="size-2.5 shrink-0 rounded-sm sm:size-3"
              style={{ backgroundColor: color }}
            />
            <span className="whitespace-nowrap">{level}</span>
          </span>
        ))}

        <span className="flex items-center gap-1.5">
          <span
            className="size-2.5 shrink-0 rounded-sm sm:size-3"
            style={{ backgroundColor: UNKNOWN_COLOR }}
          />
          <span className="text-muted-foreground whitespace-nowrap">미상</span>
        </span>

        {showBikes && (
          <>
            <p className="text-muted-foreground font-medium sm:mt-2 sm:mb-0.5">따릉이 잔여</p>
            {BIKE_LEGEND.map(({ label, color }) => (
              <span key={label} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="whitespace-nowrap">{label}</span>
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
