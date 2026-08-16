"""Recreate the empty attendance table with the correct primary key.

Revision ID: e4a91c7d2f36
Revises: c84d2f1a9e73
Create Date: 2026-07-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e4a91c7d2f36"
down_revision: Union[str, Sequence[str], None] = "c84d2f1a9e73"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Production is confirmed empty. Rebuilding avoids retaining the manually
    # created TEXT primary key or any other out-of-band schema differences.
    op.drop_table("attendance")
    op.execute("DROP SEQUENCE IF EXISTS attendance_id_seq")
    op.execute("CREATE SEQUENCE attendance_id_seq AS integer")

    op.create_table(
        "attendance",
        sa.Column(
            "id",
            sa.Integer(),
            server_default=sa.text("nextval('attendance_id_seq'::regclass)"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("check_in_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("check_out_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("working_hours", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.CheckConstraint(
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
            name="ck_attendance_latitude_range",
        ),
        sa.CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="ck_attendance_longitude_range",
        ),
        sa.CheckConstraint(
            "check_out_time IS NULL OR check_in_time IS NOT NULL",
            name="ck_attendance_checkout_requires_checkin",
        ),
        sa.CheckConstraint(
            "check_out_time IS NULL OR check_out_time >= check_in_time",
            name="ck_attendance_time_sequence",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id", name="attendance_pkey"),
        sa.UniqueConstraint("user_id", "date", name="uq_attendance_user_date"),
    )

    op.execute("ALTER SEQUENCE attendance_id_seq OWNED BY attendance.id")
    op.create_index("ix_attendance_id", "attendance", ["id"], unique=False)
    op.create_index("ix_attendance_date", "attendance", ["date"], unique=False)


def downgrade() -> None:
    op.drop_table("attendance")
    op.execute("DROP SEQUENCE IF EXISTS attendance_id_seq")

    op.create_table(
        "attendance",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("check_in_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("check_out_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("working_hours", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id", name="attendance_pkey"),
    )
