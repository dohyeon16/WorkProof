"""work-data 모델 공통 컬럼 mixin.

세 리소스(workplaces, work_schedules, attendance_records)가 공유하는 소유권/동기화/
타임스탬프/soft-delete 컬럼을 한곳에 둔다. 각 테이블의 index/제약은 모델별 __table_args__
에서 정의한다.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column


class OwnedRecordMixin:
    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    # 소유자. 운영에서 사용자는 soft-delete 되므로 이 CASCADE 는 하드삭제 안전망이다.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # 모바일 로컬 ID(예: "1699999999999-abc1234"). 오프라인 동기화 idempotency 용(선택).
    # UUID 가 아니라 문자열이라 String 으로 받는다.
    client_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    # 레코드별 soft-delete. 사용자 soft-delete(users.deleted_at)와는 독립적이다.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
