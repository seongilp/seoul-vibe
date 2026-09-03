'use client';

import { Activity, Bike, CircleHelp, RefreshCw, TriangleAlert } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AreaDetail } from '@/components/area-detail';
import { AreaList } from '@/components/area-list';
import { BottomSheet, SNAP_RATIO, type SheetSnap } from '@/components/bottom-sheet';
import { Legend } from '@/components/legend';
import { ListError, ListLoading } from '@/components/list-placeholder';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

/**
 * 목록 조회의 클라이언트 마감시한.
 *
 * 서버는 121곳 전체에 20초 예산(SEOUL_LIST_BUDGET_MS)을 두고 무슨 일이 있어도
 * 응답하지만, 그건 서버가 응답한다는 전제다. 플랫폼 단에서 요청이 매달리면
 * congestion 이 영원히 null 이라 스켈레톤이 안 사라진다. 무한 로딩만은 없도록
 * 마지막 방어선을 둔다. 상세 패널(area-detail)이 이미 같은 이유로 쓰는 장치다.
 * 30초는 서버 예산 20초 + 콜드 스타트 여유다.
 */
const CLIENT_TIMEOUT_MS = 30_000;

export function Dashboard() {
  const [congestion, setCongestion] = useState<CongestionResponse | null>(null);
  const [bikes, setBikes] = useState<BikeResponse | null>(null);
  const [showBikes, setShowBikes] = useState(false);
  const [selectedCd, setSelectedCd] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
    혼잡도 조회가 확정 실패했는지. error 는 따릉이 실패도 같이 쓰는 배너용이라
    목록을 실패 UI 로 바꿀지 판단하는 데는 못 쓴다. 이 상태만 목록 분기에 쓴다.
  */
  const [listFailed, setListFailed] = useState(false);
  /** 바텀시트 높이. lg 이상에서는 시트를 아예 렌더하지 않으므로 무시된다. */
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const isCompact = useIsCompact();
  /*
    폴링 콜백은 effect 안에서 한 번만 만들어지므로 최신 congestion 을 클로저로
    못 본다. 실패 시 '표시할 데이터가 이미 있는가'를 판단해야 해서 ref 로 흘린다.
    (congestion 을 effect 의존성에 넣으면 갱신할 때마다 폴링이 재시작된다.)
  */
  const congestionRef = useRef<CongestionResponse | null>(null);
  useEffect(() => {
    congestionRef.current = congestion;
  }, [congestion]);

  // 순수 fetch. setState 를 하지 않아 effect 본문에서 동기 호출해도 연쇄 렌더가 없다.
  const fetchCongestion = useCallback(async (): Promise<CongestionResponse> => {
    // cache 옵션을 주지 않아 CDN/브라우저 캐시를 그대로 탄다.
    // 강제 새로고침은 handleRefresh 에서 캐시 무효화 파라미터로 처리한다.
    const response = await fetch('/api/congestion', {
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`혼잡도 조회 실패 (HTTP ${response.status})`);
    return (await response.json()) as CongestionResponse;
  }, []);

  /** 예외를 사용자가 읽을 수 있는 한 문장으로. 타임아웃은 원인이 다르니 따로 말한다. */
  const describeFailure = useCallback((cause: unknown): string => {
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      return '혼잡도를 불러오는 데 너무 오래 걸립니다.';
    }
    return cause instanceof Error ? cause.message : '혼잡도 조회 실패';
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchCongestion();
        if (cancelled) return;
        setCongestion(data);
        setError(null);
        setListFailed(false);
      } catch (cause) {
        if (cancelled) return;
        setError(describeFailure(cause));
        // 이미 받아 둔 데이터가 있으면 목록은 그대로 두고 배너로만 알린다.
        // 아무것도 없으면 스켈레톤이 아니라 실패를 보여줘야 한다.
        setListFailed((previous) => previous || congestionRef.current === null);
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
  }, [describeFailure, fetchCongestion]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // 사용자가 명시적으로 누른 경우에만 캐시를 건너뛴다.
      const response = await fetch(`/api/congestion?t=${Date.now()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`혼잡도 조회 실패 (HTTP ${response.status})`);
      setCongestion((await response.json()) as CongestionResponse);
      setError(null);
      setListFailed(false);
    } catch (cause) {
      setError(describeFailure(cause));
      setListFailed(congestionRef.current === null);
    } finally {
      setRefreshing(false);
    }
  }, [describeFailure]);

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

  /** 혼잡도를 못 받은 장소 수. rank -1 이 미상이다(과거값으로 메운 곳은 rank 가 있다). */
  const unknown = useMemo(() => areas.filter((area) => area.rank < 0).length, [areas]);

  /*
    시트 헤더 문구.

    이전에는 무조건 `장소 {길이}곳` 이었다. 아직 못 받았거나 조회가 실패한 상태에서도
    배열이 비어 있다는 이유로 '장소 0곳' 이라고 단정했고, 사용자는 그걸
    "서울에 장소가 없다" 로 읽었다. 실제로는 121곳이 그대로 있고 혼잡도만 못 받은 것이다.
    그래서 로딩 / 실패 / 전부 미상 / 일부 미상 / 정상을 각각 다른 문장으로 가른다.
    수는 '아는 사실'일 때만 말하고, 모르면 모른다고 쓴다.
  */
  const sheetSummary = useMemo(() => {
    if (listFailed) {
      return { title: '혼잡도를 불러오지 못했습니다', note: '아래에서 다시 시도할 수 있습니다' };
    }
    if (!congestion) {
      return { title: '장소 불러오는 중', note: '서울시 실시간 도시데이터' };
    }
    const total = sortedAreas.length;
    if (unknown === total) {
      // 장소가 없는 게 아니라 혼잡도를 못 받은 것이다. 둘을 같은 문장에 못 섞는다.
      return { title: `장소 ${total}곳 · 혼잡도 미상`, note: '서울시 서버가 혼잡도를 주지 않았습니다' };
    }
    if (unknown > 0) {
      return { title: `장소 ${total}곳 · 미상 ${unknown}곳`, note: '붐비는 순 · 탭하면 상세' };
    }
    return { title: `장소 ${total}곳`, note: '붐비는 순 · 탭하면 상세' };
  }, [congestion, listFailed, sortedAreas.length, unknown]);

  // 목록 모드일 때만 시트 상단에 제목을 얹는다. 상세는 AreaDetail 이 자체 헤더를 갖는다.
  const sheetHeader = selected ? null : (
    <div className="px-4 pb-2">
      <p className="text-sm font-bold">{sheetSummary.title}</p>
      <p className="text-muted-foreground text-xs">{sheetSummary.note}</p>
    </div>
  );

  /*
    목록 자리에 무엇을 그릴지 한 곳에서 정한다. 사이드바와 바텀시트가 같은 판단을
    쓰게 해야 한쪽에만 실패 UI 가 붙는 사고가 다시 안 난다.
  */
  const renderList = (skeletonRows: number, titled: boolean) => {
    if (congestion) {
      return <AreaList areas={sortedAreas} selectedCd={selectedCd} onSelect={handleSelect} />;
    }
    if (listFailed) {
      return (
        <ListError
          message={error}
          onRetry={() => void handleRefresh()}
          retrying={refreshing}
          titled={titled}
        />
      );
    }
    return <ListLoading rows={skeletonRows} />;
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden overscroll-none">
      <header className="border-border flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b py-3 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
        <Activity className="text-primary size-5" aria-hidden />
        <h1 className="text-base font-bold">서울나우</h1>
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
              {/* 수신 수는 '이번에 새로 받은' 곳만 센다. 과거값으로 메운 곳은 따로 밝힌다. */}
              {congestion.stale > 0 && (
                <span className="text-amber-400">과거값 {congestion.stale}</span>
              )}
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

      {/*
        목록이 실패 UI 로 바뀐 상태에서는 같은 문장이 배너에도 뜬다. 좁은 화면에서
        같은 말을 두 번 쌓는 건 정보가 아니라 소음이라, 그때는 배너를 접는다.
      */}
      {error && !listFailed && (
        <p className="border-destructive/40 bg-destructive/10 shrink-0 border-b px-4 py-2 text-xs">
          {error}
        </p>
      )}

      {/*
        과거값이 섞여 있으면 반드시 밝힌다. 위 헤더의 수신 통계는 md 이상에서만 보여서
        좁은 화면 사용자는 그걸 못 본다 — 이 줄은 모든 화면에서 뜬다.
        색만으로 구분하지 않도록 아이콘과 문장을 같이 둔다.
      */}
      {congestion && congestion.stale > 0 && (
        <p className="flex shrink-0 items-center gap-1.5 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          최신 갱신에 실패한 {congestion.stale}곳은 마지막으로 받은 과거 데이터입니다. 목록에서 수집
          시각을 확인하세요.
        </p>
      )}

      {/*
        혼잡도를 아예 못 받은 곳도 반드시 밝힌다. 헤더의 '119/121 수신' 통계는
        md 이상에서만 보여서 모바일 사용자는 결손을 알 길이 없었다.
        과거값(위 배너)과 달리 여기엔 보여줄 값 자체가 없으므로 경고색이 아니라
        중립 톤으로 둔다 — 잘못된 값을 보고 있는 게 아니라 값이 없는 것이다.
      */}
      {congestion && unknown > 0 && (
        <p className="border-border bg-muted/40 text-muted-foreground flex shrink-0 items-center gap-1.5 border-b px-4 py-2 text-xs">
          <CircleHelp className="size-3.5 shrink-0" aria-hidden />
          {/*
            121곳 중 두어 곳 빠지는 건 평소에도 흔해서 이 줄은 거의 늘 뜬다. 그때까지
            긴 설명을 두 줄로 깔면 좁은 화면에서 지도만 빼앗긴다. 반대로 전부 미상일
            때는 '장소가 없는 게 아니다'라는 말이 이 화면에서 가장 중요한 정보다.
          */}
          {unknown === sortedAreas.length
            ? `${unknown}곳 전부 서울시 서버에서 혼잡도를 받지 못했습니다. 장소는 그대로 있고 혼잡도만 미상입니다.`
            : `${unknown}곳은 혼잡도를 받지 못했습니다(미상).`}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <nav className="border-border hidden w-72 shrink-0 border-r lg:block">{renderList(12, true)}</nav>

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
              ) : (
                renderList(8, false)
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
