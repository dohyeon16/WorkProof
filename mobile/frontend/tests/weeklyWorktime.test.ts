import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWeeklyWorktime,
  weeklyInsight,
  weekMondayOf,
  datesOfWeek,
  deriveWorktimeNotices,
} from '../src/features/insights/weeklyWorktime';
import type { AttendanceRecord, ScheduledShift, Workplace } from '../src/core/domain/models/types';

const at = (d: string, t: string) => new Date(`${d}T${t}:00`).getTime();
function rec(over: Partial<AttendanceRecord>): AttendanceRecord {
  return { id: 'r' + Math.random(), workplaceId: 'w1', date: '2026-08-04', clockIn: '09:00', clockOut: '18:00', breakMinutes: 0, ...over };
}
function shift(over: Partial<ScheduledShift>): ScheduledShift {
  return { id: 's' + Math.random(), workplaceId: 'w1', date: '2026-08-04', startTime: '09:00', endTime: '17:00', reminderMinutes: 0, createdAt: 'T', ...over };
}
function wp(over: Partial<Workplace> = {}): Workplace {
  return { id: 'w1', name: '카페', hourlyWage: 12000, payDay: 10, weeklyAllowance: true, breakMinutesPerShift: 0, createdAt: 'T', ...over };
}

// ---- 주 경계 ----
test('weekMondayOf: 목요일→그 주 월요일, 일요일→같은 주 월요일', () => {
  assert.equal(weekMondayOf('2026-08-06'), '2026-08-03'); // Thu
  assert.equal(weekMondayOf('2026-08-09'), '2026-08-03'); // Sun
  assert.equal(weekMondayOf('2026-08-03'), '2026-08-03'); // Mon
});
test('datesOfWeek: 월~일 7일, 월/연 경계도 정확', () => {
  assert.deepEqual(datesOfWeek('2026-08-03').length, 7);
  // 2026-01-01(목)의 주 월요일은 2025-12-29 → 연 경계 횡단
  const w = datesOfWeek(weekMondayOf('2026-01-01'));
  assert.equal(w[0], '2025-12-29');
  assert.ok(w.includes('2026-01-01'));
});

// ---- 임계값(정보성 상태) ----
test('weeklyInsight 임계: 0/14h59/15h/15h+', () => {
  assert.deepEqual(weeklyInsight(0), { allowance: 'none', overtime: 'none' });
  assert.equal(weeklyInsight(14 * 60 + 59).allowance, 'none');
  assert.equal(weeklyInsight(15 * 60).allowance, 'possible');
  assert.equal(weeklyInsight(15 * 60 + 1).allowance, 'possible');
});
test('weeklyInsight 임계: 39h/40h(근접)·40h+ (초과)', () => {
  assert.equal(weeklyInsight(39 * 60).overtime, 'near');
  assert.equal(weeklyInsight(40 * 60).overtime, 'near');
  assert.equal(weeklyInsight(40 * 60 + 1).overtime, 'exceed');
  assert.equal(weeklyInsight(37 * 60).overtime, 'none');
});

const MON = '2026-08-03';
const NOW = at('2026-08-06', '12:00');

// ---- 집계 정책 ----
test('예정만 존재', () => {
  const r = computeWeeklyWorktime({ records: [], shifts: [shift({ date: '2026-08-04', startTime: '09:00', endTime: '17:00' })], workplaceId: 'w1', weekMonday: MON, now: NOW });
  assert.deepEqual([r.actualMinutes, r.plannedMinutes, r.expectedMinutes], [0, 480, 480]);
});
test('실제만 존재(완료 기록, 휴게 차감)', () => {
  const r = computeWeeklyWorktime({ records: [rec({ date: '2026-08-04', clockIn: '09:00', clockOut: '18:00', breakMinutes: 60 })], shifts: [], workplaceId: 'w1', weekMonday: MON, now: NOW });
  assert.deepEqual([r.actualMinutes, r.plannedMinutes], [480, 0]);
});
test('실제 + 미래 예정 합산', () => {
  const r = computeWeeklyWorktime({
    records: [rec({ date: '2026-08-04', clockIn: '09:00', clockOut: '17:00', breakMinutes: 0 })], // 480 actual
    shifts: [shift({ date: '2026-08-06', startTime: '09:00', endTime: '13:00' })], // 240 planned
    workplaceId: 'w1', weekMonday: MON, now: NOW,
  });
  assert.deepEqual([r.actualMinutes, r.plannedMinutes, r.expectedMinutes], [480, 240, 720]);
});
test('완료된 예정근무와 실제기록 이중 집계 방지(같은 날짜=실제 우선)', () => {
  const r = computeWeeklyWorktime({
    records: [rec({ date: '2026-08-04', clockIn: '09:00', clockOut: '17:00', breakMinutes: 0 })], // 480
    shifts: [shift({ date: '2026-08-04', startTime: '09:00', endTime: '17:00' })], // 같은 날 예정 480 → 무시
    workplaceId: 'w1', weekMonday: MON, now: NOW,
  });
  assert.equal(r.expectedMinutes, 480); // 960 아님
  assert.equal(r.plannedMinutes, 0);
});
test('자정 넘김 근무(22:00→06:00) = 8h', () => {
  const r = computeWeeklyWorktime({ records: [rec({ date: '2026-08-05', clockIn: '22:00', clockOut: '06:00', breakMinutes: 0 })], shifts: [], workplaceId: 'w1', weekMonday: MON, now: NOW });
  assert.equal(r.actualMinutes, 480);
});
test('진행 중 근무: 출근~현재(now) 근사', () => {
  const r = computeWeeklyWorktime({ records: [rec({ date: '2026-08-06', clockIn: '09:00', clockOut: '' })], shifts: [], workplaceId: 'w1', weekMonday: MON, now: at('2026-08-06', '12:00') });
  assert.equal(r.actualMinutes, 180); // 3h
});
test('진행 중이라도 같은 날 예정은 무시(실제 우선)', () => {
  const r = computeWeeklyWorktime({ records: [rec({ date: '2026-08-06', clockIn: '09:00', clockOut: '' })], shifts: [shift({ date: '2026-08-06', endTime: '18:00' })], workplaceId: 'w1', weekMonday: MON, now: at('2026-08-06', '12:00') });
  assert.equal(r.expectedMinutes, 180);
});
test('다른 근무지는 분리 집계', () => {
  const records = [rec({ workplaceId: 'w1', date: '2026-08-04', clockIn: '09:00', clockOut: '17:00', breakMinutes: 0 }), rec({ workplaceId: 'w2', date: '2026-08-04', clockIn: '09:00', clockOut: '19:00', breakMinutes: 0 })];
  assert.equal(computeWeeklyWorktime({ records, shifts: [], workplaceId: 'w1', weekMonday: MON, now: NOW }).actualMinutes, 480);
  assert.equal(computeWeeklyWorktime({ records, shifts: [], workplaceId: 'w2', weekMonday: MON, now: NOW }).actualMinutes, 600);
});
test('이번 주 밖(지난 주) 기록은 제외', () => {
  const r = computeWeeklyWorktime({ records: [rec({ date: '2026-07-28', clockIn: '09:00', clockOut: '18:00', breakMinutes: 0 })], shifts: [], workplaceId: 'w1', weekMonday: MON, now: NOW });
  assert.equal(r.expectedMinutes, 0);
});
test('종료시간 없는 예정은 시간 산정 불가 → 0(무리한 추측 안 함)', () => {
  const r = computeWeeklyWorktime({ records: [], shifts: [shift({ date: '2026-08-04', startTime: '09:00', endTime: undefined })], workplaceId: 'w1', weekMonday: MON, now: NOW });
  assert.equal(r.plannedMinutes, 0);
});

// ---- 인앱 안내 ----
const today = '2026-08-06';
function planned(dates: string[]): ScheduledShift[] {
  return dates.map((d) => shift({ date: d, startTime: '09:00', endTime: '17:00' })); // 각 8h
}
test('안내: 이번 주 15h 이상 → 주휴 요건 확인(정보성)', () => {
  const notices = deriveWorktimeNotices({ workplaces: [wp()], records: [], shifts: planned(['2026-08-03', '2026-08-04']), readIds: [], today, now: NOW });
  const allow = notices.find((n) => n.id.startsWith('worktime-allowance-'));
  assert.ok(allow);
  assert.equal(allow!.tone, 'info');
  assert.match(allow!.body, /달라지니|확인/);
  assert.ok(!/확정|위반|미지급/.test(allow!.title + allow!.body)); // 금지 표현 없음
});
test('안내: 40h 초과 → 초과 가능 안내(정보성·확정 아님)', () => {
  const notices = deriveWorktimeNotices({ workplaces: [wp()], records: [], shifts: planned(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08']), readIds: [], today, now: NOW }); // 6×8=48h
  const ot = notices.find((n) => n.id.startsWith('worktime-overtime-'));
  assert.ok(ot);
  assert.match(ot!.body, /달라질 수 있어요/);
});
test('안내: 근무지별 분리(임계 넘은 근무지만)', () => {
  const workplaces = [wp({ id: 'w1', name: 'A' }), wp({ id: 'w2', name: 'B' })];
  const shifts = planned(['2026-08-03', '2026-08-04']).map((s) => ({ ...s, workplaceId: 'w1' })); // w1만 16h
  const notices = deriveWorktimeNotices({ workplaces, records: [], shifts, readIds: [], today, now: NOW });
  assert.ok(notices.every((n) => n.id.includes('w1')));
});
test('안내: 예상 0시간 근무지는 안내 없음', () => {
  const notices = deriveWorktimeNotices({ workplaces: [wp()], records: [], shifts: [], readIds: [], today, now: NOW });
  assert.equal(notices.length, 0);
});
test('안내: 지난 주 예정만 있으면 이번 주 안내 미생성(과거 주 알림 없음)', () => {
  const notices = deriveWorktimeNotices({ workplaces: [wp()], records: [], shifts: planned(['2026-07-20', '2026-07-21']), readIds: [], today, now: NOW });
  assert.equal(notices.length, 0);
});
test('안내: 안정적 id(주 포함) + read 상태 반영(중복 방지)', () => {
  const args = { workplaces: [wp()], records: [], shifts: planned(['2026-08-03', '2026-08-04']), today, now: NOW };
  const first = deriveWorktimeNotices({ ...args, readIds: [] });
  const id = first[0].id;
  assert.match(id, /-2026-08-03$/); // 이번 주 월요일 포함
  const second = deriveWorktimeNotices({ ...args, readIds: [id] });
  assert.equal(second.find((n) => n.id === id)!.read, true); // 같은 id → 읽음 반영(중복 생성 아님)
});
