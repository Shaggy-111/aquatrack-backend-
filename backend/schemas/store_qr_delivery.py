from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class StoreQrStoreContext(BaseModel):
    name: str
    city: Optional[str] = None
    channel: Optional[str] = None


class StoreQrPendingOrderContext(BaseModel):
    exists: bool
    expected_quantity: Optional[int] = None


class StoreQrScanResponse(BaseModel):
    store: StoreQrStoreContext
    pending_order: StoreQrPendingOrderContext
    submission_token: str
    idempotency_key: str
    expires_in_seconds: int
    business_date: date


class StoreQrSubmissionResponse(BaseModel):
    success: bool = True
    order_id: int
    created_order: bool
    status: str
    bottles_delivered: int
    empty_bottles_collected: int
    submitted_at: datetime


class StoreQrAdminResponse(BaseModel):
    store_id: str
    qr_token_version: int
    qr_enabled: bool
    qr_url: str
    qr_token: str


class StoreQrStatusUpdate(BaseModel):
    qr_enabled: bool
