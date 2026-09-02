// 주간 근무시간 사전 안내 — 순수 로직(RN/저장소/fetch 의존 없음, node:test 대상).
//
// 목적: 법적 판정이 아니라 "이번 주 근무시간을 미리 인지"하도록 돕는 정보성 안내.
//  - 예정(ScheduledShift) + 실제(AttendanceRecord)를 합쳐 이번 주 예상 근무시간을 계산.
//  - 같은 근무를 예정·실제로 이중 집계하지 않는다: 날짜+근무지 기준으로, 그 날짜에 실제
//    기록이 하나라도 있으면 그 날은 '실제'만 쓰고 예정은 무시한다(실제 우선).
//  - 예정 근무와 실제 기록을 잇는 명시적 FK 가 없으므로(공통 필드는 workplaceId+date),
//    "날짜 단위 실제 우선" 이라는 단순·안전한 정책을 쓴다.
//  - 임계값은 정보성 안내용 힌트일 뿐, 주휴·연장 '발생 확정'이 아니다(문구는 호출부에서 처리).
import type { AttendanceRecord, ScheduledShift, Workplace } from '../../core/domain/models/types';
import type { AppNotification } from '../../core/notifications/deriveNotifications';
import { parseLocalDate, formatLocalDate } from '../../shared/utils/date';
import { formatMinutesAsHours, shiftDurationMinutes, shiftWorkedMinutes } from '../../core/domain/payroll/payCalc';

// 정보성 안내 임계(분). 법정 확정 기준이 아니라 "확인해보라"는 힌트 경계.
export const WEEKLY_ALLOWANCE_MIN = 15 * 60; // 주휴수당 요건 확인 안내
export const OVERTIME_NEAR_MIN = 38 * 60; // 주 40시간 근접 안내
export const OVERTIME_LIMIT_MIN = 40 * 60; // 법정 주 소정근로 40시간
const MAX_IN_PROGRESS_MIN = 24 * 60;

/** 날짜(YYYY-MM-DD)가 속한 주의 월요일(YYYY-MM-DD). payCalc weekKeyOf 와 동일 관례(월~일). */
export function weekMondayOf(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  const day = d.getDay(); // 0=Sun
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return formatLocalDate(d);
}

/** 월요일부터 7일치 날짜 문자열. */
export function datesOfWeek(monday: string): string[] {
  const start = parseLocalDate(monday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return formatLocalDate(d);
  });
}

function plannedMinutes(shift: ScheduledShift): number {
  if (!shift.endTime) return 0; // 종료시간 없는 예정은 시간 산정 불가 → 0(무리한 추측 안 함)
  return Math.max(0, shiftDurationMinutes(shift.startTime, shift.endTime));
}

/** 진행 중(퇴근 전) 기록의 근사 근무 분: 출근~현재, 0~24h 로 clamp(휴게 미차감 — 어림값). */
function inProgressMinutes(record: AttendanceRecord, now: number): number {
  const inMs = new Date(`${record.date}T${record.clockIn}:00`).getTime();
  if (Number.isNaN(inMs)) return 0;
  return Math.max(0, Math.min(Math.floor((now - inMs) / 60000), MAX_IN_PROGRESS_MIN));
}

export interface WeeklyWorktime {
  weekMonday: string;
  actualMinutes: number; // 실제 기록(완료 + 진행 중 근사)
  plannedMinutes: number; // 실제 기록이 없는 날의 예정 근무
  expectedMinutes: number; // actual + planned (이중 집계 없음)
}

export interface ComputeInput {
  records: AttendanceRecord[];
  shifts: ScheduledShift[];
  workplaceId: string;
  weekMonday: string;
  now: number; // epoch ms
}

/** 한 근무지의 이번 주 실제/예정/예상 근무시간(분). 날짜 단위로 실제 우선(이중 집계 방지). */
export function computeWeeklyWorktime(input: ComputeInput): WeeklyWorktime {
  const { records, shifts, workplaceId, weekMonday, now } = input;
  const dates = datesOfWeek(weekMonday);
  let actual = 0;
  let planned = 0;
  for (const date of dates) {
    const recs = records.filter((r) => r.workplaceId === workplaceId && r.date === date);
    if (recs.length > 0) {
      for (const r of recs) actual += r.clockOut ? shiftWorkedMinutes(r) : inProgressMinutes(r, now);
    } else {
      for (const s of shifts.filter((s) => s.workplaceId === workplaceId && s.date === date)) {
        planned += plannedMinutes(s);
      }
    }
  }
  return { weekMonday, actualMinutes: actual, plannedMinutes: planned, expectedMinutes: actual + planned };
}

export type AllowanceStatus = 'none' | 'possible';
export type OvertimeStatus = 'none' | 'near' | 'exceed';
export interface WeeklyInsight {
  allowance: AllowanceStatus;
  overtime: OvertimeStatus;
}

/**
 * 예상 근무시간(분)으로 정보성 안내 상태를 만든다. 법적 발생 확정이 아니라 임계 기반 힌트다.
 *  - allowance: 15h 이상이면 'possible'(주휴 요건 확인 안내)
 *  - overtime: 40h 초과 'exceed', 38h~40h 'near', 그 외 'none'
 */
export function weeklyInsight(expectedMinutes: number): WeeklyInsight {
  return {
    allowance: expectedMinutes >= WEEKLY_ALLOWANCE_MIN ? 'possible' : 'none',
    overtime:
      expectedMinutes > OVERTIME_LIMIT_MIN
        ? 'exceed'
        : expectedMinutes >= OVERTIME_NEAR_MIN
          ? 'near'
          : 'none',
  };
}

export interface WorktimeNoticesInput {
  workplaces: Workplace[];
  records: AttendanceRecord[];
  shifts: ScheduledShift[];
  readIds: string[];
  today: string; // YYYY-MM-DD
  now: number; // epoch ms
}

/**
 * 이번 주 근무시간 기반 인앱 안내 목록(정보성). 근무지별로 계산하며, 안내 id 에 주(월요일)를
 * 포함해 매 실행마다 새로 생기지 않고(파생 + read 상태), 지난 주 안내는 만들지 않는다
 * (항상 today 가 속한 이번 주만 계산). 문구는 확정이 아니라 "확인해보라"는 정보성 표현.
 */
export function deriveWorktimeNotices(input: WorktimeNoticesInput): AppNotification[] {
  const { workplaces, records, shifts, readIds, today, now } = input;
  const weekMonday = weekMondayOf(today);
  const thisMonth = today.slice(0, 7);
  const read = new Set(readIds);
  const out: AppNotification[] = [];

  for (const wp of workplaces) {
    const wt = computeWeeklyWorktime({ records, shifts, workplaceId: wp.id, weekMonday, now });
    if (wt.expectedMinutes <= 0) continue;
    const insight = weeklyInsight(wt.expectedMinutes);
    const hours = formatMinutesAsHours(wt.expectedMinutes);
    const target = { workplaceId: wp.id, yearMonth: thisMonth, hasPay: false };

    if (insight.allowance === 'possible') {
      const id = `worktime-allowance-${wp.id}-${weekMonday}`;
      out.push({
        id,
        icon: 'time',
        tone: 'info',
        title: '이번 주 주휴수당 요건을 확인해보세요',
        body: `${wp.name} · 이번 주 예상 근무시간이 ${hours}입니다. 주휴수당은 소정근로시간·개근 등 조건에 따라 달라지니, 근로계약과 실제 근무 조건을 확인해보세요.`,
        priority: 2,
        read: read.has(id),
        target,
      });
    }

    if (insight.overtime !== 'none') {
      const id = `worktime-overtime-${wp.id}-${weekMonday}`;
      const exceed = insight.overtime === 'exceed';
      out.push({
        id,
        icon: 'alert-circle',
        tone: 'info',
        title: exceed ? '이번 주 예정 근무가 40시간을 넘을 수 있어요' : '이번 주 근무가 40시간에 근접했어요',
        body: `${wp.name} · 이번 주 예상 근무시간이 ${hours}입니다. 실제 연장근로 적용 여부는 사업장·근로조건에 따라 달라질 수 있어요.`,
        priority: 2,
        read: read.has(id),
        target,
      });
    }
  }
  return out;
}
