// Phase 2 백엔드 인증 API(/api/v1/auth/*, /api/v1/users/me) 바인딩.
// 실제 확인한 백엔드 계약(backend/app/api/v1/auth.py, users.py, schemas/*)을 그대로 따른다.
//
// 엔드포인트:
//  POST /auth/register  {email,password,name}          -> 201 TokenPair (409 중복)
//  POST /auth/login     {email,password,device_label?} -> 200 TokenPair (401 불일치)
//  POST /auth/bridge/exchange {bridge_session_id,device_label?} -> 200 TokenPair (400 무효/만료)
//  POST /auth/refresh   {refresh_token}                -> 200 TokenPair (401 무효/재사용)
//  POST /auth/logout    {refresh_token}                -> 200 {ok} (멱등, 인증 불필요)
//  GET  /users/me       (Bearer)                       -> 200 UserResponse
//  PATCH/users/me       {name?} (Bearer)               -> 200 UserResponse
//  DELETE /users/me     (Bearer)                       -> 204 No Content
import { createApiClient, type ApiClient } from '../../../services/api/client';
import { AUTH_TIMEOUT_MS } from '../../../services/api/config';
import type {
  AuthSession,
  AuthUser,
  LoginInput,
  RegisterInput,
  SessionApi,
  SocialSessionInput,
  UpdateProfileInput,
} from '../auth.types';

// --- 서버 wire 형식(snake_case) ---
interface WireUser {
  id: string;
  email: string | null;
  name: string;
  primary_provider: string;
  created_at: string;
  updated_at: string;
}

interface WireTokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: WireUser;
}

function mapUser(wire: WireUser): AuthUser {
  return {
    id: wire.id,
    email: wire.email,
    name: wire.name,
    primaryProvider: wire.primary_provider,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

function mapSession(wire: WireTokenPair): AuthSession {
  return {
    accessToken: wire.access_token,
    refreshToken: wire.refresh_token,
    expiresIn: wire.expires_in,
    user: mapUser(wire.user),
  };
}

/** ApiClient 위에 Phase 2 인증 계약을 얹은 SessionApi 구현을 만든다. */
export function createSessionApi(client: ApiClient): SessionApi {
  return {
    async register(input: RegisterInput): Promise<AuthSession> {
      const wire = await client.request<WireTokenPair>('/auth/register', {
        method: 'POST',
        timeoutMs: AUTH_TIMEOUT_MS,
        body: {
          email: input.email,
          password: input.password,
          name: input.name,
        },
      });
      return mapSession(wire);
    },

    async login(input: LoginInput): Promise<AuthSession> {
      const wire = await client.request<WireTokenPair>('/auth/login', {
        method: 'POST',
        timeoutMs: AUTH_TIMEOUT_MS,
        body: {
          email: input.email,
          password: input.password,
          device_label: input.deviceLabel,
        },
      });
      return mapSession(wire);
    },

    async exchangeBridgeSession(
      bridgeSessionId: string,
      deviceLabel?: string,
      bridgeApiUrl?: string
    ): Promise<AuthSession> {
      // Bridge sessions are process-local on the backend. Exchange against the
      // exact origin that created the session even when the general API and
      // OAuth bridge origins are configured differently.
      const exchangeClient = bridgeApiUrl ? createApiClient(bridgeApiUrl) : client;
      const wire = await exchangeClient.request<WireTokenPair>('/auth/bridge/exchange', {
        method: 'POST',
        timeoutMs: AUTH_TIMEOUT_MS,
        body: { bridge_session_id: bridgeSessionId, device_label: deviceLabel },
      });
      return mapSession(wire);
    },

    async social(input: SocialSessionInput): Promise<AuthSession> {
      const wire = await client.request<WireTokenPair>('/auth/social', {
        method: 'POST',
        timeoutMs: AUTH_TIMEOUT_MS,
        body: {
          provider: input.provider,
          provider_user_id: input.providerUserId,
          email: input.email,
          name: input.name,
          credential: input.credential,
          device_label: input.deviceLabel,
        },
      });
      return mapSession(wire);
    },

    async refresh(refreshToken: string): Promise<AuthSession> {
      // 자동 재시도/interceptor 없음 — session 계층이 single-flight로 직접 호출한다.
      const wire = await client.request<WireTokenPair>('/auth/refresh', {
        method: 'POST',
        timeoutMs: AUTH_TIMEOUT_MS,
        body: { refresh_token: refreshToken },
      });
      return mapSession(wire);
    },

    async logout(refreshToken: string): Promise<void> {
      await client.request<{ ok: boolean }>('/auth/logout', {
        method: 'POST',
        body: { refresh_token: refreshToken },
      });
    },

    async getMe(accessToken: string): Promise<AuthUser> {
      const wire = await client.request<WireUser>('/users/me', { accessToken });
      return mapUser(wire);
    },

    async updateMe(accessToken: string, input: UpdateProfileInput): Promise<AuthUser> {
      const wire = await client.request<WireUser>('/users/me', {
        method: 'PATCH',
        accessToken,
        body: { name: input.name },
      });
      return mapUser(wire);
    },

    async deleteMe(accessToken: string): Promise<void> {
      await client.request<void>('/users/me', {
        method: 'DELETE',
        accessToken,
        expectNoContent: true,
      });
    },
  };
}
