'use client';

import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { CONGESTION_COLORS, UNKNOWN_COLOR, formatPeople } from '@/lib/congestion';
import type { AreaCongestion, BikeStation } from '@/lib/types';

import 'maplibre-gl/dist/maplibre-gl.css';

/** 키가 필요 없는 다크 베이스맵. */
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
/** 서울시 행정구역을 감싸는 대략적 경계. 화면 크기에 맞춰 줌을 자동 결정한다. */
const SEOUL_BOUNDS: [[number, number], [number, number]] = [
  [126.76, 37.42],
  [127.19, 37.7],
];

const AREA_SOURCE = 'areas';
const BIKE_SOURCE = 'bikes';
/*
  인구 라벨 전용 포인트 소스.
  text-field 는 layout 속성이라 feature-state 를 못 읽는다. 폴리곤 소스(fill/outline)는
  feature-state 로 혼잡도를 칠하지만, 라벨에 사람 수를 얹으려면 값이 properties 에 있어야 한다.
  그래서 areas 의 중심 좌표로 별도 포인트 소스를 만들어 데이터가 갱신될 때마다 setData 로 갈아끼운다.
*/
const LABEL_SOURCE = 'area-labels';

/*
  라벨 텍스트: 장소명(작게·연회색) + 줄바꿈 + 사람 수(크게·흰색).
  미상인 곳은 people='' 로 내려오므로 줄바꿈째 생략해 이름만 한 줄로 보인다(없는 숫자를 만들지 않는다).
  format 의 각 구간 색은 흰↔검은 헤일로 대비라 WCAG 4.5:1 을 크게 웃돈다(흰↔#09090b ≈ 19:1).
*/
const LABEL_FIELD = [
  'format',
  ['get', 'nm'],
  { 'font-scale': 0.8, 'text-color': '#e2e8f0' },
  ['case', ['==', ['get', 'people'], ''], '', '\n'],
  {},
  ['get', 'people'],
  { 'font-scale': 1.15, 'text-color': '#ffffff' },
] as unknown as maplibregl.ExpressionSpecification;

interface MapViewProps {
  areas: AreaCongestion[];
  bikes: BikeStation[];
  showBikes: boolean;
  selectedCd: string | null;
  onSelect: (cd: string) => void;
  /**
   * 지도 하단에서 다른 UI(바텀시트)가 가리는 비율(0..1).
   * 첫 fitBounds 때만 쓴다 — 시트를 드래그할 때마다 지도가 움직이면 멀미가 난다.
   */
  bottomInsetRatio?: number;
}

/** rank(-1..3) → 색상 을 maplibre 표현식으로. feature-state 가 없으면 미상 색. */
const FILL_COLOR = [
  'match',
  ['coalesce', ['feature-state', 'rank'], -1],
  0,
  CONGESTION_COLORS[0],
  1,
  CONGESTION_COLORS[1],
  2,
  CONGESTION_COLORS[2],
  3,
  CONGESTION_COLORS[3],
  UNKNOWN_COLOR,
] as unknown as maplibregl.ExpressionSpecification;

export function MapView({ areas, bikes, showBikes, selectedCd, onSelect, bottomInsetRatio = 0 }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const fittedRef = useRef(false);
  // 지도 이벤트 핸들러는 한 번만 등록되므로 stale closure 를 잡지 않도록 ref 로 우회한다.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const bottomInsetRef = useRef(bottomInsetRatio);
  useEffect(() => {
    bottomInsetRef.current = bottomInsetRatio;
  }, [bottomInsetRatio]);

  /* 지도 생성: 한 번만. */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: SEOUL_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      minZoom: 9,
      maxZoom: 17,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');

    map.on('load', () => {
      map.addSource(AREA_SOURCE, {
        type: 'geojson',
        data: '/areas.geojson',
        // setFeatureState 로 혼잡도를 갱신하려면 안정적인 feature id 가 필요하다.
        promoteId: 'cd',
      });

      map.addLayer({
        id: 'area-fill',
        type: 'fill',
        source: AREA_SOURCE,
        paint: {
          'fill-color': FILL_COLOR,
          /*
            stale(마지막 성공값으로 메운 장소)은 흐리게 칠해 신선한 곳과 구분한다.
            지도 위에는 텍스트를 얹을 수단이 없어(text-field 는 feature-state 를 못 읽는다)
            여기서는 명도 차이가 전부다. 문장으로 밝히는 건 헤더 배너·목록·상세가 담당한다.
          */
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.62,
            ['boolean', ['feature-state', 'hover'], false],
            0.5,
            ['boolean', ['feature-state', 'stale'], false],
            0.12,
            0.32,
          ],
        },
      });

      map.addLayer({
        id: 'area-outline',
        type: 'line',
        source: AREA_SOURCE,
        paint: {
          'line-color': FILL_COLOR,
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            2.6,
            ['boolean', ['feature-state', 'hover'], false],
            1.8,
            1.2,
          ],
          'line-opacity': ['case', ['boolean', ['feature-state', 'stale'], false], 0.4, 0.95],
        },
      });

      // 라벨은 areas 가 오기 전엔 비어 있다가 아래 effect 가 setData 로 채운다.
      map.addSource(LABEL_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'area-label',
        type: 'symbol',
        source: LABEL_SOURCE,
        layout: {
          'text-field': LABEL_FIELD,
          // 멀리서는 작게, 가까이서 크게. 한 표현식에 zoom interpolate 는 딱 한 번만(이중 쓰면 레이어가 통째로 거부됨).
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 12, 16, 14],
          // CARTO 글리프 서버에 존재하는 스택이어야 한다. 한글은 NanumBarunGothic 이 받는다.
          'text-font': ['Open Sans Regular', 'NanumBarunGothic Regular'],
          'text-line-height': 1.05,
          'text-max-width': 7,
          // 121곳이 다 뜨면 못 읽는다. 겹치면 자동으로 감추되(allow-overlap:false),
          // 사람 많은 곳부터 살아남게 정렬 키를 음수 인구로 준다(값이 작을수록 먼저 그려져 충돌에서 이김).
          'text-allow-overlap': false,
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'pop'], 0]],
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#09090b',
          'text-halo-width': 1.8,
          'text-halo-blur': 0.3,
          // stale(과거값)인 곳은 라벨도 흐리게 — 폴리곤 명도 저하와 같은 신호. 문구는 목록·상세가 담당한다.
          'text-opacity': ['case', ['boolean', ['get', 'stale'], false], 0.55, 1],
        },
      });

      map.addSource(BIKE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'bike-dot',
        type: 'circle',
        source: BIKE_SOURCE,
        layout: { visibility: 'none' },
        paint: {
          // 거치대 대비 잔여 비율로 크기를, 잔여 대수로 색을 준다.
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 13, 3.2, 16, 7],
          'circle-color': [
            'step',
            ['get', 'parked'],
            '#ef4444', // 0대: 빌 자전거 없음
            1,
            '#f59e0b',
            4,
            '#3182f6',
            12,
            '#22d3ee',
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 0.4,
          'circle-stroke-color': '#0b0b0f',
        },
      });

      loadedRef.current = true;
      map.getCanvas().style.cursor = '';
    });

    /*
     * 컨테이너가 0x0 인 상태에서 맵이 생성되면 생성자의 bounds 가 엉뚱한 줌으로 굳는다.
     * maplibre 내부 resize 는 줌을 유지한 채 화면만 넓히므로 스스로 회복되지 않는다.
     * 컨테이너가 처음으로 실제 크기를 가질 때 딱 한 번 다시 맞춘다.
     */
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 1 || box.height < 1 || fittedRef.current) return;
      fittedRef.current = true;
      map.resize();
      /*
        바텀시트가 아래를 덮으므로 그만큼 패딩을 준다. 안 주면 서울이 컨테이너
        전체 기준으로 가운데 정렬돼서 시트 뒤로 절반쯤 숨는다. 줌은 세로로 긴
        화면에서 어차피 가로 폭이 결정하므로 이 패딩으로 바뀌지 않는다.
      */
      map.fitBounds(SEOUL_BOUNDS, {
        padding: {
          top: 24,
          left: 24,
          right: 24,
          bottom: 24 + box.height * bottomInsetRef.current,
        },
        duration: 0,
      });
    });
    observer.observe(containerRef.current);

    let hovered: string | null = null;
    const setHover = (cd: string | null) => {
      if (hovered === cd) return;
      if (hovered) map.setFeatureState({ source: AREA_SOURCE, id: hovered }, { hover: false });
      hovered = cd;
      if (hovered) map.setFeatureState({ source: AREA_SOURCE, id: hovered }, { hover: true });
    };

    map.on('mousemove', 'area-fill', (event) => {
      const cd = event.features?.[0]?.properties?.cd as string | undefined;
      map.getCanvas().style.cursor = 'pointer';
      setHover(cd ?? null);
    });
    map.on('mouseleave', 'area-fill', () => {
      map.getCanvas().style.cursor = '';
      setHover(null);
    });
    map.on('click', 'area-fill', (event) => {
      const cd = event.features?.[0]?.properties?.cd as string | undefined;
      if (cd) onSelectRef.current(cd);
    });

    const bikePopup = new maplibregl.Popup({ closeButton: false, offset: 8, className: 'text-xs' });
    map.on('mouseenter', 'bike-dot', (event) => {
      const props = event.features?.[0]?.properties as { name?: string; parked?: number; racks?: number } | undefined;
      if (!props) return;
      map.getCanvas().style.cursor = 'pointer';
      bikePopup
        .setLngLat(event.lngLat)
        .setHTML(
          `<div style="color:#111">${props.name ?? ''}<br/><b>${props.parked ?? 0}대</b> / 거치대 ${props.racks ?? 0}</div>`,
        )
        .addTo(map);
    });
    map.on('mouseleave', 'bike-dot', () => {
      map.getCanvas().style.cursor = '';
      bikePopup.remove();
    });

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
      fittedRef.current = false;
    };
  }, []);

  /* 혼잡도 → feature-state */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || areas.length === 0) return;

    const apply = () => {
      areas.forEach((area) => {
        map.setFeatureState({ source: AREA_SOURCE, id: area.cd }, { rank: area.rank, stale: area.stale });
      });
    };

    if (loadedRef.current && map.getSource(AREA_SOURCE)) apply();
    else map.once('idle', apply);
  }, [areas]);

  /*
    인구 라벨 소스 갱신.
    feature-state 로는 text-field 를 못 채우므로, 사람 수를 properties 에 담은 포인트를 매 갱신마다 새로 그린다.
    people 은 목록과 똑같이 formatPeople(area.max) 로 굳혀 형식을 일치시킨다(미상이면 max=null → '' 로 이름만).
  */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || areas.length === 0) return;

    const apply = () => {
      const source = map.getSource(LABEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData({
        type: 'FeatureCollection',
        features: areas.map((area) => {
          const known = area.rank >= 0 && area.max !== null;
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [area.lon, area.lat] },
            properties: {
              nm: area.nm,
              // 미상은 사람 수 문구를 아예 비운다 — 없는 숫자를 지도에 쓰지 않는다.
              people: known ? formatPeople(area.max) : '',
              // 충돌 정렬용: 사람 많은 곳 우선. 미상(0)은 자리가 남을 때만.
              pop: known ? area.max : 0,
              stale: area.stale,
            },
          };
        }),
      });
    };

    if (loadedRef.current && map.getSource(LABEL_SOURCE)) apply();
    else map.once('idle', apply);
  }, [areas]);

  /* 선택 상태 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      // maplibre v5 의 removeFeatureState 는 id 없이 속성만 지울 수 없다.
      // 직전 선택을 직접 기억해 뒀다가 해제한다.
      const previous = selectedRef.current;
      if (previous && previous !== selectedCd) {
        map.setFeatureState({ source: AREA_SOURCE, id: previous }, { selected: false });
      }
      selectedRef.current = selectedCd;
      if (selectedCd) {
        map.setFeatureState({ source: AREA_SOURCE, id: selectedCd }, { selected: true });
      }
    };

    if (loadedRef.current && map.getSource(AREA_SOURCE)) apply();
    else map.once('idle', apply);
  }, [selectedCd]);

  /* 따릉이 레이어 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource(BIKE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData({
        type: 'FeatureCollection',
        features: bikes.map((station) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [station.lon, station.lat] },
          properties: { name: station.name, parked: station.parked, racks: station.racks },
        })),
      });
      if (map.getLayer('bike-dot')) {
        map.setLayoutProperty('bike-dot', 'visibility', showBikes ? 'visible' : 'none');
      }
    };

    if (loadedRef.current) apply();
    else map.once('idle', apply);
  }, [bikes, showBikes]);

  // maplibre-gl.css 가 .maplibregl-map 에 position:relative 를 걸어 Tailwind 의
  // absolute inset-0 을 덮어쓴다. 높이는 크기 유틸리티로 직접 준다.
  return <div ref={containerRef} className="size-full" />;
}
