// 급여에서 빠지는 공제 유형. 세전 예상액에서 세후 실수령액을 어림하는 데 쓴다.
//  - none: 공제 없음(세전 = 세후)
//  - withholding: 사업소득 원천징수 3.3%(단기 알바·프리랜서 형태에서 흔함)
//  - insurance: 4대보험 근로자 부담분 대략 9.4%(정규 근로 형태)
// 구버전 데이터엔 없음 → 'none'으로 취급한다.
export type IncomeDeductionType = 'none' | 'withholding' | 'insurance';

export interface Workplace {
  id: string;
  name: string;
  hourlyWage: number;
  payDay: number; // 1-31
  weeklyAllowance: boolean; // 주휴수당 적용 여부
  fiveOrMoreEmployees?: boolean; // 상시근로자 5인 이상 사업장 여부(연장근로 가산수당 적용 조건, 구버전 데이터엔 없음 → 미적용)
  incomeDeductionType?: IncomeDeductionType; // 세후 실수령액 추정용 공제 유형(구버전 데이터엔 없음 → 'none')
  breakMinutesPerShift: number; // 근무 1건당 기본 차감 휴게시간(분)
  contractPhotoUri?: string; // 근로계약서 사본(사진 또는 PDF, 선택)
  contractFileKind?: EvidenceKind; // 첨부된 사본의 형식
  contractOcrText?: string; // OCR로 추출한 계약서 텍스트(선택, 추출 실패 시 비어있음)
  contractSummary?: string; // 위 텍스트를 AI로 요약·정리한 내용(선택)
  latitude?: number; // 실제 근무지 GPS 위치(선택)
  longitude?: number;
  address?: string; // 역지오코딩으로 얻은 주소(선택, 실패 시 좌표만 저장)
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
  isHoliday?: boolean; // 휴일근로 여부(관공서 공휴일·약정휴일 등). 5인 이상 사업장에서 휴일 가산수당 계산에 쓴다. 구버전 데이터엔 없음 → false
  // 출근/퇴근을 실시간 기록할 때 캡처한 실제 위치(선택). 근무지 좌표와 비교해 '근무지에서
  // 기록됨'을 증빙하는 데 쓴다. 위치 권한이 없거나 수기 입력한 기록엔 비어 있다.
  clockInLatitude?: number;
  clockInLongitude?: number;
  clockOutLatitude?: number;
  clockOutLongitude?: number;
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

// 분석으로 종류가 확인된 증빙 문서. 지금은 근로계약서만 다루지만, 급여명세서 등으로
// 넓힐 수 있도록 유니온으로 열어둔다. 파일명이 아니라 이 값으로 계약서 여부를 판단한다.
export type EvidenceDocumentType = 'employment_contract';

export interface EvidenceFile {
  id: string;
  workplaceId: string;
  name: string;
  uri: string;
  kind: EvidenceKind;
  size: number | null; // bytes
  addedAt: string; // 생성(추가) 시각 = createdAt 역할
  mimeType?: string; // 원본 MIME 타입(OCR 분기·리포트 판별에 사용, 구버전 데이터엔 없음)
  ocrText?: string; // OCR로 추출한 텍스트(이미지/PDF 분석 시, 선택)
  aiSummary?: string; // 위 텍스트를 AI로 요약·정리한 내용(선택)
  documentType?: EvidenceDocumentType; // 분석으로 확인된 문서 종류(일반 증빙은 비어 있음)
  analyzedAt?: string; // 마지막으로 OCR·요약 분석을 실행한 시각(ISO, 선택)
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
