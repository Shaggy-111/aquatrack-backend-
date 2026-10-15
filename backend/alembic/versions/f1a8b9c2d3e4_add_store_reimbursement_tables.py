"""Add Store Reimbursement tables.

Revision ID: f1a8b9c2d3e4
Revises: d8b3f6a2c9e1
Create Date: 2026-10-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f1a8b9c2d3e4"
down_revision: Union[str, Sequence[str], None] = "d8b3f6a2c9e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. store_reimbursements
    op.create_table(
        "store_reimbursements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reimbursement_number", sa.String(length=50), nullable=False),
        sa.Column("store_id", sa.String(), nullable=False),
        sa.Column("store_name", sa.String(length=255), nullable=False),
        sa.Column("store_channel", sa.String(length=50), nullable=True),
        sa.Column("store_region", sa.String(length=100), nullable=True),
        sa.Column("store_entity", sa.String(length=100), nullable=True),
        sa.Column("poc_id", sa.Integer(), nullable=True),
        sa.Column("poc_name", sa.String(length=255), nullable=True),
        sa.Column("poc_phone", sa.String(length=50), nullable=True),
        sa.Column("purchase_date", sa.Date(), nullable=False),
        sa.Column("total_amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("total_paid", sa.Numeric(precision=10, scale=2), server_default="0.00", nullable=False),
        sa.Column("outstanding_amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("status", sa.String(length=30), server_default="PENDING", nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("instructed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("instructed_by_name", sa.String(length=255), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("approved_by_id", sa.Integer(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_by_id", sa.Integer(), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("cancelled_by_id", sa.Integer(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["approved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["cancelled_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["instructed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["poc_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["rejected_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("total_amount > 0", name="ck_store_reimb_positive_amount"),
        sa.CheckConstraint("total_paid >= 0", name="ck_store_reimb_non_neg_paid"),
        sa.CheckConstraint("outstanding_amount >= 0", name="ck_store_reimb_non_neg_outstanding"),
        sa.CheckConstraint("total_paid <= total_amount", name="ck_store_reimb_paid_lte_total"),
    )
    op.create_index("ix_store_reimbursements_id", "store_reimbursements", ["id"], unique=False)
    op.create_index("ix_store_reimbursements_reimbursement_number", "store_reimbursements", ["reimbursement_number"], unique=True)
    op.create_index("ix_store_reimbursements_store_id", "store_reimbursements", ["store_id"], unique=False)
    op.create_index("ix_store_reimbursements_status", "store_reimbursements", ["status"], unique=False)
    op.create_index("ix_store_reimbursements_purchase_date", "store_reimbursements", ["purchase_date"], unique=False)
    op.create_index("ix_store_reimbursements_created_by_id", "store_reimbursements", ["created_by_id"], unique=False)
    op.create_index("ix_store_reimbursements_instructed_by_user_id", "store_reimbursements", ["instructed_by_user_id"], unique=False)
    op.create_index("ix_store_reimb_store_status", "store_reimbursements", ["store_id", "status"], unique=False)
    op.create_index("ix_store_reimb_date_status", "store_reimbursements", ["purchase_date", "status"], unique=False)

    # 2. store_reimbursement_payments
    op.create_table(
        "store_reimbursement_payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reimbursement_id", sa.Integer(), nullable=False),
        sa.Column("payment_number", sa.String(length=50), nullable=True),
        sa.Column("amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("payment_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payment_mode", sa.String(length=50), nullable=True),
        sa.Column("transaction_reference", sa.String(length=100), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("paid_to_name", sa.String(length=255), nullable=True),
        sa.Column("paid_to_phone", sa.String(length=50), nullable=True),
        sa.Column("paid_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["paid_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reimbursement_id"], ["store_reimbursements.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("amount > 0", name="ck_store_reimb_payment_positive_amount"),
    )
    op.create_index("ix_store_reimbursement_payments_id", "store_reimbursement_payments", ["id"], unique=False)
    op.create_index("ix_store_reimbursement_payments_reimbursement_id", "store_reimbursement_payments", ["reimbursement_id"], unique=False)
    op.create_index("ix_store_reimbursement_payments_payment_date", "store_reimbursement_payments", ["payment_date"], unique=False)
    op.create_index("ix_store_reimbursement_payments_transaction_reference", "store_reimbursement_payments", ["transaction_reference"], unique=False)

    # 3. store_reimbursement_attachments
    op.create_table(
        "store_reimbursement_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reimbursement_id", sa.Integer(), nullable=False),
        sa.Column("payment_id", sa.Integer(), nullable=True),
        sa.Column("attachment_type", sa.String(length=30), server_default="INVOICE", nullable=False),
        sa.Column("file_url", sa.String(length=1000), nullable=False),
        sa.Column("file_public_id", sa.String(length=255), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_type", sa.String(length=100), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("uploaded_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_id", sa.Integer(), nullable=True),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["payment_id"], ["store_reimbursement_payments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reimbursement_id"], ["store_reimbursements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["voided_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_store_reimbursement_attachments_id", "store_reimbursement_attachments", ["id"], unique=False)
    op.create_index("ix_store_reimbursement_attachments_reimbursement_id", "store_reimbursement_attachments", ["reimbursement_id"], unique=False)
    op.create_index("ix_store_reimbursement_attachments_payment_id", "store_reimbursement_attachments", ["payment_id"], unique=False)
    op.create_index("ix_store_reimbursement_attachments_attachment_type", "store_reimbursement_attachments", ["attachment_type"], unique=False)


def downgrade() -> None:
    op.drop_table("store_reimbursement_attachments")
    op.drop_table("store_reimbursement_payments")
    op.drop_table("store_reimbursements")
