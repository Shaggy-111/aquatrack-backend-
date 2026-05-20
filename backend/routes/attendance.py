from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, date

from ..database.db import get_db
from ..models.attendance import Attendance
from ..models.leave import Leave
from ..models.holiday import Holiday
from ..models.user import User, RoleEnum
from ..schemas.attendance import AttendanceOut, LeaveCreate, LeaveOut, HolidayCreate, HolidayOut
from ..utils.auth import get_current_user  # adjust if path different

router = APIRouter(prefix="/attendance", tags=["Attendance"])


@router.post("/check-in")
def check_in(
    latitude: float = None,
    longitude: float = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.employee:
        raise HTTPException(status_code=403, detail="Only employees allowed")

    today = date.today()

    existing = db.query(Attendance).filter_by(
        user_id=current_user.id,
        date=today
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Already checked in")

    attendance = Attendance(
        user_id=current_user.id,
        date=today,
        check_in_time=datetime.utcnow(),
        status="present",
        latitude=latitude,
        longitude=longitude
    )

    db.add(attendance)
    db.commit()
    db.refresh(attendance)

    return {"message": "Checked in successfully"}



@router.post("/check-out")
def check_out(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.employee:
        raise HTTPException(status_code=403, detail="Only employees allowed")

    today = date.today()

    attendance = db.query(Attendance).filter_by(
        user_id=current_user.id,
        date=today
    ).first()

    if not attendance:
        raise HTTPException(status_code=400, detail="Check-in first")

    if attendance.check_out_time:
        raise HTTPException(status_code=400, detail="Already checked out")

    attendance.check_out_time = datetime.utcnow()

    # working hours calculation
    diff = attendance.check_out_time - attendance.check_in_time
    attendance.working_hours = diff.total_seconds() / 3600

    db.commit()

    return {"message": "Checked out successfully"}

@router.get("/me", response_model=list[AttendanceOut])
def get_my_attendance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Attendance).filter_by(user_id=current_user.id).all()



@router.get("/all", response_model=list[AttendanceOut])
def get_all_attendance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Not allowed")

    return db.query(Attendance).all()



@router.post("/leave/apply")
def apply_leave(
    request: LeaveCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    leave = Leave(
        user_id=current_user.id,
        from_date=request.from_date,
        to_date=request.to_date,
        reason=request.reason
    )

    db.add(leave)
    db.commit()

    return {"message": "Leave applied"}


@router.get("/leave/me", response_model=list[LeaveOut])
def get_my_leaves(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Leave).filter_by(user_id=current_user.id).all()


@router.put("/leave/approve/{leave_id}")
def approve_leave(
    leave_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403)

    leave = db.query(Leave).filter_by(id=leave_id).first()

    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")

    leave.status = "approved"
    leave.approved_by = current_user.id

    db.commit()

    return {"message": "Leave approved"}


@router.post("/holiday")
def add_holiday(
    request: HolidayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403)

    holiday = Holiday(
        date=request.date,
        title=request.title
    )

    db.add(holiday)
    db.commit()

    return {"message": "Holiday added"}


@router.get("/holiday", response_model=list[HolidayOut])
def get_holidays(db: Session = Depends(get_db)):
    return db.query(Holiday).all()