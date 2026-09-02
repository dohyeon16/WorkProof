"""Expo Go OAuth 브릿지 핵심 로직 (기존 backend/main.py에서 그대로 이전).

provider 설정, OAuth state 서명/검증, authorization code 교환, 프로필 정규화,
폴링 세션 저장을 담당한다. HTTP 라우팅/응답 생성은 api/v1/bridge.py가 맡는다.
동작(경로/응답/파라미터/TTL/서명/추가 authorize 파라미터)은 기존과 100% 동일하다.

Flow:
  1. 앱: POST /auth/session/{provider} (+ return_url) -> {session_id, login_url}
  2. 앱: login_url을 인앱 브라우저로 연다. 사용자가 provider 로그인.
  3. provider: GET /auth/{provider}/callback?code=&state= 로 리다이렉트.
     서버가 state 검증 -> code 교환 -> 프로필 조회 -> 세션에 저장.
  4. 유효한 return_url이 있으면 앱으로 302(민감정보 미포함), 없으면 fallback HTML.
  5. 앱: GET /auth/session/{session_id} 폴링 후 DELETE 로 정리.
"""
import os
import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode, urlparse

import httpx
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import settings
from app.core.logging import get_logger

# 세션 만료 10분 — state 서명 max_age와 폴링 세션 만료 둘 다 이 값을 쓴다.
SESSION_TTL_SECONDS = 10 * 60

# open-redirect 방지: 콜백이 302로 되돌아갈 수 있는 return_url은 앱이 실제로
# 쓰는 정확한 커스텀 스킴 형태만 허용한다(스킴만 보는 느슨한 방식 금지).
#   - dev-client/독립 앱: 정확히 workproof://auth-complete
#   - Expo Go: exp:// 또는 exps:// 이고 경로가 /--/auth-complete로 끝나는 것만
# username/password/fragment가 붙은 URL, 파싱 실패, http/https 등은 전부 거부.
WORKPROOF_RETURN_HOST = "auth-complete"
EXPO_RETURN_PATH_SUFFIX = "/--/auth-complete"

# return_url이 없거나 유효하지 않을 때만 보여주는 최소 fallback HTML 문구.
FALLBACK_RETURN_MESSAGE = "인증이 완료되었습니다. 앱으로 돌아가주세요."


class StateError(Exception):
    """OAuth state 서명/만료 검증 실패. 라우트가 잡아 400 결과 페이지로 변환한다."""


class ProviderExchangeError(Exception):
    """provider 토큰 교환/프로필 조회 실패.

    provider 응답 원문(RFC 문구·WWW-Authenticate·client 자격증명 힌트)을 절대 담지
    않는다. 사용자에게는 앱이 code 로 문구를 만들고, 진단은 서버 로그에만 남긴다.
    """

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


PROVIDERS = {
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v3/userinfo",
        "client_id": settings.GOOGLE_CLIENT_ID.strip(),
        "client_secret": settings.GOOGLE_CLIENT_SECRET.strip(),
        "scope": "openid profile email",
        # 브라우저에 이미 구글 세션이 있으면 계정 선택 없이 곧바로 콜백으로
        # 넘어가 로그인 화면이 "아무것도 안 뜨고" 완료된 것처럼 보인다.
        # select_account를 강제해 회원가입/로그인 모두 항상 계정 선택 화면을 거친다.
        "extra_authorize_params": {"prompt": "select_account"},
    },
    "kakao": {
        "authorize_url": "https://kauth.kakao.com/oauth/authorize",
        "token_url": "https://kauth.kakao.com/oauth/token",
        "userinfo_url": "https://kapi.kakao.com/v2/user/me",
        "client_id": settings.KAKAO_REST_API_KEY.strip(),
        # 카카오 콘솔에서 Client Secret을 켜지 않은 앱도 많아 비어있을 수 있다 —
        # 비어있으면 토큰 교환 요청에서 그냥 생략한다.
        "client_secret": settings.KAKAO_CLIENT_SECRET.strip(),
        "scope": "profile_nickname",
        # 이미 세션/동의 기록이 있어도 매번 로그인 화면을 다시 띄운다.
        "extra_authorize_params": {"prompt": "login"},
    },
    "naver": {
        "authorize_url": "https://nid.naver.com/oauth2.0/authorize",
        "token_url": "https://nid.naver.com/oauth2.0/token",
        "userinfo_url": "https://openapi.naver.com/v1/nid/me",
        "client_id": settings.NAVER_CLIENT_ID.strip(),
        "client_secret": settings.NAVER_CLIENT_SECRET.strip(),
        "scope": "",
        # auth_type=reauthenticate: 로그인 상태와 무관하게 항상 ID/PW 로그인을
        # 다시 요구해 계정을 직접 확인/변경할 수 있게 한다.
        "extra_authorize_params": {"auth_type": "reauthenticate"},
    },
}

# state 파라미터를 session_id + provider로 서명해 발급한다. 별도 매핑 테이블 없이
# 콜백에서 서명만 검증하면 되고(만료 포함), 위조된 state로 남의 세션에 결과를
# 채워 넣는 것도 막는다.
logger = get_logger("workproof.oauth_bridge")

serializer = URLSafeTimedSerializer(settings.SESSION_SIGNING_SECRET, salt="workproof-oauth-state")


@dataclass
class OAuthSession:
    provider: str
    created_at: float
    status: str = "pending"  # pending | success | error
    profile: Optional[dict] = None
    message: Optional[str] = None
    # 세션 생성 시 앱이 넘겨준 복귀 URL. 콜백이 여기로 302한다. 없거나 스킴이
    # 허용 목록에 없으면 fallback HTML을 쓴다(is_valid_return_url로 검증).
    return_url: Optional[str] = None


sessions: dict[str, OAuthSession] = {}


def is_valid_return_url(url: Optional[str]) -> bool:
    if not url:
        return False
    try:
        parsed = urlparse(url)
    except ValueError:
        # 파싱 실패는 안전하게 거부한다.
        return False

    # 자격증명 삽입/프래그먼트 우회 방지: userinfo·fragment가 있으면 거부.
    if parsed.username or parsed.password or parsed.fragment:
        return False

    scheme = parsed.scheme.lower()

    if scheme == "workproof":
        # 정확히 workproof://auth-complete만 허용(여분 경로/쿼리/파라미터 불가).
        return (
            parsed.netloc == WORKPROOF_RETURN_HOST
            and parsed.path in ("", "/")
            and not parsed.query
            and not parsed.params
        )

    if scheme in ("exp", "exps"):
        # exp(s)://<host>/--/auth-complete 형태만 허용(호스트는 런타임 값).
        return parsed.path.endswith(EXPO_RETURN_PATH_SUFFIX)

    return False


def build_app_redirect(return_url: str, oauth_status: str, session_id: str) -> str:
    # 민감정보(액세스 토큰·authorization code·client secret·개인정보)는 절대
    # 붙이지 않는다. 앱은 session_id로 서버를 다시 폴링해 결과를 가져온다.
    query = urlencode({"oauth_status": oauth_status, "session_id": session_id})
    separator = "&" if "?" in return_url else "?"
    return f"{return_url}{separator}{query}"


def get_session(session_id: str) -> Optional[OAuthSession]:
    session = sessions.get(session_id)
    if session is None:
        return None
    if time.time() - session.created_at > SESSION_TTL_SECONDS:
        sessions.pop(session_id, None)
        return None
    return session


def create_session_record(provider: str, return_url: Optional[str]) -> str:
    session_id = os.urandom(32).hex()
    sessions[session_id] = OAuthSession(
        provider=provider, created_at=time.time(), return_url=return_url
    )
    return session_id


def make_state(session_id: str, provider: str) -> str:
    return serializer.dumps({"session_id": session_id, "provider": provider})


def verify_state(state: str, provider: str) -> str:
    try:
        data = serializer.loads(state, max_age=SESSION_TTL_SECONDS)
    except (BadSignature, SignatureExpired):
        raise StateError("state 검증에 실패했어요.")
    if not isinstance(data, dict) or data.get("provider") != provider or not data.get("session_id"):
        raise StateError("state 검증에 실패했어요.")
    return str(data["session_id"])


def build_login_url(provider: str, session_id: str, redirect_uri: str) -> str:
    cfg = PROVIDERS[provider]
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "state": make_state(session_id, provider),
        **cfg["extra_authorize_params"],
    }
    if cfg["scope"]:
        params["scope"] = cfg["scope"]
    return f"{cfg['authorize_url']}?{urlencode(params)}"


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
        if token_res.status_code >= 400:
            # provider 가 돌려준 본문은 사용자에게도, 예외 메시지에도 넣지 않는다.
            # 원인 구분에 필요한 provider 의 error 코드만 로그로 남긴다(값 아님).
            try:
                err_code = str(token_res.json().get("error", ""))[:64]
            except Exception:
                err_code = ""
            logger.error(
                "oauth token exchange failed provider=%s status=%s provider_error=%s "
                "client_secret_sent=%s",
                provider,
                token_res.status_code,
                err_code or "(none)",
                bool(cfg["client_secret"]),
            )
            raise ProviderExchangeError(
                "client_auth" if token_res.status_code in (400, 401) else "provider_unavailable"
            )
        access_token = token_res.json().get("access_token")
        if not access_token:
            logger.error("oauth token exchange returned no access_token provider=%s", provider)
            raise ProviderExchangeError("client_auth")

        user_res = await client.get(
            cfg["userinfo_url"], headers={"Authorization": f"Bearer {access_token}"}
        )
        if user_res.status_code >= 400:
            logger.error(
                "oauth profile fetch failed provider=%s status=%s", provider, user_res.status_code
            )
            raise ProviderExchangeError("profile_unavailable")
        raw_profile = user_res.json()

    return normalize_profile(provider, raw_profile)
