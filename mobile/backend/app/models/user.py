"""User ORM 모델.

이메일 회원가입 사용자와 소셜 로그인 사용자를 하나의 users 테이블로 표현한다.
- 이메일 사용자: email/normalized_email/password_hash 존재, primary_provider="email"
- 소셜 사용자: email nullable, password_hash NULL 가능, primary_provider="google" 등

soft delete(deleted_at)를 쓰되, 활성 사용자에 한해 normalized_email 유일성을
부분 unique index로 보장한다(PostgreSQL). 방언 무관 타입만 사용해 SQLite 단위
테스트에서도 테이블이 생성되도록 한다(부분 unique의 실제 강제는 PostgreSQL).
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), primary_key=True, default=uuid.uuid4
    )
    # 소셜 전용 계정은 이메일이 없을 수 있어 nullable.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # 중복 판정/조회용 정규화 이메일(소문자·trim). 활성 사용자 유일성의 기준.
    normalized_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # 소셜 전용 계정은 비밀번호가 없다. 평문은 절대 저장하지 않는다(Argon2id 해시).
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    primary_provider: Mapped[str] = mapped_column(String(32), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    oauth_accounts: Mapped[list["OAuthAccount"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # 활성(soft-delete 안 된) 사용자에 한해 normalized_email 유일.
        # PostgreSQL 부분 unique index — 재가입/탈퇴 후 동일 이메일 재사용을 허용하면서
        # 활성 계정 간 중복만 막는다.
        Index(
            "uq_users_normalized_email_active",
            "normalized_email",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
