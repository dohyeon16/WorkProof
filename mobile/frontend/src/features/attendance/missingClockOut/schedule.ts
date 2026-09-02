// 미퇴근(퇴근 미기록) 알림 스케줄 결정 — 순수 로직(RN/알림 SDK 의존 없음, node:test 대상).
//
// 기존에 있는 것과의 차이:
//  - deriveNotifications 의 'unclosed-*' 는 "지난 날짜인데 퇴근이 빈" 기록을 앱 안에서
//    사후에 보여준다(retroactive, in-app). 여기서는 그날 예상 종료시간(또는 출근 후 일정
//    시간)에 맞춰 로컬 푸시를 "사전 예약"한다 — 사용자가 앱을 안 열어도 그날 알 수 있다.
//
// 오탐 방지 원칙:
//  - 이미 퇴근한 기록은 예약하지 않는다(호출부에서 취소).
//  - 예약 시각이 이미 지났으면 예약하지 않는다(과거 기록엔 생성 금지 — 사후 알림은 in-app 담당).
//  - 예정 근무(ScheduledShift)의 endTime 이 있으면 그 시각 + 유예, 없으면 출근 + 기본 시간.
import type { AttendanceRecord, ScheduledShift } from '../../../core/domain/models/types';

/** 예정 종료시간이 있을 때, 그 시각 이후 이만큼 지나도 퇴근이 없으면 알린다(유예, 분). */
export const GRACE_AFTER_END_MIN = 60;
/** 예정 종료시간이 없을 때, 출근 후 이만큼 지나면 알린다(기본, 시간). 긴 근무 오탐을 줄이려 넉넉히. */
export const DEFAULT_AFTER_CLOCKIN_HOURS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(dateISO: string, hhmm: string): number {
  // 로컬 타임존 기준 절대시각(테스트에서는 TZ 고정 없이도 상대 비교만 하므로 안전).
  return new Date(`${dateISO}T${hhmm}:00`).getTime();
}

export interface MissingClockOutPlan {
  fire: boolean;
  fireAt?: number; // epoch ms
  reason: 'already-closed' | 'no-clock-in' | 'invalid' | 'in-past' | 'scheduled-end' | 'after-clock-in';
}

export interface PlanInput {
  record: AttendanceRecord;
  shift?: ScheduledShift; // 같은 근무지·같은 날짜의 예정 근무(있으면 endTime 사용)
  now: number; // epoch ms
  graceAfterEndMin?: number;
  defaultAfterHours?: number;
}

/**
 * 이 기록에 대해 미퇴근 알림을 예약할지, 언제 울릴지 결정한다.
 * 실제 예약/취소(부수효과)는 호출부(notifications.ts)가 이 결과를 보고 수행한다.
 */
export function planMissingClockOut(input: PlanInput): MissingClockOutPlan {
  const { record, shift, now } = input;
  const grace = (input.graceAfterEndMin ?? GRACE_AFTER_END_MIN) * 60 * 1000;
  const defaultAfter = (input.defaultAfterHours ?? DEFAULT_AFTER_CLOCKIN_HOURS) * 60 * 60 * 1000;

  if (record.clockOut) return { fire: false, reason: 'already-closed' };
  if (!record.clockIn || !record.date) return { fire: false, reason: 'no-clock-in' };

  const clockInMs = toMs(record.date, record.clockIn);
  if (Number.isNaN(clockInMs)) return { fire: false, reason: 'invalid' };

  let fireAt: number;
  let reason: MissingClockOutPlan['reason'];
  const endTime = shift && sameDayShift(record, shift) ? shift.endTime : undefined;
  if (endTime) {
    let endMs = toMs(record.date, endTime);
    if (Number.isNaN(endMs)) return { fire: false, reason: 'invalid' };
    if (endMs <= clockInMs) endMs += DAY_MS; // 자정 넘겨 끝나는 근무(예: 22:00→06:00)
    fireAt = endMs + grace;
    reason = 'scheduled-end';
  } else {
    fireAt = clockInMs + defaultAfter;
    reason = 'after-clock-in';
  }

  if (fireAt <= now) return { fire: false, reason: 'in-past' };
  return { fire: true, fireAt, reason };
}

function sameDayShift(record: AttendanceRecord, shift: ScheduledShift): boolean {
  return shift.workplaceId === record.workplaceId && shift.date === record.date;
}

export const MISSING_CLOCKOUT_ID_PREFIX = 'missing-clockout-';
export function missingClockOutId(recordId: string): string {
  return `${MISSING_CLOCKOUT_ID_PREFIX}${recordId}`;
}

/** 진행 중(퇴근 전) 기록만 골라낸다 — 앱 시작 시 예약 복원 대상. */
export function inProgressRecords(records: AttendanceRecord[]): AttendanceRecord[] {
  return records.filter((r) => r.clockIn && !r.clockOut);
}
