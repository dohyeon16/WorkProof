"""AI 프록시 API (Phase 4C) — 인증 필수.

클라이언트가 Google Vision/Gemini 를 직접 호출(키 노출)하던 것을 서버가 대신 한다.
키는 서버 환경변수에만 있고, 이 라우터는 인증된 사용자에게만 프록시를 제공한다.
"""
from collections.abc import Iterator

import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.ai import OcrRequest, OcrResponse, SummarizeRequest, SummarizeResponse
from app.services import ai_proxy

router = APIRouter(prefix="/ai", tags=["ai"])

_TIMEOUT = httpx.Timeout(30.0)


def get_http_client() -> Iterator[httpx.Client]:
    """외부 호출용 httpx 클라이언트. 테스트는 dependency_overrides 로 MockTransport 주입."""
    with httpx.Client(timeout=_TIMEOUT) as client:
        yield client


def _to_http_error(e: Exception) -> HTTPException:
    if isinstance(e, ai_proxy.AiNotConfigured):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "AI 기능이 아직 설정되지 않았어요.")
    if isinstance(e, ai_proxy.AiUnsupportedMime):
        return HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "이미지 또는 PDF만 처리할 수 있어요.")
    if isinstance(e, ai_proxy.AiEmptyResult):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "인식된 내용이 없어요. 더 선명한 파일로 다시 시도해주세요.")
    if isinstance(e, ai_proxy.AiTimeout):
        return HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, "처리 시간이 초과됐어요. 잠시 후 다시 시도해주세요.")
    if isinstance(e, ai_proxy.AiUpstreamError):
        if e.upstream_status == 429:
            return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "요청이 많아요. 잠시 후 다시 시도해주세요.")
        return HTTPException(status.HTTP_502_BAD_GATEWAY, "AI 처리에 실패했어요. 잠시 후 다시 시도해주세요.")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "AI 처리에 실패했어요.")


# 프록시가 던지는 매핑 대상 예외들(라우터에서 한 번에 잡아 안전 응답으로 변환).
_AI_ERRORS = (
    ai_proxy.AiNotConfigured,
    ai_proxy.AiUnsupportedMime,
    ai_proxy.AiUpstreamError,
    ai_proxy.AiEmptyResult,
    ai_proxy.AiTimeout,
)


@router.post("/ocr", response_model=OcrResponse)
def ocr(
    body: OcrRequest,
    _user: User = Depends(get_current_user),
    client: httpx.Client = Depends(get_http_client),
) -> OcrResponse:
    try:
        return OcrResponse(text=ai_proxy.ocr_extract(client, body.content_base64, body.mime_type))
    except _AI_ERRORS as e:
        raise _to_http_error(e)


@router.post("/summarize", response_model=SummarizeResponse)
def summarize(
    body: SummarizeRequest,
    _user: User = Depends(get_current_user),
    client: httpx.Client = Depends(get_http_client),
) -> SummarizeResponse:
    try:
        return SummarizeResponse(summary=ai_proxy.summarize_text(client, body.text))
    except _AI_ERRORS as e:
        raise _to_http_error(e)
