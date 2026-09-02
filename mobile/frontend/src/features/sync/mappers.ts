// 모바일 도메인 모델 ↔ 백엔드 wire(snake_case) 매핑 + 지문(fingerprint) + 서버 필드 병합.
// 순수 모듈(RN/fetch 의존 없음). 백엔드 계약 근거:
//   backend/app/schemas/{workplace,work_schedule,attendance_record}.py
//   backend/app/services/work_data.py (client_id 멱등, soft-delete, proximity 재계산)
//
// 핵심 규칙:
//  - 로컬 record.id 를 그대로 client_id 로 보낸다(재전송 멱등 키).
//  - 좌표는 서버가 "위도·경도 짝"을 강제하므로 항상 둘 다 보내거나 둘 다 null 로 보낸다.
//  - 서버 관리 필드: name/hourly_wage/address/좌표 + (Phase 3C) 급여 정책 5필드
//    (pay_day/weekly_allowance/five_or_more_employees/income_deduction_type/
//    break_minutes_per_shift). 계약서/OCR 등 기기 로컬 필드는 여전히 보내지 않는다.
//  - 응답의 proximity(거리·반경)는 무시한다 — 모바일은 자체 좌표로 로컬 계산한다.
import type {
  AttendanceRecord,
  IncomeDeductionType,
  ScheduledShift,
  Workplace,
} from '../../types/domain';
import type { ResourceType } from './model';

// ---------------------------------------------------------------------------
// Wire 응답 타입 (백엔드 *Response 스키마와 1:1)
// ---------------------------------------------------------------------------
export interface WireWorkplace {
  id: string;
  client_id: string | null;
  name: string;
  hourly_wage: number;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  // 급여 정책(Phase 3C). 서버에서 NOT NULL(항상 값이 온다).
  pay_day: number;
  weekly_allowance: boolean;
  five_or_more_employees: boolean;
  income_deduction_type: IncomeDeductionType;
  break_minutes_per_shift: number;
  created_at: string;
  updated_at: string;
}

export interface WireSchedule {
  id: string;
  client_id: string | null;
  workplace_id: string;
  work_date: string;
  start_time: string;
  end_time: string | null;
  reminder_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface WireAttendance {
  id: string;
  client_id: string | null;
  workplace_id: string;
  work_date: string;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
  note: string | null;
  is_holiday: boolean;
  clock_in_latitude: number | null;
  clock_in_longitude: number | null;
  clock_out_latitude: number | null;
  clock_out_longitude: number | null;
  created_at: string;
  updated_at: string;
  // clock_in_proximity/clock_out_proximity 는 응답에 오지만 모바일은 사용하지 않는다.
}

export type WireRecord = WireWorkplace | WireSchedule | WireAttendance;

// ---------------------------------------------------------------------------
// 좌표 짝 정규화
// ---------------------------------------------------------------------------
function coordPair(
  lat: number | undefined,
  lon: number | undefined
): { latitude: number | null; longitude: number | null } {
  const paired = lat != null && lon != null;
  return { latitude: paired ? lat : null, longitude: paired ? lon : null };
}

// ---------------------------------------------------------------------------
// 요청 바디 빌더 — 서버 관리 필드를 선언적으로 그대로 미러링한다(생략 대신 명시 null).
// PATCH(부분 수정)에도 전체 관리 필드를 보내므로 로컬 상태가 곧 서버 상태가 된다.
// ---------------------------------------------------------------------------
export function workplaceManagedBody(w: Workplace): Record<string, unknown> {
  return {
    name: w.name,
    hourly_wage: Math.round(w.hourlyWage), // 서버는 정수(ge=0)
    address: w.address ?? null,
    ...coordPair(w.latitude, w.longitude),
    // 급여 정책(Phase 3C). 구버전 데이터의 optional 필드는 모바일 기본값으로 채운다.
    pay_day: w.payDay,
    weekly_allowance: w.weeklyAllowance,
    five_or_more_employees: w.fiveOrMoreEmployees ?? false,
    income_deduction_type: w.incomeDeductionType ?? 'none',
    break_minutes_per_shift: w.breakMinutesPerShift,
  };
}

export function workplaceCreateBody(w: Workplace): Record<string, unknown> {
  return { client_id: w.id, ...workplaceManagedBody(w) };
}

export function scheduleManagedBody(
  s: ScheduledShift,
  serverWorkplaceId: string
): Record<string, unknown> {
  return {
    workplace_id: serverWorkplaceId,
    work_date: s.date,
    start_time: s.startTime,
    end_time: s.endTime ?? null,
    reminder_minutes: s.reminderMinutes,
  };
}

export function scheduleCreateBody(
  s: ScheduledShift,
  serverWorkplaceId: string
): Record<string, unknown> {
  return { client_id: s.id, ...scheduleManagedBody(s, serverWorkplaceId) };
}

export function attendanceManagedBody(
  a: AttendanceRecord,
  serverWorkplaceId: string
): Record<string, unknown> {
  return {
    workplace_id: serverWorkplaceId,
    work_date: a.date,
    clock_in: a.clockIn,
    clock_out: a.clockOut ?? null,
    break_minutes: a.breakMinutes,
    note: a.note ?? null,
    is_holiday: a.isHoliday ?? false,
    ...prefixCoord('clock_in', a.clockInLatitude, a.clockInLongitude),
    ...prefixCoord('clock_out', a.clockOutLatitude, a.clockOutLongitude),
  };
}

export function attendanceCreateBody(
  a: AttendanceRecord,
  serverWorkplaceId: string
): Record<string, unknown> {
  return { client_id: a.id, ...attendanceManagedBody(a, serverWorkplaceId) };
}

function prefixCoord(
  prefix: 'clock_in' | 'clock_out',
  lat: number | undefined,
  lon: number | undefined
): Record<string, number | null> {
  const { latitude, longitude } = coordPair(lat, lon);
  return { [`${prefix}_latitude`]: latitude, [`${prefix}_longitude`]: longitude };
}

// ---------------------------------------------------------------------------
// 지문(fingerprint) — 로컬의 "서버 관리 필드" 상태를 고정 순서로 직렬화한 문자열.
// meta.fingerprint 와 달라지면 로컬 편집으로 보고 update 를 낸다.
// (서버가 저장하지 않는 로컬 전용 필드는 지문에 넣지 않는다 — 불필요한 update 방지.)
// ---------------------------------------------------------------------------
export function workplaceFingerprint(w: Workplace): string {
  return JSON.stringify([
    w.name,
    Math.round(w.hourlyWage),
    w.address ?? null,
    w.latitude ?? null,
    w.longitude ?? null,
    // 급여 정책(Phase 3C) — 지문에 포함하므로, 3B 에서 정책 없이 동기화된 근무지는
    // 3C 첫 sync 때 지문 불일치로 update 가 나가 정책 값이 서버로 backfill 된다.
    w.payDay,
    w.weeklyAllowance,
    w.fiveOrMoreEmployees ?? false,
    w.incomeDeductionType ?? 'none',
    w.breakMinutesPerShift,
  ]);
}

export function scheduleFingerprint(s: ScheduledShift): string {
  return JSON.stringify([
    s.workplaceId,
    s.date,
    s.startTime,
    s.endTime ?? null,
    s.reminderMinutes,
  ]);
}

export function attendanceFingerprint(a: AttendanceRecord): string {
  return JSON.stringify([
    a.workplaceId,
    a.date,
    a.clockIn,
    a.clockOut ?? null,
    a.breakMinutes,
    a.note ?? null,
    a.isHoliday ?? false,
    a.clockInLatitude ?? null,
    a.clockInLongitude ?? null,
    a.clockOutLatitude ?? null,
    a.clockOutLongitude ?? null,
  ]);
}

// resource 별 지문 계산기 — reconcile/merge 에서 공용으로 쓴다.
export function fingerprintOf(
  resource: ResourceType,
  record: Workplace | ScheduledShift | AttendanceRecord
): string {
  switch (resource) {
    case 'workplace':
      return workplaceFingerprint(record as Workplace);
    case 'schedule':
      return scheduleFingerprint(record as ScheduledShift);
    case 'attendance':
      return attendanceFingerprint(record as AttendanceRecord);
  }
}

// ---------------------------------------------------------------------------
// 서버 응답 → 로컬 레코드 병합. 로컬 전용 필드는 절대 덮어쓰지 않는다.
//  - 기존 로컬 레코드가 있으면 서버 관리 필드만 갱신한다.
//  - 서버에만 존재하는 레코드(로컬 없음)는 로컬 전용 필수 필드에 안전한 기본값을 넣어
//    새로 추가한다(재설치/재로그인 복원 시). 이 값들은 서버에 없으므로 근사값이다.
export function applyServerWorkplace(
  local: Workplace | undefined,
  wire: WireWorkplace
): Workplace {
  // 급여 정책은 이제 서버 관리 필드다. 계약서/OCR 등 기기 로컬 필드만 기존 로컬에서 보존.
  // 서버 전용(재설치/재로그인 복원)이면 정책도 서버 값 그대로 복원된다.
  const base: Workplace =
    local ?? {
      id: wire.client_id ?? wire.id,
      name: wire.name,
      hourlyWage: wire.hourly_wage,
      payDay: wire.pay_day,
      weeklyAllowance: wire.weekly_allowance,
      breakMinutesPerShift: wire.break_minutes_per_shift,
      createdAt: wire.created_at,
    };
  return {
    ...base,
    name: wire.name,
    hourlyWage: wire.hourly_wage,
    address: wire.address ?? undefined,
    latitude: wire.latitude ?? undefined,
    longitude: wire.longitude ?? undefined,
    payDay: wire.pay_day,
    weeklyAllowance: wire.weekly_allowance,
    fiveOrMoreEmployees: wire.five_or_more_employees,
    incomeDeductionType: wire.income_deduction_type,
    breakMinutesPerShift: wire.break_minutes_per_shift,
  };
}

export function applyServerSchedule(
  local: ScheduledShift | undefined,
  wire: WireSchedule,
  resolveLocalWorkplaceId: (serverWorkplaceId: string) => string | undefined
): ScheduledShift | null {
  if (local) {
    // 기존 로컬 레코드: 서버 관리 필드만 갱신, workplaceId(로컬 참조)는 유지.
    return {
      ...local,
      date: wire.work_date,
      startTime: wire.start_time,
      endTime: wire.end_time ?? undefined,
      reminderMinutes: wire.reminder_minutes,
    };
  }
  // 서버 전용: 서버 workplace_id 를 로컬 근무지 id 로 되돌릴 수 있어야 배치 가능.
  const localWorkplaceId = resolveLocalWorkplaceId(wire.workplace_id);
  if (!localWorkplaceId) return null;
  return {
    id: wire.client_id ?? wire.id,
    workplaceId: localWorkplaceId,
    date: wire.work_date,
    startTime: wire.start_time,
    endTime: wire.end_time ?? undefined,
    reminderMinutes: wire.reminder_minutes,
    createdAt: wire.created_at,
  };
}

export function applyServerAttendance(
  local: AttendanceRecord | undefined,
  wire: WireAttendance,
  resolveLocalWorkplaceId: (serverWorkplaceId: string) => string | undefined
): AttendanceRecord | null {
  if (local) {
    return {
      ...local,
      date: wire.work_date,
      clockIn: wire.clock_in,
      // clockOut 은 로컬 타입상 필수. 서버가 null(진행 중)이면 기존 로컬값을 유지한다.
      clockOut: wire.clock_out ?? local.clockOut,
      breakMinutes: wire.break_minutes,
      note: wire.note ?? undefined,
      isHoliday: wire.is_holiday,
      clockInLatitude: wire.clock_in_latitude ?? undefined,
      clockInLongitude: wire.clock_in_longitude ?? undefined,
      clockOutLatitude: wire.clock_out_latitude ?? undefined,
      clockOutLongitude: wire.clock_out_longitude ?? undefined,
    };
  }
  const localWorkplaceId = resolveLocalWorkplaceId(wire.workplace_id);
  if (!localWorkplaceId) return null;
  return {
    id: wire.client_id ?? wire.id,
    workplaceId: localWorkplaceId,
    date: wire.work_date,
    clockIn: wire.clock_in,
    // 서버 전용 진행 중 기록(clock_out=null)은 clock_in 시각으로 근사한다(교차기기 edge).
    clockOut: wire.clock_out ?? wire.clock_in,
    breakMinutes: wire.break_minutes,
    note: wire.note ?? undefined,
    isHoliday: wire.is_holiday,
    clockInLatitude: wire.clock_in_latitude ?? undefined,
    clockInLongitude: wire.clock_in_longitude ?? undefined,
    clockOutLatitude: wire.clock_out_latitude ?? undefined,
    clockOutLongitude: wire.clock_out_longitude ?? undefined,
  };
}
