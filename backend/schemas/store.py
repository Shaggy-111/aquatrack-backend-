from pydantic import BaseModel
from typing import Optional, List
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
    zip_code: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


# ---------- Create Schema ----------
class StoreCreate(StoreBase):
    id: str                    # ✅ Store ID as STRING
    channel: str = "GENERAL"


# ---------- Assign Stores ----------
class AssignStoresRequest(BaseModel):
    store_ids: List[str]       # ✅ Store IDs as STRING list


# ---------- Update Schema ----------
class StoreUpdate(BaseModel):
    store_name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    channel: Optional[str] = None  # ✅ allow update channel also
    auto_order_enabled: Optional[bool] = None
    order_frequency_days: Optional[int] = None
    monthly_cap: Optional[int] = None


# ---------- Output Schema ----------
class StoreOut(BaseModel):
    id: str                    # ✅ FIXED (was int)
    store_name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    created_at: Optional[datetime] = None
    channel: Optional[str] = None

    auto_order_enabled: bool = False
    order_frequency_days: int = 1
    monthly_cap: int = 0

    assigned_manager_id: Optional[int] = None
    assigned_manager: Optional[ManagerOut] = None

    class Config:
        from_attributes = True
