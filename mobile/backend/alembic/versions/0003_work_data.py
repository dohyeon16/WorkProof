"""work data tables: workplaces, work_schedules, attendance_records

Phase 3A: 근무지·근무예정·출퇴근 기록. Phase 2(0002_auth_tables) 위에 쌓는다.
PostgreSQL 기준(timestamptz, check constraint). SQLite 전용 문법은 쓰지 않는다.
모든 리소스는 소유자(user_id)·오프라인 동기화 키(client_id, user 범위 unique)·
soft-delete(deleted_at)를 공유한다. 근무지는 soft-delete 라 근무예정/출퇴근을 하드
cascade 하지 않는다(과거 기록 보존).

Revision ID: 0003_work_data
Revises: 0002_auth_tables
Create Date: 2026-08-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_work_data"
down_revision: Union[str, None] = "0002_auth_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TIMESTAMPS = (
    sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    ),
    sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    ),
    sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
)


def upgrade() -> None:
    op.create_table(
        "workplaces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("client_id", sa.String(length=128), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("hourly_wage", sa.Integer(), nullable=False),
        sa.Column("address", sa.String(length=500), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        *_TIMESTAMPS,
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "client_id", name="uq_workplaces_user_client"),
        sa.CheckConstraint("hourly_wage >= 0", name="ck_workplaces_wage_nonneg"),
        sa.CheckConstraint(
            "latitude IS NULL AND longitude IS NULL "
            "OR latitude IS NOT NULL AND longitude IS NOT NULL",
            name="ck_workplaces_coords_paired",
        ),
        sa.CheckConstraint(
            "latitude IS NULL OR latitude BETWEEN -90 AND 90",
            name="ck_workplaces_lat_range",
        ),
        sa.CheckConstraint(
            "longitude IS NULL OR longitude BETWEEN -180 AND 180",
            name="ck_workplaces_lon_range",
        ),
    )
    op.create_index("ix_workplaces_user_active", "workplaces", ["user_id", "deleted_at"])

    op.create_table(
        "work_schedules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("client_id", sa.String(length=128), nullable=True),
        sa.Column("workplace_id", sa.Uuid(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.String(length=5), nullable=False),
        sa.Column("end_time", sa.String(length=5), nullable=True),
        sa.Column(
            "reminder_minutes",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        *_TIMESTAMPS,
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workplace_id"], ["workplaces.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "client_id", name="uq_work_schedules_user_client"
        ),
    )
    op.create_index(
        "ix_work_schedules_user_date", "work_schedules", ["user_id", "work_date"]
    )
    op.create_index(
        "ix_work_schedules_user_workplace",
        "work_schedules",
        ["user_id", "workplace_id"],
    )
    op.create_index(
        "ix_work_schedules_user_active", "work_schedules", ["user_id", "deleted_at"]
    )

    op.create_table(
        "attendance_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("client_id", sa.String(length=128), nullable=True),
        sa.Column("workplace_id", sa.Uuid(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("clock_in", sa.String(length=5), nullable=False),
        sa.Column("clock_out", sa.String(length=5), nullable=True),
        sa.Column(
            "break_minutes", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column("note", sa.String(length=2000), nullable=True),
        sa.Column(
            "is_holiday",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("clock_in_latitude", sa.Float(), nullable=True),
        sa.Column("clock_in_longitude", sa.Float(), nullable=True),
        sa.Column("clock_out_latitude", sa.Float(), nullable=True),
        sa.Column("clock_out_longitude", sa.Float(), nullable=True),
        *_TIMESTAMPS,
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workplace_id"], ["workplaces.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "client_id", name="uq_attendance_records_user_client"
        ),
        sa.CheckConstraint("break_minutes >= 0", name="ck_attendance_break_nonneg"),
        sa.CheckConstraint(
            "clock_in_latitude IS NULL AND clock_in_longitude IS NULL "
            "OR clock_in_latitude IS NOT NULL AND clock_in_longitude IS NOT NULL",
            name="ck_attendance_clockin_coords_paired",
        ),
        sa.CheckConstraint(
            "clock_out_latitude IS NULL AND clock_out_longitude IS NULL "
            "OR clock_out_latitude IS NOT NULL AND clock_out_longitude IS NOT NULL",
            name="ck_attendance_clockout_coords_paired",
        ),
        sa.CheckConstraint(
            "clock_in_latitude IS NULL OR clock_in_latitude BETWEEN -90 AND 90",
            name="ck_attendance_clockin_lat_range",
        ),
        sa.CheckConstraint(
            "clock_in_longitude IS NULL OR clock_in_longitude BETWEEN -180 AND 180",
            name="ck_attendance_clockin_lon_range",
        ),
        sa.CheckConstraint(
            "clock_out_latitude IS NULL OR clock_out_latitude BETWEEN -90 AND 90",
            name="ck_attendance_clockout_lat_range",
        ),
        sa.CheckConstraint(
            "clock_out_longitude IS NULL OR clock_out_longitude BETWEEN -180 AND 180",
            name="ck_attendance_clockout_lon_range",
        ),
    )
    op.create_index(
        "ix_attendance_records_user_date",
        "attendance_records",
        ["user_id", "work_date"],
    )
    op.create_index(
        "ix_attendance_records_user_workplace",
        "attendance_records",
        ["user_id", "workplace_id"],
    )
    op.create_index(
        "ix_attendance_records_user_active",
        "attendance_records",
        ["user_id", "deleted_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_attendance_records_user_active", table_name="attendance_records"
    )
    op.drop_index(
        "ix_attendance_records_user_workplace", table_name="attendance_records"
    )
    op.drop_index("ix_attendance_records_user_date", table_name="attendance_records")
    op.drop_table("attendance_records")

    op.drop_index("ix_work_schedules_user_active", table_name="work_schedules")
    op.drop_index("ix_work_schedules_user_workplace", table_name="work_schedules")
    op.drop_index("ix_work_schedules_user_date", table_name="work_schedules")
    op.drop_table("work_schedules")

    op.drop_index("ix_workplaces_user_active", table_name="workplaces")
    op.drop_table("workplaces")
