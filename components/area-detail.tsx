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
  const parkingAvailable = parking.reduce((sum, lot) => sum + (Number(lot.CUR_PRK_CNT) || 0), 0);
  const parkingCapacity = parking.reduce((sum, lot) => sum + (Number(lot.CPCTY) || 0), 0);

  return (
    <aside className="bg-card border-border flex h-full w-full flex-col border-l">
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
          className="hover:bg-accent text-muted-foreground rounded-md p-1"
        >
          <X className="size-4" />
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
                <span className="text-lg font-bold">{weather.TEMP}°</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  최고 {weather.MAX_TEMP}° · 최저 {weather.MIN_TEMP}° · 습도 {weather.HUMIDITY}% · 바람{' '}
                  {weather.WIND_SPD}m/s
                </span>
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
                <span className="text-lg font-bold">{parkingAvailable}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  면 주차 가능 · 총 {parkingCapacity}면 · 주차장 {parking.length}곳
                </span>
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
