"""Add Store QR delivery support.

Revision ID: 9d4b7e2a1c65
Revises: 6c2e9a4f1b7d
Create Date: 2026-07-27
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = "9d4b7e2a1c65"
down_revision: Union[str, Sequence[str], None] = "6c2e9a4f1b7d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    store_columns = {
        column["name"] for column in inspector.get_columns("stores")
    }

    if "qr_public_id" not in store_columns:
        op.add_column(
            "stores",
            sa.Column("qr_public_id", sa.String(length=36), nullable=True),
        )
        store_ids = bind.execute(sa.text("SELECT id FROM stores")).scalars().all()
        for store_id in store_ids:
            bind.execute(
                sa.text(
                    "UPDATE stores SET qr_public_id = :qr_public_id WHERE id = :store_id"
                ),
                {"qr_public_id": str(uuid.uuid4()), "store_id": store_id},
            )
        op.alter_column("stores", "qr_public_id", nullable=False)
        op.create_index(
            "ix_stores_qr_public_id",
            "stores",
            ["qr_public_id"],
            unique=True,
        )

    if "qr_token_version" not in store_columns:
        op.add_column(
            "stores",
            sa.Column(
                "qr_token_version",
                sa.Integer(),
                server_default="1",
                nullable=False,
            ),
        )

    if "qr_enabled" not in store_columns:
        op.add_column(
            "stores",
            sa.Column(
                "qr_enabled",
                sa.Boolean(),
                server_default=sa.true(),
                nullable=False,
            ),
        )

    inspector = sa.inspect(bind)
    if "store_qr_delivery_submissions" not in inspector.get_table_names():
        op.create_table(
            "store_qr_delivery_submissions",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("store_id", sa.String(), nullable=False),
            sa.Column("order_id", sa.Integer(), nullable=False),
            sa.Column("idempotency_key", sa.String(length=36), nullable=False),
            sa.Column("token_jti", sa.String(length=36), nullable=False),
            sa.Column("qr_token_version", sa.Integer(), nullable=False),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("source_ip", sa.String(length=64), nullable=True),
            sa.Column("user_agent", sa.Text(), nullable=True),
            sa.Column("latitude", sa.Float(), nullable=True),
            sa.Column("longitude", sa.Float(), nullable=True),
            sa.Column("gps_accuracy", sa.Float(), nullable=True),
            sa.Column("delivered_by", sa.String(length=255), nullable=True),
            sa.Column("photo_url", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column(
                "created_order",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
            sa.ForeignKeyConstraint(["store_id"], ["stores.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_store_qr_delivery_submissions_idempotency_key",
            "store_qr_delivery_submissions",
            ["idempotency_key"],
            unique=True,
        )
        op.create_index(
            "ix_store_qr_delivery_submissions_token_jti",
            "store_qr_delivery_submissions",
            ["token_jti"],
            unique=True,
        )
        op.create_index(
            "ix_store_qr_delivery_submissions_order_id",
            "store_qr_delivery_submissions",
            ["order_id"],
        )
        op.create_index(
            "ix_store_qr_delivery_submissions_store_id",
            "store_qr_delivery_submissions",
            ["store_id"],
        )
        op.create_index(
            "ix_store_qr_delivery_submissions_submitted_at",
            "store_qr_delivery_submissions",
            ["submitted_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "store_qr_delivery_submissions" in inspector.get_table_names():
        op.drop_table("store_qr_delivery_submissions")

    store_columns = {
        column["name"] for column in sa.inspect(bind).get_columns("stores")
    }
    if "qr_enabled" in store_columns:
        op.drop_column("stores", "qr_enabled")
    if "qr_token_version" in store_columns:
        op.drop_column("stores", "qr_token_version")
    if "qr_public_id" in store_columns:
        op.drop_index("ix_stores_qr_public_id", table_name="stores")
        op.drop_column("stores", "qr_public_id")
