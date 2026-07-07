import type { AuthDiscoveryDocument } from 'expo-auth-session';
import type { AuthProvider } from '../types';

export interface SocialProfile {
  provider: AuthProvider;
  providerId: string;
  email: string;
  name: string;
}

export interface ProviderConfig {
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  discovery: AuthDiscoveryDocument & { tokenEndpoint: string; userInfoEndpoint: string };
  mapProfile: (raw: Record<string, any>) => SocialProfile;
}

// Client IDs/secrets come from each provider's own developer console — see
// mobile/OAUTH_SETUP.md for the registration steps. Nothing here is a secret
// by itself; EXPO_PUBLIC_* vars are bundled into the client, same as any
// mobile app's OAuth client id.
//
// Expo's env inlining only rewrites literal `process.env.EXPO_PUBLIC_*`
// member expressions at build time — a dynamic `process.env[name]` lookup
// would silently stay undefined in a native build, so each var is read here
// as its own literal reference rather than through a shared helper.
const GOOGLE_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
const KAKAO_CLIENT_ID = (process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID ?? '').trim();
const KAKAO_CLIENT_SECRET = (process.env.EXPO_PUBLIC_KAKAO_CLIENT_SECRET ?? '').trim();
const NAVER_CLIENT_ID = (process.env.EXPO_PUBLIC_NAVER_CLIENT_ID ?? '').trim();
const NAVER_CLIENT_SECRET = (process.env.EXPO_PUBLIC_NAVER_CLIENT_SECRET ?? '').trim();

export function getProviderConfig(provider: 'google' | 'kakao' | 'naver'): ProviderConfig {
  switch (provider) {
    case 'google':
      return {
        clientId: GOOGLE_CLIENT_ID,
        scopes: ['openid', 'profile', 'email'],
        discovery: {
          authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenEndpoint: 'https://oauth2.googleapis.com/token',
          userInfoEndpoint: 'https://www.googleapis.com/oauth2/v3/userinfo',
        },
        mapProfile: (raw) => ({
          provider: 'google',
          providerId: String(raw.sub),
          email: raw.email ?? '',
          name: raw.name ?? raw.email ?? 'Google 사용자',
        }),
      };
    case 'kakao':
      return {
        clientId: KAKAO_CLIENT_ID,
        clientSecret: KAKAO_CLIENT_SECRET || undefined,
        scopes: ['account_email', 'profile_nickname'],
        discovery: {
          authorizationEndpoint: 'https://kauth.kakao.com/oauth/authorize',
          tokenEndpoint: 'https://kauth.kakao.com/oauth/token',
          userInfoEndpoint: 'https://kapi.kakao.com/v2/user/me',
        },
        mapProfile: (raw) => ({
          provider: 'kakao',
          providerId: String(raw.id),
          email: raw.kakao_account?.email ?? '',
          name: raw.kakao_account?.profile?.nickname ?? '카카오 사용자',
        }),
      };
    case 'naver':
      return {
        clientId: NAVER_CLIENT_ID,
        clientSecret: NAVER_CLIENT_SECRET || undefined,
        scopes: [],
        discovery: {
          authorizationEndpoint: 'https://nid.naver.com/oauth2.0/authorize',
          tokenEndpoint: 'https://nid.naver.com/oauth2.0/token',
          userInfoEndpoint: 'https://openapi.naver.com/v1/nid/me',
        },
        mapProfile: (raw) => ({
          provider: 'naver',
          providerId: String(raw.response?.id),
          email: raw.response?.email ?? '',
          name: raw.response?.name ?? '네이버 사용자',
        }),
      };
  }
}

export function isProviderConfigured(provider: 'google' | 'kakao' | 'naver'): boolean {
  return getProviderConfig(provider).clientId.length > 0;
}
