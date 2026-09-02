import { Platform } from 'react-native';

// 앱 잠금은 기기의 생체인증(지문/얼굴) 또는 기기 암호로 잠금을 해제한다.
// 웹/미지원 기기에서는 조용히 사용 불가로 처리해 기존 동작을 막지 않는다.

/** 이 기기에서 생체/기기 인증으로 앱 잠금을 쓸 수 있는지. 웹은 항상 false. */
export async function isAppLockAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const LA = await import('expo-local-authentication');
    const hasHardware = await LA.hasHardwareAsync();
    if (!hasHardware) return false;
    // 생체가 등록돼 있거나(지문/얼굴), 기기 암호(PIN/패턴)라도 설정돼 있으면 사용 가능하다.
    const enrolled = await LA.isEnrolledAsync();
    return enrolled;
  } catch {
    return false;
  }
}

/** 잠금 해제 인증을 띄운다. 성공하면 true. 생체 실패 시 기기 암호로 폴백된다. */
export async function authenticateAppLock(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const LA = await import('expo-local-authentication');
    const result = await LA.authenticateAsync({
      promptMessage: 'WorkProof 잠금 해제',
      cancelLabel: '취소',
      // 생체 실패/미등록 시 기기 암호(PIN)로 해제할 수 있게 폴백을 허용한다.
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}
