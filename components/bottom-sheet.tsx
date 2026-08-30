'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export type SheetSnap = 'peek' | 'half' | 'full';

/**
 * 스냅 지점. 부모(지도 영역) 높이에 대한 비율이다.
 *
 * peek 은 "지도를 보면서 목록 몇 줄만 훑는" 상태라 지도에 7할 이상을 남긴다.
 * full 을 1.0 이 아니라 0.94 로 두는 건, 시트가 화면을 꽉 채우면 뒤에 지도가
 * 있다는 사실 자체가 안 보여서 사용자가 닫는 법을 잃기 때문이다.
 */
export const SNAP_RATIO: Record<SheetSnap, number> = {
  peek: 0.28,
  half: 0.56,
  full: 0.94,
};

const SNAP_ORDER: SheetSnap[] = ['peek', 'half', 'full'];

/** 이 비율보다 아래로 끌어내리면 스냅이 아니라 닫기로 해석한다. */
const DISMISS_RATIO = 0.16;

interface BottomSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** 주면 peek 아래로 끌어내렸을 때 닫힌다. 없으면 peek 이 바닥이다. */
  onDismiss?: () => void;
  /** 손잡이 옆에 붙는 고정 영역. 여기도 드래그 핸들로 동작한다. */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * 모바일 전용 드래그 바텀시트.
 *
 * 지도 위에 상세를 띄우되 "어디 얘기인지"를 잃지 않게 하는 게 목적이라,
 * 전체 화면 모달이 아니라 높이를 조절할 수 있는 시트로 만든다.
 *
 * 높이는 부모(position:relative 인 지도 영역) 기준 퍼센트로 준다. 뷰포트 기준
 * dvh 를 쓰면 헤더 높이를 빼야 하고 iOS 주소창이 접힐 때마다 어긋난다.
 */
export function BottomSheet({
  snap,
  onSnapChange,
  onDismiss,
  header,
  children,
  className,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  /** 드래그 중에만 픽셀 높이를 직접 잡는다. null 이면 스냅 비율(퍼센트)을 쓴다. */
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number; parentHeight: number } | null>(null);

  /*
    maplibre 기본 컨트롤(저작권 배지 등)은 지도 DOM 안에 있어서 React 로 위치를
    못 준다. 시트의 실제 높이를 부모의 CSS 변수로 흘려보내 CSS 쪽에서 밀어 올린다.
    드래그 중 매 프레임 setState 하면 리렌더가 쏟아지므로 DOM 을 직접 만진다.
  */
  useEffect(() => {
    const sheet = sheetRef.current;
    const parent = sheet?.parentElement;
    if (!sheet || !parent) return;

    const observer = new ResizeObserver(() => {
      parent.style.setProperty('--sheet-h', `${sheet.offsetHeight}px`);
    });
    observer.observe(sheet);

    return () => {
      observer.disconnect();
      parent.style.removeProperty('--sheet-h');
    };
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current;
    const parent = sheet?.parentElement;
    if (!sheet || !parent) return;

    dragRef.current = {
      startY: event.clientY,
      startHeight: sheet.offsetHeight,
      parentHeight: parent.clientHeight,
    };
    setDragHeight(sheet.offsetHeight);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    // 위로 끌면 커진다. 아래 한계는 0 까지 열어 둬야 '닫기' 제스처를 판정할 수 있다.
    const next = drag.startHeight - (event.clientY - drag.startY);
    const max = drag.parentHeight * SNAP_RATIO.full;
    setDragHeight(Math.max(0, Math.min(next, max)));
  }, []);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);

      const sheet = sheetRef.current;
      const height = sheet?.offsetHeight ?? drag.startHeight;
      const ratio = drag.parentHeight > 0 ? height / drag.parentHeight : SNAP_RATIO[snap];
      setDragHeight(null);

      if (onDismiss && ratio < DISMISS_RATIO) {
        onDismiss();
        return;
      }

      // 놓은 높이에서 가장 가까운 스냅으로 붙인다.
      const nearest = SNAP_ORDER.reduce((best, candidate) =>
        Math.abs(SNAP_RATIO[candidate] - ratio) < Math.abs(SNAP_RATIO[best] - ratio) ? candidate : best,
      );
      if (nearest !== snap) onSnapChange(nearest);
    },
    [onDismiss, onSnapChange, snap],
  );

  /** 손잡이를 탭(=드래그 없이 누르고 뗌)하면 다음 단계로 올린다. 큰 타깃이라 실수가 적다. */
  const handleToggle = useCallback(() => {
    const index = SNAP_ORDER.indexOf(snap);
    onSnapChange(SNAP_ORDER[(index + 1) % SNAP_ORDER.length]);
  }, [snap, onSnapChange]);

  const dragging = dragHeight !== null;

  return (
    <div
      ref={sheetRef}
      className={cn(
        'bg-card border-border absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t shadow-[0_-8px_32px_rgba(0,0,0,0.45)]',
        // 드래그 중에는 전환을 끊어야 손가락을 따라온다.
        !dragging && 'transition-[height] duration-300 ease-out',
        className,
      )}
      style={{ height: dragging ? `${dragHeight}px` : `${SNAP_RATIO[snap] * 100}%` }}
    >
      <div
        // touch-action:none 이 없으면 브라우저가 제스처를 스크롤로 가로챈다.
        className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* 손잡이 자체는 4px 이지만 위아래 여백까지 24px 를 확보해 잡기 쉽게 만든다. */}
        <button
          type="button"
          onClick={handleToggle}
          aria-label="시트 높이 조절"
          className="flex h-6 w-full items-center justify-center"
        >
          <span className="bg-muted-foreground/40 h-1 w-10 rounded-full" />
        </button>
        {header}
      </div>

      {/*
        스크롤은 자식이 직접 갖는다(AreaList=ScrollArea, AreaDetail=TabsContent).
        여기서 한 번 더 overflow-y-auto 를 걸면 이중 스크롤이 되고, 자식의 h-full 이
        내용 높이 기준으로 풀려 시트 안에서 헤더가 같이 밀려 올라간다.
        하단 safe-area(홈 인디케이터)만큼만 띄워 준다.
      */}
      <div className="min-h-0 flex-1 overscroll-contain pb-[env(safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  );
}
