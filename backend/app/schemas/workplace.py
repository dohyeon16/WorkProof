"""Workplace 요청/응답 스키마.

user_id/deleted_at 등 내부 필드는 응답에 노출하지 않는다(명시한 필드만 직렬화).
좌표는 위도·경도가 항상 짝을 이뤄야 한다(둘 다 있거나 둘 다 없음).
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class WorkplaceCreate(BaseModel):
    # 모바일 로컬 ID. 재전송(오프라인 동기화) 시 중복 생성 방지 키(user 범위 unique).
    client_id: str | None = Field(default=None, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    hourly_wage: int = Field(ge=0)
    address: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("근무지 이름을 입력해 주세요.")
        return v

    @field_validator("address")
    @classmethod
    def _strip_address(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _coords_paired(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("좌표는 위도·경도를 모두 채우거나 모두 비워야 해요.")
        return self


class WorkplaceUpdate(BaseModel):
    """부분 수정. 보낸 필드만 반영(model_fields_set 기준) — 생략은 유지, 명시적 null은 제거."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    hourly_wage: int | None = Field(default=None, ge=0)
    address: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("근무지 이름을 입력해 주세요.")
        return v

    @field_validator("address")
    @classmethod
    def _strip_address(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _coords_paired(self):
        fs = self.model_fields_set
        has_lat, has_lon = "latitude" in fs, "longitude" in fs
        if has_lat != has_lon:
            raise ValueError("위도와 경도는 함께 수정해야 해요.")
        if has_lat and has_lon and (self.latitude is None) != (self.longitude is None):
            raise ValueError("좌표는 위도·경도를 모두 채우거나 모두 비워야 해요.")
        return self


class WorkplaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: str | None
    name: str
    hourly_wage: int
    address: str | None
    latitude: float | None
    longitude: float | None
    created_at: datetime
    updated_at: datetime
