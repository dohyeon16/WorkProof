// AsyncStorage 키 정의(순수 모듈 — RN/네이티브 의존성 없음). storage.ts가 이 값을 사용하며,
// 백업 포함/제외 정책도 여기서 순수하게 표현해 자동 검증 대상이 되게 한다.

export const KEYS = {
  workplaces: '@workproof/workplaces',
  attendance: '@workproof/attendance',
  pay: '@workproof/pay',
  evidence: '@workproof/evidence',
  scheduledShifts: '@workproof/scheduledShifts',
  account: '@workproof/account',
  session: '@workproof/session',
  onboardingDone: '@workproof/onboardingDone',
  activeWorkplaceId: '@workproof/activeWorkplaceId',
  readNotifications: '@workproof/readNotifications',
  appLock: '@workproof/appLock',
} as const;

// 백업·복원에서 제외할 키. appLock은 '이 기기'의 보안 설정이므로 다른 기기로 옮기지 않는다
// (잠긴 백업을 생체인증 없는 기기에 복원해 앱이 잠기는 상황 방지).
export const BACKUP_EXCLUDED_KEYS: readonly string[] = [KEYS.appLock];

/** 백업(export)·복원(import) 대상 키 목록 — appLock 제외. */
export const BACKUP_KEYS: string[] = Object.values(KEYS).filter(
  (k) => !BACKUP_EXCLUDED_KEYS.includes(k)
);

/** 전체 초기화(clearAllData) 대상 키 목록 — appLock 포함(기기 완전 초기화 시 잠금도 해제). */
export const ALL_KEYS: string[] = Object.values(KEYS);
