"""Persistent OAuth bridge handoff shared by all application instances."""
from datetime import datetime

from sqlalchemy import DateTime, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class OAuthBridgeSession(Base):
    __tablename__ = "oauth_bridge_sessions"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, server_default="signup")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    profile: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    message: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_error: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    return_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
