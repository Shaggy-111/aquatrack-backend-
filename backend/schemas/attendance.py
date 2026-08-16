from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Any, Optional
from datetime import datetime, date


class AttendanceBase(BaseModel):
    date: date


class AttendanceLocationIn(BaseModel):
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)


class AttendanceOut(BaseModel):
    id: int
    user_id: int
    date: date
    check_in_time: Optional[datetime]
    check_out_time: Optional[datetime]
    status: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    working_hours: Optional[float]

    class Config:
        from_attributes = True


class LeaveCreate(BaseModel):
    from_date: date
    to_date: date
    reason: Optional[str] = None

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.to_date < self.from_date:
            raise ValueError("to_date must be on or after from_date")
        return self


class LeaveReject(BaseModel):
    rejection_reason: str

    @field_validator("rejection_reason")
    @classmethod
    def validate_rejection_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("rejection_reason is required")
        return value


class LeaveOut(BaseModel):
    id: int
    user_id: int
    from_date: date
    to_date: date
    reason: Optional[str]
    status: str
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    rejected_by: Optional[int] = None
    rejected_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class HolidayCreate(BaseModel):
    date: date
    title: str

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("title is required")
        return value


class HolidayOut(BaseModel):
    id: int
    date: date
    title: str

    class Config:
        from_attributes = True


class AttendanceTimelineEvent(BaseModel):
    type: str
    time: str


class AttendanceTodayOut(BaseModel):
    attendance_id: Optional[int] = None
    id: Optional[int] = None
    user_id: int
    date: date
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    check_in_time: Optional[datetime] = None
    check_out_time: Optional[datetime] = None
    working_hours: float = 0.0
    status: str
    late_minutes: int = 0
    early_departure: int = 0
    break_minutes: int = 0
    remarks: Optional[str] = None
    location: Optional[dict[str, Optional[float]]] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timeline: list[AttendanceTimelineEvent]


class AttendancePageOut(BaseModel):
    items: list[dict[str, Any]]
    total_count: int
    page: int
    page_size: int
    total_pages: int


class AdminAttendanceItemOut(BaseModel):
    attendance_id: int
    employee_id: int
    employee_name: str
    employee_email: str
    employee_code: Optional[str] = None
    store_id: Optional[str] = None
    store_name: Optional[str] = None
    attendance_date: date
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    working_hours: float = 0.0
    attendance_status: Optional[str] = None
    late_minutes: int = 0
    half_day: bool = False
    leave_status: Optional[str] = None
    leave_type: Optional[str] = None
    leave_reason: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class AdminAttendancePageOut(BaseModel):
    items: list[AdminAttendanceItemOut]
    total_count: int
    page: int
    page_size: int
    total_pages: int
