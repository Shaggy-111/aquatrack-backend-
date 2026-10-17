from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime

# -------------------------------------------------
# ⭐ MANAGER OUTPUT SCHEMA
# -------------------------------------------------
class ManagerOut(BaseModel):
    id: int
    full_name: str
    email: Optional[str] = None

    class Config:
        from_attributes = True


# ---------- Base Schema ----------
class StoreBase(BaseModel):
    store_name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    region: Optional[str] = None
    entity: Optional[str] = None
    project_code: Optional[str] = None
    zip_code: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_active: bool = True


# ---------- Create Schema ----------
class StoreCreate(StoreBase):
    id: str                    # ✅ Store ID as STRING
    channel: str = "GENERAL"
    poc_name: Optional[str] = None
    poc_phone: Optional[str] = None


# ---------- Assign Stores ----------
class AssignStoresRequest(BaseModel):
    store_ids: List[str]       # ✅ Store IDs as STRING list


# ---------- Update Schema ----------
class StoreUpdate(BaseModel):
    store_name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    region: Optional[str] = None
    entity: Optional[str] = None
    project_code: Optional[str] = None
    zip_code: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    channel: Optional[str] = None
    is_active: Optional[bool] = None
    assigned_manager_id: Optional[int] = None
    poc_name: Optional[str] = None
    poc_phone: Optional[str] = None
    auto_order_enabled: Optional[bool] = None
    order_frequency_days: Optional[int] = None
    monthly_cap: Optional[int] = None


# ---------- Output Schema ----------
class StoreOut(BaseModel):
    id: str
    store_name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    region: Optional[str] = None
    entity: Optional[str] = None
    project_code: Optional[str] = None
    zip_code: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    created_at: Optional[datetime] = None
    channel: Optional[str] = None
    is_active: bool = True

    auto_order_enabled: bool = False
    order_frequency_days: int = 1
    monthly_cap: int = 0

    assigned_manager_id: Optional[int] = None
    assigned_manager: Optional[ManagerOut] = None

    poc_name: Optional[str] = None
    poc_phone: Optional[str] = None

    class Config:
        from_attributes = True


class StoreStatusUpdate(BaseModel):
    is_active: bool


class StoreSelectorItem(BaseModel):
    id: str
    store_name: str
    region: Optional[str] = None
    channel: str
    entity: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    is_active: bool


class StoreSelectorResponse(BaseModel):
    items: List[StoreSelectorItem]
    page: int
    page_size: int
    has_more: bool


class StoreSelectorFilters(BaseModel):
    regions: List[str]
    channels: List[str]
    states: List[str]
    cities: List[str]


class StoreDeliverySummary(BaseModel):
    store_id: str
    store_name: str
    city: Optional[str] = None
    state: Optional[str] = None
    channel: Optional[str] = None
    is_active: bool = True
    month_delivered_bottles: int = 0
    week_delivered_bottles: int = 0
    total_orders: int = 0
    last_delivery_date: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------- Bulk Upload Schemas ----------
class StoreBulkUploadErrorItem(BaseModel):
    row: int
    column: str
    value: Any
    message: str


class StoreBulkUploadErrorResponse(BaseModel):
    success: bool = False
    total_rows: int
    valid_rows: int
    invalid_rows: int
    errors: List[StoreBulkUploadErrorItem]


class StoreBulkUploadSuccessResponse(BaseModel):
    success: bool = True
    total_rows: int
    created_count: int
    skipped_count: int = 0
    created_store_ids: List[str]
