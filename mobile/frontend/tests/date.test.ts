// 로컬 날짜 처리 검증(node:test). 시스템 timezone에 의존하지 않도록 Date를 로컬
// 구성요소(new Date(y, mIdx, d, h, m))로 주입해 결정적으로 검증한다.
// 실제 기기 timezone 변경 검증은 수행하지 않음(NOT TESTED).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatLocalDate,
  formatLocalYearMonth,
  parseLocalDate,
  todayDateString,
  currentYearMonth,
  shiftYearMonth,
} from '../src/shared/utils/date';

// KST 00:00~08:59 경계: 로컬 시:분이 무엇이든 그날의 로컬 날짜를 그대로 반환해야 한다
// (toISOString(UTC) 구현이면 이 구간에서 전날로 밀린다).
test('formatLocalDate: 00:01/08:59/09:00 모두 같은 로컬 날짜', () => {
  assert.equal(formatLocalDate(new Date(2026, 7, 4, 0, 1)), '2026-08-04');
  assert.equal(formatLocalDate(new Date(2026, 7, 4, 8, 59)), '2026-08-04');
  assert.equal(formatLocalDate(new Date(2026, 7, 4, 9, 0)), '2026-08-04');
  assert.equal(formatLocalDate(new Date(2026, 7, 4, 23, 59)), '2026-08-04');
});

test('formatLocalDate: 연말→연초 경계', () => {
  assert.equal(formatLocalDate(new Date(2026, 11, 31, 23, 30)), '2026-12-31');
  assert.equal(formatLocalDate(new Date(2027, 0, 1, 0, 30)), '2027-01-01');
});

test('formatLocalYearMonth: 월/연 경계', () => {
  assert.equal(formatLocalYearMonth(new Date(2026, 11, 31, 23, 59)), '2026-12');
  assert.equal(formatLocalYearMonth(new Date(2027, 0, 1, 0, 1)), '2027-01');
});

test('윤년 2월 29일', () => {
  assert.equal(formatLocalDate(new Date(2028, 1, 29, 5, 0)), '2028-02-29');
  const d = parseLocalDate('2028-02-29');
  assert.equal(d.getFullYear(), 2028);
  assert.equal(d.getMonth(), 1);
  assert.equal(d.getDate(), 29);
});

test('parseLocalDate: 로컬 자정으로 파싱(UTC 파싱 함정 회피)', () => {
  const d = parseLocalDate('2026-08-04');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7); // 0-based
  assert.equal(d.getDate(), 4);
  assert.equal(d.getHours(), 0);
});

test('round trip: parseLocalDate → formatLocalDate 원형 유지', () => {
  for (const s of ['2026-01-01', '2026-08-04', '2026-12-31', '2028-02-29']) {
    assert.equal(formatLocalDate(parseLocalDate(s)), s);
  }
});

test('todayDateString/currentYearMonth 형식·일관성', () => {
  const today = todayDateString();
  const ym = currentYearMonth();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(ym, /^\d{4}-\d{2}$/);
  // 같은 로컬 시각에서 파생되므로 today는 항상 currentYearMonth로 시작해야 한다
  // (UTC/로컬 혼용이면 경계에서 깨질 수 있다).
  assert.ok(today.startsWith(ym), `${today} should start with ${ym}`);
});

test('YYYY-MM-DD 문자열 사전순 정렬 = 시간순 (근태 정렬/필터 회귀 방지)', () => {
  const dates = ['2026-08-05', '2026-07-31', '2026-08-04', '2025-12-31'];
  const sorted = [...dates].sort();
  assert.deepEqual(sorted, ['2025-12-31', '2026-07-31', '2026-08-04', '2026-08-05']);
  // 월 필터(startsWith)도 형식 불변이라 그대로 동작
  assert.deepEqual(dates.filter((d) => d.startsWith('2026-08')).sort(), ['2026-08-04', '2026-08-05']);
});

test('shiftYearMonth 경계(기존 동작 유지)', () => {
  assert.equal(shiftYearMonth('2026-01', -1), '2025-12');
  assert.equal(shiftYearMonth('2026-12', 1), '2027-01');
});
