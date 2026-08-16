import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models
from backend.database.db import Base
from backend.models.employee_permission import EmployeePermission
from backend.models.permission import Permission
from backend.models.user import RoleEnum, User
from backend.routes.employee_menu import get_my_sidebar
from backend.utils.permission_seeder import (
    build_sidebar_modules,
    seed_default_permissions,
)


EXPECTED = {
    "module": "Monthly Virtual Cards",
    "tab": "monthlyVirtualCards",
    "permission": "monthly_virtual_cards.view",
    "icon": "calendar_month",
    "group": "Reports",
}


class MonthlyVirtualCardSidebarTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.superadmin = self.add_user("sidebar-admin@test.local", RoleEnum.superadmin)
        self.employee = self.add_user("sidebar-employee@test.local", RoleEnum.employee)
        seed_default_permissions(self.db)

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_user(self, email, role):
        user = User(
            email=email,
            password="test",
            full_name=email,
            role=role,
            status="active",
        )
        self.db.add(user)
        self.db.flush()
        return user

    def monthly_items(self, user):
        return [
            item
            for item in get_my_sidebar(db=self.db, current_user=user)
            if item["module"] == "Monthly Virtual Cards"
        ]

    def assign(self, user, permission_key):
        permission = self.db.query(Permission).filter(
            Permission.permission_key == permission_key
        ).one()
        self.db.add(
            EmployeePermission(employee_id=user.id, permission_id=permission.id)
        )
        self.db.commit()

    def test_superadmin_and_employee_view_visibility_with_exact_metadata(self):
        admin_items = self.monthly_items(self.superadmin)
        self.assertEqual(len(admin_items), 1)
        self.assertEqual(
            {key: admin_items[0][key] for key in EXPECTED},
            EXPECTED,
        )

        self.assign(self.employee, "monthly_virtual_cards.view")
        employee_items = self.monthly_items(self.employee)
        self.assertEqual(len(employee_items), 1)
        self.assertEqual(employee_items[0]["tab"], "monthlyVirtualCards")

    def test_employee_without_view_permission_cannot_see_item(self):
        self.assign(self.employee, "monthly_virtual_cards.generate")
        self.assign(self.employee, "monthly_virtual_cards.update")
        self.assertEqual(self.monthly_items(self.employee), [])

    def test_wildcard_employee_can_see_item(self):
        wildcard = Permission(
            permission_key="*",
            module="Wildcard",
            action="all",
            display_name="All Access",
            description="Wildcard access.",
            sort_order=999999,
            is_active=True,
        )
        self.db.add(wildcard)
        self.db.flush()
        self.db.add(
            EmployeePermission(employee_id=self.employee.id, permission_id=wildcard.id)
        )
        self.db.commit()
        self.assertEqual(len(self.monthly_items(self.employee)), 1)

    def test_reports_order_and_repeated_seeding_have_no_duplicates(self):
        report_items = [
            item for item in build_sidebar_modules() if item["group"] == "Reports"
        ]
        labels = [item["module"] for item in report_items]
        self.assertLess(
            labels.index("Delivery Reports"),
            labels.index("Monthly Virtual Cards"),
        )
        self.assertLess(
            labels.index("Monthly Virtual Cards"),
            labels.index("Store Reports"),
        )
        monthly = [item for item in report_items if item["module"] == "Monthly Virtual Cards"]
        self.assertEqual(len(monthly), 1)
        self.assertEqual(monthly[0]["order"], 325)

        seed_default_permissions(self.db)
        seed_default_permissions(self.db)
        self.assertEqual(
            self.db.query(Permission).filter(
                Permission.permission_key == "monthly_virtual_cards.view"
            ).count(),
            1,
        )
        self.assertEqual(
            len([
                item
                for item in build_sidebar_modules()
                if item["permission"] == "monthly_virtual_cards.view"
            ]),
            1,
        )


if __name__ == "__main__":
    unittest.main()
