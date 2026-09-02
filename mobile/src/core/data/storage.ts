import AsyncStorage from '@react-native-async-storage/async-storage';
import { Account, AttendanceChange, AttendanceChangeSource, AttendanceRecord, EvidenceFile, EvidenceDocumentType, EvidenceKind, PayRecord, ScheduledShift, Workplace } from '../domain/models/types';
import { ALL_KEYS, BACKUP_KEYS, KEYS } from './storageKeys';
import { restoreBackupData, type KeyValueStore } from '../backup/restoreData';
import { buildAttendanceChange } from '../../features/attendance/audit/auditTrail';

export function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function readList<T>(key: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T[]) : [];
}

async function writeList<T>(key: string, list: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(list));
}

// ---------- Workplaces ----------

export async function getWorkplaces(): Promise<Workplace[]> {
  return readList<Workplace>(KEYS.workplaces);
}

export async function getWorkplace(id: string): Promise<Workplace | undefined> {
  const list = await getWorkplaces();
  return list.find((w) => w.id === id);
}

export async function saveWorkplace(workplace: Workplace): Promise<void> {
  const list = await getWorkplaces();
  const idx = list.findIndex((w) => w.id === workplace.id);
  if (idx >= 0) {
    list[idx] = workplace;
  } else {
    list.push(workplace);
  }
  await writeList(KEYS.workplaces, list);
}

export async function deleteWorkplace(id: string): Promise<void> {
  const list = await getWorkplaces();
  await writeList(
    KEYS.workplaces,
    list.filter((w) => w.id !== id)
  );
  const attendance = await getAllAttendance();
  await writeList(
    KEYS.attendance,
    attendance.filter((a) => a.workplaceId !== id)
  );
  const pay = await getAllPayRecords();
  await writeList(
    KEYS.pay,
    pay.filter((p) => p.workplaceId !== id)
  );
  const shifts = await getScheduledShifts();
  await writeList(
    KEYS.scheduledShifts,
    shifts.filter((s) => s.workplaceId !== id)
  );
}

// ---------- Attendance ----------

export async function getAllAttendance(): Promise<AttendanceRecord[]> {
  return readList<AttendanceRecord>(KEYS.attendance);
}

export async function getAttendanceByWorkplace(workplaceId: string): Promise<AttendanceRecord[]> {
  const list = await getAllAttendance();
  return list
    .filter((a) => a.workplaceId === workplaceId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getAttendanceByMonth(
  workplaceId: string,
  yearMonth: string
): Promise<AttendanceRecord[]> {
  const list = await getAttendanceByWorkplace(workplaceId);
  return list.filter((a) => a.date.startsWith(yearMonth));
}

export async function getAttendanceRecord(id: string): Promise<AttendanceRecord | undefined> {
  const list = await getAllAttendance();
  return list.find((a) => a.id === id);
}

export async function saveAttendance(record: AttendanceRecord): Promise<void> {
  const list = await getAllAttendance();
  const idx = list.findIndex((a) => a.id === record.id);
  if (idx >= 0) {
    list[idx] = record;
  } else {
    list.push(record);
  }
  await writeList(KEYS.attendance, list);
}

export async function deleteAttendance(id: string): Promise<void> {
  const list = await getAllAttendance();
  await writeList(
    KEYS.attendance,
    list.filter((a) => a.id !== id)
  );
  // 기록이 사라지면 그 기록의 변경 이력도 함께 정리한다(고아 이력 방지).
  const history = await getAllAttendanceHistory();
  const remaining = history.filter((h) => h.recordId !== id);
  if (remaining.length !== history.length) await writeList(KEYS.attendanceHistory, remaining);
}

// ---------- Attendance 변경 이력 (append-only, 로컬 전용) ----------

export async function getAllAttendanceHistory(): Promise<AttendanceChange[]> {
  return readList<AttendanceChange>(KEYS.attendanceHistory);
}

/** 특정 기록의 변경 이력(최신순). */
export async function getAttendanceHistory(recordId: string): Promise<AttendanceChange[]> {
  const list = await getAllAttendanceHistory();
  return list
    .filter((h) => h.recordId === recordId)
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
}

async function appendAttendanceChange(change: AttendanceChange): Promise<void> {
  const list = await getAllAttendanceHistory();
  list.push(change);
  await writeList(KEYS.attendanceHistory, list);
}

/**
 * 사용자 편집(원터치 기록/기록 화면)에서만 쓰는 저장 함수. 이전 상태와 비교해 변경 이력을
 * 먼저 남기고 레코드를 저장한다. sync 가 서버 응답을 반영할 때 쓰는 saveAttendance(위)는
 * 이 경로를 타지 않으므로, 서버발(merge) 변경은 이력에 남지 않는다(사용자 편집만 기록).
 */
export async function saveAttendanceWithHistory(
  next: AttendanceRecord,
  source: AttendanceChangeSource,
  reason?: string
): Promise<void> {
  const before = await getAttendanceRecord(next.id);
  const change = buildAttendanceChange({
    before: before ?? null,
    after: next,
    source,
    at: new Date().toISOString(),
    id: makeId(),
    reason,
  });
  if (change) await appendAttendanceChange(change);
  await saveAttendance(next);
}

// ---------- Pay records ----------

export async function getAllPayRecords(): Promise<PayRecord[]> {
  return readList<PayRecord>(KEYS.pay);
}

export async function getPayRecord(
  workplaceId: string,
  yearMonth: string
): Promise<PayRecord | undefined> {
  const list = await getAllPayRecords();
  return list.find((p) => p.workplaceId === workplaceId && p.yearMonth === yearMonth);
}

export async function savePayRecord(record: PayRecord): Promise<void> {
  const list = await getAllPayRecords();
  const idx = list.findIndex((p) => p.id === record.id);
  if (idx >= 0) {
    list[idx] = record;
  } else {
    list.push(record);
  }
  await writeList(KEYS.pay, list);
}

// ---------- Scheduled shifts (근무 예정) ----------

export async function getScheduledShifts(): Promise<ScheduledShift[]> {
  return readList<ScheduledShift>(KEYS.scheduledShifts);
}

export async function getScheduledShift(id: string): Promise<ScheduledShift | undefined> {
  const list = await getScheduledShifts();
  return list.find((s) => s.id === id);
}

/** 아직 지나지 않은(오늘 이후) 예정 근무를 시작 시각 순으로. */
export async function getUpcomingShifts(): Promise<ScheduledShift[]> {
  const list = await getScheduledShifts();
  const now = new Date();
  return list
    .filter((s) => new Date(`${s.date}T${s.startTime || '00:00'}:00`) >= startOfMinute(now))
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
}

function startOfMinute(d: Date): Date {
  const copy = new Date(d);
  copy.setSeconds(0, 0);
  return copy;
}

export async function saveScheduledShift(shift: ScheduledShift): Promise<void> {
  const list = await getScheduledShifts();
  const idx = list.findIndex((s) => s.id === shift.id);
  if (idx >= 0) list[idx] = shift;
  else list.push(shift);
  await writeList(KEYS.scheduledShifts, list);
}

export async function deleteScheduledShift(id: string): Promise<void> {
  const list = await getScheduledShifts();
  await writeList(
    KEYS.scheduledShifts,
    list.filter((s) => s.id !== id)
  );
}

// ---------- Evidence files ----------

export async function getAllEvidenceFiles(): Promise<EvidenceFile[]> {
  return readList<EvidenceFile>(KEYS.evidence);
}

export async function getEvidenceByWorkplace(workplaceId: string): Promise<EvidenceFile[]> {
  const list = await getAllEvidenceFiles();
  return list
    .filter((f) => f.workplaceId === workplaceId)
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export async function addEvidenceFile(file: EvidenceFile): Promise<void> {
  const list = await getAllEvidenceFiles();
  list.push(file);
  await writeList(KEYS.evidence, list);
}

export async function renameEvidenceFile(id: string, name: string): Promise<void> {
  const list = await getAllEvidenceFiles();
  const idx = list.findIndex((f) => f.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], name };
  await writeList(KEYS.evidence, list);
}

// 특정 증빙 파일에 OCR·AI 요약 결과를 병합해 저장한다. 넘긴 필드만 갱신하므로
// 다른 일반 증빙 파일이나 파일의 기존 메타데이터(이름/uri 등)에는 영향을 주지 않는다.
export async function updateEvidenceAnalysis(
  id: string,
  analysis: {
    ocrText?: string;
    aiSummary?: string;
    documentType?: EvidenceDocumentType;
    analyzedAt?: string;
  }
): Promise<void> {
  const list = await getAllEvidenceFiles();
  const idx = list.findIndex((f) => f.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...analysis };
  await writeList(KEYS.evidence, list);
}

// 근무지 등록 화면에서 첨부·분석한 근로계약서를 증빙 보관함에 등록/갱신한다.
// 같은 근무지에 같은 URI가 이미 있으면 중복 저장하지 않고 그 항목을 갱신한다
// (URI가 중복 판별 기준). 항상 documentType을 'employment_contract'로 표시하므로,
// 일반 증빙·리포트 파일(이 함수를 거치지 않음)에는 영향이 없다.
export async function saveContractEvidence(input: {
  workplaceId: string;
  name: string;
  uri: string;
  kind: EvidenceKind;
  mimeType?: string;
  size?: number | null;
  ocrText?: string;
  aiSummary?: string;
  analyzedAt?: string;
  evidenceId?: string; // 갱신 대상을 URI 대신 ID로 지정하고 싶을 때
}): Promise<void> {
  const list = await getAllEvidenceFiles();
  // URI 또는 evidenceId가 이미 있으면 중복 생성하지 않고 그 항목을 갱신한다.
  const idx = list.findIndex(
    (f) =>
      (input.evidenceId != null && f.id === input.evidenceId) ||
      (f.workplaceId === input.workplaceId && f.uri === input.uri)
  );
  const existing = idx >= 0 ? list[idx] : null;
  const file: EvidenceFile = {
    id: existing?.id ?? makeId(),
    workplaceId: input.workplaceId,
    // 기존 항목이면 사용자가 보관함에서 바꾼 이름을 유지한다.
    name: existing?.name ?? input.name,
    uri: input.uri,
    kind: input.kind,
    mimeType: input.mimeType ?? existing?.mimeType,
    size: input.size ?? existing?.size ?? null,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
    // OCR이 실패했으면 ocrText가 없을 수 있다. 이전에 성공한 값이 있으면 지우지 않는다.
    ocrText: input.ocrText ?? existing?.ocrText,
    aiSummary: input.aiSummary ?? existing?.aiSummary,
    documentType: 'employment_contract',
    analyzedAt: input.analyzedAt ?? existing?.analyzedAt,
  };
  if (existing) list[idx] = file;
  else list.push(file);
  await writeList(KEYS.evidence, list);
}

export async function deleteEvidenceFile(id: string): Promise<void> {
  const list = await getAllEvidenceFiles();
  await writeList(
    KEYS.evidence,
    list.filter((f) => f.id !== id)
  );
}

// ---------- Auth (로컬 전용, 실제 백엔드 없음) ----------

export async function getAccount(): Promise<Account | null> {
  const raw = await AsyncStorage.getItem(KEYS.account);
  return raw ? (JSON.parse(raw) as Account) : null;
}

export async function saveAccount(account: Account): Promise<void> {
  await AsyncStorage.setItem(KEYS.account, JSON.stringify(account));
}

export async function isLoggedIn(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.session)) === 'true';
}

export async function setLoggedIn(value: boolean): Promise<void> {
  if (value) {
    await AsyncStorage.setItem(KEYS.session, 'true');
  } else {
    await AsyncStorage.removeItem(KEYS.session);
  }
}

// 새 계정은 이 기기에 남아있던 이전 근무지/기록/급여 데이터를 이어받지 않고 초기 상태로 시작해야 함.
// 전체 초기화이므로 appLock(기기 보안 설정)도 함께 지운다(ALL_KEYS 포함) — 초기화 후 잠금 없는 상태.
export async function clearAllData(): Promise<void> {
  await AsyncStorage.multiRemove(ALL_KEYS);
}

// ---------- 백업 / 복원 ----------

// 앱이 관리하는 저장 키의 원본 값(JSON 문자열)을 담아 돌려준다. appLock(기기 보안 설정)은
// BACKUP_KEYS에서 제외돼 백업에 실리지 않는다 — 다른 기기 복원 시 잠금이 옮겨가지 않게 한다.
export async function exportAllData(): Promise<Record<string, string>> {
  const entries = await AsyncStorage.multiGet(BACKUP_KEYS);
  const data: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value != null) data[key] = value;
  }
  return data;
}

// AsyncStorage를 복원 로직(restoreData.ts)이 기대하는 KeyValueStore로 감싼다.
const backupStore: KeyValueStore = {
  multiGet: (keys) => AsyncStorage.multiGet(keys),
  multiSet: (pairs) => AsyncStorage.multiSet(pairs),
  multiRemove: (keys) => AsyncStorage.multiRemove(keys),
};

// 백업 파일의 데이터로 기존 데이터를 통째로 교체한다. BACKUP_KEYS(=appLock 제외)만 복원하며,
// 백업에 없던 키는 비운다(부분 복원으로 인한 데이터 불일치 방지). appLock은 복원 대상이 아니므로
// 이 기기의 기존 잠금 설정이 그대로 유지된다(구버전 백업에 appLock이 있어도 무시됨).
// 적용 중 실패하면 스냅샷으로 롤백을 시도한다(원자성에 가까운 처리) — restoreData.ts 참고.
export async function importAllData(data: Record<string, unknown>): Promise<void> {
  await restoreBackupData(backupStore, BACKUP_KEYS, data);
}

// ---------- Onboarding ----------

export async function isOnboardingDone(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.onboardingDone)) === 'true';
}

export async function setOnboardingDone(): Promise<void> {
  await AsyncStorage.setItem(KEYS.onboardingDone, 'true');
}

// ---------- Active workplace ----------

export async function getActiveWorkplaceId(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.activeWorkplaceId);
}

export async function setActiveWorkplaceId(id: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.activeWorkplaceId, id);
}

// ---------- 인앱 알림 읽음 상태 ----------

// 사용자가 이미 확인한 알림 id 목록. 저장 데이터에서 파생되는 알림이라 별도 본문은
// 저장하지 않고, 읽음 처리된 id만 남겨 안 읽은 개수(배지)를 계산한다.
export async function getReadNotificationIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEYS.readNotifications);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const existing = new Set(await getReadNotificationIds());
  for (const id of ids) existing.add(id);
  await AsyncStorage.setItem(KEYS.readNotifications, JSON.stringify([...existing]));
}

// ---------- 앱 잠금 (생체/기기 인증) ----------

export async function getAppLockEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.appLock)) === 'true';
}

export async function setAppLockEnabled(value: boolean): Promise<void> {
  if (value) await AsyncStorage.setItem(KEYS.appLock, 'true');
  else await AsyncStorage.removeItem(KEYS.appLock);
}

export async function getActiveOrFirstWorkplace(): Promise<Workplace | undefined> {
  const [activeId, list] = await Promise.all([getActiveWorkplaceId(), getWorkplaces()]);
  if (activeId) {
    const found = list.find((w) => w.id === activeId);
    if (found) return found;
  }
  return list[0];
}
