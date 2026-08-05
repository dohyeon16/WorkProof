"""Workplace ORM 모델 (근무지).

모바일 `Workplace`(core/domain/models/types.ts)의 서버 저장 대상 필드만 담는다.
- 저장: name, hourly_wage(원 단위 정수), address, latitude/longitude
- 이번 범위 제외: payDay/weeklyAllowance/breakMinutesPerShift 등 급여 정책 필드와
  contract*/OCR(증빙) 필드 — 각각 payroll/contracts 단계로 미룬다. [[]]
- radius/memo/color 는 모바일 모델에 없어 추가하지 않는다(반경은 core/geo.VERIFY_RADIUS_M 상수).

소유권(user_id)/동기화(client_id)/타임스탬프/soft-delete 는 OwnedRecordMixin 공유.
방언 무관 타입만 써서 SQLite 단위 테스트에서도 create_all 로 생성되게 한다.
"""
from sqlalchemy import CheckConstraint, Float, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import OwnedRecordMixin


class Workplace(Base, OwnedRecordMixin):
    __tablename__ = "workplaces"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # 시급(원). 통화는 원 단위 정수만 — 부동소수 금지(모바일도 Math.round 로 정수 처리).
    hourly_wage: Mapped[int] = mapped_column(Integer, nullable=False)
    # 역지오코딩 주소(선택). 좌표만 있고 주소가 없을 수 있다.
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 근무지 GPS 좌표(선택). 반경 인증(core/geo)의 기준점. 좌표는 둘 다 있거나 둘 다 없어야 한다.
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    schedules: Mapped[list["WorkSchedule"]] = relationship(  # noqa: F821
        back_populates="workplace"
    )
    attendance_records: Mapped[list["AttendanceRecord"]] = relationship(  # noqa: F821
        back_populates="workplace"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_workplaces_user_client"),
        Index("ix_workplaces_user_active", "user_id", "deleted_at"),
        CheckConstraint("hourly_wage >= 0", name="ck_workplaces_wage_nonneg"),
        CheckConstraint(
            "latitude IS NULL AND longitude IS NULL "
            "OR latitude IS NOT NULL AND longitude IS NOT NULL",
            name="ck_workplaces_coords_paired",
        ),
        CheckConstraint(
            "latitude IS NULL OR latitude BETWEEN -90 AND 90",
            name="ck_workplaces_lat_range",
        ),
        CheckConstraint(
            "longitude IS NULL OR longitude BETWEEN -180 AND 180",
            name="ck_workplaces_lon_range",
        ),
    )
