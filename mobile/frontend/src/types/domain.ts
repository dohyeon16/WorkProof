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

// 앞으로 예정된 근무. 실제 근무 기록(AttendanceRecord)과 별개로 관리하며, 출근 리마인더의 근거가 된다.
export interface ScheduledShift {
  id: string;
  workplaceId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime?: string; // HH:mm (선택)
  reminderMinutes: number; // 출근 몇 분 전에 알림(0이면 알림 없음)
  createdAt: string;
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

// 분석으로 종류가 확인된 증빙 문서. 파일명이 아니라 이 값으로 문서 종류를 판단한다.
export type EvidenceDocumentType = 'employment_contract' | 'payslip';

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

// ---------- 급여명세서(Payslip) ----------
// 사업주가 발급한 급여명세서를 OCR→구조화해 보관한다. 앱 계산값(expectedPay)이나
// 실제 계좌 입금액(PayRecord.actualPay)과는 다른 '사업주가 명세서에 기재한 값'이다 —
// 세 값을 섞지 않는다(4C-4 비교에서 나란히 대조).

/** 급여명세서 구조화 출처. 'ai'=OCR+AI 추출 기반, 'manual'=사용자가 처음부터 수동 입력. */
export type PayslipExtractionSource = 'ai' | 'manual';

/**
 * 급여명세서 금액(원, 정수). 값 규칙:
 *  - number: 명세서에서 확인된 금액(0 은 '명시적 0원')
 *  - null: 명세서에서 확인되지 않음(미상) — 임의로 0 으로 확정하지 않는다
 * 키는 backend `/ai/extract-payslip` 프롬프트의 키와 일치한다.
 */
export interface PayslipAmounts {
  // 지급 항목
  basePay: number | null; // 기본급
  weeklyAllowance: number | null; // 주휴수당
  overtimePay: number | null; // 연장근로수당
  nightPay: number | null; // 야간근로수당
  holidayPay: number | null; // 휴일근로수당
  otherAllowance: number | null; // 기타 수당
  grossPay: number | null; // 지급 총액(세전)
  // 공제 항목
  incomeTax: number | null; // 소득세
  localIncomeTax: number | null; // 지방소득세
  nationalPension: number | null; // 국민연금
  healthInsurance: number | null; // 건강보험
  longTermCareInsurance: number | null; // 장기요양보험
  employmentInsurance: number | null; // 고용보험
  otherDeduction: number | null; // 기타 공제
  totalDeduction: number | null; // 공제 총액
  // 결과
  netPay: number | null; // 실지급액(사업주 기재)
}

export interface PayslipRecord {
  id: string;
  workplaceId: string;
  yearMonth: string; // YYYY-MM (명세서 귀속 월)
  payDate?: string | null; // YYYY-MM-DD 지급일(선택, 미상 null)
  // 사용자가 확인/수정해 확정한 값(저장/표시/비교의 기준).
  amounts: PayslipAmounts;
  // AI 메타데이터
  extractionSource: PayslipExtractionSource;
  rawOcrText?: string; // OCR 원문(선택; 재확인/수동 보정용). 민감정보라 서버로 보내지 않는다.
  // AI가 원래 추출한 값(사용자 수정 전). 확정값(amounts)과 구분하기 위해 보존한다.
  // extractionSource==='manual' 이거나 구조화 실패 시 null.
  aiExtractedAmounts?: PayslipAmounts | null;
  reviewedByUser: boolean; // 사용자가 확인 화면을 거쳐 확정했는지
  reviewedAt?: string; // 확정 시각(ISO)
  evidenceFileId?: string; // 원본 파일(EvidenceFile) 참조(선택)
  createdAt: string;
  updatedAt: string;
}

// 근무 기록 변경 이력(로컬 전용 · append-only). "법적 증거"가 아니라 사용자가 자기
// 기록을 언제 무엇을 바꿨는지 되짚어 보기 위한 변경 로그다. 서버로 동기화하지 않으며
// (attendance 지문/매핑에 영향 없음), 민감한 GPS 좌표는 이력에 담지 않는다(AUDITED_FIELDS 참고).
export type AttendanceChangeSource = 'clock' | 'manual';
export type AttendanceChangeOp = 'create' | 'update';

export interface AttendanceFieldChange {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

export interface AttendanceChange {
  id: string;
  recordId: string; // 대상 AttendanceRecord.id
  changedAt: string; // ISO
  op: AttendanceChangeOp;
  source: AttendanceChangeSource; // clock=원터치 기록, manual=기록 화면 편집
  changes: AttendanceFieldChange[]; // 바뀐 필드의 before→after(생성 시 초기값)
  reason?: string; // 선택 사유(현재 UI 미노출, 확장 대비)
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
