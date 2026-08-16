from pydantic import BaseModel, EmailStr, Field, model_validator
from typing import Optional, List
from enum import Enum
from datetime import datetime



# ------------------------------------------------------------------
# ROLE ENUM
# ------------------------------------------------------------------
class RoleEnum(str, Enum):
    superadmin = "superadmin"
    admin = "admin"
    vendor = "vendor"
    delivery = "delivery"
    customer = "customer"
    partner = "partner"
    sub_partner = "sub_partner"
    channel_admin = "channel_admin"
    delivery_manager = "delivery_manager"
    employee = "employee"

# ------------------------------------------------------------------
# STORE OUT (must be BEFORE UserOut)
# ------------------------------------------------------------------
class StoreOut(BaseModel):
    id: str
    store_name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    channel: Optional[str] = None
    is_active: bool = True

    class Config:
        from_attributes = True


# ------------------------------------------------------------------
# USER BASE
# ------------------------------------------------------------------
class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    mobile_number: Optional[str] = None
    role: Optional[RoleEnum] = RoleEnum.customer
    status: Optional[str] = "pending"
    region_id: Optional[int] = None


# ------------------------------------------------------------------
# USER CREATE
# ------------------------------------------------------------------
class UserCreate(UserBase):
    password: str
    confirm_password: Optional[str] = None

    # Delivery-specific fields
    govt_id: Optional[str] = None
    id_type: Optional[str] = None
    current_address: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    vehicle_number: Optional[str] = None
    driving_license_number: Optional[str] = None
    govt_id_photo: Optional[str] = None
    delivery_photo: Optional[str] = None

    @model_validator(mode="after")
    def validate_fields(self):
        if self.role == RoleEnum.delivery:
            required_fields = [
                "govt_id",
                "id_type",
                "current_address",
                "state",
                "city",
                "vehicle_number",
                "driving_license_number",
                "govt_id_photo",
                "delivery_photo",
            ]
            missing = [f for f in required_fields if not getattr(self, f)]
            if missing:
                raise ValueError(
                    f"Missing required fields for delivery: {', '.join(missing)}"
                )

        if self.confirm_password is not None and self.password != self.confirm_password:
            raise ValueError("Passwords do not match")

        return self


# ------------------------------------------------------------------
# USER UPDATE
# ------------------------------------------------------------------
class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    mobile_number: Optional[str] = None
    role: Optional[RoleEnum] = None
    status: Optional[str] = None
    region_id: Optional[int] = None
    govt_id: Optional[str] = None
    id_type: Optional[str] = None
    current_address: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    vehicle_number: Optional[str] = None
    driving_license_number: Optional[str] = None
    govt_id_photo: Optional[str] = None
    delivery_photo: Optional[str] = None


# ------------------------------------------------------------------
# USER OUT
# ------------------------------------------------------------------
class UserOut(UserBase):
    id: int
    govt_id: Optional[str] = None
    id_type: Optional[str] = None
    current_address: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    vehicle_number: Optional[str] = None
    driving_license_number: Optional[str] = None
    govt_id_photo: Optional[str] = None
    delivery_photo: Optional[str] = None

    channel: Optional[str] = None

    # ⚠️ NEVER use [] directly
    stores: List[StoreOut] = Field(default_factory=list)

    assigned_manager_id: Optional[int] = None

    class Config:
        from_attributes = True


# ------------------------------------------------------------------
# AUTH & OTHER SCHEMAS
# ------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: EmailStr
    password: str
    role: Optional[RoleEnum] = Field(
        default=None,
        description="The role attempting to log in.",
    )


class PartnerSignup(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    mobile_number: Optional[str] = None
    confirm_password: Optional[str] = None

    @model_validator(mode="after")
    def passwords_match(self):
        if self.confirm_password is not None and self.password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


class PartnerLogin(BaseModel):
    username: EmailStr
    password: str

class AssignStoresRequest(BaseModel):
    manager_id: int
    store_ids: List[str]


# ------------------------------------------------------------------
# DELIVERY MANAGER CREATE (IMPORTANT)
# ------------------------------------------------------------------
class DeliveryManagerCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    mobile_number: Optional[str] = None

    # informational only
    area_city: Optional[str] = Field(
        default=None,
        description="Optional city/area for reference. Routing is store-based.",
    )

    # store assignment
    assigned_stores: List[str] = Field(default_factory=list)


# ------------------------------------------------------------------
# PATCH / MISC
# ------------------------------------------------------------------
class UserPatchStatus(BaseModel):
    status: str


class OrderPatch(BaseModel):
    delivery_person_id: int

# ------------------------------------------------------------------
# EMPLOYEE RBAC SCHEMAS
# ------------------------------------------------------------------

class EmployeeCreateRequest(BaseModel):
    full_name: str
    email: EmailStr
    mobile_number: str

    password: str
    confirm_password: str

    @model_validator(mode="after")
    def validate_password(self):
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match")

        self.email = self.email.lower().strip()
        self.full_name = self.full_name.strip()
        self.mobile_number = self.mobile_number.strip()

        return self


class EmployeeUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    mobile_number: Optional[str] = None
    email: Optional[EmailStr] = None


class EmployeeStatusRequest(BaseModel):
    status: str


class EmployeeListItem(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    mobile_number: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True
