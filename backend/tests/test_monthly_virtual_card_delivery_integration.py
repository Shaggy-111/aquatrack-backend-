import inspect
import asyncio
from io import BytesIO
import os
from types import SimpleNamespace
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models
from backend.database.db import Base
from backend.models.monthly_virtual_card import (
    MonthlyVirtualCard,
    MonthlyVirtualCardEntry,
    MonthlyVirtualCardEntryOrder,
)
from backend.models.order import Order, OrderStatusEnum
from backend.models.partner_store import PartnerStore
from backend.models.store import Store
from backend.models.store_qr_delivery_submission import StoreQrDeliverySubmission
from backend.models.user import RoleEnum, User
from backend.routes.orders import mark_order_delivered
from backend.routes.partners import (
    PartnerConfirmRequest,
    confirm_order_delivery,
    update_order_status_with_photo,
)
from backend.routes.store_qr_delivery import submit_qr_delivery
from backend.services.monthly_virtual_card import MonthlyVirtualCardDomainError
from backend.services.store_qr_delivery import submit_store_qr_delivery


class MonthlyVirtualCardDeliveryIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.manager = User(
            email="manager-6b@example.com", password="x", full_name="Manager",
            role=RoleEnum.delivery_manager, status="active",
        )
        self.admin = User(
            email="admin-6b@example.com", password="x", full_name="Admin",
            role=RoleEnum.superadmin, status="active",
        )
        self.partner = User(
            email="partner-6b@example.com", password="x", full_name="Partner",
            role=RoleEnum.partner, status="active",
        )
        self.store = Store(
            id="store-6b", store_name="Store 6B", is_active=True,
            assigned_manager_id=None, pending_empty_bottles=5,
            qr_public_id="qr-6b", qr_enabled=True, qr_token_version=1,
        )
        self.db.add_all([self.manager, self.admin, self.partner, self.store])
        self.db.flush()
        self.store.assigned_manager_id = self.manager.id
        self.db.add(PartnerStore(user_id=self.partner.id, store_id=self.store.id))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_order(self, status=OrderStatusEnum.assigned_to_manager):
        order = Order(
            partner_id=self.partner.id,
            store_id=self.store.id,
            assigned_to_manager_id=self.manager.id,
            status=status,
            order_details="10",
            total_amount=0,
            order_date=datetime.now(timezone.utc),
            bottles_delivered=0,
            empty_bottles_collected=0,
        )
        self.db.add(order)
        self.db.commit()
        return order

    def test_delivery_manager_flow_syncs_once_and_preserves_response(self):
        order = self.add_order()
        with patch(
            "backend.routes.partners.sync_order_to_monthly_virtual_card"
        ) as sync:
            response = update_order_status_with_photo(
                order.id, self.db, self.manager,
                OrderStatusEnum.delivered_pending_confirmation,
                10, 2, "V-1", "Driver", None, None,
            )
        sync.assert_called_once_with(self.db, order)
        self.assertEqual(response["order_id"], order.id)
        self.assertEqual(response["status"], "delivered_pending_confirmation")
        self.assertEqual(response["bottles_delivered"], 10)

    def test_super_admin_order_flow_syncs_once_and_preserves_response(self):
        order = self.add_order()
        order.bottles_delivered = 4
        self.db.commit()
        with (
            patch("backend.routes.orders.employee_store_access_required"),
            patch("backend.routes.orders.sync_order_to_monthly_virtual_card") as sync,
        ):
            response = mark_order_delivered(order.id, self.db, self.admin)
        sync.assert_called_once_with(self.db, order)
        self.assertIs(response, order)
        self.assertEqual(response.status, OrderStatusEnum.delivered_confirmed)

    def test_mark_delivered_without_positive_quantity_skips_card_sync(self):
        for quantity in (0, None):
            order = self.add_order()
            order.bottles_delivered = quantity
            self.db.commit()
            with (
                patch("backend.routes.orders.employee_store_access_required"),
                patch(
                    "backend.routes.orders.sync_order_to_monthly_virtual_card"
                ) as sync,
            ):
                response = mark_order_delivered(order.id, self.db, self.admin)
            sync.assert_not_called()
            self.assertEqual(response.status, OrderStatusEnum.delivered_confirmed)
        self.assertEqual(self.db.query(MonthlyVirtualCard).count(), 0)

    def test_mark_delivered_unexpected_sync_failure_rolls_back(self):
        order = self.add_order()
        order.bottles_delivered = 5
        self.db.commit()
        with (
            patch("backend.routes.orders.employee_store_access_required"),
            patch(
                "backend.routes.orders.sync_order_to_monthly_virtual_card",
                side_effect=RuntimeError("unexpected"),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "unexpected"):
                mark_order_delivered(order.id, self.db, self.admin)
        check = self.Session()
        try:
            self.assertEqual(
                check.get(Order, order.id).status,
                OrderStatusEnum.assigned_to_manager,
            )
        finally:
            check.close()

    def test_partner_confirmation_syncs_once_and_preserves_response(self):
        order = self.add_order(OrderStatusEnum.delivered_pending_confirmation)
        order.bottles_delivered = 10
        order.empty_bottles_collected = 2
        self.db.commit()
        body = PartnerConfirmRequest(
            confirmed_bottles=9,
            confirmed_empty_bottles=2,
            confirmation_remarks="confirmed",
        )
        with patch(
            "backend.routes.partners.sync_order_to_monthly_virtual_card"
        ) as sync:
            response = confirm_order_delivery(order.id, body, self.db, self.partner)
        self.assertEqual(sync.call_count, 1)
        self.assertIs(sync.call_args.args[0], self.db)
        self.assertEqual(sync.call_args.args[1].id, order.id)
        self.assertEqual(response["status"], "delivered_confirmed")
        self.assertEqual(response["confirmed_bottles"], 9)

    def test_qr_flow_syncs_once(self):
        order = self.add_order()
        with patch(
            "backend.services.store_qr_delivery.sync_order_to_monthly_virtual_card"
        ) as sync:
            response = submit_store_qr_delivery(
                self.db,
                qr_public_id=self.store.qr_public_id,
                qr_token_version=1,
                idempotency_key="idem-6b",
                token_jti="jti-6b",
                bottles_delivered=7,
                photo_url=None,
                remarks="qr",
                delivered_by="QR",
                source_ip="127.0.0.1",
                user_agent="test",
                latitude=None,
                longitude=None,
                gps_accuracy=None,
            )
        sync.assert_called_once_with(self.db, order)
        self.assertEqual(response["order_id"], order.id)
        self.assertEqual(response["status"], "delivered_confirmed")
        self.assertEqual(response["bottles_delivered"], 7)

    def test_qr_empty_bottles_update_order_balance_and_replay_once(self):
        order = self.add_order()
        initial_balance = self.store.pending_empty_bottles
        with patch(
            "backend.services.store_qr_delivery.sync_order_to_monthly_virtual_card"
        ) as sync:
            first = submit_store_qr_delivery(
                self.db,
                qr_public_id=self.store.qr_public_id,
                qr_token_version=1,
                idempotency_key="idem-empty-q1",
                token_jti="jti-empty-q1",
                bottles_delivered=7,
                empty_bottles_collected=3,
                photo_url=None,
                remarks="qr empty",
                delivered_by="QR",
                source_ip="127.0.0.11",
                user_agent="test",
                latitude=None,
                longitude=None,
                gps_accuracy=None,
            )
            replay = submit_store_qr_delivery(
                self.db,
                qr_public_id=self.store.qr_public_id,
                qr_token_version=1,
                idempotency_key="idem-empty-q1",
                token_jti="jti-empty-q1",
                bottles_delivered=7,
                empty_bottles_collected=3,
                photo_url=None,
                remarks="qr empty",
                delivered_by="QR",
                source_ip="127.0.0.11",
                user_agent="test",
                latitude=None,
                longitude=None,
                gps_accuracy=None,
            )

        self.db.refresh(order)
        self.db.refresh(self.store)
        self.assertEqual(first["order_id"], order.id)
        self.assertEqual(replay["order_id"], order.id)
        self.assertEqual(first["empty_bottles_collected"], 3)
        self.assertEqual(order.bottles_delivered, 7)
        self.assertEqual(order.confirmed_bottles, 7)
        self.assertEqual(order.empty_bottles_collected, 3)
        self.assertEqual(order.confirmed_empty_bottles, 3)
        self.assertEqual(self.store.pending_empty_bottles, initial_balance + 7 - 3)
        sync.assert_called_once_with(self.db, order)

    def test_qr_rejects_negative_resulting_balance_without_clamping(self):
        order = self.add_order()
        initial_balance = self.store.pending_empty_bottles
        with self.assertRaises(HTTPException) as raised:
            submit_store_qr_delivery(
                self.db,
                qr_public_id=self.store.qr_public_id,
                qr_token_version=1,
                idempotency_key="idem-negative-q1",
                token_jti="jti-negative-q1",
                bottles_delivered=1,
                empty_bottles_collected=initial_balance + 2,
                photo_url=None,
                remarks=None,
                delivered_by="QR",
                source_ip="127.0.0.12",
                user_agent="test",
                latitude=None,
                longitude=None,
                gps_accuracy=None,
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.db.refresh(order)
        self.db.refresh(self.store)
        self.assertEqual(order.bottles_delivered, 0)
        self.assertEqual(order.empty_bottles_collected, 0)
        self.assertEqual(self.store.pending_empty_bottles, initial_balance)
        self.assertEqual(self.db.query(StoreQrDeliverySubmission).count(), 0)

    def test_qr_creates_one_order_card_entry_and_link_with_empty_quantity(self):
        response = submit_store_qr_delivery(
            self.db,
            qr_public_id=self.store.qr_public_id,
            qr_token_version=1,
            idempotency_key="idem-create-q1",
            token_jti="jti-create-q1",
            bottles_delivered=6,
            empty_bottles_collected=2,
            photo_url="https://example.test/proof.jpg",
            remarks="created by qr",
            delivered_by="QR",
            source_ip="127.0.0.13",
            user_agent="test",
            latitude=None,
            longitude=None,
            gps_accuracy=None,
        )

        self.assertTrue(response["created_order"])
        self.assertEqual(self.db.query(Order).count(), 1)
        order = self.db.get(Order, response["order_id"])
        self.assertEqual(order.ordered_by_type, "QR_DELIVERY")
        self.assertEqual(order.bottles_delivered, 6)
        self.assertEqual(order.confirmed_bottles, 6)
        self.assertEqual(order.empty_bottles_collected, 2)
        self.assertEqual(order.confirmed_empty_bottles, 2)
        self.assertEqual(order.delivery_photo_url, "https://example.test/proof.jpg")
        self.assertEqual(self.db.query(MonthlyVirtualCard).count(), 1)
        self.assertEqual(self.db.query(MonthlyVirtualCardEntry).count(), 1)
        self.assertEqual(self.db.query(MonthlyVirtualCardEntryOrder).count(), 1)

    def test_domain_failure_rolls_back_delivery_and_card_transaction(self):
        order = self.add_order()
        order_id = order.id
        with patch(
            "backend.services.store_qr_delivery.sync_order_to_monthly_virtual_card",
            side_effect=MonthlyVirtualCardDomainError("card failure"),
        ) as sync:
            with self.assertRaisesRegex(MonthlyVirtualCardDomainError, "card failure"):
                submit_store_qr_delivery(
                    self.db,
                    qr_public_id=self.store.qr_public_id,
                    qr_token_version=1,
                    idempotency_key="idem-fail-6b",
                    token_jti="jti-fail-6b",
                    bottles_delivered=8,
                    photo_url=None,
                    remarks=None,
                    delivered_by=None,
                    source_ip="127.0.0.2",
                    user_agent="test",
                    latitude=None,
                    longitude=None,
                    gps_accuracy=None,
                )
        sync.assert_called_once()
        check = self.Session()
        try:
            persisted = check.get(Order, order_id)
            self.assertEqual(persisted.status, OrderStatusEnum.assigned_to_manager)
            self.assertEqual(persisted.bottles_delivered, 0)
            self.assertEqual(check.query(StoreQrDeliverySubmission).count(), 0)
            self.assertEqual(check.query(MonthlyVirtualCard).count(), 0)
        finally:
            check.close()

    def test_unexpected_sync_failure_rolls_back_qr_transaction(self):
        order = self.add_order()
        order_id = order.id
        with patch(
            "backend.services.store_qr_delivery.sync_order_to_monthly_virtual_card",
            side_effect=RuntimeError("unexpected sync failure"),
        ):
            with self.assertRaisesRegex(RuntimeError, "unexpected sync failure"):
                submit_store_qr_delivery(
                    self.db,
                    qr_public_id=self.store.qr_public_id,
                    qr_token_version=1,
                    idempotency_key="idem-unexpected-6c",
                    token_jti="jti-unexpected-6c",
                    bottles_delivered=8,
                    photo_url=None,
                    remarks=None,
                    delivered_by=None,
                    source_ip="127.0.0.4",
                    user_agent="test",
                    latitude=None,
                    longitude=None,
                    gps_accuracy=None,
                )
        check = self.Session()
        try:
            persisted = check.get(Order, order_id)
            self.assertEqual(persisted.status, OrderStatusEnum.assigned_to_manager)
            self.assertEqual(persisted.bottles_delivered, 0)
            self.assertEqual(check.query(StoreQrDeliverySubmission).count(), 0)
            self.assertEqual(check.query(MonthlyVirtualCard).count(), 0)
        finally:
            check.close()

    def test_qr_route_delegates_without_duplicate_sync(self):
        route_source = inspect.getsource(submit_qr_delivery)
        service_source = inspect.getsource(submit_store_qr_delivery)
        self.assertNotIn("sync_order_to_monthly_virtual_card", route_source)
        self.assertEqual(service_source.count("sync_order_to_monthly_virtual_card("), 1)

    def _run_qr_route(self, service_side_effect=None):
        request = SimpleNamespace(
            client=SimpleNamespace(host="127.0.0.3"),
            headers={"user-agent": "test"},
        )
        photo = SimpleNamespace(filename="proof.jpg")
        result = {
            "success": True,
            "order_id": 1,
            "created_order": False,
            "status": "delivered_confirmed",
            "bottles_delivered": 5,
            "submitted_at": datetime.now(timezone.utc),
        }
        with (
            patch("backend.routes.store_qr_delivery.submit_rate_limiter.allow", return_value=True),
            patch(
                "backend.routes.store_qr_delivery._decode_short_token",
                return_value={"idem": "00000000-0000-0000-0000-000000000001", "jti": "jti", "qid": self.store.qr_public_id, "ver": 1},
            ),
            patch("backend.routes.store_qr_delivery.get_scan_context"),
            patch(
                "backend.routes.store_qr_delivery._upload_photo",
                new=AsyncMock(return_value=("https://photo", "public-id")),
            ),
            patch(
                "backend.routes.store_qr_delivery._delete_uploaded_photo",
                new=AsyncMock(),
            ) as delete_photo,
            patch(
                "backend.routes.store_qr_delivery.submit_store_qr_delivery",
                return_value=result,
                side_effect=service_side_effect,
            ),
        ):
            async def invoke():
                return await submit_qr_delivery(
                    request,
                    "token",
                    "00000000-0000-0000-0000-000000000001",
                    5,
                    0,
                    None,
                    None,
                    None,
                    None,
                    None,
                    photo,
                    self.db,
                )

            try:
                response = asyncio.run(invoke())
                return response, delete_photo.await_count
            except Exception:
                self.assertEqual(delete_photo.await_count, 1)
                raise

    def test_qr_photo_deleted_on_card_domain_failure(self):
        with self.assertRaises(MonthlyVirtualCardDomainError):
            self._run_qr_route(MonthlyVirtualCardDomainError("card"))

    def test_qr_photo_deleted_on_unexpected_failure(self):
        with self.assertRaises(RuntimeError):
            self._run_qr_route(RuntimeError("database"))

    def test_qr_photo_retained_on_success(self):
        response, delete_count = self._run_qr_route()
        self.assertEqual(response["status"], "delivered_confirmed")
        self.assertEqual(delete_count, 0)

    def test_new_local_photo_deleted_but_previous_photo_preserved_on_failure(self):
        order = self.add_order()
        previous_path = os.path.join("uploads", "phase6c-existing.jpg")
        with open(previous_path, "wb") as existing:
            existing.write(b"old")
        order.delivery_photo_url = f"/{previous_path}"
        self.db.commit()
        photo = SimpleNamespace(
            filename="phase6c-new.jpg",
            file=BytesIO(b"new"),
        )
        new_path = os.path.join("uploads", f"order_{order.id}_phase6c-new.jpg")
        try:
            with patch(
                "backend.routes.partners.sync_order_to_monthly_virtual_card",
                side_effect=MonthlyVirtualCardDomainError("card"),
            ):
                with self.assertRaises(MonthlyVirtualCardDomainError):
                    update_order_status_with_photo(
                        order.id, self.db, self.manager,
                        OrderStatusEnum.delivered_confirmed,
                        10, 2, None, None, None, photo,
                    )
            self.assertFalse(os.path.exists(new_path))
            self.assertTrue(os.path.exists(previous_path))
        finally:
            if os.path.exists(previous_path):
                os.remove(previous_path)


if __name__ == "__main__":
    unittest.main()
