"""Reusable, query-efficient attendance dashboard calculations."""

from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from .attendance_settings import (
    GRACE_PERIOD,
    MINIMUM_WORKING_HOURS,
    OFFICE_END_TIME,
    OFFICE_START_TIME,
)
from .models.attendance import Attendance
from .models.holiday import Holiday
from .models.leave import Leave
from .models.user import RoleEnum, User
from .attendance_time import IST, as_ist, ist_today


def month_bounds(year: int, month: int) -> tuple[date, date]:
    if month < 1 or month > 12:
        raise ValueError("month must be between 1 and 12")
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def _dates(start_date: date, end_date: date) -> set[date]:
    return {
        start_date + timedelta(days=offset)
        for offset in range((end_date - start_date).days + 1)
    }


def _expand_leave(leave: Leave, valid_dates: set[date]) -> set[date]:
    start_date = max(leave.from_date, min(valid_dates))
    end_date = min(leave.to_date, max(valid_dates))
    return _dates(start_date, end_date) & valid_dates


def _is_late(record: Attendance) -> bool:
    if not record.check_in_time:
        return False
    cutoff = datetime.combine(record.date, OFFICE_START_TIME, tzinfo=IST) + GRACE_PERIOD
    check_in_time = as_ist(record.check_in_time)
    return check_in_time > cutoff


def _is_early_departure(record: Attendance) -> bool:
    if not record.check_out_time:
        return False
    office_end = datetime.combine(record.date, OFFICE_END_TIME, tzinfo=IST)
    check_out_time = as_ist(record.check_out_time)
    return (
        check_out_time < office_end
        or (record.working_hours or 0.0) < MINIMUM_WORKING_HOURS
    )


def _calculate_summary(
    start_date: date,
    end_date: date,
    attendance: list[Attendance],
    leaves: list[Leave],
    holidays: set[date],
) -> dict:
    effective_end = min(end_date, ist_today())
    if start_date > effective_end:
        workdays: set[date] = set()
    else:
        workdays = {day for day in _dates(start_date, effective_end) if day.weekday() < 5}

    holiday_days = workdays & holidays
    leave_days: set[date] = set()
    for leave in leaves:
        leave_days.update(_expand_leave(leave, workdays) if workdays else set())
    leave_days -= holiday_days

    eligible_days = workdays - holiday_days - leave_days
    attended_days = {record.date for record in attendance} & eligible_days
    eligible_attendance = [record for record in attendance if record.date in eligible_days]
    absent_days = eligible_days - attended_days
    denominator = len(eligible_days)

    present_days = len(attended_days)
    absent_days_count = len(absent_days)
    leave_days_count = len(leave_days)
    holiday_days_count = len(holiday_days)
    late_count = sum(_is_late(record) for record in eligible_attendance)
    working_hours = round(sum(record.working_hours or 0.0 for record in attendance), 2)
    return {
        "present_days": present_days,
        "absent_days": absent_days_count,
        "leave_days": leave_days_count,
        "holiday_days": holiday_days_count,
        "holiday_count": holiday_days_count,
        "late_arrival_count": late_count,
        "late_count": late_count,
        "early_departure_count": sum(_is_early_departure(record) for record in eligible_attendance),
        "total_working_hours": working_hours,
        "working_hours": working_hours,
        "attendance_percentage": round((present_days / denominator * 100), 2) if denominator else 0.0,
    }


def employee_month_summary(db: Session, user_id: int, year: int, month: int) -> dict:
    month_start, month_end = month_bounds(year, month)
    employee = db.query(User.created_at).filter(User.id == user_id).first()
    effective_start = (
        max(month_start, employee.created_at.date())
        if employee and employee.created_at
        else month_start
    )
    attendance = db.query(Attendance).filter(
        Attendance.user_id == user_id,
        Attendance.date >= month_start,
        Attendance.date <= month_end,
    ).all()
    leaves = db.query(Leave).filter(
        Leave.user_id == user_id,
        Leave.status == "approved",
        Leave.from_date <= month_end,
        Leave.to_date >= month_start,
    ).all()
    holidays = {
        row.date
        for row in db.query(Holiday.date).filter(
            Holiday.date >= month_start,
            Holiday.date <= month_end,
        ).all()
    }
    return {
        "month": month,
        "year": year,
        **_calculate_summary(effective_start, month_end, attendance, leaves, holidays),
    }


def admin_summary(
    db: Session,
    start_date: date,
    end_date: date,
    employee_ids: list[int] | None = None,
) -> dict:
    employee_query = db.query(User).filter(
        User.role == RoleEnum.employee,
        User.is_deleted.is_(False),
    )
    if employee_ids is not None:
        employee_query = employee_query.filter(User.id.in_(employee_ids))
    employees = employee_query.all()
    employee_ids = [employee.id for employee in employees]
    today = ist_today()
    query_start = min(start_date, today)
    query_end = max(end_date, today)
    all_attendance = db.query(Attendance).filter(
        Attendance.user_id.in_(employee_ids),
        Attendance.date.between(query_start, query_end),
    ).all() if employee_ids else []
    all_leaves = db.query(Leave).filter(
        Leave.user_id.in_(employee_ids),
        Leave.status == "approved",
        Leave.from_date <= query_end,
        Leave.to_date >= query_start,
    ).all() if employee_ids else []
    all_holidays = {
        row.date for row in db.query(Holiday.date).filter(Holiday.date.between(query_start, query_end)).all()
    }
    attendance = [record for record in all_attendance if start_date <= record.date <= end_date]
    leaves = [leave for leave in all_leaves if leave.from_date <= end_date and leave.to_date >= start_date]
    holidays = {day for day in all_holidays if start_date <= day <= end_date}

    attendance_by_user = defaultdict(list)
    leaves_by_user = defaultdict(list)
    for record in attendance:
        attendance_by_user[record.user_id].append(record)
    for leave in leaves:
        leaves_by_user[leave.user_id].append(leave)

    employee_summaries = [
        {
            "user_id": employee.id,
            "employee_name": employee.full_name,
            **_calculate_summary(
                max(start_date, employee.created_at.date()) if employee.created_at else start_date,
                end_date,
                attendance_by_user[employee.id],
                leaves_by_user[employee.id],
                holidays,
            ),
        }
        for employee in employees
    ]

    today_attendance = [record for record in all_attendance if record.date == today]
    today_leave_ids = {
        leave.user_id for leave in all_leaves if leave.from_date <= today <= leave.to_date
    }
    today_attendance_ids = {record.user_id for record in today_attendance}
    is_workday = today.weekday() < 5 and today not in all_holidays
    today_absent = (
        len(set(employee_ids) - today_attendance_ids - today_leave_ids) if is_workday else 0
    )

    total_present = sum(item["present_days"] for item in employee_summaries)
    total_absent = sum(item["absent_days"] for item in employee_summaries)
    checked_in = sum(record.check_in_time is not None for record in today_attendance)
    checked_out = sum(record.check_out_time is not None for record in today_attendance)
    working_today = sum(
        record.check_in_time is not None and record.check_out_time is None
        for record in today_attendance
    )
    half_day = sum(record.status == "half_day" for record in today_attendance)
    today_late = sum(_is_late(record) for record in today_attendance)
    return {
        "today_present": len(today_attendance_ids),
        "today_absent": today_absent,
        "today_late": today_late,
        "today_early_departure": sum(_is_early_departure(record) for record in today_attendance),
        "today_leave": len(today_leave_ids),
        "today_holiday": len(employee_ids) if today in all_holidays else 0,
        "present": len(today_attendance_ids),
        "absent": today_absent,
        "late": today_late,
        "half_day": half_day,
        "leave": len(today_leave_ids),
        "checked_in": checked_in,
        "checked_out": checked_out,
        "working_today": working_today,
        "total_employees": len(employee_ids),
        "employee_attendance_summary": employee_summaries,
        "date_range_summary": {
            "start_date": start_date,
            "end_date": end_date,
            "present_days": total_present,
            "absent_days": total_absent,
            "leave_days": sum(item["leave_days"] for item in employee_summaries),
            "holiday_days": sum(item["holiday_days"] for item in employee_summaries),
            "late_arrival_count": sum(item["late_arrival_count"] for item in employee_summaries),
            "early_departure_count": sum(item["early_departure_count"] for item in employee_summaries),
            "total_working_hours": round(sum(item["total_working_hours"] for item in employee_summaries), 2),
            "attendance_percentage": round(
                total_present / (total_present + total_absent) * 100,
                2,
            ) if total_present + total_absent else 0.0,
        },
    }
