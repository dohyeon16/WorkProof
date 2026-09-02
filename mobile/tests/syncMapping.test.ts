// 모바일 ↔ 백엔드 wire 매핑 검증(순수). 필드 매핑·좌표 짝·DATE/HH:mm 보존·지문 변화·
// 서버 응답의 필드 단위 병합(로컬 전용 필드 보존)·서버 전용 기본값.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyServerAttendance,
  applyServerSchedule,
  applyServerWorkplace,
  attendanceCreateBody,
  attendanceFingerprint,
  scheduleCreateBody,
  workplaceCreateBody,
  workplaceFingerprint,
  workplaceManagedBody,
  type WireAttendance,
  type WireSchedule,
  type WireWorkplace,
} from '../src/features/sync/mappers';
import { makeAttendance, makeSchedule, makeWorkplace } from './support/syncHarness';

test('workplace: 로컬 id → client_id, 서버 관리 필드(기본+정책) 매핑', () => {
  const w = makeWorkplace('wp-1', {
    hourlyWage: 12000,
    address: '서울',
    latitude: 37.5,
    longitude: 127.0,
    payDay: 25,
    weeklyAllowance: false,
    fiveOrMoreEmployees: true,
    incomeDeductionType: 'withholding',
    breakMinutesPerShift: 60,
    contractPhotoUri: 'file:///c.jpg', // 기기 로컬 — 전송 안 함
  });
  const body = workplaceCreateBody(w) as Record<string, unknown>;
  assert.equal(body.client_id, 'wp-1');
  assert.equal(body.name, w.name);
  assert.equal(body.hourly_wage, 12000);
  assert.equal(body.address, '서울');
  assert.equal(body.latitude, 37.5);
  assert.equal(body.longitude, 127.0);
  // 급여 정책(Phase 3C) — snake_case 로 전송.
  assert.equal(body.pay_day, 25);
  assert.equal(body.weekly_allowance, false);
  assert.equal(body.five_or_more_employees, true);
  assert.equal(body.income_deduction_type, 'withholding');
  assert.equal(body.break_minutes_per_shift, 60);
  // 계약서 등 기기 로컬 필드는 전송하지 않는다(camel/snake 모두 부재).
  assert.equal('contractPhotoUri' in body, false);
  assert.equal('contract_photo_uri' in body, false);
});

test('workplace: 구버전 optional 정책 필드는 기본값으로 전송(five/income 미설정)', () => {
  const w = makeWorkplace('wp-1');
  delete (w as { fiveOrMoreEmployees?: boolean }).fiveOrMoreEmployees;
  delete (w as { incomeDeductionType?: string }).incomeDeductionType;
  const body = workplaceManagedBody(w);
  assert.equal(body.five_or_more_employees, false);
  assert.equal(body.income_deduction_type, 'none');
});

test('지문: 정책 필드가 바뀌면 지문이 달라져 update 가 나간다(3C backfill)', () => {
  const base = makeWorkplace('wp-1');
  const fp0 = workplaceFingerprint(base);
  assert.notEqual(workplaceFingerprint({ ...base, payDay: base.payDay + 1 }), fp0);
  assert.notEqual(workplaceFingerprint({ ...base, incomeDeductionType: 'insurance' }), fp0);
  assert.notEqual(workplaceFingerprint({ ...base, weeklyAllowance: !base.weeklyAllowance }), fp0);
});

test('좌표는 항상 짝 — 한쪽만 있으면 둘 다 null 로 보낸다', () => {
  const onlyLat = workplaceManagedBody(makeWorkplace('wp', { latitude: 37.5, longitude: undefined }));
  assert.equal(onlyLat.latitude, null);
  assert.equal(onlyLat.longitude, null);
  const none = workplaceManagedBody(makeWorkplace('wp', { latitude: undefined, longitude: undefined }));
  assert.equal(none.latitude, null);
  assert.equal(none.longitude, null);
});

test('schedule: DATE(YYYY-MM-DD)·HH:mm 보존, endTime 없으면 null', () => {
  const body = scheduleCreateBody(makeSchedule('s1', 'wp-1', { endTime: undefined }), 'srv-wp') as Record<string, unknown>;
  assert.equal(body.workplace_id, 'srv-wp');
  assert.equal(body.work_date, '2026-08-10');
  assert.equal(body.start_time, '09:00');
  assert.equal(body.end_time, null);
  assert.equal(body.reminder_minutes, 30);
});

test('attendance: 시간·휴게·좌표 짝·note 매핑', () => {
  const a = makeAttendance('a1', 'wp-1', {
    clockIn: '09:00',
    clockOut: '18:00',
    note: '메모',
    isHoliday: true,
    clockInLatitude: 37.5,
    clockInLongitude: 127.0,
  });
  const body = attendanceCreateBody(a, 'srv-wp') as Record<string, unknown>;
  assert.equal(body.clock_in, '09:00');
  assert.equal(body.clock_out, '18:00');
  assert.equal(body.break_minutes, 30);
  assert.equal(body.note, '메모');
  assert.equal(body.is_holiday, true);
  assert.equal(body.clock_in_latitude, 37.5);
  assert.equal(body.clock_in_longitude, 127.0);
  // 퇴근 좌표 없음 → 둘 다 null.
  assert.equal(body.clock_out_latitude, null);
  assert.equal(body.clock_out_longitude, null);
});

test('지문: 서버 관리 필드가 바뀌면 변하고, 계약서 등 기기 로컬 필드는 영향 없음', () => {
  const base = makeWorkplace('wp', { hourlyWage: 10000, payDay: 25 });
  const fp0 = workplaceFingerprint(base);
  // 계약서/OCR 등 기기 로컬 필드만 변경 → 지문 동일(불필요한 update 방지).
  assert.equal(
    workplaceFingerprint({ ...base, contractPhotoUri: 'file:///x.jpg', contractSummary: 's' }),
    fp0
  );
  // 서버 관리 필드 변경(시급) → 지문 변화.
  assert.notEqual(workplaceFingerprint({ ...base, hourlyWage: 11000 }), fp0);
});

test('applyServerWorkplace: 계약서 등 기기 로컬 필드는 유지, 서버 관리 필드(정책 포함)는 갱신', () => {
  const local = makeWorkplace('wp-1', {
    hourlyWage: 10000,
    payDay: 15,
    weeklyAllowance: true,
    breakMinutesPerShift: 60,
    contractPhotoUri: 'file:///contract.jpg',
    contractSummary: '요약',
  });
  const wire: WireWorkplace = {
    id: 'srv-1',
    client_id: 'wp-1',
    name: '새 이름',
    hourly_wage: 13000,
    address: '부산',
    latitude: null,
    longitude: null,
    pay_day: 5,
    weekly_allowance: false,
    five_or_more_employees: true,
    income_deduction_type: 'withholding',
    break_minutes_per_shift: 0,
    created_at: 'c',
    updated_at: 'u',
  };
  const merged = applyServerWorkplace(local, wire);
  assert.equal(merged.name, '새 이름');
  assert.equal(merged.hourlyWage, 13000);
  assert.equal(merged.address, '부산');
  // 정책 필드는 이제 서버 관리 — 서버 값으로 갱신된다.
  assert.equal(merged.payDay, 5);
  assert.equal(merged.weeklyAllowance, false);
  assert.equal(merged.fiveOrMoreEmployees, true);
  assert.equal(merged.incomeDeductionType, 'withholding');
  assert.equal(merged.breakMinutesPerShift, 0);
  // 계약서 등 기기 로컬 필드는 보존(서버로 오가지 않음).
  assert.equal(merged.contractPhotoUri, 'file:///contract.jpg');
  assert.equal(merged.contractSummary, '요약');
});

test('applyServerWorkplace: 서버 전용(로컬 없음) → 정책 필드도 서버 값으로 복원', () => {
  const wire: WireWorkplace = {
    id: 'srv-9',
    client_id: 'wp-remote',
    name: '원격 근무지',
    hourly_wage: 9860,
    address: null,
    latitude: null,
    longitude: null,
    pay_day: 20,
    weekly_allowance: false,
    five_or_more_employees: true,
    income_deduction_type: 'insurance',
    break_minutes_per_shift: 30,
    created_at: 'c',
    updated_at: 'u',
  };
  const added = applyServerWorkplace(undefined, wire);
  assert.equal(added.id, 'wp-remote'); // client_id 를 로컬 id 로
  assert.equal(added.hourlyWage, 9860);
  // 정책 필드가 서버 값으로 복원(더 이상 하드코딩 기본값 아님).
  assert.equal(added.payDay, 20);
  assert.equal(added.weeklyAllowance, false);
  assert.equal(added.fiveOrMoreEmployees, true);
  assert.equal(added.incomeDeductionType, 'insurance');
  assert.equal(added.breakMinutesPerShift, 30);
});

test('applyServerSchedule: 기존 로컬은 workplaceId(로컬 참조) 유지', () => {
  const local = makeSchedule('s1', 'wp-local');
  const wire: WireSchedule = {
    id: 'srv-s1',
    client_id: 's1',
    workplace_id: 'srv-wp',
    work_date: '2026-09-01',
    start_time: '10:00',
    end_time: null,
    reminder_minutes: 0,
    created_at: 'c',
    updated_at: 'u',
  };
  const merged = applyServerSchedule(local, wire, () => 'IGNORED');
  assert.equal(merged?.workplaceId, 'wp-local'); // 로컬 참조 유지
  assert.equal(merged?.date, '2026-09-01');
  assert.equal(merged?.endTime, undefined);
});

test('applyServerSchedule: 서버 전용인데 근무지 매핑 불가 → null(배치 보류)', () => {
  const wire: WireSchedule = {
    id: 'srv-s2',
    client_id: 's2',
    workplace_id: 'srv-unknown',
    work_date: '2026-09-01',
    start_time: '10:00',
    end_time: null,
    reminder_minutes: 0,
    created_at: 'c',
    updated_at: 'u',
  };
  assert.equal(applyServerSchedule(undefined, wire, () => undefined), null);
});

test('applyServerAttendance: 서버 clock_out=null 이면 기존 로컬값 유지', () => {
  const local = makeAttendance('a1', 'wp-1', { clockOut: '18:00' });
  const wire: WireAttendance = {
    id: 'srv-a1',
    client_id: 'a1',
    workplace_id: 'srv-wp',
    work_date: '2026-08-10',
    clock_in: '09:00',
    clock_out: null,
    break_minutes: 30,
    note: null,
    is_holiday: false,
    clock_in_latitude: null,
    clock_in_longitude: null,
    clock_out_latitude: null,
    clock_out_longitude: null,
    created_at: 'c',
    updated_at: 'u',
  };
  const merged = applyServerAttendance(local, wire, () => 'wp-1');
  assert.equal(merged?.clockOut, '18:00'); // 로컬 필수값 보존
  assert.equal(attendanceFingerprint(local).length > 0, true);
});
