// 백업 복원 원자성(restoreBackupData) 검증 — 실패 주입 + 롤백. 저장소는 인메모리 mock.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  restoreBackupData,
  BackupRestoreError,
  type KeyValueStore,
} from '../src/core/backup/restoreData';

// 실패 주입 가능한 인메모리 KeyValueStore. set/remove 호출 순번을 지정해 던질 수 있다.
class FakeStore implements KeyValueStore {
  map = new Map<string, string>();
  setCalls = 0;
  removeCalls = 0;
  throwOnSetCall = new Set<number>();
  throwOnRemoveCall = new Set<number>();

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.map.set(k, v);
  }
  async multiGet(keys: string[]): Promise<ReadonlyArray<readonly [string, string | null]>> {
    return keys.map((k) => [k, this.map.has(k) ? (this.map.get(k) as string) : null] as const);
  }
  async multiSet(pairs: Array<[string, string]>): Promise<void> {
    this.setCalls += 1;
    if (this.throwOnSetCall.has(this.setCalls)) throw new Error(`multiSet fail #${this.setCalls}`);
    for (const [k, v] of pairs) this.map.set(k, v);
  }
  async multiRemove(keys: string[]): Promise<void> {
    this.removeCalls += 1;
    if (this.throwOnRemoveCall.has(this.removeCalls)) throw new Error(`multiRemove fail #${this.removeCalls}`);
    for (const k of keys) this.map.delete(k);
  }
  snapshotObj(): Record<string, string> {
    return Object.fromEntries(this.map.entries());
  }
}

const KEYS = ['@wp/workplaces', '@wp/attendance', '@wp/pay', '@wp/shifts'];

test('정상 round trip: 새 값 반영 + 백업에 없는 키는 비움', async () => {
  const store = new FakeStore({
    '@wp/workplaces': 'OLD_WP',
    '@wp/attendance': 'OLD_ATT',
    '@wp/pay': 'OLD_PAY',
  });
  await restoreBackupData(store, KEYS, {
    '@wp/workplaces': 'NEW_WP',
    '@wp/shifts': 'NEW_SHIFTS',
  });
  assert.equal(store.map.get('@wp/workplaces'), 'NEW_WP');
  assert.equal(store.map.get('@wp/shifts'), 'NEW_SHIFTS');
  // 백업에 없던 attendance/pay 는 비워진다(통째 교체 의미론)
  assert.equal(store.map.has('@wp/attendance'), false);
  assert.equal(store.map.has('@wp/pay'), false);
});

test('검증: 문자열 아닌 값·알 수 없는 키는 무시', async () => {
  const store = new FakeStore({ '@wp/workplaces': 'OLD' });
  await restoreBackupData(store, KEYS, {
    '@wp/workplaces': 123 as unknown as string, // 비문자열 → 무시 → 키 비워짐
    '@wp/unknown': 'X', // 백업 대상 아님 → 무시
  } as Record<string, unknown>);
  assert.equal(store.map.has('@wp/workplaces'), false);
  assert.equal(store.map.has('@wp/unknown'), false);
});

test('backupKeys 밖의 키(appLock/토큰 등)는 절대 건드리지 않음', async () => {
  const store = new FakeStore({ '@wp/appLock': 'true', '@wp/workplaces': 'OLD' });
  await restoreBackupData(store, KEYS, { '@wp/appLock': 'false', '@wp/workplaces': 'NEW' });
  // appLock 은 backupKeys에 없으므로 원래 값 유지
  assert.equal(store.map.get('@wp/appLock'), 'true');
  assert.equal(store.map.get('@wp/workplaces'), 'NEW');
});

test('첫 write(적용 set) 실패 → 롤백 후 기존 데이터 불변, rolledBack=true', async () => {
  const original = { '@wp/workplaces': 'OLD_WP', '@wp/attendance': 'OLD_ATT' };
  const store = new FakeStore(original);
  store.throwOnSetCall.add(1); // 적용 단계 multiSet 실패
  await assert.rejects(
    () => restoreBackupData(store, KEYS, { '@wp/workplaces': 'NEW_WP' }),
    (e: unknown) => e instanceof BackupRestoreError && e.rolledBack === true
  );
  assert.deepEqual(store.snapshotObj(), original); // 기존 데이터 보존
});

test('마지막 write(적용 remove) 실패 → 롤백 후 기존 데이터 복원', async () => {
  const original = { '@wp/workplaces': 'OLD_WP', '@wp/attendance': 'OLD_ATT', '@wp/pay': 'OLD_PAY' };
  const store = new FakeStore(original);
  // 적용: set #1 성공, remove #1(백업에 없는 키 비우기) 실패 → 롤백
  store.throwOnRemoveCall.add(1);
  await assert.rejects(
    () => restoreBackupData(store, KEYS, { '@wp/workplaces': 'NEW_WP' }),
    (e: unknown) => e instanceof BackupRestoreError && e.rolledBack === true
  );
  // 롤백으로 원래 3개 키가 원값으로 복원
  assert.deepEqual(store.snapshotObj(), original);
});

test('롤백까지 실패 → rolledBack=false (성공 처리 금지)', async () => {
  const original = { '@wp/workplaces': 'OLD_WP' };
  const store = new FakeStore(original);
  store.throwOnSetCall.add(1); // 적용 set 실패
  store.throwOnSetCall.add(2); // 롤백 set 도 실패
  await assert.rejects(
    () => restoreBackupData(store, KEYS, { '@wp/workplaces': 'NEW_WP', '@wp/pay': 'NEW_PAY' }),
    (e: unknown) => e instanceof BackupRestoreError && e.rolledBack === false
  );
});

test('예정근무/GPS/공제 등 임의 문자열 값 정상 복원(형식 불투명)', async () => {
  const store = new FakeStore({});
  const shifts = JSON.stringify([{ id: 's1', date: '2026-08-10', reminderMinutes: 30 }]);
  const attendance = JSON.stringify([{ id: 'a1', clockInLatitude: 37.5, clockInLongitude: 127 }]);
  await restoreBackupData(store, KEYS, { '@wp/shifts': shifts, '@wp/attendance': attendance });
  assert.equal(store.map.get('@wp/shifts'), shifts);
  assert.equal(store.map.get('@wp/attendance'), attendance);
});

test('빈 백업(유효 키 없음) → backupKeys 전부 비움', async () => {
  const store = new FakeStore({ '@wp/workplaces': 'OLD', '@wp/pay': 'OLD' });
  await restoreBackupData(store, KEYS, {});
  for (const k of KEYS) assert.equal(store.map.has(k), false);
});
