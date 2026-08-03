"""PostgreSQL 전용 제약조건 검증 (§10 전략 C).

TEST_DATABASE_URL 이 설정된 CI PostgreSQL service 에서만 실행된다. SQLite 로컬
단위 테스트에서는 부분 unique index 가 강제되지 않으므로 skip 한다.
"""
import os

import pytest
from sqlalchemy.exc import IntegrityError

from app.core import security
from app.models.user import User

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="PostgreSQL(TEST_DATABASE_URL) 에서만 실행",
)


def _make_user(email="dup@example.com", deleted=False):
    return User(
        email=email,
        normalized_email=email.lower(),
        name="N",
        password_hash=security.hash_password("password123"),
        primary_provider="email",
        is_active=True,
        deleted_at=security.utcnow() if deleted else None,
    )


def test_partial_unique_blocks_two_active_same_email(db):
    db.add(_make_user())
    db.commit()
    db.add(_make_user())
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_soft_deleted_email_can_be_reused(db):
    # 탈퇴(soft delete)한 사용자와 같은 이메일로 활성 사용자를 다시 만들 수 있다.
    db.add(_make_user(deleted=True))
    db.commit()
    db.add(_make_user(deleted=False))
    db.commit()  # 예외 없이 성공해야 한다.
    assert True
