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
)
from sqlalchemy.orm import relationship

from ..database.db import Base


class StoreReimbursementStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    PARTIALLY_PAID = "PARTIALLY_PAID"
    PAID = "PAID"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class StoreReimbursementAttachmentType(str, Enum):
    INVOICE = "INVOICE"
    PAYMENT_PROOF = "PAYMENT_PROOF"
    OTHER = "OTHER"


class StoreReimbursement(Base):
    __tablename__ = "store_reimbursements"

    id = Column(Integer, primary_key=True, index=True)
    reimbursement_number = Column(String(50), unique=True, index=True, nullable=False)

    # Store link and snapshots
    store_id = Column(String, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True)
    store_name = Column(String(255), nullable=False)
    store_channel = Column(String(50), nullable=True)
    store_region = Column(String(100), nullable=True)
    store_entity = Column(String(100), nullable=True)

    # Payee POC link and snapshots
    poc_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    poc_name = Column(String(255), nullable=True)
    poc_phone = Column(String(50), nullable=True)

    # Financial and operational dates
    purchase_date = Column(Date, nullable=False, index=True)

    # Financial ledger amounts
    total_amount = Column(Numeric(10, 2), nullable=False)
    total_paid = Column(Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    outstanding_amount = Column(Numeric(10, 2), nullable=False)

    # Lifecycle status
    status = Column(
        String(30),
        nullable=False,
        default=StoreReimbursementStatus.PENDING.value,
        index=True,
    )

    # Operational justification
    reason = Column(Text, nullable=False)
    notes = Column(Text, nullable=True)

    # Instructed by identity
    instructed_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    instructed_by_name = Column(String(255), nullable=True)

    # Creator and modifier audit
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    updated_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Approval audit
    approved_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    # Rejection audit
    rejected_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(Text, nullable=True)

    # Cancellation audit
    cancelled_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancellation_reason = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    store = relationship("Store", foreign_keys=[store_id])
    poc = relationship("User", foreign_keys=[poc_id])
    instructed_by = relationship("User", foreign_keys=[instructed_by_user_id])
    created_by = relationship("User", foreign_keys=[created_by_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])
    approved_by = relationship("User", foreign_keys=[approved_by_id])
    rejected_by = relationship("User", foreign_keys=[rejected_by_id])
    cancelled_by = relationship("User", foreign_keys=[cancelled_by_id])

    payments = relationship(
        "StoreReimbursementPayment",
        back_populates="reimbursement",
        cascade="all, delete-orphan",
        order_by="StoreReimbursementPayment.payment_date.asc()",
    )
    attachments = relationship(
        "StoreReimbursementAttachment",
        back_populates="reimbursement",
        cascade="all, delete-orphan",
        order_by="StoreReimbursementAttachment.created_at.asc()",
    )

    __table_args__ = (
        CheckConstraint("total_amount > 0", name="ck_store_reimb_positive_amount"),
        CheckConstraint("total_paid >= 0", name="ck_store_reimb_non_neg_paid"),
        CheckConstraint("outstanding_amount >= 0", name="ck_store_reimb_non_neg_outstanding"),
        CheckConstraint("total_paid <= total_amount", name="ck_store_reimb_paid_lte_total"),
        Index("ix_store_reimb_store_status", "store_id", "status"),
        Index("ix_store_reimb_date_status", "purchase_date", "status"),
    )


class StoreReimbursementPayment(Base):
    __tablename__ = "store_reimbursement_payments"

    id = Column(Integer, primary_key=True, index=True)
    reimbursement_id = Column(
        Integer,
        ForeignKey("store_reimbursements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    payment_number = Column(String(50), nullable=True)
    amount = Column(Numeric(10, 2), nullable=False)
    payment_date = Column(DateTime(timezone=True), nullable=False, index=True)

    payment_mode = Column(String(50), nullable=True)  # UPI, IMPS, NEFT, BANK_TRANSFER, CASH, OTHER
    transaction_reference = Column(String(100), nullable=True, index=True)
    remarks = Column(Text, nullable=True)

    paid_to_name = Column(String(255), nullable=True)
    paid_to_phone = Column(String(50), nullable=True)

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
    reimbursement = relationship("StoreReimbursement", back_populates="payments")
    paid_by = relationship("User", foreign_keys=[paid_by_id])
    attachments = relationship(
        "StoreReimbursementAttachment",
        back_populates="payment",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_store_reimb_payment_positive_amount"),
    )


class StoreReimbursementAttachment(Base):
    __tablename__ = "store_reimbursement_attachments"

    id = Column(Integer, primary_key=True, index=True)
    reimbursement_id = Column(
        Integer,
        ForeignKey("store_reimbursements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    payment_id = Column(
        Integer,
        ForeignKey("store_reimbursement_payments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    attachment_type = Column(
        String(30),
        nullable=False,
        default=StoreReimbursementAttachmentType.INVOICE.value,
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

    # Audit-safe voiding (no hard deletion)
    voided_at = Column(DateTime(timezone=True), nullable=True)
    voided_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    void_reason = Column(Text, nullable=True)

    # Relationships
    reimbursement = relationship("StoreReimbursement", back_populates="attachments")
    payment = relationship("StoreReimbursementPayment", back_populates="attachments")
    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])
    voided_by = relationship("User", foreign_keys=[voided_by_id])
