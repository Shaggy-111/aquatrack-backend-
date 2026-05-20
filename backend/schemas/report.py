from pydantic import BaseModel
from datetime import date
from typing import Optional

# Schema for creating a new report (used for form data)
class ReportCreate(BaseModel):
    report_date: date

# Schema for the API response (what the client receives)
class ReportOut(BaseModel):
    id: int
    report_date: date
    valid_upto: Optional[date] 
    file_path: str

    class Config:
        from_attributes = True