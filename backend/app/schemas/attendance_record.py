"""AttendanceRecord(출퇴근 기록) 요청/응답 스키마.

- clock_in 필수, clock_out 선택(진행 중 근무). clock_out < clock_in 이면 자정 넘김.
- GPS 좌표는 clock_in 쌍/clock_out 쌍 각각 짝을 이뤄야 한다.
- 응답의 proximity(거리·반경내 여부)는 저장값이 아니라, 근무지 좌표와 기록 좌표로
  서버가 core/geo 로 재계산한 값이다(클라가 보낸 거리는 받지도 신뢰하지도 않는다).
"""
import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# 모바일 TIME_RE 와 동일.
TIME_PATTERN = r"^([01]\d|2[0-3]):([0-5]\d)$"


def _strip_note(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


class AttendanceRecordCreate(BaseModel):
    client_id: str | None = Field(default=None, max_length=128)
    workplace_id: uuid.UUID
    work_date: date
    clock_in: str = Field(pattern=TIME_PATTERN)
    clock_out: str | None = Field(default=None, pattern=TIME_PATTERN)
    break_minutes: int = Field(default=0, ge=0)
    note: str | None = Field(default=None, max_length=2000)
    is_holiday: bool = False
    clock_in_latitude: float | None = Field(default=None, ge=-90, le=90)
    clock_in_longitude: float | None = Field(default=None, ge=-180, le=180)
    clock_out_latitude: float | None = Field(default=None, ge=-90, le=90)
    clock_out_longitude: float | None = Field(default=None, ge=-180, le=180)

    _clean_note = field_validator("note")(_strip_note)

    @model_validator(mode="after")
    def _coords_paired(self):
        if (self.clock_in_latitude is None) != (self.clock_in_longitude is None):
            raise ValueError("출근 좌표는 위도·경도를 모두 채우거나 모두 비워야 해요.")
        if (self.clock_out_latitude is None) != (self.clock_out_longitude is None):
            raise ValueError("퇴근 좌표는 위도·경도를 모두 채우거나 모두 비워야 해요.")
        return self


class AttendanceRecordUpdate(BaseModel):
    """부분 수정. 보낸 필드만 반영 — 좌표 쌍은 함께 수정해야 한다."""

    workplace_id: uuid.UUID | None = None
    work_date: date | None = None
    clock_in: str | None = Field(default=None, pattern=TIME_PATTERN)
    clock_out: str | None = Field(default=None, pattern=TIME_PATTERN)
    break_minutes: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=2000)
    is_holiday: bool | None = None
    clock_in_latitude: float | None = Field(default=None, ge=-90, le=90)
    clock_in_longitude: float | None = Field(default=None, ge=-180, le=180)
    clock_out_latitude: float | None = Field(default=None, ge=-90, le=90)
    clock_out_longitude: float | None = Field(default=None, ge=-180, le=180)

    _clean_note = field_validator("note")(_strip_note)

    @model_validator(mode="after")
    def _coords_paired(self):
        fs = self.model_fields_set
        for lat, lon, label in (
            ("clock_in_latitude", "clock_in_longitude", "출근"),
            ("clock_out_latitude", "clock_out_longitude", "퇴근"),
        ):
            has_lat, has_lon = lat in fs, lon in fs
            if has_lat != has_lon:
                raise ValueError(f"{label} 위도와 경도는 함께 수정해야 해요.")
            if has_lat and has_lon and (getattr(self, lat) is None) != (
                getattr(self, lon) is None
            ):
                raise ValueError(f"{label} 좌표는 위도·경도를 모두 채우거나 모두 비워야 해요.")
        return self


class Proximity(BaseModel):
    """근무지 좌표 기준 반경 인증 결과(서버 재계산)."""

    distance_m: int  # 표기용 거리(m, half-up 반올림)
    verified: bool  # 반경(core/geo.VERIFY_RADIUS_M) 이내 여부


class AttendanceRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: str | None
    workplace_id: uuid.UUID
    work_date: date
    clock_in: str
    clock_out: str | None
    break_minutes: int
    note: str | None
    is_holiday: bool
    clock_in_latitude: float | None
    clock_in_longitude: float | None
    clock_out_latitude: float | None
    clock_out_longitude: float | None
    created_at: datetime
    updated_at: datetime
    # 서버 재계산 파생값(저장 컬럼 아님). 근무지·기록 좌표가 없으면 null.
    clock_in_proximity: Proximity | None = None
    clock_out_proximity: Proximity | None = None
