import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { getProviderConfig, isProviderConfigured, type SocialProfile } from './providers';
import { loginWithGoogleWeb } from './googleIdentityWeb';
import { loginWithKakaoNative } from './kakaoNative';
import { loginWithNaverNative } from './naverNative';
import { isExpoGo, loginWithProviderExpoGo } from './expoGoOAuth';
import { classifySocialError, describeForLog, type SocialAuthErrorCode } from './socialAuthErrors';
import {
  startNaverRedirect,
  type NaverRedirectMode,
  type NaverRedirectScreen,
} from './naverIdentityWeb';

// Required on web so the auth popup resolves promptAsync() instead of hanging.
WebBrowser.maybeCompleteAuthSession();

export type SocialLoginResult =
  | {
      status: 'success';
      profile: SocialProfile;
      // Expo Go 경로(server-verified OAuth 브릿지)에서만 채워진다. 있으면 호출부가
      // /auth/bridge/exchange 로 실제 백엔드 인증 세션을 얻을 수 있다(§AuthContext).
      // 네이티브 AuthSession/SDK 경로는 백엔드를 거치지 않아 이 값이 없다 —
      // 그 경로는 아직 서버측 provider credential 검증기가 없어(§social_verify.py)
      // 백엔드 세션 발급 대상이 아니다.
      bridgeSessionId?: string;
    }
  | { status: 'cancelled' }
  // `reason` is a specific, provider+platform-aware explanation shown
  // directly to the user (see LoginScreen/SignupScreen) — there is no shared
  // generic "API 키 미발급" message anymore, since the actual cause differs
  // per provider (missing env var vs. platform not implemented yet, etc).
  | { status: 'not_configured'; reason: string }
  // 원문(message) 대신 분류된 code 만 싣는다 — 화면은 socialErrorMessage() 로
  // 사용자 문장을 만들고, provider/OAuth 원문은 어디에도 표시하지 않는다.
  | { status: 'error'; code: SocialAuthErrorCode };

function notConfiguredReason(provider: 'google' | 'kakao'): string {
  if (provider === 'google' && Platform.OS === 'android') {
    return (
      'Google Android Client ID(EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID) 설정이 필요해요. ' +
      '패키지명(com.workproof.app)과 SHA-1 인증서 지문을 Google Cloud Console의 "Android" 클라이언트로 ' +
      '등록한 뒤 값을 채워주세요. mobile/docs/OAUTH_SETUP.md 안내를 참고하세요.'
    );
  }
  if (provider === 'google' && Platform.OS === 'ios') {
    return (
      'Google iOS Client ID(EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID) 설정이 필요해요. ' +
      'Bundle ID(com.workproof.app)를 Google Cloud Console의 "iOS" 클라이언트로 등록한 뒤 값을 ' +
      '채워주세요. mobile/docs/OAUTH_SETUP.md 안내를 참고하세요.'
    );
  }
  if (provider === 'kakao') {
    return 'Kakao Client ID(EXPO_PUBLIC_KAKAO_CLIENT_ID)가 설정되지 않았어요. mobile/docs/OAUTH_SETUP.md 안내를 참고하세요.';
  }
  return 'Google Client ID(EXPO_PUBLIC_GOOGLE_CLIENT_ID)가 설정되지 않았어요. mobile/docs/OAUTH_SETUP.md 안내를 참고하세요.';
}

async function loginWithProvider(provider: 'google' | 'kakao'): Promise<SocialLoginResult> {
  // Google's "Web application" client type requires a client secret at the
  // authorization-code token exchange even with PKCE, which can't live in a
  // client bundle safely. On web we sidestep that entirely by using Google
  // Identity Services' ID Token flow instead (see googleIdentityWeb.ts).
  // Native builds keep the code+PKCE flow below, which works with a genuinely
  // public iOS/Android client type.
  if (provider === 'google' && Platform.OS === 'web') {
    return loginWithGoogleWeb();
  }

  // Expo Go can't use custom URL schemes or the Kakao/Naver native modules
  // at all, so every non-web provider routes through the FastAPI OAuth
  // bridge (expoGoOAuth.ts) instead of the AuthSession/native-SDK flows
  // below. This must be checked before the Kakao-native branch — Expo Go
  // would otherwise hit the native SDK, which isn't linked in Expo Go and
  // throws immediately.
  if (Platform.OS !== 'web' && isExpoGo()) {
    return loginWithProviderExpoGo(provider);
  }

  // Kakao on native builds (Android and iOS) uses the native SDK
  // (src/auth/kakaoNative.ts) instead of this browser-based AuthSession flow
  // — it opens the Kakao app/native login sheet directly and needs its own
  // Native App Key. The iOS web-redirect PKCE flow used to hit KOE006
  // because Kakao's REST API flow doesn't recognize a bare custom-scheme
  // redirect from a non-registered "iOS" platform — the native SDK sidesteps
  // that entirely. Only web keeps the REST-API-key + PKCE flow below.
  if (provider === 'kakao' && Platform.OS !== 'web') {
    return loginWithKakaoNative();
  }

  if (!isProviderConfigured(provider)) {
    return { status: 'not_configured', reason: notConfiguredReason(provider) };
  }

  const config = getProviderConfig(provider);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'workproof' });

  try {
    const request = new AuthSession.AuthRequest({
      clientId: config.clientId,
      scopes: config.scopes,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      // Kakao skips its own login screen and returns a code instantly when the
      // browser already has a kakao.com session + prior consent — looks like
      // the flow "did nothing" compared to Google's account picker. Forcing
      // prompt=login makes Kakao always show its login screen again.
      extraParams: provider === 'kakao' ? { prompt: 'login' } : undefined,
    });

    const result = await request.promptAsync(config.discovery);
    if (result.type === 'error') {
      console.warn(describeForLog(provider, 'authorize', result.error));
      return { status: 'error', code: classifySocialError(result.error) };
    }
    if (result.type !== 'success') {
      return { status: 'cancelled' };
    }

    const tokenResponse = await AuthSession.exchangeCodeAsync(
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code: result.params.code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier ?? '' },
      },
      config.discovery
    );

    const rawProfile = await AuthSession.fetchUserInfoAsync(
      { accessToken: tokenResponse.accessToken },
      config.discovery
    );

    const profile = config.mapProfile(rawProfile);
    if (!profile.providerId) {
      console.warn(describeForLog(provider, 'profile', 'empty providerId'));
      return { status: 'error', code: 'UNKNOWN' };
    }
    return { status: 'success', profile };
  } catch (err) {
    console.warn(describeForLog(provider, 'token-exchange', err));
    return { status: 'error', code: classifySocialError(err) };
  }
}

export const loginWithGoogle = () => loginWithProvider('google');
export const loginWithKakao = () => loginWithProvider('kakao');

// Naver has no entry in SOCIAL_LOGIN below: web is a full-page redirect flow,
// not a Promise that resolves in the same page load (see naverIdentityWeb.ts).
// This function is the single place that decides how Naver login runs per
// platform — it replaces the old hardcoded "Platform.OS !== 'web' ⇒
// not_configured" block that used to live inside naverIdentityWeb.ts.
// Android and iOS both use the official native SDK
// (src/auth/naverNative.ts) — its `serviceUrlSchemeIOS` init option is
// already wired to the shared `workproof` scheme for iOS.
export async function loginWithNaver(
  mode: NaverRedirectMode,
  screen: NaverRedirectScreen
): Promise<SocialLoginResult> {
  if (Platform.OS === 'web') {
    return startNaverRedirect(mode, screen);
  }
  // See the Expo Go branch in loginWithProvider() above — same reasoning
  // applies here, Naver's native SDK isn't linked in Expo Go either.
  if (isExpoGo()) {
    return loginWithProviderExpoGo('naver');
  }
  return loginWithNaverNative();
}

export const SOCIAL_LOGIN = {
  google: loginWithGoogle,
  kakao: loginWithKakao,
} as const;

export const SOCIAL_LABEL: Record<'google' | 'kakao' | 'naver', string> = {
  google: 'Google',
  kakao: '카카오',
  naver: '네이버',
};
