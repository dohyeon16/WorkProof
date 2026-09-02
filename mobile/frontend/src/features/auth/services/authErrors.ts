// 인증 오류를 사용자에게 보여줄 한국어 문구로 바꾼다. ApiError/SessionExpiredError의
// message는 이미 사용자 노출용 안전 문자열(서버 detail 또는 상태별 폴백)이다.
import { ApiError } from '../../../services/api/errors';
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

/**
 * 소셜 로그인은 성공했지만 백엔드 세션 교환(/auth/bridge/exchange)이 실패한 경우의 안내.
 *
 * 이 상태에서는 앱 로그인은 되어 있지만 백엔드 인증 세션이 없어, AI 분석처럼 서버
 * 프록시가 필요한 기능만 "로그인 필요"로 막힌다. 예전에는 이 실패를 console.warn 으로
 * 삼키고 "로그인 완료"만 띄웠기 때문에, 사용자는 분명히 로그인했는데 AI 분석에서만
 * 로그인을 다시 요구받는 이유를 알 수 없었다. 원인을 있는 그대로 알려준다.
 */
export const SOCIAL_BACKEND_SESSION_FAILED = {
  title: '로그인은 됐지만 서버 연결이 지연됐어요',
  message:
    '앱 로그인은 완료됐어요. 다만 서버 세션 연결이 끝나지 않아 AI 분석은 아직 사용할 수 없어요.' +
    '\n' +
    '잠시 후 다시 로그인하면 AI 분석까지 바로 사용할 수 있어요.',
} as const;
