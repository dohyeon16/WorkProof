// 백업 정책 회귀: 업무 데이터(client_id=로컬 id)는 백업에 포함, sync metadata(serverId/
// retry)와 appLock 은 제외. 전체 초기화 대상에는 sync 상태가 포함(계정 전환 시 정리).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALL_KEYS,
  BACKUP_EXCLUDED_KEYS,
  BACKUP_KEYS,
  KEYS,
} from '../src/core/data/storageKeys';

test('sync metadata 는 백업에서 제외된다(다른 계정/기기 충돌 방지)', () => {
  assert.equal(BACKUP_EXCLUDED_KEYS.includes(KEYS.syncState), true);
  assert.equal(BACKUP_KEYS.includes(KEYS.syncState), false);
});

test('appLock 제외 정책은 그대로 유지', () => {
  assert.equal(BACKUP_EXCLUDED_KEYS.includes(KEYS.appLock), true);
  assert.equal(BACKUP_KEYS.includes(KEYS.appLock), false);
});

test('업무 데이터(로컬 id=client_id 보존)는 백업에 포함', () => {
  for (const k of [KEYS.workplaces, KEYS.attendance, KEYS.scheduledShifts, KEYS.pay]) {
    assert.equal(BACKUP_KEYS.includes(k), true);
  }
});

test('전체 초기화(ALL_KEYS)에는 sync 상태도 포함된다', () => {
  assert.equal(ALL_KEYS.includes(KEYS.syncState), true);
});
