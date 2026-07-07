import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { getProviderConfig, isProviderConfigured, type SocialProfile } from './providers';

// Required on web so the auth popup resolves promptAsync() instead of hanging.
WebBrowser.maybeCompleteAuthSession();

export type SocialLoginResult =
  | { status: 'success'; profile: SocialProfile }
  | { status: 'cancelled' }
  | { status: 'not_configured' }
  | { status: 'error'; message: string };

async function loginWithProvider(provider: 'google' | 'kakao' | 'naver'): Promise<SocialLoginResult> {
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
