import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models
from backend.database.db import Base, get_db
from backend.models.employee_permission import EmployeePermission
from backend.models.monthly_virtual_card import MonthlyVirtualCard
from backend.models.permission import Permission
from backend.models.store import Store
from backend.models.user import RoleEnum, User
from backend.routes import monthly_virtual_cards
from backend.utils.jwt import get_current_user


class MonthlyVirtualCardRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False)
        self.db = self.Session()

        self.superadmin = self.add_user("superadmin@test.local", RoleEnum.superadmin)
        self.employee = self.add_user("employee@test.local", RoleEnum.employee)
        self.employee_without_permission = self.add_user(
            "employee2@test.local",
            RoleEnum.employee,
        )
        self.partner = self.add_user("partner@test.local", RoleEnum.partner)

        self.view_permission = self.add_permission(
            "monthly_virtual_cards.view",
            "view",
            "View Monthly Virtual Cards",
        )
        self.generate_permission = self.add_permission(
            "monthly_virtual_cards.generate",
            "generate",
            "Generate Monthly Virtual Cards",
        )
        self.db.add_all(
            [
                EmployeePermission(
                    employee_id=self.employee.id,
                    permission_id=self.view_permission.id,
                ),
                EmployeePermission(
                    employee_id=self.employee.id,
                    permission_id=self.generate_permission.id,
                ),
            ]
        )
        self.db.commit()

        self.current_user = self.superadmin
        self.app = FastAPI()
        self.app.include_router(monthly_virtual_cards.router)
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.app.dependency_overrides[get_current_user] = lambda: self.current_user
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_user(self, email: str, role: RoleEnum) -> User:
        user = User(
            email=email,
            password="test-password",
            full_name=email,
            role=role,
            status="active",
        )
        self.db.add(user)
        self.db.flush()
        return user

    def add_permission(self, key: str, action: str, display_name: str) -> Permission:
        permission = Permission(
            module="Monthly Virtual Cards",
            action=action,
            permission_key=key,
            display_name=display_name,
            is_active=True,
        )
        self.db.add(permission)
        self.db.flush()
        return permission

    def add_store(
        self,
        store_id: str,
        *,
        active: bool = True,
        region: str = "NORTH",
        channel: str = "BLINKIT",
        entity: str = "ENTITY-A",
    ) -> Store:
        store = Store(
            id=store_id,
            store_name=f"Store {store_id}",
            is_active=active,
            region=region,
            channel=channel,
            entity=entity,
            project_code=f"PROJECT-{store_id}",
            state="Delhi",
            city="New Delhi",
            address=f"Address {store_id}",
            zip_code="110001",
        )
        self.db.add(store)
        self.db.commit()
        return store

    def generate(self, year: int = 2026, month: int = 8):
        return self.client.post(
            "/monthly-virtual-cards/generate",
            json={"year": year, "month": month},
        )

    def test_superadmin_generation_success_and_single_commit(self):
        self.add_store("store-1")

        with patch.object(self.db, "commit", wraps=self.db.commit) as commit:
            response = self.generate()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["created_count"], 1)
        self.assertEqual(commit.call_count, 1)

    def test_employee_with_permission_can_generate(self):
        self.add_store("store-1")
        self.current_user = self.employee

        response = self.generate()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["created_count"], 1)

    def test_employee_without_permission_gets_403(self):
        self.add_store("store-1")
        self.current_user = self.employee_without_permission

        response = self.generate()

        self.assertEqual(response.status_code, 403)

    def test_non_employee_role_gets_403(self):
        self.add_store("store-1")
        self.current_user = self.partner

        response = self.generate()

        self.assertEqual(response.status_code, 403)

    def test_repeated_generation_creates_no_duplicates(self):
        self.add_store("store-1")
        self.add_store("store-2")

        first = self.generate()
        second = self.generate()

        self.assertEqual(first.json()["created_count"], 2)
        self.assertEqual(second.json()["created_count"], 0)
        self.assertEqual(second.json()["existing_count"], 2)

    def test_list_filters_by_year_and_month(self):
        self.add_store("store-1")
        self.generate(2026, 8)
        self.generate(2026, 9)

        response = self.client.get(
            "/monthly-virtual-cards",
            params={"year": 2026, "month": 8},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        self.assertEqual(response.json()[0]["month"], 8)

    def test_list_filters_by_store_region_channel_and_entity(self):
        self.add_store(
            "target",
            region="WEST",
            channel="ZEPTO",
            entity="ENTITY-TARGET",
        )
        self.add_store("other")
        self.generate()

        response = self.client.get(
            "/monthly-virtual-cards",
            params={
                "year": 2026,
                "month": 8,
                "store_id": "target",
                "region": "WEST",
                "channel": "ZEPTO",
                "entity": "ENTITY-TARGET",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["store_id"] for item in response.json()], ["target"])

    def test_detail_returns_dynamic_store_fields(self):
        store = self.add_store(
            "store-1",
            region="WEST",
            channel="ZEPTO",
            entity="ENTITY-A",
        )
        self.generate()
        store.store_name = "Updated Dynamic Name"
        self.db.commit()

        response = self.client.get(
            "/monthly-virtual-cards/store/store-1/2026/8"
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["store_name"], "Updated Dynamic Name")
        self.assertEqual(body["entity"], "ENTITY-A")
        self.assertEqual(body["channel"], "ZEPTO")
        self.assertEqual(body["project_code"], "PROJECT-store-1")
        self.assertEqual(body["region"], "WEST")
        self.assertEqual(body["entries"], [])

    def test_detail_returns_404_when_missing(self):
        self.add_store("store-1")

        response = self.client.get(
            "/monthly-virtual-cards/store/store-1/2026/8"
        )

        self.assertEqual(response.status_code, 404)

    def test_invalid_month_returns_422(self):
        response = self.generate(2026, 13)
        list_response = self.client.get(
            "/monthly-virtual-cards",
            params={"year": 2026, "month": 0},
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(list_response.status_code, 422)

    def test_generation_failure_rolls_back(self):
        self.add_store("store-1")

        with (
            patch.object(
                monthly_virtual_cards,
                "ensure_monthly_cards_for_active_stores",
                side_effect=RuntimeError("failure"),
            ),
            patch.object(self.db, "rollback", wraps=self.db.rollback) as rollback,
        ):
            response = self.generate()

        self.assertEqual(response.status_code, 500)
        self.assertEqual(rollback.call_count, 1)

    def test_exact_route_paths_have_no_duplicate_prefix(self):
        openapi_paths = self.app.openapi()["paths"]
        route_methods = {
            (path, method.upper())
            for path, operations in openapi_paths.items()
            for method in operations
        }

        self.assertIn(("/monthly-virtual-cards/generate", "POST"), route_methods)
        self.assertIn(("/monthly-virtual-cards", "GET"), route_methods)
        self.assertIn(
            ("/monthly-virtual-cards/store/{store_id}/{year}/{month}", "GET"),
            route_methods,
        )
        self.assertFalse(
            any(
                path.startswith("/monthly-virtual-cards/monthly-virtual-cards")
                for path in openapi_paths
            )
        )


if __name__ == "__main__":
    unittest.main()
