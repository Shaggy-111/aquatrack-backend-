"""Models for Store Compliance Phase 2 (Monthly workflow with Invoices and Payments)."""

from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from ..database.db import Base


class StoreMonthlyCardStatus(str, Enum):
    PENDING_CARD = "PENDING_CARD"
    CARD_UPLOADED = "CARD_UPLOADED"


class StoreCompliancePaymentStatus(str, Enum):
    UNPAID = "UNPAID"
    PARTIALLY_PAID = "PARTIALLY_PAID"
    PAID = "PAID"


class StoreCompliancePaymentMode(str, Enum):
    UPI = "UPI"
    IMPS = "IMPS"
    NEFT = "NEFT"
    BANK_TRANSFER = "BANK_TRANSFER"
    CASH = "CASH"
    OTHER = "OTHER"


class StoreComplianceAttachmentType(str, Enum):
    CARD = "CARD"
    INVOICE = "INVOICE"
    PAYMENT_PROOF = "PAYMENT_PROOF"
    OTHER = "OTHER"


class StoreMonthlyCompliance(Base):
    __tablename__ = "store_monthly_compliances"

    id = Column(Integer, primary_key=True, index=True)
    compliance_number = Column(String(50), unique=True, index=True, nullable=False)

    # Store link and snapshot metadata
    store_id = Column(
        String,
        ForeignKey("stores.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    store_name = Column(String(255), nullable=False)
    store_channel = Column(String(50), nullable=True)
    store_region = Column(String(100), nullable=True)
    store_entity = Column(String(100), nullable=True)

    # Delivery Manager snapshot attribution
    delivery_manager_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    delivery_manager_name = Column(String(255), nullable=True)

    # Accounting Period
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)

    # Monthly Water Card State & Current Primary File
    card_status = Column(
        String(30),
        nullable=False,
        default=StoreMonthlyCardStatus.PENDING_CARD.value,
        index=True,
    )
    card_file_url = Column(String(1000), nullable=True)
    card_file_name = Column(String(255), nullable=True)
    card_file_size = Column(Integer, nullable=True)
    card_file_type = Column(String(100), nullable=True)
    card_file_public_id = Column(String(255), nullable=True)
    card_remarks = Column(Text, nullable=True)
    card_uploaded_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    card_uploaded_at = Column(DateTime(timezone=True), nullable=True)

    # Audit tracking
    created_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    updated_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships (Notice: NO delete-orphan to preserve financial history)
    store = relationship("Store", foreign_keys=[store_id])
    delivery_manager = relationship("User", foreign_keys=[delivery_manager_id])
    card_uploaded_by = relationship("User", foreign_keys=[card_uploaded_by_id])
    created_by = relationship("User", foreign_keys=[created_by_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])

    invoice = relationship(
        "StoreComplianceInvoice",
        back_populates="monthly_compliance",
        uselist=False,
    )
    attachments = relationship(
        "StoreComplianceAttachment",
        back_populates="monthly_compliance",
        order_by="StoreComplianceAttachment.created_at.asc()",
    )

    __table_args__ = (
        UniqueConstraint(
            "store_id",
            "year",
            "month",
            name="uq_store_monthly_compliance_store_year_month",
        ),
        CheckConstraint(
            "month >= 1 AND month <= 12",
            name="ck_store_monthly_compliance_month_range",
        ),
        CheckConstraint(
            "card_status IN ('PENDING_CARD', 'CARD_UPLOADED')",
            name="ck_store_monthly_compliance_valid_card_status",
        ),
        Index("ix_store_monthly_comp_period", "year", "month"),
        Index("ix_store_monthly_comp_store_status", "store_id", "card_status"),
    )


class StoreComplianceInvoice(Base):
    __tablename__ = "store_compliance_invoices"

    id = Column(Integer, primary_key=True, index=True)
    monthly_compliance_id = Column(
        Integer,
        ForeignKey("store_monthly_compliances.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
        index=True,
    )

    invoice_number = Column(String(100), nullable=False, index=True)
    invoice_date = Column(Date, nullable=False, index=True)

    # Strict Currency Figures (Numeric 10, 2)
    invoice_amount = Column(Numeric(10, 2), nullable=False)
    total_paid = Column(Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    outstanding_amount = Column(Numeric(10, 2), nullable=False)

    payment_status = Column(
        String(30),
        nullable=False,
        default=StoreCompliancePaymentStatus.UNPAID.value,
        index=True,
    )

    # Primary Invoice Attachment (Required)
    file_url = Column(String(1000), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=False)
    file_type = Column(String(100), nullable=False)
    file_public_id = Column(String(255), nullable=True)
    remarks = Column(Text, nullable=True)

    created_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    updated_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    monthly_compliance = relationship(
        "StoreMonthlyCompliance",
        back_populates="invoice",
    )
    payments = relationship(
        "StoreCompliancePayment",
        back_populates="invoice",
        order_by="StoreCompliancePayment.payment_date.asc()",
    )
    attachments = relationship(
        "StoreComplianceAttachment",
        back_populates="invoice",
        order_by="StoreComplianceAttachment.created_at.asc()",
    )
    created_by = relationship("User", foreign_keys=[created_by_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])

    __table_args__ = (
        CheckConstraint("invoice_amount > 0", name="ck_store_comp_inv_positive_amount"),
        CheckConstraint("total_paid >= 0", name="ck_store_comp_inv_non_neg_paid"),
        CheckConstraint("outstanding_amount >= 0", name="ck_store_comp_inv_non_neg_outstanding"),
        CheckConstraint("total_paid <= invoice_amount", name="ck_store_comp_inv_paid_lte_amount"),
        CheckConstraint(
            "payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')",
            name="ck_store_comp_inv_valid_payment_status",
        ),
        Index("ix_store_comp_inv_date_status", "invoice_date", "payment_status"),
    )


class StoreCompliancePayment(Base):
    __tablename__ = "store_compliance_payments"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(
        Integer,
        ForeignKey("store_compliance_invoices.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    payment_number = Column(String(50), nullable=False, unique=True, index=True)

    amount = Column(Numeric(10, 2), nullable=False)
    payment_date = Column(DateTime(timezone=True), nullable=False, index=True)
    payment_mode = Column(String(50), nullable=True)
    transaction_reference = Column(String(100), nullable=True, index=True)
    remarks = Column(Text, nullable=True)

    paid_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    invoice = relationship("StoreComplianceInvoice", back_populates="payments")
    paid_by = relationship("User", foreign_keys=[paid_by_id])
    attachments = relationship(
        "StoreComplianceAttachment",
        back_populates="payment",
        order_by="StoreComplianceAttachment.created_at.asc()",
    )

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_store_comp_payment_positive_amount"),
        Index("ix_store_comp_pay_inv_ref", "invoice_id", "transaction_reference"),
    )


class StoreComplianceAttachment(Base):
    __tablename__ = "store_compliance_attachments"

    id = Column(Integer, primary_key=True, index=True)
    monthly_compliance_id = Column(
        Integer,
        ForeignKey("store_monthly_compliances.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    invoice_id = Column(
        Integer,
        ForeignKey("store_compliance_invoices.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    payment_id = Column(
        Integer,
        ForeignKey("store_compliance_payments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    attachment_type = Column(
        String(30),
        nullable=False,
        default=StoreComplianceAttachmentType.CARD.value,
        index=True,
    )

    file_url = Column(String(1000), nullable=False)
    file_public_id = Column(String(255), nullable=True)
    file_name = Column(String(255), nullable=False)
    file_type = Column(String(100), nullable=True)
    file_size = Column(Integer, nullable=True)

    uploaded_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Soft-Void Audit Fields
    voided_at = Column(DateTime(timezone=True), nullable=True)
    voided_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    void_reason = Column(Text, nullable=True)

    # Relationships
    monthly_compliance = relationship(
        "StoreMonthlyCompliance",
        back_populates="attachments",
    )
    invoice = relationship(
        "StoreComplianceInvoice",
        back_populates="attachments",
    )
    payment = relationship(
        "StoreCompliancePayment",
        back_populates="attachments",
    )
    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])
    voided_by = relationship("User", foreign_keys=[voided_by_id])

    __table_args__ = (
        CheckConstraint(
            "attachment_type IN ('CARD', 'INVOICE', 'PAYMENT_PROOF', 'OTHER')",
            name="ck_store_comp_att_valid_type",
        ),
        Index("ix_store_comp_att_monthly_type", "monthly_compliance_id", "attachment_type"),
    )
