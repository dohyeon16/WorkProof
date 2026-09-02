"""AttendanceRecord ORM 모델 (출퇴근 기록).

모바일 `AttendanceRecord`(types.ts)의 서버 저장 대상 필드.
- 저장: workplace_id, work_date, clock_in, clock_out(선택), break_minutes, note(선택),
  is_holiday, clock_in/clock_out GPS 좌표(각 선택).
- clock_in 은 필수, clock_out 은 진행 중(퇴근 전) 기록을 위해 선택. clock_out < clock_in
  이면 자정 넘김으로 해석(모바일 규칙과 동일).
- distance/proximity(반경 인증 결과)는 저장하지 않는다 — 응답 시 근무지 좌표와 기록 좌표로
  서버가 core/geo 로 재계산한다(클라가 보낸 거리는 신뢰하지 않음). accuracy/source 는 모바일
  저장 모델에 없어 두지 않는다.
"""
import uuid
from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import OwnedRecordMixin


class AttendanceRecord(Base, OwnedRecordMixin):
    __tablename__ = "attendance_records"

    workplace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("workplaces.id"), nullable=False
    )
    # 로컬 근무 날짜(DATE). UTC 로 변환하지 않는다.
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    clock_in: Mapped[str] = mapped_column(String(5), nullable=False)  # HH:mm
    clock_out: Mapped[str | None] = mapped_column(String(5), nullable=True)  # HH:mm (진행 중이면 없음)
    break_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    note: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    is_holiday: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # 실시간 출근/퇴근 시 캡처한 GPS 좌표(선택). 근무지 좌표와 비교해 반경 인증 근거로 쓴다.
    # 각 쌍(위도/경도)은 둘 다 있거나 둘 다 없어야 한다.
    clock_in_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    clock_in_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    clock_out_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    clock_out_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    workplace: Mapped["Workplace"] = relationship(  # noqa: F821
        back_populates="attendance_records"
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "client_id", name="uq_attendance_records_user_client"
        ),
        Index("ix_attendance_records_user_date", "user_id", "work_date"),
        Index("ix_attendance_records_user_workplace", "user_id", "workplace_id"),
        Index("ix_attendance_records_user_active", "user_id", "deleted_at"),
        CheckConstraint("break_minutes >= 0", name="ck_attendance_break_nonneg"),
        CheckConstraint(
            "clock_in_latitude IS NULL AND clock_in_longitude IS NULL "
            "OR clock_in_latitude IS NOT NULL AND clock_in_longitude IS NOT NULL",
            name="ck_attendance_clockin_coords_paired",
        ),
        CheckConstraint(
            "clock_out_latitude IS NULL AND clock_out_longitude IS NULL "
            "OR clock_out_latitude IS NOT NULL AND clock_out_longitude IS NOT NULL",
            name="ck_attendance_clockout_coords_paired",
        ),
        CheckConstraint(
            "clock_in_latitude IS NULL OR clock_in_latitude BETWEEN -90 AND 90",
            name="ck_attendance_clockin_lat_range",
        ),
        CheckConstraint(
            "clock_in_longitude IS NULL OR clock_in_longitude BETWEEN -180 AND 180",
            name="ck_attendance_clockin_lon_range",
        ),
        CheckConstraint(
            "clock_out_latitude IS NULL OR clock_out_latitude BETWEEN -90 AND 90",
            name="ck_attendance_clockout_lat_range",
        ),
        CheckConstraint(
            "clock_out_longitude IS NULL OR clock_out_longitude BETWEEN -180 AND 180",
            name="ck_attendance_clockout_lon_range",
        ),
    )
