from datetime import date, datetime, timezone
from types import SimpleNamespace
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.attendance_summary import employee_month_summary, month_bounds
from backend.models.attendance import Attendance
from backend.models.holiday import Holiday
from backend.models.leave import Leave
from backend.models.user import RoleEnum
from backend.routes.attendance import (
    _attendance_payload,
    _perform_check_in,
    apply_leave,
    approve_leave,
    cancel_leave,
    get_holidays,
    get_admin_all_attendance,
    get_my_leaves,
    get_pending_leaves,
    reject_leave,
)
from backend.attendance_time import as_ist, as_utc
from backend.schemas.attendance import LeaveCreate, LeaveReject
from unittest.mock import patch


class AttendanceStabilityTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        with engine.begin() as connection:
            connection.execute(text("""
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY, email VARCHAR NOT NULL, password VARCHAR NOT NULL,
                    full_name VARCHAR NOT NULL, role VARCHAR NOT NULL, created_at DATETIME,
                    is_deleted BOOLEAN NOT NULL DEFAULT 0
                )
            """))
            connection.execute(text("""
                CREATE TABLE attendance (
                    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, date DATE NOT NULL,
                    check_in_time DATETIME, check_out_time DATETIME, status VARCHAR,
                    latitude FLOAT, longitude FLOAT, working_hours FLOAT, created_at DATETIME
                )
            """))
            connection.execute(text("""
                CREATE TABLE leaves (
                    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, from_date DATE NOT NULL,
                    to_date DATE NOT NULL, reason VARCHAR, status VARCHAR, approved_by INTEGER,
                    approved_at DATETIME, rejected_by INTEGER, rejected_at DATETIME,
                    rejection_reason VARCHAR, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            connection.execute(text("""
                CREATE TABLE holidays (id INTEGER PRIMARY KEY, date DATE NOT NULL, title VARCHAR NOT NULL)
            """))
            connection.execute(text("""
                CREATE TABLE stores (id VARCHAR PRIMARY KEY, store_name VARCHAR NOT NULL)
            """))
            connection.execute(text("""
                CREATE TABLE employee_store_mapping (
                    id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL,
                    store_id VARCHAR NOT NULL, assigned_by INTEGER, created_at DATETIME
                )
            """))
            connection.execute(
                text("""
                    INSERT INTO users (id, email, password, full_name, role, created_at)
                    VALUES (1, 'employee@example.com', 'x', 'Employee', 'employee', '2026-01-01')
                """)
            )
            connection.execute(
                text("""
                    INSERT INTO users (id, email, password, full_name, role, created_at)
                    VALUES (2, 'other@example.com', 'x', 'Other Employee', 'employee', '2026-01-01')
                """)
            )
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, role=RoleEnum.employee)

    def tearDown(self):
        self.db.close()

    def test_july_month_bounds_and_empty_summary(self):
        self.assertEqual(month_bounds(2026, 7), (date(2026, 7, 1), date(2026, 7, 31)))
        summary = employee_month_summary(self.db, 1, 2026, 7)
        self.assertEqual(summary["present_days"], 0)
        self.assertEqual(summary["working_hours"], 0.0)

    def test_summary_excludes_attendance_outside_month(self):
        self.db.add_all([
            Attendance(user_id=1, date=date(2026, 6, 30), status="present", working_hours=1),
            Attendance(user_id=1, date=date(2026, 7, 1), status="present", working_hours=1),
            Attendance(user_id=1, date=date(2026, 7, 31), status="present", working_hours=1),
            Attendance(user_id=1, date=date(2026, 8, 1), status="present", working_hours=1),
        ])
        self.db.commit()
        summary = employee_month_summary(self.db, 1, 2026, 7)
        # Future days are intentionally excluded from present-day counts, but
        # both inclusive month boundaries must be included in the DB query.
        self.assertEqual(summary["working_hours"], 2.0)

    def test_leave_apply_and_list_are_atomic_and_serializable(self):
        request = LeaveCreate(
            from_date=date(2026, 7, 20), to_date=date(2026, 7, 20), reason="Personal"
        )
        response = apply_leave(request=request, db=self.db, current_user=self.user)
        self.assertEqual(response["status"], "pending")
        leaves = get_my_leaves(db=self.db, current_user=self.user)
        self.assertEqual(len(leaves), 1)
        self.assertEqual(leaves[0].status, "pending")

    def test_empty_leave_and_holiday_queries(self):
        self.assertEqual(get_my_leaves(db=self.db, current_user=self.user), [])
        self.assertEqual(get_holidays(year=2026, current_year=False, db=self.db), [])

    def test_leave_approve_reject_cancel_lifecycle(self):
        admin = SimpleNamespace(id=99, role=RoleEnum.superadmin)
        leaves = [
            Leave(user_id=1, from_date=date(2026, 7, 21), to_date=date(2026, 7, 21), status="pending"),
            Leave(user_id=1, from_date=date(2026, 7, 22), to_date=date(2026, 7, 22), status="pending"),
            Leave(user_id=1, from_date=date(2026, 7, 23), to_date=date(2026, 7, 23), status="pending"),
        ]
        self.db.add_all(leaves)
        self.db.commit()
        self.assertEqual(len(get_pending_leaves(db=self.db, current_user=admin)), 3)

        self.assertEqual(
            approve_leave(leaves[0].id, db=self.db, current_user=admin)["message"],
            "Leave approved",
        )
        self.assertEqual(
            reject_leave(
                leaves[1].id,
                LeaveReject(rejection_reason="Coverage unavailable"),
                db=self.db,
                current_user=admin,
            )["message"],
            "Leave rejected",
        )
        self.assertEqual(
            cancel_leave(leaves[2].id, db=self.db, current_user=self.user)["message"],
            "Leave cancelled",
        )

    def test_admin_flattened_attendance_is_paginated_and_filterable(self):
        self.db.execute(text("INSERT INTO stores (id, store_name) VALUES ('S1', 'Alpha Store')"))
        self.db.execute(text("""
            INSERT INTO employee_store_mapping (employee_id, store_id, created_at)
            VALUES (1, 'S1', '2026-07-01')
        """))
        self.db.add(
            Attendance(
                user_id=1,
                date=date(2026, 7, 17),
                check_in_time=datetime(2026, 7, 17, 4, 0, tzinfo=timezone.utc),
                status="half_day",
                working_hours=3.5,
                latitude=28.6,
                longitude=77.2,
            )
        )
        self.db.add(
            Leave(
                user_id=1,
                from_date=date(2026, 7, 17),
                to_date=date(2026, 7, 17),
                reason="Medical appointment",
                status="approved",
            )
        )
        self.db.commit()
        admin = SimpleNamespace(id=99, role=RoleEnum.superadmin)
        response = get_admin_all_attendance(
            employee_id=1,
            store_id="S1",
            attendance_status="half_day",
            from_date=date(2026, 7, 1),
            to_date=date(2026, 7, 31),
            search="Alpha",
            page=1,
            page_size=50,
            db=self.db,
            current_user=admin,
        )
        self.assertEqual(response["total_count"], 1)
        self.assertEqual(response["total_pages"], 1)
        self.assertEqual(response["items"][0]["store_name"], "Alpha Store")
        self.assertTrue(response["items"][0]["half_day"])
        self.assertIsNone(response["items"][0]["employee_code"])
        self.assertEqual(response["items"][0]["leave_reason"], "Medical appointment")

    def test_saturday_is_working_day_and_sunday_is_not(self):
        saturday = apply_leave(
            LeaveCreate(
                from_date=date(2026, 7, 18),
                to_date=date(2026, 7, 18),
                reason="Saturday leave",
            ),
            db=self.db,
            current_user=self.user,
        )
        self.assertEqual(saturday["status"], "pending")

        with self.assertRaises(HTTPException) as raised:
            apply_leave(
                LeaveCreate(
                    from_date=date(2026, 7, 19),
                    to_date=date(2026, 7, 19),
                    reason="Sunday leave",
                ),
                db=self.db,
                current_user=self.user,
            )
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "Leave range contains no working days")

    def test_other_employee_leave_and_attendance_do_not_conflict(self):
        self.db.add_all([
            Leave(
                user_id=2,
                from_date=date(2026, 7, 20),
                to_date=date(2026, 7, 20),
                status="approved",
            ),
            Attendance(user_id=2, date=date(2026, 7, 20), status="present"),
        ])
        self.db.commit()
        response = apply_leave(
            LeaveCreate(from_date=date(2026, 7, 20), to_date=date(2026, 7, 20)),
            db=self.db,
            current_user=self.user,
        )
        self.assertEqual(response["status"], "pending")

    def test_cancelled_and_rejected_leave_do_not_conflict(self):
        self.db.add_all([
            Leave(
                user_id=1,
                from_date=date(2026, 7, 20),
                to_date=date(2026, 7, 20),
                status="cancelled",
            ),
            Leave(
                user_id=1,
                from_date=date(2026, 7, 21),
                to_date=date(2026, 7, 21),
                status="rejected",
            ),
        ])
        self.db.commit()
        for day in (date(2026, 7, 20), date(2026, 7, 21)):
            with self.subTest(day=day):
                response = apply_leave(
                    LeaveCreate(from_date=day, to_date=day),
                    db=self.db,
                    current_user=self.user,
                )
                self.assertEqual(response["status"], "pending")

    def test_current_employee_pending_and_approved_leave_conflict(self):
        self.db.add_all([
            Leave(
                user_id=1,
                from_date=date(2026, 7, 20),
                to_date=date(2026, 7, 20),
                status="pending",
            ),
            Leave(
                user_id=1,
                from_date=date(2026, 7, 21),
                to_date=date(2026, 7, 21),
                status="approved",
            ),
        ])
        self.db.commit()
        for day in (date(2026, 7, 20), date(2026, 7, 21)):
            with self.subTest(day=day):
                with self.assertRaises(HTTPException) as raised:
                    apply_leave(
                        LeaveCreate(from_date=day, to_date=day),
                        db=self.db,
                        current_user=self.user,
                    )
                self.assertEqual(raised.exception.status_code, 400)
                self.assertEqual(
                    raised.exception.detail,
                    "Leave request overlaps an existing leave",
                )

    def test_check_in_uses_one_instant_for_timestamp_and_ist_date(self):
        checked_in_at = datetime(2026, 8, 3, 13, 1, tzinfo=timezone.utc)
        with patch("backend.routes.attendance.utc_now", return_value=checked_in_at):
            response = _perform_check_in(self.db, self.user, None, None, None)

        record = self.db.query(Attendance).filter_by(user_id=1).one()
        self.assertEqual(as_utc(record.check_in_time), checked_in_at)
        self.assertEqual(record.date, date(2026, 8, 3))
        self.assertEqual(
            response["attendance"]["check_in"],
            datetime(2026, 8, 3, 18, 31, tzinfo=as_ist(checked_in_at).tzinfo),
        )
        self.assertEqual(response["attendance"]["timeline"][0]["time"], "18:31")
        self.assertEqual(response["attendance"]["late_minutes"], 571)

    def test_check_in_date_boundary_uses_same_instant(self):
        cases = [
            (
                datetime(2026, 8, 3, 18, 29, tzinfo=timezone.utc),
                date(2026, 8, 3),
                "23:59",
            ),
            (
                datetime(2026, 8, 3, 18, 31, tzinfo=timezone.utc),
                date(2026, 8, 4),
                "00:01",
            ),
        ]
        for checked_in_at, expected_date, expected_time in cases:
            with self.subTest(expected_time=expected_time):
                self.db.query(Attendance).delete()
                self.db.commit()
                with patch(
                    "backend.routes.attendance.utc_now",
                    return_value=checked_in_at,
                ):
                    response = _perform_check_in(
                        self.db, self.user, None, None, None
                    )
                self.assertEqual(response["attendance"]["date"], expected_date)
                self.assertEqual(
                    response["attendance"]["timeline"][0]["time"],
                    expected_time,
                )

    def test_existing_wrong_date_row_is_not_reused(self):
        self.db.add(
            Attendance(
                user_id=1,
                date=date(2026, 8, 3),
                check_in_time=datetime(
                    2026, 8, 3, 18, 38, 43, tzinfo=timezone.utc
                ),
                status="late",
            )
        )
        self.db.commit()
        with patch(
            "backend.routes.attendance.utc_now",
            return_value=datetime(2026, 8, 3, 13, 1, tzinfo=timezone.utc),
        ):
            with self.assertRaises(HTTPException) as raised:
                _perform_check_in(self.db, self.user, None, None, None)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("inconsistent check-in date", raised.exception.detail)

        record = self.db.query(Attendance).filter_by(user_id=1).one()
        payload = _attendance_payload(
            record,
            user_id=1,
            attendance_date=record.date,
        )
        self.assertEqual(payload["late_minutes"], 0)


if __name__ == "__main__":
    unittest.main()
