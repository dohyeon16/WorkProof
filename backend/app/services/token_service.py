"""토큰 lifecycle service: access/refresh 발급, refresh rotation, 폐기, 재사용 방어.

refresh rotation 규칙(§2):
- 매 refresh마다 새 refresh 발급 + 기존 것 revoked.
- 같은 rotation 체인은 family_id로 묶는다.
- 이미 폐기된 refresh가 다시 제시되면(재사용/탈취) family 전체를 폐기한다.
- 만료/미존재 refresh는 거부한다.
원문(refresh raw)은 반환만 하고 저장하지 않는다 — DB에는 SHA-256 hash만.
"""
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core import security
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.repositories import refresh_tokens as refresh_repo


class InvalidRefreshTokenError(Exception):
    """미존재/만료/재사용 등 refresh 검증 실패(모두 401로 매핑)."""


@dataclass
class IssuedTokens:
    access_token: str
    refresh_token: str  # 원문 — 응답에만 사용, 저장 금지
    expires_in: int
    user: User


def _ensure_aware(dt: datetime) -> datetime:
    """SQLite 등 tz를 저장하지 않는 방언에서 읽은 naive datetime을 UTC로 간주."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _create_refresh_row(
    db: Session,
    user_id: uuid.UUID,
    family_id: uuid.UUID,
    device_label: str | None,
) -> str:
    """새 refresh 원문을 만들어 hash만 저장하고 원문을 반환한다."""
    raw = security.generate_refresh_token()
    row = RefreshToken(
        user_id=user_id,
        token_hash=security.sha256_hex(raw),
        family_id=family_id,
        expires_at=security.refresh_expiry(),
        device_label=device_label,
    )
    refresh_repo.add(db, row)
    return raw


def issue_token_pair(
    db: Session, user: User, device_label: str | None = None
) -> IssuedTokens:
    """새 로그인/가입/소셜 연결용 토큰 쌍 발급(새 family 시작)."""
    access_token, expires_in = security.create_access_token(str(user.id))
    family_id = uuid.uuid4()
    raw = _create_refresh_row(db, user.id, family_id, device_label)
    return IssuedTokens(
        access_token=access_token,
        refresh_token=raw,
        expires_in=expires_in,
        user=user,
    )


def rotate_refresh_token(
    db: Session, raw_refresh: str, device_label: str | None = None
) -> IssuedTokens:
    """refresh 원문을 검증하고 회전한다.

    - 미존재 → 401
    - 이미 폐기됨(재사용) → family 전체 폐기 후 401
    - 만료 → 401
    - 정상 → 기존 토큰 폐기 + 같은 family로 새 토큰 발급 + 새 access.
    사용자가 비활성/삭제면 401.
    """
    token_hash = security.sha256_hex(raw_refresh)
    row = refresh_repo.get_by_hash(db, token_hash)
    if row is None:
        raise InvalidRefreshTokenError("유효하지 않은 refresh 토큰이에요.")

    # 재사용 탐지: 이미 폐기된 토큰이 다시 제시됨 → family 전체 폐기.
    if row.revoked_at is not None:
        refresh_repo.revoke_family(db, row.family_id)
        raise InvalidRefreshTokenError("유효하지 않은 refresh 토큰이에요.")

    if _ensure_aware(row.expires_at) <= security.utcnow():
        raise InvalidRefreshTokenError("유효하지 않은 refresh 토큰이에요.")

    user = row.user
    if user is None or user.deleted_at is not None or not user.is_active:
        raise InvalidRefreshTokenError("유효하지 않은 refresh 토큰이에요.")

    # 회전: 같은 family로 새 토큰 발급 후 기존 토큰 폐기·연결.
    new_raw = _create_refresh_row(db, user.id, row.family_id, device_label)
    new_row = refresh_repo.get_by_hash(db, security.sha256_hex(new_raw))
    now = security.utcnow()
    row.revoked_at = now
    row.last_used_at = now
    if new_row is not None:
        row.replaced_by_token_id = new_row.id
    db.flush()

    access_token, expires_in = security.create_access_token(str(user.id))
    return IssuedTokens(
        access_token=access_token,
        refresh_token=new_raw,
        expires_in=expires_in,
        user=user,
    )


def revoke_refresh_token(db: Session, raw_refresh: str) -> bool:
    """로그아웃: 제시된 refresh 토큰을 폐기한다.

    미존재해도 조용히 성공 처리(정보 노출/오류 방지). 폐기 수행 여부를 반환.
    """
    row = refresh_repo.get_by_hash(db, security.sha256_hex(raw_refresh))
    if row is None:
        return False
    refresh_repo.revoke(db, row)
    return True
