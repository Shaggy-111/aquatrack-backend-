"""Add monthly virtual cards.

Revision ID: a1f4c8d2e6b0
Revises: 9d4b7e2a1c65
Create Date: 2026-08-03
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1f4c8d2e6b0"
down_revision: Union[str, Sequence[str], None] = "9d4b7e2a1c65"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "monthly_virtual_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.String(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "month >= 1 AND month <= 12",
            name="ck_monthly_virtual_card_month",
        ),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "store_id",
            "year",
            "month",
            name="uq_monthly_virtual_card_store_year_month",
        ),
    )
    op.create_index(
        "ix_monthly_virtual_cards_id",
        "monthly_virtual_cards",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_virtual_cards_store_id",
        "monthly_virtual_cards",
        ["store_id"],
        unique=False,
    )

    op.create_table(
        "monthly_virtual_card_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("entry_source", sa.String(length=30), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["card_id"], ["monthly_virtual_cards.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "card_id",
            "entry_date",
            name="uq_monthly_virtual_card_entry_date",
        ),
    )
    op.create_index(
        "ix_monthly_virtual_card_entries_id",
        "monthly_virtual_card_entries",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_virtual_card_entries_card_id",
        "monthly_virtual_card_entries",
        ["card_id"],
        unique=False,
    )

    op.create_table(
        "monthly_virtual_card_entry_orders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("entry_id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["entry_id"], ["monthly_virtual_card_entries.id"]),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "entry_id",
            "order_id",
            name="uq_monthly_virtual_card_entry_order",
        ),
    )
    op.create_index(
        "ix_monthly_virtual_card_entry_orders_id",
        "monthly_virtual_card_entry_orders",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_virtual_card_entry_orders_entry_id",
        "monthly_virtual_card_entry_orders",
        ["entry_id"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_virtual_card_entry_orders_order_id",
        "monthly_virtual_card_entry_orders",
        ["order_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_monthly_virtual_card_entry_orders_order_id",
        table_name="monthly_virtual_card_entry_orders",
    )
    op.drop_index(
        "ix_monthly_virtual_card_entry_orders_entry_id",
        table_name="monthly_virtual_card_entry_orders",
    )
    op.drop_index(
        "ix_monthly_virtual_card_entry_orders_id",
        table_name="monthly_virtual_card_entry_orders",
    )
    op.drop_table("monthly_virtual_card_entry_orders")

    op.drop_index(
        "ix_monthly_virtual_card_entries_card_id",
        table_name="monthly_virtual_card_entries",
    )
    op.drop_index(
        "ix_monthly_virtual_card_entries_id",
        table_name="monthly_virtual_card_entries",
    )
    op.drop_table("monthly_virtual_card_entries")

    op.drop_index(
        "ix_monthly_virtual_cards_store_id",
        table_name="monthly_virtual_cards",
    )
    op.drop_index(
        "ix_monthly_virtual_cards_id",
        table_name="monthly_virtual_cards",
    )
    op.drop_table("monthly_virtual_cards")
