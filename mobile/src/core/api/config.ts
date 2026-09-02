// 백엔드 API 기본 주소. Base URL은 비밀이 아니다(공개 설정) — EXPO_PUBLIC_* 로 노출한다.
//
// 우선순위:
//  1. EXPO_PUBLIC_API_BASE_URL 이 지정되면 그 값(운영 빌드는 이 값을 Production으로 설정).
//  2. 미지정이면 개발/Preview 기본값(아래 Preview 주소)으로 폴백한다.
//
// Expo는 빌드 타임에 리터럴 process.env.EXPO_PUBLIC_* 참조만 인라인하므로,
// 동적 조회가 아니라 리터럴로 한 번만 읽는다.

const PREVIEW_BASE_URL = 'https://workproof-backend-preview.onrender.com';

// 참고: 운영 주소는 https://workproof-auth.onrender.com — 운영 빌드에서
// EXPO_PUBLIC_API_BASE_URL 로 지정한다(.env.example 참고).

export const API_BASE_URL: string =
  (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '') || PREVIEW_BASE_URL;

/** Phase 2 인증/사용자 API 접두사. 기존 OAuth 브릿지(/auth/session/*)와 분리돼 있다. */
export const API_V1_PREFIX = '/api/v1';

/** 기본 요청 타임아웃(ms). Render Free 콜드 스타트를 고려해 넉넉히 잡는다. */
export const DEFAULT_TIMEOUT_MS = 20000;
