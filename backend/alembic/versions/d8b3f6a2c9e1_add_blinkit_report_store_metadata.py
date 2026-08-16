"""Add Blinkit report store metadata.

Revision ID: d8b3f6a2c9e1
Revises: c3e7a9b1d5f2
Create Date: 2026-08-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d8b3f6a2c9e1"
down_revision: Union[str, Sequence[str], None] = "c3e7a9b1d5f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "blinkit_report_store_metadata",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.String(), nullable=False),
        sa.Column("citi_lead", sa.String(length=255), nullable=True),
        sa.Column("mode_of_ops", sa.String(length=100), nullable=True),
        sa.Column("live_date", sa.Date(), nullable=True),
        sa.Column("supply_start_date", sa.Date(), nullable=True),
        sa.Column("report_status", sa.String(length=100), nullable=True),
        sa.Column("closed_dropped_date", sa.Date(), nullable=True),
        sa.Column("admin_poc", sa.String(length=255), nullable=True),
        sa.Column("contact_no", sa.String(length=100), nullable=True),
        sa.Column("vendor_name", sa.String(length=255), nullable=True),
        sa.Column("vendor_rate", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_blinkit_report_store_metadata_store_id",
        "blinkit_report_store_metadata",
        ["store_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_blinkit_report_store_metadata_store_id",
        table_name="blinkit_report_store_metadata",
    )
    op.drop_table("blinkit_report_store_metadata")
