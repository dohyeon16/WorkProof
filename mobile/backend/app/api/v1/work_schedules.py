"""근무 예정 API (/api/v1/work-schedules)."""
import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.v1.work_data_deps import ListFilters, Pagination, list_filters, pagination
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.work_schedule import (
    WorkScheduleCreate,
    WorkScheduleResponse,
    WorkScheduleUpdate,
)
from app.services import work_data

router = APIRouter(prefix="/work-schedules", tags=["work-schedules"])


@router.post(
    "", response_model=WorkScheduleResponse, status_code=status.HTTP_201_CREATED
)
def create_schedule(
    req: WorkScheduleCreate,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorkScheduleResponse:
    schedule, created = work_data.create_schedule(db, current_user, req)
    if not created:
        response.status_code = status.HTTP_200_OK
    return schedule


@router.get("", response_model=list[WorkScheduleResponse])
def list_schedules(
    page: Pagination = Depends(pagination),
    filters: ListFilters = Depends(list_filters),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WorkScheduleResponse]:
    return work_data.list_schedules(
        db,
        current_user,
        page.limit,
        page.offset,
        workplace_id=filters.workplace_id,
        date_from=filters.date_from,
        date_to=filters.date_to,
    )


@router.get("/{schedule_id}", response_model=WorkScheduleResponse)
def get_schedule(
    schedule_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorkScheduleResponse:
    return work_data.get_schedule(db, current_user, schedule_id)


@router.patch("/{schedule_id}", response_model=WorkScheduleResponse)
def update_schedule(
    schedule_id: uuid.UUID,
    req: WorkScheduleUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorkScheduleResponse:
    return work_data.update_schedule(db, current_user, schedule_id, req)


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(
    schedule_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    work_data.delete_schedule(db, current_user, schedule_id)
