"""Add Attendance integrity and Employee RBAC tables.

Revision ID: b71c4d8e2f90
Revises: f7af6d31b23a
Create Date: 2026-07-10
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b71c4d8e2f90"
down_revision: Union[str, Sequence[str], None] = "f7af6d31b23a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "permissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("module", sa.String(length=100), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("permission_key", sa.String(length=150), nullable=False),
        sa.Column("display_name", sa.String(length=150), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("permission_key", name="uq_permission_key"),
    )
    op.create_index("ix_permissions_id", "permissions", ["id"], unique=False)
    op.create_index(
        "ix_permissions_permission_key",
        "permissions",
        ["permission_key"],
        unique=True,
    )

    op.create_table(
        "employee_permissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("permission_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["assigned_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["permission_id"], ["permissions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "permission_id", name="uq_employee_permission"),
    )
    op.create_index("ix_employee_permissions_id", "employee_permissions", ["id"], unique=False)
    op.create_index(
        "ix_employee_permissions_employee_id",
        "employee_permissions",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_employee_permissions_permission_id",
        "employee_permissions",
        ["permission_id"],
        unique=False,
    )

    op.create_table(
        "employee_store_mapping",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.String(), nullable=False),
        sa.Column("assigned_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assigned_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "store_id", name="uq_employee_store"),
    )
    op.create_index(
        "ix_employee_store_mapping_id",
        "employee_store_mapping",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_employee_store_mapping_employee_id",
        "employee_store_mapping",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_employee_store_mapping_store_id",
        "employee_store_mapping",
        ["store_id"],
        unique=False,
    )

    # Some databases were created by ``Base.metadata.create_all`` from an older
    # Attendance model. Alembic therefore cannot assume the model columns exist
    # before creating the constraints below.
    attendance_columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("attendance")
    }
    with op.batch_alter_table("attendance") as batch_op:
        if "user_id" not in attendance_columns:
            batch_op.add_column(sa.Column("user_id", sa.Integer(), nullable=False))
            batch_op.create_foreign_key(
                "fk_attendance_user_id_users", "users", ["user_id"], ["id"]
            )
        if "date" not in attendance_columns:
            batch_op.add_column(sa.Column("date", sa.Date(), nullable=False))
        if "check_in_time" not in attendance_columns:
            batch_op.add_column(
                sa.Column("check_in_time", sa.DateTime(timezone=True), nullable=True)
            )
        if "check_out_time" not in attendance_columns:
            batch_op.add_column(
                sa.Column("check_out_time", sa.DateTime(timezone=True), nullable=True)
            )
        if "status" not in attendance_columns:
            batch_op.add_column(sa.Column("status", sa.String(), nullable=True))
        if "latitude" not in attendance_columns:
            batch_op.add_column(sa.Column("latitude", sa.Float(), nullable=True))
        if "longitude" not in attendance_columns:
            batch_op.add_column(sa.Column("longitude", sa.Float(), nullable=True))
        if "working_hours" not in attendance_columns:
            batch_op.add_column(sa.Column("working_hours", sa.Float(), nullable=True))

    with op.batch_alter_table("attendance") as batch_op:
        batch_op.create_unique_constraint("uq_attendance_user_date", ["user_id", "date"])
        batch_op.create_check_constraint(
            "ck_attendance_latitude_range",
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
        )
        batch_op.create_check_constraint(
            "ck_attendance_longitude_range",
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
        )
        batch_op.create_check_constraint(
            "ck_attendance_checkout_requires_checkin",
            "check_out_time IS NULL OR check_in_time IS NOT NULL",
        )
        batch_op.create_check_constraint(
            "ck_attendance_time_sequence",
            "check_out_time IS NULL OR check_out_time >= check_in_time",
        )
        batch_op.create_index("ix_attendance_date", ["date"], unique=False)

    with op.batch_alter_table("leaves") as batch_op:
        batch_op.add_column(sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("rejected_by", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("rejection_reason", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_leaves_rejected_by_users",
            "users",
            ["rejected_by"],
            ["id"],
        )
        batch_op.create_check_constraint("ck_leave_date_sequence", "to_date >= from_date")
        batch_op.create_index(
            "ix_leaves_user_dates",
            ["user_id", "from_date", "to_date"],
            unique=False,
        )
        batch_op.create_index("ix_leaves_status", ["status"], unique=False)

    with op.batch_alter_table("holidays") as batch_op:
        batch_op.create_unique_constraint("uq_holidays_date", ["date"])


def downgrade() -> None:
    with op.batch_alter_table("holidays") as batch_op:
        batch_op.drop_constraint("uq_holidays_date", type_="unique")

    with op.batch_alter_table("leaves") as batch_op:
        batch_op.drop_index("ix_leaves_status")
        batch_op.drop_index("ix_leaves_user_dates")
        batch_op.drop_constraint("ck_leave_date_sequence", type_="check")
        batch_op.drop_constraint("fk_leaves_rejected_by_users", type_="foreignkey")
        batch_op.drop_column("rejection_reason")
        batch_op.drop_column("rejected_at")
        batch_op.drop_column("rejected_by")
        batch_op.drop_column("approved_at")

    with op.batch_alter_table("attendance") as batch_op:
        batch_op.drop_index("ix_attendance_date")
        batch_op.drop_constraint("ck_attendance_time_sequence", type_="check")
        batch_op.drop_constraint("ck_attendance_checkout_requires_checkin", type_="check")
        batch_op.drop_constraint("ck_attendance_longitude_range", type_="check")
        batch_op.drop_constraint("ck_attendance_latitude_range", type_="check")
        batch_op.drop_constraint("uq_attendance_user_date", type_="unique")

    op.drop_index("ix_employee_store_mapping_store_id", table_name="employee_store_mapping")
    op.drop_index("ix_employee_store_mapping_employee_id", table_name="employee_store_mapping")
    op.drop_index("ix_employee_store_mapping_id", table_name="employee_store_mapping")
    op.drop_table("employee_store_mapping")

    op.drop_index("ix_employee_permissions_permission_id", table_name="employee_permissions")
    op.drop_index("ix_employee_permissions_employee_id", table_name="employee_permissions")
    op.drop_index("ix_employee_permissions_id", table_name="employee_permissions")
    op.drop_table("employee_permissions")

    op.drop_index("ix_permissions_permission_key", table_name="permissions")
    op.drop_index("ix_permissions_id", table_name="permissions")
    op.drop_table("permissions")
