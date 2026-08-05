"""WorkSchedule ORM 모델 (근무 예정).

모바일 `ScheduledShift`(types.ts)의 서버 저장 대상 필드.
- 저장: workplace_id, work_date, start_time, end_time(선택), reminder_minutes
- start_time/end_time 은 "HH:mm" 문자열(모바일과 동일). end_time < start_time 이면 자정 넘김
  근무로 해석한다(별도 종료 날짜 컬럼을 두지 않음 — 모바일 계산 규칙과 일치).
- reminder_minutes 는 '출근 몇 분 전 알림' 설정값(사용자 데이터)이라 저장한다. 실제 OS
  알림 identifier 는 기기 전용이라 저장하지 않는다.
"""
import uuid
from datetime import date

from sqlalchemy import (
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import OwnedRecordMixin


class WorkSchedule(Base, OwnedRecordMixin):
    __tablename__ = "work_schedules"

    # 소속 근무지. 소유자 검증은 service 계층에서 하며(같은 user 의 근무지만 허용),
    # 근무지는 soft-delete 라 행이 남으므로 하드삭제 cascade 는 걸지 않는다(과거 예정 보존).
    workplace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("workplaces.id"), nullable=False
    )
    # 로컬 근무 날짜(DATE, 타임존/시각 없음). UTC timestamp 로 변환하지 않는다.
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)  # HH:mm
    end_time: Mapped[str | None] = mapped_column(String(5), nullable=True)  # HH:mm
    # 출근 N분 전 알림(0 = 알림 없음).
    reminder_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    workplace: Mapped["Workplace"] = relationship(  # noqa: F821
        back_populates="schedules"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_work_schedules_user_client"),
        Index("ix_work_schedules_user_date", "user_id", "work_date"),
        Index("ix_work_schedules_user_workplace", "user_id", "workplace_id"),
        Index("ix_work_schedules_user_active", "user_id", "deleted_at"),
    )
