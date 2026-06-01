from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# -------------------------------------------------
# UPLOAD SCHEMA
# -------------------------------------------------
class StoreComplianceCreate(BaseModel):

    store_id: str

    # water_card / invoice
    document_type: str

    year: int

    # 1-12
    month: int

    # optional for invoices
    week_number: Optional[int] = None

    remarks: Optional[str] = None


# -------------------------------------------------
# RESPONSE SCHEMA
# -------------------------------------------------
class StoreComplianceOut(BaseModel):

    id: int

    store_id: str

    uploaded_by: int

    document_type: str

    year: int

    month: int

    week_number: Optional[int] = None

    file_url: str

    remarks: Optional[str] = None

    status: str

    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True