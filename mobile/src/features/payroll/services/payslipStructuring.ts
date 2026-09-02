// OCR 텍스트 → 급여명세서 구조화(순수 — 파일시스템 의존 없음, node:test 대상).
//
// 책임 분리(Phase 4C-3): OCR(파일→텍스트)과 "구조화(텍스트→항목)"를 분리한다. 이 모듈은
// 텍스트를 받아 backend `/ai/extract-payslip` 를 호출하고 클라이언트 parser 로 검증한다.
// 구조화 실패(쿼터/미설정/malformed)는 OCR 실패와 다르게 취급한다 — 상위에서 OCR 텍스트를
// 보여주고 수동 입력으로 이어가게 하기 위해 'failed'(코드 포함)만 돌려준다.
import { ApiError } from '../../../core/api/errors';
import { SessionExpiredError } from '../../auth/state/session';
import type { AiRemote } from '../../evidence/services/ai/aiProxyApi';
import type { PayslipAmounts } from '../../../core/domain/models/types';
import { parsePayslipRaw, type PayslipWarning } from './payslipExtraction';

export type PayslipExtractErrorCode =
  | 'EXTRACT_UNAVAILABLE' // 쿼터/크레딧 소진 등으로 지금은 자동 분석 불가(429) → 수동 입력 유도
  | 'EXTRACT_NOT_CONFIGURED' // 서버에 Gemini 키 미설정(503)
  | 'EXTRACT_FAILED'; // 그 외(파싱 불가/5xx/네트워크 등)

export type PayslipStructureOutcome =
  | { status: 'extracted'; amounts: PayslipAmounts; warnings: PayslipWarning[] }
  | { status: 'failed'; code: PayslipExtractErrorCode };

/** 구조화 프록시 오류를 사용자 대응 코드로 매핑(원문/키 미포함). */
export function mapExtractApiError(err: ApiError): PayslipExtractErrorCode {
  const status = err.status;
  if (status === 503) return 'EXTRACT_NOT_CONFIGURED';
  if (status === 429) return 'EXTRACT_UNAVAILABLE'; // Gemini 쿼터/크레딧 → graceful degradation
  return 'EXTRACT_FAILED';
}

/**
 * OCR 텍스트를 구조화한다. 인증 만료(refresh 실패)는 SessionExpiredError 로 그대로 던져
 * 상위가 로그인 게이트로 변환하게 한다. 그 외 실패는 'failed'(코드)로 돌려준다 —
 * OCR 텍스트가 이미 있으므로 앱은 막히지 않고 수동 입력으로 이어갈 수 있다.
 */
export async function structurePayslipText(
  remote: AiRemote,
  ocrText: string
): Promise<PayslipStructureOutcome> {
  let raw: string;
  try {
    raw = await remote.extractPayslip(ocrText);
  } catch (e) {
    if (e instanceof SessionExpiredError) throw e; // 상위(analyzePayslipFile)에서 AUTH_REQUIRED 처리
    if (e instanceof ApiError) return { status: 'failed', code: mapExtractApiError(e) };
    return { status: 'failed', code: 'EXTRACT_FAILED' };
  }

  const parsed = parsePayslipRaw(raw);
  if (parsed.status === 'unparseable') {
    // 모델이 JSON 을 못 냈거나 형식이 깨짐 → 자동 분석 실패로 보고 수동 입력 유도.
    return { status: 'failed', code: 'EXTRACT_FAILED' };
  }
  return { status: 'extracted', amounts: parsed.amounts, warnings: parsed.warnings };
}
