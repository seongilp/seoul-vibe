'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * 목록 자리에 들어가는 로딩/실패 표시.
 *
 * 왜 파일을 나눴나: 같은 목록이 lg 이상 사이드바와 좁은 화면 바텀시트 두 곳에
 * 렌더된다. 실패 UI 를 한쪽에만 달면 사용자가 실제로 보는 화면(모바일)에서만
 * 빠지는 일이 생긴다 — 실제로 그렇게 새어 나갔다.
 */

/** 아직 응답을 기다리는 중. 스켈레톤은 '곧 온다'는 뜻이므로 이 상태에서만 쓴다. */
export function ListLoading({ rows }: { rows: number }) {
  return (
    <div className="h-full space-y-2 overflow-y-auto p-4">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

/**
 * 조회가 확정적으로 실패했을 때.
 *
 * 스켈레톤을 계속 두면 사용자는 영원히 기다린다 — 실패는 이미 확정됐는데
 * 화면은 '곧 온다'고 말하는 셈이다. 문구는 상세 패널(app/api/area)이 쓰는
 * 문장과 같게 맞춰서, 어디서 막혔든 사용자가 같은 원인으로 읽게 한다.
 */
export function ListError({
  message,
  onRetry,
  retrying,
  /** 시트처럼 바로 위 헤더가 이미 같은 제목을 말하는 자리에서는 제목을 접는다. */
  titled = true,
}: {
  message: string | null;
  onRetry: () => void;
  retrying: boolean;
  titled?: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <TriangleAlert className="text-muted-foreground size-6" aria-hidden />
      {titled && <p className="text-sm font-medium">혼잡도를 불러오지 못했습니다</p>}
      <p className="text-muted-foreground text-xs leading-relaxed">
        서울시 실시간 도시데이터 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.
      </p>
      {/* 원인 문장(HTTP 코드 등)은 재현·신고에 필요하므로 숨기지 않고 작게 남긴다. */}
      {message && <p className="text-muted-foreground/70 text-[11px]">{message}</p>}
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        <RefreshCw className={retrying ? 'size-4 animate-spin' : 'size-4'} />
        다시 시도
      </Button>
    </div>
  );
}
