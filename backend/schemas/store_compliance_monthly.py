"""Pydantic schemas for Store Compliance Phase 2 (Monthly, Invoices, Payments)."""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


# =============================================================================
# INPUT SCHEMAS
# =============================================================================

class StoreMonthlyComplianceCreate(BaseModel):
    store_id: str = Field(..., min_length=1, max_length=100)
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    card_remarks: Optional[str] = None


class StoreComplianceInvoiceCreate(BaseModel):
    invoice_number: str = Field(..., min_length=1, max_length=100)
    invoice_date: date
    invoice_amount: Decimal = Field(..., gt=Decimal("0.00"))
    remarks: Optional[str] = None


class StoreComplianceInvoiceUpdate(BaseModel):
    invoice_number: Optional[str] = Field(None, min_length=1, max_length=100)
    invoice_date: Optional[date] = None
    invoice_amount: Optional[Decimal] = Field(None, gt=Decimal("0.00"))
    remarks: Optional[str] = None


class StoreCompliancePaymentCreate(BaseModel):
    amount: Decimal = Field(..., gt=Decimal("0.00"), description="Payment installment amount")
    payment_date: datetime
    payment_mode: Optional[str] = Field("UPI", max_length=50)
    transaction_reference: Optional[str] = Field(None, max_length=100)
    remarks: Optional[str] = None


class StoreComplianceAttachmentVoidRequest(BaseModel):
    void_reason: str = Field(..., min_length=3, description="Mandatory reason for voiding attachment")


# =============================================================================
# OUTPUT SCHEMAS
# =============================================================================

class StoreComplianceAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    monthly_compliance_id: int
    invoice_id: Optional[int] = None
    payment_id: Optional[int] = None
    attachment_type: str
    file_url: str
    file_name: str
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    uploaded_by_id: int
    uploaded_by_name: Optional[str] = None
    created_at: datetime
    voided_at: Optional[datetime] = None
    voided_by_id: Optional[int] = None
    voided_by_name: Optional[str] = None
    void_reason: Optional[str] = None


class StoreCompliancePaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    invoice_id: int
    payment_number: Optional[str] = None
    amount: Decimal
    payment_date: datetime
    payment_mode: Optional[str] = None
    transaction_reference: Optional[str] = None
    remarks: Optional[str] = None
    paid_by_id: int
    paid_by_name: Optional[str] = None
    created_at: datetime
    attachments: List[StoreComplianceAttachmentOut] = []


class StoreComplianceInvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    monthly_compliance_id: int
    invoice_number: str
    invoice_date: date
    invoice_amount: Decimal
    total_paid: Decimal
    outstanding_amount: Decimal
    payment_status: str
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    remarks: Optional[str] = None
    created_by_id: int
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class StoreMonthlyComplianceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    compliance_number: str
    store_id: str
    store_name: str
    store_channel: Optional[str] = None
    store_region: Optional[str] = None
    store_entity: Optional[str] = None
    delivery_manager_id: Optional[int] = None
    delivery_manager_name: Optional[str] = None
    year: int
    month: int

    card_status: str
    card_file_url: Optional[str] = None
    card_file_name: Optional[str] = None
    card_remarks: Optional[str] = None
    card_uploaded_by_id: Optional[int] = None
    card_uploaded_by_name: Optional[str] = None
    card_uploaded_at: Optional[datetime] = None

    has_invoice: bool = False
    invoice_id: Optional[int] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[date] = None
    invoice_amount: Optional[Decimal] = None
    payment_status: str = "NO_INVOICE"
    total_paid: Decimal = Decimal("0.00")
    outstanding_amount: Decimal = Decimal("0.00")

    created_by_id: int
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    attachments_count: int = 0
    payments_count: int = 0


class StoreMonthlyComplianceDetailOut(StoreMonthlyComplianceOut):
    invoice: Optional[StoreComplianceInvoiceOut] = None
    payments: List[StoreCompliancePaymentOut] = []
    attachments: List[StoreComplianceAttachmentOut] = []


class StoreMonthlyComplianceListResponse(BaseModel):
    items: List[StoreMonthlyComplianceOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class StoreMonthlyComplianceSummaryResponse(BaseModel):
    total_monthly_records: int
    cards_uploaded: int
    pending_cards: int
    with_invoice: int
    without_invoice: int
    unpaid_count: int
    partially_paid_count: int
    paid_count: int
    total_invoice_amount: Decimal
    total_paid_amount: Decimal
    total_outstanding_amount: Decimal
