"""근무지 API (/api/v1/workplaces). 라우터는 얇게 — service 가 소유권/멱등/삭제를 담당."""
import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.v1.work_data_deps import Pagination, pagination
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.workplace import WorkplaceCreate, WorkplaceResponse, WorkplaceUpdate
from app.services import work_data

router = APIRouter(prefix="/workplaces", tags=["workplaces"])


@router.post("", response_model=WorkplaceResponse, status_code=status.HTTP_201_CREATED)
def create_workplace(
    req: WorkplaceCreate,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorkplaceResponse:
    workplace, created = work_data.create_workplace(db, current_user, req)
    if not created:
        # client_id 멱등 재요청: 기존 레코드를 200 으로 돌려준다.
        response.status_code = status.HTTP_200_OK
    return workplace


@router.get("", response_model=list[WorkplaceResponse])
def list_workplaces(
    page: Pagination = Depends(pagination),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WorkplaceResponse]:
    return work_data.list_workplaces(db, current_user, page.limit, page.offset)


@router.get("/{workplace_id}", response_model=WorkplaceResponse)
def get_workplace(
    workplace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorkplaceResponse:
    return work_data.get_workplace(db, current_user, workplace_id)


@router.patch("/{workplace_id}", response_model=WorkplaceResponse)
def update_workplace(
    workplace_id: uuid.UUID,
    req: WorkplaceUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorkplaceResponse:
    return work_data.update_workplace(db, current_user, workplace_id, req)


@router.delete("/{workplace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workplace(
    workplace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    work_data.delete_workplace(db, current_user, workplace_id)
