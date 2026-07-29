// 순수 함수 자동 검증(무의존: tsc로 CommonJS 컴파일 후 node:test로 실행).
// RN/AsyncStorage에 의존하지 않는 로직만 대상으로 한다. 저장/알림/네비게이션 결합 로직은
// 웹/실기기 검증 항목으로 남긴다(보고서 D 참조).
import test from 'node:test';
import assert from 'node:assert/strict';

import { haversineMeters, evaluateProximity } from '../src/features/attendance/utils/geo';
import {
  calcMonthlySummary,
  nightOverlapMinutes,
  deductionAmount,
  netPay,
} from '../src/core/domain/payroll/payCalc';
import {
  reduceAppState,
  initialAppLockState,
  markAuthStarted,
  markAuthFinished,
  BACKGROUND_LOCK_GRACE_MS,
  POST_UNLOCK_GRACE_MS,
  type AppLockState,
} from '../src/features/security/services/appLockState';
import { KEYS, BACKUP_KEYS, ALL_KEYS } from '../src/core/data/storageKeys';
import type { AttendanceRecord, Workplace } from '../src/core/domain/models/types';

let seq = 0;
function wp(over: Partial<Workplace> = {}): Workplace {
  return {
    id: 'w1',
    name: 'Test',
    hourlyWage: 10000,
    payDay: 10,
    weeklyAllowance: false,
    fiveOrMoreEmployees: true,
    breakMinutesPerShift: 0,
    createdAt: '2024-01-01T00:00:00Z',
    ...over,
  };
}
function rec(
  date: string,
  clockIn: string,
  clockOut: string,
  over: Partial<AttendanceRecord> = {}
): AttendanceRecord {
  return { id: `r${seq++}`, workplaceId: 'w1', date, clockIn, clockOut, breakMinutes: 0, ...over };
}

// ---------- 1. 하버사인 거리 ----------
test('haversine: 동일 좌표는 0m', () => {
  assert.equal(haversineMeters({ latitude: 37.5, longitude: 127 }, { latitude: 37.5, longitude: 127 }), 0);
});
test('haversine: 위도 1도 ≈ 111,195m', () => {
  const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
  assert.ok(Math.abs(d - 111194.9) < 1, `got ${d}`);
});
test('evaluateProximity: 반경 내/외/좌표없음', () => {
  const work = { latitude: 37.5, longitude: 127 };
  assert.equal(evaluateProximity(work, { latitude: 37.5, longitude: 127 })?.verified, true);
  assert.equal(evaluateProximity(work, { latitude: 37.5009, longitude: 127 })?.verified, true); // ~100m
  assert.equal(evaluateProximity(work, { latitude: 37.51, longitude: 127 })?.verified, false); // ~1.1km
  assert.equal(evaluateProximity(work, { latitude: undefined, longitude: undefined }), null);
  assert.equal(evaluateProximity({}, { latitude: 37.5, longitude: 127 }), null);
});

// ---------- 2. 연장근로 일 8시간 경계 ----------
test('연장: 480분=연장0, 481분=연장1', () => {
  const s480 = calcMonthlySummary([rec('2024-01-15', '09:00', '17:00')], wp(), '2024-01');
  assert.equal(s480.overtimeMinutes, 0);
  const s481 = calcMonthlySummary([rec('2024-01-15', '09:00', '17:01')], wp(), '2024-01');
  assert.equal(s481.overtimeMinutes, 1);
});

// ---------- 3. 주 40시간 경계 ----------
test('연장: 주 2400분=주간연장0, 2401분=주간연장1', () => {
  const week = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']; // Mon~Fri
  const rs2400 = week.map((d) => rec(d, '09:00', '17:00')); // 480×5 = 2400
  assert.equal(calcMonthlySummary(rs2400, wp(), '2024-01').overtimeMinutes, 0);
  const rs2401 = [...rs2400, rec('2024-01-06', '09:00', '09:01')]; // + 1분(Sat, 같은 주)
  assert.equal(calcMonthlySummary(rs2401, wp(), '2024-01').overtimeMinutes, 1);
});

// ---------- 4. 야간 경계 (22:00~06:00) ----------
test('야간 경계값', () => {
  assert.equal(nightOverlapMinutes('14:00', '22:00'), 0); // 22:00에 끝 → 야간 0
  assert.equal(nightOverlapMinutes('14:00', '22:01'), 1); // 22:00 넘김 → 1분
  assert.equal(nightOverlapMinutes('21:00', '21:59'), 0); // 21:59까지 → 야간 0
  assert.equal(nightOverlapMinutes('22:00', '23:00'), 60);
  assert.equal(nightOverlapMinutes('05:00', '05:59'), 59); // 05:59 경계
  assert.equal(nightOverlapMinutes('05:00', '06:00'), 60); // 06:00까지 산입
  assert.equal(nightOverlapMinutes('06:00', '10:00'), 0); // 06:00 이후 → 야간 0
  assert.equal(nightOverlapMinutes('22:00', '06:00'), 480); // 익일 퇴근 전체 야간
  assert.equal(nightOverlapMinutes('02:00', '06:00'), 240);
});

// ---------- 5. 휴일 ↔ 연장 중복 방지 & 야간 중첩 ----------
test('휴일근무는 연장에서 제외, 휴일 가산은 별도(8h 50%/초과 100%)', () => {
  const holiday = calcMonthlySummary([rec('2024-01-15', '09:00', '18:00', { isHoliday: true })], wp(), '2024-01');
  assert.equal(holiday.overtimeMinutes, 0, '휴일은 연장 제외');
  assert.equal(holiday.holidayMinutes, 540);
  assert.equal(holiday.holidayPay, 50000); // 480/60*10000*0.5 + 60/60*10000*1.0
  const normal = calcMonthlySummary([rec('2024-01-15', '09:00', '18:00')], wp(), '2024-01');
  assert.equal(normal.overtimeMinutes, 60, '평일 동일 근무는 연장 60분');
  assert.equal(normal.holidayMinutes, 0);
});
test('야간은 휴일에도 중첩 적용', () => {
  const s = calcMonthlySummary([rec('2024-01-15', '22:00', '06:00', { isHoliday: true })], wp(), '2024-01');
  assert.equal(s.holidayMinutes, 480);
  assert.equal(s.nightMinutes, 480);
  assert.equal(s.overtimeMinutes, 0);
});
test('5인 미만은 가산 전부 0', () => {
  const s = calcMonthlySummary(
    [rec('2024-01-15', '22:00', '08:00', { isHoliday: true })],
    wp({ fiveOrMoreEmployees: false }),
    '2024-01'
  );
  assert.equal(s.overtimeMinutes, 0);
  assert.equal(s.nightMinutes, 0);
  assert.equal(s.holidayMinutes, 0);
  assert.equal(s.overtimePay + s.nightPay + s.holidayPay, 0);
});

// ---------- 6. 공제 반올림 ----------
test('공제 반올림(없음/3.3%/4대보험, 반올림 half-up)', () => {
  assert.equal(deductionAmount(12345, 'none'), 0);
  assert.equal(netPay(12345, 'none'), 12345);
  assert.equal(deductionAmount(12345, 'withholding'), 407); // 407.385 → 407
  assert.equal(netPay(12345, 'withholding'), 11938);
  assert.equal(deductionAmount(12500, 'withholding'), 413); // 412.5 → 413 (half-up)
  assert.equal(deductionAmount(12345, 'insurance'), 1160); // 1160.43 → 1160
  assert.equal(netPay(12345, 'insurance'), 11185);
});

// ---------- 7. 앱 잠금 상태 전이 ----------
test('appLock: active→inactive→active 는 잠그지 않음', () => {
  let s = initialAppLockState();
  let r = reduceAppState(s, { prev: 'active', next: 'inactive', now: 1000 });
  assert.equal(r.lock, false);
  r = reduceAppState(r.state, { prev: 'inactive', next: 'active', now: 1100 });
  assert.equal(r.lock, false);
});
test('appLock: background 짧게(유예 내) 다녀오면 잠그지 않음', () => {
  const s = initialAppLockState();
  const bg = reduceAppState(s, { prev: 'active', next: 'background', now: 1000 });
  const back = reduceAppState(bg.state, { prev: 'background', next: 'active', now: 1000 + (BACKGROUND_LOCK_GRACE_MS - 1) });
  assert.equal(back.lock, false);
});
test('appLock: background 유예 초과면 잠금', () => {
  const s = initialAppLockState();
  const bg = reduceAppState(s, { prev: 'active', next: 'background', now: 1000 });
  const back = reduceAppState(bg.state, { prev: 'background', next: 'active', now: 1000 + BACKGROUND_LOCK_GRACE_MS });
  assert.equal(back.lock, true);
});
test('appLock: 인증 진행 중 AppState 변화는 무시(중복 인증 없음)', () => {
  const s = markAuthStarted(initialAppLockState());
  const bg = reduceAppState(s, { prev: 'active', next: 'background', now: 1000 });
  assert.equal(bg.lock, false);
  assert.equal(bg.state.backgroundedAt, null, '인증 중엔 background 시각도 기록 안 함');
  const back = reduceAppState(bg.state, { prev: 'background', next: 'active', now: 999999 });
  assert.equal(back.lock, false);
});
test('appLock: 인증 성공 직후 유예 내 active 는 재잠금 없음', () => {
  const s: AppLockState = { backgroundedAt: 0, authInProgress: false, lastUnlockAt: 4000 };
  // stayed=5000(>grace)이지만 lastUnlock 이후 1000ms(<POST_UNLOCK_GRACE)라 잠그지 않아야 함
  const r = reduceAppState(s, { prev: 'background', next: 'active', now: 5000 });
  assert.ok(POST_UNLOCK_GRACE_MS > 1000);
  assert.equal(r.lock, false);
});
test('appLock: markAuthFinished 성공은 lastUnlockAt 기록·backgroundedAt 초기화', () => {
  const started = markAuthStarted({ backgroundedAt: 500, authInProgress: false, lastUnlockAt: null });
  const ok = markAuthFinished(started, true, 2000);
  assert.equal(ok.authInProgress, false);
  assert.equal(ok.lastUnlockAt, 2000);
  assert.equal(ok.backgroundedAt, null);
  const fail = markAuthFinished(started, false, 3000);
  assert.equal(fail.lastUnlockAt, null); // 실패는 갱신 안 함
});

// ---------- 8. appLock 백업 제외 & 구버전 백업 호환 ----------
test('backup: appLock 은 BACKUP_KEYS 제외, ALL_KEYS 포함', () => {
  assert.ok(!BACKUP_KEYS.includes(KEYS.appLock));
  assert.ok(ALL_KEYS.includes(KEYS.appLock));
  assert.ok(BACKUP_KEYS.includes(KEYS.workplaces));
  assert.ok(BACKUP_KEYS.includes(KEYS.scheduledShifts));
});
test('backup: appLock 값이 든 백업을 복원해도 무시된다', () => {
  const backup: Record<string, string> = { [KEYS.appLock]: 'true', [KEYS.workplaces]: '[]' };
  const restored = BACKUP_KEYS.filter((k) => typeof backup[k] === 'string');
  assert.ok(!restored.includes(KEYS.appLock), '잠긴 백업이 다른 기기를 잠그지 않음');
  assert.ok(restored.includes(KEYS.workplaces));
});
test('backup: 구버전 백업(appLock 키 없음)도 정상 처리', () => {
  const oldBackup: Record<string, string> = { [KEYS.workplaces]: '[]', [KEYS.attendance]: '[]' };
  const restored = BACKUP_KEYS.filter((k) => typeof oldBackup[k] === 'string');
  assert.deepEqual(restored.sort(), [KEYS.attendance, KEYS.workplaces].sort());
});

// ---------- 9. 여러 근무지 합산 = 개별 합계 ----------
test('합산: 전체 예상급여/세후가 개별 근무지 합과 일치', () => {
  const a = wp({ id: 'a', hourlyWage: 10000, incomeDeductionType: 'withholding', fiveOrMoreEmployees: false });
  const b = wp({ id: 'b', hourlyWage: 12000, fiveOrMoreEmployees: false });
  const recsA = [rec('2024-01-10', '09:00', '17:00', { workplaceId: 'a' })]; // 8h → 80,000
  const recsB = [rec('2024-01-11', '09:00', '13:00', { workplaceId: 'b' })]; // 4h → 48,000
  const sa = calcMonthlySummary(recsA, a, '2024-01');
  const sb = calcMonthlySummary(recsB, b, '2024-01');
  assert.equal(sa.expectedPay, 80000);
  assert.equal(sb.expectedPay, 48000);
  const totalExpected = sa.expectedPay + sb.expectedPay;
  const totalNet = sa.netExpectedPay + sb.netExpectedPay;
  assert.equal(totalExpected, 128000);
  // A만 3.3% 공제: 80000 - round(80000*0.033)=80000-2640=77360, B는 공제 없음 48000
  assert.equal(sa.netExpectedPay, 77360);
  assert.equal(sb.netExpectedPay, 48000);
  assert.equal(totalNet, 77360 + 48000);
});
