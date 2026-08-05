"""work-data 목록 endpoint 공통 의존성: 페이지네이션 + 날짜/근무지 필터."""
import uuid
from dataclasses import dataclass
from datetime import date

from fastapi import HTTPException, Query, status


@dataclass
class Pagination:
    limit: int
    offset: int


def pagination(
    limit: int = Query(50, ge=1, le=200, description="최대 200"),
    offset: int = Query(0, ge=0),
) -> Pagination:
    return Pagination(limit=limit, offset=offset)


@dataclass
class ListFilters:
    workplace_id: uuid.UUID | None
    date_from: date | None
    date_to: date | None


def list_filters(
    workplace_id: uuid.UUID | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
) -> ListFilters:
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "date_from 이 date_to 보다 늦을 수 없어요.",
        )
    return ListFilters(workplace_id=workplace_id, date_from=date_from, date_to=date_to)
