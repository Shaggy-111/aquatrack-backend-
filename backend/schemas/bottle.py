from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from datetime import datetime


class BottleAssignRequest(BaseModel):
    qr_codes: List[str]
    delivery_boy_id: int

class BottleScanRequest(BaseModel):
    qr_code: str
    to_location_id: Optional[int] = None # Used for assigning TO a store
    # Note: store_id for collection is validated in the endpoint logic

class BottleOut(BaseModel):
    uuid: str
    qr_code: Optional[str] = None # Make QR code optional if it can be null in DB
    status: str
    assigned_to_delivery_id: Optional[int] = None
    assigned_to_store_id: Optional[int] = None
    cycle_count: int
    last_collected_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

# +++ Add this new schema +++
class CollectableBottleOut(BaseModel):
    qr_code: Optional[str] = None # Make QR code optional if it can be null in DB
    status: str
    store_id: int
    store_name: Optional[str] = None # Include store name if available

    model_config = ConfigDict(from_attributes=True)
# +++ End of new schema +++