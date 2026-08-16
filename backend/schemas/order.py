from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from ..models.order import OrderStatusEnum
from .user import UserOut  # Import UserOut from your user schemas
from .store import StoreOut  # Import StoreOut from your store schemas


class OrderCreate(BaseModel):
    store_id: str = Field(..., description="The ID of the store placing the order")
    order_details: str = Field(..., description="A string containing details of the order")
    total_amount: float = Field(..., description="The total cost of the order")
    poc_name: Optional[str] = None
    ordered_by_type: Optional[str] = None
    order_date: Optional[datetime] = None
    vehicle_info: Optional[str] = None
    delivered_by: Optional[str] = None

    class Config:
        orm_mode = True # Use from_attributes=True for Pydantic v2+


class OrderOut(BaseModel):
    id: int
    status: OrderStatusEnum
    order_details: str
    total_amount: float
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    order_date: Optional[datetime] = None

    # 🔥 YE DO LINES ADD KARO (Verna data frontend pe nahi dikhega)
    poc_name: Optional[str] = None
    ordered_by_type: Optional[str] = None

    # Instead of exposing only IDs, expose readable names too
    channel: Optional[str] = Field(None, description="The channel (BLINKIT, ZEPTO, etc.)")
    partner_name: Optional[str] = Field(None, description="The name of the partner who placed the order")
    store_name: Optional[str] = Field(None, description="The name of the store the order belongs to")
    delivery_person_name: Optional[str] = Field(None, description="The delivery partner assigned to the order")

    # If you still want full objects, keep these as optional
    partner: Optional[UserOut] = None
    store: Optional[StoreOut] = None
    delivery_person: Optional[UserOut] = None

    # --- NEW FIELDS FOR DELIVERY + CONFIRMATION FLOW ---
    delivery_photo_url: Optional[str] = None
    bottles_delivered: Optional[int] = None
    empty_bottles_collected: Optional[int] = None
    confirmed_empty_bottles: Optional[int] = None

    confirmed_bottles: Optional[int] = None
    confirmation_remarks: Optional[str] = None
    store_confirmed: Optional[bool] = None

    class Config:
        # Pydantic v2 use kar rahe ho toh from_attributes=True likho
        # Pydantic v1 ke liye orm_mode=True sahi hai
        orm_mode = True 
        from_attributes = True



class OrderPatch(BaseModel):
    status: OrderStatusEnum

    class Config:
        orm_mode = True # Use from_attributes=True for Pydantic v2+


class OrderUpdateStatusSchema(BaseModel):
    status: str

class DeliveryOrderListItem(BaseModel):
    id: int
    status: str
    store_name: str | None = None
    channel: str | None = None
    pending_empty_bottles: int = 0
    created_at: datetime | None = None

    class Config:
        from_attributes = True