"""AI 프록시 서비스 — Google Vision(OCR) / Gemini(요약) 서버측 대리 호출.

목적: 기존에 모바일 클라이언트가 EXPO_PUBLIC_* 키로 Google 을 직접 호출하던 구조
(=키가 앱 번들에 노출)를 서버 프록시로 옮긴다. 키는 서버 환경변수(settings)로만
보관하고, 이 계층이 대신 호출한다.

원칙:
 - API 키는 절대 로그/응답에 남기지 않는다.
 - 외부 호출은 주입된 httpx.Client 로 수행한다(테스트에서 MockTransport 로 대체).
 - 키 미설정 → AiNotConfigured(라우터에서 503). 업스트림 오류 → AiUpstreamError.
"""
from __future__ import annotations

import httpx

from app.core.config import settings

# Vision 동기 요청 PDF 최대 페이지(그 이상은 GCS 비동기 배치 필요). 근로계약서/명세서는 이 범위.
MAX_PDF_PAGES = 5
# Gemini 입력 상한(무료 티어 고려). 너무 길면 앞부분만.
MAX_INPUT_CHARS = 12000

SUMMARY_SYSTEM_PROMPT = (
    "당신은 한국 아르바이트 근로계약서·급여명세서를 분석해주는 도우미입니다. "
    "OCR로 추출된 텍스트가 주어지면, 실제로 확인되는 항목만 골라 '- 항목: 내용' 형식의 "
    "불릿 목록으로 정리하세요. 확인되지 않는 항목은 빼고, 없는 내용을 추측하지 마세요. "
    "목록 앞에 2~3문장 요약을 먼저 쓰고, 전체 한국어 존댓말로 작성하세요."
)


class AiNotConfigured(Exception):
    """해당 기능의 API 키가 서버에 설정되지 않음. → 503."""


class AiUpstreamError(Exception):
    """업스트림(Google) 호출 실패. status_code 로 원인 구분(키/원문은 안 담는다)."""

    def __init__(self, upstream_status: int) -> None:
        super().__init__(f"upstream status {upstream_status}")
        self.upstream_status = upstream_status


class AiEmptyResult(Exception):
    """호출은 성공했지만 인식/생성 결과가 비어 있음. → 422(텍스트 없음)."""


def _require(key: str) -> str:
    if not key:
        raise AiNotConfigured()
    return key


def ocr_extract(client: httpx.Client, content_base64: str, mime_type: str) -> str:
    """Vision DOCUMENT_TEXT_DETECTION 으로 텍스트를 추출한다."""
    key = _require(settings.GOOGLE_VISION_API_KEY)
    is_pdf = mime_type == "application/pdf"

    if is_pdf:
        url = f"https://vision.googleapis.com/v1/files:annotate?key={key}"
        payload = {
            "requests": [
                {
                    "inputConfig": {"content": content_base64, "mimeType": "application/pdf"},
                    "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                    "pages": list(range(1, MAX_PDF_PAGES + 1)),
                }
            ]
        }
    else:
        url = f"https://vision.googleapis.com/v1/images:annotate?key={key}"
        payload = {
            "requests": [
                {"image": {"content": content_base64}, "features": [{"type": "DOCUMENT_TEXT_DETECTION"}]}
            ]
        }

    resp = client.post(url, json=payload)
    if resp.status_code != 200:
        raise AiUpstreamError(resp.status_code)
    data = resp.json()
    if data.get("error"):
        raise AiUpstreamError(resp.status_code or 502)
    first = (data.get("responses") or [{}])[0]

    if is_pdf:
        if first.get("error"):
            raise AiUpstreamError(502)
        text = "\n\n".join(
            (p.get("fullTextAnnotation") or {}).get("text", "").strip()
            for p in (first.get("responses") or [])
        ).strip()
    else:
        if first.get("error"):
            raise AiUpstreamError(502)
        text = ((first.get("fullTextAnnotation") or {}).get("text") or "").strip()

    if not text:
        raise AiEmptyResult()
    return text


def summarize_text(client: httpx.Client, text: str) -> str:
    """Gemini generateContent 로 요약한다."""
    key = _require(settings.GEMINI_API_KEY)
    trimmed = text.strip()[:MAX_INPUT_CHARS]
    if not trimmed:
        raise AiEmptyResult()

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.GEMINI_MODEL}:generateContent?key={key}"
    )
    payload = {
        "systemInstruction": {"parts": [{"text": SUMMARY_SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": trimmed}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 800},
    }
    resp = client.post(url, json=payload)
    if resp.status_code != 200:
        raise AiUpstreamError(resp.status_code)
    data = resp.json()
    if data.get("error") or data.get("promptFeedback", {}).get("blockReason"):
        raise AiUpstreamError(502)
    candidates = data.get("candidates") or []
    parts = (candidates[0].get("content", {}).get("parts") if candidates else []) or []
    summary = "".join(p.get("text", "") for p in parts).strip()
    if not summary:
        raise AiEmptyResult()
    return summary
