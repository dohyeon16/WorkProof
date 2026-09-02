"""FastAPI 의존성: DB 세션, 현재 사용자.

get_current_user 는 access JWT를 검증하고, 비활성/삭제 사용자를 차단한다.
토큰·자격증명은 로그에 남기지 않는다.
"""
import uuid
from collections.abc import Iterator

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core import security
from app.db.session import get_db as _get_db
from app.models.user import User
from app.repositories import users as users_repo

# tokenUrl은 OpenAPI 문서/폼 로그인 힌트용. 실제 로그인은 JSON 바디를 받는다.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=True)

_CREDENTIALS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="인증에 실패했어요.",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_db() -> Iterator[Session]:
    yield from _get_db()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    try:
        payload = security.decode_access_token(token)
        subject = payload.get("sub")
        user_id = uuid.UUID(str(subject))
    except (jwt.PyJWTError, ValueError, TypeError):
        raise _CREDENTIALS_EXC

    user = users_repo.get_active_by_id(db, user_id)
    if user is None:
        # 미존재/비활성/삭제 사용자 — 토큰이 유효 기간 내여도 차단.
        raise _CREDENTIALS_EXC
    return user
