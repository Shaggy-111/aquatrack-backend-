from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from ..models.complaint import ComplaintStatusEnum
from .user import UserOut

# --- NEW: Minimal Store Schema to carry Channel ---
class StoreOutMinimal(BaseModel):
    id: str
    store_name: str
    channel: str # <--- KEY ADDITION: Expose the channel

    class Config:
        from_attributes = True
# ----------------------------------------------------

class ComplaintBase(BaseModel):
    subject: str
    description: str

class ComplaintCreate(ComplaintBase):
    assigned_to_admin_id: Optional[int] = None
    assigned_to_channel_admin_id: Optional[int] = None
    store_id: str

class ComplaintOut(ComplaintBase):
    id: int
    status: ComplaintStatusEnum
    solution: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    photo_url: Optional[str] = None

    created_by: UserOut
    assigned_admin: Optional[UserOut] = None
    assigned_channel_admin: Optional[UserOut] = None
    
    store: StoreOutMinimal # <--- KEY ADDITION: Link the store model for channel access

    class Config:
        from_attributes = True

class ComplaintResolve(BaseModel):
    solution: str
    status: ComplaintStatusEnum = ComplaintStatusEnum.resolved