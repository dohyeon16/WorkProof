"""refresh_tokens 테이블 데이터 접근. rotation/폐기 로직은 token_service가 담당."""
import uuid

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.models.refresh_token import RefreshToken


def get_by_hash(db: Session, token_hash: str) -> RefreshToken | None:
    stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash).limit(1)
    return db.execute(stmt).scalar_one_or_none()


def add(db: Session, token: RefreshToken) -> RefreshToken:
    db.add(token)
    db.flush()
    return token


def revoke(db: Session, token: RefreshToken) -> None:
    if token.revoked_at is None:
        token.revoked_at = utcnow()
        db.flush()


def revoke_family(db: Session, family_id: uuid.UUID) -> int:
    """family 내 아직 폐기되지 않은 모든 토큰을 폐기. 폐기 건수를 반환."""
    stmt = (
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id)
        .where(RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    result = db.execute(stmt)
    db.flush()
    return result.rowcount or 0


def revoke_all_for_user(db: Session, user_id: uuid.UUID) -> int:
    stmt = (
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id)
        .where(RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    result = db.execute(stmt)
    db.flush()
    return result.rowcount or 0
