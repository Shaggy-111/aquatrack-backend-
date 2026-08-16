"""Add soft-delete lifecycle fields to users.

Revision ID: c84d2f1a9e73
Revises: b71c4d8e2f90
Create Date: 2026-07-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c84d2f1a9e73"
down_revision: Union[str, Sequence[str], None] = "b71c4d8e2f90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_deleted",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("deleted_by", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_deleted_by_users",
        "users",
        "users",
        ["deleted_by"],
        ["id"],
    )
    op.create_index(
        "ix_users_is_deleted",
        "users",
        ["is_deleted"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_users_is_deleted", table_name="users")
    op.drop_constraint(
        "fk_users_deleted_by_users",
        "users",
        type_="foreignkey",
    )
    op.drop_column("users", "deleted_by")
    op.drop_column("users", "deleted_at")
    op.drop_column("users", "is_deleted")
