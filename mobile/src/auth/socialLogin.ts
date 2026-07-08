import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { getProviderConfig, isProviderConfigured, type SocialProfile } from './providers';
import { loginWithGoogleWeb } from './googleIdentityWeb';
import { loginWithNaverWeb } from './naverIdentityWeb';

// Required on web so the auth popup resolves promptAsync() instead of hanging.
WebBrowser.maybeCompleteAuthSession();

export type SocialLoginResult =
  | { status: 'success'; profile: SocialProfile }
  | { status: 'cancelled' }
  | { status: 'not_configured' }
  | { status: 'error'; message: string };

async function loginWithProvider(provider: 'google' | 'kakao' | 'naver'): Promise<SocialLoginResult> {
  // Google's "Web application" client type requires a client secret at the
  // authorization-code token exchange even with PKCE, which can't live in a
  // client bundle safely. On web we sidestep that entirely by using Google
  // Identity Services' ID Token flow instead (see googleIdentityWeb.ts).
  // Native builds keep the code+PKCE flow below, which works with a genuinely
  // public iOS/Android client type.
  if (provider === 'google' && Platform.OS === 'web') {
    return loginWithGoogleWeb();
  }

  // Naver is web-only for now: it uses the official client-side Naver Login
  // JS SDK (no client secret) instead of the code+PKCE exchange below, and
  // that SDK only runs in a browser. Native builds show "준비 중" instead.
  if (provider === 'naver') {
    if (Platform.OS !== 'web') {
      return { status: 'not_configured' };
    }
    return loginWithNaverWeb();
  }

  if (!isProviderConfigured(provider)) {
    return { status: 'not_configured' };
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
export const loginWithNaver = () => loginWithProvider('naver');

export const SOCIAL_LOGIN = {
  google: loginWithGoogle,
  kakao: loginWithKakao,
  naver: loginWithNaver,
} as const;

export const SOCIAL_LABEL: Record<'google' | 'kakao' | 'naver', string> = {
  google: 'Google',
  kakao: '카카오',
  naver: '네이버',
};
