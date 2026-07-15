import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import type { SocialLoginResult } from './socialLogin';

// Expo Go can't register the app's custom URL scheme (workproof://) or load
// the Kakao/Naver native SDKs — so none of the flows in providers.ts,
// kakaoNative.ts, or naverNative.ts work inside Expo Go. This module is the
// Expo-Go-only fallback: a FastAPI backend (see /backend) runs the real
// OAuth code exchange server-side, and this file opens its login page in an
// in-app browser, then polls the backend for the result instead of relying
// on a redirect back into the app.
//
// `executionEnvironment` (ExecutionEnvironment.StoreClient) is NOT used for
// this check — it's also true for some non-Expo-Go cases, so it can't
// distinguish Expo Go from a dev/standalone client reliably. `expoGoConfig`
// is only ever populated when actually running inside Expo Go.
export function isExpoGo(): boolean {
  return Constants.expoGoConfig != null;
}

const AUTH_API_URL = (process.env.EXPO_PUBLIC_AUTH_API_URL ?? '').trim().replace(/\/+$/, '');

// Backend sessions expire after 10 minutes (see backend/main.py); polling
// stops a little before that so the app never waits on a session the server
// has already dropped.
const POLL_TIMEOUT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 1500;

type BridgeProvider = 'google' | 'kakao' | 'naver';

interface CreateSessionResponse {
  session_id: string;
  login_url: string;
}

interface BridgeProfile {
  provider: BridgeProvider;
  providerUserId: string;
  name: string;
  email: string | null;
}

type SessionStatusResponse =
  | { status: 'pending' }
  | { status: 'success'; profile: BridgeProfile }
  | { status: 'error'; message?: string };

function notConfiguredResult(): SocialLoginResult {
  return {
    status: 'not_configured',
    reason:
      'Expo Go 로그인용 백엔드 주소(EXPO_PUBLIC_AUTH_API_URL)가 설정되지 않았어요. ' +
      'mobile/OAUTH_SETUP.md와 backend/README.md 안내를 참고하세요.',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createBridgeSession(provider: BridgeProvider): Promise<CreateSessionResponse> {
  const res = await fetch(`${AUTH_API_URL}/auth/session/${provider}`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`로그인 세션을 만들지 못했어요. (${res.status})`);
  }
  return res.json();
}

async function fetchSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
  const res = await fetch(`${AUTH_API_URL}/auth/session/${sessionId}`);
  if (!res.ok) {
    throw new Error(`로그인 상태를 확인하지 못했어요. (${res.status})`);
  }
  return res.json();
}

function deleteBridgeSession(sessionId: string): void {
  // 세션 정리는 베스트-에포트다 — 실패해도 서버가 10분 뒤 자동 만료시킨다.
  fetch(`${AUTH_API_URL}/auth/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
}

function toSocialLoginResult(profile: BridgeProfile): SocialLoginResult {
  return {
    status: 'success',
    profile: {
      provider: profile.provider,
      providerId: profile.providerUserId,
      email: profile.email ?? '',
      name: profile.name,
    },
  };
}

export async function loginWithProviderExpoGo(provider: BridgeProvider): Promise<SocialLoginResult> {
  if (!AUTH_API_URL) {
    return notConfiguredResult();
  }

  let session: CreateSessionResponse;
  try {
    session = await createBridgeSession(provider);
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  const { session_id: sessionId, login_url: loginUrl } = session;

  // openBrowserAsync's resolved promise is only a reliable "user closed the
  // browser" signal on iOS ({ type: 'cancel' | 'dismiss' }) — on Android it
  // resolves immediately with { type: 'opened' } once the Custom Tab is
  // shown, not when it's closed, so browserClosed stays false there and the
  // poll loop below falls back to the overall timeout instead.
  let browserClosed = false;
  WebBrowser.openBrowserAsync(loginUrl)
    .then(() => {
      browserClosed = true;
    })
    .catch(() => {
      browserClosed = true;
    });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      let statusRes: SessionStatusResponse;
      try {
        statusRes = await fetchSessionStatus(sessionId);
      } catch {
        // 일시적 네트워크 오류는 무시하고 폴링을 계속한다.
        continue;
      }

      if (statusRes.status === 'success') {
        if (Platform.OS === 'ios') await WebBrowser.dismissBrowser().catch(() => {});
        deleteBridgeSession(sessionId);
        return toSocialLoginResult(statusRes.profile);
      }
      if (statusRes.status === 'error') {
        if (Platform.OS === 'ios') await WebBrowser.dismissBrowser().catch(() => {});
        deleteBridgeSession(sessionId);
        return { status: 'error', message: statusRes.message ?? '로그인에 실패했어요.' };
      }
      if (browserClosed) {
        deleteBridgeSession(sessionId);
        return { status: 'cancelled' };
      }
    }
  } catch (err) {
    deleteBridgeSession(sessionId);
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  if (Platform.OS === 'ios') await WebBrowser.dismissBrowser().catch(() => {});
  deleteBridgeSession(sessionId);
  return { status: 'error', message: '로그인 시간이 초과됐어요. 다시 시도해주세요.' };
}
