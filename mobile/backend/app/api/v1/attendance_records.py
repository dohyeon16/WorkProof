"""출퇴근 기록 API (/api/v1/attendance-records).

응답의 proximity(거리·반경 인증)는 service.to_attendance_response 가 근무지 좌표로
서버에서 재계산한다(클라가 보낸 거리는 받지 않는다).
"""
import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.v1.work_data_deps import ListFilters, Pagination, list_filters, pagination
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.attendance_record import (
    AttendanceRecordCreate,
    AttendanceRecordResponse,
    AttendanceRecordUpdate,
)
from app.services import work_data_service

router = APIRouter(prefix="/attendance-records", tags=["attendance-records"])


@router.post(
    "", response_model=AttendanceRecordResponse, status_code=status.HTTP_201_CREATED
)
def create_attendance(
    req: AttendanceRecordCreate,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttendanceRecordResponse:
    record, created = work_data_service.create_attendance(db, current_user, req)
    if not created:
        response.status_code = status.HTTP_200_OK
    return work_data_service.to_attendance_response(record)


@router.get("", response_model=list[AttendanceRecordResponse])
def list_attendance(
    page: Pagination = Depends(pagination),
    filters: ListFilters = Depends(list_filters),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AttendanceRecordResponse]:
    records = work_data_service.list_attendance(
        db,
        current_user,
        page.limit,
        page.offset,
        workplace_id=filters.workplace_id,
        date_from=filters.date_from,
        date_to=filters.date_to,
    )
    return [work_data_service.to_attendance_response(r) for r in records]


@router.get("/{record_id}", response_model=AttendanceRecordResponse)
def get_attendance(
    record_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttendanceRecordResponse:
    return work_data_service.to_attendance_response(
        work_data_service.get_attendance(db, current_user, record_id)
    )


@router.patch("/{record_id}", response_model=AttendanceRecordResponse)
def update_attendance(
    record_id: uuid.UUID,
    req: AttendanceRecordUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttendanceRecordResponse:
    return work_data_service.to_attendance_response(
        work_data_service.update_attendance(db, current_user, record_id, req)
    )


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attendance(
    record_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    work_data_service.delete_attendance(db, current_user, record_id)
