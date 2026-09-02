// 타입 안전 JSON API 클라이언트. fetch를 감싸 타임아웃·오류 정규화·Bearer 헤더를
// 한곳에서 처리한다.
//
// 보안 원칙:
//  - 요청/응답 바디, 토큰, 비밀번호를 로그에 남기지 않는다.
//  - 개발 로그도 메서드·경로·상태 코드만 남긴다(민감 정보 redaction).
//  - refresh 엔드포인트에는 이 클라이언트가 자동 재시도를 걸지 않는다
//    (재시도/single-flight는 session 계층이 담당) — 무한 루프 방지.
//
// 테스트 용이성: fetch를 주입할 수 있게 하고 DOM 전역 타입(Response/fetch)에
// 직접 의존하지 않는다 — 그래야 node:test(순수, DOM lib 없음)에서 검증 가능하다.
import { API_BASE_URL, API_V1_PREFIX, DEFAULT_TIMEOUT_MS } from './config';
import { ApiError, networkError, normalizeHttpError, timeoutError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** JSON 직렬화될 요청 바디. */
  body?: unknown;
  /** Authorization: Bearer 로 실릴 access 토큰. */
  accessToken?: string;
  /** 이 요청만의 타임아웃(ms). 미지정 시 DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** 204 등 바디 없는 응답을 기대할 때. 파싱을 건너뛰고 undefined를 돌려준다. */
  expectNoContent?: boolean;
}

export interface ApiClient {
  request<T>(path: string, opts?: RequestOptions): Promise<T>;
}

// fetch/Response의 최소 표면만 선언해 DOM lib 없이도 컴파일된다(RN·node 양쪽 호환).
interface ResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: unknown;
}
export type FetchLike = (url: string, init?: RequestInitLike) => Promise<ResponseLike>;

// __DEV__ 전역을 타입 참조 없이 안전하게 읽는다(RN에선 true/false, node 테스트에선 undefined).
function isDev(): boolean {
  return Boolean((globalThis as { __DEV__?: boolean }).__DEV__);
}

function devLog(method: HttpMethod, path: string, status: number | 'network' | 'timeout'): void {
  // 민감 정보 없이 요청 결과만 남긴다.
  if (isDev()) {
    // eslint-disable-next-line no-console
    console.log(`[api] ${method} ${path} -> ${status}`);
  }
}

// path 앞의 슬래시 유무와 상관없이 정확히 하나의 슬래시로 결합한다(이중 슬래시 방지).
function joinUrl(root: string, prefix: string, path: string): string {
  const base = `${root}${prefix}`.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function createApiClient(
  baseUrl: string = API_BASE_URL,
  fetchImpl?: FetchLike
): ApiClient {
  // 주입이 없으면 전역 fetch를 쓴다(RN 런타임). trailing slash는 여기서 한 번 더 정규화.
  const doFetch: FetchLike =
    fetchImpl ?? ((globalThis as { fetch: FetchLike }).fetch);
  const root = baseUrl.replace(/\/+$/, '');

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const url = joinUrl(root, API_V1_PREFIX, path);

    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.accessToken) headers['Authorization'] = `Bearer ${opts.accessToken}`;

    let response: ResponseLike;
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      // AbortController.abort() 로 인한 중단은 타임아웃으로 구분한다.
      if (err instanceof Error && err.name === 'AbortError') {
        devLog(method, path, 'timeout');
        throw timeoutError();
      }
      devLog(method, path, 'network');
      throw networkError();
    }
    clearTimeout(timer);

    devLog(method, path, response.status);

    if (!response.ok) {
      // 오류 바디는 detail 추출에만 쓰고 로그에는 남기지 않는다.
      let rawBody = '';
      try {
        rawBody = await response.text();
      } catch {
        rawBody = '';
      }
      throw normalizeHttpError(response.status, rawBody);
    }

    if (opts.expectNoContent || response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError('parse', '서버 응답을 해석하지 못했어요.');
    }
  }

  return { request };
}
