from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class EmployeeStoreAssignRequest(BaseModel):
    employee_id: int
    store_id: str


class EmployeeStoreBulkAssignRequest(BaseModel):
    employee_id: int
    store_ids: List[str] = Field(min_length=1)


class EmployeeStoreMappingOut(BaseModel):
    id: int
    employee_id: int
    store_id: str
    assigned_by: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class EmployeeAssignedStoreOut(BaseModel):
    mapping_id: int
    store_id: str
    store_name: str
    city: Optional[str] = None
    state: Optional[str] = None
    channel: Optional[str] = None
    assigned_by: Optional[int] = None
    created_at: datetime


class EmployeeStoreBulkAssignOut(BaseModel):
    employee_id: int
    assigned: List[EmployeeStoreMappingOut]
