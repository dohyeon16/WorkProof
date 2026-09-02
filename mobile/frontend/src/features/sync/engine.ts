// work-data 동기화 오케스트레이터. 모든 I/O 를 주입받는 순수 함수 — node:test 대상.
//
// 실행 순서(로그인 + 네트워크 연결 시):
//  1) reconcile 로 pending 연산 파생 + 생성 전 삭제분 meta GC
//  2) push: 근무지 → 예정 → 출퇴근 순서로 전송(자식은 근무지 serverId 매핑 필요)
//  3) fetch: 세 목록을 서버에서 받아
//  4) merge: client_id 기준으로 로컬에 병합(로컬 미전송 변경/데이터는 보존)
//  5) sync 상태(metadata) 저장
//
// 오류 처리:
//  - 401 은 remote 계층(session.runAuthorized)이 refresh+1회 재시도로 처리. 그래도
//    만료면 SessionExpiredError 가 올라오고 → 전체 sync 중단(authExpired).
//  - 네트워크/타임아웃 → offline 로 간주, 남은 push 중단(과도한 재시도 방지), backoff 예약.
//  - 409/422 → 영구 실패(failed) — 무한 재시도 금지, 로컬 데이터는 삭제하지 않음.
//  - 404 → delete 는 성공 취급(이미 삭제), create/update 는 serverId 를 비우고 재생성 예약.
import { ApiError } from '../../core/api/errors';
import type {
  AttendanceRecord,
  ScheduledShift,
  Workplace,
} from '../../core/domain/models/types';
import {
  attendanceCreateBody,
  attendanceManagedBody,
  fingerprintOf,
  scheduleCreateBody,
  scheduleManagedBody,
  workplaceCreateBody,
  workplaceManagedBody,
  type WireAttendance,
  type WireSchedule,
  type WireWorkplace,
} from './mappers';
import { mergeServerRecords } from './merge';
import {
  backoffDelayMs,
  isDue,
  MAX_ATTEMPTS,
  type ResourceType,
  type SyncErrorCategory,
  type SyncMeta,
  type SyncOperation,
  type SyncState,
} from './model';
import { reconcile, type LocalSnapshot } from './reconcile';

// ---------------------------------------------------------------------------
// 주입 인터페이스
// ---------------------------------------------------------------------------
export interface WorkDataRemote {
  createWorkplace(body: Record<string, unknown>): Promise<WireWorkplace>;
  updateWorkplace(serverId: string, body: Record<string, unknown>): Promise<WireWorkplace>;
  deleteWorkplace(serverId: string): Promise<void>;
  listWorkplaces(): Promise<WireWorkplace[]>;
  createSchedule(body: Record<string, unknown>): Promise<WireSchedule>;
  updateSchedule(serverId: string, body: Record<string, unknown>): Promise<WireSchedule>;
  deleteSchedule(serverId: string): Promise<void>;
  listSchedules(): Promise<WireSchedule[]>;
  createAttendance(body: Record<string, unknown>): Promise<WireAttendance>;
  updateAttendance(serverId: string, body: Record<string, unknown>): Promise<WireAttendance>;
  deleteAttendance(serverId: string): Promise<void>;
  listAttendance(): Promise<WireAttendance[]>;
}

export interface SyncPersistence {
  getWorkplaces(): Promise<Workplace[]>;
  getSchedules(): Promise<ScheduledShift[]>;
  getAttendance(): Promise<AttendanceRecord[]>;
  saveWorkplace(w: Workplace): Promise<void>;
  saveSchedule(s: ScheduledShift): Promise<void>;
  saveAttendance(a: AttendanceRecord): Promise<void>;
  loadState(): Promise<SyncState>;
  saveState(s: SyncState): Promise<void>;
}

export interface SyncDeps {
  persistence: SyncPersistence;
  remote: WorkDataRemote;
  now(): number; // ms epoch
}

export interface SyncRunResult {
  pushed: number; // 성공한 create/update/delete 수
  failedPermanent: number; // 이번 실행에서 failed 로 park 된 수
  deferred: number; // 이번엔 못 보낸 연산(미도래/미해결 참조/오프라인 중단)
  pulled: number; // 서버에서 로컬로 반영된 레코드 수
  authExpired: boolean;
  offline: boolean;
  error?: string;
}

function isSessionExpired(err: unknown): boolean {
  return err instanceof Error && err.name === 'SessionExpiredError';
}

// ApiError → (오류 카테고리, 영구 여부). 404 는 호출부에서 특수 처리.
function classify(err: unknown): { category: SyncErrorCategory; permanent: boolean } {
  if (err instanceof ApiError) {
    if (err.kind === 'network') return { category: 'network', permanent: false };
    if (err.kind === 'timeout') return { category: 'timeout', permanent: false };
    if (err.kind === 'parse') return { category: 'server', permanent: false };
    if (err.kind === 'http') {
      const s = err.status ?? 0;
      if (s === 401) return { category: 'auth', permanent: false };
      if (s === 409) return { category: 'conflict', permanent: true };
      if (s === 422 || s === 400 || s === 403) return { category: 'validation', permanent: true };
      if (s === 429 || s >= 500) return { category: 'server', permanent: false };
    }
  }
  // 알 수 없는 오류는 일시 오류로 취급(보수적 재시도).
  return { category: 'network', permanent: false };
}

function isNetworkCategory(c: SyncErrorCategory): boolean {
  return c === 'network' || c === 'timeout';
}

// ---------------------------------------------------------------------------
// meta 갱신 헬퍼(순수)
// ---------------------------------------------------------------------------
function metaSynced(
  clientId: string,
  serverId: string,
  fingerprint: string,
  serverUpdatedAt: string | undefined,
  nowIso: string
): SyncMeta {
  return {
    clientId,
    serverId,
    status: 'synced',
    fingerprint,
    lastSyncedAt: nowIso,
    serverUpdatedAt,
    attemptCount: 0,
  };
}

function metaAfterFailure(
  prev: SyncMeta,
  kind: SyncOperation['kind'],
  category: SyncErrorCategory,
  permanent: boolean,
  now: number
): SyncMeta {
  const attemptCount = prev.attemptCount + 1;
  const pendingStatus =
    kind === 'create' ? 'pendingCreate' : kind === 'update' ? 'pendingUpdate' : 'pendingDelete';
  if (permanent || attemptCount >= MAX_ATTEMPTS) {
    // 영구 오류이거나 재시도 한도 초과 → park.
    return { ...prev, status: 'failed', attemptCount, lastError: category, nextRetryAt: undefined };
  }
  return {
    ...prev,
    status: pendingStatus,
    attemptCount,
    lastError: category,
    nextRetryAt: new Date(now + backoffDelayMs(attemptCount)).toISOString(),
  };
}

// resource 별 remote 호출 묶음.
interface ResourceRemote<W> {
  create(body: Record<string, unknown>): Promise<W>;
  update(serverId: string, body: Record<string, unknown>): Promise<W>;
  remove(serverId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------
export async function runSync(deps: SyncDeps): Promise<SyncRunResult> {
  const { persistence, remote, now } = deps;
  const result: SyncRunResult = {
    pushed: 0,
    failedPermanent: 0,
    deferred: 0,
    pulled: 0,
    authExpired: false,
    offline: false,
  };

  const state = await persistence.loadState();
  const [workplaces, schedules, attendance] = await Promise.all([
    persistence.getWorkplaces(),
    persistence.getSchedules(),
    persistence.getAttendance(),
  ]);
  const local: LocalSnapshot = { workplace: workplaces, schedule: schedules, attendance };

  const byId = {
    workplace: new Map(workplaces.map((w) => [w.id, w])),
    schedule: new Map(schedules.map((s) => [s.id, s])),
    attendance: new Map(attendance.map((a) => [a.id, a])),
  };

  const { operations, gc } = reconcile(local, state);
  for (const g of gc) delete state[g.resource][g.clientId];

  const remotes: Record<ResourceType, ResourceRemote<WireWorkplace | WireSchedule | WireAttendance>> = {
    workplace: {
      create: (b) => remote.createWorkplace(b),
      update: (id, b) => remote.updateWorkplace(id, b),
      remove: (id) => remote.deleteWorkplace(id),
    },
    schedule: {
      create: (b) => remote.createSchedule(b),
      update: (id, b) => remote.updateSchedule(id, b),
      remove: (id) => remote.deleteSchedule(id),
    },
    attendance: {
      create: (b) => remote.createAttendance(b),
      update: (id, b) => remote.updateAttendance(id, b),
      remove: (id) => remote.deleteAttendance(id),
    },
  };

  const serverWorkplaceId = (localWorkplaceId: string): string | undefined =>
    state.workplace[localWorkplaceId]?.serverId;

  const nowIso = () => new Date(now()).toISOString();

  // --- push 단계 ---
  let aborted = false;
  for (const op of operations) {
    if (aborted) {
      result.deferred += 1;
      continue;
    }
    const meta = state[op.resource][op.clientId];
    if (!isDue(meta, now())) {
      result.deferred += 1;
      continue;
    }

    try {
      if (op.kind === 'delete') {
        const serverId = meta?.serverId;
        if (!serverId) {
          delete state[op.resource][op.clientId];
          continue;
        }
        await remotes[op.resource].remove(serverId);
        delete state[op.resource][op.clientId]; // 삭제 확정 → meta 제거
        result.pushed += 1;
        continue;
      }

      // create / update — 로컬 레코드 필요.
      const record = byId[op.resource].get(op.clientId);
      if (!record) {
        // 로컬에서 사라졌다면 다음 reconcile 이 delete 로 다룬다.
        result.deferred += 1;
        continue;
      }

      const body = buildBody(op, record, serverWorkplaceId);
      if (body === null) {
        // 자식인데 근무지 serverId 미해결 → 근무지 push 실패/대기. 이번엔 보류.
        result.deferred += 1;
        continue;
      }
      const fp = fingerprintOf(op.resource, record);

      if (op.kind === 'create') {
        const wire = await remotes[op.resource].create(body);
        state[op.resource][op.clientId] = metaSynced(
          op.clientId,
          wire.id,
          fp,
          (wire as { updated_at?: string }).updated_at,
          nowIso()
        );
        result.pushed += 1;
      } else {
        // update
        const serverId = meta?.serverId;
        if (!serverId) {
          // serverId 없이 update 로 왔다면 create 로 강등.
          const wire = await remotes[op.resource].create(withClientId(op, record, body));
          state[op.resource][op.clientId] = metaSynced(
            op.clientId,
            wire.id,
            fp,
            (wire as { updated_at?: string }).updated_at,
            nowIso()
          );
          result.pushed += 1;
        } else {
          const wire = await remotes[op.resource].update(serverId, body);
          state[op.resource][op.clientId] = metaSynced(
            op.clientId,
            wire.id,
            fp,
            (wire as { updated_at?: string }).updated_at,
            nowIso()
          );
          result.pushed += 1;
        }
      }
    } catch (err) {
      if (isSessionExpired(err)) {
        result.authExpired = true;
        aborted = true;
        continue;
      }
      // 404 특수 처리.
      if (err instanceof ApiError && err.kind === 'http' && err.status === 404) {
        if (op.kind === 'delete') {
          delete state[op.resource][op.clientId]; // 이미 서버에서 사라짐 → 성공 취급
          result.pushed += 1;
        } else {
          // 서버 레코드 유실 → serverId 비우고 재생성 예약(데이터 삭제 없음).
          const prev = state[op.resource][op.clientId];
          if (prev) {
            state[op.resource][op.clientId] = {
              clientId: op.clientId,
              status: 'pendingCreate',
              attemptCount: 0,
            };
          }
          result.deferred += 1;
        }
        continue;
      }

      const { category, permanent } = classify(err);
      if (category === 'auth') {
        result.authExpired = true;
        aborted = true;
        continue;
      }
      const prev: SyncMeta = state[op.resource][op.clientId] ?? {
        clientId: op.clientId,
        status: 'pendingCreate',
        attemptCount: 0,
      };
      state[op.resource][op.clientId] = metaAfterFailure(prev, op.kind, category, permanent, now());
      if (state[op.resource][op.clientId].status === 'failed') result.failedPermanent += 1;
      // 오프라인이면 남은 push 를 중단(과도한 재시도/대기 방지).
      if (isNetworkCategory(category)) {
        result.offline = true;
        aborted = true;
      }
    }
  }

  await persistence.saveState(state);

  // 인증 만료나 오프라인이면 fetch/merge 는 건너뛴다(로컬 데이터 유지).
  if (result.authExpired || result.offline) return result;

  // --- fetch + merge 단계 ---
  let fetched;
  try {
    const [wp, sch, att] = await Promise.all([
      remote.listWorkplaces(),
      remote.listSchedules(),
      remote.listAttendance(),
    ]);
    fetched = { workplace: wp, schedule: sch, attendance: att };
  } catch (err) {
    if (isSessionExpired(err)) {
      result.authExpired = true;
      return result;
    }
    const { category } = classify(err);
    if (category === 'auth') result.authExpired = true;
    else result.offline = true;
    return result;
  }

  const merged = mergeServerRecords({
    local,
    state,
    fetched,
    nowIso: nowIso(),
  });

  for (const w of merged.workplaces) await persistence.saveWorkplace(w);
  for (const s of merged.schedules) await persistence.saveSchedule(s);
  for (const a of merged.attendance) await persistence.saveAttendance(a);
  result.pulled = merged.workplaces.length + merged.schedules.length + merged.attendance.length;

  await persistence.saveState(merged.state);
  return result;

  // --- 내부 헬퍼 ---
  function buildBody(
    op: SyncOperation,
    record: Workplace | ScheduledShift | AttendanceRecord,
    resolve: (id: string) => string | undefined
  ): Record<string, unknown> | null {
    if (op.resource === 'workplace') {
      const w = record as Workplace;
      return op.kind === 'create' ? workplaceCreateBody(w) : workplaceManagedBody(w);
    }
    if (op.resource === 'schedule') {
      const s = record as ScheduledShift;
      const swid = resolve(s.workplaceId);
      if (!swid) return null;
      return op.kind === 'create' ? scheduleCreateBody(s, swid) : scheduleManagedBody(s, swid);
    }
    const a = record as AttendanceRecord;
    const swid = resolve(a.workplaceId);
    if (!swid) return null;
    return op.kind === 'create' ? attendanceCreateBody(a, swid) : attendanceManagedBody(a, swid);
  }

  // serverId 없는 update 를 create 로 강등할 때 client_id 를 붙인 바디로 바꾼다.
  function withClientId(
    op: SyncOperation,
    record: Workplace | ScheduledShift | AttendanceRecord,
    _body: Record<string, unknown>
  ): Record<string, unknown> {
    return buildBody({ ...op, kind: 'create' }, record, serverWorkplaceId) ?? _body;
  }
}
