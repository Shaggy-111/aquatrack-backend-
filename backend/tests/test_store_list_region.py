import unittest

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models
from backend.database.db import Base
from backend.models.store import Store
from backend.models.user import RoleEnum, User
from backend.routes.store import get_all_stores


class StoreListRegionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.admin = User(
            email="store-list-region-admin@test.local",
            password="test",
            full_name="Admin",
            role=RoleEnum.superadmin,
            status="active",
        )
        self.db.add(self.admin)
        self.db.flush()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_store(self, store_id, region):
        store = Store(
            id=store_id,
            store_name=f"Store {store_id}",
            address="Address",
            city="Chennai",
            state="Tamil Nadu",
            region=region,
            channel="BLINKIT",
            entity="BCPL",
            is_active=True,
            auto_order_enabled=False,
            order_frequency_days=1,
            monthly_cap=100,
        )
        self.db.add(store)
        self.db.flush()
        return store

    def test_endpoint_returns_populated_and_null_region_without_mutation(self):
        populated = self.add_store("3311", "SOUTH")
        missing = self.add_store("3312", None)
        original = {
            populated.id: (populated.store_name, populated.region),
            missing.id: (missing.store_name, missing.region),
        }
        self.db.commit()

        mutation_statements = []

        def capture_mutations(_conn, _cursor, statement, _parameters, _context, _many):
            if statement.lstrip().upper().startswith(("UPDATE", "INSERT", "DELETE")):
                mutation_statements.append(statement)

        event.listen(self.engine, "before_cursor_execute", capture_mutations)
        try:
            rows = get_all_stores(db=self.db, current_user=self.admin)
        finally:
            event.remove(self.engine, "before_cursor_execute", capture_mutations)

        by_id = {row["id"]: row for row in rows}
        self.assertEqual(by_id["3311"]["region"], "SOUTH")
        self.assertIsNone(by_id["3312"]["region"])
        self.assertEqual(by_id["3311"]["store_name"], "Store 3311")
        self.assertEqual(by_id["3311"]["city"], "Chennai")
        self.assertEqual(by_id["3311"]["state"], "Tamil Nadu")
        self.assertEqual(by_id["3311"]["channel"], "BLINKIT")
        self.assertEqual(by_id["3311"]["entity"], "BCPL")
        self.assertIn("assigned_manager", by_id["3311"])
        self.assertIn("assigned_manager_id", by_id["3311"])
        self.assertEqual(mutation_statements, [])

        self.db.expire_all()
        for store_id, expected in original.items():
            store = self.db.query(Store).filter(Store.id == store_id).one()
            self.assertEqual((store.store_name, store.region), expected)


if __name__ == "__main__":
    unittest.main()
