// RN의 AppStateStatus와 동일한 문자열 유니온(테스트를 위해 react-native 의존 없이 순수 모듈로 유지).
export type AppLifecycleStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

// 앱 잠금 생명주기의 '잠금 판단'을 순수 함수로 분리한다(무한 인증 루프 방지 + 자동 검증 용이).
// 핵심 정책:
//  - inactive 만으로는 잠그지 않는다(권한 팝업·제어센터·생체 프롬프트가 inactive를 유발).
//  - 진짜 background 진입 시각만 기록하고, background → active 복귀 시에만 잠금을 판단한다.
//  - 백그라운드 체류가 유예시간보다 짧으면 잠그지 않는다(외부 작업 후 즉시 복귀 방어).
//  - 인증 진행 중 발생한 AppState 변화는 전부 무시한다(생체 프롬프트 자체가 유발).
//  - 인증 성공 직후 유예 동안은 재잠금하지 않는다.

/** 백그라운드 체류 유예(ms). 이보다 짧게 머물다 돌아오면 잠그지 않는다. */
export const BACKGROUND_LOCK_GRACE_MS = 3000;
/** 인증 성공 직후 재잠금 방지 유예(ms). */
export const POST_UNLOCK_GRACE_MS = 1500;

export interface AppLockState {
  backgroundedAt: number | null; // 진짜 background 진입 시각(inactive는 기록하지 않음)
  authInProgress: boolean; // 생체/기기 인증 진행 중
  lastUnlockAt: number | null; // 마지막 인증 성공 시각
}

export function initialAppLockState(): AppLockState {
  return { backgroundedAt: null, authInProgress: false, lastUnlockAt: null };
}

export interface AppStateTransition {
  prev: AppLifecycleStatus;
  next: AppLifecycleStatus;
  now: number;
}

/**
 * AppState 전이를 받아 다음 상태와 '지금 잠가야 하는지'를 계산하는 순수 함수.
 * 부수효과 없음 — 컴포넌트는 결과의 lock 값에 따라서만 잠금 화면을 띄운다.
 */
export function reduceAppState(
  state: AppLockState,
  { next, now }: AppStateTransition,
  graceMs: number = BACKGROUND_LOCK_GRACE_MS,
  postUnlockGraceMs: number = POST_UNLOCK_GRACE_MS
): { state: AppLockState; lock: boolean } {
  // 인증 진행 중(생체 프롬프트 등)에 발생하는 inactive/active 흔들림은 전부 무시한다.
  if (state.authInProgress) return { state, lock: false };

  if (next === 'background') {
    // 진짜 백그라운드 진입 시각만 기록한다.
    return { state: { ...state, backgroundedAt: now }, lock: false };
  }

  if (next === 'active') {
    const { backgroundedAt } = state;
    // 백그라운드를 거치지 않았으면(inactive만 있었으면) 잠그지 않는다.
    if (backgroundedAt == null) return { state, lock: false };
    const stayed = now - backgroundedAt;
    const cleared: AppLockState = { ...state, backgroundedAt: null };
    // 인증 성공 직후 유예 안이면 재잠금하지 않는다.
    if (state.lastUnlockAt != null && now - state.lastUnlockAt < postUnlockGraceMs) {
      return { state: cleared, lock: false };
    }
    return { state: cleared, lock: stayed >= graceMs };
  }

  // inactive 등 기타 전이: 상태·잠금 변화 없음.
  return { state, lock: false };
}

/** 인증 시작을 상태에 반영(진행 중 플래그 on). */
export function markAuthStarted(state: AppLockState): AppLockState {
  return { ...state, authInProgress: true };
}

/** 인증 종료를 상태에 반영. 성공 시 마지막 해제 시각 기록 + 백그라운드 시각 초기화. */
export function markAuthFinished(state: AppLockState, success: boolean, now: number): AppLockState {
  return {
    ...state,
    authInProgress: false,
    lastUnlockAt: success ? now : state.lastUnlockAt,
    backgroundedAt: success ? null : state.backgroundedAt,
  };
}
