import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDITED_FIELDS,
  diffAttendance,
  buildAttendanceChange,
  formatChangeValue,
} from '../src/features/attendance/services/auditTrail';
import type { AttendanceRecord } from '../src/types/domain';

function rec(over: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 'a1',
    workplaceId: 'w1',
    date: '2026-08-06',
    clockIn: '09:00',
    clockOut: '18:00',
    breakMinutes: 60,
    ...over,
  };
}

test('diffAttendance: 변경 없으면 빈 배열', () => {
  assert.deepEqual(diffAttendance(rec(), rec()), []);
});

test('diffAttendance: 단일 필드(퇴근) 변경', () => {
  const d = diffAttendance(rec({ clockOut: '18:00' }), rec({ clockOut: '19:30' }));
  assert.equal(d.length, 1);
  assert.deepEqual(d[0], { field: 'clockOut', before: '18:00', after: '19:30' });
});

test('diffAttendance: note undefined ↔ "" 는 변경 아님', () => {
  assert.deepEqual(diffAttendance(rec({ note: undefined }), rec({ note: '' })), []);
});

test('diffAttendance: isHoliday undefined ↔ false 는 변경 아님, true 면 변경', () => {
  assert.deepEqual(diffAttendance(rec({ isHoliday: undefined }), rec({ isHoliday: false })), []);
  const d = diffAttendance(rec({ isHoliday: false }), rec({ isHoliday: true }));
  assert.deepEqual(d, [{ field: 'isHoliday', before: false, after: true }]);
});

test('diffAttendance: GPS 좌표는 감사 대상이 아니다(변경 무시)', () => {
  const before = rec({ clockOutLatitude: 37.1, clockOutLongitude: 127.1 });
  const after = rec({ clockOutLatitude: 37.9, clockOutLongitude: 127.9 });
  assert.deepEqual(diffAttendance(before, after), []);
  assert.ok(!AUDITED_FIELDS.includes('clockOutLatitude' as never));
});

test('buildAttendanceChange: 생성(create)은 초기값 기준선, op=create', () => {
  const c = buildAttendanceChange({ before: null, after: rec(), source: 'clock', at: '2026-08-06T09:00:00Z', id: 'h1' });
  assert.ok(c);
  assert.equal(c!.op, 'create');
  assert.equal(c!.recordId, 'a1');
  assert.equal(c!.changes.length, AUDITED_FIELDS.length);
  const clockIn = c!.changes.find((x) => x.field === 'clockIn');
  assert.deepEqual([clockIn!.before, clockIn!.after], [null, '09:00']);
});

test('buildAttendanceChange: 수정 무변경이면 null(로그 안 남김)', () => {
  const c = buildAttendanceChange({ before: rec(), after: rec(), source: 'manual', at: 'T', id: 'h2' });
  assert.equal(c, null);
});

test('buildAttendanceChange: 수정은 바뀐 필드만 + reason 보존', () => {
  const c = buildAttendanceChange({
    before: rec({ clockOut: '18:00', breakMinutes: 60 }),
    after: rec({ clockOut: '20:00', breakMinutes: 30 }),
    source: 'manual',
    at: '2026-08-06T20:00:00Z',
    id: 'h3',
    reason: '연장근무 반영',
  });
  assert.ok(c);
  assert.equal(c!.op, 'update');
  assert.equal(c!.changes.length, 2);
  assert.equal(c!.reason, '연장근무 반영');
});

test('buildAttendanceChange: 빈 reason 은 저장하지 않음', () => {
  const c = buildAttendanceChange({ before: rec({ note: 'a' }), after: rec({ note: 'b' }), source: 'manual', at: 'T', id: 'h4', reason: '   ' });
  assert.ok(c);
  assert.equal(c!.reason, undefined);
});

test('formatChangeValue: 빈 퇴근/불리언 표기', () => {
  assert.equal(formatChangeValue('clockOut', ''), '(미퇴근)');
  assert.equal(formatChangeValue('note', null), '(없음)');
  assert.equal(formatChangeValue('isHoliday', true), '예');
  assert.equal(formatChangeValue('clockIn', '09:00'), '09:00');
});
