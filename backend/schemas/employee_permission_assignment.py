from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class EmployeePermissionAssignRequest(BaseModel):
    permission_id: int


class EmployeePermissionBulkAssignRequest(BaseModel):
    permission_ids: List[int] = Field(min_length=1)

    class Config:
        json_schema_extra = {"example": {"permission_ids": [1, 2, 3]}}


class EmployeePermissionAssignmentOut(BaseModel):
    id: int
    employee_id: int
    permission_id: int
    assigned_by: Optional[int] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EmployeePermissionDetailOut(BaseModel):
    assignment_id: int
    permission_id: int
    permission_key: str
    module: str
    action: str
    display_name: str
    description: Optional[str] = None
    assigned_by: Optional[int] = None
    created_at: Optional[datetime] = None


class EmployeePermissionListOut(BaseModel):
    employee_id: int
    permission_keys: List[str]
    permissions: List[EmployeePermissionDetailOut]

    class Config:
        json_schema_extra = {
            "example": {
                "employee_id": 42,
                "permission_keys": ["orders.view"],
                "permissions": [
                    {
                        "assignment_id": 10,
                        "permission_id": 1,
                        "permission_key": "orders.view",
                        "module": "Orders",
                        "action": "view",
                        "display_name": "View Orders",
                        "description": "Allows employee role access to view orders.",
                        "assigned_by": 7,
                        "created_at": "2026-07-10T10:00:00",
                    }
                ],
            }
        }


class EmployeePermissionBulkAssignOut(BaseModel):
    employee_id: int
    assigned: List[EmployeePermissionAssignmentOut]


class EmployeePermissionRemoveOut(BaseModel):
    message: str

    class Config:
        json_schema_extra = {
            "example": {"message": "Permission removed from employee successfully."}
        }
