import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { exportAllData, importAllData } from './storage';

// 백업 파일 포맷: 앱이 관리하는 AsyncStorage 값(JSON 문자열)을 그대로 담는다.
// 증빙 파일 원본(계약서 사진/PDF)은 기기 로컬 파일이라 이 JSON에는 포함되지 않는다.
const APP_TAG = 'WorkProof';
const BACKUP_VERSION = 1;

export interface BackupPayload {
  app: typeof APP_TAG;
  version: number;
  exportedAt: string;
  data: Record<string, string>;
}

export type CreateBackupResult = { status: 'done' } | { status: 'unavailable' };
export type RestoreBackupResult =
  | { status: 'done' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildPayload(data: Record<string, string>): string {
  const payload: BackupPayload = {
    app: APP_TAG,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
  return JSON.stringify(payload, null, 2);
}

/** 백업 JSON을 만들어 공유 시트로 내보낸다(파일 앱/메일/드라이브 등으로 저장). */
export async function createBackup(): Promise<CreateBackupResult> {
  const data = await exportAllData();
  const json = buildPayload(data);

  const file = new File(Paths.cache, `workproof-backup-${fileStamp()}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(json);

  if (!(await Sharing.isAvailableAsync())) return { status: 'unavailable' };
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'WorkProof 백업 내보내기',
    UTI: 'public.json',
  });
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

/** 백업 파일을 골라 기존 데이터를 덮어쓴다. 성공 시 앱을 재기동(Splash)해야 반영된다. */
export async function restoreBackup(): Promise<RestoreBackupResult> {
  // JSON MIME이 기기마다 제각각(application/json·octet-stream 등)이라 넉넉히 열고 내용으로 검증한다.
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'application/octet-stream', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return { status: 'cancelled' };

  try {
    const text = await new File(result.assets[0].uri).text();
    const payload = parseBackup(text);
    if (!payload) {
      return { status: 'error', message: 'WorkProof 백업 파일이 아니거나 손상됐어요.' };
    }
    await importAllData(payload.data);
    return { status: 'done' };
  } catch {
    return { status: 'error', message: '백업 파일을 읽지 못했어요. 다시 시도해주세요.' };
  }
}
