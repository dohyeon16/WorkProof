// 3-way 급여 비교 엔진 검증(node:test). 법적 판단(true/false)은 테스트하지 않는다 —
// 값 분리/차이/비교불가/정보성 notice 만 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';

import type { MonthlySummary } from '../src/core/domain/payroll/payCalc';
import type { PayslipAmounts, PayslipRecord } from '../src/core/domain/models/types';
import { emptyPayslipAmounts } from '../src/features/payroll/services/payslipExtraction';
import {
  buildPayComparison,
  comparePair,
  selectPayslipForMonth,
} from '../src/features/payroll/services/payComparison';

function makeSummary(over: Partial<MonthlySummary> = {}): MonthlySummary {
  return {
    yearMonth: '2026-08',
    dailyBreakdown: [],
    totalWorkedMinutes: 0,
    totalBreakMinutes: 0,
    weeklyAllowanceMinutes: 0,
    overtimeMinutes: 0,
    nightMinutes: 0,
    holidayMinutes: 0,
    basePay: 1_000_000,
    weeklyAllowancePay: 100_000,
    overtimePay: 0,
    nightPay: 0,
    holidayPay: 0,
    expectedPay: 1_100_000,
    deductionType: 'none',
    deductionPay: 0,
    netExpectedPay: 1_100_000,
    ...over,
  };
}

function payslip(over: Partial<PayslipAmounts> = {}): PayslipAmounts {
  return { ...emptyPayslipAmounts(), ...over };
}

// ---------- comparePair ----------
test('comparePair: 둘 다 있으면 diff, 하나라도 null 이면 incomparable', () => {
  assert.deepEqual(comparePair(1000, 900), { a: 1000, b: 900, diff: 100, status: 'differs' });
  assert.deepEqual(comparePair(1000, 1000), { a: 1000, b: 1000, diff: 0, status: 'match' });
  assert.deepEqual(comparePair(1000, null), { a: 1000, b: null, diff: null, status: 'incomparable' });
  assert.deepEqual(comparePair(null, 0), { a: null, b: 0, diff: null, status: 'incomparable' }); // null≠0
});

// ---------- 헤드라인 3쌍 ----------
test('세 값 모두 동일 → 모두 match', () => {
  const c = buildPayComparison({
    // 지급/공제 세부까지 정합적인 시나리오(정보성 notice 도 없어야 함).
    summary: makeSummary({ basePay: 1_000_000, weeklyAllowancePay: 0, expectedPay: 1_000_000, netExpectedPay: 1_000_000 }),
    payslip: payslip({ grossPay: 1_000_000, netPay: 1_000_000 }),
    actualDeposit: 1_000_000,
  });
  assert.equal(c.expectedVsPayslipGross.status, 'match');
  assert.equal(c.payslipNetVsActual.status, 'match');
  assert.equal(c.expectedNetVsActual.status, 'match');
  assert.equal(c.notices.length, 0);
});

test('expected 만 존재(명세서/입금 없음) → 비교 불가 + no_payslip', () => {
  const c = buildPayComparison({ summary: makeSummary(), payslip: null, actualDeposit: null });
  assert.equal(c.hasExpected, true);
  assert.equal(c.hasPayslip, false);
  assert.equal(c.hasActual, false);
  assert.equal(c.expectedVsPayslipGross.status, 'incomparable');
  assert.equal(c.expectedNetVsActual.status, 'incomparable');
  assert.ok(c.notices.some((n) => n.code === 'no_payslip'));
});

test('명세서 없음 → payslip 관련 전부 incomparable', () => {
  const c = buildPayComparison({ summary: makeSummary(), payslip: null, actualDeposit: 900_000 });
  assert.equal(c.payslipNetVsActual.status, 'incomparable');
  assert.equal(c.items.every((i) => i.payslip === null && i.status === 'incomparable'), true);
});

test('실제 입금 없음 → net↔actual incomparable', () => {
  const c = buildPayComparison({
    summary: makeSummary(),
    payslip: payslip({ grossPay: 1_100_000, netPay: 1_050_000 }),
    actualDeposit: null,
  });
  assert.equal(c.payslipNetVsActual.status, 'incomparable');
  assert.equal(c.expectedNetVsActual.status, 'incomparable');
});

test('expected > payslip / expected < payslip → diff 부호', () => {
  const hi = buildPayComparison({ summary: makeSummary({ expectedPay: 1_200_000 }), payslip: payslip({ grossPay: 1_000_000 }), actualDeposit: null });
  assert.equal(hi.expectedVsPayslipGross.diff, 200_000);
  const lo = buildPayComparison({ summary: makeSummary({ expectedPay: 900_000 }), payslip: payslip({ grossPay: 1_000_000 }), actualDeposit: null });
  assert.equal(lo.expectedVsPayslipGross.diff, -100_000); // 음수 차이 그대로
});

test('payslip > actual / payslip < actual', () => {
  const c = buildPayComparison({ summary: null, payslip: payslip({ netPay: 1_000_000 }), actualDeposit: 950_000 });
  assert.equal(c.payslipNetVsActual.diff, 50_000);
  const c2 = buildPayComparison({ summary: null, payslip: payslip({ netPay: 1_000_000 }), actualDeposit: 1_050_000 });
  assert.equal(c2.payslipNetVsActual.diff, -50_000);
});

test('gross 같고 net 다름 → gross match, net differs', () => {
  const c = buildPayComparison({
    summary: makeSummary({ expectedPay: 1_000_000, netExpectedPay: 950_000 }),
    payslip: payslip({ grossPay: 1_000_000, netPay: 900_000 }),
    actualDeposit: 900_000,
  });
  assert.equal(c.expectedVsPayslipGross.status, 'match');
  assert.equal(c.payslipNetVsActual.status, 'match'); // 900k == 900k
  const netItem = c.items.find((i) => i.key === 'netPay')!;
  assert.equal(netItem.status, 'differs');
  assert.equal(netItem.diff, 50_000);
});

test('공제 차이 → deduction_diff notice, 항목은 estimated 표시', () => {
  const c = buildPayComparison({
    summary: makeSummary({ deductionType: 'insurance', deductionPay: 100_000, expectedPay: 1_100_000, netExpectedPay: 1_000_000 }),
    payslip: payslip({ grossPay: 1_100_000, totalDeduction: 120_000, netPay: 980_000 }),
    actualDeposit: null,
  });
  const ded = c.items.find((i) => i.key === 'totalDeduction')!;
  assert.equal(ded.status, 'differs');
  assert.equal(ded.estimated, true);
  assert.ok(c.notices.some((n) => n.code === 'deduction_diff'));
});

test('항목별 차이: 기본급 diff 계산', () => {
  const c = buildPayComparison({
    summary: makeSummary({ basePay: 1_000_000 }),
    payslip: payslip({ basePay: 950_000 }),
    actualDeposit: null,
  });
  const base = c.items.find((i) => i.key === 'basePay')!;
  assert.equal(base.diff, 50_000);
  assert.equal(base.status, 'differs');
});

test('null vs 0 구분: payslip 0 vs expected 0 = match, payslip null = incomparable', () => {
  const c = buildPayComparison({
    summary: makeSummary({ overtimePay: 0 }),
    payslip: payslip({ overtimePay: 0, nightPay: null }),
    actualDeposit: null,
  });
  assert.equal(c.items.find((i) => i.key === 'overtimePay')!.status, 'match'); // 0==0
  assert.equal(c.items.find((i) => i.key === 'nightPay')!.status, 'incomparable'); // null≠0
});

test('주휴수당 명세서 미기재 → weekly_allowance_missing', () => {
  const c = buildPayComparison({
    summary: makeSummary({ weeklyAllowancePay: 100_000 }),
    payslip: payslip({ weeklyAllowance: null, grossPay: 1_100_000 }),
    actualDeposit: null,
  });
  assert.ok(c.notices.some((n) => n.code === 'weekly_allowance_missing'));
});

test('연장/야간/휴일 앱 계산 있는데 명세서 비어있음 → premium_items_check', () => {
  const c = buildPayComparison({
    summary: makeSummary({ overtimePay: 50_000 }),
    payslip: payslip({ overtimePay: null, grossPay: 1_150_000 }),
    actualDeposit: null,
  });
  assert.ok(c.notices.some((n) => n.code === 'premium_items_check'));
});

test('명세서↔실입금 차이 → payslip_vs_actual notice', () => {
  const c = buildPayComparison({
    summary: null,
    payslip: payslip({ netPay: 1_000_000 }),
    actualDeposit: 900_000,
  });
  assert.ok(c.notices.some((n) => n.code === 'payslip_vs_actual'));
});

// ---------- selectPayslipForMonth ----------
function rec(over: Partial<PayslipRecord>): PayslipRecord {
  return {
    id: 'x',
    workplaceId: 'w1',
    yearMonth: '2026-08',
    amounts: emptyPayslipAmounts(),
    extractionSource: 'ai',
    reviewedByUser: false,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

test('selectPayslipForMonth: workplace+yearMonth 필터(불일치 제외)', () => {
  const list = [rec({ id: 'a', yearMonth: '2026-07' }), rec({ id: 'b', workplaceId: 'w2' })];
  assert.equal(selectPayslipForMonth(list, 'w1', '2026-08'), null);
});

test('selectPayslipForMonth: 확인된 것 우선, 그다음 최신 updatedAt', () => {
  const list = [
    rec({ id: 'old-reviewed', reviewedByUser: true, updatedAt: '2026-08-02T00:00:00Z' }),
    rec({ id: 'new-unreviewed', reviewedByUser: false, updatedAt: '2026-08-09T00:00:00Z' }),
  ];
  assert.equal(selectPayslipForMonth(list, 'w1', '2026-08')?.id, 'old-reviewed');

  const list2 = [
    rec({ id: 'r1', reviewedByUser: true, updatedAt: '2026-08-02T00:00:00Z' }),
    rec({ id: 'r2', reviewedByUser: true, updatedAt: '2026-08-05T00:00:00Z' }),
  ];
  assert.equal(selectPayslipForMonth(list2, 'w1', '2026-08')?.id, 'r2'); // 둘 다 확인됨 → 최신
});
