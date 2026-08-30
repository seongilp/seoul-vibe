'use client';

import { LEGEND, UNKNOWN_COLOR } from '@/lib/congestion';

export function Legend({ showBikes }: { showBikes: boolean }) {
  return (
    <div className="bg-card/85 border-border pointer-events-none absolute bottom-6 left-4 z-10 rounded-lg border p-3 text-xs backdrop-blur">
      <p className="text-muted-foreground mb-2 font-medium">실시간 혼잡도</p>
      <ul className="space-y-1.5">
        {LEGEND.map(({ level, color }) => (
          <li key={level} className="flex items-center gap-2">
            <span className="size-3 rounded-sm" style={{ backgroundColor: color }} />
            <span>{level}</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-sm" style={{ backgroundColor: UNKNOWN_COLOR }} />
          <span className="text-muted-foreground">미상</span>
        </li>
      </ul>
      {showBikes && (
        <>
          <p className="text-muted-foreground mt-3 mb-2 font-medium">따릉이 잔여</p>
          <ul className="space-y-1.5">
            {[
              { label: '0대', color: '#ef4444' },
              { label: '1–3대', color: '#f59e0b' },
              { label: '4–11대', color: '#3182f6' },
              { label: '12대+', color: '#22d3ee' },
            ].map((item) => (
              <li key={item.label} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
