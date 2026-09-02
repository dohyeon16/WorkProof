// runSync 통합 검증(인메모리 서버 + persistence). 초기 업로드·멱등 replay·부분 실패 재실행·
// merge·삭제 전파·인증 만료·422/409 failed·재시도 한도. 모든 I/O 주입(순수).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSync } from '../src/features/sync/engine';
import { mergeServerRecords } from '../src/features/sync/merge';
import { workplaceFingerprint } from '../src/features/sync/mappers';
import { emptySyncState, MAX_ATTEMPTS, type SyncState } from '../src/features/sync/model';
import {
  InMemoryPersistence,
  InMemoryServer,
  SessionExpiredError,
  httpError,
  makeAttendance,
  makeSchedule,
  makeWorkplace,
  networkError,
  wireWorkplace,
  withFault,
} from './support/syncHarness';

function seededPersistence() {
  return new InMemoryPersistence({
    workplaces: [makeWorkplace('wp-1')],
    schedules: [makeSchedule('s1', 'wp-1')],
    attendance: [makeAttendance('a1', 'wp-1')],
  });
}

test('초기 동기화: 근무지 먼저 업로드하고 자식의 서버 참조를 해결', async () => {
  const server = new InMemoryServer();
  const p = seededPersistence();
  const r = await runSync({ persistence: p, remote: server.remote, now: () => 1_700_000_000_000 });

  assert.equal(r.pushed, 3);
  assert.equal(r.authExpired, false);
  assert.equal(r.offline, false);
  assert.equal(server.activeRows('workplace').length, 1);
  assert.equal(server.activeRows('schedule').length, 1);
  assert.equal(server.activeRows('attendance').length, 1);

  const wpServerId = p.state.workplace['wp-1'].serverId;
  assert.ok(wpServerId);
  // 자식의 workplace_id 가 근무지 serverId 로 매핑됐는지.
  assert.equal(server.activeRows('schedule')[0].data.workplace_id, wpServerId);
  assert.equal(server.activeRows('attendance')[0].data.workplace_id, wpServerId);
  // meta 상태.
  assert.equal(p.state.workplace['wp-1'].status, 'synced');
  assert.equal(p.state.schedule['s1'].status, 'synced');
});

test('멱등 replay: 응답 유실로 serverId 를 잃어도 재전송 시 서버 row 중복 없음', async () => {
  const server = new InMemoryServer();
  const p = seededPersistence();
  await runSync({ persistence: p, remote: server.remote, now: () => 1_700_000_000_000 });
  assert.equal(server.activeRows('workplace').length, 1);

  // 응답 유실 시뮬레이션: 근무지 meta 의 serverId 를 지우고 pendingCreate 로.
  p.state.workplace['wp-1'] = { clientId: 'wp-1', status: 'pendingCreate', attemptCount: 0 };
  await runSync({ persistence: p, remote: server.remote, now: () => 1_700_000_100_000 });

  // 같은 client_id 라 서버는 기존을 돌려준다 → 중복 없음.
  assert.equal(server.activeRows('workplace').length, 1);
  assert.equal(p.state.workplace['wp-1'].status, 'synced');
  assert.ok(p.state.workplace['wp-1'].serverId);
});

test('부분 실패 후 재실행: 근무지 create 네트워크 실패 → 보류, 재연결 후 성공', async () => {
  const server = new InMemoryServer();
  const p = seededPersistence();
  let clock = 1_700_000_000_000;

  const faulty = withFault(server.remote, {
    createWorkplace: async () => {
      throw networkError();
    },
  });
  const r1 = await runSync({ persistence: p, remote: faulty, now: () => clock });
  assert.equal(r1.offline, true);
  assert.equal(server.activeRows('workplace').length, 0); // 아무것도 안 올라감
  assert.equal(p.workplaces.length, 1); // 로컬 데이터 보존
  assert.equal(p.state.workplace['wp-1'].status, 'pendingCreate');
  assert.equal(p.state.workplace['wp-1'].attemptCount, 1);

  // 재연결: 시계를 backoff 이후로 진행하고 정상 remote 로 재시도.
  clock += 60_000;
  const r2 = await runSync({ persistence: p, remote: server.remote, now: () => clock });
  assert.equal(r2.pushed, 3);
  assert.equal(server.activeRows('workplace').length, 1);
});

test('인증 만료: SessionExpiredError → 전체 중단, 로컬/서버 데이터 불변', async () => {
  const server = new InMemoryServer();
  const p = seededPersistence();
  const faulty = withFault(server.remote, {
    createWorkplace: async () => {
      throw new SessionExpiredError();
    },
  });
  const r = await runSync({ persistence: p, remote: faulty, now: () => 1_700_000_000_000 });
  assert.equal(r.authExpired, true);
  assert.equal(server.activeRows('workplace').length, 0);
  assert.equal(p.workplaces.length, 1); // 사용자 데이터 삭제 없음
});

test('422 검증 오류 → failed(park), 무한 재시도 안 함', async () => {
  const server = new InMemoryServer();
  const p = new InMemoryPersistence({ workplaces: [makeWorkplace('wp-1')] });
  const faulty = withFault(server.remote, {
    createWorkplace: async () => {
      throw httpError(422, '검증 실패');
    },
  });
  const r1 = await runSync({ persistence: p, remote: faulty, now: () => 1_700_000_000_000 });
  assert.equal(r1.failedPermanent, 1);
  assert.equal(p.state.workplace['wp-1'].status, 'failed');

  // 재실행해도 failed 는 자동 재시도되지 않는다(연산 0, 서버 호출 없음).
  let called = false;
  const trap = withFault(server.remote, {
    createWorkplace: async () => {
      called = true;
      throw httpError(422, 'x');
    },
    listWorkplaces: async () => [],
    listSchedules: async () => [],
    listAttendance: async () => [],
  });
  await runSync({ persistence: p, remote: trap, now: () => 1_700_000_100_000 });
  assert.equal(called, false);
});

test('409 충돌(삭제된 client_id 재사용) → failed, 로컬 데이터 보존', async () => {
  const server = new InMemoryServer();
  const p = new InMemoryPersistence({ workplaces: [makeWorkplace('wp-1')] });
  const faulty = withFault(server.remote, {
    createWorkplace: async () => {
      throw httpError(409, '삭제된 기록');
    },
  });
  const r = await runSync({ persistence: p, remote: faulty, now: () => 1_700_000_000_000 });
  assert.equal(r.failedPermanent, 1);
  assert.equal(p.state.workplace['wp-1'].status, 'failed');
  assert.equal(p.state.workplace['wp-1'].lastError, 'conflict');
  assert.equal(p.workplaces.length, 1);
});

test('재시도 한도: 네트워크 실패를 반복하면 MAX_ATTEMPTS 후 failed 로 park', async () => {
  const server = new InMemoryServer();
  const p = new InMemoryPersistence({ workplaces: [makeWorkplace('wp-1')] });
  const faulty = withFault(server.remote, {
    createWorkplace: async () => {
      throw networkError();
    },
  });
  let clock = 1_700_000_000_000;
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    await runSync({ persistence: p, remote: faulty, now: () => clock });
    clock += 10 * 60_000; // 항상 backoff 이후로
  }
  assert.equal(p.state.workplace['wp-1'].status, 'failed');
  assert.equal(p.state.workplace['wp-1'].attemptCount >= MAX_ATTEMPTS, true);
});

test('로컬 삭제 전파 + 되살아나지 않음: 근무지·자식 삭제 → 서버 soft-delete, 재fetch 시 미복원', async () => {
  const server = new InMemoryServer();
  const p = seededPersistence();
  await runSync({ persistence: p, remote: server.remote, now: () => 1_700_000_000_000 });
  assert.equal(server.activeRows('workplace').length, 1);

  // 로컬에서 근무지 삭제 시 storage 는 자식도 함께 지운다 → 세 배열 모두 비움.
  p.workplaces = [];
  p.schedules = [];
  p.attendance = [];
  const r = await runSync({ persistence: p, remote: server.remote, now: () => 1_700_000_200_000 });

  assert.equal(server.activeRows('workplace').length, 0);
  assert.equal(server.activeRows('schedule').length, 0);
  assert.equal(server.activeRows('attendance').length, 0);
  assert.equal(r.pulled, 0); // 서버 목록이 비어 되살릴 것 없음
  // 삭제 확정 → meta 정리.
  assert.equal(p.state.workplace['wp-1'], undefined);
});

test('merge: 서버 전용 레코드는 로컬에 추가(재로그인 복원)', () => {
  const server = new InMemoryServer();
  // 다른 기기가 만든 것처럼 서버에 직접 시드.
  const state = emptySyncState();
  // remote.createWorkplace 로 서버 row 생성 후 그 wire 를 fetched 로 사용.
  const merged = mergeServerRecords({
    local: { workplace: [], schedule: [], attendance: [] },
    state,
    fetched: {
      workplace: [
        wireWorkplace({
          id: 'srv-x',
          client_id: 'wp-remote',
          name: '원격',
          hourly_wage: 9860,
          pay_day: 15,
          break_minutes_per_shift: 45,
        }),
      ],
      schedule: [],
      attendance: [],
    },
    nowIso: '2026-08-06T00:00:00.000Z',
  });
  assert.equal(merged.workplaces.length, 1);
  assert.equal(merged.workplaces[0].id, 'wp-remote');
  // 서버 전용 복원 시 정책 필드도 서버 값으로 채워진다.
  assert.equal(merged.workplaces[0].payDay, 15);
  assert.equal(merged.workplaces[0].breakMinutesPerShift, 45);
  assert.equal(merged.state.workplace['wp-remote'].status, 'synced');
  assert.equal(merged.state.workplace['wp-remote'].serverId, 'srv-x');
  void server;
});

test('merge: pending local update/delete 는 서버 fetch 로 덮이지 않는다', () => {
  const local = makeWorkplace('wp-1', { hourlyWage: 20000 }); // 로컬에서 20000 으로 편집
  const state = emptySyncState();
  // meta 는 예전 지문(8000) → 로컬에 미전송 변경 있음(pending).
  state.workplace['wp-1'] = {
    clientId: 'wp-1',
    serverId: 'srv-1',
    status: 'synced',
    fingerprint: workplaceFingerprint(makeWorkplace('wp-1', { hourlyWage: 8000 })),
    attemptCount: 0,
  };
  const merged = mergeServerRecords({
    local: { workplace: [local], schedule: [], attendance: [] },
    state,
    fetched: {
      workplace: [
        wireWorkplace({
          id: 'srv-1',
          client_id: 'wp-1',
          name: local.name,
          hourly_wage: 8000, // 서버는 예전 값
          updated_at: 'u2',
        }),
      ],
      schedule: [],
      attendance: [],
    },
    nowIso: 'now',
  });
  // 로컬 편집(20000) 보존 — 서버 값(8000)으로 덮지 않음.
  assert.equal(merged.workplaces.length, 0); // save 되지 않음
  assert.equal(merged.state.workplace['wp-1'].status, 'pendingUpdate');
  assert.equal(merged.state.workplace['wp-1'].serverId, 'srv-1');
});

test('merge: pendingDelete 는 서버 목록에 있어도 되살리지 않음', () => {
  const state: SyncState = emptySyncState();
  state.workplace['wp-1'] = {
    clientId: 'wp-1',
    serverId: 'srv-1',
    status: 'pendingDelete',
    attemptCount: 0,
  };
  const merged = mergeServerRecords({
    local: { workplace: [], schedule: [], attendance: [] },
    state,
    fetched: {
      workplace: [wireWorkplace({ id: 'srv-1', client_id: 'wp-1', name: 'x', hourly_wage: 1 })],
      schedule: [],
      attendance: [],
    },
    nowIso: 'now',
  });
  assert.equal(merged.workplaces.length, 0); // 되살리지 않음
  assert.equal(merged.state.workplace['wp-1'].status, 'pendingDelete');
});
