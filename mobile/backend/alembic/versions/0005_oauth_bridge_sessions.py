"""Persist OAuth bridge sessions across Render instances."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_oauth_bridge_sessions"
down_revision: Union[str, None] = "0004_workplace_policy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "oauth_bridge_sessions",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("profile", sa.JSON(), nullable=True),
        sa.Column("message", sa.String(length=255), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("provider_error", sa.String(length=64), nullable=True),
        sa.Column("provider_error_code", sa.String(length=64), nullable=True),
        sa.Column("return_url", sa.String(length=2048), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("oauth_bridge_sessions")
