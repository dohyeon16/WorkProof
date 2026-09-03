// 인증 세션 오케스트레이터(순수 로직 — RN/Expo/fetch 의존 없음, node:test 대상).
//
// 책임:
//  - access 토큰은 메모리에만, refresh 토큰은 주입된 store(SecureStore)에만 둔다.
//  - refresh rotation: 성공 시 새 refresh로 즉시 교체.
//  - single-flight: 동시 401이 몰려도 refresh는 한 번만 실행하고 결과를 공유한다.
//  - 401 재시도: 인증 요청이 401이면 refresh 후 한 번만 재시도. 재시도도 401이면 세션 정리.
//  - refresh가 401(무효/재사용/폐기)이면 즉시 로컬 세션을 비우고 unauthenticated 전환.
//  - 네트워크/타임아웃 오류는 세션을 지우지 않고 그대로 전파(로그인 유지).
import { ApiError } from '../../../services/api/errors';
import type {
  AuthSession,
  AuthUser,
  LoginInput,
  RefreshTokenStore,
  RegisterInput,
  SessionApi,
  SocialSessionInput,
  UpdateProfileInput,
} from '../auth.types';

export type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated';

export interface AuthStateSnapshot {
  status: AuthStatus;
  user: AuthUser | null;
}

/** refresh 불가로 세션이 끝났음을 알리는 전용 오류(화면은 로그인으로 보낸다). */
export class SessionExpiredError extends Error {
  constructor() {
    super('세션이 만료되었어요. 다시 로그인해주세요.');
    this.name = 'SessionExpiredError';
  }
}

export interface Session {
  getState(): AuthStateSnapshot;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  register(input: RegisterInput): Promise<AuthUser>;
  login(input: LoginInput): Promise<AuthUser>;
  /** 서버 검증된 OAuth 브릿지 세션(Expo Go 소셜 로그인)을 실제 백엔드 인증 세션으로 교환한다. */
  loginWithBridgeSession(
    bridgeSessionId: string,
    deviceLabel?: string,
    bridgeApiUrl?: string
  ): Promise<AuthUser>;
  loginWithSocialCredential(input: SocialSessionInput): Promise<AuthUser>;
  refreshSession(): Promise<string>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<AuthUser>;
  updateCurrentUser(input: UpdateProfileInput): Promise<AuthUser>;
  deleteCurrentUser(): Promise<void>;
  clearLocalSession(): Promise<void>;
  /**
   * access 토큰이 필요한 임의 요청을 single-flight refresh + 401 1회 재시도로 실행한다.
   * work-data 동기화 등 인증 API 호출부가 이 실행기를 재사용한다(중복 refresh 방지).
   * 세션 만료 시 SessionExpiredError 를 던지고 unauthenticated 로 전환한다.
   */
  runAuthorized<T>(run: (accessToken: string) => Promise<T>): Promise<T>;
}

export interface CreateSessionDeps {
  api: SessionApi;
  store: RefreshTokenStore;
}

export function createSession({ api, store }: CreateSessionDeps): Session {
  let state: AuthStateSnapshot = { status: 'initializing', user: null };
  let accessToken: string | null = null;
  // single-flight: 진행 중인 refresh가 있으면 이 Promise를 공유한다.
  let refreshInFlight: Promise<string> | null = null;

  const listeners = new Set<() => void>();

  function emit(next: AuthStateSnapshot): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function setAuthenticated(user: AuthUser): void {
    emit({ status: 'authenticated', user });
  }

  function setUnauthenticated(): void {
    accessToken = null;
    emit({ status: 'unauthenticated', user: null });
  }

  // refresh 원문을 새 값으로 교체하고 access/user를 메모리에 반영한다(rotation).
  async function applySession(session: AuthSession): Promise<AuthUser> {
    // refresh 토큰을 안전 저장소에 먼저 쓴다. 실패하면 세션을 세우지 않는다 —
    // access만 메모리에 남고 refresh가 없으면 재시작 시 복원 불가한 반쪽 상태가 되므로.
    try {
      await store.set(session.refreshToken);
    } catch (err) {
      accessToken = null;
      throw err;
    }
    accessToken = session.accessToken;
    setAuthenticated(session.user);
    return session.user;
  }

  async function clearLocalSession(): Promise<void> {
    accessToken = null;
    // 저장소 삭제 실패는 무시한다(메모리 세션은 이미 비웠고, 남은 refresh는 다음 refresh에서 폐기됨).
    try {
      await store.clear();
    } catch {
      /* best-effort */
    }
  }

  async function initialize(): Promise<void> {
    try {
      const refreshToken = await store.get();
      if (!refreshToken) {
        setUnauthenticated();
        return;
      }
      const session = await api.refresh(refreshToken);
      await applySession(session);
    } catch {
      // SecureStore 읽기 실패/손상 토큰/만료/네트워크 등 어떤 이유든 안전하게 로그아웃 상태로 둔다.
      await clearLocalSession();
      setUnauthenticated();
    }
  }

  async function register(input: RegisterInput): Promise<AuthUser> {
    // 가입 성공은 로그인 성공이 아니다. 백엔드가 하위 호환 계약상 TokenPair를
    // 반환하더라도 이를 메모리/SecureStore에 적용하지 않는다. 사용자가 로그인
    // 화면에서 자격 증명을 다시 제출해 login()이 성공한 뒤에만 세션을 만든다.
    const registered = await api.register(input);
    return registered.user;
  }

  async function login(input: LoginInput): Promise<AuthUser> {
    const session = await api.login(input);
    return applySession(session);
  }

  async function loginWithBridgeSession(
    bridgeSessionId: string,
    deviceLabel?: string,
    bridgeApiUrl?: string
  ): Promise<AuthUser> {
    const session = await api.exchangeBridgeSession(bridgeSessionId, deviceLabel, bridgeApiUrl);
    return applySession(session);
  }

  async function loginWithSocialCredential(input: SocialSessionInput): Promise<AuthUser> {
    if (!api.social) throw new Error('Social session API is unavailable.');
    const session = await api.social(input);
    return applySession(session);
  }

  // single-flight refresh. 새 access 토큰을 돌려준다. refresh가 401이면 세션을
  // 비우고 SessionExpiredError를 던진다. 네트워크/타임아웃은 세션을 지우지 않는다.
  function refreshSession(): Promise<string> {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const refreshToken = await store.get();
      if (!refreshToken) {
        setUnauthenticated();
        throw new SessionExpiredError();
      }
      try {
        const session = await api.refresh(refreshToken);
        await applySession(session);
        return session.accessToken;
      } catch (err) {
        if (err instanceof ApiError && err.isUnauthorized) {
          // 무효/재사용/폐기된 family — 즉시 로그아웃 처리.
          await clearLocalSession();
          setUnauthenticated();
          throw new SessionExpiredError();
        }
        // 일시적 오류(네트워크/타임아웃/5xx): 세션 유지, 그대로 전파.
        throw err;
      }
    })();

    // in-flight 참조는 성공/실패와 무관하게 정리해 다음 refresh가 가능하게 한다.
    return refreshInFlight.finally(() => {
      refreshInFlight = null;
    });
  }

  // access 토큰이 필요한 요청 실행기. 없으면 refresh로 확보하고, 401이면 한 번만
  // 재시도한다. 재시도도 401이면 세션을 정리하고 SessionExpiredError를 던진다.
  async function authorized<T>(run: (token: string) => Promise<T>): Promise<T> {
    let token = accessToken ?? (await refreshSession());
    try {
      return await run(token);
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        token = await refreshSession(); // single-flight로 공유됨
        try {
          return await run(token);
        } catch (retryErr) {
          if (retryErr instanceof ApiError && retryErr.isUnauthorized) {
            await clearLocalSession();
            setUnauthenticated();
            throw new SessionExpiredError();
          }
          throw retryErr;
        }
      }
      throw err;
    }
  }

  async function getCurrentUser(): Promise<AuthUser> {
    const user = await authorized((token) => api.getMe(token));
    setAuthenticated(user);
    return user;
  }

  async function updateCurrentUser(input: UpdateProfileInput): Promise<AuthUser> {
    const user = await authorized((token) => api.updateMe(token, input));
    setAuthenticated(user);
    return user;
  }

  async function deleteCurrentUser(): Promise<void> {
    await authorized((token) => api.deleteMe(token));
    // 탈퇴 성공 → 로컬 세션 완전 삭제 후 unauthenticated. 기존 토큰 재사용 금지.
    await clearLocalSession();
    setUnauthenticated();
  }

  async function logout(): Promise<void> {
    const refreshToken = await store.get();
    if (refreshToken) {
      try {
        // 서버 폐기는 best-effort — 실패해도 로컬 세션은 반드시 지운다.
        await api.logout(refreshToken);
      } catch {
        // 네트워크 장애 등은 무시하고 로컬 정리로 진행한다.
      }
    }
    await clearLocalSession();
    setUnauthenticated();
  }

  return {
    getState: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    initialize,
    register,
    login,
    loginWithBridgeSession,
    loginWithSocialCredential,
    refreshSession,
    logout,
    getCurrentUser,
    updateCurrentUser,
    deleteCurrentUser,
    clearLocalSession,
    runAuthorized: authorized,
  };
}
