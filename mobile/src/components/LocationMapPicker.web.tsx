import { useEffect, useRef } from 'react';
import { View } from 'react-native';

// Leaflet(OpenStreetMap)을 CDN에서 동적으로 불러온다. API 키가 필요 없고
// 웹/네이티브 모두에서 쓸 수 있어(react-native-webview로 네이티브 버전 구현),
// 이 프로젝트가 지금까지 소셜 로그인 SDK를 불러올 때 쓴 것과 같은 방식이다.
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

interface LeafletGlobal {
  map: (el: HTMLElement) => LeafletMap;
  tileLayer: (url: string, options: Record<string, unknown>) => { addTo: (map: LeafletMap) => void };
  marker: (
    latlng: [number, number],
    options?: Record<string, unknown>
  ) => LeafletMarker;
}

interface LeafletMap {
  setView: (latlng: [number, number], zoom?: number) => void;
  on: (event: string, handler: (e: { latlng: { lat: number; lng: number } }) => void) => void;
  remove: () => void;
}

interface LeafletMarker {
  addTo: (map: LeafletMap) => LeafletMarker;
  setLatLng: (latlng: [number, number]) => void;
  getLatLng: () => { lat: number; lng: number };
  on: (event: string, handler: () => void) => void;
}

declare global {
  interface Window {
    L?: LeafletGlobal;
  }
}

let leafletPromise: Promise<LeafletGlobal> | null = null;

function loadLeaflet(): Promise<LeafletGlobal> {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => (window.L ? resolve(window.L) : reject(new Error('지도를 불러오지 못했어요.')));
    script.onerror = () => reject(new Error('지도를 불러오지 못했어요.'));
    document.head.appendChild(script);
  });
  return leafletPromise;
}

interface Props {
  latitude: number;
  longitude: number;
  onSelect: (latitude: number, longitude: number) => void;
}

export default function LocationMapPicker({ latitude, longitude, onSelect }: Props) {
  const containerRef = useRef<View>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled) return;
      const node = containerRef.current as unknown as HTMLElement | null;
      if (!node) return;
      const map = L.map(node);
      map.setView([latitude, longitude], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      const marker = L.marker([latitude, longitude], { draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onSelectRef.current(pos.lat, pos.lng);
      });
      map.on('click', (e) => {
        marker.setLatLng([e.latlng.lat, e.latlng.lng]);
        onSelectRef.current(e.latlng.lat, e.latlng.lng);
      });
      mapRef.current = map;
      markerRef.current = marker;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // 최초 마운트 시 한 번만 지도를 만든다. 이후 좌표 변화는 아래 effect가 반영한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 외부에서 좌표가 바뀌면(예: "현재 위치로 이동" 버튼) 지도/마커를 그 위치로 옮긴다.
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    markerRef.current.setLatLng([latitude, longitude]);
    mapRef.current.setView([latitude, longitude]);
  }, [latitude, longitude]);

  return <View ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
