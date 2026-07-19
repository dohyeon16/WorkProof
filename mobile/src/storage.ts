import AsyncStorage from '@react-native-async-storage/async-storage';
import { Account, AttendanceRecord, EvidenceFile, PayRecord, Workplace } from './types';

const KEYS = {
  workplaces: '@workproof/workplaces',
  attendance: '@workproof/attendance',
  pay: '@workproof/pay',
  evidence: '@workproof/evidence',
  account: '@workproof/account',
  session: '@workproof/session',
  onboardingDone: '@workproof/onboardingDone',
  activeWorkplaceId: '@workproof/activeWorkplaceId',
};

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

export async function updateEvidenceAnalysis(
  id: string,
  analysis: { ocrText?: string; summary?: string }
): Promise<void> {
  const list = await getAllEvidenceFiles();
  const idx = list.findIndex((f) => f.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...analysis };
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

// 새 계정은 이 기기에 남아있던 이전 근무지/기록/급여 데이터를 이어받지 않고 초기 상태로 시작해야 함
export async function clearAllData(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(KEYS));
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

export async function getActiveOrFirstWorkplace(): Promise<Workplace | undefined> {
  const [activeId, list] = await Promise.all([getActiveWorkplaceId(), getWorkplaces()]);
  if (activeId) {
    const found = list.find((w) => w.id === activeId);
    if (found) return found;
  }
  return list[0];
}
