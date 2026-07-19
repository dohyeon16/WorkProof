import { AttendanceRecord, Workplace } from './types';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 근로기준법 54조: 4시간 이상 근무해야 휴게시간 부여 의무가 발생. 그 미만은 휴게시간 차감 없음. */
export const BREAK_REQUIRED_MINUTES = 4 * 60;

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
  basePay: number;
  weeklyAllowancePay: number;
  expectedPay: number;
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

  const basePay = Math.round((totalWorkedMinutes / 60) * workplace.hourlyWage);
  const weeklyAllowancePay = Math.round((weeklyAllowanceMinutes / 60) * workplace.hourlyWage);
  const expectedPay = basePay + weeklyAllowancePay;

  return {
    yearMonth,
    dailyBreakdown,
    totalWorkedMinutes,
    totalBreakMinutes,
    weeklyAllowanceMinutes,
    basePay,
    weeklyAllowancePay,
    expectedPay,
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
