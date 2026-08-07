"""AI 프록시 요청/응답 스키마.

클라이언트가 Google Vision/Gemini 를 직접 호출(=API 키가 앱 번들에 노출)하던 것을
서버 프록시로 옮기기 위한 계약. 서버가 키를 쥐고 대신 호출한다.
"""
from pydantic import BaseModel, Field


class OcrRequest(BaseModel):
    # base64 인코딩한 이미지/PDF 원본. 서버는 이 값을 Vision 으로 그대로 전달한다.
    # 과대 payload(악의적/실수) 방어: base64 약 12M자 ≈ 원본 ~9MB 상한. 초과 시 422.
    content_base64: str = Field(min_length=1, max_length=12_000_000)
    mime_type: str = Field(min_length=1, max_length=100)


class OcrResponse(BaseModel):
    text: str


class SummarizeRequest(BaseModel):
    # OCR 로 추출한 근로계약서/문서 텍스트. 서버가 Gemini 로 요약한다.
    text: str = Field(min_length=1, max_length=20000)


class SummarizeResponse(BaseModel):
    summary: str
