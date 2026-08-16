import inspect
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models
from backend.database.db import Base
from backend.models.store import Store
from backend.models.store_compliance import StoreComplianceDocument
from backend.models.user import RoleEnum, User
from backend.routes.store_compliance import get_compliance_repository


class StoreComplianceRegionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.admin = User(
            email="compliance-region-admin@test.local",
            password="test",
            full_name="Admin",
            role=RoleEnum.superadmin,
            status="active",
        )
        self.manager_north = User(
            email="compliance-region-manager@test.local",
            password="test",
            full_name="North Manager",
            role=RoleEnum.delivery_manager,
            status="active",
        )
        self.db.add_all([self.admin, self.manager_north])
        self.db.flush()
        self.north_complete = self.add_store(
            "N-1", " North ", "Faridabad", "BLINKIT", self.manager_north.id
        )
        self.north_pending = self.add_store(
            "N-2", "NORTH", "Delhi", "ZEPTO", None
        )
        self.south = self.add_store(
            "S-1", "South", "Faridabad", "BLINKIT", None
        )
        for week in range(1, 5):
            self.add_document(self.north_complete, "water_card", week)
        self.add_document(self.north_complete, "invoice", None)
        self.add_document(self.south, "water_card", 1)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_store(self, store_id, region, city, channel, manager_id):
        store = Store(
            id=store_id,
            store_name=f"Store {store_id}",
            region=region,
            city=city,
            state="Test State",
            channel=channel,
            assigned_manager_id=manager_id,
            is_active=True,
        )
        self.db.add(store)
        self.db.flush()
        return store

    def add_document(self, store, document_type, week):
        self.db.add(
            StoreComplianceDocument(
                store_id=store.id,
                uploaded_by=self.admin.id,
                document_type=document_type,
                year=2026,
                month=8,
                week_number=week,
                page_number=1,
                file_url=f"https://example.test/{store.id}/{document_type}/{week}",
            )
        )

    def repository(self, **overrides):
        params = {
            "month": 8,
            "year": 2026,
            "region": None,
            "city": None,
            "channel": None,
            "missing_type": None,
            "compliance_range": None,
            "status": None,
            "manager_id": None,
            "sort_by": "compliance_percentage",
            "sort_order": "asc",
            "db": self.db,
            "current_user": self.admin,
        }
        params.update(overrides)
        return get_compliance_repository(**params)

    def test_omitted_region_preserves_all_stores_and_unknown_is_empty(self):
        self.assertEqual({row["store_id"] for row in self.repository()}, {"N-1", "N-2", "S-1"})
        self.assertEqual(self.repository(region="Unknown"), [])
        self.assertEqual({row["store_id"] for row in self.repository(region="   ")}, {"N-1", "N-2", "S-1"})

    def test_region_is_trimmed_case_insensitive_exact(self):
        rows = self.repository(region=" north ")
        self.assertEqual({row["store_id"] for row in rows}, {"N-1", "N-2"})
        self.assertTrue(all(row["store_id"].startswith("N-") for row in rows))

    def test_region_composes_with_city_channel_manager_and_status(self):
        self.assertEqual(
            [row["store_id"] for row in self.repository(region="North", city="Faridabad")],
            ["N-1"],
        )
        self.assertEqual(
            [row["store_id"] for row in self.repository(region="North", channel="BLINKIT")],
            ["N-1"],
        )
        self.assertEqual(
            [row["store_id"] for row in self.repository(region="North", manager_id=self.manager_north.id)],
            ["N-1"],
        )
        self.assertEqual(
            [row["store_id"] for row in self.repository(region="North", status="complete")],
            ["N-1"],
        )
        self.assertEqual(
            [row["store_id"] for row in self.repository(region="North", status="pending")],
            ["N-2"],
        )

    def test_region_population_keeps_kpis_and_percentage_consistent(self):
        rows = self.repository(region="North")
        total_stores = len(rows)
        week1_logged = sum(row["week1_uploaded"] for row in rows)
        week1_missing = sum(not row["week1_uploaded"] for row in rows)
        invoice_logged = sum(row["invoice_uploaded"] for row in rows)
        invoice_missing = sum(not row["invoice_uploaded"] for row in rows)
        self.assertEqual((total_stores, week1_logged, week1_missing), (2, 1, 1))
        self.assertEqual((invoice_logged, invoice_missing), (1, 1))
        percentages = {row["store_id"]: row["compliance_percentage"] for row in rows}
        self.assertEqual(percentages, {"N-2": 0.0, "N-1": 100.0})

    def test_region_filter_is_sql_and_upload_pdf_functions_are_unchanged(self):
        source = inspect.getsource(get_compliance_repository)
        self.assertIn("Store.region", source)
        self.assertIn("func.lower(func.trim(Store.region))", source)
        self.assertNotIn("admin_upload_store_document", source)
        self.assertNotIn("generate_week4_pdf", source)


if __name__ == "__main__":
    unittest.main()
