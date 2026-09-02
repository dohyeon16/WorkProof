import { extractTextFromDocument, FILE_UNREADABLE_MESSAGE } from '../../../services/ocr/visionOcr';
import { isUnsupportedOcrMimeType } from '../../../services/ocr/ocrError';
import { summarizeContractText } from '../../../services/ai_summary/geminiSummary';
import { resolveReadableUri } from '../../../services/files/fileStore';
import { SessionExpiredError } from '../../auth/state/session';
import type { AiRemote } from '../../../services/api/aiProxyApi';
import type { EvidenceKind } from '../../../types/domain';
import type { OcrResult } from '../../../services/ocr/ocr.types';

/**
 * 첨부 파일(이미지/PDF) 하나를 OCR → AI 요약까지 처리하는 공용 파이프라인.
 * 근무지 등록 화면과 증빙 보관함이 모두 이 함수 하나만 사용한다.
 *
 * 설계 원칙:
 * - OCR 결과를 React state가 아니라 **로컬 변수**에 담아 그대로 요약에 넘긴다
 *   (state 갱신 타이밍에 의존하지 않음).
 * - OCR은 성공했는데 요약만 실패한 경우 ocrText를 보존해 돌려준다(부분 성공).
 * - 실패 원인을 errorCode로 구분해 호출부가 사용자 문구/후처리를 정할 수 있게 한다.
 */

// 진단용 오류 코드(사용자에겐 짧은 한국어만, 로그에는 이 코드로 구분).
export type AnalyzeErrorCode =
  | 'FILE_NOT_READY'
  | 'AUTH_REQUIRED'
  | 'OCR_NOT_CONFIGURED'
  | 'OCR_UNSUPPORTED_FORMAT'
  | 'OCR_FAILED'
  | 'OCR_EMPTY'
  | 'OCR_RATE_LIMIT'
  | 'OCR_NETWORK_ERROR'
  | 'OCR_SERVER_ERROR'
  | 'SUMMARY_NOT_CONFIGURED'
  | 'GEMINI_NETWORK_ERROR'
  | 'GEMINI_RATE_LIMIT'
  | 'GEMINI_SERVER_ERROR'
  | 'GEMINI_CONFIG_ERROR'
  | 'GEMINI_EMPTY';

export interface AnalyzeEvidenceResult {
  // success=OCR+요약 모두 성공, ocr_only=텍스트는 있으나 요약 없음, error=텍스트도 못 얻음
  status: 'success' | 'ocr_only' | 'error';
  ocrText?: string;
  aiSummary?: string;
  analyzedAt?: string;
  errorCode?: AnalyzeErrorCode;
}

export interface AnalyzeEvidenceInput {
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
  logContext?: { screen: 'WorkplaceForm' | 'Vault'; requestId?: number };
}

/** 저장된 증빙 파일 종류를 Vision이 기대하는 MIME 타입으로 변환한다. */
export function mimeTypeForKind(kind: EvidenceKind, name?: string): string {
  if (kind === 'pdf') return 'application/pdf';
  const lower = (name ?? '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}

/**
 * OCR 실패(ocr.status === 'error')를 상위(화면)가 쓸 AnalyzeErrorCode 로 매핑한다.
 * RN/파일시스템 의존이 없는 순수 함수라 node:test 로 단독 검증 가능하다 — 사진 화질
 * 문제(OCR_EMPTY)와 서버/네트워크 문제(OCR_RATE_LIMIT/OCR_NETWORK_ERROR/OCR_SERVER_ERROR)
 * 를 여기서 갈라야 화면이 서로 다른 문구를 보여줄 수 있다.
 */
export function mapOcrErrorToAnalyzeCode(ocr: Extract<OcrResult, { status: 'error' }>): AnalyzeErrorCode {
  if (ocr.code === 'file_unreadable' || ocr.message === FILE_UNREADABLE_MESSAGE) return 'FILE_NOT_READY';
  switch (ocr.code) {
    case 'empty':
      return 'OCR_EMPTY';
    case 'rate_limit':
      return 'OCR_RATE_LIMIT';
    case 'network':
      return 'OCR_NETWORK_ERROR';
    case 'server_error':
      return 'OCR_SERVER_ERROR';
    default:
      return 'OCR_FAILED';
  }
}

/** URI에서 스킴만 뽑는다(로그용). 파일 내용/키는 절대 로그하지 않는다. */
function schemeOf(uri: string): string {
  const i = uri.indexOf(':');
  return i > 0 ? uri.slice(0, i) : '(none)';
}

/**
 * 파일명에는 성명 등 개인정보가 들어갈 수 있어, 로그에는 원본 대신 확장자와
 * 글자 수만 남긴다(예: "홍길동_근로계약서.pdf" → "masked(len=13,ext=pdf)").
 */
export function maskFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase().slice(0, 8) : 'none';
  return `masked(len=${name.length},ext=${ext})`;
}

function log(event: string, input: AnalyzeEvidenceInput, extra?: Record<string, unknown>) {
  console.log('[analyze]', event, {
    screen: input.logContext?.screen,
    requestId: input.logContext?.requestId,
    file: maskFileName(input.name),
    mimeType: input.mimeType,
    uriScheme: schemeOf(input.uri),
    size: input.size ?? null,
    ...extra,
  });
}

export async function analyzeEvidenceFile(
  remote: AiRemote,
  input: AnalyzeEvidenceInput
): Promise<AnalyzeEvidenceResult> {
  const { name, mimeType, size } = input;
  log('start', input);

  // 0) HEIC/HEIF 는 Vision 이 디코드하지 못하는 형식 — 파일을 읽거나 서버를 호출하기
  // 전에 바로 걸러 정확한 안내로 대체한다(사진 화질 문제로 오해하지 않도록).
  if (isUnsupportedOcrMimeType(mimeType)) {
    log('ocr_unsupported_format', input);
    return { status: 'error', errorCode: 'OCR_UNSUPPORTED_FORMAT' };
  }

  // 1) 파일 준비 확인: 저장된 URI를 읽을 수 있는 형태로 정규화(웹 idb://→data:, 네이티브 file:// 존재 확인).
  const readableUri = await resolveReadableUri(input.uri);
  if (!readableUri) {
    log('file_not_ready', input);
    return { status: 'error', errorCode: 'FILE_NOT_READY' };
  }

  // 2) OCR 실행 (visionOcr 로그에도 마스킹된 파일명만 전달)
  // 인증 만료로 refresh 까지 실패하면 SessionExpiredError → 로그인 필요 상태로 매핑한다
  // (호출부가 로그인 게이팅으로 안내). provider 요청은 이미 일어나지 않았다.
  log('ocr_start', input);
  let ocr: Awaited<ReturnType<typeof extractTextFromDocument>>;
  try {
    ocr = await extractTextFromDocument(remote, readableUri, mimeType, { name: maskFileName(name), size });
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      log('auth_required', input, { stage: 'ocr' });
      return { status: 'error', errorCode: 'AUTH_REQUIRED' };
    }
    throw e;
  }
  if (ocr.status === 'not_configured') {
    log('ocr_not_configured', input);
    return { status: 'error', errorCode: 'OCR_NOT_CONFIGURED' };
  }
  if (ocr.status === 'error') {
    const errorCode = mapOcrErrorToAnalyzeCode(ocr);
    log('ocr_error', input, { errorCode, ocrCode: ocr.code });
    return { status: 'error', errorCode };
  }

  // 3) OCR 결과를 로컬 변수에 보관 (state에 의존하지 않음)
  const extractedText = ocr.text;
  const analyzedAt = new Date().toISOString();
  log('ocr_success', input, { textLength: extractedText.length });

  // 4) 로컬 변수의 텍스트를 그대로 서버 프록시(요약)에 전달.
  // OCR 은 성공했으므로 여기서 SessionExpiredError 가 나면 텍스트는 보존해 돌려준다.
  log('gemini_start', input);
  let summary: Awaited<ReturnType<typeof summarizeContractText>>;
  try {
    summary = await summarizeContractText(remote, extractedText);
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      log('auth_required', input, { stage: 'summary' });
      return { status: 'ocr_only', ocrText: extractedText, analyzedAt, errorCode: 'AUTH_REQUIRED' };
    }
    throw e;
  }
  if (summary.status === 'not_configured') {
    log('gemini_not_configured', input);
    return { status: 'ocr_only', ocrText: extractedText, analyzedAt, errorCode: 'SUMMARY_NOT_CONFIGURED' };
  }
  if (summary.status === 'error') {
    log('gemini_error', input, { errorCode: summary.code });
    return { status: 'ocr_only', ocrText: extractedText, analyzedAt, errorCode: summary.code };
  }

  // 5) 완성된 결과를 한 번에 돌려준다
  log('gemini_success', input);
  return { status: 'success', ocrText: extractedText, aiSummary: summary.summary, analyzedAt };
}
