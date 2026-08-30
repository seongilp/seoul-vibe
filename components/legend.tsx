'use client';

import { LEGEND, UNKNOWN_COLOR } from '@/lib/congestion';
import { cn } from '@/lib/utils';

/**
 * occluded: 상세 패널이 지도를 덮고 있는 상태.
 * md 미만에서 상세 패널은 지도 위에 겹치는 오버레이(z-20)라 좌하단 범례를 가린다.
 * 반쯤 잘린 글자가 보이느니 아예 접는 게 낫다. md 이상은 패널이 흐름에 들어가므로 그대로 둔다.
 */
export function Legend({ showBikes, occluded }: { showBikes: boolean; occluded: boolean }) {
  return (
    <div
      className={cn(
        'bg-card/85 border-border pointer-events-none absolute bottom-6 left-4 z-10 rounded-lg border p-3 text-xs backdrop-blur',
        occluded && 'hidden md:block',
      )}
    >
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
