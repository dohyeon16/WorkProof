"""Workplace ORM 모델 (근무지).

모바일 `Workplace`(core/domain/models/types.ts)의 서버 저장 대상 필드를 담는다.
- 기본(Phase 3A): name, hourly_wage(원 단위 정수), address, latitude/longitude
- 급여 정책(Phase 3C): pay_day, weekly_allowance, five_or_more_employees,
  income_deduction_type, break_minutes_per_shift — 근무지당 1:1 정책이라 별도 리소스가
  아니라 workplaces 를 확장한다(근무지와 수명주기·소유권·삭제를 공유).
- 여전히 범위 제외: contract*/OCR(계약서 파일·추출 텍스트·요약) — 기기 로컬 파일 참조라
  서버 동기화 대상이 아니다(파일 저장·OCR 은 별도 contracts 단계).

금액은 정수(원)만, 급여일은 DATE 가 아니라 '매월 며칠'(1~31) 정수다. 급여 정책 필드는
전부 NOT NULL + server_default 라 기존 행(3B 이전 동기화분)도 안전하게 채워진다 — 이후
모바일이 실제 값으로 update 를 밀어 넣는다.

소유권(user_id)/동기화(client_id)/타임스탬프/soft-delete 는 OwnedRecordMixin 공유.
방언 무관 타입만 써서 SQLite 단위 테스트에서도 create_all 로 생성되게 한다.
"""
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import OwnedRecordMixin

# 세후 실수령액 추정용 공제 유형(모바일 IncomeDeductionType 과 동일 값).
INCOME_DEDUCTION_TYPES = ("none", "withholding", "insurance")


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

    # --- 급여 정책(Phase 3C) — 근무지당 단일, 계정 단위 복원 대상 ---
    # 급여일: '매월 며칠'(1~31). DATE 아님. 알림/리포트/홈 D-day 계산에 쓴다.
    pay_day: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("10")
    )
    # 주휴수당 약정 여부(payCalc 의 주휴수당 계산 조건).
    weekly_allowance: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    # 상시근로자 5인 이상 사업장(연장·야간·휴일 가산수당 적용 조건). 구버전 → false.
    five_or_more_employees: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # 세후 추정용 공제 유형. none | withholding(3.3%) | insurance(4대보험).
    income_deduction_type: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'none'")
    )
    # 근무 1건당 기본 차감 휴게시간(분). 출퇴근 기록 생성 시 기본값으로 쓴다.
    break_minutes_per_shift: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

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
        CheckConstraint(
            "pay_day BETWEEN 1 AND 31", name="ck_workplaces_pay_day_range"
        ),
        CheckConstraint(
            "break_minutes_per_shift >= 0", name="ck_workplaces_break_nonneg"
        ),
        CheckConstraint(
            "income_deduction_type IN ('none', 'withholding', 'insurance')",
            name="ck_workplaces_income_deduction_type",
        ),
    )
