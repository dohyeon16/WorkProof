// 백엔드 인증(Phase 2.5) 세션을 앱 전역에 제공하는 React Context.
// 실제 세션 로직은 session.ts(순수)에 있고, 여기서는 실 클라이언트/SecureStore와
// 연결한 싱글턴 세션을 만들어 React 상태로 노출한다.
//
// 소셜 로그인(로컬 Account + isLoggedIn 플래그)은 앱 전반의 로그인 여부 판단에
// 계속 그대로 쓰인다 — 다만 AI 프록시(useAiAnalysis)는 이 컨텍스트의 isAuthenticated
// 하나만 본다. Expo Go 소셜 로그인(Google/Kakao/Naver)은 loginWithBridgeSession으로
// 서버가 검증한 OAuth 브릿지 세션을 실제 백엔드 인증 세션으로 교환해, 로그인 방법과
// 무관하게 이 컨텍스트가 authenticated가 되도록 한다(실기기 회귀: 소셜 로그인 후에도
// AI 기능이 "로그인 필요"로 잘못 보이던 문제).
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { createApiClient } from '../../../services/api/client';
import { createSessionApi } from '../services/authApi';
import { refreshTokenStore } from '../services/tokenStore';
import { createSession, type AuthStateSnapshot } from './session';
import type { AuthUser, LoginInput, RegisterInput, SocialSessionInput, UpdateProfileInput } from '../auth.types';

// 앱 수명 동안 유지되는 단일 세션. 클라이언트/스토어는 모듈 로드 시 한 번만 만든다.
const session = createSession({
  api: createSessionApi(createApiClient()),
  store: refreshTokenStore,
});

// 서버가 세션을 기기별로 구분할 수 있도록 하는 라벨(민감 정보 아님).
const DEVICE_LABEL = `WorkProof ${Platform.OS}`;

export interface AuthContextValue {
  status: AuthStateSnapshot['status'];
  user: AuthUser | null;
  isAuthenticated: boolean;
  register(input: Omit<RegisterInput, 'deviceLabel'>): Promise<AuthUser>;
  login(email: string, password: string): Promise<AuthUser>;
  /** Expo Go 소셜 로그인(Google/Kakao/Naver) 성공 후 받은 bridge session_id를 백엔드 인증 세션으로 교환한다. */
  loginWithBridgeSession(bridgeSessionId: string, bridgeApiUrl?: string, mode?: 'signup' | 'login'): Promise<AuthUser>;
  loginWithSocialCredential(input: Omit<SocialSessionInput, 'deviceLabel'>): Promise<AuthUser>;
  logout(): Promise<void>;
  refreshUser(): Promise<AuthUser>;
  updateProfile(input: UpdateProfileInput): Promise<AuthUser>;
  deleteAccount(): Promise<void>;
  /** access 토큰이 필요한 요청 실행기(single-flight refresh 재사용). work-data 동기화가 쓴다. */
  runAuthorized<T>(run: (accessToken: string) => Promise<T>): Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getState, session.getState);

  // 앱 시작 시 SecureStore의 refresh 토큰으로 세션 복원을 1회 시도한다.
  useEffect(() => {
    void session.initialize();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: snapshot.status,
      user: snapshot.user,
      isAuthenticated: snapshot.status === 'authenticated',
      register: (input) => session.register({ ...input }),
      login: (email, password) =>
        session.login({ email, password, deviceLabel: DEVICE_LABEL }),
      loginWithBridgeSession: (bridgeSessionId, bridgeApiUrl, mode) =>
        session.loginWithBridgeSession(bridgeSessionId, DEVICE_LABEL, bridgeApiUrl, mode),
      loginWithSocialCredential: (input) =>
        session.loginWithSocialCredential({ ...input, deviceLabel: DEVICE_LABEL }),
      logout: () => session.logout(),
      refreshUser: () => session.getCurrentUser(),
      updateProfile: (input) => session.updateCurrentUser(input),
      deleteAccount: () => session.deleteCurrentUser(),
      runAuthorized: (run) => session.runAuthorized(run),
    }),
    [snapshot]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
