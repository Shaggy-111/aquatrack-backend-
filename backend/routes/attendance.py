from math import ceil
import logging
from types import SimpleNamespace

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import asc, desc, or_, select
from sqlalchemy.orm import Session, aliased, joinedload
from datetime import datetime, date, timedelta
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from ..database.db import get_db
from ..models.attendance import Attendance
from ..models.leave import Leave
from ..models.holiday import Holiday
from ..models.employee_store_mapping import EmployeeStoreMapping
from ..models.partner_store import PartnerStore
from ..models.store import Store
from ..models.user import RoleEnum, User
from ..schemas.attendance import (
    AttendanceLocationIn,
    AttendancePageOut,
    AttendanceTodayOut,
    AdminAttendancePageOut,
    HolidayCreate,
    HolidayOut,
    LeaveCreate,
    LeaveOut,
    LeaveReject,
)
from ..utils.permissions import require_permission
from ..attendance_settings import (
    GRACE_PERIOD,
    HALF_DAY_THRESHOLD_HOURS,
    MINIMUM_WORKING_HOURS,
    OFFICE_END_TIME,
    OFFICE_START_TIME,
)
from ..attendance_summary import admin_summary, employee_month_summary, month_bounds
from ..attendance_time import IST, as_ist, as_utc, ist_today, utc_now

router = APIRouter(prefix="/attendance", tags=["Attendance"])
logger = logging.getLogger(__name__)


def _office_datetime(day: date, office_time) -> datetime:
    return datetime.combine(day, office_time, tzinfo=IST)


def _day_status(db: Session, user_id: int, day: date) -> str | None:
    if db.query(Holiday.id).filter(Holiday.date == day).first():
        return "holiday"

    approved_leave = db.query(Leave.id).filter(
        Leave.user_id == user_id,
        Leave.status == "approved",
        Leave.from_date <= day,
        Leave.to_date >= day,
    ).first()
    return "leave" if approved_leave else None


def _check_in_status(
    db: Session,
    user_id: int,
    attendance_date: date,
    checked_in_at: datetime,
) -> str:
    non_working_status = _day_status(db, user_id, attendance_date)
    if non_working_status:
        return non_working_status

    late_after = _office_datetime(attendance_date, OFFICE_START_TIME) + GRACE_PERIOD
    return "late" if as_ist(checked_in_at) > late_after else "present"


def _completed_status(attendance: Attendance) -> str:
    if attendance.status in {"leave", "holiday"}:
        return attendance.status

    hours = attendance.working_hours or 0.0
    if hours < HALF_DAY_THRESHOLD_HOURS:
        return "half_day"

    office_end = _office_datetime(attendance.date, OFFICE_END_TIME)
    if as_ist(attendance.check_out_time) < office_end or hours < MINIMUM_WORKING_HOURS:
        return "early_departure"

    late_after = _office_datetime(attendance.date, OFFICE_START_TIME) + GRACE_PERIOD
    return "late" if as_ist(attendance.check_in_time) > late_after else "present"


def _late_minutes(attendance: Attendance | None) -> int:
    if attendance is None or attendance.check_in_time is None:
        return 0
    check_in_time = as_ist(attendance.check_in_time)
    if check_in_time.date() != attendance.date:
        logger.warning(
            "Attendance date/check-in mismatch for attendance_id=%s: date=%s, check_in=%s",
            getattr(attendance, "id", None),
            attendance.date,
            check_in_time.isoformat(),
        )
        return 0
    office_start = _office_datetime(attendance.date, OFFICE_START_TIME)
    return max(0, int((check_in_time - office_start).total_seconds() // 60))


def _early_departure_minutes(attendance: Attendance | None) -> int:
    if attendance is None or attendance.check_out_time is None:
        return 0
    check_out_time = as_ist(attendance.check_out_time)
    office_end = _office_datetime(attendance.date, OFFICE_END_TIME)
    return max(0, int((office_end - check_out_time).total_seconds() // 60))


def _overtime_hours(attendance: Attendance) -> float:
    return round(max(0.0, (attendance.working_hours or 0.0) - MINIMUM_WORKING_HOURS), 2)


def _attendance_payload(
    attendance: Attendance | None,
    *,
    user_id: int,
    attendance_date: date,
) -> dict:
    check_in_time = as_ist(attendance.check_in_time) if attendance else None
    check_out_time = as_ist(attendance.check_out_time) if attendance else None
    timeline = []
    if check_in_time:
        timeline.append({"type": "CHECK_IN", "time": check_in_time.strftime("%H:%M")})
    if check_out_time:
        timeline.append({"type": "CHECK_OUT", "time": check_out_time.strftime("%H:%M")})

    latitude = attendance.latitude if attendance else None
    longitude = attendance.longitude if attendance else None
    location = None
    if latitude is not None or longitude is not None:
        location = {"latitude": latitude, "longitude": longitude}

    return {
        "attendance_id": attendance.id if attendance else None,
        "id": attendance.id if attendance else None,
        "user_id": user_id,
        "date": attendance.date if attendance else attendance_date,
        "check_in": check_in_time,
        "check_out": check_out_time,
        "check_in_time": check_in_time,
        "check_out_time": check_out_time,
        "working_hours": round(attendance.working_hours or 0.0, 2) if attendance else 0.0,
        "status": attendance.status if attendance else "not_checked_in",
        "late_minutes": _late_minutes(attendance),
        "early_departure": _early_departure_minutes(attendance),
        "break_minutes": 0,
        "remarks": None,
        "location": location,
        "latitude": latitude,
        "longitude": longitude,
        "timeline": timeline,
    }


def _check_in_response(
    attendance: Attendance,
    *,
    user_id: int,
    attendance_date: date,
    already_checked_in: bool,
) -> dict:
    attendance_payload = _attendance_payload(
        attendance,
        user_id=user_id,
        attendance_date=attendance_date,
    )
    return {
        "message": "Already checked in" if already_checked_in else "Checked in successfully",
        "attendance_id": attendance.id,
        "check_in": as_ist(attendance.check_in_time),
        "current_status": attendance.status,
        "already_checked_in": already_checked_in,
        "attendance": attendance_payload,
        "today_attendance": attendance_payload,
    }


def _employee_ids_for_stores(db: Session, store_ids_query):
    return db.query(EmployeeStoreMapping.employee_id).filter(
        EmployeeStoreMapping.store_id.in_(store_ids_query)
    )


def _apply_attendance_scope(query, db: Session, current_user: User):
    if current_user.role in {RoleEnum.superadmin, RoleEnum.admin}:
        return query

    if current_user.role == RoleEnum.employee:
        return query.filter(Attendance.user_id == current_user.id)

    if current_user.role == RoleEnum.delivery_manager:
        managed_store_ids = db.query(Store.id).filter(
            Store.assigned_manager_id == current_user.id
        )
        mapped_employee_ids = _employee_ids_for_stores(db, managed_store_ids)
        direct_employee_ids = db.query(User.id).filter(
            User.assigned_manager_id == current_user.id
        )
        return query.filter(
            or_(
                Attendance.user_id.in_(mapped_employee_ids),
                Attendance.user_id.in_(direct_employee_ids),
            )
        )

    if current_user.role in {RoleEnum.partner, RoleEnum.sub_partner}:
        assigned_store_ids = db.query(PartnerStore.store_id).filter(
            PartnerStore.user_id == current_user.id
        )
        return query.filter(
            Attendance.user_id.in_(
                _employee_ids_for_stores(db, assigned_store_ids)
            )
        )

    raise HTTPException(status_code=403, detail="Attendance access is not allowed for this role")


def _scoped_employee_ids(db: Session, current_user: User) -> list[int] | None:
    if current_user.role in {RoleEnum.superadmin, RoleEnum.admin}:
        return None
    if current_user.role == RoleEnum.employee:
        return [current_user.id]
    if current_user.role == RoleEnum.delivery_manager:
        managed_store_ids = db.query(Store.id).filter(
            Store.assigned_manager_id == current_user.id
        )
        mapped_ids = _employee_ids_for_stores(db, managed_store_ids)
        rows = db.query(User.id).filter(
            User.role == RoleEnum.employee,
            or_(
                User.assigned_manager_id == current_user.id,
                User.id.in_(mapped_ids),
            ),
        ).all()
        return [row.id for row in rows]
    if current_user.role in {RoleEnum.partner, RoleEnum.sub_partner}:
        assigned_store_ids = db.query(PartnerStore.store_id).filter(
            PartnerStore.user_id == current_user.id
        )
        rows = db.query(User.id).filter(
            User.role == RoleEnum.employee,
            User.id.in_(_employee_ids_for_stores(db, assigned_store_ids)),
        ).all()
        return [row.id for row in rows]
    raise HTTPException(status_code=403, detail="Attendance access is not allowed for this role")


def _require_employee_self_service(current_user: User) -> None:
    if current_user.role != RoleEnum.employee:
        raise HTTPException(
            status_code=403,
            detail="Employee attendance self-service is only available to employees",
        )


def _ensure_leave_in_scope(db: Session, current_user: User, leave_id: int) -> Leave:
    query = db.query(Leave).filter(Leave.id == leave_id)
    scoped_ids = _scoped_employee_ids(db, current_user)
    if scoped_ids is not None:
        query = query.filter(Leave.user_id.in_(scoped_ids))
    leave = query.first()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")
    return leave


@router.post("/check-in")
def check_in(
    location: AttendanceLocationIn | None = Body(default=None),
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.checkin"))
):
    try:
        return _perform_check_in(db, current_user, location, latitude, longitude)
    except HTTPException:
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Attendance check-in conflicts with an existing record.",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Attendance service is temporarily unavailable.",
        ) from exc


def _perform_check_in(
    db: Session,
    current_user: User,
    location: AttendanceLocationIn | None,
    latitude: float | None,
    longitude: float | None,
):
    _require_employee_self_service(current_user)
    # One clock read owns both the timestamp and its IST business date.  This
    # prevents a midnight boundary from attaching a new instant to yesterday.
    checked_in_at = utc_now()
    attendance_date = as_ist(checked_in_at).date()
    if isinstance(location, AttendanceLocationIn):
        latitude = latitude if latitude is not None else location.latitude
        longitude = longitude if longitude is not None else location.longitude

    existing = db.query(Attendance).filter_by(
        user_id=current_user.id,
        date=attendance_date
    ).first()

    if existing:
        return _update_existing_check_in(
            db,
            existing,
            current_user.id,
            attendance_date,
            checked_in_at,
            latitude,
            longitude,
        )

    attendance = Attendance(
        user_id=current_user.id,
        date=attendance_date,
        check_in_time=checked_in_at,
        status=_check_in_status(
            db, current_user.id, attendance_date, checked_in_at
        ),
        latitude=latitude,
        longitude=longitude
    )

    db.add(attendance)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(Attendance).filter_by(
            user_id=current_user.id,
            date=attendance_date,
        ).first()
        if existing:
            return _update_existing_check_in(
                db,
                existing,
                current_user.id,
                attendance_date,
                checked_in_at,
                latitude,
                longitude,
            )
        raise HTTPException(
            status_code=409,
            detail="Attendance check-in could not be saved due to a data conflict.",
        )
    db.refresh(attendance)

    return _check_in_response(
        attendance,
        user_id=current_user.id,
        attendance_date=attendance_date,
        already_checked_in=False,
    )


def _update_existing_check_in(
    db: Session,
    attendance: Attendance,
    user_id: int,
    attendance_date: date,
    checked_in_at: datetime,
    latitude: float | None,
    longitude: float | None,
) -> dict:
    """Repair/update today's row instead of attempting a duplicate insert."""
    already_checked_in = attendance.check_in_time is not None

    expected_date = as_ist(checked_in_at).date()
    if attendance.date != expected_date:
        raise HTTPException(
            status_code=409,
            detail="Attendance record date does not match the current IST date.",
        )

    if attendance.check_in_time is not None:
        stored_check_in_date = as_ist(attendance.check_in_time).date()
        if stored_check_in_date != attendance.date:
            raise HTTPException(
                status_code=409,
                detail="Existing attendance record has an inconsistent check-in date.",
            )

    if attendance.check_in_time is None:
        attendance.check_in_time = checked_in_at
        attendance.status = _check_in_status(
            db, user_id, attendance_date, checked_in_at
        )

    if latitude is not None:
        attendance.latitude = latitude
    if longitude is not None:
        attendance.longitude = longitude

    db.commit()
    db.refresh(attendance)
    return _check_in_response(
        attendance,
        user_id=user_id,
        attendance_date=attendance_date,
        already_checked_in=already_checked_in,
    )



@router.post("/check-out")
def check_out(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.checkout"))
):
    _require_employee_self_service(current_user)
    today = ist_today()

    attendance = db.query(Attendance).filter_by(
        user_id=current_user.id,
        date=today
    ).with_for_update().first()

    if not attendance:
        raise HTTPException(status_code=400, detail="Check-in first")

    if attendance.check_out_time:
        return {
            "message": "Already checked out",
            "check_out": as_ist(attendance.check_out_time),
            "working_hours": round(attendance.working_hours or 0.0, 2),
            "overtime": _overtime_hours(attendance),
            "late_minutes": _late_minutes(attendance),
            "early_departure": _early_departure_minutes(attendance),
            "attendance_status": attendance.status,
            "already_checked_out": True,
        }

    if not attendance.check_in_time:
        raise HTTPException(status_code=400, detail="Invalid attendance record: check-in missing")

    attendance.check_out_time = utc_now()

    check_out_time = as_utc(attendance.check_out_time)
    check_in_time = as_utc(attendance.check_in_time)
    if check_out_time < check_in_time:
        raise HTTPException(status_code=400, detail="Check-out cannot be before check-in")

    # working hours calculation
    diff = check_out_time - check_in_time
    attendance.working_hours = round(diff.total_seconds() / 3600, 4)
    attendance.status = _completed_status(attendance)

    try:
        db.commit()
        db.refresh(attendance)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Attendance check-out could not be saved",
        ) from exc

    return {
        "message": "Checked out successfully",
        "check_out": as_ist(attendance.check_out_time),
        "working_hours": round(attendance.working_hours or 0.0, 2),
        "overtime": _overtime_hours(attendance),
        "late_minutes": _late_minutes(attendance),
        "early_departure": _early_departure_minutes(attendance),
        "attendance_status": attendance.status,
        "already_checked_out": False,
    }

@router.get("/me", response_model=AttendanceTodayOut)
def get_my_attendance(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.view"))
):
    _require_employee_self_service(current_user)
    today = ist_today()
    attendance = db.query(Attendance).filter_by(
        user_id=current_user.id,
        date=today,
    ).first()
    return _attendance_payload(
        attendance,
        user_id=current_user.id,
        attendance_date=today,
    )



@router.get("/all", response_model=AttendancePageOut)
def get_all_attendance(
    employee_id: int | None = None,
    store_id: str | None = None,
    delivery_manager_id: int | None = None,
    city: str | None = None,
    state: str | None = None,
    attendance_status: str | None = Query(default=None, alias="status"),
    attendance_date: date | None = Query(default=None, alias="date"),
    month: int | None = Query(default=None, ge=1, le=12),
    year: int | None = Query(default=None, ge=2000, le=2100),
    from_date: date | None = None,
    to_date: date | None = None,
    search: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    sorting: str = Query(default="-date", max_length=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.report.view"))
):
    if (from_date is None) != (to_date is None):
        raise HTTPException(status_code=400, detail="from_date and to_date must be provided together")
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=400, detail="from_date must be on or before to_date")
    if month is not None and year is None:
        year = ist_today().year
    if year is not None and month is None:
        raise HTTPException(status_code=400, detail="month is required when year is provided")
    if month is not None and (attendance_date or from_date or to_date):
        raise HTTPException(status_code=400, detail="month cannot be combined with date filters")
    if month is not None:
        from_date, to_date = month_bounds(year, month)

    query = (
        db.query(Attendance)
        .join(User, Attendance.user_id == User.id)
        .options(joinedload(Attendance.user))
    )
    query = _apply_attendance_scope(query, db, current_user)

    if employee_id is not None:
        query = query.filter(Attendance.user_id == employee_id)
    if store_id:
        store_employee_ids = db.query(EmployeeStoreMapping.employee_id).filter(
            EmployeeStoreMapping.store_id == store_id
        )
        query = query.filter(Attendance.user_id.in_(store_employee_ids))
    if delivery_manager_id is not None:
        manager_store_ids = db.query(Store.id).filter(
            Store.assigned_manager_id == delivery_manager_id
        )
        mapped_ids = _employee_ids_for_stores(db, manager_store_ids)
        direct_ids = db.query(User.id).filter(
            User.assigned_manager_id == delivery_manager_id
        )
        query = query.filter(
            or_(Attendance.user_id.in_(mapped_ids), Attendance.user_id.in_(direct_ids))
        )
    if city:
        city_store_ids = db.query(Store.id).filter(Store.city.ilike(city.strip()))
        query = query.filter(
            Attendance.user_id.in_(_employee_ids_for_stores(db, city_store_ids))
        )
    if state:
        state_store_ids = db.query(Store.id).filter(Store.state.ilike(state.strip()))
        query = query.filter(
            Attendance.user_id.in_(_employee_ids_for_stores(db, state_store_ids))
        )
    if attendance_status:
        query = query.filter(Attendance.status == attendance_status.strip().lower())
    if attendance_date:
        query = query.filter(Attendance.date == attendance_date)
    if from_date and to_date:
        query = query.filter(Attendance.date.between(from_date, to_date))
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                User.full_name.ilike(pattern),
                User.email.ilike(pattern),
                User.mobile_number.ilike(pattern),
            )
        )

    total_count = query.order_by(None).count()
    sort_descending = sorting.startswith("-") or sorting.lower().endswith(":desc")
    sort_name = sorting.lstrip("-").split(":", 1)[0].lower()
    sort_columns = {
        "date": Attendance.date,
        "check_in": Attendance.check_in_time,
        "check_out": Attendance.check_out_time,
        "working_hours": Attendance.working_hours,
        "status": Attendance.status,
        "employee_name": User.full_name,
    }
    sort_column = sort_columns.get(sort_name)
    if sort_column is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported sorting field: {sort_name}",
        )
    direction = desc if sort_descending else asc
    records = (
        query.order_by(direction(sort_column), Attendance.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = []
    for record in records:
        item = _attendance_payload(
            record,
            user_id=record.user_id,
            attendance_date=record.date,
        )
        item.update(
            {
                "employee_id": record.user_id,
                "employee_name": record.user.full_name if record.user else None,
                "employee_email": record.user.email if record.user else None,
            }
        )
        items.append(item)

    return {
        "items": items,
        "total_count": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": ceil(total_count / page_size) if total_count else 0,
    }


@router.get("/admin/all", response_model=AdminAttendancePageOut)
def get_admin_all_attendance(
    employee_id: int | None = None,
    store_id: str | None = None,
    attendance_status: str | None = Query(default=None, alias="status"),
    from_date: date | None = None,
    to_date: date | None = None,
    search: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.report.view")),
):
    """Flattened, read-only attendance feed for the Super Admin dashboard."""
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Super Admin access required")
    if (from_date is None) != (to_date is None):
        raise HTTPException(
            status_code=400,
            detail="from_date and to_date must be provided together",
        )
    if from_date and to_date and from_date > to_date:
        raise HTTPException(
            status_code=400,
            detail="from_date must be on or before to_date",
        )

    # A user can have multiple store mappings. Pick the first stable mapping for
    # display so pagination counts attendance records rather than join products.
    display_store_id = (
        select(EmployeeStoreMapping.store_id)
        .where(EmployeeStoreMapping.employee_id == Attendance.user_id)
        .order_by(EmployeeStoreMapping.store_id.asc())
        .limit(1)
        .correlate(Attendance)
        .scalar_subquery()
    )
    display_store_name = (
        select(Store.store_name)
        .join(EmployeeStoreMapping, EmployeeStoreMapping.store_id == Store.id)
        .where(EmployeeStoreMapping.employee_id == Attendance.user_id)
        .order_by(EmployeeStoreMapping.store_id.asc())
        .limit(1)
        .correlate(Attendance)
        .scalar_subquery()
    )
    matching_leave_id = (
        select(Leave.id)
        .where(
            Leave.user_id == Attendance.user_id,
            Leave.from_date <= Attendance.date,
            Leave.to_date >= Attendance.date,
        )
        .order_by(Leave.created_at.desc(), Leave.id.desc())
        .limit(1)
        .correlate(Attendance)
        .scalar_subquery()
    )
    approver = aliased(User)

    query = (
        db.query(
            Attendance.id.label("attendance_id"),
            Attendance.user_id.label("employee_id"),
            User.full_name.label("employee_name"),
            User.email.label("employee_email"),
            display_store_id.label("store_id"),
            display_store_name.label("store_name"),
            Attendance.date.label("attendance_date"),
            Attendance.check_in_time.label("check_in"),
            Attendance.check_out_time.label("check_out"),
            Attendance.working_hours.label("working_hours"),
            Attendance.status.label("attendance_status"),
            Leave.status.label("leave_status"),
            Leave.reason.label("leave_reason"),
            approver.full_name.label("approved_by"),
            Leave.approved_at.label("approved_at"),
            Attendance.latitude.label("latitude"),
            Attendance.longitude.label("longitude"),
        )
        .join(User, Attendance.user_id == User.id)
        .outerjoin(Leave, Leave.id == matching_leave_id)
        .outerjoin(approver, Leave.approved_by == approver.id)
    )

    if employee_id is not None:
        query = query.filter(Attendance.user_id == employee_id)
    if store_id:
        query = query.filter(
            Attendance.user_id.in_(
                select(EmployeeStoreMapping.employee_id).where(
                    EmployeeStoreMapping.store_id == store_id
                )
            )
        )
    if attendance_status:
        query = query.filter(
            Attendance.status == attendance_status.strip().lower()
        )
    if from_date and to_date:
        query = query.filter(
            Attendance.date >= from_date,
            Attendance.date <= to_date,
        )
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        matching_store_employees = select(EmployeeStoreMapping.employee_id).join(
            Store, EmployeeStoreMapping.store_id == Store.id
        ).where(Store.store_name.ilike(pattern))
        query = query.filter(
            or_(
                User.full_name.ilike(pattern),
                User.email.ilike(pattern),
                Attendance.user_id.in_(matching_store_employees),
            )
        )

    total_count = query.order_by(None).count()
    rows = (
        query.order_by(Attendance.date.desc(), Attendance.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = [
        {
            "attendance_id": row.attendance_id,
            "employee_id": row.employee_id,
            "employee_name": row.employee_name,
            "employee_email": row.employee_email,
            "employee_code": None,
            "store_id": row.store_id,
            "store_name": row.store_name,
            "attendance_date": row.attendance_date,
            "check_in": as_ist(row.check_in),
            "check_out": as_ist(row.check_out),
            "working_hours": round(row.working_hours or 0.0, 2),
            "attendance_status": row.attendance_status,
            "late_minutes": _late_minutes(
                SimpleNamespace(
                    date=row.attendance_date,
                    check_in_time=row.check_in,
                )
            ),
            "half_day": row.attendance_status == "half_day",
            "leave_status": row.leave_status,
            "leave_type": None,
            "leave_reason": row.leave_reason,
            "approved_by": row.approved_by,
            "approved_at": row.approved_at,
            "latitude": row.latitude,
            "longitude": row.longitude,
        }
        for row in rows
    ]
    return {
        "items": items,
        "total_count": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": ceil(total_count / page_size) if total_count else 0,
    }


@router.get("/summary/me")
def get_my_attendance_summary(
    month: int = Query(default_factory=lambda: ist_today().month, ge=1, le=12),
    year: int = Query(default_factory=lambda: ist_today().year, ge=2000, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.view")),
):
    _require_employee_self_service(current_user)
    return employee_month_summary(db, current_user.id, year, month)


@router.get("/summary/admin")
def get_admin_attendance_summary(
    start_date: date | None = None,
    end_date: date | None = None,
    month: int | None = Query(default=None, ge=1, le=12),
    year: int | None = Query(default=None, ge=2000, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.report.view")),
):
    today = ist_today()
    if start_date is None and end_date is None:
        selected_year = year or today.year
        selected_month = month or today.month
        start_date, end_date = month_bounds(selected_year, selected_month)
    elif start_date is None or end_date is None:
        raise HTTPException(status_code=400, detail="start_date and end_date must be provided together")

    if start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be on or before end_date")

    return admin_summary(
        db,
        start_date,
        end_date,
        employee_ids=_scoped_employee_ids(db, current_user),
    )



@router.post("/leave/apply")
def apply_leave(
    request: LeaveCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.leave.apply"))
):
    _require_employee_self_service(current_user)
    today = ist_today()
    range_days = (request.to_date - request.from_date).days + 1
    requested_days = [request.from_date + timedelta(days=offset) for offset in range(range_days)]
    holidays = {
        row.date for row in db.query(Holiday.date).filter(
            Holiday.date.between(request.from_date, request.to_date)
        ).all()
    }
    # Sunday is the only weekly non-working day. Python weekday(): Monday=0,
    # Sunday=6. Dates are already calendar dates and require no timezone cast.
    working_days = [
        day for day in requested_days if day.weekday() != 6 and day not in holidays
    ]
    attendance_rows = db.query(Attendance.id).filter(
        Attendance.user_id == current_user.id,
        Attendance.date >= request.from_date,
        Attendance.date <= request.to_date,
    ).all()
    leave_rows = db.query(Leave.id).filter(
        Leave.user_id == current_user.id,
        Leave.status.in_(["pending", "approved"]),
        Leave.from_date <= request.to_date,
        Leave.to_date >= request.from_date,
    ).all()
    validation_context = {
        "user_id": current_user.id,
        "requested_start": request.from_date,
        "requested_end": request.to_date,
        "selected_dates": requested_days,
        "working_days": working_days,
        "holidays": sorted(holidays),
        "attendance_rows": [row.id for row in attendance_rows],
        "leave_rows": [row.id for row in leave_rows],
        "sql_filters": {
            "attendance": "user_id=current_user.id AND date>=from_date AND date<=to_date",
            "leave": "user_id=current_user.id AND status IN (pending,approved) AND from_date<=requested_to_date AND to_date>=requested_from_date",
            "holiday": "date>=from_date AND date<=to_date",
        },
    }
    logger.debug("Leave application validation context: %s", validation_context)

    if request.from_date < today:
        logger.warning("Leave application rejected (past date): %s", validation_context)
        raise HTTPException(status_code=400, detail="Leave cannot start in the past")
    if not working_days:
        logger.warning("Leave application rejected (no working days): %s", validation_context)
        raise HTTPException(
            status_code=400,
            detail="Leave range contains no working days",
        )
    if attendance_rows:
        logger.warning("Leave application rejected (attendance conflict): %s", validation_context)
        raise HTTPException(status_code=409, detail="Leave request conflicts with existing data")
    if leave_rows:
        logger.warning("Leave application rejected (leave overlap): %s", validation_context)
        raise HTTPException(status_code=400, detail="Leave request overlaps an existing leave")

    leave = Leave(
        user_id=current_user.id,
        from_date=request.from_date,
        to_date=request.to_date,
        reason=request.reason
    )

    try:
        db.add(leave)
        # Flush and refresh before commit so a schema/serialization failure cannot
        # report an error after the leave row has already been committed.
        db.flush()
        db.refresh(leave)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.exception(
            "Leave request integrity failure: validation=%s database_error=%s",
            validation_context,
            exc.orig,
        )
        raise HTTPException(status_code=409, detail="Leave request conflicts with existing data") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception(
            "Leave request database failure for user_id=%s, from_date=%s, to_date=%s",
            current_user.id,
            request.from_date,
            request.to_date,
        )
        # Do not mask ProgrammingError/OperationalError while the production
        # schema is being stabilized; the original database error and SQL are
        # preserved in logs and exception handling.
        raise

    return {"message": "Leave applied", "leave_id": leave.id, "status": leave.status}


@router.get("/leave/me", response_model=list[LeaveOut])
def get_my_leaves(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.view"))
):
    _require_employee_self_service(current_user)
    return (
        db.query(Leave)
        .filter_by(user_id=current_user.id)
        .order_by(Leave.created_at.desc())
        .all()
    )


@router.get("/leave/pending", response_model=list[LeaveOut])
def get_pending_leaves(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.leave.approve"))
):
    query = db.query(Leave).filter(Leave.status == "pending")
    scoped_ids = _scoped_employee_ids(db, current_user)
    if scoped_ids is not None:
        query = query.filter(Leave.user_id.in_(scoped_ids))
    return (
        query
        .order_by(Leave.created_at.asc())
        .all()
    )


@router.put("/leave/approve/{leave_id}")
def approve_leave(
    leave_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.leave.approve"))
):
    _ensure_leave_in_scope(db, current_user, leave_id)

    updated = db.query(Leave).filter(
        Leave.id == leave_id,
        Leave.status == "pending",
    ).update(
        {
            Leave.status: "approved",
            Leave.approved_by: current_user.id,
            Leave.approved_at: utc_now(),
        },
        synchronize_session=False,
    )
    if not updated:
        db.rollback()
        raise HTTPException(status_code=400, detail="Leave request has already been processed")

    db.commit()

    return {"message": "Leave approved"}


@router.put("/leave/reject/{leave_id}")
def reject_leave(
    leave_id: int,
    request: LeaveReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.leave.approve"))
):
    _ensure_leave_in_scope(db, current_user, leave_id)

    updated = db.query(Leave).filter(
        Leave.id == leave_id,
        Leave.status == "pending",
    ).update(
        {
            Leave.status: "rejected",
            Leave.rejected_by: current_user.id,
            Leave.rejected_at: utc_now(),
            Leave.rejection_reason: request.rejection_reason,
        },
        synchronize_session=False,
    )
    if not updated:
        db.rollback()
        raise HTTPException(status_code=400, detail="Leave request has already been processed")

    db.commit()
    return {"message": "Leave rejected"}


@router.put("/leave/cancel/{leave_id}")
def cancel_leave(
    leave_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.leave.apply"))
):
    _require_employee_self_service(current_user)
    leave = db.query(Leave.id).filter(
        Leave.id == leave_id,
        Leave.user_id == current_user.id,
    ).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")

    updated = db.query(Leave).filter(
        Leave.id == leave_id,
        Leave.user_id == current_user.id,
        Leave.status == "pending",
    ).update(
        {Leave.status: "cancelled"},
        synchronize_session=False,
    )
    if not updated:
        db.rollback()
        raise HTTPException(status_code=400, detail="Only pending leave can be cancelled")

    db.commit()
    return {"message": "Leave cancelled"}


@router.post("/holiday")
def add_holiday(
    request: HolidayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attendance.holiday.manage"))
):
    holiday = Holiday(
        date=request.date,
        title=request.title
    )

    try:
        db.add(holiday)
        db.commit()
        db.refresh(holiday)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A holiday already exists on this date") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Holiday could not be saved") from exc

    return {"message": "Holiday added", "holiday_id": holiday.id}


@router.get("/holiday", response_model=list[HolidayOut])
def get_holidays(
    year: int | None = Query(default=None, ge=2000, le=2100),
    current_year: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    if current_year:
        year = ist_today().year
    query = db.query(Holiday)
    if year is not None:
        start_date, end_date = date(year, 1, 1), date(year, 12, 31)
        query = query.filter(Holiday.date.between(start_date, end_date))
    return query.order_by(Holiday.date.asc(), Holiday.id.asc()).all()
