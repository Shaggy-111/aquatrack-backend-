import unittest

from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models
from backend.database.db import Base
from backend.models.monthly_virtual_card import MonthlyVirtualCard
from backend.models.store import Store
from backend.services.monthly_virtual_card import (
    ensure_monthly_card,
    ensure_monthly_cards_for_active_stores,
)


class MonthlyVirtualCardServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_store(self, store_id: str, *, active: bool = True) -> Store:
        store = Store(
            id=store_id,
            store_name=f"Store {store_id}",
            is_active=active,
        )
        self.db.add(store)
        self.db.flush()
        return store

    def test_creates_card_for_valid_active_store(self):
        self.add_store("active-1")

        card, created = ensure_monthly_card(self.db, "active-1", 2026, 8)

        self.assertTrue(created)
        self.assertIsNotNone(card.id)
        self.assertEqual(card.store_id, "active-1")
        self.assertEqual(card.status, "open")
        self.assertIsNotNone(card.created_at.tzinfo)

    def test_repeated_ensure_returns_same_card(self):
        self.add_store("active-1")

        first, first_created = ensure_monthly_card(self.db, "active-1", 2026, 8)
        second, second_created = ensure_monthly_card(self.db, "active-1", 2026, 8)

        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(first.id, second.id)
        self.assertEqual(self.db.query(MonthlyVirtualCard).count(), 1)

    def test_bulk_generation_creates_one_card_per_active_store(self):
        self.add_store("active-1")
        self.add_store("active-2")

        summary = ensure_monthly_cards_for_active_stores(self.db, 2026, 8)

        self.assertEqual(summary["total_active_stores"], 2)
        self.assertEqual(summary["created_count"], 2)
        self.assertEqual(summary["existing_count"], 0)
        self.assertEqual(len(summary["created_card_ids"]), 2)
        self.assertEqual(self.db.query(MonthlyVirtualCard).count(), 2)

    def test_bulk_generation_skips_inactive_stores(self):
        self.add_store("active-1")
        self.add_store("inactive-1", active=False)

        summary = ensure_monthly_cards_for_active_stores(self.db, 2026, 8)

        self.assertEqual(summary["total_active_stores"], 1)
        self.assertEqual(summary["created_count"], 1)
        self.assertIsNone(
            self.db.query(MonthlyVirtualCard)
            .filter(MonthlyVirtualCard.store_id == "inactive-1")
            .first()
        )

    def test_repeated_bulk_generation_creates_no_duplicates(self):
        self.add_store("active-1")
        self.add_store("active-2")

        first = ensure_monthly_cards_for_active_stores(self.db, 2026, 8)
        second = ensure_monthly_cards_for_active_stores(self.db, 2026, 8)

        self.assertEqual(first["created_count"], 2)
        self.assertEqual(second["created_count"], 0)
        self.assertEqual(second["existing_count"], 2)
        self.assertEqual(second["created_card_ids"], [])
        self.assertEqual(self.db.query(MonthlyVirtualCard).count(), 2)

    def test_invalid_month_is_rejected(self):
        self.add_store("active-1")

        for month in (0, 13):
            with self.subTest(month=month):
                with self.assertRaisesRegex(ValueError, "between 1 and 12"):
                    ensure_monthly_card(self.db, "active-1", 2026, month)

        with self.assertRaisesRegex(ValueError, "between 1 and 12"):
            ensure_monthly_cards_for_active_stores(self.db, 2026, 0)

    def test_missing_store_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "does not exist"):
            ensure_monthly_card(self.db, "missing", 2026, 8)

    def test_unique_constraint_preserves_idempotency(self):
        self.add_store("active-1")
        original, _ = ensure_monthly_card(self.db, "active-1", 2026, 8)

        with self.assertRaises(IntegrityError):
            with self.db.begin_nested():
                self.db.add(
                    MonthlyVirtualCard(store_id="active-1", year=2026, month=8)
                )
                self.db.flush()

        card, created = ensure_monthly_card(self.db, "active-1", 2026, 8)
        self.assertFalse(created)
        self.assertEqual(card.id, original.id)
        self.assertEqual(self.db.query(MonthlyVirtualCard).count(), 1)


if __name__ == "__main__":
    unittest.main()
