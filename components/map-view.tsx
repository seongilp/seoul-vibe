'use client';

import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { CONGESTION_COLORS, UNKNOWN_COLOR } from '@/lib/congestion';
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
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.62,
            ['boolean', ['feature-state', 'hover'], false],
            0.5,
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
          'line-opacity': 0.95,
        },
      });

      map.addLayer({
        id: 'area-label',
        type: 'symbol',
        source: AREA_SOURCE,
        layout: {
          'text-field': ['get', 'nm'],
          'text-size': 11,
          // CARTO 글리프 서버에 존재하는 스택이어야 한다. 한글은 NanumBarunGothic 이 받는다.
          'text-font': ['Open Sans Regular', 'NanumBarunGothic Regular'],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#e5e7eb',
          'text-halo-color': '#09090b',
          'text-halo-width': 1.4,
        },
        minzoom: 11.5,
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
        map.setFeatureState({ source: AREA_SOURCE, id: area.cd }, { rank: area.rank });
      });
    };

    if (loadedRef.current && map.getSource(AREA_SOURCE)) apply();
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
