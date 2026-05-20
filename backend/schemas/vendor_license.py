from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class VendorLicenseCreate(BaseModel):
    vendor_name: str
    license_number: str
    state: str

    class Config:
        orm_mode = True
        from_attributes = True


class VendorLicenseOut(BaseModel):
    id: int
    vendor_name: str
    license_number: str
    state: str
    created_at: Optional[datetime]

    class Config:
        orm_mode = True
        from_attributes = True