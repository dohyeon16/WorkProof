const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const MODEL = 'gemini-3.5-flash';

// 모델 사용 불가/429/quota/billing 등 API 오류의 영어 원문은 사용자에게 노출하지
// 않고 console.warn으로만 남긴다. 팝업에는 이 안내 문구만 보여준다.
const USER_FACING_ERROR = 'AI 요약을 완료하지 못했어요. 잠시 후 다시 시도해주세요.';

// 무료 티어 일일/분당 요청 한도를 감안해 계약서 원문이 지나치게 길면 앞부분만
// 보낸다 — 근로계약서는 보통 이 범위 안에서 핵심 조항이 다 나온다.
const MAX_INPUT_CHARS = 12000;

const SYSTEM_PROMPT = `당신은 한국 아르바이트 근로계약서를 분석해주는 도우미입니다.
OCR로 추출된 근로계약서 텍스트가 주어지면, 다음 항목 중 계약서에서 실제로
확인되는 것만 골라 "- 항목: 내용" 형식의 불릿 목록으로 정리하세요:
근무 시작일, 계약기간, 시급/급여, 근무 요일과 시간, 휴게시간, 급여 지급일,
주휴수당 여부, 4대보험 가입 여부, 근무 장소, 그 외 특이 조항.
확인되지 않는 항목은 목록에서 그냥 빼고, 없는 내용을 추측해서 채우지 마세요.
목록 앞에 2~3문장의 짧은 요약을 먼저 쓰고, 목록 뒤에는 아무것도 덧붙이지 마세요.
전체 한국어로, 존댓말로 작성하세요.`;

export type SummaryResult =
  | { status: 'success'; summary: string }
  | { status: 'not_configured' }
  | { status: 'error'; message: string };

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export async function summarizeContractText(text: string): Promise<SummaryResult> {
  if (!API_KEY) return { status: 'not_configured' };

  const trimmed = text.trim();
  if (!trimmed) return { status: 'error', message: '요약할 텍스트가 없어요.' };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: trimmed.slice(0, MAX_INPUT_CHARS) }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
        }),
      }
    );
    const json = (await res.json()) as GenerateContentResponse;
    if (!res.ok || json.error) {
      // 원문(모델 사용 불가/quota/billing 등)은 로그로만 남기고 사용자에겐 일반 문구.
      console.warn(`Gemini 요약 실패 (${res.status}):`, json.error?.message ?? '(no message)');
      return { status: 'error', message: USER_FACING_ERROR };
    }
    if (json.promptFeedback?.blockReason) {
      return { status: 'error', message: '안전 정책으로 요약이 차단됐어요.' };
    }
    const summary = json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!summary) return { status: 'error', message: '요약 결과를 받지 못했어요.' };
    return { status: 'success', summary };
  } catch {
    return { status: 'error', message: '네트워크 오류로 요약에 실패했어요.' };
  }
}
