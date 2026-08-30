'use client';

import { Bike, CloudSun, Car, ParkingCircle, Ticket, Wind, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { CommercePanel } from '@/components/commerce-panel';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { RawCmrclStts } from '@/lib/commerce';
import { colorForRank, formatClock, formatPeople } from '@/lib/congestion';
import { congestionRank } from '@/lib/seoul';
import type { AreaCongestion } from '@/lib/types';

interface CityDataPayload {
  data: {
    LIVE_PPLTN_STTS?: Record<string, string>[];
    // ROAD_TRAFFIC_SPD 는 숫자로 내려온다.
    ROAD_TRAFFIC_STTS?: { AVG_ROAD_DATA?: Record<string, string | number> };
    PRK_STTS?: Record<string, string>[];
    SBIKE_STTS?: Record<string, string>[];
    WEATHER_STTS?: Record<string, string>[];
    EVENT_STTS?: Record<string, string>[];
    /** 카드 가맹점이 거의 없는 장소(공원·고궁 등 39곳)에서는 null 로 온다. */
    LIVE_CMRCL_STTS?: RawCmrclStts | null;
  };
}

interface AreaDetailProps {
  area: AreaCongestion;
  onClose: () => void;
}

/**
 * 장소가 바뀌면 상태를 초기화해야 하는데, 그걸 effect 안에서 setState 로 하면
 * 연쇄 렌더가 난다. 대신 부모가 key={area.cd} 로 리마운트시킨다.
 */
export function AreaDetail({ area, onClose }: AreaDetailProps) {
  const [payload, setPayload] = useState<CityDataPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('status');

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/area/${area.cd}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? body.error ?? '조회 실패');
        setPayload(body as CityDataPayload);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : '조회 실패');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [area.cd]);

  const weather = payload?.data.WEATHER_STTS?.[0];
  // 결측일 때 '-°' 를 그리느니 예보 줄 자체를 접는다.
  const forecastRange = temperatureRange(weather?.MIN_TEMP, weather?.MAX_TEMP);
  const road = payload?.data.ROAD_TRAFFIC_STTS?.AVG_ROAD_DATA;
  const parking = payload?.data.PRK_STTS ?? [];
  const bikes = payload?.data.SBIKE_STTS ?? [];
  const events = payload?.data.EVENT_STTS ?? [];

  /*
    121곳 중 39곳(공원 33곳 전부 + 고궁 3 + 인구밀집 3)은 LIVE_CMRCL_STTS 가 null 이다.
    카드 가맹점이 사실상 없는 폴리곤이라 일시적 결측이 아니라 구조적이다.
    그런 장소에서 탭을 띄우면 3분의 1 가까이가 눌러봐야 빈 카드다 — 탭 자체를 감춘다.
    반대로 관광특구 7/7, 발달상권 28/28 은 100% 커버된다.
  */
  const cmrcl = payload?.data.LIVE_CMRCL_STTS ?? null;
  const rsb = cmrcl?.CMRCL_RSB ?? [];
  const hasCommerce = Boolean(cmrcl && (cmrcl.AREA_CMRCL_LVL || rsb.length > 0));
  /*
    로딩 중에는 상권 탭이 아직 없으므로 tab 이 'commerce' 인 채로 남으면 빈 화면이 된다.
    상태를 effect 로 되돌리면(= effect 안 setState) 연쇄 렌더가 나고 eslint 도 막는다.
    그래서 상태는 그대로 두고 렌더 시점에만 유효한 값으로 접는다.
  */
  const activeTab = hasCommerce ? tab : 'status';

  const bikeParked = bikes.reduce((sum, spot) => sum + (Number(spot.SBIKE_PARKING_CNT) || 0), 0);
  const bikeRacks = bikes.reduce((sum, spot) => sum + (Number(spot.SBIKE_RACK_CNT) || 0), 0);
  /*
    CUR_PRK_CNT 는 실시간 주차 가능 면수인데, 대부분의 주차장이 빈 문자열로 보낸다
    (CUR_PRK_YN='N' = 실시간 정보 미제공). 강남역 95곳·혜화역 24곳·청담동 16곳 모두
    실시간 제공 0곳이었다. 이걸 Number('') || 0 으로 뭉개서 합산하면 결측이 진짜 0으로
    둔갑해 "0면 주차 가능"(= 자리 없음)이라고 단언하게 된다. 없는 정보와 0은 다르다.
    그래서 실시간 값을 실제로 준 주차장만 집계하고, 하나도 없으면 잔여를 아예 말하지 않는다.
  */
  const liveParking = parking.filter(
    (lot) => lot.CUR_PRK_YN === 'Y' && parkedCount(lot.CUR_PRK_CNT) !== null,
  );
  const parkingAvailable = liveParking.reduce((sum, lot) => sum + (parkedCount(lot.CUR_PRK_CNT) ?? 0), 0);
  const parkingCapacity = parking.reduce((sum, lot) => sum + (Number(lot.CPCTY) || 0), 0);

  // border-l 은 사이드 패널(lg+)일 때만. 바텀시트에서는 왼쪽 테두리가 뜬금없다.
  return (
    <aside className="bg-card border-border flex h-full w-full flex-col lg:border-l">
      <header className="flex items-start gap-2 px-4 pt-4 pb-3">
        <span
          className="mt-1.5 size-3 shrink-0 rounded-full"
          style={{ backgroundColor: colorForRank(area.rank) }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold">{area.nm}</h2>
          <p className="text-muted-foreground text-xs">
            {area.cat} · {formatClock(area.observedAt)} 기준
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="상세 닫기"
          // 아이콘은 그대로 두고 상자만 44px 로 키운다(모바일 최소 터치 타깃).
          className="hover:bg-accent text-muted-foreground -m-2 flex size-11 shrink-0 items-center justify-center rounded-md md:m-0 md:size-8"
        >
          <X className="size-5 md:size-4" />
        </button>
      </header>

      <Separator />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setTab(String(value))}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {hasCommerce && (
          <div className="px-4 pt-3">
            {/* h-9 은 모바일 터치 타깃 확보용. 기본 h-8 은 손가락으로 누르기 좁다. */}
            <TabsList className="h-9 w-full">
              <TabsTrigger value="status">현황</TabsTrigger>
              <TabsTrigger value="commerce">상권</TabsTrigger>
            </TabsList>
          </div>
        )}

        <TabsContent value="status" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <section>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold" style={{ color: colorForRank(area.rank) }}>
              {area.level ?? '데이터 없음'}
            </span>
            {area.min !== null && (
              <span className="text-muted-foreground text-sm">
                {formatPeople(area.min)}–{formatPeople(area.max)}명
              </span>
            )}
          </div>
          {area.msg && <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{area.msg}</p>}
        </section>

        {area.forecast.length > 0 && (
          <section className="mt-5">
            <h3 className="text-muted-foreground mb-2 text-xs font-medium">향후 12시간 예측</h3>
            <div className="flex items-end gap-1">
              {area.forecast.map((point) => (
                <div key={point.time} className="flex-1" title={`${point.time} ${point.level}`}>
                  <div className="flex h-9 items-end">
                    <div
                      className="w-full rounded-sm"
                      style={{
                        height: 8 + congestionRank(point.level) * 9,
                        backgroundColor: colorForRank(congestionRank(point.level)),
                      }}
                    />
                  </div>
                  <span className="text-muted-foreground mt-1 block text-center text-[10px]">
                    {formatClock(point.time).slice(0, 2)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <Separator className="my-5" />

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {error && (
          <p className="border-destructive/40 bg-destructive/10 text-destructive-foreground rounded-md border p-3 text-xs leading-relaxed">
            {error}
          </p>
        )}

        {payload && (
          <div className="space-y-4">
            {weather && (
              <Stat icon={<CloudSun className="size-4" />} label="날씨">
                {/* 실황(기상청 초단기실황)끼리만 한 줄에 둔다. 셋 다 지금 이 순간의 관측값이다. */}
                <span className="text-lg font-bold">{weather.TEMP}°</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  습도 {weather.HUMIDITY}% · 바람 {weather.WIND_SPD}m/s
                </span>
                {/*
                  MAX_TEMP/MIN_TEMP 는 기상청 동네예보의 일 최고/최저기온(TMX/TMN) 예보값이고
                  TEMP 는 초단기실황 관측값이다. 출처가 다르니 예보가 빗나가면 실황이 예보
                  최고를 넘는 게 정상이다(2026-08-30 15:20 서울 12곳 전부 TEMP > MAX_TEMP).
                  둘을 한 줄에 붙여 놓으면 "현재 28.1°인데 최고 26.0°" 처럼 자기모순으로 읽혀서
                  줄을 나누고 '예보' 라벨을 붙였다. 값 자체는 API 가 준 그대로 둔다.
                */}
                {forecastRange && (
                  <p className="text-muted-foreground mt-1.5 text-[11px]">
                    <span className="text-foreground/70 font-medium">예보</span> 오늘 최저 {forecastRange.min}° ·
                    최고 {forecastRange.max}°
                  </p>
                )}
                <p className="text-muted-foreground mt-1 text-xs">{weather.PCP_MSG}</p>
              </Stat>
            )}

            {weather && (
              <Stat icon={<Wind className="size-4" />} label="대기질">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">통합 {weather.AIR_IDX}</Badge>
                  <Badge variant="outline">
                    초미세 {weather.PM25} ({weather.PM25_INDEX})
                  </Badge>
                  <Badge variant="outline">
                    미세 {weather.PM10} ({weather.PM10_INDEX})
                  </Badge>
                  <Badge variant="outline">자외선 {weather.UV_INDEX_LVL}</Badge>
                </div>
              </Stat>
            )}

            {road?.ROAD_TRAFFIC_IDX && (
              <Stat icon={<Car className="size-4" />} label="도로 소통">
                <span className="text-lg font-bold">{road.ROAD_TRAFFIC_IDX}</span>
                <span className="text-muted-foreground ml-2 text-xs">평균 {road.ROAD_TRAFFIC_SPD}km/h</span>
                {road.ROAD_MSG && <p className="text-muted-foreground mt-1 text-xs">{road.ROAD_MSG}</p>}
              </Stat>
            )}

            {parking.length > 0 && (
              <Stat icon={<ParkingCircle className="size-4" />} label="주차장">
                {liveParking.length > 0 ? (
                  <>
                    <span className="text-lg font-bold">{parkingAvailable}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      면 주차 가능 · 실시간 {liveParking.length}/{parking.length}곳 · 총 {parkingCapacity}면
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-lg font-bold">{parking.length}</span>
                    <span className="text-muted-foreground ml-2 text-xs">곳 · 총 {parkingCapacity}면</span>
                    <p className="text-muted-foreground mt-1 text-xs">
                      실시간 잔여 면수는 제공되지 않습니다.
                    </p>
                  </>
                )}
              </Stat>
            )}

            {bikes.length > 0 && (
              <Stat icon={<Bike className="size-4" />} label="따릉이">
                <span className="text-lg font-bold">{bikeParked}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  대 대여 가능 · 거치대 {bikeRacks} · 대여소 {bikes.length}곳
                </span>
              </Stat>
            )}

            {events.length > 0 && (
              <Stat icon={<Ticket className="size-4" />} label={`문화행사 ${events.length}건`}>
                <ul className="mt-1 space-y-1.5">
                  {events.slice(0, 5).map((event, index) => (
                    <li key={`${event.EVENT_NM}-${index}`} className="text-xs">
                      <span className="block truncate">{event.EVENT_NM}</span>
                      <span className="text-muted-foreground block truncate text-[11px]">
                        {event.EVENT_PERIOD} · {event.EVENT_PLACE}
                      </span>
                    </li>
                  ))}
                </ul>
              </Stat>
            )}
          </div>
        )}
        </TabsContent>

        {cmrcl && hasCommerce && (
          <TabsContent value="commerce" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <CommercePanel cmrcl={cmrcl} rsb={rsb} />
          </TabsContent>
        )}
      </Tabs>
    </aside>
  );
}

/**
 * 서울시 API 는 결측을 '-' 나 빈 문자열로 흘려보낸다. 숫자로 읽히는 값일 때만 통과시킨다.
 * 값을 보정하지는 않는다 — 예보가 실황보다 낮아도 그대로 내보낸다.
 */
function temperatureRange(
  min: string | undefined,
  max: string | undefined,
): { min: string; max: string } | null {
  if (!min || !max) return null;
  if (!Number.isFinite(Number(min)) || !Number.isFinite(Number(max))) return null;
  return { min, max };
}

/** 빈 문자열·'-' 같은 결측을 0 으로 접지 않고 null 로 구분해 돌려준다. */
function parkedCount(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function Stat({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background/40 border-border/60 rounded-lg border p-3">
      <p className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {label}
      </p>
      {children}
    </div>
  );
}
