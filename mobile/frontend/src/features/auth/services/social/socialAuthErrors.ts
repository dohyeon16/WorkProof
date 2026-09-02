// 소셜 로그인 오류의 단일 변환 지점.
//
// 배경(실기기 회귀): provider/OAuth 원문이 그대로 사용자에게 표시됐다. 카카오 실패 시
// "Client authentication failed", "Bad client credentials", "HTTP 401", "WWW-Authenticate"
// 같은 OAuth 규격 문구가 다이얼로그에 그대로 떠서, 무슨 일인지 알 수 없는 데다 모달이
// 화면을 가득 채웠다. 원인은 각 provider 모듈이 `err.message` 를 그대로 실어 보내고
// (11곳) 화면이 그것을 그대로 Alert 에 넣은 것(2곳)이다.
//
// 정책:
//  - 사용자에게는 원인별 짧은 한국어 문장만 보여준다(제목 + 1~2줄).
//  - 기술 상세는 code + logDetail 로 남겨 개발 로그에서만 진단한다.
//  - credential/token/code 값은 code 판정에도, 로그에도 담지 않는다.

export type SocialAuthErrorCode =
  | 'CANCELLED'
  | 'NOT_CONFIGURED'
  | 'PROVIDER_CONFIG'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_CONFLICT'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNKNOWN';

/** provider 원문에서 절대 사용자에게 보이면 안 되는 신호들. 로그용 판정에만 쓴다. */
const CLIENT_AUTH_SIGNALS = [
  'bad client credentials',
  'client authentication failed',
  'invalid_client',
  'unauthorized_client',
  'invalid client',
  'www-authenticate',
];
const NETWORK_SIGNALS = ['network request failed', 'network error', 'failed to fetch', 'enotfound', 'econnrefused'];
const TIMEOUT_SIGNALS = ['timeout', 'timed out', 'aborted'];
const CANCEL_SIGNALS = ['cancel', 'user_cancelled', 'dismiss'];

function haystack(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err.toLowerCase();
  if (err instanceof Error) return `${err.name} ${err.message}`.toLowerCase();
  try {
    return JSON.stringify(err).toLowerCase();
  } catch {
    return String(err).toLowerCase();
  }
}

/** 원문을 코드로 분류한다. 원문 자체는 절대 반환하지 않는다. */
export function classifySocialError(err: unknown): SocialAuthErrorCode {
  const s = haystack(err);
  if (!s) return 'UNKNOWN';
  if (CANCEL_SIGNALS.some((k) => s.includes(k))) return 'CANCELLED';
  if (CLIENT_AUTH_SIGNALS.some((k) => s.includes(k))) return 'PROVIDER_CONFIG';
  if (TIMEOUT_SIGNALS.some((k) => s.includes(k))) return 'TIMEOUT';
  if (NETWORK_SIGNALS.some((k) => s.includes(k))) return 'NETWORK';
  if (s.includes('401') || s.includes('403')) return 'PROVIDER_CONFIG';
  if (s.includes('500') || s.includes('502') || s.includes('503') || s.includes('504')) {
    return 'PROVIDER_UNAVAILABLE';
  }
  return 'UNKNOWN';
}

const PROVIDER_LABEL: Record<string, string> = { google: '구글', kakao: '카카오', naver: '네이버' };

/**
 * 사용자에게 보여줄 문장. 짧게 유지한다 — 긴 원문이 모달을 가득 채우던 문제를 막는다.
 * provider 는 문장 안에서 자연스럽게 쓰기 위한 라벨로만 쓴다.
 */
export function socialErrorMessage(provider: string, code: SocialAuthErrorCode): string {
  const label = PROVIDER_LABEL[provider] ?? '소셜';
  switch (code) {
    case 'CANCELLED':
      return '로그인이 취소되었어요.';
    case 'NOT_CONFIGURED':
      return `${label} 로그인이 아직 준비되지 않았어요.`;
    case 'PROVIDER_CONFIG':
      return `${label} 로그인 설정을 확인할 수 없어요.\n잠시 후 다시 시도해주세요.`;
    case 'NETWORK':
      return '네트워크 연결을 확인해주세요.';
    case 'TIMEOUT':
      return '응답이 지연되고 있어요.\n잠시 후 다시 시도해주세요.';
    case 'SESSION_EXPIRED':
      return '로그인이 만료되었어요.\n다시 로그인해주세요.';
    case 'ACCOUNT_CONFLICT':
      return '이미 가입된 계정이에요.';
    case 'PROVIDER_UNAVAILABLE':
      return `${label} 서버가 일시적으로 불안정해요.\n잠시 후 다시 시도해주세요.`;
    default:
      return '로그인에 실패했어요.\n잠시 후 다시 시도해주세요.';
  }
}

/**
 * 개발 로그용 요약. status/코드/단계만 남기고 원문은 길이만 기록한다 —
 * provider 응답에 credential 이 섞여 들어오더라도 로그에 남지 않게 한다.
 */
export function describeForLog(provider: string, stage: string, err: unknown): string {
  const code = classifySocialError(err);
  const name = err instanceof Error ? err.name : typeof err;
  const len = haystack(err).length;
  return `[social:${provider}] stage=${stage} code=${code} errName=${name} rawLen=${len}`;
}
