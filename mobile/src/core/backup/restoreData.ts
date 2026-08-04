// 백업 복원의 "원자성에 가까운(atomic-like)" 적용 로직 — 순수 모듈(RN/저장소 의존 없음).
// 저장소는 KeyValueStore로 주입해 실패 주입 단위 테스트가 가능하다.
//
// AsyncStorage는 진짜 트랜잭션을 제공하지 않으므로 다음으로 최대한 강한 semantics를 만든다:
//   1) 쓰기 전에 백업 구조를 전부 메모리에서 검증(문자열 값만 채택, 알 수 없는 키 무시)
//   2) 적용 전 기존 값을 스냅샷
//   3) 새 값을 먼저 쓰고(기존 데이터가 지워지기 전에) 백업에 없는 키를 비운다
//   4) 적용 중 실패하면 스냅샷으로 롤백을 시도
//   5) 롤백까지 실패하면 명확한 오류를 던진다(성공으로 처리하지 않는다)
// 백업 원문/민감값은 로그에 남기지 않는다(이 모듈은 로깅하지 않는다).

export interface KeyValueStore {
  multiGet(keys: string[]): Promise<ReadonlyArray<readonly [string, string | null]>>;
  multiSet(pairs: Array<[string, string]>): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
}

/** 복원 실패를 나타내는 오류. rolledBack=true면 이전 상태로 되돌아갔음(데이터 보존)을 뜻한다. */
export class BackupRestoreError extends Error {
  readonly rolledBack: boolean;
  constructor(message: string, rolledBack: boolean, options?: { cause?: unknown }) {
    super(message);
    this.name = 'BackupRestoreError';
    this.rolledBack = rolledBack;
    if (options && 'cause' in options) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

async function restoreSnapshot(
  store: KeyValueStore,
  snapshot: ReadonlyArray<readonly [string, string | null]>
): Promise<void> {
  const toSet: Array<[string, string]> = [];
  const toRemove: string[] = [];
  for (const [key, value] of snapshot) {
    if (value == null) toRemove.push(key);
    else toSet.push([key, value]);
  }
  if (toSet.length > 0) await store.multiSet(toSet);
  if (toRemove.length > 0) await store.multiRemove(toRemove);
}

/**
 * 백업 data로 backupKeys 범위를 통째 교체한다(백업에 없는 키는 비운다).
 * 실패 시 스냅샷으로 롤백을 시도하고, 성공했을 때만 정상 반환한다.
 */
export async function restoreBackupData(
  store: KeyValueStore,
  backupKeys: readonly string[],
  data: Record<string, unknown>
): Promise<void> {
  // 1) 검증 + 적용할 pair 구성(문자열 값만, 백업 대상 키만 — appLock 등 제외는 backupKeys가 결정).
  const pairs: Array<[string, string]> = [];
  for (const key of backupKeys) {
    const value = data[key];
    if (typeof value === 'string') pairs.push([key, value]);
  }
  const present = new Set(pairs.map(([k]) => k));
  const keysToClear = backupKeys.filter((k) => !present.has(k));

  // 2) 롤백용 스냅샷.
  const snapshot = await store.multiGet([...backupKeys]);

  // 3) 적용: 새 값을 먼저 쓰고(기존이 지워지기 전에), 백업에 없는 키를 비운다.
  try {
    if (pairs.length > 0) await store.multiSet(pairs);
    if (keysToClear.length > 0) await store.multiRemove([...keysToClear]);
  } catch (applyErr) {
    // 4) 롤백 시도.
    try {
      await restoreSnapshot(store, snapshot);
    } catch (rollbackErr) {
      // 5) 롤백까지 실패 — 데이터가 일부만 반영됐을 수 있음. 성공으로 처리하지 않는다.
      throw new BackupRestoreError(
        '복원 중 오류가 발생했고 이전 상태로 되돌리지도 못했어요. 일부만 반영됐을 수 있어요.',
        false,
        { cause: rollbackErr }
      );
    }
    throw new BackupRestoreError('복원에 실패해 이전 데이터로 되돌렸어요. 다시 시도해주세요.', true, {
      cause: applyErr,
    });
  }
}
