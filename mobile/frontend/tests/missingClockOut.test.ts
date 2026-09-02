import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planMissingClockOut,
  missingClockOutId,
  inProgressRecords,
  GRACE_AFTER_END_MIN,
  DEFAULT_AFTER_CLOCKIN_HOURS,
} from '../src/features/attendance/services/missingClockOutSchedule';
import type { AttendanceRecord, ScheduledShift } from '../src/types/domain';

function rec(over: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return { id: 'a1', workplaceId: 'w1', date: '2026-08-06', clockIn: '09:00', clockOut: '', breakMinutes: 0, ...over };
}
function shift(over: Partial<ScheduledShift> = {}): ScheduledShift {
  return { id: 's1', workplaceId: 'w1', date: '2026-08-06', startTime: '09:00', endTime: '18:00', reminderMinutes: 0, createdAt: 'T', ...over };
}
const at = (d: string, t: string) => new Date(`${d}T${t}:00`).getTime();

test('이미 퇴근한 기록은 예약 안 함', () => {
  const p = planMissingClockOut({ record: rec({ clockOut: '18:00' }), now: at('2026-08-06', '10:00') });
  assert.deepEqual([p.fire, p.reason], [false, 'already-closed']);
});

test('출근 기록이 없으면 예약 안 함', () => {
  const p = planMissingClockOut({ record: rec({ clockIn: '' }), now: at('2026-08-06', '10:00') });
  assert.equal(p.fire, false);
});

test('예정 근무 endTime 있으면 종료+유예에 예약', () => {
  const now = at('2026-08-06', '10:00');
  const p = planMissingClockOut({ record: rec(), shift: shift({ endTime: '18:00' }), now });
  assert.equal(p.fire, true);
  assert.equal(p.reason, 'scheduled-end');
  assert.equal(p.fireAt, at('2026-08-06', '18:00') + GRACE_AFTER_END_MIN * 60000);
});

test('예정 근무 없으면 출근 + 기본시간 후 예약', () => {
  const now = at('2026-08-06', '10:00');
  const p = planMissingClockOut({ record: rec(), now });
  assert.equal(p.reason, 'after-clock-in');
  assert.equal(p.fireAt, at('2026-08-06', '09:00') + DEFAULT_AFTER_CLOCKIN_HOURS * 3600000);
});

test('자정 넘겨 끝나는 근무: endTime<clockIn 이면 다음날로', () => {
  const now = at('2026-08-06', '23:00');
  const p = planMissingClockOut({ record: rec({ clockIn: '22:00' }), shift: shift({ startTime: '22:00', endTime: '06:00' }), now });
  assert.equal(p.fire, true);
  assert.equal(p.fireAt, at('2026-08-07', '06:00') + GRACE_AFTER_END_MIN * 60000);
});

test('예약 시각이 이미 지났으면(과거) 예약 안 함', () => {
  const now = at('2026-08-07', '12:00'); // 종료+유예 한참 지남
  const p = planMissingClockOut({ record: rec(), shift: shift({ endTime: '18:00' }), now });
  assert.deepEqual([p.fire, p.reason], [false, 'in-past']);
});

test('다른 날짜/근무지의 shift 는 endTime 을 쓰지 않고 기본 규칙 적용', () => {
  const now = at('2026-08-06', '10:00');
  const other = shift({ workplaceId: 'w2' });
  const p = planMissingClockOut({ record: rec(), shift: other, now });
  assert.equal(p.reason, 'after-clock-in');
});

test('missingClockOutId / inProgressRecords', () => {
  assert.equal(missingClockOutId('a1'), 'missing-clockout-a1');
  const list = [rec({ id: 'a1', clockOut: '' }), rec({ id: 'a2', clockOut: '18:00' }), rec({ id: 'a3', clockIn: '', clockOut: '' })];
  assert.deepEqual(inProgressRecords(list).map((r) => r.id), ['a1']);
});
