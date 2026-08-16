import unittest
from datetime import date, datetime
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models
from backend.database.db import Base, get_db
from backend.models.employee_permission import EmployeePermission
from backend.models.monthly_virtual_card import MonthlyVirtualCard
from backend.models.order import Order, OrderStatusEnum
from backend.models.partner_store import PartnerStore
from backend.models.permission import Permission
from backend.models.store import Store
from backend.models.user import RoleEnum, User
from backend.routes import monthly_virtual_cards
from backend.services.monthly_virtual_card import (
    IST,
    MonthlyVirtualCardClosedError,
    MonthlyVirtualCardInactiveStoreError,
)
from backend.utils.jwt import get_current_user


class MonthlyVirtualCardEntryRouteTests(unittest.TestCase):
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
            "employee2@test.local", RoleEnum.employee
        )
        self.partner = self.add_user("partner@test.local", RoleEnum.partner)
        permission = Permission(
            module="Monthly Virtual Cards",
            action="update",
            permission_key="monthly_virtual_cards.update",
            display_name="Update Monthly Virtual Cards",
            is_active=True,
        )
        self.db.add(permission)
        self.db.flush()
        self.db.add(
            EmployeePermission(
                employee_id=self.employee.id,
                permission_id=permission.id,
            )
        )
        self.store = Store(
            id="store-1",
            store_name="Store One",
            is_active=True,
            channel="GENERAL",
            pending_empty_bottles=0,
        )
        self.db.add(self.store)
        self.db.flush()
        self.db.add(PartnerStore(user_id=self.partner.id, store_id=self.store.id))
        self.card = MonthlyVirtualCard(
            store_id=self.store.id,
            year=2026,
            month=8,
            status="open",
        )
        self.db.add(self.card)
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

    def add_scheduled_order(self):
        order = Order(
            partner_id=self.partner.id,
            store_id=self.store.id,
            status=OrderStatusEnum.assigned_to_manager,
            order_details="10",
            total_amount=0,
            channel=self.store.channel,
            order_date=IST.localize(datetime(2026, 8, 5, 10)),
            bottles_delivered=0,
            empty_bottles_collected=0,
            ordered_by_type="SCHEDULED",
        )
        self.db.add(order)
        self.db.commit()
        return order

    def put(self, *, card_id=None, entry_date="2026-08-05", delivered=20, empty=5):
        return self.client.put(
            f"/monthly-virtual-cards/{card_id or self.card.id}/entries/{entry_date}",
            json={
                "bottles_delivered": delivered,
                "empty_bottles_collected": empty,
                "remarks": "verified",
            },
        )

    def test_superadmin_can_create_entry_and_virtual_card_order(self):
        response = self.put()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["order_created"])
        self.assertTrue(body["entry_created"])
        self.assertEqual(body["order_status"], "delivered_confirmed")
        order = self.db.get(Order, body["order_id"])
        self.assertEqual(order.ordered_by_type, "VIRTUAL_CARD")

    def test_employee_with_permission_can_create_and_update(self):
        self.current_user = self.employee
        first = self.put()
        second = self.put(delivered=22, empty=6)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["previous_bottles_delivered"], 20)
        self.assertEqual(second.json()["final_bottles_delivered"], 22)

    def test_employee_without_permission_receives_403(self):
        self.current_user = self.employee_without_permission
        self.assertEqual(self.put().status_code, 403)

    def test_unauthorized_request_rolls_back(self):
        self.current_user = self.employee_without_permission
        with patch.object(self.db, "rollback", wraps=self.db.rollback) as rollback:
            response = self.put()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(rollback.call_count, 1)

    def test_all_other_roles_receive_403(self):
        roles = [
            RoleEnum.partner,
            RoleEnum.sub_partner,
            RoleEnum.delivery,
            RoleEnum.delivery_manager,
            RoleEnum.channel_admin,
            RoleEnum.admin,
        ]
        for index, role in enumerate(roles):
            with self.subTest(role=role):
                self.current_user = self.add_user(f"role{index}@test.local", role)
                self.assertEqual(self.put().status_code, 403)

    def test_existing_scheduled_order_is_reused(self):
        existing = self.add_scheduled_order()
        response = self.put()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["order_created"])
        self.assertEqual(response.json()["order_id"], existing.id)

    def test_repeat_identical_request_is_idempotent(self):
        first = self.put().json()
        second = self.put().json()
        self.assertEqual(first["order_id"], second["order_id"])
        self.assertFalse(second["order_created"])
        self.assertFalse(second["entry_created"])
        self.assertEqual(second["store_pending_empty_bottles"], 15)
        self.assertEqual(second["linked_order_ids"], [first["order_id"]])

    def test_update_returns_previous_and_final_values(self):
        self.put(delivered=20, empty=5)
        body = self.put(delivered=24, empty=7).json()
        self.assertEqual(body["previous_bottles_delivered"], 20)
        self.assertEqual(body["previous_empty_bottles_collected"], 5)
        self.assertEqual(body["final_bottles_delivered"], 24)
        self.assertEqual(body["final_empty_bottles_collected"], 7)

    def test_success_commits_exactly_once(self):
        with patch.object(self.db, "commit", wraps=self.db.commit) as commit:
            response = self.put()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(commit.call_count, 1)

    def test_domain_and_database_failures_rollback(self):
        for error in (
            MonthlyVirtualCardInactiveStoreError("Store is inactive"),
            RuntimeError("database failed"),
        ):
            with self.subTest(error=type(error).__name__), patch.object(
                monthly_virtual_cards,
                "upsert_monthly_virtual_card_entry",
                side_effect=error,
            ), patch.object(self.db, "rollback", wraps=self.db.rollback) as rollback:
                response = self.put()
                self.assertEqual(rollback.call_count, 1)
                self.assertEqual(
                    response.status_code,
                    409 if isinstance(error, MonthlyVirtualCardInactiveStoreError) else 500,
                )

    def test_http_exception_path_rolls_back_and_reraises(self):
        with patch.object(
            monthly_virtual_cards,
            "_require_monthly_card_access",
            side_effect=HTTPException(status_code=403, detail="Forbidden"),
        ), patch.object(self.db, "rollback", wraps=self.db.rollback) as rollback:
            response = self.put()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Forbidden")
        self.assertEqual(rollback.call_count, 1)

    def test_closed_card_maps_to_409(self):
        self.card.status = "closed"
        self.db.commit()
        response = self.put()
        self.assertEqual(response.status_code, 409)
        self.assertIn("not open", response.json()["detail"])

    def test_month_mismatch_maps_to_400(self):
        response = self.put(entry_date="2026-09-05")
        self.assertEqual(response.status_code, 400)

    def test_missing_card_maps_to_404(self):
        response = self.put(card_id=99999)
        self.assertEqual(response.status_code, 404)

    def test_invalid_quantities_are_rejected_by_schema(self):
        self.assertEqual(self.put(delivered=-1).status_code, 422)
        self.assertEqual(self.put(empty=-1).status_code, 422)

    def test_invalid_iso_entry_date_returns_422(self):
        self.assertEqual(self.put(entry_date="not-a-date").status_code, 422)

    def test_inactive_store_maps_to_409(self):
        self.store.is_active = False
        self.db.commit()
        response = self.put()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "The associated store is inactive.")

    def test_invalid_partner_mapping_maps_to_409(self):
        self.db.query(PartnerStore).delete()
        self.db.commit()
        response = self.put()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"],
            "The store has no valid partner mapping.",
        )

    def test_ambiguous_prior_quantities_map_to_409(self):
        order = self.add_scheduled_order()
        order.bottles_delivered = 3
        self.db.commit()
        response = self.put()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"],
            "Existing order quantities cannot be reconciled safely.",
        )

    def test_negative_balance_maps_to_409(self):
        response = self.put(delivered=0, empty=1)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"],
            "The entry would produce an invalid empty-bottle balance.",
        )

    def test_domain_error_does_not_expose_exception_text(self):
        with patch.object(
            monthly_virtual_cards,
            "upsert_monthly_virtual_card_entry",
            side_effect=MonthlyVirtualCardClosedError("secret internal state"),
        ):
            response = self.put()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "Monthly virtual card is not open.")
        self.assertNotIn("secret", response.text)

    def test_unexpected_value_error_is_generic_500(self):
        with patch.object(
            monthly_virtual_cards,
            "upsert_monthly_virtual_card_entry",
            side_effect=ValueError("sensitive implementation detail"),
        ):
            response = self.put()
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json()["detail"],
            "Monthly virtual card entry update failed.",
        )
        self.assertNotIn("sensitive", response.text)

    def test_real_partial_service_failure_is_rolled_back(self):
        real_flush = self.db.flush
        flush_count = 0

        def fail_after_partial_flush(*args, **kwargs):
            nonlocal flush_count
            flush_count += 1
            if flush_count == 3:
                raise RuntimeError("forced final flush failure")
            return real_flush(*args, **kwargs)

        with patch.object(self.db, "flush", side_effect=fail_after_partial_flush):
            response = self.put()

        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.db.query(Order).count(), 0)
        self.assertEqual(len(self.card.entries), 0)
        self.db.refresh(self.store)
        self.assertEqual(self.store.pending_empty_bottles, 0)

    def test_detail_shows_entry_and_linked_order_ids(self):
        created = self.put().json()
        response = self.client.get(
            "/monthly-virtual-cards/store/store-1/2026/8"
        )
        self.assertEqual(response.status_code, 200)
        entry = response.json()["entries"][0]
        self.assertEqual(entry["id"], created["entry_id"])
        self.assertEqual(entry["entry_date"], "2026-08-05")
        self.assertEqual(entry["entry_source"], "super_admin")
        self.assertEqual(entry["remarks"], "verified")
        self.assertEqual(entry["linked_order_ids"], [created["order_id"]])

    def test_exact_route_path_has_no_doubled_prefix(self):
        paths = self.app.openapi()["paths"]
        expected = "/monthly-virtual-cards/{card_id}/entries/{entry_date}"
        self.assertIn(expected, paths)
        self.assertIn("put", paths[expected])
        self.assertFalse(
            any(path.startswith("/monthly-virtual-cards/monthly-virtual-cards") for path in paths)
        )


if __name__ == "__main__":
    unittest.main()
