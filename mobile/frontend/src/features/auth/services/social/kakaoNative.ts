import { Platform } from 'react-native';
import { login, getProfile } from '@react-native-seoul/kakao-login';
import type { SocialLoginResult } from './socialLogin';
import { classifySocialError, describeForLog } from './socialAuthErrors';

// Native-build-only (Android + iOS) Kakao login. This is deliberately
// separate from the browser-based AuthSession/PKCE flow in socialLogin.ts
// (which now only handles web) — Kakao's native SDK opens the Kakao
// app/native login sheet directly instead of a browser redirect, and needs
// its own "Native App Key" (EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY), baked into
// the native build at prebuild time via the @react-native-seoul/kakao-login
// config plugin in app.config.ts — see mobile/docs/OAUTH_SETUP.md. The same key/plugin
// config is shared by both platforms: on iOS it becomes the Info.plist
// KAKAO_APP_KEY plus the kakao{KEY}://oauth URL scheme; on Android it's
// baked into AndroidManifest/strings.xml.
//
// The plugin bakes the key into the native project; this env var is only
// read here (at runtime) to decide whether to attempt login at all, so a
// missing key surfaces as a specific reason instead of a native crash.
const KAKAO_NATIVE_APP_KEY = (process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY ?? '').trim();
console.log('Kakao Native configured:', Boolean(process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY));

const NOT_NATIVE_REASON = 'Kakao 네이티브 로그인은 iOS/Android 앱에서만 지원돼요.';
const NOT_CONFIGURED_REASON =
  'Kakao Native App Key(EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY)가 설정되지 않았어요. ' +
  '카카오 콘솔에 패키지명/Bundle ID(com.workproof.app)와 키 해시(Android)를 등록한 뒤 발급받은 ' +
  'Native App Key를 채워주세요. mobile/docs/OAUTH_SETUP.md 안내를 참고하세요.';

export async function loginWithKakaoNative(): Promise<SocialLoginResult> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return { status: 'not_configured', reason: NOT_NATIVE_REASON };
  }
  if (!KAKAO_NATIVE_APP_KEY) {
    return { status: 'not_configured', reason: NOT_CONFIGURED_REASON };
  }

  try {
    await login();
    const profile = await getProfile();
    if (!profile.id) {
      return { status: 'error', code: 'UNKNOWN' };
    }
    return {
      status: 'success',
      profile: {
        provider: 'kakao',
        providerId: String(profile.id),
        email: profile.email ?? '',
        name: profile.nickname || profile.name || '카카오 사용자',
      },
    };
  } catch (err) {
    // The native SDK rejects the promise (rather than resolving with a
    // "cancelled" result) when the user dismisses the login sheet, with a
    // `code` of "E_CANCELLED_OPERATION" (shared across iOS/Android — see the
    // package's documented RNKakaoLoginErrorCode list).
    const code = (err as { code?: string } | null)?.code;
    if (code === 'E_CANCELLED_OPERATION') {
      return { status: 'cancelled' };
    }
    return { status: 'error', code: (console.warn(describeForLog('kakao', 'kakao-native', err)), classifySocialError(err)) };
  }
}
