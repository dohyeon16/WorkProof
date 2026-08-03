"""oauth_accounts 테이블 데이터 접근."""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.oauth_account import OAuthAccount


def get_by_provider_identity(
    db: Session, provider: str, provider_user_id: str
) -> OAuthAccount | None:
    stmt = (
        select(OAuthAccount)
        .where(OAuthAccount.provider == provider)
        .where(OAuthAccount.provider_user_id == provider_user_id)
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()


def list_for_user(db: Session, user_id: uuid.UUID) -> list[OAuthAccount]:
    stmt = select(OAuthAccount).where(OAuthAccount.user_id == user_id)
    return list(db.execute(stmt).scalars().all())


def add(db: Session, account: OAuthAccount) -> OAuthAccount:
    db.add(account)
    db.flush()
    return account
