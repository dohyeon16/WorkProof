"""OCR — 이미지/PDF에서 문자를 추출하는 영역(Google Cloud Vision).

AI 분석/요약(app.services.ai_summary)과는 별개의 책임이다. 여기 결과(텍스트)가
그쪽의 입력이 될 뿐, 서로의 내부 구현을 알지 않는다.
"""
from app.services.ocr.vision import MAX_PDF_PAGES, is_supported_mime, ocr_extract

__all__ = ["MAX_PDF_PAGES", "is_supported_mime", "ocr_extract"]
