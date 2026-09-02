// Phase 4C-2 AI 프록시 전환 자동 검증(node:test, RN/Expo 의존 없음).
//
// 정책 커버리지:
//  - 비로그인 새 OCR → provider 요청 0회 + 로그인 게이트
//  - 비로그인에서도 기존 저장 결과 열람은 인증 불필요
//  - 로그인 OCR/요약 → 프록시(/ai/*) 호출(직접 provider URL 0)
//  - 만료 access → refresh 성공 시 1회 재시도 / refresh 실패 → 로그인 필요(무한 retry 없음)
//  - social/local-only(백엔드 토큰 없음) → unauthenticated 취급
import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../src/core/api/errors';
import { createApiClient, type FetchLike, type ApiClient } from '../src/core/api/client';
import { createSession, SessionExpiredError } from '../src/features/auth/state/session';
import type { AuthSession, RefreshTokenStore, SessionApi } from '../src/features/auth/types';
import { createAiRemote, type AiRemote } from '../src/features/evidence/services/ai/aiProxyApi';
import { summarizeContractText } from '../src/features/evidence/services/ai/geminiSummary';
import { mapOcrApiError, OCR_EMPTY_MESSAGE, isUnsupportedOcrMimeType } from '../src/ocr/ocrError';
import {
  AI_LOGIN_GATE,
  requiresLoginForNewAnalysis,
  VIEW_SAVED_ANALYSIS_REQUIRES_LOGIN,
} from '../src/features/evidence/services/ai/aiAccess';

// ---------- 공통 fake ----------
interface Recorded {
  path: string;
  method?: string;
  body?: unknown;
  accessToken?: string;
}

/** ApiClient 대역 — request 호출을 기록하고 정해진 값을 돌려주거나 던진다. */
function fakeClient(handler: (rec: Recorded) => unknown): { client: ApiClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client: ApiClient = {
    async request<T>(path: string, opts: { method?: string; body?: unknown; accessToken?: string } = {}) {
      const rec: Recorded = { path, method: opts.method, body: opts.body, accessToken: opts.accessToken };
      calls.push(rec);
      const out = handler(rec);
      if (out instanceof Error) throw out;
      return out as T;
    },
  };
  return { client, calls };
}

// ========== A. createAiRemote: 프록시 호출 형태 ==========
test('로그인 OCR → POST /ai/ocr (content_base64/mime_type, Bearer)', async () => {
  const { client, calls } = fakeClient(() => ({ text: 'HELLO WORLD' }));
  const remote = createAiRemote(client, (run) => run('AT'));
  const text = await remote.ocr('BASE64DATA', 'image/png');
  assert.equal(text, 'HELLO WORLD');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/ai/ocr');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { content_base64: 'BASE64DATA', mime_type: 'image/png' });
  assert.equal(calls[0].accessToken, 'AT');
});

test('로그인 요약 → POST /ai/summarize (text, Bearer)', async () => {
  const { client, calls } = fakeClient(() => ({ summary: '요약본' }));
  const remote = createAiRemote(client, (run) => run('AT'));
  const summary = await remote.summarize('원문 텍스트');
  assert.equal(summary, '요약본');
  assert.equal(calls[0].path, '/ai/summarize');
  assert.deepEqual(calls[0].body, { text: '원문 텍스트' });
});

test('로그인 급여명세서 구조화 → POST /ai/extract-payslip (ocr_text, Bearer)', async () => {
  const { client, calls } = fakeClient(() => ({ raw: '{"basePay":1000000}' }));
  const remote = createAiRemote(client, (run) => run('AT'));
  const raw = await remote.extractPayslip('명세서 OCR 텍스트');
  assert.equal(raw, '{"basePay":1000000}');
  assert.equal(calls[0].path, '/ai/extract-payslip');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { ocr_text: '명세서 OCR 텍스트' });
  assert.equal(calls[0].accessToken, 'AT');
});

test('remote 는 오직 /ai/* 경로만 호출한다(직접 provider URL 0)', async () => {
  const { client, calls } = fakeClient((rec) =>
    rec.path === '/ai/ocr' ? { text: 't' } : rec.path === '/ai/summarize' ? { summary: 's' } : { raw: '{}' }
  );
  const remote = createAiRemote(client, (run) => run('AT'));
  await remote.ocr('B', 'image/png');
  await remote.summarize('x');
  await remote.extractPayslip('y');
  for (const c of calls) {
    assert.ok(
      c.path === '/ai/ocr' || c.path === '/ai/summarize' || c.path === '/ai/extract-payslip',
      `unexpected path ${c.path}`
    );
    assert.ok(!c.path.includes('googleapis'), 'must not call provider URL directly');
  }
});

test('비로그인(authorized 가 SessionExpiredError) → provider 요청 0회', async () => {
  const { client, calls } = fakeClient(() => ({ text: 'should-not-happen' }));
  const remote = createAiRemote(client, async () => {
    throw new SessionExpiredError();
  });
  await assert.rejects(() => remote.ocr('B', 'image/png'), (e) => e instanceof SessionExpiredError);
  assert.equal(calls.length, 0); // client.request(프록시) 자체가 호출되지 않음
});

// ========== B. geminiSummary 매핑 ==========
function remoteWith(summarize: (t: string) => Promise<string>): AiRemote {
  return { ocr: async () => '', summarize, extractPayslip: async () => '' };
}

test('요약 성공 → success', async () => {
  const r = remoteWith(async () => '  정리된 요약  ');
  const res = await summarizeContractText(r, 'text');
  assert.deepEqual(res, { status: 'success', summary: '정리된 요약' });
});

test('요약 입력 12000자 초과분은 잘라서 보낸다', async () => {
  let received = '';
  const r = remoteWith(async (t) => {
    received = t;
    return 'ok';
  });
  await summarizeContractText(r, 'a'.repeat(13000));
  assert.equal(received.length, 12000);
});

test('빈 입력 → provider 미호출 + GEMINI_CONFIG_ERROR', async () => {
  let called = false;
  const r = remoteWith(async () => {
    called = true;
    return 'x';
  });
  const res = await summarizeContractText(r, '   ');
  assert.equal(called, false);
  assert.equal(res.status === 'error' && res.code, 'GEMINI_CONFIG_ERROR');
});

test('요약 빈 결과 → GEMINI_EMPTY', async () => {
  const res = await summarizeContractText(remoteWith(async () => '   '), 'text');
  assert.equal(res.status === 'error' && res.code, 'GEMINI_EMPTY');
});

test('요약 ApiError 매핑: 503→not_configured, 429→RATE_LIMIT, 422→EMPTY, 500→SERVER, network→NETWORK', async () => {
  const cases: [ApiError, string][] = [
    [new ApiError('http', 'x', 503), 'not_configured'],
    [new ApiError('http', 'x', 429), 'GEMINI_RATE_LIMIT'],
    [new ApiError('http', 'x', 422), 'GEMINI_EMPTY'],
    [new ApiError('http', 'x', 500), 'GEMINI_SERVER_ERROR'],
    [new ApiError('network', 'x'), 'GEMINI_NETWORK_ERROR'],
  ];
  for (const [err, expected] of cases) {
    const res = await summarizeContractText(
      remoteWith(async () => {
        throw err;
      }),
      'text'
    );
    const got = res.status === 'not_configured' ? 'not_configured' : res.status === 'error' ? res.code : 'success';
    assert.equal(got, expected);
  }
});

test('요약 중 SessionExpiredError 는 그대로 전파(상위가 로그인 게이트로 변환)', async () => {
  const r = remoteWith(async () => {
    throw new SessionExpiredError();
  });
  await assert.rejects(() => summarizeContractText(r, 'text'), (e) => e instanceof SessionExpiredError);
});

// ========== C. OCR 오류 매핑(mapOcrApiError) ==========
// 회귀 배경: 실기기 Issue 1 — OCR 단계에서 429/네트워크/타임아웃/5xx 가 모두 하나의
// 코드로 뭉뚱그려져 화면에 "사진 상태를 확인해주세요"로만 보였다(서버/네트워크 문제인데도
// 사진 문제로 오인). 아래는 각 HTTP 상태가 서로 다른 코드로 갈리는지 확정하는 회귀 가드다.
test('OCR ApiError 매핑: 401→request_failed(그대로 실패, 인증은 상위 runAuthorized 담당)', () => {
  const e401 = mapOcrApiError(new ApiError('http', '인증 실패', 401));
  assert.equal(e401.status === 'error' && e401.code, 'request_failed');
});

test('OCR ApiError 매핑: 422→empty(사진 화질 문제로 안내)', () => {
  const e422 = mapOcrApiError(new ApiError('http', 'x', 422));
  assert.equal(e422.status === 'error' && e422.code, 'empty');
  assert.equal(e422.status === 'error' && e422.message, OCR_EMPTY_MESSAGE);
});

test('OCR ApiError 매핑: 415→request_failed(서버 안내 문구 사용)', () => {
  const e415 = mapOcrApiError(new ApiError('http', 'msg', 415, '이미지 또는 PDF만 처리할 수 있어요.'));
  assert.equal(e415.status === 'error' && e415.code, 'request_failed');
  assert.equal(e415.status === 'error' && e415.message, '이미지 또는 PDF만 처리할 수 있어요.');
});

test('OCR ApiError 매핑: 429→rate_limit(사진 문제 아님 — 재시도 안내)', () => {
  const e429 = mapOcrApiError(new ApiError('http', 'x', 429));
  assert.equal(e429.status === 'error' && e429.code, 'rate_limit');
});

test('OCR ApiError 매핑: 500/502/504→server_error, network kind→network, timeout kind→server_error', () => {
  for (const status of [500, 502, 504]) {
    const e = mapOcrApiError(new ApiError('http', 'x', status));
    assert.equal(e.status === 'error' && e.code, 'server_error', `status=${status}`);
  }
  const eNet = mapOcrApiError(new ApiError('network', 'x'));
  assert.equal(eNet.status === 'error' && eNet.code, 'network');
  const eTimeout = mapOcrApiError(new ApiError('timeout', 'x'));
  assert.equal(eTimeout.status === 'error' && eTimeout.code, 'server_error');
});

test('OCR ApiError 매핑: 503→not_configured', () => {
  assert.deepEqual(mapOcrApiError(new ApiError('http', 'x', 503)), { status: 'not_configured' });
});

// ========== C2. HEIC/HEIF 사전 차단(isUnsupportedOcrMimeType) ==========
// 회귀 배경: iPhone 사진 보관함 기본 형식(HEIC)은 Google Vision 이 디코드하지 못해
// 업스트림 오류로 이어지고, 이 역시 "사진 상태 확인" 문구로만 보여 원인을 오인하게 했다.
test('HEIC/HEIF는 지원하지 않는 형식으로 판정한다(대소문자 무관)', () => {
  assert.equal(isUnsupportedOcrMimeType('image/heic'), true);
  assert.equal(isUnsupportedOcrMimeType('image/HEIC'), true);
  assert.equal(isUnsupportedOcrMimeType('image/heif'), true);
});

test('JPEG/PNG/WEBP/PDF는 지원 형식으로 판정한다(HEIC 오탐 없음)', () => {
  assert.equal(isUnsupportedOcrMimeType('image/jpeg'), false);
  assert.equal(isUnsupportedOcrMimeType('image/png'), false);
  assert.equal(isUnsupportedOcrMimeType('image/webp'), false);
  assert.equal(isUnsupportedOcrMimeType('application/pdf'), false);
});

// ========== D. 접근 정책(aiAccess) ==========
test('새 분석은 비로그인만 게이트, 저장 결과 열람은 인증 불필요', () => {
  assert.equal(requiresLoginForNewAnalysis(true), false);
  assert.equal(requiresLoginForNewAnalysis(false), true);
  assert.equal(VIEW_SAVED_ANALYSIS_REQUIRES_LOGIN, false);
});

test('로그인 게이트 문구/버튼 존재', () => {
  assert.ok(AI_LOGIN_GATE.message.includes('로그인'));
  assert.equal(AI_LOGIN_GATE.confirmLabel, '로그인하고 AI 분석하기');
  assert.equal(AI_LOGIN_GATE.cancelLabel, '나중에');
});

// ========== E. 실제 runAuthorized 연동(만료/refresh) ==========
function makeStore(initial: string | null = null): RefreshTokenStore {
  let value = initial;
  return {
    async get() {
      return value;
    },
    async set(t: string) {
      value = t;
    },
    async clear() {
      value = null;
    },
  };
}

function sessionResp(tag: string): AuthSession {
  return {
    accessToken: `access-${tag}`,
    refreshToken: `refresh-${tag}`,
    expiresIn: 900,
    user: { id: 'u1', email: 'a@b.com', name: 'A', primaryProvider: 'email', createdAt: '', updatedAt: '' },
  };
}

/** /ai/ocr 응답을 Authorization 토큰별로 정하는 주입 fetch. */
function aiFetch(byToken: (token: string | undefined) => { status: number; body: unknown }, seen: string[]): FetchLike {
  return async (_url, init) => {
    const auth = init?.headers?.['Authorization'];
    const token = auth?.replace('Bearer ', '');
    seen.push(token ?? '(none)');
    const { status, body } = byToken(token);
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return JSON.stringify(body);
      },
      async json() {
        return body;
      },
    };
  };
}

test('만료 access → refresh 성공 → 1회 재시도로 성공', async () => {
  const store = makeStore(null);
  const refreshCalls: number[] = [];
  const api: SessionApi = {
    async register() {
      return sessionResp('reg');
    },
    async login() {
      return sessionResp('login');
    },
    async exchangeBridgeSession() {
      return sessionResp('bridge');
    },
    async refresh() {
      refreshCalls.push(1);
      return sessionResp('r1'); // 새 access-r1
    },
    async logout() {},
    async getMe() {
      return sessionResp('x').user;
    },
    async updateMe() {
      return sessionResp('x').user;
    },
    async deleteMe() {},
  };
  const session = createSession({ api, store });
  await session.login({ email: 'a@b.com', password: 'pw' }); // access-login 확보

  const seen: string[] = [];
  const fetchImpl = aiFetch(
    (t) => (t === 'access-login' ? { status: 401, body: { detail: '인증 실패' } } : { status: 200, body: { text: 'OK' } }),
    seen
  );
  const remote = createAiRemote(createApiClient('https://x.example', fetchImpl), session.runAuthorized);

  const text = await remote.ocr('B', 'image/png');
  assert.equal(text, 'OK');
  assert.equal(seen.length, 2); // 만료 1회 + 재시도 1회
  assert.equal(seen[1], 'access-r1');
  assert.equal(refreshCalls.length, 1);
});

test('refresh 실패 → SessionExpiredError + unauthenticated(무한 retry 없음)', async () => {
  const store = makeStore(null);
  const api: SessionApi = {
    async register() {
      return sessionResp('reg');
    },
    async login() {
      return sessionResp('login');
    },
    async exchangeBridgeSession() {
      return sessionResp('bridge');
    },
    async refresh() {
      throw new ApiError('http', '인증 실패', 401); // isUnauthorized
    },
    async logout() {},
    async getMe() {
      return sessionResp('x').user;
    },
    async updateMe() {
      return sessionResp('x').user;
    },
    async deleteMe() {},
  };
  const session = createSession({ api, store });
  await session.login({ email: 'a@b.com', password: 'pw' });

  const seen: string[] = [];
  const fetchImpl = aiFetch(() => ({ status: 401, body: { detail: '인증 실패' } }), seen);
  const remote = createAiRemote(createApiClient('https://x.example', fetchImpl), session.runAuthorized);

  await assert.rejects(() => remote.ocr('B', 'image/png'), (e) => e instanceof SessionExpiredError);
  assert.equal(seen.length, 1); // 최초 401 이후 refresh 실패 → 재시도 없음
  assert.equal(session.getState().status, 'unauthenticated');
  assert.equal(requiresLoginForNewAnalysis(false), true); // 이후 새 분석은 게이트
});

test('social/local-only(백엔드 refresh 토큰 없음) → provider 0회 + SessionExpiredError', async () => {
  const store = makeStore(null); // 백엔드 세션 없음
  const api: SessionApi = {
    async register() {
      return sessionResp('reg');
    },
    async login() {
      return sessionResp('login');
    },
    async exchangeBridgeSession() {
      return sessionResp('bridge');
    },
    async refresh() {
      return sessionResp('r');
    },
    async logout() {},
    async getMe() {
      return sessionResp('x').user;
    },
    async updateMe() {
      return sessionResp('x').user;
    },
    async deleteMe() {},
  };
  const session = createSession({ api, store }); // login 하지 않음 = 백엔드 미인증
  const seen: string[] = [];
  const remote = createAiRemote(
    createApiClient('https://x.example', aiFetch(() => ({ status: 200, body: { text: 'x' } }), seen)),
    session.runAuthorized
  );
  await assert.rejects(() => remote.ocr('B', 'image/png'), (e) => e instanceof SessionExpiredError);
  assert.equal(seen.length, 0); // 프록시/ provider 요청 자체가 없음
});
