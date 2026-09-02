// 급여명세서 파일(이미지/PDF) → OCR → 구조화까지의 공용 파이프라인(RN 결합: 파일 읽기).
//
// 4C-2 OCR(extractTextFromDocument)과 4C-3 구조화(structurePayslipText)를 조합한다.
// OCR 실패와 구조화 실패를 다른 상태로 구분한다:
//  - status 'error'   : OCR 조차 못함(파일/권한/OCR) → 재시도 안내
//  - status 'ocr_only': OCR 성공, 구조화 실패 → OCR 텍스트 보존 + 수동 입력 유도
//  - status 'extracted': OCR+구조화 성공 → 사용자 확인 화면으로
import { resolveReadableUri } from '../../../shared/utils/fileStore';
import { SessionExpiredError } from '../../auth/state/session';
import { extractTextFromDocument } from '../../../ocr/visionOcr';
import { maskFileName } from '../../evidence/services/ai/analyzeContract';
import type { AiRemote } from '../../evidence/services/ai/aiProxyApi';
import type { PayslipAmounts } from '../../../core/domain/models/types';
import type { PayslipWarning } from './payslipExtraction';
import { structurePayslipText, type PayslipExtractErrorCode } from './payslipStructuring';

export type PayslipAnalyzeErrorCode =
  | 'FILE_NOT_READY'
  | 'AUTH_REQUIRED'
  | 'OCR_NOT_CONFIGURED'
  | 'OCR_FAILED'
  | 'OCR_EMPTY'
  | PayslipExtractErrorCode;

export interface PayslipAnalyzeResult {
  status: 'extracted' | 'ocr_only' | 'error';
  ocrText?: string;
  amounts?: PayslipAmounts; // status==='extracted' 일 때만
  warnings?: PayslipWarning[];
  errorCode?: PayslipAnalyzeErrorCode;
}

export interface PayslipAnalyzeInput {
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
}

/**
 * 파일 한 개를 OCR→구조화한다. 새 OCR/AI provider 요청이므로 호출부는 먼저 로그인
 * 게이트(useAiAnalysis.ensureCanAnalyze)를 통과시킨 뒤 이 함수를 부른다.
 */
export async function analyzePayslipFile(
  remote: AiRemote,
  input: PayslipAnalyzeInput
): Promise<PayslipAnalyzeResult> {
  const readableUri = await resolveReadableUri(input.uri);
  if (!readableUri) return { status: 'error', errorCode: 'FILE_NOT_READY' };

  // 1) OCR (파일 로그엔 마스킹된 이름/크기만, 텍스트 원문은 남기지 않는다)
  let ocr: Awaited<ReturnType<typeof extractTextFromDocument>>;
  try {
    ocr = await extractTextFromDocument(remote, readableUri, input.mimeType, {
      name: maskFileName(input.name),
      size: input.size,
    });
  } catch (e) {
    if (e instanceof SessionExpiredError) return { status: 'error', errorCode: 'AUTH_REQUIRED' };
    throw e;
  }
  if (ocr.status === 'not_configured') return { status: 'error', errorCode: 'OCR_NOT_CONFIGURED' };
  if (ocr.status === 'error') {
    return { status: 'error', errorCode: ocr.code === 'empty' ? 'OCR_EMPTY' : 'OCR_FAILED' };
  }

  const ocrText = ocr.text;

  // 2) 구조화 — 실패해도 OCR 텍스트는 보존해 수동 입력으로 이어가게 한다.
  let outcome: Awaited<ReturnType<typeof structurePayslipText>>;
  try {
    outcome = await structurePayslipText(remote, ocrText);
  } catch (e) {
    if (e instanceof SessionExpiredError) return { status: 'ocr_only', ocrText, errorCode: 'AUTH_REQUIRED' };
    throw e;
  }
  if (outcome.status === 'failed') return { status: 'ocr_only', ocrText, errorCode: outcome.code };

  return { status: 'extracted', ocrText, amounts: outcome.amounts, warnings: outcome.warnings };
}
