// 인증 세션/오류 정규화 순수 로직 자동 검증(node:test, RN/Expo 의존 없음).
// SecureStore/fetch/네비게이션 결합부는 웹/실기기 검증 항목으로 남긴다(보고서 참조).
import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, normalizeHttpError } from '../src/services/api/errors';
import { createSession, SessionExpiredError } from '../src/features/auth/state/session';
import type {
  AuthSession,
  AuthUser,
  RefreshTokenStore,
  SessionApi,
} from '../src/features/auth/auth.types';

// ---------- helpers ----------
function makeUser(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    email: 'a@b.com',
    name: 'A',
    primaryProvider: 'email',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function makeSessionResp(tag: string): AuthSession {
  return {
    accessToken: `access-${tag}`,
    refreshToken: `refresh-${tag}`,
    expiresIn: 900,
    user: makeUser(),
  };
}

function unauthorized(): ApiError {
  return new ApiError('http', '인증에 실패했어요.', 401);
}

/** 인메모리 refresh 저장소(SecureStore 대역). set/clear 호출 추적. */
function makeStore(initial: string | null = null) {
  let value = initial;
  let clearCount = 0;
  const setCalls: string[] = [];
  const store: RefreshTokenStore = {
    async get() {
      return value;
    },
    async set(token: string) {
      value = token;
      setCalls.push(token);
    },
    async clear() {
      value = null;
      clearCount += 1;
    },
  };
  return {
    store,
    setCalls,
    get clearCount() {
      return clearCount;
    },
    get value() {
      return value;
    },
  };
}

/** 프로그래머블 SessionApi 목. 각 메서드 호출 횟수를 센다. */
function makeApi(impl: Partial<SessionApi> = {}) {
  const counts = { refresh: 0, getMe: 0, logout: 0, deleteMe: 0, login: 0, register: 0, exchangeBridgeSession: 0 };
  let lastLogoutToken: string | undefined;
  const api: SessionApi = {
    async register(input) {
      counts.register += 1;
      return impl.register ? impl.register(input) : makeSessionResp('register');
    },
    async login(input) {
      counts.login += 1;
      return impl.login ? impl.login(input) : makeSessionResp('login');
    },
    async exchangeBridgeSession(bridgeSessionId, deviceLabel) {
      counts.exchangeBridgeSession += 1;
      return impl.exchangeBridgeSession
        ? impl.exchangeBridgeSession(bridgeSessionId, deviceLabel)
        : makeSessionResp('bridge');
    },
    async refresh(rt) {
      counts.refresh += 1;
      if (impl.refresh) return impl.refresh(rt);
      return makeSessionResp(`r${counts.refresh}`);
    },
    async logout(rt) {
      counts.logout += 1;
      lastLogoutToken = rt;
      if (impl.logout) return impl.logout(rt);
    },
    async getMe(at) {
      counts.getMe += 1;
      if (impl.getMe) return impl.getMe(at);
      return makeUser();
    },
    async updateMe(at, input) {
      if (impl.updateMe) return impl.updateMe(at, input);
      return makeUser({ name: input.name });
    },
    async deleteMe(at) {
      counts.deleteMe += 1;
      if (impl.deleteMe) return impl.deleteMe(at);
    },
  };
  return {
    api,
    counts,
    get lastLogoutToken() {
      return lastLogoutToken;
    },
  };
}

// ---------- 오류 정규화 ----------
test('normalizeHttpError: {detail:string} 은 detail/message 보존', () => {
  const err = normalizeHttpError(409, JSON.stringify({ detail: '이미 가입된 이메일이에요.' }));
  assert.equal(err.status, 409);
  assert.equal(err.detail, '이미 가입된 이메일이에요.');
  assert.equal(err.message, '이미 가입된 이메일이에요.');
  assert.equal(err.isUnauthorized, false);
});

test('normalizeHttpError: 401 은 isUnauthorized', () => {
  const err = normalizeHttpError(401, JSON.stringify({ detail: '인증 실패' }));
  assert.equal(err.isUnauthorized, true);
});

test('normalizeHttpError: 422 배열 detail 은 일반 안내로 대체(detail 미노출)', () => {
  const err = normalizeHttpError(
    422,
    JSON.stringify({ detail: [{ loc: ['body', 'email'], msg: 'x', type: 'y' }] })
  );
  assert.equal(err.detail, undefined);
  assert.equal(err.message, '입력값을 다시 확인해주세요.');
});

test('normalizeHttpError: JSON 아닌 바디는 상태 폴백 메시지', () => {
  const err = normalizeHttpError(500, '<html>oops</html>');
  assert.equal(err.detail, undefined);
  assert.ok(err.message.includes('서버'));
});

// ---------- 초기 세션 복원 ----------
test('initialize: refresh 토큰 없으면 unauthenticated (refresh 미호출)', async () => {
  const s = makeStore(null);
  const a = makeApi();
  const session = createSession({ api: a.api, store: s.store });
  await session.initialize();
  assert.equal(session.getState().status, 'unauthenticated');
  assert.equal(a.counts.refresh, 0);
});

test('initialize: refresh 성공 시 authenticated + 새 refresh 저장(rotation)', async () => {
  const s = makeStore('refresh-old');
  const a = makeApi();
  const session = createSession({ api: a.api, store: s.store });
  await session.initialize();
  assert.equal(session.getState().status, 'authenticated');
  assert.equal(a.counts.refresh, 1);
  // 회전: 저장된 값이 새 refresh 로 교체됨
  assert.equal(s.value, 'refresh-r1');
  assert.ok(s.setCalls.includes('refresh-r1'));
});

test('initialize: refresh 401 이면 로컬 정리 후 unauthenticated', async () => {
  const s = makeStore('refresh-bad');
  const a = makeApi({
    async refresh() {
      throw unauthorized();
    },
  });
  const session = createSession({ api: a.api, store: s.store });
  await session.initialize();
  assert.equal(session.getState().status, 'unauthenticated');
  assert.ok(s.clearCount >= 1);
  assert.equal(s.value, null);
});

// ---------- 로그인 / 회원가입 ----------
test('login: 성공 시 authenticated + refresh 저장', async () => {
  const s = makeStore(null);
  const a = makeApi();
  const session = createSession({ api: a.api, store: s.store });
  const user = await session.login({ email: 'a@b.com', password: 'pw' });
  assert.equal(user.email, 'a@b.com');
  assert.equal(session.getState().status, 'authenticated');
  assert.equal(s.value, 'refresh-login');
});

test('register: 성공 시 authenticated (자동 로그인)', async () => {
  const s = makeStore(null);
  const a = makeApi();
  const session = createSession({ api: a.api, store: s.store });
  await session.register({ email: 'a@b.com', password: 'pw', name: 'A' });
  assert.equal(session.getState().status, 'authenticated');
  assert.equal(s.value, 'refresh-register');
});

// 회귀 배경: 실기기에서 이메일/Google/Kakao/Naver 로그인이 전부 앱에는 "로그인됨"으로
// 보이는데, AI 분석은 모든 진입점에서 로그인 게이트가 떴다. 원인은 소셜 로그인이 로컬
// Account/isLoggedIn 플래그만 세우고 이 세션(useAuth().isAuthenticated)은 전혀 갱신하지
// 않았기 때문 — AI 게이트는 오직 이 세션만 본다. loginWithBridgeSession은 서버가 이미
// OAuth code 교환으로 검증한 bridge session_id를 실제 백엔드 인증 세션으로 바꿔, 로그인
// 수단과 무관하게 이 세션 하나로 통일한다.
test('loginWithBridgeSession: 성공 시 authenticated + refresh 저장(소셜 로그인도 같은 세션 사용)', async () => {
  const s = makeStore(null);
  const a = makeApi();
  const session = createSession({ api: a.api, store: s.store });
  const user = await session.loginWithBridgeSession('bridge-session-id-1', 'WorkProof ios');
  assert.equal(user.email, 'a@b.com');
  assert.equal(session.getState().status, 'authenticated');
  assert.equal(s.value, 'refresh-bridge');
  assert.equal(a.counts.exchangeBridgeSession, 1);
});

test('loginWithBridgeSession: bridgeSessionId/deviceLabel 을 그대로 API에 전달한다', async () => {
  const s = makeStore(null);
  let received: [string, string | undefined] | null = null;
  const a = makeApi({
    exchangeBridgeSession: async (bridgeSessionId, deviceLabel) => {
      received = [bridgeSessionId, deviceLabel];
      return makeSessionResp('bridge');
    },
  });
  const session = createSession({ api: a.api, store: s.store });
  await session.loginWithBridgeSession('sess-abc', 'WorkProof ios');
  assert.deepEqual(received, ['sess-abc', 'WorkProof ios']);
});

test('loginWithBridgeSession: 만료/무효 세션(API 오류)이면 unauthenticated 유지, 예외 전파', async () => {
  const s = makeStore(null);
  const a = makeApi({
    exchangeBridgeSession: async () => {
      throw new Error('세션을 찾을 수 없거나 만료됐어요.');
    },
  });
  const session = createSession({ api: a.api, store: s.store });
  await assert.rejects(() => session.loginWithBridgeSession('expired'), /만료/);
  assert.notEqual(session.getState().status, 'authenticated');
  assert.equal(s.value, null); // refresh 토큰 저장 안 됨
});

// ---------- refresh rotation ----------
test('refreshSession: 새 access 반환 + refresh 교체', async () => {
  const s = makeStore('refresh-0');
  const a = makeApi();
  const session = createSession({ api: a.api, store: s.store });
  await session.initialize(); // refresh-r1 저장, authenticated
  const access = await session.refreshSession();
  assert.equal(access, 'access-r2');
  assert.equal(s.value, 'refresh-r2');
});

// ---------- 동시 401 single-flight ----------
test('동시 401: refresh 는 한 번만 실행되고 요청은 재시도된다', async () => {
  const s = makeStore(null);
  let getMeCall = 0;
  const a = makeApi({
    async getMe() {
      getMeCall += 1;
      // 처음 두 번(동시)은 401, 이후 재시도는 성공
      if (getMeCall <= 2) throw unauthorized();
      return makeUser();
    },
  });
  const session = createSession({ api: a.api, store: s.store });
  await session.login({ email: 'a@b.com', password: 'pw' }); // access 확보

  const [u1, u2] = await Promise.all([session.getCurrentUser(), session.getCurrentUser()]);
  assert.equal(u1.email, 'a@b.com');
  assert.equal(u2.email, 'a@b.com');
  // 동시 401 두 건이 refresh 를 공유 → 한 번만 호출
  assert.equal(a.counts.refresh, 1);
  assert.equal(session.getState().status, 'authenticated');
});

// ---------- 401 재시도 후 다시 401 → 세션 정리 ----------
test('재시도 후에도 401 이면 세션 정리 + SessionExpiredError', async () => {
  const s = makeStore(null);
  const a = makeApi({
    async getMe() {
      throw unauthorized(); // 항상 401
    },
  });
  const session = createSession({ api: a.api, store: s.store });
  await session.login({ email: 'a@b.com', password: 'pw' });

  await assert.rejects(() => session.getCurrentUser(), SessionExpiredError);
  assert.equal(session.getState().status, 'unauthenticated');
  assert.ok(s.clearCount >= 1);
});

// ---------- refresh 자체 401(재사용/폐기) → 즉시 로그아웃 ----------
test('refresh 401(family 폐기)이면 즉시 로컬 세션 정리', async () => {
  const s = makeStore(null);
  let refreshCall = 0;
  const a = makeApi({
    async getMe() {
      throw unauthorized();
    },
    async refresh() {
      refreshCall += 1;
      throw unauthorized();
    },
  });
  const session = createSession({ api: a.api, store: s.store });
  await session.login({ email: 'a@b.com', password: 'pw' });

  await assert.rejects(() => session.getCurrentUser(), SessionExpiredError);
  assert.equal(refreshCall, 1);
  assert.equal(session.getState().status, 'unauthenticated');
  assert.equal(s.value, null);
});

// ---------- 네트워크 오류는 세션을 지우지 않음 ----------
test('refresh 네트워크 오류는 세션을 유지하고 오류를 전파', async () => {
  const s = makeStore(null);
  const a = makeApi({
    async getMe() {
      throw unauthorized();
    },
    async refresh() {
      throw new ApiError('network', '네트워크 오류');
    },
  });
  const session = createSession({ api: a.api, store: s.store });
  await session.login({ email: 'a@b.com', password: 'pw' });
  const beforeClear = s.clearCount;

  await assert.rejects(() => session.getCurrentUser(), (e: unknown) => {
    return e instanceof ApiError && e.kind === 'network';
  });
  // 일시 오류 → 로컬 정리하지 않음, 여전히 authenticated
  assert.equal(s.clearCount, beforeClear);
  assert.equal(session.getState().status, 'authenticated');
});

// ---------- 로그아웃 ----------
test('logout: 서버 폐기 + 로컬 정리 + unauthenticated', async () => {
  const s = makeStore(null);
  const a = makeApi();
  const session = createSession({ api: a.api, store: s.store });
  await session.login({ email: 'a@b.com', password: 'pw' });
  await session.logout();
  assert.equal(a.counts.logout, 1);
  assert.equal(a.lastLogoutToken, 'refresh-login');
  assert.equal(session.getState().status, 'unauthenticated');
  assert.equal(s.value, null);
});

test('logout: 서버 오류가 나도 로컬 세션은 정리한다', async () => {
  const s = makeStore(null);
  const a = makeApi({
    async logout() {
      throw new ApiError('network', '네트워크 오류');
    },
  });
  const session = createSession({ api: a.api, store: s.store });
  await session.login({ email: 'a@b.com', password: 'pw' });
  await session.logout(); // throw 하지 않아야 함
  assert.equal(session.getState().status, 'unauthenticated');
  assert.equal(s.value, null);
});

// ---------- 회원탈퇴 (204) ----------
test('deleteCurrentUser: 204 처리 후 세션 완전 정리', async () => {
  const s = makeStore(null);
  const a = makeApi(); // deleteMe 기본 구현은 undefined 반환(204)
  const session = createSession({ api: a.api, store: s.store });
  await session.login({ email: 'a@b.com', password: 'pw' });
  await session.deleteCurrentUser();
  assert.equal(a.counts.deleteMe, 1);
  assert.equal(session.getState().status, 'unauthenticated');
  assert.equal(s.value, null);
});

// ---------- 손상/빈 토큰 & SecureStore 오류 견고성 ----------
test('initialize: 빈 문자열 토큰은 없는 것으로 취급(refresh 미호출)', async () => {
  const s = makeStore('');
  const a = makeApi();
  const session = createSession({ api: a.api, store: s.store });
  await session.initialize();
  assert.equal(session.getState().status, 'unauthenticated');
  assert.equal(a.counts.refresh, 0);
});

test('initialize: SecureStore 읽기 예외에도 크래시 없이 unauthenticated', async () => {
  const store = {
    async get(): Promise<string | null> {
      throw new Error('keychain read failed');
    },
    async set() {},
    async clear() {},
  };
  const a = makeApi();
  const session = createSession({ api: a.api, store });
  await session.initialize(); // reject 하지 않아야 함
  assert.equal(session.getState().status, 'unauthenticated');
});

test('login: refresh 토큰 저장(store.set) 실패 시 인증 상태로 전환하지 않음', async () => {
  const store = {
    async get(): Promise<string | null> {
      return null;
    },
    async set() {
      throw new Error('keychain write failed');
    },
    async clear() {},
  };
  const a = makeApi();
  const session = createSession({ api: a.api, store });
  await assert.rejects(() => session.login({ email: 'a@b.com', password: 'pw' }));
  assert.notEqual(session.getState().status, 'authenticated');
});

test('single-flight: in-flight 중 두 번째 refreshSession 은 같은 실행을 공유', async () => {
  const s = makeStore(null);
  const a = makeApi();
  const session = createSession({ api: a.api, store: s.store });
  await session.login({ email: 'a@b.com', password: 'pw' });

  const p1 = session.refreshSession();
  const p2 = session.refreshSession(); // 아직 첫 refresh 진행 중
  const [t1, t2] = await Promise.all([p1, p2]);
  assert.equal(t1, t2);
  assert.equal(a.counts.refresh, 1); // 한 번만 실행
});

test('logout: store.clear 예외에도 unauthenticated 로 전환', async () => {
  let value: string | null = null;
  const store = {
    async get() {
      return value;
    },
    async set(t: string) {
      value = t;
    },
    async clear() {
      throw new Error('keychain delete failed');
    },
  };
  const a = makeApi();
  const session = createSession({ api: a.api, store });
  await session.login({ email: 'a@b.com', password: 'pw' });
  await session.logout(); // reject 하지 않아야 함
  assert.equal(session.getState().status, 'unauthenticated');
});
