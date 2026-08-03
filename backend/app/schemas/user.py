"""사용자 응답/수정 스키마. password_hash, normalized_email, deleted_at 등
내부 정보는 절대 노출하지 않는다(명시한 필드만 직렬화)."""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None
    name: str
    primary_provider: str
    created_at: datetime
    updated_at: datetime


class UserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
