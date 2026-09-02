// 급여명세서 parser/validator + 구조화 파이프라인 검증(node:test, RN 의존 없음).
import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../src/core/api/errors';
import { SessionExpiredError } from '../src/features/auth/state/session';
import type { AiRemote } from '../src/core/api/aiProxyApi';
import {
  emptyPayslipAmounts,
  normalizeAmount,
  parsePayslipRaw,
  reconcileTotals,
  stripCodeFence,
  PAYSLIP_ALL_FIELDS,
} from '../src/features/payroll/services/payslipExtraction';
import { structurePayslipText } from '../src/features/payroll/services/payslipStructuring';

// ---------- normalizeAmount ----------
test('normalizeAmount: 정수/0/음수/비유한', () => {
  assert.deepEqual(normalizeAmount(1200000), { value: 1200000 });
  assert.deepEqual(normalizeAmount(0), { value: 0 }); // 0 은 유지(미상 아님)
  assert.deepEqual(normalizeAmount(-5), { value: null, issue: 'negative' });
  assert.deepEqual(normalizeAmount(Infinity), { value: null, issue: 'non_numeric' });
  assert.deepEqual(normalizeAmount(1200.6), { value: 1201 }); // 반올림
});

test('normalizeAmount: 문자열 쉼표/통화기호/공백 제거', () => {
  assert.deepEqual(normalizeAmount('1,200,000'), { value: 1200000 });
  assert.deepEqual(normalizeAmount(' 1200000 원 '), { value: 1200000 });
  assert.deepEqual(normalizeAmount('₩39,600'), { value: 39600 });
});

test('normalizeAmount: 미상 표기(null/""/"-")는 null(0 과 구분)', () => {
  assert.deepEqual(normalizeAmount(null), { value: null });
  assert.deepEqual(normalizeAmount(undefined), { value: null });
  assert.deepEqual(normalizeAmount(''), { value: null });
  assert.deepEqual(normalizeAmount('-'), { value: null });
});

test('normalizeAmount: 음수 문자열/비숫자', () => {
  assert.deepEqual(normalizeAmount('-1,000'), { value: null, issue: 'negative' });
  assert.deepEqual(normalizeAmount('약 삼십만원'), { value: null, issue: 'non_numeric' });
  assert.deepEqual(normalizeAmount({} as unknown), { value: null, issue: 'non_numeric' });
});

// ---------- stripCodeFence ----------
test('stripCodeFence: ```json 펜스 제거', () => {
  assert.equal(stripCodeFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripCodeFence('```\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripCodeFence('{"a":1}'), '{"a":1}');
});

// ---------- parsePayslipRaw ----------
test('parse: 정상 JSON → ok + 값 정규화(쉼표/0/미상 구분)', () => {
  const raw = JSON.stringify({
    basePay: '1,200,000',
    weeklyAllowance: 0,
    overtimePay: null,
    grossPay: 1200000,
    incomeTax: '39,600',
    netPay: 1160400,
  });
  const res = parsePayslipRaw(raw);
  assert.equal(res.status, 'ok');
  if (res.status !== 'ok') return;
  assert.equal(res.amounts.basePay, 1200000);
  assert.equal(res.amounts.weeklyAllowance, 0); // 0 유지
  assert.equal(res.amounts.overtimePay, null); // 미상
  assert.equal(res.amounts.nightPay, null); // 아예 없던 키 → null
  assert.equal(res.amounts.incomeTax, 39600);
});

test('parse: 코드펜스로 감싸진 JSON', () => {
  const res = parsePayslipRaw('```json\n{"basePay": 1000000}\n```');
  assert.equal(res.status, 'ok');
  if (res.status === 'ok') assert.equal(res.amounts.basePay, 1000000);
});

test('parse: malformed JSON → unparseable(not_json)', () => {
  const res = parsePayslipRaw('{basePay: 1000000');
  assert.deepEqual(res, { status: 'unparseable', reason: 'not_json' });
});

test('parse: 배열/원시값 → unparseable(not_object)', () => {
  assert.equal(parsePayslipRaw('[1,2,3]').status, 'unparseable');
  assert.equal(parsePayslipRaw('42').status, 'unparseable');
  assert.equal(parsePayslipRaw('null').status, 'unparseable');
});

test('parse: 빈/공백 → unparseable(empty)', () => {
  assert.deepEqual(parsePayslipRaw('   '), { status: 'unparseable', reason: 'empty' });
  assert.deepEqual(parsePayslipRaw('```json\n\n```'), { status: 'unparseable', reason: 'empty' });
});

test('parse: unknown 필드는 버리고 경고', () => {
  const res = parsePayslipRaw(JSON.stringify({ basePay: 1000, employeeName: '홍길동', ssn: '900101' }));
  assert.equal(res.status, 'ok');
  if (res.status !== 'ok') return;
  assert.deepEqual(res.unknownKeys.sort(), ['employeeName', 'ssn']);
  assert.ok(res.warnings.some((w) => w.code === 'unknown_fields'));
  // 개인정보 키가 amounts 에 섞이지 않는다.
  assert.ok(!('employeeName' in res.amounts));
});

test('parse: 음수/비숫자 값은 null 로 두고 경고', () => {
  const res = parsePayslipRaw(JSON.stringify({ basePay: -100, incomeTax: 'N/A' }));
  assert.equal(res.status, 'ok');
  if (res.status !== 'ok') return;
  assert.equal(res.amounts.basePay, null);
  assert.equal(res.amounts.incomeTax, null);
  assert.ok(res.warnings.some((w) => w.code === 'negative_value'));
  assert.ok(res.warnings.some((w) => w.code === 'non_numeric'));
});

test('parse: 합계 정합(net_mismatch)만 경고, 자동수정 안 함', () => {
  const res = parsePayslipRaw(JSON.stringify({ grossPay: 1000000, totalDeduction: 100000, netPay: 950000 }));
  assert.equal(res.status, 'ok');
  if (res.status !== 'ok') return;
  assert.equal(res.amounts.netPay, 950000); // 값은 그대로(자동수정 없음)
  assert.ok(res.warnings.some((w) => w.code === 'net_mismatch'));
});

test('parse: 합계가 맞으면 mismatch 경고 없음', () => {
  const res = parsePayslipRaw(JSON.stringify({ grossPay: 1000000, totalDeduction: 100000, netPay: 900000 }));
  assert.equal(res.status, 'ok');
  if (res.status !== 'ok') return;
  assert.ok(!res.warnings.some((w) => w.code.endsWith('mismatch')));
});

// ---------- reconcileTotals ----------
test('reconcile: 지급/공제 세부합 불일치 감지(모두 있을 때만)', () => {
  const a = emptyPayslipAmounts();
  a.basePay = 900000;
  a.weeklyAllowance = 100000;
  a.overtimePay = 0;
  a.nightPay = 0;
  a.holidayPay = 0;
  a.otherAllowance = 0;
  a.grossPay = 1_000_001; // 합(1,000,000)과 1원 차이
  const w = reconcileTotals(a);
  assert.ok(w.some((x) => x.code === 'gross_mismatch'));
});

test('reconcile: 부분 데이터면 오탐 없음', () => {
  const a = emptyPayslipAmounts();
  a.basePay = 900000; // 나머지 지급 항목 미상
  a.grossPay = 1000000;
  assert.equal(reconcileTotals(a).length, 0);
});

test('emptyPayslipAmounts: 모든 필드 null', () => {
  const a = emptyPayslipAmounts();
  for (const f of PAYSLIP_ALL_FIELDS) assert.equal(a[f], null);
});

// ---------- structurePayslipText (provider 오류 매핑) ----------
function remote(extractPayslip: (t: string) => Promise<string>): AiRemote {
  return { ocr: async () => '', summarize: async () => '', extractPayslip };
}

test('structure: 성공 → extracted + amounts', async () => {
  const r = remote(async () => JSON.stringify({ basePay: 1000000, netPay: 900000 }));
  const out = await structurePayslipText(r, 'ocr text');
  assert.equal(out.status, 'extracted');
  if (out.status === 'extracted') assert.equal(out.amounts.basePay, 1000000);
});

test('structure: 쿼터 429 → failed EXTRACT_UNAVAILABLE(graceful)', async () => {
  const r = remote(async () => {
    throw new ApiError('http', '요청이 많아요', 429);
  });
  const out = await structurePayslipText(r, 'text');
  assert.deepEqual(out, { status: 'failed', code: 'EXTRACT_UNAVAILABLE' });
});

test('structure: 503 → EXTRACT_NOT_CONFIGURED', async () => {
  const r = remote(async () => {
    throw new ApiError('http', 'x', 503);
  });
  const out = await structurePayslipText(r, 'text');
  assert.equal(out.status === 'failed' && out.code, 'EXTRACT_NOT_CONFIGURED');
});

test('structure: 5xx/네트워크 → EXTRACT_FAILED', async () => {
  const r5 = remote(async () => {
    throw new ApiError('http', 'x', 502);
  });
  assert.equal((await structurePayslipText(r5, 't')).status === 'failed' && (await structurePayslipText(r5, 't')).status, 'failed');
  const rn = remote(async () => {
    throw new ApiError('network', 'x');
  });
  const out = await structurePayslipText(rn, 't');
  assert.equal(out.status === 'failed' && out.code, 'EXTRACT_FAILED');
});

test('structure: malformed 모델 응답 → failed EXTRACT_FAILED(수동 fallback)', async () => {
  const r = remote(async () => 'not json at all');
  const out = await structurePayslipText(r, 'text');
  assert.deepEqual(out, { status: 'failed', code: 'EXTRACT_FAILED' });
});

test('structure: SessionExpiredError 는 전파(상위 로그인 게이트)', async () => {
  const r = remote(async () => {
    throw new SessionExpiredError();
  });
  await assert.rejects(() => structurePayslipText(r, 'text'), (e) => e instanceof SessionExpiredError);
});
