"""users 테이블 데이터 접근. 커밋/트랜잭션 경계는 service 계층이 관리한다."""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User


def normalize_email(email: str) -> str:
    """중복 판정/조회용 정규화: 앞뒤 공백 제거 + 소문자."""
    return email.strip().lower()


def get_by_id(db: Session, user_id: uuid.UUID) -> User | None:
    return db.get(User, user_id)


def get_active_by_id(db: Session, user_id: uuid.UUID) -> User | None:
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None or not user.is_active:
        return None
    return user


def get_active_by_normalized_email(db: Session, normalized: str) -> User | None:
    """활성(soft-delete 안 된) 사용자 중 정규화 이메일이 일치하는 1건."""
    stmt = (
        select(User)
        .where(User.normalized_email == normalized)
        .where(User.deleted_at.is_(None))
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()


def add(db: Session, user: User) -> User:
    db.add(user)
    db.flush()
    return user
