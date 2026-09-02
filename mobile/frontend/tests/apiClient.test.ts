// API 클라이언트 순수 검증(node:test). fetch를 주입해 URL 결합/헤더/204/오류
// 정규화/redaction/타임아웃/네트워크 처리를 DOM 없이 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient, type FetchLike } from '../src/services/api/client';
import { ApiError } from '../src/services/api/errors';

interface FakeResponse {
  ok: boolean;
  status: number;
  bodyText?: string;
  bodyJson?: unknown;
  jsonThrows?: boolean;
}

interface Recorded {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function fakeFetch(resp: FakeResponse | (() => never), recorder?: Recorded[]): FetchLike {
  return async (url, init) => {
    recorder?.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    if (typeof resp === 'function') resp();
    const r = resp as FakeResponse;
    return {
      ok: r.ok,
      status: r.status,
      async text() {
        return r.bodyText ?? '';
      },
      async json() {
        if (r.jsonThrows) throw new Error('invalid json');
        return r.bodyJson;
      },
    };
  };
}

const BASE = 'https://preview.example.com';

test('URL: base trailing slash + /api/v1 + path 를 단일 슬래시로 결합', async () => {
  const rec: Recorded[] = [];
  const client = createApiClient(`${BASE}/`, fakeFetch({ ok: true, status: 200, bodyJson: {} }, rec));
  await client.request('/auth/login', { method: 'POST', body: { a: 1 } });
  assert.equal(rec[0].url, 'https://preview.example.com/api/v1/auth/login');
});

test('URL: 앞 슬래시 없는 path 도 이중 슬래시 없이 결합', async () => {
  const rec: Recorded[] = [];
  const client = createApiClient(BASE, fakeFetch({ ok: true, status: 200, bodyJson: {} }, rec));
  await client.request('users/me');
  assert.equal(rec[0].url, 'https://preview.example.com/api/v1/users/me');
  assert.ok(!rec[0].url.includes('/api/v1//'));
});

test('헤더: body 있으면 Content-Type, accessToken 있으면 Bearer', async () => {
  const rec: Recorded[] = [];
  const client = createApiClient(BASE, fakeFetch({ ok: true, status: 200, bodyJson: {} }, rec));
  await client.request('/users/me', { method: 'PATCH', body: { name: 'x' }, accessToken: 'AT' });
  assert.equal(rec[0].headers?.['Content-Type'], 'application/json');
  assert.equal(rec[0].headers?.['Authorization'], 'Bearer AT');
});

test('헤더: body 없으면 Content-Type 미설정', async () => {
  const rec: Recorded[] = [];
  const client = createApiClient(BASE, fakeFetch({ ok: true, status: 200, bodyJson: {} }, rec));
  await client.request('/users/me', { accessToken: 'AT' });
  assert.equal(rec[0].headers?.['Content-Type'], undefined);
});

test('204: 바디 파싱 없이 undefined 반환', async () => {
  const client = createApiClient(BASE, fakeFetch({ ok: true, status: 204 }));
  const out = await client.request<void>('/users/me', { method: 'DELETE', expectNoContent: true });
  assert.equal(out, undefined);
});

test('성공 200: JSON 파싱 반환', async () => {
  const client = createApiClient(BASE, fakeFetch({ ok: true, status: 200, bodyJson: { id: 'u1' } }));
  const out = await client.request<{ id: string }>('/users/me', { accessToken: 'AT' });
  assert.equal(out.id, 'u1');
});

test('HTTP 오류: ApiError(status+detail)로 정규화, 토큰/바디 미포함(redaction)', async () => {
  const client = createApiClient(
    BASE,
    fakeFetch({ ok: false, status: 409, bodyText: JSON.stringify({ detail: '이미 가입된 이메일이에요.' }) })
  );
  await assert.rejects(
    () => client.request('/auth/register', { method: 'POST', body: { password: 'super-secret' }, accessToken: 'AT' }),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 409);
      assert.equal(e.detail, '이미 가입된 이메일이에요.');
      // 민감값이 오류에 새지 않아야 한다.
      const serialized = `${e.message} ${e.detail ?? ''} ${(e as Error).stack ?? ''}`;
      assert.ok(!serialized.includes('super-secret'));
      assert.ok(!serialized.includes('Bearer'));
      assert.ok(!serialized.includes('AT'));
      return true;
    }
  );
});

test('성공인데 JSON 아님: ApiError(parse)', async () => {
  const client = createApiClient(BASE, fakeFetch({ ok: true, status: 200, jsonThrows: true }));
  await assert.rejects(
    () => client.request('/users/me', { accessToken: 'AT' }),
    (e: unknown) => e instanceof ApiError && e.kind === 'parse'
  );
});

test('네트워크 실패: ApiError(network)', async () => {
  const client = createApiClient(BASE, fakeFetch(() => {
    throw new Error('connection refused');
  }));
  await assert.rejects(
    () => client.request('/users/me'),
    (e: unknown) => e instanceof ApiError && e.kind === 'network'
  );
});

test('타임아웃(AbortError): ApiError(timeout)', async () => {
  const client = createApiClient(BASE, fakeFetch(() => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }));
  await assert.rejects(
    () => client.request('/users/me', { timeoutMs: 10 }),
    (e: unknown) => e instanceof ApiError && e.kind === 'timeout'
  );
});
