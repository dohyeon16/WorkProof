// 인증 오류를 사용자에게 보여줄 한국어 문구로 바꾼다. ApiError/SessionExpiredError의
// message는 이미 사용자 노출용 안전 문자열(서버 detail 또는 상태별 폴백)이다.
import { ApiError } from '../../../core/api/errors';
import { SessionExpiredError } from '../state/session';

const DEFAULT_FALLBACK = '문제가 발생했어요. 잠시 후 다시 시도해주세요.';

export function authErrorMessage(err: unknown, fallback: string = DEFAULT_FALLBACK): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof SessionExpiredError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** 콜드 스타트/네트워크 지연 상황인지(안내 문구 분기용). */
export function isSlowNetworkError(err: unknown): boolean {
  return err instanceof ApiError && (err.kind === 'timeout' || err.kind === 'network');
}
