// 서버 fetch 결과를 client_id 기준으로 로컬에 병합한다(순수 모듈).
//
// 정책(안전 최우선 — 데이터 삭제 없음):
//  - pending local 변경이 없는 레코드만 서버 최신값으로 갱신(서버 관리 필드만).
//  - pending local update/create/delete/failed 가 있으면 서버 fetch 가 로컬을 덮지 않는다.
//  - 서버에만 있는 레코드는 로컬에 추가(재설치/재로그인 복원). 로컬 전용 필드는 기본값.
//  - 서버 목록에 없는(=서버에서 soft-delete 된 것으로 보이는) 로컬 레코드는 자동 삭제하지
//    않는다 — Phase 3B 는 다중 기기 삭제 전파를 다루지 않는다(scope 외, 데이터 보존 우선).
import type {
  AttendanceRecord,
  ScheduledShift,
  Workplace,
} from '../../types/domain';
import {
  applyServerAttendance,
  applyServerSchedule,
  applyServerWorkplace,
  attendanceFingerprint,
  fingerprintOf,
  scheduleFingerprint,
  workplaceFingerprint,
  type WireAttendance,
  type WireSchedule,
  type WireWorkplace,
} from './mappers';
import type { ResourceMeta, ResourceType, SyncMeta, SyncState } from './model';

// 로컬에 아직 서버로 못 보낸 변경이 있는지 — 있으면 서버가 로컬을 덮지 않는다.
function hasPendingLocalChange(
  resource: ResourceType,
  local: { id: string } | undefined,
  m: SyncMeta | undefined
): boolean {
  if (!local) return false; // 로컬에 없으면 pending 아님(서버 전용 추가 대상)
  if (!m) return true; // meta 없음 = 아직 생성 전
  if (m.status === 'failed' || m.status === 'pendingDelete') return true;
  if (!m.serverId) return true; // 서버 생성 전
  return m.fingerprint !== fingerprintOf(resource, local as never);
}

interface MergeOutcome<T> {
  saves: T[];
  meta: ResourceMeta;
}

function mergeResource<
  T extends { id: string },
  W extends { id: string; client_id: string | null; updated_at: string }
>(
  resource: ResourceType,
  localList: T[],
  meta: ResourceMeta,
  wireList: W[],
  apply: (local: T | undefined, wire: W) => T | null,
  fingerprint: (rec: T) => string,
  nowIso: string
): MergeOutcome<T> {
  const localById = new Map(localList.map((r) => [r.id, r]));
  const nextMeta: ResourceMeta = { ...meta };
  const saves: T[] = [];

  for (const wire of wireList) {
    // 우리 앱은 항상 client_id 를 보낸다. null 이면(교차기기·수기 생성) 서버 id 를 로컬 키로.
    const cid = wire.client_id ?? wire.id;
    const m = nextMeta[cid];
    const local = localById.get(cid);

    if (m && m.status === 'pendingDelete') {
      // 삭제 진행 중 — 서버가 아직 목록에 준다면(우리 delete 미반영) 되살리지 않는다.
      continue;
    }

    if (hasPendingLocalChange(resource, local, m)) {
      // 로컬 미전송 변경 보존. serverId 만 확보해 이후 update 로 밀어낸다.
      nextMeta[cid] = {
        clientId: cid,
        serverId: wire.id,
        status: m && m.status !== 'synced' ? m.status : 'pendingUpdate',
        fingerprint: m?.fingerprint, // 유지(다르면 reconcile 이 update 를 낸다)
        lastSyncedAt: m?.lastSyncedAt,
        serverUpdatedAt: wire.updated_at as string | undefined,
        attemptCount: m?.attemptCount ?? 0,
        nextRetryAt: m?.nextRetryAt,
        lastError: m?.lastError,
      };
      continue;
    }

    // pending 없음 → 서버가 authoritative. 서버 관리 필드만 로컬에 반영.
    const applied = apply(local, wire);
    if (applied === null) {
      // 서버 전용인데 참조 근무지를 로컬에서 못 찾음 → 배치 불가, 이번엔 건너뜀.
      continue;
    }
    saves.push(applied);
    nextMeta[cid] = {
      clientId: cid,
      serverId: wire.id,
      status: 'synced',
      fingerprint: fingerprint(applied),
      lastSyncedAt: nowIso,
      serverUpdatedAt: wire.updated_at as string | undefined,
      attemptCount: 0,
    };
  }

  return { saves, meta: nextMeta };
}

export interface FetchedRecords {
  workplace: WireWorkplace[];
  schedule: WireSchedule[];
  attendance: WireAttendance[];
}

export interface MergeResult {
  workplaces: Workplace[];
  schedules: ScheduledShift[];
  attendance: AttendanceRecord[];
  state: SyncState;
}

export interface MergeInput {
  local: {
    workplace: Workplace[];
    schedule: ScheduledShift[];
    attendance: AttendanceRecord[];
  };
  state: SyncState;
  fetched: FetchedRecords;
  nowIso: string;
}

export function mergeServerRecords(input: MergeInput): MergeResult {
  const { local, state, fetched, nowIso } = input;

  // 1) 근무지 먼저 — 자식이 참조할 serverId 매핑이 이 단계에서 확정된다.
  const wp = mergeResource(
    'workplace',
    local.workplace,
    state.workplace,
    fetched.workplace,
    applyServerWorkplace,
    workplaceFingerprint,
    nowIso
  );

  // 병합 후 근무지 meta 로 serverWorkplaceId -> localWorkplaceId 매핑을 만든다.
  const serverToLocalWorkplace = new Map<string, string>();
  for (const clientId of Object.keys(wp.meta)) {
    const serverId = wp.meta[clientId].serverId;
    if (serverId) serverToLocalWorkplace.set(serverId, clientId);
  }
  const resolveLocalWorkplaceId = (serverWorkplaceId: string): string | undefined =>
    serverToLocalWorkplace.get(serverWorkplaceId);

  const sch = mergeResource(
    'schedule',
    local.schedule,
    state.schedule,
    fetched.schedule,
    (l, w) => applyServerSchedule(l, w, resolveLocalWorkplaceId),
    scheduleFingerprint,
    nowIso
  );

  const att = mergeResource(
    'attendance',
    local.attendance,
    state.attendance,
    fetched.attendance,
    (l, w) => applyServerAttendance(l, w, resolveLocalWorkplaceId),
    attendanceFingerprint,
    nowIso
  );

  return {
    workplaces: wp.saves,
    schedules: sch.saves,
    attendance: att.saves,
    state: { workplace: wp.meta, schedule: sch.meta, attendance: att.meta },
  };
}
