"""Add entity to stores.

Revision ID: 3f8a1c2d7e4b
Revises: e4a91c7d2f36
Create Date: 2026-07-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "3f8a1c2d7e4b"
down_revision: Union[str, Sequence[str], None] = "e4a91c7d2f36"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    store_columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("stores")
    }
    if "entity" not in store_columns:
        op.add_column(
            "stores",
            sa.Column("entity", sa.String(length=100), nullable=True),
        )


def downgrade() -> None:
    store_columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("stores")
    }
    if "entity" in store_columns:
        op.drop_column("stores", "entity")
