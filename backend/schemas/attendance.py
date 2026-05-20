from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date


class AttendanceBase(BaseModel):
    date: date


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
    reason: Optional[str]


class LeaveOut(BaseModel):
    id: int
    user_id: int
    from_date: date
    to_date: date
    reason: Optional[str]
    status: str

    class Config:
        from_attributes = True


class HolidayCreate(BaseModel):
    date: date
    title: str


class HolidayOut(BaseModel):
    id: int
    date: date
    title: str

    class Config:
        from_attributes = True