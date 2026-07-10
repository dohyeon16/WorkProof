import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  latitude: number;
  longitude: number;
  onSelect: (latitude: number, longitude: number) => void;
}

function buildHtml(latitude: number, longitude: number): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>html, body, #map { height: 100%; margin: 0; padding: 0; }</style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      var map = L.map('map').setView([${latitude}, ${longitude}], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      var marker = L.marker([${latitude}, ${longitude}], { draggable: true }).addTo(map);
      function notify(lat, lng) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ lat: lat, lng: lng }));
      }
      marker.on('dragend', function () {
        var pos = marker.getLatLng();
        notify(pos.lat, pos.lng);
      });
      map.on('click', function (e) {
        marker.setLatLng(e.latlng);
        notify(e.latlng.lat, e.latlng.lng);
      });
      window.__setLocation = function (lat, lng) {
        marker.setLatLng([lat, lng]);
        map.setView([lat, lng]);
      };
    </script>
  </body>
</html>`;
}

export default function LocationMapPicker({ latitude, longitude, onSelect }: Props) {
  const webviewRef = useRef<WebView>(null);
  // 최초 HTML은 한 번만 만든다 — 이후 좌표 변화는 injectJavaScript로 반영한다.
  // (매 렌더링마다 새 HTML을 만들면 WebView가 계속 새로고침되어 조작 중인
  // 지도가 리셋된다.)
  const initialHtml = useRef(buildHtml(latitude, longitude)).current;
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    webviewRef.current?.injectJavaScript(
      `window.__setLocation && window.__setLocation(${latitude}, ${longitude}); true;`
    );
  }, [latitude, longitude]);

  return (
    <WebView
      ref={webviewRef}
      originWhitelist={['*']}
      source={{ html: initialHtml }}
      onMessage={(event) => {
        try {
          const data = JSON.parse(event.nativeEvent.data) as { lat?: number; lng?: number };
          if (typeof data.lat === 'number' && typeof data.lng === 'number') {
            onSelect(data.lat, data.lng);
          }
        } catch {
          // 지도에서 보내는 값이 아니면 무시한다.
        }
      }}
      style={styles.webview}
    />
  );
}

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: 'transparent' },
});
