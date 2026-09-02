"""인증 도메인 service: 회원가입/로그인/소셜 연결/브릿지 교환/계정 삭제.

각 작업은 원자적으로 처리한다(성공 시 1회 commit, 실패 시 rollback). 라우터는
얇게 유지하고 DB 쿼리·토큰 회전은 이 계층과 token_service에 둔다.

소셜 계정 정책(보안):
- 소셜로 새로 만든 사용자는 normalized_email 을 설정하지 않는다(NULL). 이메일
  기반 유일성 도메인은 비밀번호 계정 전용이며, 이메일이 같다는 이유로 소셜
  identity를 기존 비밀번호 계정에 자동 연결하지 않는다(계정 탈취 방지).
  이메일은 표시용으로 users.email 에만 보관한다. 검증된 이메일 기반 계정
  연결은 Phase 3 과제.
"""
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import security
from app.models.oauth_account import OAuthAccount
from app.models.user import User
from app.repositories import oauth_accounts as oauth_repo
from app.repositories import refresh_tokens as refresh_repo
from app.repositories import users as users_repo
from app.schemas.auth import AuthLoginRequest, AuthRegisterRequest
from app.services.auth import social_verify
from app.services.auth.oauth_bridge import get_session as get_bridge_session
from app.services.auth.oauth_bridge import sessions as bridge_sessions
from app.services.auth.social_verify import VerifiedSocialIdentity
from app.services.auth.token_service import IssuedTokens, issue_token_pair

# 로그인 실패는 사용자 존재 여부를 구분하지 않도록 항상 동일 메시지를 쓴다(§2).
_UNIFIED_LOGIN_ERROR = "이메일 또는 비밀번호가 올바르지 않아요."

# 타이밍 기반 사용자 열거를 줄이기 위한 더미 해시(최초 사용 시 1회 계산·캐시).
_dummy_hash: str | None = None


class EmailAlreadyRegisteredError(Exception):
    """활성 사용자 중 동일 이메일 존재. → 409."""


class InvalidCredentialsError(Exception):
    """로그인 실패(미존재/오답/비활성/삭제 모두 동일 메시지). → 401."""


class BridgeExchangeError(Exception):
    """브릿지 세션 교환 실패(미존재/만료/미완료/재사용). → 400."""


def _dummy_password_check(password: str) -> None:
    """user가 없을 때도 유사한 시간을 소비해 타이밍 오라클을 줄인다."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = security.hash_password("timing-equalizer-not-a-real-password")
    security.verify_password(password, _dummy_hash)


# ---------------------------------------------------------------------------
# 이메일 회원가입 / 로그인
# ---------------------------------------------------------------------------
def register(db: Session, req: AuthRegisterRequest) -> IssuedTokens:
    normalized = users_repo.normalize_email(str(req.email))
    if users_repo.get_active_by_normalized_email(db, normalized) is not None:
        raise EmailAlreadyRegisteredError("이미 가입된 이메일이에요.")

    user = User(
        email=str(req.email).strip(),
        normalized_email=normalized,
        name=req.name.strip(),
        password_hash=security.hash_password(req.password),
        primary_provider="email",
        is_active=True,
    )
    try:
        users_repo.add(db, user)
        tokens = issue_token_pair(db, user)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # 부분 unique index 경합(동시 가입) → 중복으로 처리.
        raise EmailAlreadyRegisteredError("이미 가입된 이메일이에요.") from exc
    db.refresh(user)
    tokens.user = user
    return tokens


def login(db: Session, req: AuthLoginRequest) -> IssuedTokens:
    normalized = users_repo.normalize_email(str(req.email))
    user = users_repo.get_active_by_normalized_email(db, normalized)
    if user is None:
        _dummy_password_check(req.password)
        raise InvalidCredentialsError(_UNIFIED_LOGIN_ERROR)
    if not user.is_active or user.deleted_at is not None:
        _dummy_password_check(req.password)
        raise InvalidCredentialsError(_UNIFIED_LOGIN_ERROR)
    if not security.verify_password(req.password, user.password_hash):
        raise InvalidCredentialsError(_UNIFIED_LOGIN_ERROR)

    tokens = issue_token_pair(db, user, device_label=req.device_label)
    db.commit()
    db.refresh(user)
    tokens.user = user
    return tokens


# ---------------------------------------------------------------------------
# 소셜 연결(upsert) — 직접 경로와 브릿지 경로가 공유
# ---------------------------------------------------------------------------
def _upsert_social_user(
    db: Session, identity: VerifiedSocialIdentity
) -> User:
    """(provider, provider_user_id)로 기존 사용자를 찾거나 새로 만든다."""
    account = oauth_repo.get_by_provider_identity(
        db, identity.provider, identity.provider_user_id
    )
    if account is not None:
        # 최신 프로필 이메일/이름 반영(표시용). 사용자 계정은 유지.
        account.provider_email = identity.email
        user = account.user
        if user.deleted_at is not None:
            # 탈퇴 계정 재활성화는 이번 범위 밖 — 새 사용자로 취급하지 않고 거부.
            raise BridgeExchangeError("이 소셜 계정은 더 이상 사용할 수 없어요.")
        db.flush()
        return user

    user = User(
        email=identity.email,
        normalized_email=None,  # 소셜 계정은 이메일 유일성 도메인에 포함하지 않음
        name=identity.name,
        password_hash=None,
        primary_provider=identity.provider,
        is_active=True,
    )
    users_repo.add(db, user)
    oauth_repo.add(
        db,
        OAuthAccount(
            user_id=user.id,
            provider=identity.provider,
            provider_user_id=identity.provider_user_id,
            provider_email=identity.email,
        ),
    )
    return user


def social_login(
    db: Session, identity: VerifiedSocialIdentity, device_label: str | None = None
) -> IssuedTokens:
    """서버가 검증한 소셜 identity로 로그인/가입 후 토큰 발급."""
    user = _upsert_social_user(db, identity)
    tokens = issue_token_pair(db, user, device_label=device_label)
    db.commit()
    db.refresh(user)
    tokens.user = user
    return tokens


def exchange_bridge_session(
    db: Session, bridge_session_id: str, device_label: str | None = None
) -> IssuedTokens:
    """기존 OAuth 브릿지의 success 세션을 서버 JWT로 교환한다(일회성).

    - 세션 미존재/만료 → BridgeExchangeError
    - status != success(=pending/error) → BridgeExchangeError
    - 성공: 프로필을 소셜 사용자로 upsert, 토큰 발급, 세션 소비(재교환 방지).
    profile은 서버가 직접 OAuth code 교환으로 받은 값이라 provider_user_id를
    신뢰할 수 있다(§6 — 위조 불가 경로).
    """
    session = get_bridge_session(bridge_session_id)
    if session is None:
        raise BridgeExchangeError("세션을 찾을 수 없거나 만료됐어요.")
    if session.status != "success" or not session.profile:
        raise BridgeExchangeError("아직 완료되지 않은 로그인 세션이에요.")

    profile = session.profile
    identity = VerifiedSocialIdentity(
        provider=str(profile.get("provider") or session.provider),
        provider_user_id=str(profile.get("providerUserId") or ""),
        email=profile.get("email"),
        name=profile.get("name") or "사용자",
    )
    if not identity.provider_user_id:
        raise BridgeExchangeError("프로필 식별자가 없어 교환할 수 없어요.")

    try:
        user = _upsert_social_user(db, identity)
        tokens = issue_token_pair(db, user, device_label=device_label)
        # 일회성: 성공 세션을 소비해 재교환을 막는다.
        bridge_sessions.pop(bridge_session_id, None)
        db.commit()
    except BridgeExchangeError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise BridgeExchangeError("소셜 계정 연결에 실패했어요.") from exc
    db.refresh(user)
    tokens.user = user
    return tokens


# ---------------------------------------------------------------------------
# 계정 관리
# ---------------------------------------------------------------------------
def update_name(db: Session, user: User, name: str) -> User:
    user.name = name.strip()
    db.commit()
    db.refresh(user)
    return user


def delete_account(db: Session, user: User) -> None:
    """soft delete + 전체 refresh 폐기. 이후 access 토큰은 deps에서 차단된다."""
    user.deleted_at = security.utcnow()
    user.is_active = False
    refresh_repo.revoke_all_for_user(db, user.id)
    db.commit()


def logout(db: Session, raw_refresh: str) -> None:
    """제시된 refresh 토큰 폐기(멱등)."""
    from app.services.auth.token_service import revoke_refresh_token

    revoke_refresh_token(db, raw_refresh)
    db.commit()


def get_user_by_id(db: Session, user_id: uuid.UUID) -> User | None:
    return users_repo.get_active_by_id(db, user_id)
