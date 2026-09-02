// work-data 동기화 테스트용 인메모리 하네스(순수, node:test). 실제 백엔드 계약을 모사한다:
//  - client_id 멱등: 같은 client_id 활성 재생성 → 기존 반환(중복 row 없음), 삭제분 → 409.
//  - soft-delete: delete 는 목록에서 감춘다. update/delete 대상 없으면 404.
//  - 응답은 서버 관리 필드 + client_id + created_at/updated_at.
import { ApiError } from '../../src/services/api/errors';
import type {
  AttendanceRecord,
  ScheduledShift,
  Workplace,
} from '../../src/types/domain';
import type { SyncPersistence, WorkDataRemote } from '../../src/features/sync/engine';
import type { WireWorkplace } from '../../src/features/sync/mappers';
import { emptySyncState, type SyncState } from '../../src/features/sync/model';

// 정책 필드까지 채운 유효한 WireWorkplace(값 무관 테스트용 — over 로 필요한 것만 덮어씀).
export function wireWorkplace(over: Partial<WireWorkplace> = {}): WireWorkplace {
  return {
    id: 'srv-wp',
    client_id: 'wp-1',
    name: '근무지',
    hourly_wage: 10030,
    address: null,
    latitude: null,
    longitude: null,
    pay_day: 10,
    weekly_allowance: true,
    five_or_more_employees: false,
    income_deduction_type: 'none',
    break_minutes_per_shift: 0,
    created_at: 'c',
    updated_at: 'u',
    ...over,
  };
}

export function httpError(status: number, detail = 'err'): ApiError {
  return new ApiError('http', detail, status, detail);
}
export function networkError(): ApiError {
  return new ApiError('network', 'offline');
}
export class SessionExpiredError extends Error {
  constructor() {
    super('세션 만료');
    this.name = 'SessionExpiredError';
  }
}

interface Row {
  serverId: string;
  clientId: string | null;
  deleted: boolean;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

type ResourceKey = 'workplace' | 'schedule' | 'attendance';

export class InMemoryServer {
  private seq = 0;
  private stamp = 1_700_000_000_000;
  private tables: Record<ResourceKey, Row[]> = {
    workplace: [],
    schedule: [],
    attendance: [],
  };

  private nextId(): string {
    this.seq += 1;
    return `srv-${this.seq}`;
  }
  private nextStamp(): string {
    this.stamp += 1000;
    return new Date(this.stamp).toISOString();
  }

  private wire(r: Row): Record<string, unknown> {
    return {
      id: r.serverId,
      client_id: r.clientId,
      ...r.data,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }

  activeRows(resource: ResourceKey): Row[] {
    return this.tables[resource].filter((r) => !r.deleted);
  }

  private create(resource: ResourceKey, body: Record<string, unknown>): Record<string, unknown> {
    const { client_id, ...data } = body;
    const clientId = (client_id as string | undefined) ?? null;
    if (clientId != null) {
      const existing = this.tables[resource].find((r) => r.clientId === clientId);
      if (existing) {
        if (existing.deleted) throw httpError(409, '삭제된 기록의 client_id');
        return this.wire(existing); // 멱등: 기존 반환(중복 생성 없음)
      }
    }
    const ts = this.nextStamp();
    const row: Row = {
      serverId: this.nextId(),
      clientId,
      deleted: false,
      data,
      createdAt: ts,
      updatedAt: ts,
    };
    this.tables[resource].push(row);
    return this.wire(row);
  }

  private update(
    resource: ResourceKey,
    serverId: string,
    body: Record<string, unknown>
  ): Record<string, unknown> {
    const row = this.tables[resource].find((r) => r.serverId === serverId && !r.deleted);
    if (!row) throw httpError(404, '없음');
    row.data = { ...row.data, ...body };
    row.updatedAt = this.nextStamp();
    return this.wire(row);
  }

  private remove(resource: ResourceKey, serverId: string): void {
    const row = this.tables[resource].find((r) => r.serverId === serverId && !r.deleted);
    if (!row) throw httpError(404, '없음');
    row.deleted = true;
  }

  private list(resource: ResourceKey): Record<string, unknown>[] {
    return this.activeRows(resource).map((r) => this.wire(r));
  }

  get remote(): WorkDataRemote {
    const s = this;
    return {
      createWorkplace: async (b) => s.create('workplace', b) as never,
      updateWorkplace: async (id, b) => s.update('workplace', id, b) as never,
      deleteWorkplace: async (id) => s.remove('workplace', id),
      listWorkplaces: async () => s.list('workplace') as never,
      createSchedule: async (b) => s.create('schedule', b) as never,
      updateSchedule: async (id, b) => s.update('schedule', id, b) as never,
      deleteSchedule: async (id) => s.remove('schedule', id),
      listSchedules: async () => s.list('schedule') as never,
      createAttendance: async (b) => s.create('attendance', b) as never,
      updateAttendance: async (id, b) => s.update('attendance', id, b) as never,
      deleteAttendance: async (id) => s.remove('attendance', id),
      listAttendance: async () => s.list('attendance') as never,
    };
  }
}

// 특정 메서드 호출을 가로채 오류를 주입한다(예: 첫 create 를 네트워크 실패로).
export function withFault(
  base: WorkDataRemote,
  overrides: Partial<WorkDataRemote>
): WorkDataRemote {
  return { ...base, ...overrides };
}

export class InMemoryPersistence implements SyncPersistence {
  workplaces: Workplace[];
  schedules: ScheduledShift[];
  attendance: AttendanceRecord[];
  state: SyncState;

  constructor(init?: {
    workplaces?: Workplace[];
    schedules?: ScheduledShift[];
    attendance?: AttendanceRecord[];
    state?: SyncState;
  }) {
    this.workplaces = init?.workplaces ?? [];
    this.schedules = init?.schedules ?? [];
    this.attendance = init?.attendance ?? [];
    this.state = init?.state ?? emptySyncState();
  }

  async getWorkplaces() {
    return this.workplaces;
  }
  async getSchedules() {
    return this.schedules;
  }
  async getAttendance() {
    return this.attendance;
  }
  async saveWorkplace(w: Workplace) {
    upsert(this.workplaces, w);
  }
  async saveSchedule(s: ScheduledShift) {
    upsert(this.schedules, s);
  }
  async saveAttendance(a: AttendanceRecord) {
    upsert(this.attendance, a);
  }
  async loadState() {
    return this.state;
  }
  async saveState(s: SyncState) {
    this.state = s;
  }
}

function upsert<T extends { id: string }>(list: T[], item: T): void {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

// --- 팩토리 ---
export function makeWorkplace(id: string, over: Partial<Workplace> = {}): Workplace {
  return {
    id,
    name: `근무지 ${id}`,
    hourlyWage: 10030,
    payDay: 25,
    weeklyAllowance: true,
    breakMinutesPerShift: 30,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}
export function makeSchedule(id: string, workplaceId: string, over: Partial<ScheduledShift> = {}): ScheduledShift {
  return {
    id,
    workplaceId,
    date: '2026-08-10',
    startTime: '09:00',
    endTime: '18:00',
    reminderMinutes: 30,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}
export function makeAttendance(
  id: string,
  workplaceId: string,
  over: Partial<AttendanceRecord> = {}
): AttendanceRecord {
  return {
    id,
    workplaceId,
    date: '2026-08-10',
    clockIn: '09:03',
    clockOut: '18:01',
    breakMinutes: 30,
    ...over,
  };
}

// 고정 시계(backoff 계산이 결정적이도록).
export function fixedNow(ms = 1_700_000_000_000): () => number {
  return () => ms;
}
