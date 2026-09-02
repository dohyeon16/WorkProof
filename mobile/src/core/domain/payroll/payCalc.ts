import { AttendanceRecord, IncomeDeductionType, Workplace } from '../models/types';

/**
 * 공제 유형별 근로자 부담 공제율(간이 추정, 법적 자문 아님).
 *  - none: 0%
 *  - withholding: 사업소득 원천징수 3.3%(소득세 3% + 지방소득세 0.3%)
 *  - insurance: 4대보험 근로자 부담분 대략 9.4%(국민연금·건강보험·장기요양·고용보험 합산 근사치)
 * 실제 공제액은 소득 구간·요율 개정에 따라 달라질 수 있어 어디까지나 어림값이다.
 */
export const DEDUCTION_RATES: Record<IncomeDeductionType, number> = {
  none: 0,
  withholding: 0.033,
  insurance: 0.094,
};

/** 세전 금액에서 공제 유형에 해당하는 공제 추정액(원, 반올림). */
export function deductionAmount(gross: number, type: IncomeDeductionType = 'none'): number {
  return Math.round(gross * DEDUCTION_RATES[type]);
}

/** 세전 금액에서 공제를 뺀 세후 실수령 추정액(원). */
export function netPay(gross: number, type: IncomeDeductionType = 'none'): number {
  return gross - deductionAmount(gross, type);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 근로기준법 54조: 4시간 이상 근무해야 휴게시간 부여 의무가 발생. 그 미만은 휴게시간 차감 없음. */
export const BREAK_REQUIRED_MINUTES = 4 * 60;

/** 법정 최저임금(원/시). 2026년 기준 10,320원. 해마다 개정되므로 매년 갱신 필요. */
export const MINIMUM_HOURLY_WAGE = 10320;
export const MINIMUM_WAGE_YEAR = 2026;

/** 법정 근로시간: 1일 8시간을 넘는 근무는 연장근로. */
export const DAILY_REGULAR_MINUTES = 8 * 60;
/** 법정 근로시간: 1주 40시간을 넘는 근무는 연장근로. */
export const WEEKLY_REGULAR_MINUTES = 40 * 60;
/** 연장근로 가산율(근로기준법 56조: 통상임금의 50% 가산). 기본 시급은 이미 기본급에 포함되므로 가산분만 별도 계산한다. */
export const OVERTIME_PREMIUM_RATE = 0.5;
/** 야간근로 가산율(근로기준법 56조 3항: 22:00~06:00 근로에 통상임금의 50% 가산). 연장/휴일과 중복 적용 가능. */
export const NIGHT_PREMIUM_RATE = 0.5;
/** 휴일근로 가산율: 8시간 이내 50%. */
export const HOLIDAY_PREMIUM_RATE = 0.5;
/** 휴일근로 가산율: 8시간 초과분 100%. */
export const HOLIDAY_OVERTIME_PREMIUM_RATE = 1.0;
/** 야간 시간대 시작(분, 22:00). */
const NIGHT_START_MIN = 22 * 60;
/** 야간 시간대 종료(분, 다음날 06:00 = 30:00). */
const NIGHT_END_MIN = 30 * 60;

/**
 * 근무 1건 중 야간(22:00~06:00)에 걸치는 분. 익일 퇴근·이른 새벽 근무를 모두 커버하도록
 * 전날/당일/다음날 세 개의 야간 창과 겹치는 구간을 합산한다. 실제 근무 분(휴게 차감 후)을
 * 넘지 않도록 호출부에서 cap 한다.
 */
export function nightOverlapMinutes(clockIn: string, clockOut: string): number {
  if (!clockOut) return 0;
  const start = toMinutes(clockIn);
  let end = toMinutes(clockOut);
  if (end <= start) end += 24 * 60; // 익일 퇴근
  let total = 0;
  for (let d = -1; d <= 1; d++) {
    const ns = d * 24 * 60 + NIGHT_START_MIN;
    const ne = d * 24 * 60 + NIGHT_END_MIN;
    total += Math.max(0, Math.min(end, ne) - Math.max(start, ns));
  }
  return total;
}

/** 근무 1건의 실제 야간 근무 분(휴게 차감 후 실근무를 넘지 않게 cap). */
export function shiftNightMinutes(record: AttendanceRecord): number {
  if (!record.clockOut) return 0;
  return Math.min(nightOverlapMinutes(record.clockIn, record.clockOut), shiftWorkedMinutes(record));
}

/** 출퇴근 시각(HH:mm) 사이의 근무 분. 퇴근시간이 출근시간보다 이르면 익일 퇴근으로 간주. */
export function shiftDurationMinutes(clockIn: string, clockOut: string): number {
  const inM = toMinutes(clockIn);
  let outM = toMinutes(clockOut);
  if (outM < inM) outM += 24 * 60;
  return outM - inM;
}

function rawShiftDuration(record: AttendanceRecord): number {
  return shiftDurationMinutes(record.clockIn, record.clockOut);
}

/** 실제로 차감되는 휴게시간(분). 4시간 미만 근무는 차감 없음 — shiftWorkedMinutes와 화면/리포트 표기를 일치시키는 데 사용. */
export function appliedBreakMinutes(record: AttendanceRecord): number {
  if (!record.clockOut) return 0;
  const rawDuration = rawShiftDuration(record);
  return rawDuration >= BREAK_REQUIRED_MINUTES ? record.breakMinutes || 0 : 0;
}

/** 근무 1건의 실 근무 분(휴게시간 차감 후). 퇴근시간이 출근시간보다 이르면 익일 퇴근으로 간주. */
export function shiftWorkedMinutes(record: AttendanceRecord): number {
  if (!record.clockOut) return 0; // 아직 퇴근 전(진행 중인 근무)
  const rawDuration = rawShiftDuration(record);
  return Math.max(rawDuration - appliedBreakMinutes(record), 0);
}

/** 날짜(YYYY-MM-DD)가 속한 주의 월요일 기준 키(YYYY-MM-DD) */
function weekKeyOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay(); // 0=Sun
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

export interface DailyBreakdown {
  date: string;
  workedMinutes: number;
}

export interface MonthlySummary {
  yearMonth: string;
  dailyBreakdown: DailyBreakdown[];
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  weeklyAllowanceMinutes: number; // 주휴수당에 해당하는 '유급 처리 분'
  overtimeMinutes: number; // 연장근로에 해당하는 분(일 8시간·주 40시간 초과분)
  nightMinutes: number; // 야간(22:00~06:00) 근로 분
  holidayMinutes: number; // 휴일근로 분(휴일로 표시한 근무의 실근무 합)
  basePay: number;
  weeklyAllowancePay: number;
  overtimePay: number; // 연장근로 가산수당(가산분 50%만, 기본급은 basePay에 포함)
  nightPay: number; // 야간근로 가산수당(가산분 50%만)
  holidayPay: number; // 휴일근로 가산수당(8시간 이내 50%·초과 100% 가산분만)
  expectedPay: number; // 세전 예상 급여
  deductionType: IncomeDeductionType; // 적용된 공제 유형
  deductionPay: number; // 예상 공제액(세전 기준 추정)
  netExpectedPay: number; // 세후 예상 실수령액(expectedPay - deductionPay)
}

/**
 * 연장근로 분 계산(5인 이상 사업장 가산 대상). 일 8시간 초과분과, 8시간 이내 근무 중
 * 주 40시간을 넘는 분을 합산한다(일·주 초과분 중복 계산 방지).
 * 주휴수당과 동일하게, 이번 달 근무일이 포함된 주 전체를 기준으로 판정한다.
 */
function calcOvertimeMinutes(records: AttendanceRecord[], monthWeekKeys: Set<string>): number {
  // 날짜별 실근무분(하루 여러 건이면 합산). 주 경계가 월을 넘길 수 있어 전체 기록을 대상으로 한다.
  const dayTotals = new Map<string, number>();
  for (const r of records) {
    dayTotals.set(r.date, (dayTotals.get(r.date) ?? 0) + shiftWorkedMinutes(r));
  }
  const weekDates = new Map<string, string[]>();
  for (const date of dayTotals.keys()) {
    const wk = weekKeyOf(date);
    const list = weekDates.get(wk);
    if (list) list.push(date);
    else weekDates.set(wk, [date]);
  }

  let overtimeMinutes = 0;
  for (const wk of monthWeekKeys) {
    let weekDailyOvertime = 0;
    let weekRegular = 0; // 일 8시간 이내로 잡힌 분의 합
    for (const date of weekDates.get(wk) ?? []) {
      const worked = dayTotals.get(date) ?? 0;
      const dailyOvertime = Math.max(0, worked - DAILY_REGULAR_MINUTES);
      weekDailyOvertime += dailyOvertime;
      weekRegular += worked - dailyOvertime;
    }
    const weekOvertime = Math.max(0, weekRegular - WEEKLY_REGULAR_MINUTES);
    overtimeMinutes += weekDailyOvertime + weekOvertime;
  }
  return overtimeMinutes;
}

/**
 * 간이 계산 기준(법적 자문 아님):
 * - 기본급 = 실 근무시간 합계 × 시급
 * - 주휴수당 = 주 소정근로시간이 15시간 이상인 주에 한해,
 *   (주 근무시간 ÷ 40, 최대 1) × 8시간 × 시급 을 해당 주에 가산
 * - 월 합산 시, 근무 기록이 속한 주(월~일) 중 해당 월에 근무일이 있는 주를 모두 포함
 */
export function calcMonthlySummary(
  records: AttendanceRecord[],
  workplace: Workplace,
  yearMonth: string
): MonthlySummary {
  const monthRecords = records.filter((r) => r.date.startsWith(yearMonth));

  const dailyBreakdown: DailyBreakdown[] = monthRecords
    .map((r) => ({ date: r.date, workedMinutes: shiftWorkedMinutes(r) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalWorkedMinutes = dailyBreakdown.reduce((sum, d) => sum + d.workedMinutes, 0);
  const totalBreakMinutes = monthRecords.reduce((sum, r) => sum + appliedBreakMinutes(r), 0);

  // 월에 걸친 주 단위로 그룹핑 (해당 월 기록이 속한 주 전체 근무시간 기준으로 15시간 요건 판정)
  const weekTotals = new Map<string, number>();
  for (const r of records) {
    const wk = weekKeyOf(r.date);
    weekTotals.set(wk, (weekTotals.get(wk) || 0) + shiftWorkedMinutes(r));
  }

  let weeklyAllowanceMinutes = 0;
  if (workplace.weeklyAllowance) {
    const countedWeeks = new Set<string>();
    for (const d of dailyBreakdown) {
      const wk = weekKeyOf(d.date);
      if (countedWeeks.has(wk)) continue;
      countedWeeks.add(wk);
      const weekMinutes = weekTotals.get(wk) || 0;
      const weekHours = weekMinutes / 60;
      if (weekHours >= 15) {
        const ratio = Math.min(weekMinutes / (40 * 60), 1);
        weeklyAllowanceMinutes += ratio * 8 * 60;
      }
    }
  }

  // 야간·휴일·연장 가산은 모두 상시근로자 5인 이상 사업장에만 적용된다(근로기준법 11조·56조).
  const applyPremium = !!workplace.fiveOrMoreEmployees;
  const wage = workplace.hourlyWage;

  // 연장근로 분. 휴일근로는 아래에서 별도 가산하므로 연장 계산에서 제외해 중복 가산을 막는다.
  const monthWeekKeys = new Set(dailyBreakdown.map((d) => weekKeyOf(d.date)));
  const overtimeMinutes = applyPremium
    ? calcOvertimeMinutes(records.filter((r) => !r.isHoliday), monthWeekKeys)
    : 0;

  // 야간(22:00~06:00) 근로 분 — 이번 달 기록 기준.
  const nightMinutes = applyPremium
    ? monthRecords.reduce((sum, r) => sum + shiftNightMinutes(r), 0)
    : 0;

  // 휴일근로 가산 — 휴일로 표시한 날의 실근무를 일 단위로 모아, 8시간 이내 50%·초과 100%로 계산.
  let holidayMinutes = 0;
  let holidayPayRaw = 0;
  if (applyPremium) {
    const holidayDayTotals = new Map<string, number>();
    for (const r of monthRecords) {
      if (!r.isHoliday) continue;
      holidayDayTotals.set(r.date, (holidayDayTotals.get(r.date) ?? 0) + shiftWorkedMinutes(r));
    }
    for (const worked of holidayDayTotals.values()) {
      holidayMinutes += worked;
      const within = Math.min(DAILY_REGULAR_MINUTES, worked);
      const beyond = Math.max(0, worked - DAILY_REGULAR_MINUTES);
      holidayPayRaw +=
        (within / 60) * wage * HOLIDAY_PREMIUM_RATE + (beyond / 60) * wage * HOLIDAY_OVERTIME_PREMIUM_RATE;
    }
  }

  const basePay = Math.round((totalWorkedMinutes / 60) * wage);
  const weeklyAllowancePay = Math.round((weeklyAllowanceMinutes / 60) * wage);
  const overtimePay = Math.round((overtimeMinutes / 60) * wage * OVERTIME_PREMIUM_RATE);
  const nightPay = Math.round((nightMinutes / 60) * wage * NIGHT_PREMIUM_RATE);
  const holidayPay = Math.round(holidayPayRaw);
  const expectedPay = basePay + weeklyAllowancePay + overtimePay + nightPay + holidayPay;

  const deductionType: IncomeDeductionType = workplace.incomeDeductionType ?? 'none';
  const deductionPay = deductionAmount(expectedPay, deductionType);
  const netExpectedPay = expectedPay - deductionPay;

  return {
    yearMonth,
    dailyBreakdown,
    totalWorkedMinutes,
    totalBreakMinutes,
    weeklyAllowanceMinutes,
    overtimeMinutes,
    nightMinutes,
    holidayMinutes,
    basePay,
    weeklyAllowancePay,
    overtimePay,
    nightPay,
    holidayPay,
    expectedPay,
    deductionType,
    deductionPay,
    netExpectedPay,
  };
}

export function calcDiff(expectedPay: number, actualPay: number): number {
  return actualPay - expectedPay;
}

export function formatMinutesAsHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/**
 * 근무 1건의 실 근무시간을 "8시간 30분"까지 표기한다. 최근 근무 기록과 달력 상세
 * 카드가 공통으로 쓰는 포맷 함수. NaN/음수는 0분으로 방어한다.
 * - 510분 → "8시간 30분"
 * - 480분 → "8시간"
 * - 25분  → "25분"
 * - 0분   → "0시간"
 */
export function formatWorkDuration(totalMinutes: number): string {
  const safe = Number.isFinite(totalMinutes) && totalMinutes > 0 ? Math.round(totalMinutes) : 0;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (m === 0) return `${h}시간`;
  if (h === 0) return `${m}분`;
  return `${h}시간 ${m}분`;
}

export function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}
