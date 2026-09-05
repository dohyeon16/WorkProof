"""Persist whether an OAuth bridge transaction is signup or login."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_oauth_bridge_mode"
down_revision: Union[str, None] = "0005_oauth_bridge_sessions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "oauth_bridge_sessions",
        sa.Column("mode", sa.String(length=16), nullable=False, server_default="signup"),
    )


def downgrade() -> None:
    op.drop_column("oauth_bridge_sessions", "mode")
