import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { SocialLoginResult } from './socialLogin';
import { classifySocialError, describeForLog } from './socialAuthErrors';

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

// Backend sessions expire after 10 minutes (SESSION_TTL_SECONDS in
// backend/app/services/auth/oauth_bridge.py); polling
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
      'mobile/docs/OAUTH_SETUP.md와 mobile/backend/README.md 안내를 참고하세요.',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createBridgeSession(
  provider: BridgeProvider,
  returnUrl: string
): Promise<CreateSessionResponse> {
  // return_url을 백엔드에 넘겨두면, provider 콜백 처리가 끝난 뒤 백엔드가 이
  // URL로 302 리디렉션한다. openAuthSessionAsync가 그 복귀 URL을 감지해 인증
  // 브라우저를 스스로 닫으므로, Render 성공 페이지가 정상 흐름에서 안 보인다.
  const res = await fetch(`${AUTH_API_URL}/auth/session/${provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ return_url: returnUrl }),
  });
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

function toSocialLoginResult(profile: BridgeProfile, sessionId: string): SocialLoginResult {
  return {
    status: 'success',
    profile: {
      provider: profile.provider,
      providerId: profile.providerUserId,
      email: profile.email ?? '',
      name: profile.name,
    },
    // 호출부가 /auth/bridge/exchange 로 실제 백엔드 인증 세션을 교환할 수 있게 넘긴다.
    bridgeSessionId: sessionId,
  };
}

// 인증 브라우저를 닫는 건 항상 베스트-에포트다 — 이미 복귀 URL을 감지해
// openAuthSessionAsync가 스스로 닫은 경우가 대부분이라 no-op이고, 닫기 실패가
// OAuth 성공을 실패로 뒤집으면 안 되므로 모든 예외를 삼킨다.
function dismissAuthBrowser(): void {
  try {
    WebBrowser.dismissAuthSession();
  } catch {
    // 일부 플랫폼엔 dismissAuthSession이 없다 — 무시한다.
  }
  WebBrowser.dismissBrowser().catch(() => {});
}

export async function loginWithProviderExpoGo(provider: BridgeProvider): Promise<SocialLoginResult> {
  if (!AUTH_API_URL) {
    return notConfiguredResult();
  }

  // 앱 복귀 URL. Expo Go에서는 실행 중인 tunnel/LAN 주소에 맞춘 exp(s):// URL을,
  // dev-client/독립 앱에서는 app.config.ts의 workproof:// 스킴을 런타임에 만든다
  // (예전 exp.direct 주소 하드코딩 금지). 백엔드는 이 스킴만 허용 목록으로 검증한다.
  const returnUrl = AuthSession.makeRedirectUri({ scheme: 'workproof', path: 'auth-complete' });

  let session: CreateSessionResponse;
  try {
    session = await createBridgeSession(provider, returnUrl);
  } catch (err) {
    return { status: 'error', code: (console.warn(describeForLog('provider', 'bridge', err)), classifySocialError(err)) };
  }
  const { session_id: sessionId, login_url: loginUrl } = session;

  // openAuthSessionAsync는 복귀 URL(returnUrl)로의 리디렉션을 감지하면 인증
  // 브라우저를 자동으로 닫고 { type: 'success' }로 resolve한다. 사용자가 직접
  // 브라우저를 닫으면 { type: 'cancel' | 'dismiss' }로 resolve한다. 다만 최종
  // 프로필/에러는 여전히 세션 폴링으로 받아온다(복귀 URL엔 민감정보를 싣지
  // 않으므로). 그래서 브라우저 세션과 폴링을 병행한다.
  // 복귀 URL 감지(type === 'success')가 아닌 방식으로 브라우저가 닫혔는지
  // 여부만 추적한다. 그런 종료는 "사용자가 직접 닫음 → 취소" 후보다. 최종
  // 성공/실패 판정은 아래 세션 폴링이 담당하므로 result 객체 자체는 보관하지
  // 않는다.
  let browserClosedWithoutRedirect = false;
  const authPromise = WebBrowser.openAuthSessionAsync(loginUrl, returnUrl)
    .then((result) => {
      if (result.type !== 'success') browserClosedWithoutRedirect = true;
    })
    .catch(() => {
      // 브라우저 열기/닫기 자체 실패 — 폴링 타임아웃까지는 결과를 기다려본다.
      browserClosedWithoutRedirect = true;
    });

  // 세션 정리·브라우저 닫기를 한 번만 수행하도록 감싼 종료 헬퍼.
  // 성공 결과는 sessionId를 그대로 호출부에 넘겨(bridgeSessionId) /auth/bridge/exchange
  // 로 교환해야 하므로, 여기서 먼저 지우면 그 교환이 "세션을 찾을 수 없음"으로 깨진다
  // (exchange가 서버에서 세션을 소비하므로, 그 후의 이 delete 호출은 404로 무해하게
  // 끝난다 — deleteBridgeSession 자체가 실패를 무시하는 best-effort라 문제 없음).
  // cancelled/error 는 교환할 게 없으니 즉시 정리해도 된다.
  let settled = false;
  const finish = (result: SocialLoginResult): SocialLoginResult => {
    if (settled) return result;
    settled = true;
    dismissAuthBrowser();
    if (result.status !== 'success') deleteBridgeSession(sessionId);
    return result;
  };
  // authPromise가 매달린 채로 끝나지 않도록 미리 참조만 걸어둔다(unhandled 방지).
  void authPromise;

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
        return finish(toSocialLoginResult(statusRes.profile, sessionId));
      }
      if (statusRes.status === 'error') {
        console.warn(describeForLog(provider, 'bridge-status', statusRes.message));
        return finish({ status: 'error', code: classifySocialError(statusRes.message) });
      }
      // 세션이 아직 pending인데 브라우저가 복귀 URL이 아닌 방식으로 닫혔다면
      // (사용자가 직접 닫음) 취소로 처리한다. 복귀 URL 감지로 닫힌 경우
      // (type === 'success')는 이 플래그가 서지 않으므로, 다음 폴링에서 결과가
      // 곧 채워진다.
      if (browserClosedWithoutRedirect) {
        return finish({ status: 'cancelled' });
      }
    }
  } catch (err) {
    return finish({ status: 'error', code: (console.warn(describeForLog('provider', 'bridge', err)), classifySocialError(err)) });
  }

  return finish({ status: 'error', code: 'TIMEOUT' });
}
