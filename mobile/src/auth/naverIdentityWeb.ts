import type { SocialLoginResult } from './socialLogin';

// 네이버 아이디로 로그인 JavaScript SDK — client secret 없이 브라우저에서 바로 로그인.
// (Client Secret이 필요한 서버용 authorization-code 교환 대신, SDK가 브라우저에서
// 직접 access token을 받아오는 implicit 방식을 씀.)
//
// isPopup 모드는 이 페이지 자신이 두 가지 역할을 겸하는 구조로 동작한다:
//   1) 메인 창(opener): 로그인 버튼을 렌더링하고, 팝업이 결과를 전달해줄
//      naver.successCallback / naver.failureCallback을 등록해둔다.
//   2) 팝업 창: 네이버가 콜백 URL(= 이 앱의 origin, 즉 이 앱 번들 자신)로
//      리다이렉트하면, 팝업 안에서 앱이 다시 로드된다. 이때는 window.opener가
//      있으므로 스스로 팝업임을 감지하고, getLoginStatus 결과를 opener에게
//      건네준 뒤 스스로 닫는다.
const NAVER_CLIENT_ID = (process.env.EXPO_PUBLIC_NAVER_CLIENT_ID ?? '').trim();
const NAVER_SDK_SRC = 'https://static.nid.naver.com/js/naveridlogin_js_sdk_2.0.0.js';
const CONTAINER_ID = 'naverIdLogin';

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
  user: NaverUser;
}

interface NaverGlobal {
  LoginWithNaverId: new (options: {
    clientId: string;
    callbackUrl: string;
    isPopup: boolean;
    loginButton?: { color?: string; type?: number; height?: number };
  }) => NaverLoginInstance;
  successCallback?: (user: NaverUser) => void;
  failureCallback?: () => void;
}

declare global {
  interface Window {
    naver?: NaverGlobal;
  }
}

function getCallbackUrl(): string {
  return window.location.origin;
}

function getContainer(): HTMLDivElement {
  let el = document.getElementById(CONTAINER_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = CONTAINER_ID;
    el.style.position = 'fixed';
    el.style.top = '-2000px';
    el.style.left = '-2000px';
    document.body.appendChild(el);
  }
  return el;
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

function waitForButton(container: HTMLElement, timeoutMs = 3000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const el = container.firstChild as HTMLElement | null;
      if (el) {
        resolve(el);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(check, 50);
    };
    check();
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

// 팝업 쪽(=window.opener가 존재하는 인스턴스)에서만 실행되는 relay. 모듈이
// 로드되는 시점(=앱이 뜨는 시점)에 바로 한 번 시도해야, 네이버가 콜백 URL로
// 리다이렉트해서 이 앱이 팝업 안에서 다시 로드됐을 때 곧바로 처리된다.
let popupRelayStarted = false;
function startPopupRelayIfNeeded(): void {
  if (typeof window === 'undefined' || popupRelayStarted) return;
  if (!window.opener || !NAVER_CLIENT_ID) return;
  popupRelayStarted = true;
  loadSdk()
    .then(() => {
      const naver = window.naver;
      if (!naver) throw new Error('SDK not loaded');
      getContainer();
      const naverLogin = new naver.LoginWithNaverId({
        clientId: NAVER_CLIENT_ID,
        callbackUrl: getCallbackUrl(),
        isPopup: true,
      });
      naverLogin.init();
      naverLogin.getLoginStatus((status) => {
        const opener = window.opener as (Window & { naver?: NaverGlobal }) | null;
        if (status && opener?.naver?.successCallback) {
          opener.naver.successCallback(naverLogin.user);
        } else {
          opener?.naver?.failureCallback?.();
        }
        window.close();
      });
    })
    .catch(() => {
      (window.opener as (Window & { naver?: NaverGlobal }) | null)?.naver?.failureCallback?.();
      window.close();
    });
}

if (typeof window !== 'undefined') {
  startPopupRelayIfNeeded();
}

export async function loginWithNaverWeb(): Promise<SocialLoginResult> {
  if (!NAVER_CLIENT_ID) {
    return { status: 'not_configured' };
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

  return new Promise<SocialLoginResult>((resolve) => {
    let settled = false;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;

    const settle = (result: SocialLoginResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      if (focusTimer) clearTimeout(focusTimer);
      resolve(result);
    };

    naver.successCallback = (user) => settle(extractProfile(user));
    naver.failureCallback = () => settle({ status: 'error', message: '네이버 로그인에 실패했어요.' });

    // Same popup-closed-without-finishing heuristic as the Google web flow:
    // opening the popup blurs this window, and a real result always calls
    // settle() via the callbacks above before the popup closes — so if focus
    // returns and neither fired, treat it as the user closing the popup.
    const onWindowFocus = () => {
      window.removeEventListener('focus', onWindowFocus);
      focusTimer = setTimeout(() => settle({ status: 'cancelled' }), 500);
    };
    const onWindowBlur = () => {
      window.removeEventListener('blur', onWindowBlur);
      window.addEventListener('focus', onWindowFocus);
    };
    window.addEventListener('blur', onWindowBlur);

    const naverLogin = new naver.LoginWithNaverId({
      clientId: NAVER_CLIENT_ID,
      callbackUrl: getCallbackUrl(),
      isPopup: true,
      loginButton: { color: 'green', type: 1, height: 40 },
    });
    const container = getContainer();
    container.innerHTML = '';
    naverLogin.init();

    waitForButton(container).then((button) => {
      if (!button) {
        settle({ status: 'error', message: '네이버 로그인 버튼을 초기화하지 못했어요.' });
        return;
      }
      button.click();
    });

    setTimeout(() => settle({ status: 'cancelled' }), 120000);
  });
}
