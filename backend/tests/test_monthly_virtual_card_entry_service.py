import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

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
from backend.models.user import RoleEnum, User
from backend.services.monthly_virtual_card import (
    IST,
    upsert_monthly_virtual_card_entry,
)


class MonthlyVirtualCardEntryServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False)
        self.db = self.Session()
        self.admin = User(
            email="admin@example.com",
            password="test",
            full_name="Super Admin",
            role=RoleEnum.superadmin,
            status="active",
        )
        self.partner = User(
            email="partner@example.com",
            password="test",
            full_name="Store POC",
            role=RoleEnum.partner,
            status="active",
        )
        self.store = Store(
            id="store-1",
            store_name="Store One",
            is_active=True,
            channel="GENERAL",
            pending_empty_bottles=0,
        )
        self.db.add_all([self.admin, self.partner, self.store])
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

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_order(self, day=5, source="SCHEDULED", **overrides):
        values = {
            "partner_id": self.partner.id,
            "store_id": self.store.id,
            "status": OrderStatusEnum.assigned_to_manager,
            "order_details": "10",
            "total_amount": 0,
            "channel": self.store.channel,
            "order_date": IST.localize(datetime(2026, 8, day)),
            "bottles_delivered": 0,
            "empty_bottles_collected": 0,
            "ordered_by_type": source,
        }
        values.update(overrides)
        order = Order(**values)
        self.db.add(order)
        self.db.commit()
        return order

    def upsert(self, day=5, delivered=20, empty=5, remarks="checked"):
        return upsert_monthly_virtual_card_entry(
            self.db,
            self.card.id,
            date(2026, 8, day),
            delivered,
            empty,
            remarks,
            self.admin,
        )

    def test_existing_scheduled_order_is_reused(self):
        existing = self.add_order()
        result = self.upsert()
        self.assertFalse(result["order_created"])
        self.assertEqual(result["order"].id, existing.id)
        self.assertEqual(result["order"].status, OrderStatusEnum.delivered_confirmed)

    def test_missing_order_creates_virtual_card_order(self):
        result = self.upsert()
        order = result["order"]
        self.assertTrue(result["order_created"])
        self.assertEqual(order.ordered_by_type, "VIRTUAL_CARD")
        self.assertEqual(order.partner_id, self.partner.id)
        self.assertEqual(order.status, OrderStatusEnum.delivered_confirmed)
        self.assertEqual(order.bottles_delivered, 20)
        self.assertEqual(order.empty_bottles_collected, 5)

    def test_noon_ist_order_date_preserves_report_business_date(self):
        order = self.upsert()["order"]
        utc_value = order.order_date.astimezone(timezone.utc)
        self.assertEqual(utc_value.date(), date(2026, 8, 5))
        self.assertEqual(utc_value.astimezone(IST).date(), date(2026, 8, 5))
        self.assertEqual(utc_value.astimezone(IST).hour, 12)

    def test_poc_manual_order_is_not_overwritten(self):
        manual = self.add_order(source="POC")
        result = self.upsert()
        self.assertNotEqual(result["order"].id, manual.id)
        self.db.refresh(manual)
        self.assertEqual(manual.status, OrderStatusEnum.assigned_to_manager)
        self.assertEqual(manual.bottles_delivered, 0)

    def test_qr_order_is_not_overwritten(self):
        qr_order = self.add_order(source="QR_DELIVERY")
        result = self.upsert()
        self.assertNotEqual(result["order"].id, qr_order.id)
        self.db.refresh(qr_order)
        self.assertEqual(qr_order.bottles_delivered, 0)

    def test_unlinked_delivered_confirmed_order_is_not_reused(self):
        delivered = self.add_order(status=OrderStatusEnum.delivered_confirmed)
        result = self.upsert()
        self.assertTrue(result["order_created"])
        self.assertNotEqual(result["order"].id, delivered.id)

    def test_unlinked_pending_confirmation_order_is_not_reused(self):
        delivered = self.add_order(
            status=OrderStatusEnum.delivered_pending_confirmation
        )
        result = self.upsert()
        self.assertTrue(result["order_created"])
        self.assertNotEqual(result["order"].id, delivered.id)

    def test_unlinked_active_order_with_prior_quantities_is_ambiguous(self):
        existing = self.add_order(
            bottles_delivered=3,
            empty_bottles_collected=1,
        )
        with self.assertRaisesRegex(ValueError, "ambiguous balance history"):
            self.upsert()
        self.db.refresh(existing)
        self.assertEqual(existing.status, OrderStatusEnum.assigned_to_manager)
        self.assertEqual(existing.bottles_delivered, 3)
        self.assertEqual(self.db.query(MonthlyVirtualCardEntry).count(), 0)

    def test_repeated_identical_request_is_idempotent(self):
        first = self.upsert()
        second = self.upsert()
        self.assertEqual(first["order"].id, second["order"].id)
        self.assertFalse(second["order_created"])
        self.assertFalse(second["entry_created"])
        self.assertEqual(self.store.pending_empty_bottles, 15)
        self.assertEqual(self.db.query(MonthlyVirtualCardEntry).count(), 1)
        self.assertEqual(self.db.query(MonthlyVirtualCardEntryOrder).count(), 1)

    def test_edit_applies_only_balance_delta(self):
        self.upsert(delivered=20, empty=5)
        result = self.upsert(delivered=22, empty=6)
        self.assertEqual(self.store.pending_empty_bottles, 16)
        self.assertEqual(result["previous_delivered_quantity"], 20)
        self.assertEqual(result["previous_empty_quantity"], 5)

    def test_existing_entry_and_link_are_reused(self):
        linked_order = self.add_order(source="POC")
        entry = MonthlyVirtualCardEntry(
            card_id=self.card.id,
            entry_date=date(2026, 8, 5),
            created_by_id=self.admin.id,
        )
        self.db.add(entry)
        self.db.flush()
        self.db.add(MonthlyVirtualCardEntryOrder(entry_id=entry.id, order_id=linked_order.id))
        self.db.commit()
        result = self.upsert()
        self.assertEqual(result["entry"].id, entry.id)
        self.assertEqual(result["order"].id, linked_order.id)
        self.assertFalse(result["entry_created"])
        self.assertEqual(self.db.query(MonthlyVirtualCardEntryOrder).count(), 1)

    def test_linked_order_edit_remains_idempotent(self):
        first = self.upsert(delivered=20, empty=5)
        second = self.upsert(delivered=22, empty=6)
        third = self.upsert(delivered=22, empty=6)
        self.assertEqual(first["order"].id, second["order"].id)
        self.assertEqual(second["order"].id, third["order"].id)
        self.assertEqual(self.store.pending_empty_bottles, 16)
        self.assertEqual(self.db.query(MonthlyVirtualCardEntryOrder).count(), 1)

    def test_month_mismatch_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "card year and month"):
            upsert_monthly_virtual_card_entry(
                self.db, self.card.id, date(2026, 9, 1), 1, 0, None, self.admin
            )

    def test_closed_card_is_rejected(self):
        self.card.status = "closed"
        self.db.flush()
        with self.assertRaisesRegex(ValueError, "not open"):
            self.upsert()

    def test_inactive_store_is_rejected(self):
        self.store.is_active = False
        self.db.flush()
        with self.assertRaisesRegex(ValueError, "inactive"):
            self.upsert()

    def test_missing_partner_mapping_is_rejected_for_creation(self):
        self.db.query(PartnerStore).delete()
        self.db.flush()
        with self.assertRaisesRegex(ValueError, "no valid mapped partner/POC"):
            self.upsert()

    def test_invalid_mapped_user_role_is_rejected(self):
        self.partner.role = RoleEnum.employee
        self.db.flush()
        with self.assertRaisesRegex(ValueError, "no valid mapped partner/POC"):
            self.upsert()
        self.assertEqual(self.db.query(Order).count(), 0)

    def test_negative_resulting_balance_is_rejected_without_clamping(self):
        existing = self.add_order()
        with self.assertRaisesRegex(ValueError, "balance negative"):
            self.upsert(delivered=0, empty=1)
        self.db.refresh(existing)
        self.db.refresh(self.store)
        self.assertEqual(self.store.pending_empty_bottles, 0)
        self.assertEqual(existing.status, OrderStatusEnum.assigned_to_manager)
        self.assertEqual(existing.empty_bottles_collected, 0)
        self.assertEqual(self.db.query(MonthlyVirtualCardEntry).count(), 0)

    def test_caller_rollback_reverts_all_service_changes(self):
        self.upsert()
        self.db.rollback()
        self.assertEqual(self.db.query(Order).count(), 0)
        self.assertEqual(self.db.query(MonthlyVirtualCardEntry).count(), 0)
        self.assertEqual(self.db.get(Store, self.store.id).pending_empty_bottles, 0)

    def test_service_does_not_commit(self):
        with patch.object(self.db, "commit", wraps=self.db.commit) as commit:
            self.upsert()
        commit.assert_not_called()

    def test_existing_order_unrelated_fields_are_preserved(self):
        existing = self.add_order(
            source="SCHEDULED",
            delivery_photo_url="photo.jpg",
            vehicle_info="truck-7",
            delivered_by="Original Driver",
        )
        original_partner_id = existing.partner_id
        result = self.upsert()
        order = result["order"]
        self.assertEqual(order.ordered_by_type, "SCHEDULED")
        self.assertEqual(order.delivery_photo_url, "photo.jpg")
        self.assertEqual(order.vehicle_info, "truck-7")
        self.assertEqual(order.delivered_by, "Original Driver")
        self.assertEqual(order.partner_id, original_partner_id)


if __name__ == "__main__":
    unittest.main()
