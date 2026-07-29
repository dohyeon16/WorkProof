const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const MODEL = 'gemini-3.5-flash';

// 모델 사용 불가/429/quota/billing 등 API 오류의 영어 원문은 사용자에게 노출하지
// 않고 console.warn으로만 남긴다. 팝업에는 이 안내 문구만 보여준다.
const USER_FACING_ERROR = 'AI 요약을 완료하지 못했어요. 잠시 후 다시 시도해주세요.';

// 무료 티어 일일/분당 요청 한도를 감안해 계약서 원문이 지나치게 길면 앞부분만
// 보낸다 — 근로계약서는 보통 이 범위 안에서 핵심 조항이 다 나온다.
const MAX_INPUT_CHARS = 12000;

// 일시적 오류(네트워크/429/5xx)는 최대 2번까지만 재시도한다. 재시도 사이에는
// 팝업을 띄우지 않고 콘솔 로그만 남긴다(중복 Alert 방지).
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_AFTER_CAP_MS = 20000; // Retry-After가 비정상적으로 크면 이 값으로 제한

const SYSTEM_PROMPT = `당신은 한국 아르바이트 근로계약서를 분석해주는 도우미입니다.
OCR로 추출된 근로계약서 텍스트가 주어지면, 다음 항목 중 계약서에서 실제로
확인되는 것만 골라 "- 항목: 내용" 형식의 불릿 목록으로 정리하세요:
근무 시작일, 계약기간, 시급/급여, 근무 요일과 시간, 휴게시간, 급여 지급일,
주휴수당 여부, 4대보험 가입 여부, 근무 장소, 그 외 특이 조항.
확인되지 않는 항목은 목록에서 그냥 빼고, 없는 내용을 추측해서 채우지 마세요.
목록 앞에 2~3문장의 짧은 요약을 먼저 쓰고, 목록 뒤에는 아무것도 덧붙이지 마세요.
전체 한국어로, 존댓말로 작성하세요.`;

// 요약 실패 원인 분류. GEMINI_CONFIG_ERROR(400/401/403/모델명/키 등)는 재시도해도
// 소용없으므로 즉시 실패로 처리하고, 나머지는 재시도 대상이다.
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

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry-After 헤더(초 단위 정수 또는 HTTP 날짜)를 ms로 변환. 없거나 파싱 실패 시 null. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(0, date - Date.now()), RETRY_AFTER_CAP_MS);
  }
  return null;
}

function statusToCode(status: number): SummaryErrorCode {
  if (status === 429) return 'GEMINI_RATE_LIMIT';
  if (status >= 500) return 'GEMINI_SERVER_ERROR';
  return 'GEMINI_CONFIG_ERROR'; // 400/401/403/404(모델명) 등 — 재시도 무의미
}

/**
 * OCR로 추출한 텍스트를 Gemini로 요약한다. 일시적 오류는 내부에서 backoff 재시도하며,
 * 재시도 중에는 팝업을 띄우지 않는다. 최종 결과만 호출부에 돌려준다.
 * 키/오류 원문은 로그로만 남기고 사용자에겐 짧은 한국어 문구만 노출한다.
 */
export async function summarizeContractText(text: string): Promise<SummaryResult> {
  if (!API_KEY) return { status: 'not_configured' };

  const trimmed = text.trim();
  if (!trimmed) return { status: 'error', code: 'GEMINI_CONFIG_ERROR', message: '요약할 텍스트가 없어요.' };

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: trimmed.slice(0, MAX_INPUT_CHARS) }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
  });

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
      );

      if (res.ok) {
        const json = (await res.json()) as GenerateContentResponse;
        if (json.error) {
          console.warn('[gemini] 응답 내 error:', json.error?.message ?? '(no message)');
          return { status: 'error', code: 'GEMINI_SERVER_ERROR', message: USER_FACING_ERROR };
        }
        if (json.promptFeedback?.blockReason) {
          return { status: 'error', code: 'GEMINI_EMPTY', message: '안전 정책으로 요약이 차단됐어요.' };
        }
        const summary = json.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? '')
          .join('')
          .trim();
        if (!summary) return { status: 'error', code: 'GEMINI_EMPTY', message: '요약 결과를 받지 못했어요.' };
        return { status: 'success', summary };
      }

      // 실패 응답 — 재시도 여부 판단(원문은 로그로만).
      const status = res.status;
      const errText = await res.text().catch(() => '');
      const retryable = RETRYABLE_STATUS.has(status);
      if (retryable && attempt < MAX_RETRIES) {
        const wait = parseRetryAfterMs(res.headers.get('retry-after')) ?? (attempt + 1) * 1000;
        console.warn(`[gemini] 요약 실패(${status}) 재시도 ${attempt + 1}/${MAX_RETRIES}, ${wait}ms 대기`);
        await sleep(wait);
        continue;
      }
      const code = statusToCode(status);
      console.warn(`[gemini] 요약 최종 실패(${status}) code=${code}:`, errText.slice(0, 200) || '(no body)');
      return { status: 'error', code, message: USER_FACING_ERROR };
    } catch (e) {
      // 네트워크 예외 — 재시도 대상.
      if (attempt < MAX_RETRIES) {
        const wait = (attempt + 1) * 1000;
        console.warn(`[gemini] 네트워크 오류 재시도 ${attempt + 1}/${MAX_RETRIES}, ${wait}ms 대기`);
        await sleep(wait);
        continue;
      }
      console.warn('[gemini] 네트워크 최종 실패:', e instanceof Error ? e.message : String(e));
      return { status: 'error', code: 'GEMINI_NETWORK_ERROR', message: '네트워크 오류로 요약에 실패했어요.' };
    }
  }
}
