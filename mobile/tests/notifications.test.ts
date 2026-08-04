// 인앱 알림 파생(deriveNotifications) 순수 검증 — 이동 대상/삭제 근무지 skip/빈 목록/정렬.
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveNotifications, type NotificationsInput } from '../src/core/notifications/deriveNotifications';
import type { AttendanceRecord, PayRecord, Workplace } from '../src/core/domain/models/types';

function wp(over: Partial<Workplace> = {}): Workplace {
  return {
    id: 'w1',
    name: '카페',
    hourlyWage: 10000,
    payDay: 10,
    weeklyAllowance: false,
    breakMinutesPerShift: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}
function att(over: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 'a1',
    workplaceId: 'w1',
    date: '2026-08-01',
    clockIn: '09:00',
    clockOut: '18:00',
    breakMinutes: 0,
    ...over,
  };
}
function pay(over: Partial<PayRecord> = {}): PayRecord {
  return {
    id: 'p1',
    workplaceId: 'w1',
    yearMonth: '2026-07',
    expectedPay: 100000,
    actualPay: null,
    payDate: null,
    diff: null,
    checklist: [],
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

function baseInput(over: Partial<NotificationsInput> = {}): NotificationsInput {
  return {
    workplaces: [],
    payRecords: [],
    attendance: [],
    readIds: [],
    today: '2026-08-05',
    thisMonth: '2026-08',
    lastMonth: '2026-07',
    daysUntilPayday: () => 30, // 기본: 급여일 임박 아님
    ...over,
  };
}

test('빈 입력 → 빈 목록', () => {
  assert.deepEqual(deriveNotifications(baseInput()), []);
});

test('퇴근 미기록 → AttendanceForm link + target.hasPay=false', () => {
  const items = deriveNotifications(
    baseInput({
      workplaces: [wp()],
      attendance: [att({ id: 'aX', date: '2026-08-01', clockIn: '09:00', clockOut: '' })],
    })
  );
  const unclosed = items.find((i) => i.id === 'unclosed-aX');
  assert.ok(unclosed, '퇴근 미기록 알림 있어야 함');
  assert.deepEqual(unclosed!.link, {
    screen: 'AttendanceForm',
    params: { workplaceId: 'w1', id: 'aX' },
  });
  assert.equal(unclosed!.target.hasPay, false);
});

test('삭제된 근무지의 잔여 근태 기록은 건너뛴다', () => {
  const items = deriveNotifications(
    baseInput({
      workplaces: [], // 근무지 없음(삭제됨)
      attendance: [att({ id: 'aX', clockOut: '' })],
    })
  );
  assert.equal(items.length, 0);
});

test('오늘 급여일(daysUntil=0) → priority 0, hasPay 반영', () => {
  const items = deriveNotifications(
    baseInput({
      workplaces: [wp({ id: 'w1', payDay: 5 })],
      payRecords: [pay({ id: 'p1', workplaceId: 'w1', yearMonth: '2026-08', actualPay: 50000, diff: 0 })],
      daysUntilPayday: () => 0,
    })
  );
  const payday = items.find((i) => i.id === 'payday-w1-2026-08');
  assert.ok(payday);
  assert.equal(payday!.priority, 0);
  assert.equal(payday!.target.hasPay, true);
});

test('부족 급여(diff<0) → shortfall 경고, target.hasPay=true', () => {
  const items = deriveNotifications(
    baseInput({
      workplaces: [wp()],
      payRecords: [pay({ yearMonth: '2026-07', actualPay: 90000, diff: -10000 })],
    })
  );
  const shortfall = items.find((i) => i.id === 'shortfall-w1-2026-07');
  assert.ok(shortfall);
  assert.equal(shortfall!.tone, 'warning');
  assert.equal(shortfall!.target.hasPay, true);
});

test('지난달 근무 있는데 입금액 미입력 → unentered 안내', () => {
  const items = deriveNotifications(
    baseInput({
      workplaces: [wp()],
      attendance: [att({ id: 'aL', date: '2026-07-15', clockOut: '18:00' })],
      payRecords: [],
    })
  );
  assert.ok(items.some((i) => i.id === 'unentered-w1-2026-07'));
});

test('정렬: priority 오름차순, 동일 priority는 id 순', () => {
  const items = deriveNotifications(
    baseInput({
      workplaces: [wp({ id: 'w1', name: '카페', payDay: 5 })],
      attendance: [att({ id: 'aX', date: '2026-08-01', clockOut: '' })], // priority 1
      daysUntilPayday: () => 0, // payday priority 0
    })
  );
  // payday(0)가 unclosed(1)보다 앞
  assert.equal(items[0].id, 'payday-w1-2026-08');
  const priorities = items.map((i) => i.priority);
  const sorted = [...priorities].sort((a, b) => a - b);
  assert.deepEqual(priorities, sorted);
});

test('read 상태 반영: readIds 에 있으면 read=true', () => {
  const items = deriveNotifications(
    baseInput({
      workplaces: [wp({ payDay: 5 })],
      daysUntilPayday: () => 0,
      readIds: ['payday-w1-2026-08'],
    })
  );
  const payday = items.find((i) => i.id === 'payday-w1-2026-08');
  assert.equal(payday!.read, true);
});
