"""Convert attendance timestamps from IST wall-clock values to timestamptz.

Revision ID: c3e7a9b1d5f2
Revises: a1f4c8d2e6b0
Create Date: 2026-08-05
"""

from typing import Sequence, Union

from alembic import op


revision: str = "c3e7a9b1d5f2"
down_revision: Union[str, Sequence[str], None] = "a1f4c8d2e6b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ATTENDANCE_TIMESTAMP_COLUMNS = (
    "check_in_time",
    "check_out_time",
    "created_at",
)


def upgrade() -> None:
    for column in ATTENDANCE_TIMESTAMP_COLUMNS:
        op.execute(
            f"""ALTER TABLE attendance
ALTER COLUMN {column}
TYPE TIMESTAMP WITH TIME ZONE
USING {column} AT TIME ZONE 'Asia/Kolkata'"""
        )


def downgrade() -> None:
    for column in ATTENDANCE_TIMESTAMP_COLUMNS:
        op.execute(
            f"""ALTER TABLE attendance
ALTER COLUMN {column}
TYPE TIMESTAMP WITHOUT TIME ZONE
USING {column} AT TIME ZONE 'Asia/Kolkata'"""
        )
