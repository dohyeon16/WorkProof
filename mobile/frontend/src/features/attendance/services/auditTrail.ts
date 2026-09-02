// 근무 기록 변경 이력 계산 — 순수 로직(RN/저장소/fetch 의존 없음, node:test 대상).
//
// 설계 근거:
//  - AttendanceRecord 를 덮어쓰는 기존 저장 구조(saveAttendance upsert)는 그대로 두고,
//    "무엇이 어떻게 바뀌었는가"만 별도 append-only 로그로 남긴다(레코드 통째 스냅샷 X).
//    → 서버 동기화 대상 필드/지문(attendanceFingerprint)에 영향이 없어 sync 회귀가 없다.
//  - GPS 좌표(clockIn/Out Latitude·Longitude)는 이력에 담지 않는다: 사용자가 편집하는 값이
//    아니라 기록 시점에 캡처되는 민감정보라, 이력에 중복 저장할 필요가 없다.
import type {
  AttendanceChange,
  AttendanceChangeSource,
  AttendanceFieldChange,
  AttendanceRecord,
} from '../../../types/domain';

// 이력으로 추적하는 "사용자 편집 가능" 필드. 좌표는 의도적으로 제외한다.
export const AUDITED_FIELDS = [
  'date',
  'clockIn',
  'clockOut',
  'breakMinutes',
  'note',
  'isHoliday',
] as const;

export type AuditedField = (typeof AUDITED_FIELDS)[number];

// 비교용 정규화: undefined/누락을 각 필드의 기본값으로 맞춰 "빈 값 ↔ 미설정"을 같게 본다.
function normalize(field: AuditedField, value: unknown): string | number | boolean {
  switch (field) {
    case 'note':
      return (value as string | undefined) ?? '';
    case 'clockOut':
      return (value as string | undefined) ?? ''; // '' = 진행 중(퇴근 전)
    case 'isHoliday':
      return Boolean(value);
    case 'breakMinutes':
      return typeof value === 'number' ? value : 0;
    default:
      return (value as string | undefined) ?? '';
  }
}

// 저장용 원시값: undefined 는 null 로 고정(JSON 왕복·비교 안정).
function raw(value: unknown): string | number | boolean | null {
  return value === undefined ? null : (value as string | number | boolean);
}

/** 두 기록의 감사 대상 필드 차이(before→after). 변경 없으면 빈 배열. */
export function diffAttendance(
  before: AttendanceRecord,
  after: AttendanceRecord
): AttendanceFieldChange[] {
  const out: AttendanceFieldChange[] = [];
  for (const field of AUDITED_FIELDS) {
    if (normalize(field, before[field]) !== normalize(field, after[field])) {
      out.push({ field, before: raw(before[field]), after: raw(after[field]) });
    }
  }
  return out;
}

export interface BuildChangeInput {
  before: AttendanceRecord | null; // null 이면 최초 생성
  after: AttendanceRecord;
  source: AttendanceChangeSource;
  at: string; // ISO
  id: string; // 이력 항목 id(호출부에서 makeId 로 생성)
  reason?: string;
}

/**
 * 변경 이력 1건을 만든다.
 *  - 생성(before=null): op='create', 초기값을 after 로 기록(before=null) — "최초 기록" 기준선.
 *  - 수정(before!=null): 바뀐 필드만 기록. 바뀐 게 없으면 null 을 돌려준다(로그 안 남김).
 */
export function buildAttendanceChange(input: BuildChangeInput): AttendanceChange | null {
  const { before, after, source, at, id, reason } = input;
  if (before) {
    const changes = diffAttendance(before, after);
    if (changes.length === 0) return null;
    return withReason({ id, recordId: after.id, changedAt: at, op: 'update', source, changes }, reason);
  }
  const changes: AttendanceFieldChange[] = AUDITED_FIELDS.map((field) => ({
    field,
    before: null,
    after: raw(after[field]),
  }));
  return withReason({ id, recordId: after.id, changedAt: at, op: 'create', source, changes }, reason);
}

function withReason(change: AttendanceChange, reason?: string): AttendanceChange {
  return reason && reason.trim() ? { ...change, reason: reason.trim() } : change;
}

// 필드 키 → 한글 라벨(이력 UI 표기용).
export const FIELD_LABELS: Record<AuditedField, string> = {
  date: '날짜',
  clockIn: '출근',
  clockOut: '퇴근',
  breakMinutes: '휴게(분)',
  note: '메모',
  isHoliday: '휴일근로',
};

/** 이력 UI 표기용 값 포맷(빈 퇴근='(없음)', 불리언='예/아니오'). */
export function formatChangeValue(field: string, value: string | number | boolean | null): string {
  if (value === null || value === '') return field === 'clockOut' ? '(미퇴근)' : '(없음)';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return String(value);
}
