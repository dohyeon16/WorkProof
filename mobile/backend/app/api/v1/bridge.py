"""기존 OAuth 브릿지 HTTP 라우트 (경로/응답 100% 보존).

접두사 없이 등록되어 기존 경로(/health, /auth/*)를 그대로 유지한다. 로직은
services/oauth_bridge.py에 있고, 여기서는 HTTP 요청 파싱과 응답 생성만 한다.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from app.core.logging import get_logger
from app.services import oauth_bridge as svc

logger = get_logger("workproof.bridge")
router = APIRouter()


def _get_base_url(request: Request) -> str:
    # Render 등 프록시 뒤에서는 request.url.scheme이 http로 찍힐 수 있어,
    # 프록시가 붙여주는 헤더를 우선 신뢰한다(기존 동작 유지).
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
    )
    return f"{proto}://{host}"


def _finish_callback(session: svc.OAuthSession, session_id: str, oauth_status: str) -> Response:
    """유효한 return_url이 있으면 앱으로 302, 없으면 fallback HTML(기존 동작)."""
    if svc.is_valid_return_url(session.return_url):
        redirect_url = svc.build_app_redirect(session.return_url, oauth_status, session_id)
        return RedirectResponse(redirect_url, status_code=302)
    return HTMLResponse(svc.render_result_page(svc.FALLBACK_RETURN_MESSAGE))


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.post("/auth/session/{provider}")
async def create_session(provider: str, request: Request) -> dict:
    if provider not in svc.PROVIDERS:
        raise HTTPException(404, "지원하지 않는 provider입니다.")
    cfg = svc.PROVIDERS[provider]
    if not cfg["client_id"]:
        raise HTTPException(503, f"{provider} 로그인이 서버에 설정되지 않았어요.")

    # 앱 복귀 URL(return_url)은 선택 JSON 바디로 받는다. 바디가 없거나 JSON이
    # 아니어도(구버전 클라이언트) 세션 생성은 성공하고, 그 경우 콜백은 fallback
    # HTML을 쓴다. 검증되지 않은 스킴은 저장하지 않아 open redirect를 막는다.
    return_url: Optional[str] = None
    try:
        payload = await request.json()
        if isinstance(payload, dict):
            raw_return = payload.get("return_url")
            if isinstance(raw_return, str) and svc.is_valid_return_url(raw_return.strip()):
                return_url = raw_return.strip()
    except Exception:
        return_url = None

    session_id = svc.create_session_record(provider, return_url)
    redirect_uri = f"{_get_base_url(request)}/auth/{provider}/callback"
    login_url = svc.build_login_url(provider, session_id, redirect_uri)
    return {"session_id": session_id, "login_url": login_url}


@router.get("/auth/{provider}/callback", response_class=HTMLResponse)
async def oauth_callback(
    provider: str,
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
) -> Response:
    if provider not in svc.PROVIDERS:
        return HTMLResponse(svc.render_result_page("잘못된 요청이에요."), status_code=404)
    if not state:
        return HTMLResponse(
            svc.render_result_page("state 값이 없어 로그인을 검증할 수 없어요."), status_code=400
        )

    try:
        session_id = svc.verify_state(state, provider)
    except svc.StateError as exc:
        return HTMLResponse(svc.render_result_page(str(exc)), status_code=400)

    session = svc.get_session(session_id)
    if session is None:
        return HTMLResponse(
            svc.render_result_page("세션을 찾을 수 없거나 만료됐어요. WorkProof 앱에서 다시 시도해주세요."),
            status_code=404,
        )

    if error:
        # provider가 돌려준 원본 오류 코드만 correlation 용으로 남기고(secret 아님),
        # 사용자에게는 최소 상태만 넘긴다.
        logger.warning("oauth callback error param provider=%s", provider)
        session.status = "error"
        session.message = "로그인이 취소되었거나 실패했어요."
        return _finish_callback(session, session_id, "error")

    if not code:
        session.status = "error"
        session.message = "authorization code를 받지 못했어요."
        return _finish_callback(session, session_id, "error")

    redirect_uri = f"{_get_base_url(request)}/auth/{provider}/callback"
    try:
        profile = await svc.exchange_and_fetch_profile(provider, code, redirect_uri)
    except Exception as exc:
        # 토큰·secret이 섞일 수 있는 예외 원문은 남기지 않는다 — provider와 예외
        # 유형만 남긴다(로그에 토큰/secret/코드 노출 금지).
        logger.warning(
            "oauth code exchange/profile fetch failed provider=%s type=%s",
            provider,
            type(exc).__name__,
        )
        session.status = "error"
        session.message = "로그인 처리 중 오류가 발생했어요."
        return _finish_callback(session, session_id, "error")

    session.status = "success"
    session.profile = profile
    return _finish_callback(session, session_id, "success")


@router.get("/auth/session/{session_id}")
async def session_status(session_id: str) -> dict:
    session = svc.get_session(session_id)
    if session is None:
        return {"status": "error", "message": "세션을 찾을 수 없거나 만료됐어요."}
    if session.status == "pending":
        return {"status": "pending"}
    if session.status == "success":
        return {"status": "success", "profile": session.profile}
    return {"status": "error", "message": session.message or "로그인에 실패했어요."}


@router.delete("/auth/session/{session_id}")
async def delete_session(session_id: str) -> dict:
    svc.sessions.pop(session_id, None)
    return {"ok": True}
