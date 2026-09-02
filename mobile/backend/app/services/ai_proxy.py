"""Gemini 요약/구조화 서비스 — OCR 텍스트를 받아 해석한다.

OCR(Vision) 은 app.services.ocr 로 분리돼 있다. 이 모듈은 이미지·파일을 다루지 않고,
이미 추출된 텍스트만 입력으로 받는다.
"""
from __future__ import annotations

import httpx

from app.core.config import settings
from app.services.provider_common import (
    AiEmptyResult,
    AiUpstreamError,
    post_json,
    require_key,
)

# Gemini 입력 상한(무료 티어 고려). 너무 길면 앞부분만.
MAX_INPUT_CHARS = 12000

SUMMARY_SYSTEM_PROMPT = (
    "당신은 한국 아르바이트 근로계약서·급여명세서를 분석해주는 도우미입니다. "
    "OCR로 추출된 텍스트가 주어지면, 실제로 확인되는 항목만 골라 '- 항목: 내용' 형식의 "
    "불릿 목록으로 정리하세요. 확인되지 않는 항목은 빼고, 없는 내용을 추측하지 마세요. "
    "목록 앞에 2~3문장 요약을 먼저 쓰고, 전체 한국어 존댓말로 작성하세요."
)

# 급여명세서 구조화용 시스템 프롬프트. 아래 키만 가진 JSON 객체 하나만 출력하도록 강제하고,
# 값은 원 단위 정수(쉼표·통화기호·공백 없이) 또는 확인 불가 시 null 로 채우게 한다. 개인식별
# 정보(이름/주민번호/계좌번호)와 그 외 키는 넣지 않도록 지시한다 — 추측 금지.
PAYSLIP_SYSTEM_PROMPT = (
    "당신은 한국 급여명세서를 구조화하는 도우미입니다. OCR로 추출된 텍스트가 주어지면 "
    "아래 키만 가진 JSON 객체 하나만 출력하세요. 값은 원 단위 정수(쉼표·통화기호·공백 없이) "
    "이며, 명세서에서 확인되지 않는 값은 null 로 두세요. 없는 값을 추측하지 마세요. "
    "지급 항목: basePay, weeklyAllowance, overtimePay, nightPay, holidayPay, otherAllowance, grossPay. "
    "공제 항목: incomeTax, localIncomeTax, nationalPension, healthInsurance, longTermCareInsurance, "
    "employmentInsurance, otherDeduction, totalDeduction. 결과: netPay. "
    "그 외 키는 절대 넣지 말고, 이름·주민번호·계좌번호 등 개인식별정보도 포함하지 마세요."
)


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
