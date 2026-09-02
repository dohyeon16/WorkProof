"""work-data 리소스 공통 데이터 접근(workplaces/work_schedules/attendance_records).

세 모델이 OwnedRecordMixin(user_id/client_id/deleted_at)을 공유하므로 조회 헬퍼도
모델 클래스를 인자로 받는 제네릭 형태로 둔다. 커밋/트랜잭션 경계는 service 계층이 관리한다.
"""
import uuid
from typing import TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.mixins import OwnedRecordMixin

M = TypeVar("M", bound=OwnedRecordMixin)


def get_owned_active(
    db: Session, model: type[M], user_id: uuid.UUID, obj_id: uuid.UUID
) -> M | None:
    """소유자의 삭제되지 않은 레코드 1건. 타인 소유/미존재/soft-delete 는 모두 None."""
    obj = db.get(model, obj_id)
    if obj is None or obj.user_id != user_id or obj.deleted_at is not None:
        return None
    return obj


def get_by_client_id(
    db: Session, model: type[M], user_id: uuid.UUID, client_id: str
) -> M | None:
    """(user_id, client_id) 로 1건 조회 — soft-delete 된 것도 포함(재생성 판단용)."""
    stmt = (
        select(model)
        .where(model.user_id == user_id, model.client_id == client_id)
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()


def add(db: Session, obj: M) -> M:
    db.add(obj)
    db.flush()
    return obj
