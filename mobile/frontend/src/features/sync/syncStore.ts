// 동기화 metadata 저장 + 로컬 레코드 접근을 실제 AsyncStorage/storage.ts 로 잇는 어댑터.
// (엔진은 순수하고 I/O 를 주입받으므로, 이 파일이 유일한 저장소 결합 지점이다.)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { KEYS } from '../../services/storage/storageKeys';
import {
  getAllAttendance,
  getScheduledShifts,
  getWorkplaces,
  saveAttendance,
  saveScheduledShift,
  saveWorkplace,
} from '../../services/storage/storage';
import { emptySyncState, type SyncState } from './model';
import type { SyncPersistence } from './engine';

// sync 상태(metadata)는 별도 키에 단일 JSON 으로 저장한다. 손상 시 빈 상태로 폴백해
// 다음 sync 에서 전량 pending 으로 재구성한다(데이터 유실 아님).
export async function loadSyncState(): Promise<SyncState> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.syncState);
    if (!raw) return emptySyncState();
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      workplace: parsed.workplace ?? {},
      schedule: parsed.schedule ?? {},
      attendance: parsed.attendance ?? {},
    };
  } catch {
    return emptySyncState();
  }
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await AsyncStorage.setItem(KEYS.syncState, JSON.stringify(state));
}

/** 로그아웃/계정 전환 시 sync metadata 만 비운다(업무 데이터는 그대로 둔다). */
export async function clearSyncState(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.syncState);
}

// 엔진에 주입할 persistence 구현. 로컬 CRUD 는 기존 storage.ts 를 그대로 재사용한다.
export const syncPersistence: SyncPersistence = {
  getWorkplaces,
  getSchedules: getScheduledShifts,
  getAttendance: getAllAttendance,
  saveWorkplace,
  saveSchedule: saveScheduledShift,
  saveAttendance,
  loadState: loadSyncState,
  saveState: saveSyncState,
};
