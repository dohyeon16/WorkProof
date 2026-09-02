"""Google Cloud Vision OCR — 이미지/PDF에서 텍스트를 추출한다.

책임은 여기서 끝난다: 파일 → 텍스트. 추출된 텍스트를 해석·요약·구조화하는 일은
Gemini 를 쓰는 app.services.ai_summary 의 책임이고, 이 모듈은 그쪽을 알지 못한다.
"""
from __future__ import annotations

import httpx

from app.core.config import settings
from app.services.google_provider import (
    AiEmptyResult,
    AiUnsupportedMime,
    AiUpstreamError,
    post_json,
    require_key,
)

# Vision 동기 요청 PDF 최대 페이지(그 이상은 GCS 비동기 배치 필요). 근로계약서/명세서는 이 범위.
MAX_PDF_PAGES = 5


# 허용 MIME — 이미지 또는 PDF만. 그 외는 미지원(415).
def is_supported_mime(mime: str) -> bool:
    return mime == "application/pdf" or mime.startswith("image/")


def ocr_extract(client: httpx.Client, content_base64: str, mime_type: str) -> str:
    """Vision DOCUMENT_TEXT_DETECTION 으로 텍스트를 추출한다."""
    if not is_supported_mime(mime_type):
        raise AiUnsupportedMime()
    key = require_key(settings.GOOGLE_VISION_API_KEY)
    is_pdf = mime_type == "application/pdf"

    if is_pdf:
        url = "https://vision.googleapis.com/v1/files:annotate"
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
        url = "https://vision.googleapis.com/v1/images:annotate"
        payload = {
            "requests": [
                {"image": {"content": content_base64}, "features": [{"type": "DOCUMENT_TEXT_DETECTION"}]}
            ]
        }

    data = post_json(client, url, payload, key)
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
