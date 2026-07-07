export interface Workplace {
  id: string;
  name: string;
  hourlyWage: number;
  payDay: number; // 1-31
  weeklyAllowance: boolean; // 주휴수당 적용 여부
  breakMinutesPerShift: number; // 근무 1건당 기본 차감 휴게시간(분)
  contractPhotoUri?: string; // 근로계약서 사진(선택)
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  workplaceId: string;
  date: string; // YYYY-MM-DD
  clockIn: string; // HH:mm
  clockOut: string; // HH:mm
  breakMinutes: number;
  note?: string;
}

export type ChecklistStatus = 'risk' | 'ok';

export interface ChecklistItem {
  key: string;
  label: string;
  status: ChecklistStatus;
}

export interface PayRecord {
  id: string;
  workplaceId: string;
  yearMonth: string; // YYYY-MM
  expectedPay: number;
  actualPay: number | null;
  payDate: string | null; // YYYY-MM-DD, 실제 입금일
  memo?: string;
  diff: number | null; // actualPay - expectedPay (음수: 부족, 양수: 초과)
  checklist: ChecklistItem[];
  updatedAt: string;
}

export type EvidenceKind = 'image' | 'pdf' | 'file';

export interface EvidenceFile {
  id: string;
  workplaceId: string;
  name: string;
  uri: string;
  kind: EvidenceKind;
  size: number | null; // bytes
  addedAt: string;
}

export type AuthProvider = 'local' | 'google' | 'kakao' | 'naver';

export interface Account {
  email: string;
  password?: string;
  name: string;
  createdAt: string;
  provider?: AuthProvider;
  providerId?: string;
}

export function buildChecklist(diff: number | null): ChecklistItem[] {
  const isShort = diff !== null && diff < 0;
  const items: { key: string; label: string }[] = [
    { key: 'weeklyAllowance', label: '주휴수당 반영 여부' },
    { key: 'overtime', label: '연장근로수당 반영 여부' },
    { key: 'breakDeduction', label: '휴게시간 차감 여부' },
    { key: 'lateEarlyLeave', label: '지각·조퇴 반영 여부' },
    { key: 'taxDeduction', label: '세금·공제 항목 확인' },
  ];
  const riskKeys = new Set(isShort ? ['weeklyAllowance', 'overtime'] : []);
  return items.map((item) => ({
    ...item,
    status: riskKeys.has(item.key) ? 'risk' : 'ok',
  }));
}
