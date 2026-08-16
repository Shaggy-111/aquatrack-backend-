import unittest
from datetime import datetime, timezone

import pytz
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
from backend.models.store import Store
from backend.models.user import RoleEnum, User
from backend.services.monthly_virtual_card import sync_order_to_monthly_virtual_card


IST = pytz.timezone("Asia/Kolkata")


class MonthlyVirtualCardDeliverySyncTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False)
        self.db = self.Session()
        self.actor = User(
            email="manager@example.com",
            password="test",
            full_name="Manager",
            role=RoleEnum.delivery_manager,
            status="active",
        )
        self.partner = User(
            email="partner@example.com",
            password="test",
            full_name="Partner",
            role=RoleEnum.partner,
            status="active",
        )
        self.store = Store(
            id="store-1",
            store_name="Store One",
            is_active=True,
            pending_empty_bottles=17,
        )
        self.db.add_all([self.actor, self.partner, self.store])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_order(self, **overrides):
        values = {
            "partner_id": self.partner.id,
            "store_id": self.store.id,
            "status": OrderStatusEnum.delivered_confirmed,
            "order_details": "12",
            "total_amount": 0,
            "order_date": IST.localize(datetime(2026, 8, 5, 10)),
            "bottles_delivered": 10,
            "empty_bottles_collected": 3,
            "confirmed_bottles": 12,
            "confirmed_empty_bottles": 4,
            "confirmation_remarks": "store confirmed",
            "delivery_note": "driver note",
            "vehicle_info": "V-1",
        }
        values.update(overrides)
        order = Order(**values)
        self.db.add(order)
        self.db.commit()
        return order

    def test_new_card_entry_and_link_are_created(self):
        result = sync_order_to_monthly_virtual_card(
            self.db, self.add_order(), self.actor
        )
        self.assertTrue(result["card_created"])
        self.assertTrue(result["entry_created"])
        self.assertTrue(result["link_created"])
        self.assertEqual(result["entry"].entry_source, "delivery_manager")
        self.assertEqual(result["entry"].created_by_id, self.actor.id)

    def test_existing_card_is_reused(self):
        card = MonthlyVirtualCard(store_id=self.store.id, year=2026, month=8)
        self.db.add(card)
        self.db.commit()
        result = sync_order_to_monthly_virtual_card(self.db, self.add_order())
        self.assertFalse(result["card_created"])
        self.assertEqual(result["card"].id, card.id)

    def test_existing_entry_and_link_are_reused(self):
        order = self.add_order()
        card = MonthlyVirtualCard(store_id=self.store.id, year=2026, month=8)
        self.db.add(card)
        self.db.flush()
        entry = MonthlyVirtualCardEntry(card_id=card.id, entry_date=datetime(2026, 8, 5).date())
        self.db.add(entry)
        self.db.flush()
        link = MonthlyVirtualCardEntryOrder(entry_id=entry.id, order_id=order.id)
        self.db.add(link)
        self.db.commit()
        result = sync_order_to_monthly_virtual_card(self.db, order)
        self.assertFalse(result["entry_created"])
        self.assertFalse(result["link_created"])
        self.assertEqual(result["entry"].id, entry.id)
        reused = self.db.query(MonthlyVirtualCardEntryOrder).one()
        self.assertEqual(reused.id, link.id)

    def test_super_admin_entry_is_preserved(self):
        order = self.add_order()
        card = MonthlyVirtualCard(store_id=self.store.id, year=2026, month=8)
        self.db.add(card)
        self.db.flush()
        entry = MonthlyVirtualCardEntry(
            card_id=card.id,
            entry_date=datetime(2026, 8, 5).date(),
            entry_source="super_admin",
            remarks="manual value",
            created_by_id=self.actor.id,
            updated_by_id=self.actor.id,
        )
        self.db.add(entry)
        self.db.commit()
        result = sync_order_to_monthly_virtual_card(self.db, order, None)
        self.assertEqual(result["entry"].entry_source, "super_admin")
        self.assertEqual(result["entry"].remarks, "manual value")
        self.assertEqual(result["entry"].updated_by_id, self.actor.id)
        self.assertTrue(result["link_created"])

    def test_delivery_manager_and_null_entries_are_updated_from_order(self):
        for source in ("delivery_manager", None):
            order = self.add_order(order_date=IST.localize(datetime(2026, 8, 5 + (source is None), 10)))
            card = self.db.query(MonthlyVirtualCard).first()
            if card is None:
                card = MonthlyVirtualCard(store_id=self.store.id, year=2026, month=8)
                self.db.add(card)
                self.db.flush()
            entry = MonthlyVirtualCardEntry(
                card_id=card.id,
                entry_date=order.order_date.date(),
                entry_source=source,
                remarks="old",
            )
            self.db.add(entry)
            self.db.commit()
            result = sync_order_to_monthly_virtual_card(self.db, order, self.actor)
            self.assertEqual(result["entry"].entry_source, "delivery_manager")
            self.assertEqual(result["entry"].remarks, order.confirmation_remarks)
            link = self.db.query(MonthlyVirtualCardEntryOrder).filter_by(
                entry_id=result["entry"].id,
                order_id=order.id,
            ).one()
            self.assertEqual(link.order.confirmed_bottles, 12)
            self.assertEqual(link.order.confirmed_empty_bottles, 4)

    def test_non_card_statuses_are_ignored(self):
        for status in (
            OrderStatusEnum.cancelled,
            OrderStatusEnum.rejected,
            OrderStatusEnum.delivery_disputed,
        ):
            self.assertIsNone(
                sync_order_to_monthly_virtual_card(
                    self.db, self.add_order(status=status), self.actor
                )
            )
        self.assertEqual(self.db.query(MonthlyVirtualCard).count(), 0)

    def test_repeated_sync_is_idempotent(self):
        order = self.add_order()
        results = [sync_order_to_monthly_virtual_card(self.db, order) for _ in range(4)]
        self.assertTrue(results[0]["link_created"])
        self.assertTrue(all(not item["link_created"] for item in results[1:]))
        self.assertEqual(self.db.query(MonthlyVirtualCard).count(), 1)
        self.assertEqual(self.db.query(MonthlyVirtualCardEntry).count(), 1)
        self.assertEqual(self.db.query(MonthlyVirtualCardEntryOrder).count(), 1)

    def test_ist_business_date_selects_correct_month(self):
        order = self.add_order()
        # SQLite drops timezone offsets from DateTime values; restore the aware
        # production value so this specifically exercises UTC -> IST rollover.
        order.order_date = datetime(2026, 8, 31, 18, 45, tzinfo=timezone.utc)
        result = sync_order_to_monthly_virtual_card(self.db, order)
        self.assertEqual((result["card"].year, result["card"].month), (2026, 9))
        self.assertEqual(result["entry"].entry_date, datetime(2026, 9, 1).date())

    def test_order_and_balance_are_not_mutated(self):
        order = self.add_order()
        attributes = (
            "status", "order_date", "updated_at", "partner_id",
            "assigned_to_manager_id", "delivery_photo_url", "vehicle_info",
            "bottles_delivered", "empty_bottles_collected", "confirmed_bottles",
            "confirmed_empty_bottles", "confirmation_remarks", "delivery_note",
        )
        before = {name: getattr(order, name) for name in attributes}
        balance = self.store.pending_empty_bottles
        sync_order_to_monthly_virtual_card(self.db, order, self.actor)
        self.assertEqual(before, {name: getattr(order, name) for name in attributes})
        self.assertEqual(self.store.pending_empty_bottles, balance)


if __name__ == "__main__":
    unittest.main()
