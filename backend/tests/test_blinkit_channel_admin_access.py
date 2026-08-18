import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models
from backend.database.db import Base
from backend.models.employee_permission import EmployeePermission
from backend.models.permission import Permission
from backend.models.store import Store
from backend.models.user import RoleEnum, User
from backend.routes import blinkit_reports
from backend.routes.employee_menu import get_my_permissions, get_my_sidebar
from backend.utils.permission_seeder import (
    CHANNEL_ADMIN_BASE_PERMISSION_KEYS,
    seed_default_permissions,
)


class BlinkitChannelAdminAccessTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.superadmin = self.add_user("super@test.local", RoleEnum.superadmin)
        self.employee = self.add_user("employee@test.local", RoleEnum.employee)
        self.blinkit_admin = self.add_user(
            "blinkit@test.local", RoleEnum.channel_admin, " blinkit "
        )
        self.zepto_admin = self.add_user(
            "zepto@test.local", RoleEnum.channel_admin, "ZEPTO"
        )
        seed_default_permissions(self.db)

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_user(self, email, role, channel=None):
        user = User(
            email=email,
            password="test",
            full_name=email,
            role=role,
            channel=channel,
            status="active",
        )
        self.db.add(user)
        self.db.flush()
        return user

    def test_blinkit_channel_admin_gets_existing_menu_and_view_only(self):
        permissions = set(get_my_permissions(db=self.db, current_user=self.blinkit_admin))
        self.assertTrue(set(CHANNEL_ADMIN_BASE_PERMISSION_KEYS).issubset(permissions))
        self.assertIn("blinkit_reports.view", permissions)
        self.assertNotIn("blinkit_reports.export", permissions)
        self.assertNotIn("blinkit_reports.metadata_manage", permissions)
        self.assertNotIn("blinkit_reports.vendor_rate_export", permissions)

        sidebar = get_my_sidebar(db=self.db, current_user=self.blinkit_admin)
        item = next(entry for entry in sidebar if entry["tab"] == "blinkitReports")
        self.assertEqual(
            {key: item[key] for key in (
                "module", "permission", "icon", "tab", "route", "group", "order"
            )},
            {
                "module": "Blinkit Report",
                "permission": "blinkit_reports.view",
                "icon": "assessment",
                "tab": "blinkitReports",
                "route": "blinkitReports",
                "group": "Reports",
                "order": 322,
            },
        )

    def test_non_blinkit_channel_admin_stays_safe(self):
        permissions = set(get_my_permissions(db=self.db, current_user=self.zepto_admin))
        self.assertTrue(set(CHANNEL_ADMIN_BASE_PERMISSION_KEYS).issubset(permissions))
        self.assertNotIn("blinkit_reports.view", permissions)
        self.assertFalse(any(
            item["tab"] == "blinkitReports"
            for item in get_my_sidebar(db=self.db, current_user=self.zepto_admin)
        ))
        with self.assertRaises(HTTPException) as raised:
            blinkit_reports._require_access(
                self.zepto_admin, "blinkit_reports.view", self.db
            )
        self.assertEqual(raised.exception.status_code, 403)

    def test_superadmin_and_employee_behavior_are_unchanged(self):
        admin_permissions = get_my_permissions(db=self.db, current_user=self.superadmin)
        self.assertEqual(
            admin_permissions,
            [row.permission_key for row in self.db.query(Permission).filter(
                Permission.is_active.is_(True)
            ).order_by(Permission.sort_order.asc(), Permission.permission_key.asc()).all()],
        )
        self.assertEqual(get_my_permissions(db=self.db, current_user=self.employee), [])
        self.assertEqual(get_my_sidebar(db=self.db, current_user=self.employee), [])

    def test_repeated_seed_is_idempotent_and_sidebar_order_is_stable(self):
        assignment_count = self.db.query(EmployeePermission).count()
        second = seed_default_permissions(self.db)
        third = seed_default_permissions(self.db)
        self.assertEqual(second["channel_admin_assignments_created"], 0)
        self.assertEqual(third["channel_admin_assignments_created"], 0)
        self.assertEqual(self.db.query(EmployeePermission).count(), assignment_count)
        self.assertEqual(
            self.db.query(Permission).filter_by(
                permission_key="blinkit_reports.view"
            ).count(),
            1,
        )
        items = [
            item for item in get_my_sidebar(db=self.db, current_user=self.blinkit_admin)
            if item["tab"] == "blinkitReports"
        ]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["order"], 322)

    def test_blinkit_report_scope_returns_only_blinkit_stores(self):
        self.db.add_all([
            Store(id="BL-1", store_name="Blinkit", channel="BLINKIT", is_active=True),
            Store(id="ZP-1", store_name="Zepto", channel="ZEPTO", is_active=True),
        ])
        self.db.commit()
        blinkit_reports._require_access(
            self.blinkit_admin, "blinkit_reports.view", self.db
        )
        pairs = blinkit_reports._store_query(
            self.db,
            region=None,
            state_filter=None,
            city=None,
            entity=None,
            store_id=None,
            status_filter=None,
            vendor_name=None,
        ).all()
        self.assertEqual([store.id for store, _metadata in pairs], ["BL-1"])


if __name__ == "__main__":
    unittest.main()
