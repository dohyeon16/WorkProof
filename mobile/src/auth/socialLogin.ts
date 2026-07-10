import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { getProviderConfig, isProviderConfigured, type SocialProfile } from './providers';
import { loginWithGoogleWeb } from './googleIdentityWeb';
import { loginWithKakaoNative } from './kakaoNative';
import { loginWithNaverNative } from './naverNative';
import {
  startNaverRedirect,
  type NaverRedirectMode,
  type NaverRedirectScreen,
} from './naverIdentityWeb';

// Required on web so the auth popup resolves promptAsync() instead of hanging.
WebBrowser.maybeCompleteAuthSession();

export type SocialLoginResult =
  | { status: 'success'; profile: SocialProfile }
  | { status: 'cancelled' }
  // `reason` is a specific, provider+platform-aware explanation shown
  // directly to the user (see LoginScreen/SignupScreen) — there is no shared
  // generic "API 키 미발급" message anymore, since the actual cause differs
  // per provider (missing env var vs. platform not implemented yet, etc).
  | { status: 'not_configured'; reason: string }
  | { status: 'error'; message: string };

function notConfiguredReason(provider: 'google' | 'kakao'): string {
  if (provider === 'google' && Platform.OS === 'android') {
    return (
      'Google Android Client ID(EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID) 설정이 필요해요. ' +
      '패키지명(com.workproof.app)과 SHA-1 인증서 지문을 Google Cloud Console의 "Android" 클라이언트로 ' +
      '등록한 뒤 값을 채워주세요. mobile/OAUTH_SETUP.md 안내를 참고하세요.'
    );
  }
  if (provider === 'kakao') {
    return 'Kakao Client ID(EXPO_PUBLIC_KAKAO_CLIENT_ID)가 설정되지 않았어요. mobile/OAUTH_SETUP.md 안내를 참고하세요.';
  }
  return 'Google Client ID(EXPO_PUBLIC_GOOGLE_CLIENT_ID)가 설정되지 않았어요. mobile/OAUTH_SETUP.md 안내를 참고하세요.';
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

  // Kakao on Android uses the native SDK (src/auth/kakaoNative.ts) instead of
  // this browser-based AuthSession flow — it opens the Kakao app/native login
  // sheet directly and needs its own Native App Key. Web and iOS keep the
  // REST-API-key + PKCE flow below.
  if (provider === 'kakao' && Platform.OS === 'android') {
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
      return { status: 'error', message: result.error?.message ?? '알 수 없는 오류' };
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
      return { status: 'error', message: '사용자 정보를 가져오지 못했어요.' };
    }
    return { status: 'success', profile };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export const loginWithGoogle = () => loginWithProvider('google');
export const loginWithKakao = () => loginWithProvider('kakao');

// Naver has no entry in SOCIAL_LOGIN below: web is a full-page redirect flow,
// not a Promise that resolves in the same page load (see naverIdentityWeb.ts).
// This function is the single place that decides how Naver login runs per
// platform — it replaces the old hardcoded "Platform.OS !== 'web' ⇒
// not_configured" block that used to live inside naverIdentityWeb.ts.
export async function loginWithNaver(
  mode: NaverRedirectMode,
  screen: NaverRedirectScreen
): Promise<SocialLoginResult> {
  if (Platform.OS === 'web') {
    return startNaverRedirect(mode, screen);
  }
  if (Platform.OS === 'android') {
    return loginWithNaverNative();
  }
  return {
    status: 'not_configured',
    reason: 'iOS 네이버 로그인은 아직 지원하지 않아요.',
  };
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
