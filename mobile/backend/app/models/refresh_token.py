"""RefreshToken ORM 모델.

refresh token 원문은 절대 저장하지 않는다 — SHA-256 hash(token_hash)만 저장한다.
rotation 체인은 family_id로 묶고, 폐기된 토큰이 재사용되면 family 전체를 폐기해
탈취 토큰 재사용을 무력화한다(replaced_by_token_id로 회전 이력 추적).
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 원문이 아니라 SHA-256 hex digest. unique 로 조회/충돌 방지.
    token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True
    )
    family_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), nullable=False, index=True
    )
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    replaced_by_token_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(), ForeignKey("refresh_tokens.id", ondelete="SET NULL"), nullable=True
    )
    device_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")  # noqa: F821
