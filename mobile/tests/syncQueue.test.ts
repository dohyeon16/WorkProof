// reconcile(파생 큐) 검증: coalescing 규칙·의존성 순서·backoff 게이트·failed park·재시도 리셋.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workplaceFingerprint } from '../src/features/sync/mappers';
import {
  emptySyncState,
  isDue,
  resetFailed,
  type SyncMeta,
  type SyncState,
} from '../src/features/sync/model';
import {
  failedCount,
  hasDueOperations,
  pendingOperationCount,
  reconcile,
  type LocalSnapshot,
} from '../src/features/sync/reconcile';
import { makeSchedule, makeWorkplace } from './support/syncHarness';

function meta(over: Partial<SyncMeta> & { clientId: string }): SyncMeta {
  return { status: 'synced', attemptCount: 0, ...over };
}
function snapshot(over: Partial<LocalSnapshot> = {}): LocalSnapshot {
  return { workplace: [], schedule: [], attendance: [], ...over };
}

test('meta 없는 로컬 레코드 → create 1건', () => {
  const local = snapshot({ workplace: [makeWorkplace('wp-1')] });
  const { operations, gc } = reconcile(local, emptySyncState());
  assert.deepEqual(operations, [{ resource: 'workplace', kind: 'create', clientId: 'wp-1' }]);
  assert.equal(gc.length, 0);
});

test('create+update 병합: 생성 후 여러 번 수정해도 create 1건(최신 내용)', () => {
  // meta 없음 = 아직 생성 전. 로컬이 최종 상태이므로 create 하나만 나온다(update 없음).
  const local = snapshot({ workplace: [makeWorkplace('wp-1', { hourlyWage: 99999 })] });
  const { operations } = reconcile(local, emptySyncState());
  assert.equal(operations.length, 1);
  assert.equal(operations[0].kind, 'create');
});

test('update 병합: synced 이후 로컬 편집 → update 1건', () => {
  const wp = makeWorkplace('wp-1', { hourlyWage: 10000 });
  const state: SyncState = emptySyncState();
  // 지문을 "예전 값"으로 두면 현재 로컬과 달라 update 가 나온다.
  state.workplace['wp-1'] = meta({
    clientId: 'wp-1',
    serverId: 'srv-1',
    fingerprint: workplaceFingerprint(makeWorkplace('wp-1', { hourlyWage: 8000 })),
  });
  const { operations } = reconcile(snapshot({ workplace: [wp] }), state);
  assert.deepEqual(operations, [{ resource: 'workplace', kind: 'update', clientId: 'wp-1' }]);
});

test('3C backfill: 3B 지문(정책 없음)으로 synced 였던 근무지는 update 로 정책을 밀어낸다', () => {
  const wp = makeWorkplace('wp-1'); // 현재 로컬(정책 필드 포함)
  const state = emptySyncState();
  // Phase 3B 시절 저장된 지문: 정책 없이 기본 필드만 직렬화된 형태.
  const legacyFingerprint = JSON.stringify([
    wp.name,
    Math.round(wp.hourlyWage),
    wp.address ?? null,
    wp.latitude ?? null,
    wp.longitude ?? null,
  ]);
  state.workplace['wp-1'] = meta({
    clientId: 'wp-1',
    serverId: 'srv-1',
    fingerprint: legacyFingerprint,
  });
  const { operations } = reconcile(snapshot({ workplace: [wp] }), state);
  // 지문 불일치 → update 로 정책 backfill.
  assert.deepEqual(operations, [{ resource: 'workplace', kind: 'update', clientId: 'wp-1' }]);
});

test('synced + 변경 없음 → 연산 없음', () => {
  const wp = makeWorkplace('wp-1');
  const state = emptySyncState();
  state.workplace['wp-1'] = meta({ clientId: 'wp-1', serverId: 'srv-1', fingerprint: workplaceFingerprint(wp) });
  assert.equal(reconcile(snapshot({ workplace: [wp] }), state).operations.length, 0);
});

test('delete 가 update 를 누른다: synced 레코드가 로컬에서 사라지면 delete', () => {
  const state = emptySyncState();
  state.workplace['wp-1'] = meta({
    clientId: 'wp-1',
    serverId: 'srv-1',
    fingerprint: workplaceFingerprint(makeWorkplace('wp-1', { hourlyWage: 111 })), // 편집됐었더라도
  });
  const { operations } = reconcile(snapshot({ workplace: [] }), state);
  assert.deepEqual(operations, [{ resource: 'workplace', kind: 'delete', clientId: 'wp-1' }]);
});

test('create 후 서버 반영 전 삭제 → 연산 없음 + meta GC', () => {
  const state = emptySyncState();
  state.workplace['wp-1'] = meta({ clientId: 'wp-1', status: 'pendingCreate' }); // serverId 없음
  const { operations, gc } = reconcile(snapshot({ workplace: [] }), state);
  assert.equal(operations.length, 0);
  assert.deepEqual(gc, [{ resource: 'workplace', clientId: 'wp-1' }]);
});

test('의존성 순서: workplace → schedule', () => {
  const local = snapshot({
    workplace: [makeWorkplace('wp-1')],
    schedule: [makeSchedule('s1', 'wp-1')],
  });
  const ops = reconcile(local, emptySyncState()).operations;
  assert.equal(ops[0].resource, 'workplace');
  assert.equal(ops[1].resource, 'schedule');
});

test('failed 는 park — 자동 연산에서 제외', () => {
  const wp = makeWorkplace('wp-1');
  const state = emptySyncState();
  state.workplace['wp-1'] = meta({ clientId: 'wp-1', status: 'failed', lastError: 'validation' });
  assert.equal(reconcile(snapshot({ workplace: [wp] }), state).operations.length, 0);
  assert.equal(failedCount(state), 1);
});

test('중복 enqueue 없음: 같은 입력에 reconcile 재실행해도 동일 단일 연산', () => {
  const local = snapshot({ workplace: [makeWorkplace('wp-1')] });
  const a = reconcile(local, emptySyncState()).operations;
  const b = reconcile(local, emptySyncState()).operations;
  assert.equal(a.length, 1);
  assert.deepEqual(a, b);
});

test('pendingOperationCount 반영', () => {
  const local = snapshot({ workplace: [makeWorkplace('wp-1'), makeWorkplace('wp-2')] });
  assert.equal(pendingOperationCount(local, emptySyncState()), 2);
});

test('backoff 게이트: nextRetryAt 미래면 hasDueOperations=false, 과거면 true', () => {
  const wp = makeWorkplace('wp-1');
  const now = 1_700_000_000_000;
  const future = emptySyncState();
  future.workplace['wp-1'] = meta({
    clientId: 'wp-1',
    serverId: 'srv-1',
    status: 'pendingUpdate',
    fingerprint: 'stale',
    nextRetryAt: new Date(now + 60_000).toISOString(),
  });
  assert.equal(hasDueOperations(snapshot({ workplace: [wp] }), future, now), false);

  const past = emptySyncState();
  past.workplace['wp-1'] = meta({
    clientId: 'wp-1',
    serverId: 'srv-1',
    status: 'pendingUpdate',
    fingerprint: 'stale',
    nextRetryAt: new Date(now - 1).toISOString(),
  });
  assert.equal(hasDueOperations(snapshot({ workplace: [wp] }), past, now), true);
  // isDue 단위 확인.
  assert.equal(isDue(past.workplace['wp-1'], now), true);
  assert.equal(isDue(future.workplace['wp-1'], now), false);
});

test('resetFailed: failed → pending(serverId 유무로 update/create), attempt/backoff 리셋', () => {
  const state = emptySyncState();
  state.workplace['wp-1'] = meta({
    clientId: 'wp-1',
    serverId: 'srv-1',
    status: 'failed',
    attemptCount: 8,
    nextRetryAt: 'x',
    lastError: 'server',
  });
  state.workplace['wp-2'] = meta({ clientId: 'wp-2', status: 'failed', attemptCount: 3 });
  const reset = resetFailed(state);
  assert.equal(reset.workplace['wp-1'].status, 'pendingUpdate');
  assert.equal(reset.workplace['wp-1'].attemptCount, 0);
  assert.equal(reset.workplace['wp-1'].nextRetryAt, undefined);
  assert.equal(reset.workplace['wp-2'].status, 'pendingCreate');
});
