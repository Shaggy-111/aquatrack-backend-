"""Add Store Compliance Monthly tables.

Revision ID: b4c8d9e1f2a3
Revises: f1a8b9c2d3e4
Create Date: 2026-10-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b4c8d9e1f2a3"
down_revision: Union[str, Sequence[str], None] = "f1a8b9c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. store_monthly_compliances
    op.create_table(
        "store_monthly_compliances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("compliance_number", sa.String(length=50), nullable=False),
        sa.Column("store_id", sa.String(length=100), nullable=False),
        sa.Column("store_name", sa.String(length=255), nullable=False),
        sa.Column("store_channel", sa.String(length=50), nullable=True),
        sa.Column("store_region", sa.String(length=100), nullable=True),
        sa.Column("store_entity", sa.String(length=100), nullable=True),
        sa.Column("delivery_manager_id", sa.Integer(), nullable=True),
        sa.Column("delivery_manager_name", sa.String(length=255), nullable=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("card_status", sa.String(length=30), server_default="PENDING_CARD", nullable=False),
        sa.Column("card_file_url", sa.String(length=1000), nullable=True),
        sa.Column("card_file_name", sa.String(length=255), nullable=True),
        sa.Column("card_file_size", sa.Integer(), nullable=True),
        sa.Column("card_file_type", sa.String(length=100), nullable=True),
        sa.Column("card_file_public_id", sa.String(length=255), nullable=True),
        sa.Column("card_remarks", sa.Text(), nullable=True),
        sa.Column("card_uploaded_by_id", sa.Integer(), nullable=True),
        sa.Column("card_uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["card_uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["delivery_manager_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("compliance_number"),
        sa.UniqueConstraint("store_id", "year", "month", name="uq_store_year_month"),
        sa.CheckConstraint("month >= 1 AND month <= 12", name="ck_monthly_compliance_month_range"),
        sa.CheckConstraint("year >= 2000 AND year <= 2100", name="ck_monthly_compliance_year_range"),
    )
    op.create_index(op.f("ix_store_monthly_compliances_compliance_number"), "store_monthly_compliances", ["compliance_number"], unique=True)
    op.create_index(op.f("ix_store_monthly_compliances_store_id"), "store_monthly_compliances", ["store_id"], unique=False)
    op.create_index(op.f("ix_store_monthly_compliances_store_region"), "store_monthly_compliances", ["store_region"], unique=False)
    op.create_index(op.f("ix_store_monthly_compliances_store_entity"), "store_monthly_compliances", ["store_entity"], unique=False)
    op.create_index(op.f("ix_store_monthly_compliances_year"), "store_monthly_compliances", ["year"], unique=False)
    op.create_index(op.f("ix_store_monthly_compliances_month"), "store_monthly_compliances", ["month"], unique=False)
    op.create_index("ix_smc_store_year_month", "store_monthly_compliances", ["store_id", "year", "month"], unique=False)
    op.create_index("ix_smc_year_month", "store_monthly_compliances", ["year", "month"], unique=False)
    op.create_index("ix_smc_region_year_month", "store_monthly_compliances", ["store_region", "year", "month"], unique=False)
    op.create_index("ix_smc_card_status", "store_monthly_compliances", ["card_status"], unique=False)

    # 2. store_compliance_invoices
    op.create_table(
        "store_compliance_invoices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("monthly_compliance_id", sa.Integer(), nullable=False),
        sa.Column("invoice_number", sa.String(length=100), nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("invoice_amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("total_paid", sa.Numeric(precision=10, scale=2), server_default="0.00", nullable=False),
        sa.Column("outstanding_amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("payment_status", sa.String(length=30), server_default="UNPAID", nullable=False),
        sa.Column("file_url", sa.String(length=1000), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("file_type", sa.String(length=100), nullable=False),
        sa.Column("file_public_id", sa.String(length=255), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["monthly_compliance_id"], ["store_monthly_compliances.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("monthly_compliance_id"),
        sa.CheckConstraint("invoice_amount > 0.00", name="ck_compliance_invoice_amount_positive"),
        sa.CheckConstraint("total_paid >= 0.00", name="ck_compliance_invoice_total_paid_nonnegative"),
        sa.CheckConstraint("outstanding_amount >= 0.00", name="ck_compliance_invoice_outstanding_nonnegative"),
        sa.CheckConstraint("total_paid <= invoice_amount", name="ck_compliance_invoice_paid_not_exceed_amount"),
    )
    op.create_index(op.f("ix_store_compliance_invoices_invoice_number"), "store_compliance_invoices", ["invoice_number"], unique=False)
    op.create_index(op.f("ix_store_compliance_invoices_invoice_date"), "store_compliance_invoices", ["invoice_date"], unique=False)
    op.create_index(op.f("ix_store_compliance_invoices_payment_status"), "store_compliance_invoices", ["payment_status"], unique=False)

    # 3. store_compliance_payments
    op.create_table(
        "store_compliance_payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("payment_number", sa.String(length=50), nullable=False),
        sa.Column("amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("payment_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payment_mode", sa.String(length=50), server_default="UPI", nullable=False),
        sa.Column("transaction_reference", sa.String(length=100), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("paid_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["invoice_id"], ["store_compliance_invoices.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["paid_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payment_number", name="uq_store_compliance_payment_number"),
        sa.CheckConstraint("amount > 0.00", name="ck_compliance_payment_amount_positive"),
    )
    op.create_index(op.f("ix_store_compliance_payments_invoice_id"), "store_compliance_payments", ["invoice_id"], unique=False)
    op.create_index(op.f("ix_store_compliance_payments_payment_number"), "store_compliance_payments", ["payment_number"], unique=True)
    op.create_index(op.f("ix_store_compliance_payments_transaction_reference"), "store_compliance_payments", ["transaction_reference"], unique=False)
    op.create_index("ix_sc_pay_invoice_date", "store_compliance_payments", ["invoice_id", "payment_date"], unique=False)

    # 4. store_compliance_attachments
    op.create_table(
        "store_compliance_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("monthly_compliance_id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=True),
        sa.Column("payment_id", sa.Integer(), nullable=True),
        sa.Column("attachment_type", sa.String(length=50), server_default="OTHER", nullable=False),
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
        sa.ForeignKeyConstraint(["invoice_id"], ["store_compliance_invoices.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["monthly_compliance_id"], ["store_monthly_compliances.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["payment_id"], ["store_compliance_payments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["voided_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_store_compliance_attachments_monthly_compliance_id"), "store_compliance_attachments", ["monthly_compliance_id"], unique=False)
    op.create_index(op.f("ix_store_compliance_attachments_invoice_id"), "store_compliance_attachments", ["invoice_id"], unique=False)
    op.create_index(op.f("ix_store_compliance_attachments_payment_id"), "store_compliance_attachments", ["payment_id"], unique=False)
    op.create_index(op.f("ix_store_compliance_attachments_attachment_type"), "store_compliance_attachments", ["attachment_type"], unique=False)
    op.create_index("ix_sc_att_compliance_type", "store_compliance_attachments", ["monthly_compliance_id", "attachment_type"], unique=False)
    op.create_index("ix_sc_att_voided", "store_compliance_attachments", ["voided_at"], unique=False)


def downgrade() -> None:
    op.drop_table("store_compliance_attachments")
    op.drop_table("store_compliance_payments")
    op.drop_table("store_compliance_invoices")
    op.drop_table("store_monthly_compliances")
