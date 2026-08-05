"""work-data 도메인 service: 근무지/근무예정/출퇴근 CRUD.

원칙(Phase 2 auth_service 와 동일):
- 모든 데이터는 현재 인증 사용자 소유. request 로 user_id 를 받지 않는다.
- 조회는 항상 user 범위로 스코프. 타인/미존재 접근은 NotFoundError(→404)로 통일해
  존재 여부를 노출하지 않는다.
- 각 변경은 원자적으로 처리(성공 시 1회 commit, 실패 시 rollback).
- soft-delete: DELETE 는 deleted_at 만 채운다. 근무지 삭제는 그에 속한 예정/출퇴근을
  건드리지 않는다(과거 기록 보존). 새 예정/출퇴근은 삭제된 근무지를 참조할 수 없다.
- client_id 멱등: 같은 (user, client_id) 재요청 시 활성 레코드가 있으면 그대로 반환
  (offline 재전송 대비), 이미 삭제된 레코드면 409(삭제분의 부활 방지).
- GPS 거리/반경 결과는 저장하지 않고 응답 시 근무지 좌표로 서버가 재계산(core.geo).
"""
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core import geo, security
from app.models.attendance_record import AttendanceRecord
from app.models.mixins import OwnedRecordMixin
from app.models.user import User
from app.models.work_schedule import WorkSchedule
from app.models.workplace import Workplace
from app.repositories import work_data as repo
from app.schemas.attendance_record import (
    AttendanceRecordCreate,
    AttendanceRecordResponse,
    AttendanceRecordUpdate,
    Proximity,
)
from app.schemas.work_schedule import WorkScheduleCreate, WorkScheduleUpdate
from app.schemas.workplace import WorkplaceCreate, WorkplaceUpdate


class NotFoundError(Exception):
    """소유자의 활성 레코드가 없음(타인/미존재/삭제 포함). → 404."""


class ClientIdConflictError(Exception):
    """이미 삭제된 레코드의 client_id 로 재생성 시도. → 409."""


class InvalidWorkplaceError(Exception):
    """참조하려는 근무지가 본인 소유의 활성 근무지가 아님. → 422."""


# ---------------------------------------------------------------------------
# 공통 헬퍼
# ---------------------------------------------------------------------------
def _idempotent_existing(
    db: Session, model: type[OwnedRecordMixin], user: User, client_id: str | None
):
    """client_id 재요청 처리: 활성 중복이면 그 레코드, 삭제된 중복이면 409, 없으면 None."""
    if client_id is None:
        return None
    existing = repo.get_by_client_id(db, model, user.id, client_id)
    if existing is None:
        return None
    if existing.deleted_at is not None:
        raise ClientIdConflictError("이미 삭제된 기록과 같은 client_id 예요.")
    return existing


def _resolve_workplace(db: Session, user: User, workplace_id: uuid.UUID) -> Workplace:
    wp = repo.get_owned_active(db, Workplace, user.id, workplace_id)
    if wp is None:
        raise InvalidWorkplaceError("유효한 근무지가 아니에요.")
    return wp


def _soft_delete(db: Session, obj: OwnedRecordMixin) -> None:
    obj.deleted_at = security.utcnow()
    db.commit()


# ---------------------------------------------------------------------------
# Workplaces
# ---------------------------------------------------------------------------
def create_workplace(
    db: Session, user: User, data: WorkplaceCreate
) -> tuple[Workplace, bool]:
    existing = _idempotent_existing(db, Workplace, user, data.client_id)
    if existing is not None:
        return existing, False

    wp = Workplace(
        user_id=user.id,
        client_id=data.client_id,
        name=data.name,
        hourly_wage=data.hourly_wage,
        address=data.address,
        latitude=data.latitude,
        longitude=data.longitude,
    )
    db.add(wp)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _idempotent_existing(db, Workplace, user, data.client_id)
        if existing is not None:
            return existing, False
        raise
    db.refresh(wp)
    return wp, True


def list_workplaces(
    db: Session, user: User, limit: int, offset: int
) -> list[Workplace]:
    stmt = (
        select(Workplace)
        .where(Workplace.user_id == user.id, Workplace.deleted_at.is_(None))
        .order_by(Workplace.created_at.desc(), Workplace.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.execute(stmt).scalars().all())


def get_workplace(db: Session, user: User, obj_id: uuid.UUID) -> Workplace:
    wp = repo.get_owned_active(db, Workplace, user.id, obj_id)
    if wp is None:
        raise NotFoundError("근무지를 찾을 수 없어요.")
    return wp


def update_workplace(
    db: Session, user: User, obj_id: uuid.UUID, data: WorkplaceUpdate
) -> Workplace:
    wp = get_workplace(db, user, obj_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(wp, key, value)
    db.commit()
    db.refresh(wp)
    return wp


def delete_workplace(db: Session, user: User, obj_id: uuid.UUID) -> None:
    wp = get_workplace(db, user, obj_id)
    _soft_delete(db, wp)


# ---------------------------------------------------------------------------
# Work schedules
# ---------------------------------------------------------------------------
def create_schedule(
    db: Session, user: User, data: WorkScheduleCreate
) -> tuple[WorkSchedule, bool]:
    existing = _idempotent_existing(db, WorkSchedule, user, data.client_id)
    if existing is not None:
        return existing, False
    _resolve_workplace(db, user, data.workplace_id)

    sch = WorkSchedule(
        user_id=user.id,
        client_id=data.client_id,
        workplace_id=data.workplace_id,
        work_date=data.work_date,
        start_time=data.start_time,
        end_time=data.end_time,
        reminder_minutes=data.reminder_minutes,
    )
    db.add(sch)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _idempotent_existing(db, WorkSchedule, user, data.client_id)
        if existing is not None:
            return existing, False
        raise
    db.refresh(sch)
    return sch, True


def list_schedules(
    db: Session,
    user: User,
    limit: int,
    offset: int,
    workplace_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[WorkSchedule]:
    stmt = select(WorkSchedule).where(
        WorkSchedule.user_id == user.id, WorkSchedule.deleted_at.is_(None)
    )
    if workplace_id is not None:
        stmt = stmt.where(WorkSchedule.workplace_id == workplace_id)
    if date_from is not None:
        stmt = stmt.where(WorkSchedule.work_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(WorkSchedule.work_date <= date_to)
    stmt = stmt.order_by(
        WorkSchedule.work_date.desc(),
        WorkSchedule.start_time.desc(),
        WorkSchedule.id.desc(),
    ).limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


def get_schedule(db: Session, user: User, obj_id: uuid.UUID) -> WorkSchedule:
    sch = repo.get_owned_active(db, WorkSchedule, user.id, obj_id)
    if sch is None:
        raise NotFoundError("근무 예정을 찾을 수 없어요.")
    return sch


def update_schedule(
    db: Session, user: User, obj_id: uuid.UUID, data: WorkScheduleUpdate
) -> WorkSchedule:
    sch = get_schedule(db, user, obj_id)
    fields = data.model_dump(exclude_unset=True)
    if "workplace_id" in fields:
        _resolve_workplace(db, user, fields["workplace_id"])
    for key, value in fields.items():
        setattr(sch, key, value)
    db.commit()
    db.refresh(sch)
    return sch


def delete_schedule(db: Session, user: User, obj_id: uuid.UUID) -> None:
    sch = get_schedule(db, user, obj_id)
    _soft_delete(db, sch)


# ---------------------------------------------------------------------------
# Attendance records
# ---------------------------------------------------------------------------
def create_attendance(
    db: Session, user: User, data: AttendanceRecordCreate
) -> tuple[AttendanceRecord, bool]:
    existing = _idempotent_existing(db, AttendanceRecord, user, data.client_id)
    if existing is not None:
        return existing, False
    _resolve_workplace(db, user, data.workplace_id)

    rec = AttendanceRecord(
        user_id=user.id,
        client_id=data.client_id,
        workplace_id=data.workplace_id,
        work_date=data.work_date,
        clock_in=data.clock_in,
        clock_out=data.clock_out,
        break_minutes=data.break_minutes,
        note=data.note,
        is_holiday=data.is_holiday,
        clock_in_latitude=data.clock_in_latitude,
        clock_in_longitude=data.clock_in_longitude,
        clock_out_latitude=data.clock_out_latitude,
        clock_out_longitude=data.clock_out_longitude,
    )
    db.add(rec)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _idempotent_existing(db, AttendanceRecord, user, data.client_id)
        if existing is not None:
            return existing, False
        raise
    db.refresh(rec)
    return rec, True


def list_attendance(
    db: Session,
    user: User,
    limit: int,
    offset: int,
    workplace_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[AttendanceRecord]:
    stmt = (
        select(AttendanceRecord)
        .where(
            AttendanceRecord.user_id == user.id,
            AttendanceRecord.deleted_at.is_(None),
        )
        .options(joinedload(AttendanceRecord.workplace))
    )
    if workplace_id is not None:
        stmt = stmt.where(AttendanceRecord.workplace_id == workplace_id)
    if date_from is not None:
        stmt = stmt.where(AttendanceRecord.work_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(AttendanceRecord.work_date <= date_to)
    stmt = stmt.order_by(
        AttendanceRecord.work_date.desc(),
        AttendanceRecord.clock_in.desc(),
        AttendanceRecord.id.desc(),
    ).limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


def get_attendance(db: Session, user: User, obj_id: uuid.UUID) -> AttendanceRecord:
    rec = repo.get_owned_active(db, AttendanceRecord, user.id, obj_id)
    if rec is None:
        raise NotFoundError("출퇴근 기록을 찾을 수 없어요.")
    return rec


def update_attendance(
    db: Session, user: User, obj_id: uuid.UUID, data: AttendanceRecordUpdate
) -> AttendanceRecord:
    rec = get_attendance(db, user, obj_id)
    fields = data.model_dump(exclude_unset=True)
    if "workplace_id" in fields:
        _resolve_workplace(db, user, fields["workplace_id"])
    for key, value in fields.items():
        setattr(rec, key, value)
    db.commit()
    db.refresh(rec)
    return rec


def delete_attendance(db: Session, user: User, obj_id: uuid.UUID) -> None:
    rec = get_attendance(db, user, obj_id)
    _soft_delete(db, rec)


def to_attendance_response(rec: AttendanceRecord) -> AttendanceRecordResponse:
    """저장값 + 서버 재계산 proximity 로 응답을 구성한다.

    근무지 좌표(과거 참조를 위해 soft-delete 된 근무지여도 좌표를 읽는다)와 기록 좌표로
    거리·반경 인증을 다시 계산한다. 어느 쪽 좌표라도 없으면 proximity 는 null.
    """
    resp = AttendanceRecordResponse.model_validate(rec)
    wp = rec.workplace
    if wp is not None:
        ci = geo.proximity(
            wp.latitude, wp.longitude, rec.clock_in_latitude, rec.clock_in_longitude
        )
        co = geo.proximity(
            wp.latitude, wp.longitude, rec.clock_out_latitude, rec.clock_out_longitude
        )
        if ci is not None:
            resp.clock_in_proximity = Proximity(distance_m=ci[0], verified=ci[1])
        if co is not None:
            resp.clock_out_proximity = Proximity(distance_m=co[0], verified=co[1])
    return resp
