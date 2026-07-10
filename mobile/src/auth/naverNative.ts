import { Platform } from 'react-native';
import NaverLogin from '@react-native-seoul/naver-login';
import type { SocialLoginResult } from './socialLogin';

// Android-only native Naver login via the official SDK wrapper. This exists
// separately from naverIdentityWeb.ts's browser-redirect flow (web only) —
// Naver's server auth flow requires a client_secret at token exchange, and
// the native SDK is built around embedding that secret directly in the app
// (NaverLogin.initialize({ consumerSecret, ... })), same as the official
// Naver Android SDK it wraps. Putting a secret in the client bundle is a
// deliberate, documented trade-off for this project (see OAUTH_SETUP.md's
// Naver section) — NOT the client-secret-free pattern used for Google/Kakao.
const NAVER_CLIENT_ID = (process.env.EXPO_PUBLIC_NAVER_CLIENT_ID ?? '').trim();
const NAVER_CLIENT_SECRET = (process.env.EXPO_PUBLIC_NAVER_CLIENT_SECRET ?? '').trim();
console.log('Naver Native configured:', Boolean(NAVER_CLIENT_ID && NAVER_CLIENT_SECRET));

const NOT_ANDROID_REASON = 'Naver 네이티브 로그인은 Android 전용이에요.';
const NOT_CONFIGURED_REASON =
  'Naver Android Client ID/Secret(EXPO_PUBLIC_NAVER_CLIENT_ID, EXPO_PUBLIC_NAVER_CLIENT_SECRET)이 ' +
  '설정되지 않았어요. 네이버 개발자센터에서 Android 플랫폼(패키지명 com.workproof.app + 다운로드 URL)을 ' +
  '등록한 뒤 값을 채워주세요. mobile/OAUTH_SETUP.md 안내를 참고하세요.';

let initialized = false;
function ensureInitialized(): void {
  if (initialized) return;
  NaverLogin.initialize({
    appName: 'WorkProof',
    consumerKey: NAVER_CLIENT_ID,
    consumerSecret: NAVER_CLIENT_SECRET,
    serviceUrlSchemeIOS: 'workproof',
  });
  initialized = true;
}

export async function loginWithNaverNative(): Promise<SocialLoginResult> {
  if (Platform.OS !== 'android') {
    return { status: 'not_configured', reason: NOT_ANDROID_REASON };
  }
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return { status: 'not_configured', reason: NOT_CONFIGURED_REASON };
  }

  try {
    ensureInitialized();
    const result = await NaverLogin.login();
    if (!result.isSuccess || !result.successResponse) {
      if (result.failureResponse?.isCancel) {
        return { status: 'cancelled' };
      }
      return {
        status: 'error',
        message: result.failureResponse?.message ?? '네이버 로그인에 실패했어요.',
      };
    }

    const profile = await NaverLogin.getProfile(result.successResponse.accessToken);
    if (profile.resultcode !== '00' || !profile.response?.id) {
      return { status: 'error', message: '사용자 정보를 가져오지 못했어요.' };
    }
    return {
      status: 'success',
      profile: {
        provider: 'naver',
        providerId: profile.response.id,
        email: profile.response.email ?? '',
        name: profile.response.name || profile.response.nickname || '네이버 사용자',
      },
    };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
