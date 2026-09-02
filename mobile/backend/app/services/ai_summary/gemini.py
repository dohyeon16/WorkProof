"""Gemini 호출 — 이미 추출된 텍스트를 요약하거나 급여명세서로 구조화한다.

OCR(Vision, app.services.ocr)과는 별개의 책임이다. 이 모듈은 이미지·PDF·MIME 을
다루지 않는다. 입력은 항상 텍스트이며, 그 텍스트가 어디서 왔는지 알지 못한다.
"""
from __future__ import annotations

import httpx

from app.core.config import settings
from app.services.ai_summary.prompts import PAYSLIP_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT
from app.services.provider_common import (
    AiEmptyResult,
    AiUpstreamError,
    post_json,
    require_key,
)

# Gemini 입력 상한(무료 티어 고려). 너무 길면 앞부분만.
MAX_INPUT_CHARS = 12000

def summarize_text(client: httpx.Client, text: str) -> str:
    """Gemini generateContent 로 요약한다."""
    key = require_key(settings.GEMINI_API_KEY)
    trimmed = text.strip()[:MAX_INPUT_CHARS]
    if not trimmed:
        raise AiEmptyResult()

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.GEMINI_MODEL}:generateContent"
    )
    payload = {
        "systemInstruction": {"parts": [{"text": SUMMARY_SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": trimmed}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 800},
    }
    data = post_json(client, url, payload, key)
    if data.get("promptFeedback", {}).get("blockReason"):
        raise AiUpstreamError(502)
    candidates = data.get("candidates") or []
    parts = (candidates[0].get("content", {}).get("parts") if candidates else []) or []
    summary = "".join(p.get("text", "") for p in parts).strip()
    if not summary:
        raise AiEmptyResult()
    return summary


def extract_payslip(client: httpx.Client, ocr_text: str) -> str:
    """급여명세서 OCR 텍스트를 Gemini(JSON 모드)로 구조화한 원문(JSON 문자열)을 돌려준다.

    서버는 provider 호출/오류 매핑만 하고 파싱/검증은 하지 않는다 — 모델이 낸 텍스트를
    그대로(raw) 반환해 클라이언트 parser 가 fence 제거·정규화·합계 대조를 담당하게 한다.
    """
    key = require_key(settings.GEMINI_API_KEY)
    trimmed = ocr_text.strip()[:MAX_INPUT_CHARS]
    if not trimmed:
        raise AiEmptyResult()

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.GEMINI_MODEL}:generateContent"
    )
    payload = {
        "systemInstruction": {"parts": [{"text": PAYSLIP_SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": trimmed}]}],
        # temperature 0 + JSON 응답 강제로 구조화 안정성을 높인다(그래도 클라가 재검증).
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 800,
            "responseMimeType": "application/json",
        },
    }
    data = post_json(client, url, payload, key)
    if data.get("promptFeedback", {}).get("blockReason"):
        raise AiUpstreamError(502)
    candidates = data.get("candidates") or []
    parts = (candidates[0].get("content", {}).get("parts") if candidates else []) or []
    raw = "".join(p.get("text", "") for p in parts).strip()
    if not raw:
        raise AiEmptyResult()
    return raw
