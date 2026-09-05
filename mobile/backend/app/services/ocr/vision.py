"""Google Cloud Vision OCR — 이미지/PDF에서 텍스트를 추출한다.

책임은 여기서 끝난다: 파일 → 텍스트. 추출된 텍스트를 해석·요약·구조화하는 일은
Gemini 를 쓰는 app.services.ai_summary 의 책임이고, 이 모듈은 그쪽을 알지 못한다.
"""
from __future__ import annotations

import re

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

_HANGUL_CHAR = re.compile("^[\\uac00-\\ud7a3]$")
_FIELD_LABELS = {
    "\uc131\uba85", "\uc774\ub984", "\uc8fc\ubbfc\ub4f1\ub85d\ubc88\ud638", "\uc8fc\uc18c",
    "\uc804\ud654\ubc88\ud638", "\uc5f0\ub77d\ucc98", "\uadfc\ubb34\uc9c0", "\uc0ac\uc5c5\uc7a5\uba85",
    "\uc0ac\uc5c5\uc8fc", "\uadfc\ub85c\uae30\uac04", "\uc785\uc0ac\uc77c", "\ud1f4\uc0ac\uc77c",
    "\uc9c1\uc885", "\uc9c1\uc704",
}



def normalize_ocr_text(text: str) -> str:
    """Join obvious Korean line fragments and pair known form fields."""
    raw_lines = [line.strip() for line in text.replace("\r\n", "\n").split("\n")]
    lines: list[str] = []
    i = 0
    while i < len(raw_lines):
        line = raw_lines[i]
        if not line:
            if lines and lines[-1] != "":
                lines.append("")
            i += 1
            continue
        if _HANGUL_CHAR.fullmatch(line):
            chars = [line]
            j = i + 1
            while j < len(raw_lines) and _HANGUL_CHAR.fullmatch(raw_lines[j]):
                chars.append(raw_lines[j])
                j += 1
            joined = "".join(chars)
            matched_label = next(
                (label for label in sorted(_FIELD_LABELS, key=len, reverse=True)
                 if joined.startswith(label) and len(joined) > len(label)),
                None,
            )
            if matched_label:
                lines.append(matched_label)
                lines.append(joined[len(matched_label):])
            else:
                lines.append(joined)
            i = j
            continue
        lines.append(line)
        i += 1

    compact: list[str] = []
    for line in lines:
        if not line and (not compact or compact[-1] == ""):
            continue
        compact.append(re.sub(r"[ \t]+", " ", line).strip())

    grouped: list[str] = []
    i = 0
    while i < len(compact):
        line = compact[i]
        if line in _FIELD_LABELS and i + 1 < len(compact):
            value_parts: list[str] = []
            j = i + 1
            while j < len(compact):
                candidate = compact[j]
                if not candidate or candidate in _FIELD_LABELS:
                    break
                if re.fullmatch(r"[\uac00-\ud7a3]+", candidate):
                    value_parts.append(candidate)
                    j += 1
                    continue
                if not value_parts:
                    value_parts.append(candidate)
                    j += 1
                break
            if value_parts:
                grouped.append(f"{line}: {''.join(value_parts)}")
                i = j
                continue
        grouped.append(line)
        i += 1
    return "\n".join(grouped).strip()


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

    text = normalize_ocr_text(text)
    if not text:
        raise AiEmptyResult()
    return text
