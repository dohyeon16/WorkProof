// work-data 동기화의 순수 도메인 모델(RN/Expo/fetch 의존 없음 — node:test 대상).
//
// 설계 요약:
//  - 서버는 각 로컬 레코드의 "서버 관리 필드" 부분집합만 저장한다. 로컬 전용 필드
//    (급여 설정·계약서 등)는 서버로 오가지 않으므로 병합은 항상 필드 단위로 한다.
//  - 각 로컬 레코드의 id 를 client_id 로 그대로 쓴다(재전송 멱등 키). 서버 uuid 는
//    별도 sync metadata(serverId)로만 보관한다.
//  - 화면/저장소 코드를 건드리지 않고 mutation 을 잡기 위해, "큐"를 명시적으로
//    쌓는 대신 매 동기화마다 현재 로컬 상태와 metadata 를 비교해 필요한 연산을
//    파생한다(reconcile). 이 방식은 create+update 병합, delete 우선 등 coalescing
//    규칙을 자연히 만족한다.

export type ResourceType = 'workplace' | 'schedule' | 'attendance';

export const RESOURCE_ORDER: readonly ResourceType[] = [
  'workplace', // schedule/attendance 가 참조하므로 항상 먼저.
  'schedule',
  'attendance',
];

// UI/재시도 판단용 상태.
export type SyncStatus =
  | 'synced' // 서버와 일치(로컬 변경 없음)
  | 'pendingCreate'
  | 'pendingUpdate'
  | 'pendingDelete'
  | 'conflict' // 현재 API 계약으론 자동 해결 불가 — 데이터 보존 후 사용자 개입
  | 'failed'; // 영구 오류(검증/충돌) 또는 재시도 한도 초과 — 자동 재시도 중단

export type SyncErrorCategory =
  | 'network' // 연결 실패(오프라인)
  | 'timeout'
  | 'server' // 5xx
  | 'validation' // 422
  | 'conflict' // 409 (삭제된 서버 레코드의 client_id 재사용)
  | 'notfound' // 404
  | 'auth'; // 세션 만료

// 레코드 1건의 동기화 메타데이터. clientId(=로컬 id)로 키를 잡아 저장한다.
export interface SyncMeta {
  clientId: string;
  serverId?: string; // 서버 uuid(생성 성공 후)
  status: SyncStatus;
  // 마지막으로 서버에 반영된 "서버 관리 필드"의 지문. 로컬 편집 감지에 쓴다.
  fingerprint?: string;
  lastSyncedAt?: string; // ISO
  serverUpdatedAt?: string; // 서버 updated_at
  attemptCount: number; // 현재 pending 연산의 연속 실패 횟수
  nextRetryAt?: string; // ISO — 이 시각 전에는 재시도하지 않음(backoff)
  lastError?: SyncErrorCategory;
}

export type ResourceMeta = Record<string, SyncMeta>; // clientId -> meta
export interface SyncState {
  workplace: ResourceMeta;
  schedule: ResourceMeta;
  attendance: ResourceMeta;
}

export function emptySyncState(): SyncState {
  return { workplace: {}, schedule: {}, attendance: {} };
}

export type OperationKind = 'create' | 'update' | 'delete';

// reconcile 가 파생하는 논리적 "큐" 항목.
export interface SyncOperation {
  resource: ResourceType;
  kind: OperationKind;
  clientId: string;
}

// --- 재시도/backoff 정책 ---
// 일시 오류(네트워크/타임아웃/5xx)는 지수 backoff 로 재시도하되, 무한 재시도를 막기
// 위해 MAX_ATTEMPTS 초과 시 failed 로 park 한다(사용자 수동 재시도로만 리셋).
// 영구 오류(검증 422/충돌 409)는 즉시 failed — 재시도하지 않는다.
export const MAX_ATTEMPTS = 8;
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export function backoffDelayMs(attemptCount: number): number {
  const exp = BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1);
  return Math.min(exp, BACKOFF_MAX_MS);
}

/** pending(전송 대기/실패 포함) 여부 — UI 배지·상태 표시에 쓴다. */
export function isPendingStatus(status: SyncStatus): boolean {
  return status !== 'synced';
}

/** 이 레코드를 지금 재시도해도 되는지(backoff nextRetryAt 도래 여부). */
export function isDue(m: SyncMeta | undefined, now: number): boolean {
  if (!m || !m.nextRetryAt) return true;
  return new Date(m.nextRetryAt).getTime() <= now;
}

/**
 * 사용자 수동 재시도: failed 로 park 된 항목을 다시 pending 으로 되돌린다(attempt/backoff 리셋).
 * serverId 유무로 create/update 를 구분하며, 로컬에 없는 항목은 reconcile 이 delete 로 처리한다.
 * 데이터는 건드리지 않고 metadata 상태만 바꾼 새 SyncState 를 반환한다.
 */
export function resetFailed(state: SyncState): SyncState {
  const next: SyncState = { workplace: {}, schedule: {}, attendance: {} };
  for (const resource of RESOURCE_ORDER) {
    const meta = state[resource];
    const out: ResourceMeta = {};
    for (const clientId of Object.keys(meta)) {
      const m = meta[clientId];
      out[clientId] =
        m.status === 'failed'
          ? {
              ...m,
              status: m.serverId ? 'pendingUpdate' : 'pendingCreate',
              attemptCount: 0,
              nextRetryAt: undefined,
              lastError: undefined,
            }
          : m;
    }
    next[resource] = out;
  }
  return next;
}
