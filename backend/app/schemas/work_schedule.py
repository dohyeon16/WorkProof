"""WorkSchedule(근무 예정) 요청/응답 스키마.

start_time/end_time 은 "HH:mm"(모바일과 동일 정규식). end_time < start_time 이면
자정 넘김 근무로 해석하므로 서버는 대소를 강제하지 않는다.
"""
import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

# 모바일 TIME_RE 와 동일: 00:00 ~ 23:59.
TIME_PATTERN = r"^([01]\d|2[0-3]):([0-5]\d)$"


class WorkScheduleCreate(BaseModel):
    client_id: str | None = Field(default=None, max_length=128)
    workplace_id: uuid.UUID
    work_date: date
    start_time: str = Field(pattern=TIME_PATTERN)
    end_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    reminder_minutes: int = Field(default=0, ge=0)


class WorkScheduleUpdate(BaseModel):
    """부분 수정. 보낸 필드만 반영."""

    workplace_id: uuid.UUID | None = None
    work_date: date | None = None
    start_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    end_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    reminder_minutes: int | None = Field(default=None, ge=0)


class WorkScheduleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: str | None
    workplace_id: uuid.UUID
    work_date: date
    start_time: str
    end_time: str | None
    reminder_minutes: int
    created_at: datetime
    updated_at: datetime
