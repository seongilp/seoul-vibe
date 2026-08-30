'use client';

import { Activity, Bike, RefreshCw, TriangleAlert } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AreaDetail } from '@/components/area-detail';
import { AreaList } from '@/components/area-list';
import { BottomSheet, SNAP_RATIO, type SheetSnap } from '@/components/bottom-sheet';
import { Legend } from '@/components/legend';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsCompact } from '@/lib/use-media-query';
import type { BikeResponse, CongestionResponse } from '@/lib/types';

// maplibre 는 window 에 의존하므로 SSR 을 끈다.
const MapView = dynamic(() => import('@/components/map-view').then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="bg-muted/20 size-full animate-pulse" />,
});

/**
 * 폴링 주기.
 *
 * 한 번 갱신할 때마다 서울 API 를 121번(장소당 1회) 부른다. 서울 열린데이터광장
 * 인증키에는 일일 트래픽 상한이 있으므로 이 값을 함부로 줄이면 안 된다.
 *   5분  → 하루 약 35,000 호출
 *  15분  → 하루 약 12,000 호출
 *  30분  → 하루 약  6,000 호출
 * 업스트림 자체가 약 5분 주기라 더 자주 불러도 같은 값만 돌아온다.
 */
const POLL_INTERVAL_MS = 15 * 60 * 1000;

export function Dashboard() {
  const [congestion, setCongestion] = useState<CongestionResponse | null>(null);
  const [bikes, setBikes] = useState<BikeResponse | null>(null);
  const [showBikes, setShowBikes] = useState(false);
  const [selectedCd, setSelectedCd] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 바텀시트 높이. lg 이상에서는 시트를 아예 렌더하지 않으므로 무시된다. */
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const isCompact = useIsCompact();

  // 순수 fetch. setState 를 하지 않아 effect 본문에서 동기 호출해도 연쇄 렌더가 없다.
  const fetchCongestion = useCallback(async (): Promise<CongestionResponse> => {
    // cache 옵션을 주지 않아 CDN/브라우저 캐시를 그대로 탄다.
    // 강제 새로고침은 handleRefresh 에서 캐시 무효화 파라미터로 처리한다.
    const response = await fetch('/api/congestion');
    if (!response.ok) throw new Error(`혼잡도 조회 실패 (HTTP ${response.status})`);
    return (await response.json()) as CongestionResponse;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchCongestion();
        if (cancelled) return;
        setCongestion(data);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '혼잡도 조회 실패');
      }
    };

    void load();

    // 탭이 안 보이면 폴링을 멈춘다. 갱신 1회가 API 121콜이라 백그라운드 탭이
    // 조용히 할당량을 태우는 걸 막는 게 가장 큰 절약이다.
    let timer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (timer !== null) return;
      timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load();
        startPolling();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === 'visible') startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchCongestion]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // 사용자가 명시적으로 누른 경우에만 캐시를 건너뛴다.
      const response = await fetch(`/api/congestion?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`혼잡도 조회 실패 (HTTP ${response.status})`);
      setCongestion((await response.json()) as CongestionResponse);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '혼잡도 조회 실패');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // 따릉이는 토글을 켤 때 처음 한 번만 불러온다. 최대 4000건이라 기본 로드에 넣지 않는다.
  useEffect(() => {
    if (!showBikes || bikes) return;
    let cancelled = false;
    fetch('/api/bikes')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? '따릉이 조회 실패');
        if (!cancelled) setBikes(body as BikeResponse);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '따릉이 조회 실패');
      });
    return () => {
      cancelled = true;
    };
  }, [showBikes, bikes]);

  const areas = useMemo(() => congestion?.areas ?? [], [congestion]);

  // 붐비는 곳이 위로. 같은 등급이면 인구 상한 큰 순.
  const sortedAreas = useMemo(
    () => [...areas].sort((a, b) => b.rank - a.rank || (b.max ?? 0) - (a.max ?? 0)),
    [areas],
  );

  const selected = useMemo(
    () => areas.find((area) => area.cd === selectedCd) ?? null,
    [areas, selectedCd],
  );

  // 등급별 개수. '붐빔 이상' 같은 뭉뚱그린 표현은 '약간 붐빔'까지 포함해 오해를 부른다.
  const crowded = useMemo(
    () => ({
      full: areas.filter((area) => area.rank === 3).length,
      partial: areas.filter((area) => area.rank === 2).length,
    }),
    [areas],
  );

  /*
    선택 시 시트를 반쯤 올린다. peek(28%) 로 두면 상세 첫 줄만 보여서 두 번 만져야 한다.
    이미 사용자가 half/full 로 올려 뒀다면 그 높이를 존중한다.
    effect 가 아니라 핸들러에서 처리해야 연쇄 렌더가 안 난다(이 파일의 기존 방침).
  */
  const handleSelect = useCallback((cd: string) => {
    setSelectedCd(cd);
    setSnap((current) => (current === 'peek' ? 'half' : current));
  }, []);

  /** 상세를 닫으면 목록으로 돌아가되, 지도를 최대한 돌려주기 위해 peek 까지 내린다. */
  const handleCloseDetail = useCallback(() => {
    setSelectedCd(null);
    setSnap('peek');
  }, []);

  // 목록 모드일 때만 시트 상단에 제목을 얹는다. 상세는 AreaDetail 이 자체 헤더를 갖는다.
  const sheetHeader = selected ? null : (
    <div className="px-4 pb-2">
      <p className="text-sm font-bold">장소 {sortedAreas.length}곳</p>
      <p className="text-muted-foreground text-xs">붐비는 순 · 탭하면 상세</p>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden overscroll-none">
      <header className="border-border flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b py-3 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
        <Activity className="text-primary size-5" aria-hidden />
        <h1 className="text-base font-bold">Seoul Vibe</h1>
        <span className="text-muted-foreground hidden text-xs sm:inline">
          서울시 주요 {congestion?.total ?? 121}장소 실시간 혼잡도
        </span>

        {congestion?.demo && (
          <Badge variant="outline" className="border-amber-500/50 text-amber-400">
            <TriangleAlert className="mr-1 size-3" />
            샘플키 모드 · 광화문·덕수궁만 조회
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          {congestion && !congestion.demo && (
            <span className="text-muted-foreground hidden items-center gap-2 text-xs md:inline-flex">
              <span className="text-[#f87171]">붐빔 {crowded.full}</span>
              <span className="text-[#fb923c]">약간 붐빔 {crowded.partial}</span>
              <span>
                {congestion.resolved}/{congestion.total} 수신
              </span>
            </span>
          )}
          <Button
            variant={showBikes ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowBikes((value) => !value)}
          >
            <Bike className="size-4" />
            따릉이
            {showBikes && bikes ? ` ${bikes.stations.length}` : ''}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
            <span className="sr-only sm:not-sr-only">새로고침</span>
          </Button>
        </div>
      </header>

      {error && (
        <p className="border-destructive/40 bg-destructive/10 shrink-0 border-b px-4 py-2 text-xs">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <nav className="border-border hidden w-72 shrink-0 border-r lg:block">
          {congestion ? (
            <AreaList areas={sortedAreas} selectedCd={selectedCd} onSelect={handleSelect} />
          ) : (
            <div className="space-y-2 p-4">
              {Array.from({ length: 12 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          )}
        </nav>

        <main className="relative min-w-0 flex-1">
          <MapView
            areas={areas}
            bikes={bikes?.stations ?? []}
            showBikes={showBikes}
            selectedCd={selectedCd}
            onSelect={handleSelect}
            // 시트가 처음 덮는 만큼(peek) 비워 두고 서울을 그 위에 맞춘다.
            bottomInsetRatio={isCompact ? SNAP_RATIO.peek : 0}
          />
          <Legend showBikes={showBikes} />

          {/*
            좁은 화면(<1024px) 바텀시트. main 안에 직접 두는 게 두 가지 이유로 중요하다.
            (1) 이전 패널은 absolute inset-y-0 인데 positioned 조상이 없어 뷰포트
                기준으로 잡혔고, 그래서 헤더까지 덮어 로고가 "S" 만 남았다.
                main 은 relative 라 시트가 지도 영역 밖으로 못 나간다.
            (2) 시트는 실제 높이를 parentElement 의 --sheet-h 로 흘려보내고
                maplibre 컨트롤이 그 값을 상속해 비켜선다. 래퍼를 끼우면
                변수가 지도 형제 노드까지 내려가지 않는다.
          */}
          {isCompact && (
            <BottomSheet
              snap={snap}
              onSnapChange={setSnap}
              // 목록은 시트의 바닥 상태다. 상세일 때만 끌어내려 닫을 수 있다.
              onDismiss={selected ? handleCloseDetail : undefined}
              header={sheetHeader}
            >
              {selected ? (
                <AreaDetail key={selected.cd} area={selected} onClose={handleCloseDetail} />
              ) : congestion ? (
                <AreaList areas={sortedAreas} selectedCd={selectedCd} onSelect={handleSelect} />
              ) : (
                <div className="h-full space-y-2 overflow-y-auto p-4">
                  {Array.from({ length: 8 }, (_, index) => (
                    <Skeleton key={index} className="h-10 w-full" />
                  ))}
                </div>
              )}
            </BottomSheet>
          )}
        </main>

        {/*
          lg 이상 사이드 패널. 기존처럼 흐름에 들어간다(오버레이 아님).
          좁은 화면 분기가 시트로 빠졌으므로 absolute/max-w-sm 우회가 필요 없어졌다.
        */}
        {selected && !isCompact && (
          <div className="w-96 shrink-0">
            <AreaDetail key={selected.cd} area={selected} onClose={handleCloseDetail} />
          </div>
        )}
      </div>
    </div>
  );
}
