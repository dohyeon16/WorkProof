"""AI 분석/요약 — Gemini 로 텍스트를 해석하는 영역.

OCR(app.services.ocr)이 만들어낸 텍스트가 이 영역의 입력이 된다. 반대 방향 의존은
없다 — 여기서는 이미지도, MIME 도, Vision 도 다루지 않는다.
"""
from app.services.ai_summary.gemini import MAX_INPUT_CHARS, extract_payslip, summarize_text

__all__ = ["MAX_INPUT_CHARS", "extract_payslip", "summarize_text"]
