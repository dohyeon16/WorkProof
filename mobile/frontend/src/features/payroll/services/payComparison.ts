// 3-way 급여 비교 엔진(순수 — RN/네트워크 의존 없음, node:test 대상).
//
// Phase 4C-4: WorkProof 핵심 비교. 세 값을 절대 같은 것으로 취급하지 않는다.
//   1) Expected  = 앱 payCalc 계산값(MonthlySummary)
//   2) Payslip   = 급여명세서 구조화 값(PayslipAmounts, 사업주 기재)
//   3) Actual    = 사용자가 실제 계좌로 받은 입금액(PayRecord.actualPay)
// 목적은 숫자 3개 표시가 아니라 "어디서 차이가 났는지"를 분리해 보여주는 것.
//
// 원칙:
//  - 모든 차이는 정수(원). null/미상은 0 으로 계산하지 않는다(비교 불가로 둔다).
//  - 법적 판단(체불/위반/미지급 확정) 금지 — 정보성 상태만 제공.
import type { MonthlySummary } from '../../../core/domain/payroll/payCalc';
import type { PayslipAmounts, PayslipRecord } from '../../../core/domain/models/types';
import { PAYSLIP_FIELD_LABELS } from './payslipExtraction';

export type CompareStatus = 'match' | 'differs' | 'incomparable';

export interface ComparePair {
  a: number | null;
  b: number | null;
  /** a - b (둘 다 숫자일 때만). 그 외 null. */
  diff: number | null;
  status: CompareStatus;
}

/** 항목별 비교 대상 키(Expected ↔ Payslip 을 나란히 볼 수 있는 항목). */
export type CompareItemKey =
  | 'basePay'
  | 'weeklyAllowance'
  | 'overtimePay'
  | 'nightPay'
  | 'holidayPay'
  | 'otherAllowance'
  | 'grossPay'
  | 'totalDeduction'
  | 'netPay';

export interface CompareItem {
  key: CompareItemKey;
  label: string;
  expected: number | null;
  payslip: number | null;
  diff: number | null;
  status: CompareStatus;
  /** 앱 계산이 추정치인 항목(공제) — 차이를 단정적으로 보지 않도록 표시. */
  estimated?: boolean;
}

export type PayComparisonNoticeCode =
  | 'no_payslip'
  | 'no_actual'
  | 'expected_vs_payslip_gross'
  | 'payslip_vs_actual'
  | 'deduction_diff'
  | 'weekly_allowance_missing'
  | 'premium_items_check';

export interface PayComparisonNotice {
  code: PayComparisonNoticeCode;
  message: string;
}

export interface PayComparison {
  hasExpected: boolean;
  hasPayslip: boolean;
  hasActual: boolean;
  expectedGross: number | null;
  expectedNet: number | null;
  payslipGross: number | null;
  payslipNet: number | null;
  actualDeposit: number | null;
  // 핵심 3쌍
  expectedVsPayslipGross: ComparePair; // 예상 지급총액 ↔ 명세서 지급총액
  payslipNetVsActual: ComparePair; // 명세서 실지급 ↔ 실제 입금
  expectedNetVsActual: ComparePair; // 예상 실수령 ↔ 실제 입금
  items: CompareItem[];
  notices: PayComparisonNotice[];
}

/** 두 값을 비교한 쌍. 한쪽이라도 null(미상)이면 incomparable(0 으로 채우지 않는다). */
export function comparePair(a: number | null, b: number | null): ComparePair {
  if (a === null || b === null) return { a, b, diff: null, status: 'incomparable' };
  const diff = a - b;
  return { a, b, diff, status: diff === 0 ? 'match' : 'differs' };
}

interface ExpectedItems {
  basePay: number | null;
  weeklyAllowance: number | null;
  overtimePay: number | null;
  nightPay: number | null;
  holidayPay: number | null;
  otherAllowance: number | null;
  grossPay: number | null;
  totalDeduction: number | null;
  netPay: number | null;
}

/** MonthlySummary 를 명세서와 비교 가능한 항목으로 매핑. 앱에 없는 개념은 null(비교 불가). */
export function expectedItemsFromSummary(s: MonthlySummary): ExpectedItems {
  return {
    basePay: s.basePay,
    weeklyAllowance: s.weeklyAllowancePay,
    overtimePay: s.overtimePay,
    nightPay: s.nightPay,
    holidayPay: s.holidayPay,
    otherAllowance: null, // 앱은 '기타 수당' 개념이 없어 비교 불가
    grossPay: s.expectedPay,
    totalDeduction: s.deductionPay, // 요율 기반 '추정' 공제(명세서 실제 공제와 다를 수 있음)
    netPay: s.netExpectedPay,
  };
}

const ITEM_DEFS: { key: CompareItemKey; estimated?: boolean }[] = [
  { key: 'basePay' },
  { key: 'weeklyAllowance' },
  { key: 'overtimePay' },
  { key: 'nightPay' },
  { key: 'holidayPay' },
  { key: 'otherAllowance' },
  { key: 'grossPay' },
  { key: 'totalDeduction', estimated: true },
  { key: 'netPay' },
];

function buildNotices(
  exp: ExpectedItems | null,
  ps: PayslipAmounts | null,
  gross: ComparePair,
  netActual: ComparePair,
  items: CompareItem[]
): PayComparisonNotice[] {
  const notices: PayComparisonNotice[] = [];
  if (!ps) {
    notices.push({ code: 'no_payslip', message: '급여명세서가 없어 명세서 비교를 할 수 없어요. 명세서를 등록해보세요.' });
    return notices;
  }
  if (gross.status === 'differs') {
    notices.push({ code: 'expected_vs_payslip_gross', message: '앱 계산액과 명세서 지급액이 달라요. 항목별 차이를 확인해보세요.' });
  }
  const deduction = items.find((i) => i.key === 'totalDeduction');
  if (deduction && deduction.status === 'differs') {
    notices.push({ code: 'deduction_diff', message: '공제액 차이를 확인해보세요. (앱 공제는 추정치예요.)' });
  }
  // 주휴수당: 앱은 계산했는데 명세서에 항목이 확인되지 않음.
  if (exp && exp.weeklyAllowance !== null && exp.weeklyAllowance > 0 && ps.weeklyAllowance === null) {
    notices.push({ code: 'weekly_allowance_missing', message: '주휴수당 항목이 명세서에 확인되지 않아요.' });
  }
  // 연장/야간/휴일: 앱은 계산했는데 명세서에 해당 항목이 비어 있음.
  const premiumMissing =
    exp &&
    (['overtimePay', 'nightPay', 'holidayPay'] as const).some(
      (k) => exp[k] !== null && exp[k]! > 0 && ps[k] === null
    );
  if (premiumMissing) {
    notices.push({ code: 'premium_items_check', message: '연장/야간/휴일 항목을 확인해보세요.' });
  }
  if (netActual.status === 'differs') {
    notices.push({ code: 'payslip_vs_actual', message: '명세서 실지급액과 실제 입금액이 달라요. 입금액을 확인해보세요.' });
  }
  return notices;
}

/**
 * 3-way 비교를 계산한다(derived state — 저장하지 않는다). 값이 없으면 비교 불가로 둔다.
 */
export function buildPayComparison(input: {
  summary: MonthlySummary | null;
  payslip: PayslipAmounts | null;
  actualDeposit: number | null;
}): PayComparison {
  const exp = input.summary ? expectedItemsFromSummary(input.summary) : null;
  const ps = input.payslip;
  const actualDeposit = input.actualDeposit;

  const expectedGross = exp?.grossPay ?? null;
  const expectedNet = exp?.netPay ?? null;
  const payslipGross = ps?.grossPay ?? null;
  const payslipNet = ps?.netPay ?? null;

  const expectedVsPayslipGross = comparePair(expectedGross, payslipGross);
  const payslipNetVsActual = comparePair(payslipNet, actualDeposit);
  const expectedNetVsActual = comparePair(expectedNet, actualDeposit);

  const items: CompareItem[] = ITEM_DEFS.map((def) => {
    const e = exp ? exp[def.key] : null;
    const p = ps ? ps[def.key] : null;
    const pr = comparePair(e, p);
    return {
      key: def.key,
      label: PAYSLIP_FIELD_LABELS[def.key],
      expected: e,
      payslip: p,
      diff: pr.diff,
      status: pr.status,
      estimated: def.estimated,
    };
  });

  const notices = buildNotices(exp, ps, expectedVsPayslipGross, payslipNetVsActual, items);

  return {
    hasExpected: exp !== null,
    hasPayslip: ps !== null,
    hasActual: actualDeposit !== null,
    expectedGross,
    expectedNet,
    payslipGross,
    payslipNet,
    actualDeposit,
    expectedVsPayslipGross,
    payslipNetVsActual,
    expectedNetVsActual,
    items,
    notices,
  };
}

/**
 * 같은 (workplaceId, yearMonth) 에 명세서가 여러 개일 수 있다(모델이 다중 허용). 비교는
 * 임의 merge 하지 않고 "가장 최근에 사용자가 확인한 명세서 1건"을 사용한다(정책).
 * 확인(reviewedByUser)된 것 우선, 그다음 updatedAt 최신순. 없으면 그달의 최신 1건.
 */
export function selectPayslipForMonth(
  payslips: PayslipRecord[],
  workplaceId: string,
  yearMonth: string
): PayslipRecord | null {
  const candidates = payslips.filter((p) => p.workplaceId === workplaceId && p.yearMonth === yearMonth);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.reviewedByUser !== b.reviewedByUser) return a.reviewedByUser ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return sorted[0];
}
