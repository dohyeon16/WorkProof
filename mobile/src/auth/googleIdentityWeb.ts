import type { SocialLoginResult } from './socialLogin';

// Google Identity Services (GIS) — web-only ID Token sign-in. No client
// secret and no authorization-code exchange: the browser gets a signed JWT
// (the "credential") directly from Google, and we read openid/email/profile
// straight out of its claims. See OAUTH_SETUP.md for why this replaces the
// expo-auth-session/PKCE flow on web specifically.
const GOOGLE_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

declare global {
  interface Window {
    google?: any;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Identity Services 스크립트를 불러오지 못했어요.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// Start loading as soon as this module is evaluated (web only) so a later
// button click doesn't have to await a network fetch first — awaiting before
// google.accounts.id's popup call would drop the click's user-activation and
// get the popup blocked by the browser.
if (typeof window !== 'undefined') {
  loadGisScript().catch(() => {});
}

function decodeIdToken(idToken: string): Record<string, unknown> {
  const payload = idToken.split('.')[1] ?? '';
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  );
  return JSON.parse(json);
}

let hiddenContainer: HTMLDivElement | null = null;

function getHiddenContainer(): HTMLDivElement {
  if (hiddenContainer) return hiddenContainer;
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.top = '-2000px';
  el.style.left = '-2000px';
  document.body.appendChild(el);
  hiddenContainer = el;
  return el;
}

export async function loginWithGoogleWeb(): Promise<SocialLoginResult> {
  if (!GOOGLE_CLIENT_ID) {
    return { status: 'not_configured' };
  }

  try {
    await loadGisScript();
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  const google = window.google;
  if (!google?.accounts?.id) {
    return { status: 'error', message: 'Google Identity Services를 초기화하지 못했어요.' };
  }

  return new Promise<SocialLoginResult>((resolve) => {
    let settled = false;
    const settle = (result: SocialLoginResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      if (focusTimer) clearTimeout(focusTimer);
      resolve(result);
    };

    // GIS's popup has no "user closed it" callback of its own. But opening it
    // blurs this window, and closing it (via the X or after finishing) always
    // refocuses this window — so we use that as a proxy. The short delay on
    // focus lets a real success callback (which fires as the popup closes)
    // win the race before we give up and mark it cancelled.
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const onWindowFocus = () => {
      window.removeEventListener('focus', onWindowFocus);
      focusTimer = setTimeout(() => settle({ status: 'cancelled' }), 500);
    };
    const onWindowBlur = () => {
      window.removeEventListener('blur', onWindowBlur);
      window.addEventListener('focus', onWindowFocus);
    };
    window.addEventListener('blur', onWindowBlur);

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      ux_mode: 'popup',
      callback: (response: { credential?: string }) => {
        if (!response?.credential) {
          settle({ status: 'error', message: 'Google 로그인 응답을 받지 못했어요.' });
          return;
        }
        try {
          const payload = decodeIdToken(response.credential);
          if (!payload.sub) {
            settle({ status: 'error', message: '사용자 정보를 가져오지 못했어요.' });
            return;
          }
          settle({
            status: 'success',
            profile: {
              provider: 'google',
              providerId: String(payload.sub),
              email: typeof payload.email === 'string' ? payload.email : '',
              name:
                typeof payload.name === 'string'
                  ? payload.name
                  : typeof payload.email === 'string'
                    ? payload.email
                    : 'Google 사용자',
            },
          });
        } catch {
          settle({ status: 'error', message: 'Google 로그인 정보를 처리하지 못했어요.' });
        }
      },
    });

    const container = getHiddenContainer();
    container.innerHTML = '';
    google.accounts.id.renderButton(container, { type: 'standard' });

    const clickable = container.querySelector<HTMLElement>('div[role="button"]');
    if (!clickable) {
      settle({ status: 'error', message: 'Google 로그인 버튼을 초기화하지 못했어요.' });
      return;
    }
    clickable.click();

    // GIS popup mode has no "user closed the popup" callback — fall back to a timeout
    // so the caller isn't left waiting forever if the user abandons the popup.
    setTimeout(() => settle({ status: 'cancelled' }), 120000);
  });
}
