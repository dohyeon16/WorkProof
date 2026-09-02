// 백엔드 인증(Phase 2.5) 세션을 앱 전역에 제공하는 React Context.
// 실제 세션 로직은 session.ts(순수)에 있고, 여기서는 실 클라이언트/SecureStore와
// 연결한 싱글턴 세션을 만들어 React 상태로 노출한다.
//
// 기존 소셜 로그인(로컬 Account + isLoggedIn 플래그)은 이 컨텍스트와 별개로
// 그대로 동작한다 — 소셜 브릿지는 아직 Phase 2 토큰을 발급하지 않기 때문이다.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { createApiClient } from '../../../core/api/client';
import { createSessionApi } from '../services/authApi';
import { refreshTokenStore } from '../services/tokenStore';
import { createSession, type AuthStateSnapshot } from './session';
import type { AuthUser, LoginInput, RegisterInput, UpdateProfileInput } from '../types';

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
  logout(): Promise<void>;
  refreshUser(): Promise<AuthUser>;
  updateProfile(input: UpdateProfileInput): Promise<AuthUser>;
  deleteAccount(): Promise<void>;
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
      logout: () => session.logout(),
      refreshUser: () => session.getCurrentUser(),
      updateProfile: (input) => session.updateCurrentUser(input),
      deleteAccount: () => session.deleteCurrentUser(),
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
