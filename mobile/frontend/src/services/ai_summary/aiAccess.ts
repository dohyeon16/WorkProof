// AI 분석 접근 정책(순수) — Phase 4C-2.
//
// 정책(사용자 확정):
//  - 새 OCR/AI provider 요청만 인증이 필요하다.
//  - 이미 기기에 저장된 분석 결과(ocrText/aiSummary)의 "열람"은 인증이 필요 없다.
//  - backend access token 이 없는 social/local-only 로그인은 proxy 관점에서
//    unauthenticated 로 취급한다(= isAuthenticated 가 false). 우회 토큰을 만들지 않는다.
//
// 이 모듈은 RN 의존이 없어 node:test 로 정책을 고정 검증한다.

/** 새 OCR/AI 분석을 시작하려면 로그인(백엔드 세션)이 필요한가. */
export function requiresLoginForNewAnalysis(isAuthenticated: boolean): boolean {
  return !isAuthenticated;
}

/**
 * 저장된 분석 결과 열람에 로그인이 필요한가 — 정책상 언제나 false.
 * (기존 결과를 보려고 로그인하게 만들지 않는다.)
 */
export const VIEW_SAVED_ANALYSIS_REQUIRES_LOGIN = false;

/** 비로그인 사용자가 새 AI 분석을 누르면 보여줄 로그인 유도 문구/버튼. */
export const AI_LOGIN_GATE = {
  // 제목과 본문이 같은 문장을 반복하지 않는다 — 제목은 상태, 본문은 이유/이득만 말한다.
  title: 'AI 분석은 로그인이 필요해요',
  message: '로그인하면 첨부한 문서를 안전하게 분석할 수 있어요.',
  confirmLabel: '로그인하고 분석하기',
  cancelLabel: '나중에',
} as const;
