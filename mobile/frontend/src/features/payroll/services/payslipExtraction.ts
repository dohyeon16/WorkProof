// 급여명세서 구조화 결과 parser/validator (순수 모듈 — RN/네트워크 의존 없음, node:test 대상).
//
// 책임(Phase 4C-3): backend `/ai/extract-payslip` 이 돌려준 "모델 원문 JSON 문자열"을
// 앱 모델(PayslipAmounts)로 안전하게 변환한다. AI 응답을 그대로 신뢰/저장하지 않고
// 반드시 이 parser 를 통과시킨다 — 코드펜스/malformed/unknown 필드/쉼표/음수/합계 불일치를
// 모두 방어한다. 확정은 사용자가 확인 화면에서 한다(이 모듈은 값을 자동 확정하지 않는다).
import type { PayslipAmounts } from '../../../core/domain/models/types';

export type PayslipField = keyof PayslipAmounts;

// UI 그룹/표시 순서와 parser 화이트리스트를 한 곳에서 관리한다.
export const PAYSLIP_EARNING_FIELDS = [
  'basePay',
  'weeklyAllowance',
  'overtimePay',
  'nightPay',
  'holidayPay',
  'otherAllowance',
  'grossPay',
] as const satisfies readonly PayslipField[];

export const PAYSLIP_DEDUCTION_FIELDS = [
  'incomeTax',
  'localIncomeTax',
  'nationalPension',
  'healthInsurance',
  'longTermCareInsurance',
  'employmentInsurance',
  'otherDeduction',
  'totalDeduction',
] as const satisfies readonly PayslipField[];

export const PAYSLIP_RESULT_FIELDS = ['netPay'] as const satisfies readonly PayslipField[];

export const PAYSLIP_ALL_FIELDS: readonly PayslipField[] = [
  ...PAYSLIP_EARNING_FIELDS,
  ...PAYSLIP_DEDUCTION_FIELDS,
  ...PAYSLIP_RESULT_FIELDS,
];

const KNOWN_FIELD_SET = new Set<string>(PAYSLIP_ALL_FIELDS);

export const PAYSLIP_FIELD_LABELS: Record<PayslipField, string> = {
  basePay: '기본급',
  weeklyAllowance: '주휴수당',
  overtimePay: '연장근로수당',
  nightPay: '야간근로수당',
  holidayPay: '휴일근로수당',
  otherAllowance: '기타 수당',
  grossPay: '지급 총액',
  incomeTax: '소득세',
  localIncomeTax: '지방소득세',
  nationalPension: '국민연금',
  healthInsurance: '건강보험',
  longTermCareInsurance: '장기요양보험',
  employmentInsurance: '고용보험',
  otherDeduction: '기타 공제',
  totalDeduction: '공제 총액',
  netPay: '실지급액',
};

/** 모든 필드가 null(미상)인 빈 급여명세서 금액. */
export function emptyPayslipAmounts(): PayslipAmounts {
  const out = {} as PayslipAmounts;
  for (const f of PAYSLIP_ALL_FIELDS) out[f] = null;
  return out;
}

export type PayslipWarningCode =
  | 'unknown_fields'
  | 'negative_value'
  | 'non_numeric'
  | 'gross_mismatch'
  | 'deduction_mismatch'
  | 'net_mismatch';

export interface PayslipWarning {
  code: PayslipWarningCode;
  message: string;
  fields?: PayslipField[];
}

export type PayslipParseResult =
  | {
      status: 'ok';
      amounts: PayslipAmounts;
      warnings: PayslipWarning[];
      unknownKeys: string[];
    }
  | { status: 'unparseable'; reason: 'empty' | 'not_json' | 'not_object' };

/** 코드펜스(```json ... ```)를 벗겨낸다. 모델이 JSON 앞뒤에 펜스를 붙여도 파싱되게 한다. */
export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return (fence ? fence[1] : trimmed).trim();
}

type AmountIssue = 'negative' | 'non_numeric';

/**
 * 한 금액 값을 정수(원) 또는 null 로 정규화한다.
 *  - number: 유한하지 않으면 non_numeric→null, 음수면 negative→null, 그 외 정수로 반올림
 *  - string: 앞뒤공백/쉼표/₩/원/₩기호/'+' 제거, ''·'-'·정규화 후 빈 값 → null(미상),
 *    숫자만 남으면 정수, 그 외 문자가 섞이면 non_numeric→null
 *  - null/undefined → null(미상). 그 외 타입 → non_numeric→null
 * 반환: value(정규화값) + issue(문제 유형, 있으면). null 은 '미상'이라 0 과 구분된다.
 */
export function normalizeAmount(input: unknown): { value: number | null; issue?: AmountIssue } {
  if (input === null || input === undefined) return { value: null };

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { value: null, issue: 'non_numeric' };
    if (input < 0) return { value: null, issue: 'negative' };
    return { value: Math.round(input) };
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '' || trimmed === '-') return { value: null };
    // 통화기호/쉼표/공백/양수부호 제거. 소수점은 남겨 정수 여부를 판별한다.
    const cleaned = trimmed.replace(/[,\s₩원￦+]/g, '');
    if (cleaned === '') return { value: null };
    if (/^-/.test(cleaned)) {
      // 음수(예: "-1,000" 또는 "△1000"는 위에서 못 잡지만 '-'는 여기서)
      const n = Number(cleaned);
      if (Number.isFinite(n) && n < 0) return { value: null, issue: 'negative' };
      return { value: null, issue: 'non_numeric' };
    }
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return { value: null, issue: 'non_numeric' };
    return { value: Math.round(Number(cleaned)) };
  }

  return { value: null, issue: 'non_numeric' };
}

/** null 을 제외하고 합산. 하나도 없으면 null. */
function sumPresent(amounts: PayslipAmounts, fields: readonly PayslipField[]): number | null {
  let sum = 0;
  let any = false;
  for (const f of fields) {
    const v = amounts[f];
    if (v !== null) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

/** 모든 필드가 채워졌을 때만 합계를 돌려준다(부분 데이터로 오탐 경고를 내지 않기 위함). */
function sumIfAllPresent(amounts: PayslipAmounts, fields: readonly PayslipField[]): number | null {
  let sum = 0;
  for (const f of fields) {
    const v = amounts[f];
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

const EARNING_COMPONENTS = PAYSLIP_EARNING_FIELDS.filter((f) => f !== 'grossPay');
const DEDUCTION_COMPONENTS = PAYSLIP_DEDUCTION_FIELDS.filter((f) => f !== 'totalDeduction');

/**
 * 합계 정합성 검사 — 경고만 만들고 값은 절대 자동 수정하지 않는다.
 *  - gross_mismatch: 지급 세부항목이 모두 있고 합이 grossPay 와 다름
 *  - deduction_mismatch: 공제 세부항목이 모두 있고 합이 totalDeduction 과 다름
 *  - net_mismatch: grossPay - totalDeduction 이 netPay 와 다름(세 값 모두 있을 때)
 */
export function reconcileTotals(amounts: PayslipAmounts): PayslipWarning[] {
  const warnings: PayslipWarning[] = [];

  const earnSum = sumIfAllPresent(amounts, EARNING_COMPONENTS);
  if (earnSum !== null && amounts.grossPay !== null && earnSum !== amounts.grossPay) {
    warnings.push({
      code: 'gross_mismatch',
      message: '지급 항목 합계가 지급 총액과 달라요. 값을 확인해주세요.',
      fields: ['grossPay'],
    });
  }

  const dedSum = sumIfAllPresent(amounts, DEDUCTION_COMPONENTS);
  if (dedSum !== null && amounts.totalDeduction !== null && dedSum !== amounts.totalDeduction) {
    warnings.push({
      code: 'deduction_mismatch',
      message: '공제 항목 합계가 공제 총액과 달라요. 값을 확인해주세요.',
      fields: ['totalDeduction'],
    });
  }

  if (amounts.grossPay !== null && amounts.totalDeduction !== null && amounts.netPay !== null) {
    if (amounts.grossPay - amounts.totalDeduction !== amounts.netPay) {
      warnings.push({
        code: 'net_mismatch',
        message: '지급 총액 - 공제 총액이 실지급액과 달라요. 값을 확인해주세요.',
        fields: ['netPay'],
      });
    }
  }

  return warnings;
}

/**
 * backend 가 돌려준 모델 원문(JSON 문자열)을 PayslipAmounts 로 파싱·정규화한다.
 * 파싱 불가(빈 값/JSON 아님/객체 아님)면 unparseable 을 돌려줘 호출부가 수동 입력으로
 * 유도하게 한다(OCR 텍스트는 상위에서 보존). 알 수 없는 키는 버리고, 값은 정규화한다.
 */
export function parsePayslipRaw(raw: string): PayslipParseResult {
  const body = stripCodeFence(raw);
  if (!body) return { status: 'unparseable', reason: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { status: 'unparseable', reason: 'not_json' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'unparseable', reason: 'not_object' };
  }

  const amounts = emptyPayslipAmounts();
  const unknownKeys: string[] = [];
  const negativeFields: PayslipField[] = [];
  const nonNumericFields: PayslipField[] = [];

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KNOWN_FIELD_SET.has(key)) {
      unknownKeys.push(key);
      continue;
    }
    const field = key as PayslipField;
    const { value: normalized, issue } = normalizeAmount(value);
    amounts[field] = normalized;
    if (issue === 'negative') negativeFields.push(field);
    else if (issue === 'non_numeric') nonNumericFields.push(field);
  }

  const warnings: PayslipWarning[] = [];
  if (unknownKeys.length > 0) {
    warnings.push({
      code: 'unknown_fields',
      message: '명세서에 없는 항목은 제외했어요.',
    });
  }
  if (negativeFields.length > 0) {
    warnings.push({
      code: 'negative_value',
      message: '음수로 인식된 항목은 비워뒀어요. 직접 확인해주세요.',
      fields: negativeFields,
    });
  }
  if (nonNumericFields.length > 0) {
    warnings.push({
      code: 'non_numeric',
      message: '숫자로 읽지 못한 항목은 비워뒀어요. 직접 입력해주세요.',
      fields: nonNumericFields,
    });
  }
  warnings.push(...reconcileTotals(amounts));

  return { status: 'ok', amounts, warnings, unknownKeys };
}

/** 미상(null) 제외 지급 합계(표시용). */
export function presentGrossFromComponents(amounts: PayslipAmounts): number | null {
  return sumPresent(amounts, EARNING_COMPONENTS);
}

/** 미상(null) 제외 공제 합계(표시용). */
export function presentDeductionFromComponents(amounts: PayslipAmounts): number | null {
  return sumPresent(amounts, DEDUCTION_COMPONENTS);
}
