import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, ALL_KEYS, BACKUP_KEYS, BACKUP_EXCLUDED_KEYS } from '../src/core/data/storageKeys';

// Phase 4A hardening: 변경 이력(attendanceHistory) 저장 정책 회귀 방지.
test('attendanceHistory 는 전체 초기화(clearAllData) 대상이다(회원탈퇴·초기화 시 삭제)', () => {
  assert.ok(ALL_KEYS.includes(KEYS.attendanceHistory));
});

test('attendanceHistory 는 백업 대상이다(로컬 데이터라 복원 시 보존)', () => {
  assert.ok(BACKUP_KEYS.includes(KEYS.attendanceHistory));
});

test('attendanceHistory 는 백업 제외 목록에 없다(=서버 동기화 대상 아님, syncState 와 다름)', () => {
  assert.ok(!BACKUP_EXCLUDED_KEYS.includes(KEYS.attendanceHistory));
  // syncState 는 여전히 백업/복원에서 제외된다(계정·기기별 동기화 상태).
  assert.ok(BACKUP_EXCLUDED_KEYS.includes(KEYS.syncState));
});
