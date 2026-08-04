// 백엔드 인증(Phase 2.5) 도메인 타입. 서버는 snake_case로 응답하지만 앱 내부는
// camelCase로 다룬다(매핑은 authApi.ts). 이 파일은 순수 타입만 — RN/Expo 의존 없음.

/** GET/PATCH /users/me, 토큰 응답의 user 필드. 내부 필드(password_hash 등)는 없다. */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string;
  primaryProvider: string;
  createdAt: string;
  updatedAt: string;
}

/** register/login/refresh 성공 시 받는 토큰 + 사용자. */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** access 토큰 만료까지 남은 초. */
  expiresIn: number;
  user: AuthUser;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  deviceLabel?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  deviceLabel?: string;
}

export interface UpdateProfileInput {
  name: string;
}

// session 계층이 의존하는 인증 API 추상화. 구체 HTTP 클라이언트(authApi.ts)와
// 분리해 두어, session 로직을 fetch 없이 단위 테스트할 수 있게 한다.
export interface SessionApi {
  register(input: RegisterInput): Promise<AuthSession>;
  login(input: LoginInput): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(refreshToken: string): Promise<void>;
  getMe(accessToken: string): Promise<AuthUser>;
  updateMe(accessToken: string, input: UpdateProfileInput): Promise<AuthUser>;
  deleteMe(accessToken: string): Promise<void>;
}

/** refresh 토큰의 안전 저장소 추상화(구현: tokenStore.ts = SecureStore). */
export interface RefreshTokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}
