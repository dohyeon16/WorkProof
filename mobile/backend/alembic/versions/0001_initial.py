"""initial empty baseline

Phase 1: 테이블 없음. 사용자/데이터 모델과 실제 스키마는 Phase 2+에서 추가한다.
이 리비전은 Alembic 이력의 시작점(baseline)만 잡는 빈 마이그레이션이다.

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-30
"""
from typing import Sequence, Union

from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
