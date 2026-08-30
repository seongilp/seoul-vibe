'use client';

import { Users } from 'lucide-react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { colorForRank, formatClock, formatIsoClock, formatPeople } from '@/lib/congestion';
import { cn } from '@/lib/utils';
import type { AreaCongestion } from '@/lib/types';

interface AreaListProps {
  areas: AreaCongestion[];
  selectedCd: string | null;
  onSelect: (cd: string) => void;
}

export function AreaList({ areas, selectedCd, onSelect }: AreaListProps) {
  return (
    <ScrollArea className="h-full">
      <ul className="divide-border/60 divide-y">
        {areas.map((area) => {
          const known = area.rank >= 0;
          return (
            <li key={area.cd}>
              <button
                type="button"
                onClick={() => onSelect(area.cd)}
                aria-current={selectedCd === area.cd}
                className={cn(
                  'hover:bg-accent/60 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  selectedCd === area.cd && 'bg-accent',
                )}
              >
                {/*
                  stale 은 점을 흐리게 해서 한눈에 구분되게 하되, 색·명도만으로 끝내지 않는다.
                  오른쪽에 '17:50 과거값' 텍스트를 반드시 같이 띄운다.
                */}
                <span
                  className={cn('size-2.5 shrink-0 rounded-full', area.stale && 'opacity-40')}
                  style={{ backgroundColor: colorForRank(area.rank) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{area.nm}</span>
                  <span className="text-muted-foreground block truncate text-xs">{area.cat}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={cn(
                      'block text-xs font-medium',
                      area.stale && 'text-muted-foreground',
                    )}
                  >
                    {known ? area.level : '—'}
                  </span>
                  <span className="text-muted-foreground flex items-center justify-end gap-1 text-[11px]">
                    {area.stale ? (
                      // 사람 수보다 '언제 값인지'가 훨씬 중요하다. 자리를 그쪽에 내준다.
                      <span className="text-amber-400">{formatIsoClock(area.staleAt)} 과거값</span>
                    ) : known ? (
                      <>
                        <Users className="size-3" aria-hidden />
                        {formatPeople(area.max)}
                      </>
                    ) : (
                      formatClock(area.observedAt)
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
