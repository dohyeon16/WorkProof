// 백엔드 HTTP 오류를 앱 전반에서 일관되게 다루기 위한 정규화 계층.
// 순수 모듈(RN/Expo/DOM 의존 없음) — node:test로 단독 검증한다.
//
// 보안: 이 계층은 요청 바디·토큰·비밀번호를 절대 담지 않는다. 서버가 준
// detail 문자열만 사용자에게 노출 가능한 값으로 보관한다(백엔드는 사용자
// 열거를 막기 위해 로그인 실패를 통합 메시지로 내려준다).

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP 오류(kind === 'http')일 때의 상태 코드. */
  readonly status?: number;
  /** 서버가 내려준 사용자 노출 가능한 detail 문자열(있으면). */
  readonly detail?: string;

  constructor(kind: ApiErrorKind, message: string, status?: number, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }

  /** 인증 만료/무효 — 401. 재발급(refresh) 판단에 쓴다. */
  get isUnauthorized(): boolean {
    return this.kind === 'http' && this.status === 401;
  }
}

const STATUS_FALLBACK: Record<number, string> = {
  400: '요청을 처리할 수 없어요.',
  401: '인증에 실패했어요.',
  403: '권한이 없어요.',
  404: '대상을 찾을 수 없어요.',
  409: '이미 존재하는 정보예요.',
  422: '입력값을 다시 확인해주세요.',
  429: '요청이 많아요. 잠시 후 다시 시도해주세요.',
  500: '서버에 문제가 생겼어요. 잠시 후 다시 시도해주세요.',
  503: '서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해주세요.',
};

// FastAPI HTTPException 은 { "detail": "..." }, 검증 오류(422)는
// { "detail": [{ loc, msg, type }, ...] } 를 내려준다. 전자만 사용자에게
// 그대로 보여줄 수 있는 안전한 문자열로 취급하고, 후자는 일반 안내로 바꾼다.
function extractDetail(rawBody: string): string | undefined {
  if (!rawBody) return undefined;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
      const detail = (parsed as { detail: unknown }).detail;
      if (typeof detail === 'string' && detail.trim()) return detail.trim();
    }
  } catch {
    // JSON이 아니거나(프록시 HTML 오류 페이지 등) 형식이 달라도 무시한다.
  }
  return undefined;
}

/** HTTP 오류 응답을 ApiError로 정규화한다. 상태 코드와 (있으면) detail을 보존한다. */
export function normalizeHttpError(status: number, rawBody: string): ApiError {
  const detail = extractDetail(rawBody);
  const message = detail ?? STATUS_FALLBACK[status] ?? `요청이 실패했어요. (${status})`;
  return new ApiError('http', message, status, detail);
}

/** fetch 자체가 실패(네트워크 단절 등)했을 때. */
export function networkError(): ApiError {
  return new ApiError('network', '네트워크에 연결할 수 없어요. 연결 상태를 확인해주세요.');
}

/** 타임아웃(느린 콜드 스타트 등). */
export function timeoutError(): ApiError {
  return new ApiError(
    'timeout',
    '서버 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요.'
  );
}
