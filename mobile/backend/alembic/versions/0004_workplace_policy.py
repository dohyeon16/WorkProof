"""workplace payroll policy fields

Phase 3C: 근무지 급여 정책 필드를 workplaces 에 추가한다(별도 리소스 아님 — 근무지당 1:1).
컬럼: pay_day, weekly_allowance, five_or_more_employees, income_deduction_type,
break_minutes_per_shift. 전부 NOT NULL + server_default 라 3B 이전에 동기화된 기존 행도
안전하게 채워진다(이후 모바일이 실제 값으로 update). 순수 additive — 뒤로 호환.
PostgreSQL 기준(check constraint). 0003_work_data 위에 쌓는다.

Revision ID: 0004_workplace_policy
Revises: 0003_work_data
Create Date: 2026-08-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004_workplace_policy"
down_revision: Union[str, None] = "0003_work_data"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# batch_alter_table 로 감싼다: SQLite 는 ALTER ADD CONSTRAINT 를 지원하지 않아 테이블
# 재생성(copy)으로 처리되고, PostgreSQL 은 일반 ALTER 문으로 실행된다(양쪽 호환).
# 상수 server_default 라 PG 11+ 에서는 ADD COLUMN 이 메타데이터 연산(빠름)이다.
def upgrade() -> None:
    with op.batch_alter_table("workplaces") as batch:
        batch.add_column(
            sa.Column(
                "pay_day", sa.Integer(), server_default=sa.text("10"), nullable=False
            )
        )
        batch.add_column(
            sa.Column(
                "weekly_allowance",
                sa.Boolean(),
                server_default=sa.text("true"),
                nullable=False,
            )
        )
        batch.add_column(
            sa.Column(
                "five_or_more_employees",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            )
        )
        batch.add_column(
            sa.Column(
                "income_deduction_type",
                sa.String(length=20),
                server_default=sa.text("'none'"),
                nullable=False,
            )
        )
        batch.add_column(
            sa.Column(
                "break_minutes_per_shift",
                sa.Integer(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )
        batch.create_check_constraint(
            "ck_workplaces_pay_day_range", "pay_day BETWEEN 1 AND 31"
        )
        batch.create_check_constraint(
            "ck_workplaces_break_nonneg", "break_minutes_per_shift >= 0"
        )
        batch.create_check_constraint(
            "ck_workplaces_income_deduction_type",
            "income_deduction_type IN ('none', 'withholding', 'insurance')",
        )


def downgrade() -> None:
    with op.batch_alter_table("workplaces") as batch:
        batch.drop_constraint("ck_workplaces_income_deduction_type", type_="check")
        batch.drop_constraint("ck_workplaces_break_nonneg", type_="check")
        batch.drop_constraint("ck_workplaces_pay_day_range", type_="check")
        batch.drop_column("break_minutes_per_shift")
        batch.drop_column("income_deduction_type")
        batch.drop_column("five_or_more_employees")
        batch.drop_column("weekly_allowance")
        batch.drop_column("pay_day")
