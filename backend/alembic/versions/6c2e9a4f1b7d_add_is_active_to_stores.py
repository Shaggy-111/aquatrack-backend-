"""Add is_active to stores.

Revision ID: 6c2e9a4f1b7d
Revises: 3f8a1c2d7e4b
Create Date: 2026-07-25
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "6c2e9a4f1b7d"
down_revision: Union[str, Sequence[str], None] = "3f8a1c2d7e4b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    store_columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("stores")
    }
    if "is_active" not in store_columns:
        op.add_column(
            "stores",
            sa.Column(
                "is_active",
                sa.Boolean(),
                server_default=sa.true(),
                nullable=False,
            ),
        )


def downgrade() -> None:
    store_columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("stores")
    }
    if "is_active" in store_columns:
        op.drop_column("stores", "is_active")
