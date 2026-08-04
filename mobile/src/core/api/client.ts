// 타입 안전 JSON API 클라이언트. fetch를 감싸 타임아웃·오류 정규화·Bearer 헤더를
// 한곳에서 처리한다.
//
// 보안 원칙:
//  - 요청/응답 바디, 토큰, 비밀번호를 로그에 남기지 않는다.
//  - 개발 로그도 메서드·경로·상태 코드만 남긴다(민감 정보 redaction).
//  - refresh 엔드포인트에는 이 클라이언트가 자동 재시도를 걸지 않는다
//    (재시도/single-flight는 session 계층이 담당) — 무한 루프 방지.
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

function devLog(method: HttpMethod, path: string, status: number | 'network' | 'timeout'): void {
  // 민감 정보 없이 요청 결과만 남긴다. __DEV__ 는 RN 런타임 전역.
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[api] ${method} ${path} -> ${status}`);
  }
}

export function createApiClient(baseUrl: string = API_BASE_URL): ApiClient {
  const root = baseUrl.replace(/\/+$/, '');

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const url = `${root}${API_V1_PREFIX}${path}`;

    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.accessToken) headers['Authorization'] = `Bearer ${opts.accessToken}`;

    let response: Response;
    try {
      response = await fetch(url, {
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
