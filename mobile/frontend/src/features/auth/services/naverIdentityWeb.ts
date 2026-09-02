import { Platform } from 'react-native';
import type { SocialLoginResult } from './socialLogin';

// 네이버 아이디로 로그인 JavaScript SDK — client secret 없이 브라우저에서 바로 로그인.
//
// 카카오/구글과 달리 네이버는 전체 페이지 리다이렉트 방식을 쓴다: 버튼을 누르면
// 이 탭 전체가 네이버 인증 화면으로 이동했다가, 인증이 끝나면 다시 이 앱의
// origin으로 돌아온다(팝업이 아니라 실제 페이지 이동이라 리액트 앱 자체가
// 완전히 재부팅된다). 그래서 "로그인/회원가입 중이었다"는 사실과 돌아갈
// 화면을 sessionStorage에 남겨두고(startNaverRedirect), 복귀 후 그 값을 읽어
// 이어서 처리한다(resumeNaverRedirectIfPending, App.tsx에서 호출).
//
// 매번 인증 화면을 다시 띄우기 위해 일반 로그인 버튼 대신 SDK의 reprompt()를
// 쓴다. reprompt()는 로컬 로그인 상태를 지우고 `auth_type=reprompt`를 붙여
// 인가 URL로 리다이렉트하므로, 브라우저에 이미 네이버 세션/동의 기록이 있어도
// 매번 인증 화면을 다시 보여준다(카카오의 prompt=login과 동일한 목적).
const NAVER_CLIENT_ID = (process.env.EXPO_PUBLIC_NAVER_CLIENT_ID ?? '').trim();
console.log('Naver configured:', Boolean(process.env.EXPO_PUBLIC_NAVER_CLIENT_ID));
const NAVER_SDK_SRC = 'https://static.nid.naver.com/js/naveridlogin_js_sdk_2.0.0.js';
const CONTAINER_ID = 'naverIdLogin';
const PENDING_KEY = 'workproof_naver_pending';
const PENDING_TTL_MS = 10 * 60 * 1000;

export type NaverRedirectMode = 'login' | 'signup';
export type NaverRedirectScreen = 'Login' | 'Signup';

interface NaverPendingState {
  mode: NaverRedirectMode;
  screen: NaverRedirectScreen;
  // 앱 자체적으로 붙이는 상관관계용 값일 뿐, 네이버로 보내는 실제 OAuth
  // state 파라미터가 아니다 — 그건 SDK가 내부적으로 생성/검증한다(외부에서
  // 주입할 수 있는 옵션이 없음). 여기서는 오래된 sessionStorage 항목을
  // 만료시키는 용도로만 createdAt과 함께 쓰인다.
  state: string;
  createdAt: number;
}

export interface NaverRedirectResume {
  mode: NaverRedirectMode;
  screen: NaverRedirectScreen;
  result: SocialLoginResult;
}

interface NaverUser {
  getId?: () => string;
  getEmail?: () => string;
  getName?: () => string;
  getNickName?: () => string;
  id?: string;
  email?: string;
  name?: string;
}

interface NaverLoginInstance {
  init(): void;
  getLoginStatus(callback: (status: boolean) => void): void;
  reprompt(): void;
  user: NaverUser;
}

interface NaverGlobal {
  LoginWithNaverId: new (options: {
    clientId: string;
    callbackUrl: string;
    isPopup: boolean;
    loginButton?: { color?: string; type?: number; height?: number };
  }) => NaverLoginInstance;
}

declare global {
  interface Window {
    naver?: NaverGlobal;
  }
}

function getCallbackUrl(): string {
  return window.location.origin;
}

// SDK의 init()이 이 id를 가진 엘리먼트를 무조건 찾으므로(버튼을 실제로 쓰지
// 않아도) 항상 미리 만들어둔다.
function ensureContainer(): void {
  if (document.getElementById(CONTAINER_ID)) return;
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.style.position = 'fixed';
  el.style.top = '-2000px';
  el.style.left = '-2000px';
  document.body.appendChild(el);
}

let scriptPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.naver?.LoginWithNaverId) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = NAVER_SDK_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('네이버 로그인 SDK를 불러오지 못했어요.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

function createNaverLogin(naver: NaverGlobal): NaverLoginInstance {
  ensureContainer();
  return new naver.LoginWithNaverId({
    clientId: NAVER_CLIENT_ID,
    callbackUrl: getCallbackUrl(),
    isPopup: false,
    loginButton: { color: 'green', type: 1, height: 40 },
  });
}

function extractProfile(user: NaverUser): SocialLoginResult {
  const id = user.getId ? user.getId() : user.id;
  if (!id) {
    return { status: 'error', message: '사용자 정보를 가져오지 못했어요.' };
  }
  const email = (user.getEmail ? user.getEmail() : user.email) ?? '';
  const name = (user.getName ? user.getName() : user.name) || user.getNickName?.() || '네이버 사용자';
  return {
    status: 'success',
    profile: { provider: 'naver', providerId: String(id), email, name },
  };
}

function generateNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readPending(): NaverPendingState | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as NaverPendingState;
    if (Date.now() - parsed.createdAt > PENDING_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPending(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PENDING_KEY);
}

function writePending(mode: NaverRedirectMode, screen: NaverRedirectScreen): void {
  const payload: NaverPendingState = { mode, screen, state: generateNonce(), createdAt: Date.now() };
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
}

function parseHashParams(): Record<string, string> {
  if (typeof window === 'undefined' || !window.location.hash) return {};
  const params = new URLSearchParams(window.location.hash.slice(1));
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function stripUrlHash(): void {
  if (typeof window === 'undefined' || !window.location.hash) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

// 로그인/회원가입 버튼을 눌렀을 때 호출한다. 정상적인 경우 네이버 인증 화면으로
// 이 탭 전체가 이동해버리므로 반환되는 Promise는 resolve되지 않는다. Client
// ID가 없거나 SDK 로드에 실패했을 때만 즉시 결과가 반환된다.
//
// Web 전용 함수다 — Android는 별도의 네이티브 SDK 플로우(naverNative.ts)를
// 쓰고, 어느 플랫폼으로 라우팅할지는 socialLogin.ts의 loginWithNaver()가
// 결정한다(예전에는 이 함수 안에서 `Platform.OS !== 'web'`이면 무조건
// not_configured를 반환하는 하드블록이 있었는데, 그 분기 책임을
// loginWithNaver()로 옮겼다). 그래도 이 함수 자체가 실수로 네이티브에서
// 호출되면 window/document가 없어 즉시 깨지므로, 방어적으로 막아둔다.
export async function startNaverRedirect(
  mode: NaverRedirectMode,
  screen: NaverRedirectScreen
): Promise<SocialLoginResult> {
  if (Platform.OS !== 'web') {
    throw new Error('startNaverRedirect() is web-only — use loginWithNaver() to route by platform.');
  }
  if (!NAVER_CLIENT_ID) {
    return {
      status: 'not_configured',
      reason: 'Naver Client ID(EXPO_PUBLIC_NAVER_CLIENT_ID)가 설정되지 않았어요. mobile/docs/OAUTH_SETUP.md 안내를 참고하세요.',
    };
  }
  try {
    await loadSdk();
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  const naver = window.naver;
  if (!naver?.LoginWithNaverId) {
    return { status: 'error', message: '네이버 로그인 SDK를 초기화하지 못했어요.' };
  }

  writePending(mode, screen);
  const naverLogin = createNaverLogin(naver);
  naverLogin.init();
  naverLogin.reprompt();

  return new Promise<SocialLoginResult>(() => {});
}

// 앱이 뜰 때(App.tsx의 NavigationContainer onReady) 그리고 bfcache로 되돌아올
// 때(pageshow) 호출한다. 진행 중이던 네이버 리다이렉트가 없으면 null.
export async function resumeNaverRedirectIfPending(): Promise<NaverRedirectResume | null> {
  if (typeof window === 'undefined') return null;
  const pending = readPending();
  if (!pending) return null;
  clearPending();

  const hashParams = parseHashParams();
  const hasError = Boolean(hashParams.error);
  const hasToken = Boolean(hashParams.access_token);

  if (!hasToken && !hasError) {
    // 네이버 페이지로 이동만 하고 인증을 마치지 못한 채 돌아온 경우(뒤로가기,
    // bfcache 복원 등). 다시 시도할 수 있도록 조용히 취소 처리한다.
    return { mode: pending.mode, screen: pending.screen, result: { status: 'cancelled' } };
  }

  if (hasError) {
    stripUrlHash();
    return {
      mode: pending.mode,
      screen: pending.screen,
      result: { status: 'error', message: hashParams.error_description || '네이버 로그인에 실패했어요.' },
    };
  }

  try {
    await loadSdk();
  } catch (err) {
    stripUrlHash();
    return {
      mode: pending.mode,
      screen: pending.screen,
      result: { status: 'error', message: err instanceof Error ? err.message : String(err) },
    };
  }

  const naver = window.naver;
  if (!naver?.LoginWithNaverId) {
    stripUrlHash();
    return {
      mode: pending.mode,
      screen: pending.screen,
      result: { status: 'error', message: '네이버 로그인 SDK를 초기화하지 못했어요.' },
    };
  }

  return new Promise<NaverRedirectResume>((resolve) => {
    const naverLogin = createNaverLogin(naver);
    naverLogin.init();
    naverLogin.getLoginStatus((status) => {
      stripUrlHash();
      resolve({
        mode: pending.mode,
        screen: pending.screen,
        result: status ? extractProfile(naverLogin.user) : { status: 'cancelled' },
      });
    });
  });
}
