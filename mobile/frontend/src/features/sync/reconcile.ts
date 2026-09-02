// 로컬 상태 + sync metadata 를 비교해 필요한 서버 연산(논리적 "큐")을 파생한다.
// 순수·타이밍 무관 — coalescing 규칙을 구조적으로 보장한다:
//   - 생성 후 여러 번 수정 → create 1건(최신 내용)      (create+update 병합)
//   - 여러 번 수정                → update 1건(최신 내용)      (update 병합)
//   - 수정 후 삭제               → delete 1건(update 사라짐)  (delete 우선)
//   - 생성 후 서버 반영 전 삭제  → 연산 없음 + meta GC        (create+delete 상쇄)
// 재시도 타이밍(backoff)과 failed park 는 engine 이 담당한다.
import type {
  AttendanceRecord,
  ScheduledShift,
  Workplace,
} from '../../types/domain';
import { fingerprintOf } from './mappers';
import {
  isDue,
  RESOURCE_ORDER,
  type ResourceType,
  type SyncOperation,
  type SyncState,
} from './model';

export interface LocalSnapshot {
  workplace: Workplace[];
  schedule: ScheduledShift[];
  attendance: AttendanceRecord[];
}

export interface ReconcileResult {
  operations: SyncOperation[];
  // 서버에 생성된 적 없이 로컬에서 사라진 레코드의 meta — 그냥 지운다.
  gc: Array<{ resource: ResourceType; clientId: string }>;
}

type AnyRecord = Workplace | ScheduledShift | AttendanceRecord;

function recordsOf(local: LocalSnapshot, resource: ResourceType): AnyRecord[] {
  return local[resource];
}

export function reconcile(local: LocalSnapshot, state: SyncState): ReconcileResult {
  const operations: SyncOperation[] = [];
  const gc: ReconcileResult['gc'] = [];

  for (const resource of RESOURCE_ORDER) {
    const records = recordsOf(local, resource);
    const meta = state[resource];
    const localIds = new Set(records.map((r) => r.id));

    // 1) 생성 / 수정
    for (const r of records) {
      const m = meta[r.id];
      if (!m) {
        operations.push({ resource, kind: 'create', clientId: r.id });
        continue;
      }
      if (m.status === 'failed') continue; // park — 자동 재시도 안 함(수동 재시도로만 해제)
      if (!m.serverId) {
        // 아직 서버 생성 전(재시도 대상).
        operations.push({ resource, kind: 'create', clientId: r.id });
        continue;
      }
      const fp = fingerprintOf(resource, r);
      const changed =
        m.fingerprint !== fp ||
        m.status === 'pendingUpdate' ||
        m.status === 'pendingCreate';
      if (changed) {
        operations.push({ resource, kind: 'update', clientId: r.id });
      }
    }

    // 2) 삭제 / GC — 로컬에 없는 meta 항목.
    for (const clientId of Object.keys(meta)) {
      if (localIds.has(clientId)) continue;
      const m = meta[clientId];
      if (m.status === 'failed') continue; // park
      if (m.serverId) {
        operations.push({ resource, kind: 'delete', clientId });
      } else {
        gc.push({ resource, clientId });
      }
    }
  }

  return { operations, gc };
}

/** UI 배지용 — reconcile 이 낼 연산 수(현재 전송 대기 건수). */
export function pendingOperationCount(
  local: LocalSnapshot,
  state: SyncState
): number {
  return reconcile(local, state).operations.length;
}

/** 지금 당장 재시도 가능한(backoff 도래) 연산이 하나라도 있는지 — 주기적 트리거 게이트. */
export function hasDueOperations(
  local: LocalSnapshot,
  state: SyncState,
  now: number
): boolean {
  const { operations } = reconcile(local, state);
  return operations.some((op) => isDue(state[op.resource][op.clientId], now));
}

/** failed 로 park 된 레코드 수(사용자에게 "동기화 실패" 표시용). */
export function failedCount(state: SyncState): number {
  let n = 0;
  for (const resource of RESOURCE_ORDER) {
    for (const clientId of Object.keys(state[resource])) {
      if (state[resource][clientId].status === 'failed') n += 1;
    }
  }
  return n;
}
