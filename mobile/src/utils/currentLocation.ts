import type { LatLng } from './geo';

export type LocationResult =
  | { status: 'ok'; coords: LatLng }
  | { status: 'denied' } // 위치 권한 거부
  | { status: 'unavailable' }; // 권한은 있으나 좌표를 못 얻음(웹 미지원/타임아웃 등)

/**
 * 현재 위치를 한 번 가져온다(출퇴근 실시간 기록용). 실패는 예외로 던지지 않고 상태로 돌려주며,
 * 호출부는 위치를 못 얻어도 출퇴근 기록 자체는 계속 진행해야 한다.
 * expo-location은 WorkplacePlacePicker에서 쓰는 것과 같은 v54(API 19) 패턴을 재사용한다.
 */
const LOCATION_TIMEOUT_MS = 6000;

export async function getCurrentLocation(): Promise<LocationResult> {
  try {
    const Location = await import('expo-location');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return { status: 'denied' };
    // 콜드 GPS는 수 초 이상 걸릴 수 있다. 출퇴근 기록이 무한정 대기하지 않도록 타임아웃과 경쟁시킨다.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS));
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeout,
    ]);
    if (!position) return { status: 'unavailable' };
    return {
      status: 'ok',
      coords: { latitude: position.coords.latitude, longitude: position.coords.longitude },
    };
  } catch {
    return { status: 'unavailable' };
  }
}
