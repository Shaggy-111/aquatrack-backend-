import unittest
from datetime import date, datetime, timezone

from sqlalchemy import create_engine, event
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
from backend.routes.monthly_virtual_cards import get_monthly_virtual_card_detail
from backend.routes.store_qr_delivery import _admin_qr_response
from backend.utils.store_qr_tokens import decode_store_qr_token


class MonthlyVirtualCardDetailTests(unittest.TestCase):
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
            email="detail-admin@test.local",
            password="test",
            full_name="Detail Admin",
            role=RoleEnum.superadmin,
            status="active",
        )
        self.partner = User(
            email="detail-partner@test.local",
            password="test",
            full_name="Detail Partner",
            role=RoleEnum.partner,
            status="active",
        )
        self.store = Store(
            id="detail-store",
            store_name="Detail Store",
            is_active=True,
            channel="GENERAL",
            qr_public_id="detail-public-id",
            pending_empty_bottles=0,
        )
        self.db.add_all([self.admin, self.partner, self.store])
        self.db.flush()
        self.card = MonthlyVirtualCard(
            store_id=self.store.id,
            year=2026,
            month=8,
            status="open",
        )
        self.db.add(self.card)
        self.db.flush()
        self.entry = MonthlyVirtualCardEntry(
            card_id=self.card.id,
            entry_date=date(2026, 8, 5),
            entry_source="super_admin",
            remarks="Production UAT",
            created_by_id=self.admin.id,
            updated_by_id=self.admin.id,
        )
        self.empty_entry = MonthlyVirtualCardEntry(
            card_id=self.card.id,
            entry_date=date(2026, 8, 6),
            entry_source="delivery_manager",
        )
        self.db.add_all([self.entry, self.empty_entry])
        self.db.flush()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_order(
        self,
        *,
        status,
        delivered,
        confirmed,
        empty,
        confirmed_empty,
    ):
        value = Order(
            partner_id=self.partner.id,
            store_id=self.store.id,
            status=status,
            order_details=str(delivered),
            total_amount=0,
            channel=self.store.channel,
            order_date=datetime(2026, 8, 5, 6, 30, tzinfo=timezone.utc),
            bottles_delivered=delivered,
            confirmed_bottles=confirmed,
            empty_bottles_collected=empty,
            confirmed_empty_bottles=confirmed_empty,
        )
        self.db.add(value)
        self.db.flush()
        if confirmed_empty is None:
            value.confirmed_empty_bottles = None
            self.db.flush()
        return value

    def test_detail_effective_quantities_aggregation_sorting_and_bulk_load(self):
        confirmed = self.add_order(
            status=OrderStatusEnum.delivered_confirmed,
            delivered=10,
            confirmed=7,
            empty=5,
            confirmed_empty=3,
        )
        fallback = self.add_order(
            status=OrderStatusEnum.delivered_confirmed,
            delivered=4,
            confirmed=None,
            empty=2,
            confirmed_empty=None,
        )
        confirmed_zero = self.add_order(
            status=OrderStatusEnum.delivered_confirmed,
            delivered=20,
            confirmed=0,
            empty=8,
            confirmed_empty=0,
        )
        pending = self.add_order(
            status=OrderStatusEnum.delivered_pending_confirmation,
            delivered=6,
            confirmed=99,
            empty=1,
            confirmed_empty=99,
        )
        orders = [confirmed, fallback, confirmed_zero, pending]
        snapshots = {
            value.id: (
                value.status,
                value.bottles_delivered,
                value.confirmed_bottles,
                value.empty_bottles_collected,
                value.confirmed_empty_bottles,
            )
            for value in orders
        }
        for value in reversed(orders):
            self.db.add(
                MonthlyVirtualCardEntryOrder(
                    entry_id=self.entry.id,
                    order_id=value.id,
                )
            )
        self.db.commit()
        self.db.expire_all()

        order_selects = []

        def count_order_selects(_conn, _cursor, statement, _params, _context, _many):
            normalized = " ".join(statement.lower().split())
            if normalized.startswith("select") and " from orders " in normalized:
                order_selects.append(normalized)

        event.listen(self.engine, "before_cursor_execute", count_order_selects)
        try:
            detail = get_monthly_virtual_card_detail(
                store_id=self.store.id,
                year=2026,
                month=8,
                db=self.db,
                current_user=self.admin,
            )
        finally:
            event.remove(self.engine, "before_cursor_execute", count_order_selects)

        self.assertEqual([item.entry_date for item in detail.entries], [date(2026, 8, 5), date(2026, 8, 6)])
        store_qr = _admin_qr_response(None, self.store)
        self.assertEqual(detail.qr_public_url, store_qr.qr_url)
        self.assertNotIn(self.store.qr_public_id, detail.qr_public_url)
        qr_token = detail.qr_public_url.rsplit("/", 1)[-1]
        self.assertEqual(decode_store_qr_token(qr_token)["qid"], self.store.qr_public_id)
        populated = detail.entries[0]
        self.assertEqual(populated.bottles_delivered, 17)
        self.assertEqual(populated.empty_bottles_collected, 6)
        self.assertEqual(populated.linked_order_ids, sorted(value.id for value in orders))
        self.assertEqual(populated.entry_source, "super_admin")
        self.assertEqual(populated.remarks, "Production UAT")
        self.assertEqual(populated.created_by_id, self.admin.id)
        self.assertEqual(populated.updated_by_id, self.admin.id)
        self.assertIsNotNone(populated.created_at)
        self.assertIsNotNone(populated.updated_at)
        self.assertEqual(
            set(populated.model_dump()),
            {
                "id",
                "entry_date",
                "entry_source",
                "remarks",
                "created_by_id",
                "updated_by_id",
                "created_at",
                "updated_at",
                "bottles_delivered",
                "empty_bottles_collected",
                "linked_order_ids",
            },
        )

        no_links = detail.entries[1]
        self.assertEqual(no_links.bottles_delivered, 0)
        self.assertEqual(no_links.empty_bottles_collected, 0)
        self.assertEqual(no_links.linked_order_ids, [])
        self.assertEqual(len(order_selects), 1)

        for order_id, snapshot in snapshots.items():
            value = self.db.get(Order, order_id)
            self.assertEqual(
                (
                    value.status,
                    value.bottles_delivered,
                    value.confirmed_bottles,
                    value.empty_bottles_collected,
                    value.confirmed_empty_bottles,
                ),
                snapshot,
            )


if __name__ == "__main__":
    unittest.main()
