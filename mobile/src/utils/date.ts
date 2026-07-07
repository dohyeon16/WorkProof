export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function shiftYearMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-');
  return `${y}년 ${Number(m)}월`;
}

/** 숫자만 입력해도 "0900" -> "09:00" 처럼 자동으로 HH:mm 형태로 변환 */
export function formatTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  let hour = digits.slice(0, 2);
  let minute = digits.slice(2);
  if (Number(hour) > 23) hour = '23';
  if (minute.length === 2 && Number(minute) > 59) minute = '59';
  return `${hour}:${minute}`;
}

export function currentTimeString(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDateWithWeekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const [, m, day] = dateStr.split('-');
  return `${Number(m)}.${Number(day)}(${WEEKDAY_KO[d.getDay()]})`;
}

/** 오늘 이후 가장 가까운 급여일까지 남은 일수와 날짜 문자열(YYYY-MM-DD) */
export function nextPayDate(payDay: number): { date: string; daysUntil: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const candidate = new Date(today.getFullYear(), today.getMonth(), payDay);
  if (candidate < today) {
    candidate.setMonth(candidate.getMonth() + 1);
  }
  const daysUntil = Math.round((candidate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const dateStr = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(candidate.getDate()).padStart(2, '0')}`;
  return { date: dateStr, daysUntil };
}
