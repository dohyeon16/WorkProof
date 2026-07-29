// 근무지 좌표와 실제 출퇴근 위치 사이의 거리(=근무 증빙)를 계산하는 순수 유틸.
// 백엔드/외부 API 없이 하버사인 공식으로 두 좌표 사이 대략적 거리를 구한다.

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** 근무지 반경 인증 기준(m). 이 거리 이내면 '근무지에서 기록'으로 본다. GPS 오차를 감안해 넉넉히 잡는다. */
export const VERIFY_RADIUS_M = 200;

/** 두 좌표(위경도) 사이 거리(미터). 지구를 반지름 6371km 구로 근사한 하버사인 공식. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000; // m
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 사람이 읽기 좋은 거리 표기. 1km 미만은 m, 이상은 km로. */
export function formatDistance(meters: number): string {
  const m = Math.max(0, Math.round(meters));
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
}

/**
 * 근무지 좌표와 기록 위치로 반경 인증 여부/거리를 계산한다.
 * 둘 중 하나라도 좌표가 없으면 판정 불가(null)를 돌려준다 — 구버전 데이터/위치 미허용 안전 처리.
 */
export function evaluateProximity(
  workplace: Partial<LatLng>,
  recorded: Partial<LatLng> | undefined | null
): { distanceMeters: number; verified: boolean } | null {
  if (
    workplace.latitude == null ||
    workplace.longitude == null ||
    recorded?.latitude == null ||
    recorded?.longitude == null
  ) {
    return null;
  }
  const distanceMeters = haversineMeters(
    { latitude: workplace.latitude, longitude: workplace.longitude },
    { latitude: recorded.latitude, longitude: recorded.longitude }
  );
  return { distanceMeters, verified: distanceMeters <= VERIFY_RADIUS_M };
}
