from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


class StoreReimbursementCreate(BaseModel):
    store_id: str = Field(..., min_length=1, description="Store ID")
    purchase_date: date = Field(..., description="Date water was purchased locally")
    total_amount: Decimal = Field(..., gt=0, description="Total claim amount in INR")
    reason: str = Field(..., min_length=3, description="Justification for local water purchase")
    poc_id: Optional[int] = Field(None, description="Payee Partner POC user ID")
    instructed_by_user_id: Optional[int] = Field(None, description="Employee who gave local purchase instruction")
    notes: Optional[str] = Field(None, description="Additional internal notes")

    @field_validator("total_amount")
    @classmethod
    def validate_positive_amount(cls, v: Decimal) -> Decimal:
        if v <= Decimal("0.00"):
            raise ValueError("Total amount must be strictly greater than 0.")
        return v.quantize(Decimal("0.01"))


class StoreReimbursementUpdate(BaseModel):
    purchase_date: Optional[date] = None
    total_amount: Optional[Decimal] = None
    reason: Optional[str] = None
    poc_id: Optional[int] = None
    instructed_by_user_id: Optional[int] = None
    notes: Optional[str] = None

    @field_validator("total_amount")
    @classmethod
    def validate_positive_amount(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v <= Decimal("0.00"):
                raise ValueError("Total amount must be strictly greater than 0.")
            return v.quantize(Decimal("0.01"))
        return v


class StoreReimbursementReject(BaseModel):
    rejection_reason: str = Field(..., min_length=3, description="Mandatory reason for rejection")


class StoreReimbursementCancel(BaseModel):
    cancellation_reason: str = Field(..., min_length=3, description="Mandatory reason for cancellation")


class StoreReimbursementPaymentCreate(BaseModel):
    amount: Decimal = Field(..., gt=0, description="Installment payment amount")
    payment_date: datetime = Field(..., description="Payment execution date and time")
    payment_mode: Optional[str] = Field("UPI", description="Payment mode (UPI, IMPS, NEFT, BANK_TRANSFER, CASH, OTHER)")
    transaction_reference: Optional[str] = Field(None, description="UTR / Bank reference / Transaction ID")
    remarks: Optional[str] = Field(None, description="Payment remarks / installment notes")
    paid_to_name: Optional[str] = Field(None, description="Payee name snapshot override if applicable")
    paid_to_phone: Optional[str] = Field(None, description="Payee phone / UPI contact")

    @field_validator("amount")
    @classmethod
    def validate_payment_amount(cls, v: Decimal) -> Decimal:
        if v <= Decimal("0.00"):
            raise ValueError("Payment amount must be strictly greater than 0.")
        return v.quantize(Decimal("0.01"))

    @field_validator("payment_mode")
    @classmethod
    def validate_mode(cls, v: Optional[str]) -> Optional[str]:
        if v:
            allowed = {"UPI", "IMPS", "NEFT", "BANK_TRANSFER", "CASH", "OTHER"}
            upper = v.strip().upper()
            if upper not in allowed:
                raise ValueError(f"Invalid payment mode '{v}'. Allowed: {', '.join(sorted(allowed))}")
            return upper
        return "OTHER"


class StoreReimbursementAttachmentVoidRequest(BaseModel):
    void_reason: str = Field(..., min_length=3, description="Mandatory reason for voiding attachment")


class StoreReimbursementAttachmentOut(BaseModel):
    id: int
    reimbursement_id: int
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

    class Config:
        from_attributes = True


class StoreReimbursementPaymentOut(BaseModel):
    id: int
    reimbursement_id: int
    payment_number: Optional[str] = None
    amount: Decimal
    payment_date: datetime
    payment_mode: Optional[str] = None
    transaction_reference: Optional[str] = None
    remarks: Optional[str] = None
    paid_to_name: Optional[str] = None
    paid_to_phone: Optional[str] = None
    paid_by_id: int
    paid_by_name: Optional[str] = None
    created_at: datetime
    attachments: List[StoreReimbursementAttachmentOut] = []

    class Config:
        from_attributes = True


class StoreReimbursementOut(BaseModel):
    id: int
    reimbursement_number: str
    store_id: str
    store_name: str
    store_channel: Optional[str] = None
    store_region: Optional[str] = None
    store_entity: Optional[str] = None
    poc_id: Optional[int] = None
    poc_name: Optional[str] = None
    poc_phone: Optional[str] = None
    purchase_date: date
    total_amount: Decimal
    total_paid: Decimal
    outstanding_amount: Decimal
    status: str
    reason: str
    notes: Optional[str] = None
    instructed_by_user_id: Optional[int] = None
    instructed_by_name: Optional[str] = None
    created_by_id: int
    created_by_name: Optional[str] = None
    updated_by_id: Optional[int] = None
    approved_by_id: Optional[int] = None
    approved_by_name: Optional[str] = None
    approved_at: Optional[datetime] = None
    rejected_by_id: Optional[int] = None
    rejected_by_name: Optional[str] = None
    rejected_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    cancelled_by_id: Optional[int] = None
    cancelled_by_name: Optional[str] = None
    cancelled_at: Optional[datetime] = None
    cancellation_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    payments_count: int = 0
    attachments_count: int = 0

    class Config:
        from_attributes = True


class StoreReimbursementDetailOut(StoreReimbursementOut):
    payments: List[StoreReimbursementPaymentOut] = []
    attachments: List[StoreReimbursementAttachmentOut] = []


class StoreReimbursementListResponse(BaseModel):
    items: List[StoreReimbursementOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class StoreReimbursementSummaryResponse(BaseModel):
    total_claims: int
    pending_count: int
    approved_count: int
    partially_paid_count: int
    paid_count: int
    rejected_count: int
    cancelled_count: int
    total_reimbursement_amount: Decimal
    total_paid_amount: Decimal
    total_outstanding_amount: Decimal
