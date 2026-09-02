"""Workplace 요청/응답 스키마.

user_id/deleted_at 등 내부 필드는 응답에 노출하지 않는다(명시한 필드만 직렬화).
좌표는 위도·경도가 항상 짝을 이뤄야 한다(둘 다 있거나 둘 다 없음).

급여 정책(Phase 3C): pay_day/weekly_allowance/five_or_more_employees/
income_deduction_type/break_minutes_per_shift. Create 에서는 기본값이 있어 생략 가능하고,
Update(부분 수정)에서는 정책 필드가 NOT NULL 이라 명시적 null 을 거부한다(생략=유지).
금액은 정수(원), 급여일은 '매월 며칠'(1~31) 정수 — DATE 가 아니다.
"""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# 모바일 IncomeDeductionType 과 동일 값 집합.
IncomeDeductionType = Literal["none", "withholding", "insurance"]
# Update 에서 명시적 null 을 금지할 정책 필드(전부 서버에서 NOT NULL).
_REQUIRED_POLICY_FIELDS = (
    "pay_day",
    "weekly_allowance",
    "five_or_more_employees",
    "income_deduction_type",
    "break_minutes_per_shift",
)


class WorkplaceCreate(BaseModel):
    # 모바일 로컬 ID. 재전송(오프라인 동기화) 시 중복 생성 방지 키(user 범위 unique).
    client_id: str | None = Field(default=None, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    hourly_wage: int = Field(ge=0)
    address: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    # 급여 정책(생략 시 기본값). 모바일 폼 기본값과 맞춘다.
    pay_day: int = Field(default=10, ge=1, le=31)
    weekly_allowance: bool = True
    five_or_more_employees: bool = False
    income_deduction_type: IncomeDeductionType = "none"
    break_minutes_per_shift: int = Field(default=0, ge=0)

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
    # 급여 정책(부분 수정). NOT NULL 이라 명시적 null 은 아래 validator 로 거부한다.
    pay_day: int | None = Field(default=None, ge=1, le=31)
    weekly_allowance: bool | None = None
    five_or_more_employees: bool | None = None
    income_deduction_type: IncomeDeductionType | None = None
    break_minutes_per_shift: int | None = Field(default=None, ge=0)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("근무지 이름을 입력해 주세요.")
        return v

    @model_validator(mode="after")
    def _no_explicit_null_policy(self):
        # 정책 필드는 서버에서 NOT NULL — 생략은 유지, 명시적 null 은 거부(422).
        fs = self.model_fields_set
        for name in _REQUIRED_POLICY_FIELDS:
            if name in fs and getattr(self, name) is None:
                raise ValueError(f"{name} 은(는) null 로 지울 수 없어요.")
        return self

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
    pay_day: int
    weekly_allowance: bool
    five_or_more_employees: bool
    income_deduction_type: IncomeDeductionType
    break_minutes_per_shift: int
    created_at: datetime
    updated_at: datetime
