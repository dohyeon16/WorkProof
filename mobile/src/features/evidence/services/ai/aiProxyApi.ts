// AI 프록시 API 저장소 — 기존 ApiClient(core/api/client)와 세션의 authorized 실행기를
// 재사용해 인증된 요청으로 backend /api/v1/ai/* 프록시를 호출한다.
//
// 배경(Phase 4C-2): 예전에는 모바일이 EXPO_PUBLIC_* 키로 Google Vision/Gemini 를 직접
// 호출해 키가 앱 번들에 노출됐다. 이제 키는 서버 환경변수에만 두고, 클라이언트는 이
// 프록시(인증 필수)를 통해서만 OCR/요약을 수행한다 — 앱에는 provider 키/URL 이 없다.
//
// 보안: 토큰/바디를 로그로 남기지 않는다(client.ts 가 이미 redaction). Base URL 은
// core/api/config 가 결정(기본 Preview, 운영 빌드는 EXPO_PUBLIC_API_BASE_URL).
import type { ApiClient } from '../../../../core/api/client';

/** 인증 요청 실행기 — session.runAuthorized 를 그대로 주입받는다(single-flight refresh 재사용). */
export type AuthorizedRunner = <T>(run: (accessToken: string) => Promise<T>) => Promise<T>;

export interface AiRemote {
  /** 이미지/PDF 의 base64 를 서버 프록시로 보내 텍스트를 추출한다(POST /ai/ocr). */
  ocr(contentBase64: string, mimeType: string): Promise<string>;
  /** OCR 로 추출한 텍스트를 서버 프록시로 보내 요약을 받는다(POST /ai/summarize). */
  summarize(text: string): Promise<string>;
}

interface OcrResponse {
  text: string;
}
interface SummarizeResponse {
  summary: string;
}

// AI 호출은 외부 provider 까지 왕복하므로 기본 타임아웃(20s)보다 넉넉히 잡는다
// (Render 콜드스타트 + Vision/Gemini 처리). 서버측 httpx 타임아웃은 30s.
const AI_TIMEOUT_MS = 45000;

/**
 * ApiClient + authorized 실행기를 묶어 AiRemote 를 만든다.
 * 인증(401→refresh→1회 재시도, 실패 시 SessionExpiredError)은 authorized 가 담당한다.
 */
export function createAiRemote(client: ApiClient, authorized: AuthorizedRunner): AiRemote {
  return {
    ocr: (contentBase64, mimeType) =>
      authorized((token) =>
        client
          .request<OcrResponse>('/ai/ocr', {
            method: 'POST',
            body: { content_base64: contentBase64, mime_type: mimeType },
            accessToken: token,
            timeoutMs: AI_TIMEOUT_MS,
          })
          .then((r) => r.text)
      ),
    summarize: (text) =>
      authorized((token) =>
        client
          .request<SummarizeResponse>('/ai/summarize', {
            method: 'POST',
            body: { text },
            accessToken: token,
            timeoutMs: AI_TIMEOUT_MS,
          })
          .then((r) => r.summary)
      ),
  };
}
