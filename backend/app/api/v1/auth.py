"""인증 API (/api/v1/auth/*).

라우터는 얇게: 요청 파싱 → service 호출 → 도메인 예외를 HTTP 상태로 매핑.
비즈니스 로직/DB/토큰 회전은 service 계층에 있다.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.schemas.auth import (
    AuthLoginRequest,
    AuthRegisterRequest,
    BridgeExchangeRequest,
    LogoutRequest,
    RefreshRequest,
    SocialAuthRequest,
    TokenPairResponse,
)
from app.services import auth_service, social_verify, token_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_pair(tokens: token_service.IssuedTokens) -> TokenPairResponse:
    return TokenPairResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        token_type="bearer",
        expires_in=tokens.expires_in,
        user=tokens.user,
    )


@router.post(
    "/register", response_model=TokenPairResponse, status_code=status.HTTP_201_CREATED
)
def register(req: AuthRegisterRequest, db: Session = Depends(get_db)) -> TokenPairResponse:
    try:
        tokens = auth_service.register(db, req)
    except auth_service.EmailAlreadyRegisteredError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    return _token_pair(tokens)


@router.post("/login", response_model=TokenPairResponse)
def login(req: AuthLoginRequest, db: Session = Depends(get_db)) -> TokenPairResponse:
    try:
        tokens = auth_service.login(db, req)
    except auth_service.InvalidCredentialsError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    return _token_pair(tokens)


@router.post("/social", response_model=TokenPairResponse)
def social(req: SocialAuthRequest, db: Session = Depends(get_db)) -> TokenPairResponse:
    """직접 소셜 로그인. 서버가 credential을 검증한 identity만 허용한다(§6).

    검증기 미등록 provider는 501 — 클라이언트가 보낸 provider_user_id 만으로는
    계정을 만들지 않는다(위조 방지).
    """
    try:
        identity = social_verify.verify_social(req)
    except social_verify.SocialVerificationError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    except social_verify.SocialVerificationUnavailable as exc:
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, str(exc))
    tokens = auth_service.social_login(db, identity, device_label=req.device_label)
    return _token_pair(tokens)


@router.post("/bridge/exchange", response_model=TokenPairResponse)
def bridge_exchange(
    req: BridgeExchangeRequest, db: Session = Depends(get_db)
) -> TokenPairResponse:
    """기존 OAuth 브릿지 success 세션을 서버 JWT로 교환(일회성).

    기존 GET/DELETE /auth/session/{id} 응답 계약은 건드리지 않는다.
    """
    try:
        tokens = auth_service.exchange_bridge_session(
            db, req.bridge_session_id, device_label=req.device_label
        )
    except auth_service.BridgeExchangeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return _token_pair(tokens)


@router.post("/refresh", response_model=TokenPairResponse)
def refresh(req: RefreshRequest, db: Session = Depends(get_db)) -> TokenPairResponse:
    try:
        tokens = token_service.rotate_refresh_token(db, req.refresh_token)
        db.commit()
    except token_service.InvalidRefreshTokenError as exc:
        db.commit()  # 재사용 탐지 시 수행한 family 폐기를 저장한다.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    return _token_pair(tokens)


@router.post("/logout", status_code=status.HTTP_200_OK)
def logout(req: LogoutRequest, db: Session = Depends(get_db)) -> dict:
    """제시된 refresh 토큰을 폐기한다. access 인증 없이도 호출 가능(멱등)."""
    auth_service.logout(db, req.refresh_token)
    return {"ok": True}
