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


class PayslipExtractRequest(BaseModel):
    # OCR 로 추출한 급여명세서 텍스트. 서버가 Gemini(JSON 모드)로 구조화한다.
    ocr_text: str = Field(min_length=1, max_length=20000)


class PayslipExtractResponse(BaseModel):
    # 모델이 낸 급여명세서 구조화 JSON "원문"(문자열). 서버는 provider 호출/오류 매핑만
    # 담당하고, 실제 파싱·정규화·검증(쉼표/음수/합계 대조 등)은 클라이언트 parser 가 한다
    # — 단일 검증 지점 유지 + 앱 모델에 그대로 저장하지 않기 위함.
    raw: str
