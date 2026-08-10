"""인증 사용자 API (/api/v1/users/me)."""
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.user import UserResponse, UserUpdateRequest
from app.services import auth_service, work_data

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
def read_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return current_user


@router.patch("/me", response_model=UserResponse)
def update_me(
    req: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
    if req.name is not None:
        current_user = auth_service.update_name(db, current_user, req.name)
    return current_user


@router.delete("/me/work-data", status_code=status.HTTP_204_NO_CONTENT)
def reset_my_work_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """업무 데이터(근무지·예정근무·출퇴근)만 전부 삭제한다 — 계정은 유지(앱 초기화의 서버측).

    회원탈퇴(DELETE /me)와 구분된다: 여기서는 user/oauth/refresh 를 남겨 재로그인이
    가능하고, 다음 동기화(pull)에 과거 데이터가 다시 내려오지 않도록 물리 삭제한다.
    """
    work_data.reset_work_data(db, current_user)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    auth_service.delete_account(db, current_user)
