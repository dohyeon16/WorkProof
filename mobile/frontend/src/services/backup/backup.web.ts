import { exportAllData, importAllData } from '../storage/storage';
import { formatLocalDate } from '../../utils/date';
import { BackupRestoreError } from './restoreData';
import type { BackupPayload, CreateBackupResult, RestoreBackupResult } from './backup';

// 웹에서는 expo-sharing/expo-file-system을 못 쓰므로, Blob 다운로드와 <input type=file>로 처리한다.
const APP_TAG = 'WorkProof';
const BACKUP_VERSION = 1;

export type { CreateBackupResult, RestoreBackupResult } from './backup';

function fileStamp(): string {
  // 파일명은 로컬 날짜 기준. toISOString(UTC)은 KST에서 하루 밀릴 수 있다.
  return formatLocalDate();
}

export async function createBackup(): Promise<CreateBackupResult> {
  const data = await exportAllData();
  const payload: BackupPayload = {
    app: APP_TAG,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `workproof-backup-${fileStamp()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { status: 'done' };
}

function parseBackup(text: string): BackupPayload | null {
  try {
    const parsed = JSON.parse(text) as Partial<BackupPayload>;
    if (parsed?.app !== APP_TAG || typeof parsed.data !== 'object' || parsed.data === null) {
      return null;
    }
    return parsed as BackupPayload;
  } catch {
    return null;
  }
}

export async function restoreBackup(): Promise<RestoreBackupResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    let settled = false;
    const finish = (result: RestoreBackupResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      resolve(result);
    };
    // 파일 다이얼로그를 취소하면 change 이벤트가 안 오므로, 창이 다시 포커스되면
    // 잠시 뒤 파일 선택 여부로 취소를 판단한다.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files?.length) finish({ status: 'cancelled' });
      }, 400);
    };
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        finish({ status: 'cancelled' });
        return;
      }
      try {
        const payload = parseBackup(await file.text());
        if (!payload) {
          finish({ status: 'error', message: 'WorkProof 백업 파일이 아니거나 손상됐어요.' });
          return;
        }
        await importAllData(payload.data);
        finish({ status: 'done' });
      } catch (e) {
        if (e instanceof BackupRestoreError) {
          finish({ status: 'error', message: e.message });
          return;
        }
        finish({ status: 'error', message: '백업 파일을 읽지 못했어요. 다시 시도해주세요.' });
      }
    };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}
