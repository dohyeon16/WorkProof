// 근로계약서 OCR 텍스트를 AI 로 요약한다 — Phase 4C-2 부터는 Gemini 를 직접 호출하지
// 않고 backend 프록시(POST /ai/summarize)를 통해서만 호출한다. Gemini 키/모델/URL 은
// 서버에만 있고 앱에는 없다. 인증(401→refresh→1회 재시도, 실패 시 SessionExpiredError)과
// 타임아웃/업스트림 재시도는 각각 runAuthorized / 서버가 담당하므로 여기선 하지 않는다.
//
// 키/오류 원문은 로그로만 남기고 사용자에겐 짧은 한국어 문구만 노출한다.
import { ApiError } from '../core/api/errors';
import { SessionExpiredError } from '../features/auth/state/session';
import type { AiRemote } from '../core/api/aiProxyApi';

// 요약 실패 원인 분류(상위 analyzeEvidenceFile 이 사용자 문구/후처리를 정하는 데 쓴다).
export type SummaryErrorCode =
  | 'GEMINI_NETWORK_ERROR'
  | 'GEMINI_RATE_LIMIT'
  | 'GEMINI_SERVER_ERROR'
  | 'GEMINI_CONFIG_ERROR'
  | 'GEMINI_EMPTY';

export type SummaryResult =
  | { status: 'success'; summary: string }
  | { status: 'not_configured' }
  | { status: 'error'; code: SummaryErrorCode; message: string };

// 사용자 노출용 일반 실패 문구(오류 원문은 절대 노출하지 않는다).
const USER_FACING_ERROR = 'AI 요약을 완료하지 못했어요. 잠시 후 다시 시도해주세요.';

// 서버 요약 입력 상한(20000)보다 보수적으로 앞부분만 보낸다 — 근로계약서는 보통 이 범위
// 안에서 핵심 조항이 다 나오고, 지나치게 긴 입력의 422 를 미리 피한다.
const MAX_INPUT_CHARS = 12000;

/** 프록시(/ai/summarize) HTTP 오류를 SummaryResult 로 변환한다(키/원문 미포함). */
function mapSummaryApiError(err: ApiError): SummaryResult {
  const status = err.status;
  // 개발용: 상태만 남긴다(원문/키 없음).
  console.warn(`[gemini] 프록시 요약 실패 kind=${err.kind} status=${status ?? '-'}`);
  if (status === 503) return { status: 'not_configured' }; // 서버에 Gemini 키 미설정
  if (status === 429) {
    return {
      status: 'error',
      code: 'GEMINI_RATE_LIMIT',
      message: err.detail ?? '요청이 많아 잠시 후 다시 시도해주세요.',
    };
  }
  if (status === 422) {
    return { status: 'error', code: 'GEMINI_EMPTY', message: err.detail ?? '요약 결과를 받지 못했어요.' };
  }
  if (err.kind === 'network') {
    return { status: 'error', code: 'GEMINI_NETWORK_ERROR', message: '네트워크 오류로 요약에 실패했어요.' };
  }
  if (err.kind === 'timeout') {
    return { status: 'error', code: 'GEMINI_SERVER_ERROR', message: USER_FACING_ERROR };
  }
  if (status !== undefined && status >= 500) {
    return { status: 'error', code: 'GEMINI_SERVER_ERROR', message: USER_FACING_ERROR };
  }
  // 400/404 등 — 재시도해도 소용없는 요청/구성 문제.
  return { status: 'error', code: 'GEMINI_CONFIG_ERROR', message: USER_FACING_ERROR };
}

/**
 * OCR 로 추출한 텍스트를 서버 프록시로 보내 요약한다.
 * 인증 만료로 refresh 까지 실패하면 SessionExpiredError 를 그대로 던져 상위가 로그인
 * 게이팅으로 변환하게 한다(무한 재시도 없음 — 재시도는 runAuthorized 의 401 1회뿐).
 */
export async function summarizeContractText(remote: AiRemote, text: string): Promise<SummaryResult> {
  const trimmed = text.trim();
  if (!trimmed) return { status: 'error', code: 'GEMINI_CONFIG_ERROR', message: '요약할 텍스트가 없어요.' };

  try {
    const summary = (await remote.summarize(trimmed.slice(0, MAX_INPUT_CHARS))).trim();
    if (!summary) return { status: 'error', code: 'GEMINI_EMPTY', message: '요약 결과를 받지 못했어요.' };
    return { status: 'success', summary };
  } catch (e) {
    if (e instanceof SessionExpiredError) throw e; // 상위(analyzeEvidenceFile)에서 로그인 게이팅으로 변환
    if (e instanceof ApiError) return mapSummaryApiError(e);
    console.warn('[gemini] 알 수 없는 요약 예외:', e instanceof Error ? e.message : String(e));
    return { status: 'error', code: 'GEMINI_NETWORK_ERROR', message: '네트워크 오류로 요약에 실패했어요.' };
  }
}
