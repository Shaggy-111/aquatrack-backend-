import unittest
import asyncio
import json
from urllib.parse import urlencode
from types import SimpleNamespace
from datetime import date, datetime
from decimal import Decimal

from fastapi import FastAPI
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models
from backend.database.db import Base, get_db
from backend.models.employee_permission import EmployeePermission
from backend.models.employee_store_mapping import EmployeeStoreMapping
from backend.models.permission import Permission
from backend.models.store import Store
from backend.models.store_reimbursement import (
    StoreReimbursement, StoreReimbursementStatus, StoreReimbursementPayment,
    StoreReimbursementAttachment,
)
from backend.models.user import User, RoleEnum
from backend.routes.store import status_router
from backend.routes.store_reimbursement import router as reimbursement_router
from backend.utils.jwt import get_current_user


class ASGIClient:
    """Exercise FastAPI validation/routing without an optional HTTP client dependency."""
    def __init__(self, app):
        self.app = app

    def close(self):
        pass

    def get(self, path, params=None):
        messages = []
        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}
        async def send(message):
            messages.append(message)
        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": "GET", "scheme": "http", "path": path, "raw_path": path.encode(),
            "query_string": urlencode(params or {}).encode(), "root_path": "",
            "headers": [], "client": ("test", 1), "server": ("test", 80),
        }
        asyncio.run(self.app(scope, receive, send))
        body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
        status = next(m["status"] for m in messages if m["type"] == "http.response.start")
        return SimpleNamespace(status_code=status, text=body.decode(), json=lambda: json.loads(body))


class StoreSelectorPerformanceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.admin = User(id=1, email="admin@test", password="test", full_name="Admin", role=RoleEnum.superadmin)
        self.employee = User(id=2, email="employee@test", password="test", full_name="Employee", role=RoleEnum.employee)
        self.empty = User(id=3, email="empty@test", password="test", full_name="Empty", role=RoleEnum.employee)
        self.db.add_all([self.admin, self.employee, self.empty])
        self.db.add_all([
            Store(id="A", store_name="Alpha", region="North", channel="BLINKIT", state="Haryana", city="Gurgaon", is_active=True),
            Store(id="B", store_name="Same", region="North", channel="ZEPTO", state="Delhi", city="Delhi", is_active=False),
            Store(id="C", store_name="Same", region="South", channel="BLINKIT", state="Karnataka", city="Bangalore", is_active=True),
        ])
        self.db.flush()
        self.db.add(EmployeeStoreMapping(employee_id=2, store_id="A"))
        permission = Permission(module="Store Reimbursement", action="view", permission_key="store_reimbursement.view", display_name="View", is_active=True)
        self.db.add(permission)
        self.db.flush()
        for user in (self.employee, self.empty):
            self.db.add(EmployeePermission(employee_id=user.id, permission_id=permission.id))
        self.db.commit()
        app = FastAPI()
        app.include_router(status_router)
        app.include_router(reimbursement_router)
        self.user = self.admin
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = ASGIClient(app)

    def tearDown(self):
        self.client.close()
        self.db.close()
        self.engine.dispose()

    def selector(self, **params):
        response = self.client.get("/stores/selector", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_superadmin_pagination_and_deterministic_ties(self):
        pages = [self.selector(page=i, page_size=1) for i in range(1, 5)]
        self.assertEqual([p["items"][0]["id"] for p in pages[:3]], ["A", "B", "C"])
        self.assertEqual([p["has_more"] for p in pages], [True, True, False, False])
        self.assertEqual(pages[3]["items"], [])
        default = self.selector()
        self.assertEqual((default["page"], default["page_size"]), (1, 20))
        self.assertEqual(set(default["items"][0]), {"id", "store_name", "region", "channel", "entity", "state", "city", "is_active"})

    def test_individual_and_combined_filters(self):
        for filters, expected in [
            ({"region": "North"}, ["A", "B"]),
            ({"channel": "BLINKIT"}, ["A", "C"]),
            ({"state": "Karnataka"}, ["C"]),
            ({"city": "Gurgaon"}, ["A"]),
            ({"search": "aLPHa"}, ["A"]),
            ({"search": "b"}, ["B"]),
            ({"is_active": True}, ["A", "C"]),
            ({"is_active": False}, ["B"]),
            ({"region": "North", "channel": "BLINKIT", "state": "Haryana", "city": "Gurgaon"}, ["A"]),
            ({"search": "%"}, []),
        ]:
            with self.subTest(filters=filters):
                self.assertEqual([row["id"] for row in self.selector(**filters)["items"]], expected)

    def test_page_validation(self):
        self.selector(page_size=100)
        for params in ({"page_size": 101}, {"page_size": 0}, {"page": 0}):
            self.assertEqual(self.client.get("/stores/selector", params=params).status_code, 422)

    def test_employee_scope_and_metadata_isolation(self):
        self.user = self.employee
        self.assertEqual([r["id"] for r in self.selector()["items"]], ["A"])
        self.assertEqual(self.selector(search="C")["items"], [])
        metadata = self.client.get("/stores/selector/filters").json()
        self.assertEqual(metadata, {"regions": ["North"], "channels": ["BLINKIT"], "states": ["Haryana"], "cities": ["Gurgaon"]})
        self.assertEqual(self.client.get("/stores/selector/filters", params={"region": "South"}).json()["cities"], [])

    def test_empty_employee_scope(self):
        self.user = self.empty
        self.assertEqual(self.selector()["items"], [])
        self.assertEqual(self.client.get("/stores/selector/filters").json(), {"regions": [], "channels": [], "states": [], "cities": []})

    def test_authorization_view_create_inactive_and_other_roles(self):
        permission = self.db.query(Permission).one()
        self.user = self.employee
        permission.permission_key = "store_reimbursement.create"
        self.db.commit()
        self.assertEqual(len(self.selector()["items"]), 1)
        permission.is_active = False
        self.db.commit()
        for path in ("/stores/selector", "/stores/selector/filters"):
            self.assertEqual(self.client.get(path).status_code, 403)
        self.user = User(id=99, role=RoleEnum.admin)
        self.assertEqual(self.client.get("/stores/selector").status_code, 403)

    def test_metadata_cascades(self):
        metadata = self.client.get("/stores/selector/filters", params={"region": "North", "channel": "BLINKIT", "state": "Haryana"}).json()
        self.assertEqual(metadata, {"regions": ["North", "South"], "channels": ["BLINKIT", "ZEPTO"], "states": ["Haryana"], "cities": ["Gurgaon"]})

    def test_selector_uses_one_projection_query_without_relationships_or_count(self):
        self.admin.id  # Resolve expired test identity before measuring endpoint queries.
        statements = []
        def record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement.lower())
        event.listen(self.engine, "before_cursor_execute", record)
        try:
            self.selector(page_size=1)
        finally:
            event.remove(self.engine, "before_cursor_execute", record)
        self.assertEqual(len(statements), 1, statements)
        for forbidden in ("partner_stores", "join", "count(", "address", "users", "payments", "attachments"):
            self.assertNotIn(forbidden, statements[0])
        self.assertIn("limit", statements[0])

    def claims(self):
        for i, status in enumerate(StoreReimbursementStatus):
            self.db.add(StoreReimbursement(
                reimbursement_number=f"SR-{i}", store_id="A" if i % 2 == 0 else "C",
                store_name="Alpha" if i % 2 == 0 else "Same", store_region="North" if i % 2 == 0 else "South",
                store_channel="BLINKIT", store_entity="Entity", purchase_date=date(2026, 10, i + 1),
                total_amount=Decimal("1.11"), total_paid=Decimal("0.10"), outstanding_amount=Decimal("1.01"),
                status=status.value, reason="Test", created_by_id=1, rejected_by_id=2, cancelled_by_id=3,
            ))
        self.db.commit()

    def test_summary_matches_python_reference_with_filters_scope_and_decimals(self):
        self.claims()
        for user, params in [
            (self.admin, {}), (self.employee, {}), (self.empty, {}),
            (self.admin, {"region": "North"}), (self.admin, {"channel": "BLINKIT"}),
            (self.admin, {"entity": "Entity"}), (self.admin, {"store_id": "C"}),
            (self.admin, {"search": "Alpha"}),
            (self.admin, {"purchase_date_from": "2026-10-02", "purchase_date_to": "2026-10-04"}),
            (self.admin, {"search": "no-match"}),
        ]:
            with self.subTest(user=user.id, params=params):
                self.user = user
                rows = self.db.query(StoreReimbursement).all()
                if user.role == RoleEnum.employee:
                    rows = [r for r in rows if user.id == 2 and r.store_id == "A"]
                for param, field in (("region", "store_region"), ("channel", "store_channel"), ("entity", "store_entity"), ("store_id", "store_id")):
                    if param in params:
                        rows = [r for r in rows if getattr(r, field) == params[param]]
                if "search" in params:
                    rows = [r for r in rows if params["search"].lower() in (r.reimbursement_number + r.store_id + r.store_name).lower()]
                if "purchase_date_from" in params:
                    rows = [r for r in rows if params["purchase_date_from"] <= r.purchase_date.isoformat() <= params["purchase_date_to"]]
                expected = {"total_claims": len(rows)}
                expected.update({s.value.lower() + "_count": sum(r.status == s.value for r in rows) for s in StoreReimbursementStatus})
                for field, output in (("total_amount", "total_reimbursement_amount"), ("total_paid", "total_paid_amount"), ("outstanding_amount", "total_outstanding_amount")):
                    expected[output] = str(sum((getattr(r, field) for r in rows), Decimal("0.00")))
                response = self.client.get("/store-reimbursements/summary", params=params)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), expected)

    def test_list_counts_audit_names_and_no_child_collection_load(self):
        self.claims()
        claim = self.db.query(StoreReimbursement).first()
        self.db.add(StoreReimbursementPayment(reimbursement_id=claim.id, amount=Decimal("0.10"), payment_date=datetime.now(), paid_by_id=1))
        for voided in (None, datetime.now()):
            self.db.add(StoreReimbursementAttachment(reimbursement_id=claim.id, attachment_type="INVOICE", file_url="test", file_name="test", uploaded_by_id=1, voided_at=voided))
        self.db.commit()
        self.db.expunge_all()
        self.user = self.db.get(User, 1)
        statements = []
        def record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement.lower())
        event.listen(self.engine, "before_cursor_execute", record)
        try:
            response = self.client.get("/store-reimbursements", params={"page_size": 100})
        finally:
            event.remove(self.engine, "before_cursor_execute", record)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual((payload["total"], payload["page"], payload["total_pages"]), (6, 1, 1))
        self.assertEqual(sum(r["payments_count"] for r in payload["items"]), 1)
        self.assertEqual(sum(r["attachments_count"] for r in payload["items"]), 1)
        self.assertTrue(all(r["rejected_by_name"] == "Employee" and r["cancelled_by_name"] == "Empty" for r in payload["items"]))
        self.assertEqual(len(statements), 2, statements)
        for obj in self.db.identity_map.values():
            if isinstance(obj, StoreReimbursement):
                self.assertNotIn("payments", obj.__dict__)
                self.assertNotIn("attachments", obj.__dict__)

    def test_summary_aggregates_without_materializing_claims(self):
        self.claims()
        self.admin.id
        statements = []
        def record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement.lower())
        event.listen(self.engine, "before_cursor_execute", record)
        try:
            response = self.client.get("/store-reimbursements/summary")
        finally:
            event.remove(self.engine, "before_cursor_execute", record)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(statements), 1, statements)
        self.assertIn("sum(", statements[0])
        self.assertIn("count(", statements[0])
        self.assertNotIn("store_reimbursements.reason", statements[0])

    def test_employee_list_scope_and_sql_mapping(self):
        self.claims()
        self.user = self.employee
        response = self.client.get("/store-reimbursements")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["total"], 3)
        self.assertTrue(all(r["store_id"] == "A" for r in response.json()["items"]))
        self.user = self.empty
        response = self.client.get("/store-reimbursements")
        self.assertEqual(response.json()["total"], 0)
