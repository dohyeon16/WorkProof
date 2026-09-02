// AI 프록시 API 저장소 — 기존 ApiClient(core/api/client)와 세션의 authorized 실행기를
// 재사용해 인증된 요청으로 backend /api/v1/ai/* 프록시를 호출한다.
//
// 배경(Phase 4C-2): 예전에는 모바일이 EXPO_PUBLIC_* 키로 Google Vision/Gemini 를 직접
// 호출해 키가 앱 번들에 노출됐다. 이제 키는 서버 환경변수에만 두고, 클라이언트는 이
// 프록시(인증 필수)를 통해서만 OCR/요약을 수행한다 — 앱에는 provider 키/URL 이 없다.
//
// 보안: 토큰/바디를 로그로 남기지 않는다(client.ts 가 이미 redaction). Base URL 은
// core/api/config 가 결정(기본 Preview, 운영 빌드는 EXPO_PUBLIC_API_BASE_URL).
import type { ApiClient } from './client';

/** 인증 요청 실행기 — session.runAuthorized 를 그대로 주입받는다(single-flight refresh 재사용). */
export type AuthorizedRunner = <T>(run: (accessToken: string) => Promise<T>) => Promise<T>;

export interface AiRemote {
  /** 이미지/PDF 의 base64 를 서버 프록시로 보내 텍스트를 추출한다(POST /ai/ocr). */
  ocr(contentBase64: string, mimeType: string): Promise<string>;
  /** OCR 로 추출한 텍스트를 서버 프록시로 보내 요약을 받는다(POST /ai/summarize). */
  summarize(text: string): Promise<string>;
  /**
   * 급여명세서 OCR 텍스트를 서버 프록시로 보내 구조화 JSON "원문"을 받는다
   * (POST /ai/extract-payslip). 파싱/정규화/검증은 클라이언트 parser 가 한다.
   */
  extractPayslip(ocrText: string): Promise<string>;
}

interface OcrResponse {
  text: string;
}
interface SummarizeResponse {
  summary: string;
}
interface PayslipExtractResponse {
  raw: string;
}

// AI 호출은 외부 provider 까지 왕복하므로 기본 타임아웃(20s)보다 넉넉히 잡는다
// (Render 콜드스타트 + Vision/Gemini 처리). 서버측 httpx 타임아웃은 30s.
//
// 45s 로는 부족했다: Render free tier 는 유휴 15분 후 슬립하고, 실측 콜드스타트가
// 약 53s 걸렸다(2026-08-30 Preview 실측). 슬립 직후 첫 요청이 서버가 깨어나기도 전에
// 클라이언트에서 먼저 타임아웃돼 "텍스트 추출 실패"로 잘못 보이는 게 실기기 Issue 1의
// 원인 중 하나였다 — 정상 사진도 서버가 자고 있으면 실패로 보였다.
const AI_TIMEOUT_MS = 75000;

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
    extractPayslip: (ocrText) =>
      authorized((token) =>
        client
          .request<PayslipExtractResponse>('/ai/extract-payslip', {
            method: 'POST',
            body: { ocr_text: ocrText },
            accessToken: token,
            timeoutMs: AI_TIMEOUT_MS,
          })
          .then((r) => r.raw)
      ),
  };
}
