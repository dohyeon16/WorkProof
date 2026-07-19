"""WorkProof Expo Go OAuth Bridge.

Expo Go can't register the app's custom URL scheme or load the
Kakao/Naver native SDKs, so social login can't redirect back into the app
the way the native/dev-client builds do. This service runs the OAuth
authorization-code exchange itself (server-side, with the real client
secrets) and hands the mobile app a normalized profile through a short-lived
polling session instead of a redirect.

Flow:
  1. App calls POST /auth/session/{provider} -> gets {session_id, login_url}.
  2. App opens login_url in an in-app browser; user logs in with the
     provider.
  3. Provider redirects to GET /auth/{provider}/callback?code=...&state=...
     on this server, which exchanges the code, fetches the profile, stores
     it against the session, and shows a "return to the app" page.
  4. App polls GET /auth/session/{session_id} until status is
     success/error, then calls DELETE /auth/session/{session_id}.
"""

import os
import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

load_dotenv()

SESSION_TTL_SECONDS = 10 * 60  # 세션 만료 10분 — state 서명과 폴링 세션 만료 둘 다 이 값을 쓴다.

SESSION_SIGNING_SECRET = os.environ.get("SESSION_SIGNING_SECRET", "")
if not SESSION_SIGNING_SECRET:
    raise RuntimeError(
        "SESSION_SIGNING_SECRET 환경변수가 설정되지 않았어요. backend/.env.example 참고."
    )

FRONTEND_ALLOWED_ORIGIN = os.environ.get("FRONTEND_ALLOWED_ORIGIN", "")

PROVIDERS = {
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v3/userinfo",
        "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
        "scope": "openid profile email",
        # 브라우저에 이미 구글 세션이 있으면 계정 선택 없이 곧바로 콜백으로
        # 넘어가 로그인 화면이 "아무것도 안 뜨고" 완료된 것처럼 보인다.
        # select_account를 강제해 회원가입/로그인 모두 항상 계정 선택 화면을
        # 거치게 한다 (다른 구글 계정으로 바꿀 수도 있게 됨). 매번 동의 화면까지
        # 다시 띄우려면 "consent select_account"로 바꾸면 되지만, 재로그인마다
        # 동의를 다시 받는 건 과해서 계정 선택만 강제한다.
        "extra_authorize_params": {"prompt": "select_account"},
    },
    "kakao": {
        "authorize_url": "https://kauth.kakao.com/oauth/authorize",
        "token_url": "https://kauth.kakao.com/oauth/token",
        "userinfo_url": "https://kapi.kakao.com/v2/user/me",
        "client_id": os.environ.get("KAKAO_REST_API_KEY", ""),
        # 카카오 콘솔에서 Client Secret을 켜지 않은 앱도 많아 비어있을 수 있다 —
        # 비어있으면 토큰 교환 요청에서 그냥 생략한다.
        "client_secret": os.environ.get("KAKAO_CLIENT_SECRET", ""),
        "scope": "profile_nickname",
        # 브라우저에 이미 카카오 세션/동의 기록이 있어도 매번 로그인 화면을
        # 다시 띄운다 (mobile 쪽 웹/네이티브 플로우와 동일한 목적).
        "extra_authorize_params": {"prompt": "login"},
    },
    "naver": {
        "authorize_url": "https://nid.naver.com/oauth2.0/authorize",
        "token_url": "https://nid.naver.com/oauth2.0/token",
        "userinfo_url": "https://openapi.naver.com/v1/nid/me",
        "client_id": os.environ.get("NAVER_CLIENT_ID", ""),
        "client_secret": os.environ.get("NAVER_CLIENT_SECRET", ""),
        "scope": "",
        "extra_authorize_params": {},
    },
}

app = FastAPI(title="WorkProof Auth Bridge")

allowed_origins = [o.strip() for o in FRONTEND_ALLOWED_ORIGIN.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# state 파라미터를 session_id + provider로 서명해서 발급한다. 별도 state ->
# session_id 매핑 테이블 없이 콜백에서 서명만 검증하면 되고(만료도 함께
# 검증됨), 위조된 state로 남의 세션에 결과를 채워 넣는 것도 막을 수 있다.
serializer = URLSafeTimedSerializer(SESSION_SIGNING_SECRET, salt="workproof-oauth-state")


@dataclass
class OAuthSession:
    provider: str
    created_at: float
    status: str = "pending"  # pending | success | error
    profile: Optional[dict] = None
    message: Optional[str] = None


sessions: dict[str, OAuthSession] = {}


def get_session(session_id: str) -> Optional[OAuthSession]:
    session = sessions.get(session_id)
    if session is None:
        return None
    if time.time() - session.created_at > SESSION_TTL_SECONDS:
        sessions.pop(session_id, None)
        return None
    return session


def make_state(session_id: str, provider: str) -> str:
    return serializer.dumps({"session_id": session_id, "provider": provider})


def verify_state(state: str, provider: str) -> str:
    try:
        data = serializer.loads(state, max_age=SESSION_TTL_SECONDS)
    except (BadSignature, SignatureExpired):
        raise HTTPException(400, "state 검증에 실패했어요.")
    if not isinstance(data, dict) or data.get("provider") != provider or not data.get("session_id"):
        raise HTTPException(400, "state 검증에 실패했어요.")
    return str(data["session_id"])


def get_base_url(request: Request) -> str:
    # Render 등 프록시 뒤에서는 request.url.scheme이 내부적으로 http로
    # 찍히는 경우가 있어, 프록시가 붙여주는 헤더를 우선 신뢰한다.
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


def render_result_page(message: str) -> str:
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>WorkProof 로그인</title>
<style>
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0D9488;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    margin: 0;
    padding: 24px;
    box-sizing: border-box;
    text-align: center;
  }}
  p {{ font-size: 18px; line-height: 1.6; max-width: 360px; }}
</style>
</head>
<body>
<p>{message}</p>
</body>
</html>"""


def normalize_profile(provider: str, raw: dict) -> dict:
    if provider == "google":
        return {
            "provider": "google",
            "providerUserId": str(raw.get("sub", "")),
            "name": raw.get("name") or raw.get("email") or "Google 사용자",
            "email": raw.get("email"),
        }
    if provider == "kakao":
        account = raw.get("kakao_account") or {}
        profile = account.get("profile") or {}
        return {
            "provider": "kakao",
            "providerUserId": str(raw.get("id", "")),
            "name": profile.get("nickname") or "카카오 사용자",
            "email": account.get("email"),
        }
    if provider == "naver":
        response = raw.get("response") or {}
        return {
            "provider": "naver",
            "providerUserId": str(response.get("id", "")),
            "name": response.get("name") or response.get("nickname") or "네이버 사용자",
            "email": response.get("email"),
        }
    raise ValueError(f"지원하지 않는 provider입니다: {provider}")


async def exchange_and_fetch_profile(provider: str, code: str, redirect_uri: str) -> dict:
    cfg = PROVIDERS[provider]
    token_data = {
        "grant_type": "authorization_code",
        "client_id": cfg["client_id"],
        "redirect_uri": redirect_uri,
        "code": code,
    }
    if cfg["client_secret"]:
        token_data["client_secret"] = cfg["client_secret"]

    async with httpx.AsyncClient(timeout=10) as client:
        token_res = await client.post(
            cfg["token_url"], data=token_data, headers={"Accept": "application/json"}
        )
        token_res.raise_for_status()
        access_token = token_res.json().get("access_token")
        if not access_token:
            raise RuntimeError("토큰 교환에 실패했어요.")

        user_res = await client.get(
            cfg["userinfo_url"], headers={"Authorization": f"Bearer {access_token}"}
        )
        user_res.raise_for_status()
        raw_profile = user_res.json()

    return normalize_profile(provider, raw_profile)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/auth/session/{provider}")
async def create_session(provider: str, request: Request) -> dict:
    if provider not in PROVIDERS:
        raise HTTPException(404, "지원하지 않는 provider입니다.")
    cfg = PROVIDERS[provider]
    if not cfg["client_id"]:
        raise HTTPException(503, f"{provider} 로그인이 서버에 설정되지 않았어요.")

    session_id = os.urandom(32).hex()
    sessions[session_id] = OAuthSession(provider=provider, created_at=time.time())

    redirect_uri = f"{get_base_url(request)}/auth/{provider}/callback"
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "state": make_state(session_id, provider),
        **cfg["extra_authorize_params"],
    }
    if cfg["scope"]:
        params["scope"] = cfg["scope"]

    login_url = f"{cfg['authorize_url']}?{urlencode(params)}"
    return {"session_id": session_id, "login_url": login_url}


@app.get("/auth/{provider}/callback", response_class=HTMLResponse)
async def oauth_callback(
    provider: str,
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
) -> HTMLResponse:
    if provider not in PROVIDERS:
        return HTMLResponse(render_result_page("잘못된 요청이에요."), status_code=404)
    if not state:
        return HTMLResponse(
            render_result_page("state 값이 없어 로그인을 검증할 수 없어요."), status_code=400
        )

    try:
        session_id = verify_state(state, provider)
    except HTTPException as exc:
        return HTMLResponse(render_result_page(str(exc.detail)), status_code=400)

    session = get_session(session_id)
    if session is None:
        return HTMLResponse(
            render_result_page("세션을 찾을 수 없거나 만료됐어요. WorkProof 앱에서 다시 시도해주세요."),
            status_code=404,
        )

    if error:
        session.status = "error"
        session.message = "로그인이 취소되었거나 실패했어요."
        return HTMLResponse(render_result_page("로그인이 취소됐어요. WorkProof 앱으로 돌아가세요."))

    if not code:
        session.status = "error"
        session.message = "authorization code를 받지 못했어요."
        return HTMLResponse(render_result_page("로그인에 실패했어요. WorkProof 앱으로 돌아가세요."))

    redirect_uri = f"{get_base_url(request)}/auth/{provider}/callback"
    try:
        profile = await exchange_and_fetch_profile(provider, code, redirect_uri)
    except Exception:
        session.status = "error"
        session.message = "로그인 처리 중 오류가 발생했어요."
        return HTMLResponse(render_result_page("로그인에 실패했어요. WorkProof 앱으로 돌아가세요."))

    session.status = "success"
    session.profile = profile
    return HTMLResponse(render_result_page("로그인 완료! WorkProof 앱으로 돌아가세요."))


@app.get("/auth/session/{session_id}")
async def session_status(session_id: str) -> dict:
    session = get_session(session_id)
    if session is None:
        return {"status": "error", "message": "세션을 찾을 수 없거나 만료됐어요."}
    if session.status == "pending":
        return {"status": "pending"}
    if session.status == "success":
        return {"status": "success", "profile": session.profile}
    return {"status": "error", "message": session.message or "로그인에 실패했어요."}


@app.delete("/auth/session/{session_id}")
async def delete_session(session_id: str) -> dict:
    sessions.pop(session_id, None)
    return {"ok": True}
