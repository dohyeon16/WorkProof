// Preview 통합 테스트 — 실제 sync 엔진/매퍼/API 저장소 코드를 Preview 백엔드에 대고 돌린다.
// (npm test 글롭(*.test.js)에 포함되지 않는 이름 — 네트워크가 필요해 수동 실행 전용.)
//
// 안전장치:
//  - Preview URL 만 사용. Production URL 이면 즉시 중단.
//  - 토큰/비밀번호/전체 이메일을 출력하지 않는다(마스킹).
//  - 전용 임시 계정으로 진행하고, 끝에 work-data 0 + 계정 삭제로 정리한다.
import assert from 'node:assert/strict';
import { createApiClient } from '../../src/services/api/client';
import { ApiError } from '../../src/services/api/errors';
import type {
  AttendanceRecord,
  ScheduledShift,
  Workplace,
} from '../../src/types/domain';
import { runSync } from '../../src/features/sync/engine';
import { createWorkDataRemote } from '../../src/features/sync/workDataApi';
import { InMemoryPersistence } from './syncHarness';

const PREVIEW = 'https://workproof-backend-preview.onrender.com';
const PRODUCTION = 'https://workproof-auth.onrender.com';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`[preview] ${msg}`);
const mask = (email: string) => email.replace(/^(.{4}).*(@.*)$/, '$1***$2');

interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string | null; name: string };
}

async function warmup(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    for (const path of ['/api/v1/health', '/health']) {
      try {
        const r = await fetch(`${PREVIEW}${path}`, { signal: AbortSignal.timeout(20000) });
        if (r.ok) {
          log(`서버 워밍업 완료(${path})`);
          return;
        }
      } catch {
        /* 콜드 스타트 대기 */
      }
    }
    await sleep(4000);
  }
  log('워밍업 응답을 못 받았지만 계속 진행(첫 요청에서 재시도)');
}

async function main(): Promise<void> {
  // 0) 안전장치.
  assert.notEqual(PREVIEW, PRODUCTION);
  assert.ok(PREVIEW.includes('preview'), 'Preview URL 이 아님 — 중단');
  assert.ok(!PREVIEW.includes('workproof-auth'), 'Production 호스트 감지 — 중단');

  const client = createApiClient(PREVIEW);
  await warmup();

  // 1) 임시 계정 등록.
  const stamp = Date.now();
  const email = `p3b-${stamp}@example.com`;
  const password = `P3b!test-${stamp}`;
  log(`임시 계정 등록: ${mask(email)}`);
  const reg = await client.request<TokenPair>('/auth/register', {
    method: 'POST',
    body: { email, password, name: 'Phase3B E2E' },
    timeoutMs: 60000,
  });
  let access = reg.access_token;
  let refresh = reg.refresh_token;

  // single-flight 흉내 + 401 시 refresh 1회.
  const authorized = async <T>(run: (token: string) => Promise<T>): Promise<T> => {
    try {
      return await run(access);
    } catch (e) {
      if (e instanceof ApiError && e.isUnauthorized) {
        const t = await client.request<TokenPair>('/auth/refresh', {
          method: 'POST',
          body: { refresh_token: refresh },
        });
        access = t.access_token;
        refresh = t.refresh_token;
        return run(access);
      }
      throw e;
    }
  };
  const remote = createWorkDataRemote(client, authorized);

  // 2) 로컬 데이터 준비(고유 client_id).
  const wpId = `wp-${stamp}`;
  const sId = `s-${stamp}`;
  const aId = `a-${stamp}`;
  const workplace: Workplace = {
    id: wpId,
    name: 'E2E 카페',
    hourlyWage: 10030,
    payDay: 25,
    weeklyAllowance: true,
    fiveOrMoreEmployees: true,
    incomeDeductionType: 'withholding',
    breakMinutesPerShift: 30,
    latitude: 37.5665,
    longitude: 126.978,
    address: '서울',
    createdAt: new Date(stamp).toISOString(),
  };
  const schedule: ScheduledShift = {
    id: sId,
    workplaceId: wpId,
    date: '2026-08-20',
    startTime: '09:00',
    endTime: '18:00',
    reminderMinutes: 30,
    createdAt: new Date(stamp).toISOString(),
  };
  const attendance: AttendanceRecord = {
    id: aId,
    workplaceId: wpId,
    date: '2026-08-20',
    clockIn: '09:02',
    clockOut: '18:05',
    breakMinutes: 30,
    isHoliday: false,
    clockInLatitude: 37.5666,
    clockInLongitude: 126.9781,
  };
  const p = new InMemoryPersistence({
    workplaces: [workplace],
    schedules: [schedule],
    attendance: [attendance],
  });

  // 3) 초기 업로드.
  const r1 = await runSync({ persistence: p, remote, now: Date.now });
  assert.equal(r1.pushed, 3, '초기 업로드 3건');
  assert.equal(r1.authExpired, false);
  const wpServerId = p.state.workplace[wpId].serverId;
  assert.ok(wpServerId, '근무지 serverId 확보');
  // 정책 필드가 서버에 그대로 반영됐는지(Phase 3C).
  const uploaded = (await remote.listWorkplaces()).find((w) => w.client_id === wpId);
  assert.equal(uploaded?.pay_day, 25, '정책 pay_day 반영');
  assert.equal(uploaded?.weekly_allowance, true, '정책 weekly_allowance 반영');
  assert.equal(uploaded?.five_or_more_employees, true, '정책 five_or_more 반영');
  assert.equal(uploaded?.income_deduction_type, 'withholding', '정책 deduction 반영');
  assert.equal(uploaded?.break_minutes_per_shift, 30, '정책 break 반영');
  log(`초기 업로드 OK(정책 포함) — pushed=${r1.pushed}, pulled=${r1.pulled}`);

  // 4) 같은 client_id 재전송(멱등) — 중복 생성 없음.
  p.state.workplace[wpId] = { clientId: wpId, status: 'pendingCreate', attemptCount: 0 };
  await runSync({ persistence: p, remote, now: Date.now });
  const wpList = await remote.listWorkplaces();
  assert.equal(wpList.filter((w) => w.client_id === wpId).length, 1, '멱등 재전송 후 중복 없음');
  log('멱등 재전송 OK — 서버 중복 없음');

  // 5) update 동기화(시급 + 정책 필드).
  p.workplaces[0] = {
    ...p.workplaces[0],
    hourlyWage: 11500,
    payDay: 5,
    incomeDeductionType: 'insurance',
  };
  await runSync({ persistence: p, remote, now: Date.now });
  const afterUpdate = (await remote.listWorkplaces()).find((w) => w.client_id === wpId);
  assert.equal(afterUpdate?.hourly_wage, 11500, 'update 반영');
  assert.equal(afterUpdate?.pay_day, 5, '정책 update 반영');
  assert.equal(afterUpdate?.income_deduction_type, 'insurance', '정책 update 반영');
  log('update 동기화 OK — hourly_wage=11500, pay_day=5, deduction=insurance');

  // 6) 서버 fetch → 새 기기(빈 로컬) 복원.
  const fresh = new InMemoryPersistence();
  const r6 = await runSync({ persistence: fresh, remote, now: Date.now });
  const restoredWp = fresh.workplaces.find((w) => w.id === wpId);
  assert.ok(restoredWp, '근무지 복원');
  assert.equal(fresh.schedules.some((s) => s.id === sId), true, '예정 복원');
  assert.equal(fresh.attendance.some((a) => a.id === aId), true, '출퇴근 복원');
  // 정책 필드가 새 기기 복원에도 서버 값으로 복원되는지(3C 핵심 목표).
  assert.equal(restoredWp?.payDay, 5, '정책 pay_day 복원');
  assert.equal(restoredWp?.incomeDeductionType, 'insurance', '정책 deduction 복원');
  assert.equal(restoredWp?.fiveOrMoreEmployees, true, '정책 five_or_more 복원');
  log(`서버 fetch/merge 복원 OK(정책 포함) — pulled=${r6.pulled}`);

  // 7) delete 동기화(자식 포함).
  p.workplaces = [];
  p.schedules = [];
  p.attendance = [];
  await runSync({ persistence: p, remote, now: Date.now });
  const remain =
    (await remote.listWorkplaces()).filter((w) => w.client_id === wpId).length +
    (await remote.listSchedules()).filter((s) => s.client_id === sId).length +
    (await remote.listAttendance()).filter((a) => a.client_id === aId).length;
  assert.equal(remain, 0, '삭제 후 서버 활성 0');
  log('delete 동기화 OK — 서버 활성 work-data 0');

  // 8) 로그아웃(서버 refresh 폐기) — 이후 sync 는 앱 정책상 중단(여기선 엔드포인트만 확인).
  await client.request<{ ok: boolean }>('/auth/logout', {
    method: 'POST',
    body: { refresh_token: refresh },
  });
  log('로그아웃 OK — refresh 폐기');

  // 9) 재로그인 후 데이터(모두 삭제됨) 확인 — 활성 0 유지(삭제분 미복원).
  const relogin = await client.request<TokenPair>('/auth/login', {
    method: 'POST',
    body: { email, password, device_label: 'e2e' },
  });
  access = relogin.access_token;
  refresh = relogin.refresh_token;
  const after = new InMemoryPersistence();
  await runSync({ persistence: after, remote, now: Date.now });
  assert.equal(after.workplaces.length, 0, '삭제된 데이터는 재로그인 후에도 미복원');
  log('재로그인 OK — 삭제분 미복원 확인');

  // 10) 정리: 계정 삭제(활성 work-data 이미 0).
  await client.request<void>('/users/me', {
    method: 'DELETE',
    accessToken: access,
    expectNoContent: true,
  });
  log('정리 완료 — 임시 계정 삭제, 활성 work-data 0');

  log('ALL PREVIEW INTEGRATION CHECKS PASSED (10/10)');
}

main().catch((e) => {
  const msg = e instanceof ApiError ? `${e.kind}${e.status ? ` ${e.status}` : ''}: ${e.message}` : String(e);
  console.error(`[preview] FAILED — ${msg}`);
  process.exit(1);
});
