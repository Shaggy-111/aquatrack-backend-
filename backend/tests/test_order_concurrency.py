import threading
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
import uuid

import pytz

from fastapi import HTTPException

from backend.models.order import Order, OrderStatusEnum
from backend.models.monthly_virtual_card import (
    MonthlyVirtualCard,
    MonthlyVirtualCardEntry,
    MonthlyVirtualCardEntryOrder,
)
from backend.models.partner_store import PartnerStore
from backend.models.store import Store
from backend.models.store_qr_delivery_submission import StoreQrDeliverySubmission
from backend.models.user import RoleEnum, User
from backend.routes.partners import PartnerConfirmRequest, confirm_order_delivery
from backend.database.db import SessionLocal, engine
from backend.services.monthly_virtual_card import upsert_monthly_virtual_card_entry
from backend.services.store_qr_delivery import submit_store_qr_delivery
from backend.utils.auto_order import create_auto_order


class _LockingQuery:
    def __init__(self, session, entity):
        self.session = session
        self.entity = entity
        self.locking = False

    def filter(self, *args):
        return self

    def join(self, *args):
        return self

    def order_by(self, *args):
        return self

    def populate_existing(self):
        return self

    def with_for_update(self):
        self.locking = True
        return self

    def count(self):
        return 0

    def first(self):
        if self.entity is Store:
            if self.locking:
                self.session.acquire_store_lock()
            return self.session.state.store
        if self.entity is Order:
            if self.locking:
                self.session.acquire_order_lock()
            return self.session.state.order
        if self.entity is PartnerStore:
            return SimpleNamespace(
                user_id=self.session.state.partner.id,
                store_id=self.session.state.store.id,
            )
        if self.entity is User:
            return self.session.state.partner
        return None


class _ConcurrentState:
    def __init__(self):
        self.store_lock = threading.Lock()
        self.order_lock = threading.Lock()
        self.store = SimpleNamespace(
            id="store-1",
            qr_public_id="qr-1",
            qr_token_version=1,
            qr_enabled=True,
            is_active=True,
            channel="BLINKIT",
            assigned_manager_id=10,
            order_frequency_days=1,
            per_day_consumption=1,
            last_order_date=None,
            pending_empty_bottles=5,
        )
        self.partner = SimpleNamespace(id=20)
        self.store.partners = [self.partner]
        self.order = None
        self.orders_created = 0


class _ConcurrentSession:
    def __init__(self, state):
        self.state = state
        self.store_locked = False
        self.order_locked = False
        self.pending_order = None
        self.pending_submission = None

    def query(self, entity):
        return _LockingQuery(self, entity)

    def acquire_store_lock(self):
        if not self.store_locked:
            self.state.store_lock.acquire()
            self.store_locked = True

    def acquire_order_lock(self):
        if not self.order_locked:
            self.state.order_lock.acquire()
            self.order_locked = True

    def add(self, value):
        if isinstance(value, Order):
            self.pending_order = value
        elif isinstance(value, StoreQrDeliverySubmission):
            self.pending_submission = value

    def commit(self):
        if self.pending_order is not None:
            self.state.order = self.pending_order
            self.state.orders_created += 1
            self.pending_order = None
        if self.pending_submission is not None:
            self.pending_submission.order = self.state.order
            self.pending_submission.submitted_at = datetime.now(timezone.utc)
            self.pending_submission = None
        self._release_locks()

    def rollback(self):
        self.pending_order = None
        self.pending_submission = None
        self._release_locks()

    def refresh(self, value):
        return None

    def flush(self, objects=None):
        if self.pending_order is not None and self.state.order is None:
            self.pending_order.id = 1
            self.state.order = self.pending_order
            self.state.orders_created += 1
            self.pending_order = None

    def _release_locks(self):
        if self.order_locked:
            self.state.order_lock.release()
            self.order_locked = False
        if self.store_locked:
            self.state.store_lock.release()
            self.store_locked = False


class OrderConcurrencyTests(unittest.TestCase):
    def test_scheduler_and_qr_creation_share_store_lock(self):
        state = _ConcurrentState()
        start = threading.Barrier(2)
        outcomes = []

        def create_from_scheduler():
            session = _ConcurrentSession(state)
            start.wait()
            outcomes.append(create_auto_order(state.store, session))

        def create_from_qr():
            session = _ConcurrentSession(state)
            start.wait()
            try:
                with patch(
                    "backend.services.store_qr_delivery."
                    "sync_order_to_monthly_virtual_card"
                ):
                    result = submit_store_qr_delivery(
                        session,
                        qr_public_id="qr-1",
                        qr_token_version=1,
                        idempotency_key="key-1",
                        token_jti="jti-1",
                        bottles_delivered=10,
                        photo_url=None,
                        remarks=None,
                        delivered_by=None,
                        source_ip="127.0.0.1",
                        user_agent="test",
                        latitude=None,
                        longitude=None,
                        gps_accuracy=None,
                    )
                outcomes.append(result["created_order"])
            except HTTPException as error:
                outcomes.append(error)
                session.rollback()

        threads = [
            threading.Thread(target=create_from_scheduler),
            threading.Thread(target=create_from_qr),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2)

        self.assertEqual(state.orders_created, 1)
        self.assertFalse(any(thread.is_alive() for thread in threads))


@unittest.skipUnless(
    engine.dialect.name == "postgresql",
    "row-lock concurrency requires PostgreSQL",
)
class MonthlyVirtualCardPostgresConcurrencyTests(unittest.TestCase):
    """Real row-lock tests; synchronization is intentionally never mocked."""

    def setUp(self):
        self.key = uuid.uuid4().hex[:12]
        self.store_id = f"mvc-lock-{self.key}"
        self.db = SessionLocal()
        self.admin = User(
            email=f"mvc-admin-{self.key}@example.com",
            password="test",
            full_name="MVC Admin",
            role=RoleEnum.superadmin,
            status="active",
        )
        self.partner = User(
            email=f"mvc-partner-{self.key}@example.com",
            password="test",
            full_name="MVC Partner",
            role=RoleEnum.partner,
            status="active",
        )
        self.store = Store(
            id=self.store_id,
            store_name=f"MVC Lock {self.key}",
            is_active=True,
            pending_empty_bottles=5,
            qr_public_id=f"mvc-qr-{self.key}",
            qr_enabled=True,
            qr_token_version=1,
        )
        self.db.add_all([self.admin, self.partner, self.store])
        self.db.flush()
        self.db.add(
            PartnerStore(user_id=self.partner.id, store_id=self.store.id)
        )
        self.db.commit()

    def tearDown(self):
        self.db.rollback()
        order_ids = [
            row.id
            for row in self.db.query(Order.id)
            .filter(Order.store_id == self.store_id)
            .all()
        ]
        entry_ids = [
            row.id
            for row in self.db.query(MonthlyVirtualCardEntry.id)
            .join(
                MonthlyVirtualCard,
                MonthlyVirtualCard.id == MonthlyVirtualCardEntry.card_id,
            )
            .filter(MonthlyVirtualCard.store_id == self.store_id)
            .all()
        ]
        if entry_ids:
            self.db.query(MonthlyVirtualCardEntryOrder).filter(
                MonthlyVirtualCardEntryOrder.entry_id.in_(entry_ids)
            ).delete(synchronize_session=False)
        if order_ids:
            self.db.query(StoreQrDeliverySubmission).filter(
                StoreQrDeliverySubmission.order_id.in_(order_ids)
            ).delete(synchronize_session=False)
            self.db.query(Order).filter(Order.id.in_(order_ids)).delete(
                synchronize_session=False
            )
        self.db.query(MonthlyVirtualCardEntry).filter(
            MonthlyVirtualCardEntry.id.in_(entry_ids or [-1])
        ).delete(synchronize_session=False)
        self.db.query(MonthlyVirtualCard).filter(
            MonthlyVirtualCard.store_id == self.store_id
        ).delete(synchronize_session=False)
        self.db.query(PartnerStore).filter(
            PartnerStore.store_id == self.store_id
        ).delete(synchronize_session=False)
        self.db.query(Store).filter(Store.id == self.store_id).delete(
            synchronize_session=False
        )
        self.db.query(User).filter(
            User.email.in_(
                [
                    f"mvc-admin-{self.key}@example.com",
                    f"mvc-partner-{self.key}@example.com",
                ]
            )
        ).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def _add_order_and_card(self, status):
        now = datetime.now(timezone.utc)
        order = Order(
            partner_id=self.partner.id,
            store_id=self.store.id,
            status=status,
            order_details="10",
            total_amount=0,
            order_date=now,
            bottles_delivered=10,
            empty_bottles_collected=2,
        )
        business_date = now.astimezone(pytz.timezone("Asia/Kolkata")).date()
        card = MonthlyVirtualCard(
            store_id=self.store.id,
            year=business_date.year,
            month=business_date.month,
        )
        self.db.add_all([order, card])
        self.db.flush()
        entry = MonthlyVirtualCardEntry(
            card_id=card.id,
            entry_date=business_date,
            entry_source="super_admin",
            created_by_id=self.admin.id,
        )
        self.db.add(entry)
        self.db.flush()
        self.db.add(
            MonthlyVirtualCardEntryOrder(entry_id=entry.id, order_id=order.id)
        )
        self.db.commit()
        return order.id, card.id, business_date

    def _run_concurrently(self, first, second):
        barrier = threading.Barrier(2)
        outcomes = []

        def run(operation):
            session = SessionLocal()
            try:
                barrier.wait()
                operation(session)
                outcomes.append("committed")
            except HTTPException as exc:
                session.rollback()
                outcomes.append(f"http-{exc.status_code}")
            except Exception as exc:
                session.rollback()
                outcomes.append(exc)
            finally:
                session.close()

        threads = [threading.Thread(target=run, args=(op,)) for op in (first, second)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertFalse(any(thread.is_alive() for thread in threads), outcomes)
        unexpected = [item for item in outcomes if isinstance(item, Exception)]
        self.assertEqual(unexpected, [], outcomes)
        return outcomes

    def _assert_single_card_entry_link(self):
        self.assertEqual(
            self.db.query(MonthlyVirtualCard)
            .filter(MonthlyVirtualCard.store_id == self.store_id)
            .count(),
            1,
        )
        self.assertEqual(
            self.db.query(MonthlyVirtualCardEntry)
            .join(MonthlyVirtualCard)
            .filter(MonthlyVirtualCard.store_id == self.store_id)
            .count(),
            1,
        )
        self.assertEqual(
            self.db.query(MonthlyVirtualCardEntryOrder)
            .join(MonthlyVirtualCardEntry)
            .join(MonthlyVirtualCard)
            .filter(MonthlyVirtualCard.store_id == self.store_id)
            .count(),
            1,
        )

    def test_phase5a_entry_concurrent_with_partner_confirmation(self):
        order_id, card_id, business_date = self._add_order_and_card(
            OrderStatusEnum.delivered_pending_confirmation
        )

        def phase5(session):
            admin = session.get(User, self.admin.id)
            upsert_monthly_virtual_card_entry(
                session, card_id, business_date, 10, 2, "admin", admin
            )
            session.commit()

        def confirm(session):
            partner = session.get(User, self.partner.id)
            confirm_order_delivery(
                order_id,
                PartnerConfirmRequest(
                    confirmed_bottles=10,
                    confirmed_empty_bottles=2,
                ),
                session,
                partner,
            )

        self._run_concurrently(phase5, confirm)
        self.db.expire_all()
        self._assert_single_card_entry_link()
        self.assertEqual(
            self.db.get(Order, order_id).status,
            OrderStatusEnum.delivered_confirmed,
        )

    def test_phase5a_entry_concurrent_with_qr_delivery(self):
        order_id, card_id, business_date = self._add_order_and_card(
            OrderStatusEnum.assigned_to_manager
        )

        def phase5(session):
            admin = session.get(User, self.admin.id)
            upsert_monthly_virtual_card_entry(
                session, card_id, business_date, 10, 2, "admin", admin
            )
            session.commit()

        def qr(session):
            submit_store_qr_delivery(
                session,
                qr_public_id=self.store.qr_public_id,
                qr_token_version=1,
                idempotency_key=f"idem-{self.key}",
                token_jti=f"jti-{self.key}",
                bottles_delivered=10,
                photo_url=None,
                remarks=None,
                delivered_by=None,
                source_ip=f"127.0.0.{int(self.key[0], 16) + 1}",
                user_agent="test",
                latitude=None,
                longitude=None,
                gps_accuracy=None,
            )

        outcomes = self._run_concurrently(phase5, qr)
        self.assertTrue("committed" in outcomes, outcomes)
        self.db.expire_all()
        self._assert_single_card_entry_link()

class OrderConcurrencyRemainingTests(unittest.TestCase):
    def test_mobile_completed_order_blocks_qr_case_b(self):
        state = _ConcurrentState()
        state.order = SimpleNamespace(status=OrderStatusEnum.delivered_confirmed)
        session = _ConcurrentSession(state)

        with (
            patch(
                "backend.services.store_qr_delivery._existing_submission",
                return_value=None,
            ),
            patch(
                "backend.services.store_qr_delivery._eligible_order_query",
                return_value=SimpleNamespace(first=lambda: None),
            ),
            patch(
                "backend.services.store_qr_delivery.same_day_non_cancelled_order_query",
                return_value=SimpleNamespace(first=lambda: state.order),
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                submit_store_qr_delivery(
                    session,
                    qr_public_id="qr-1",
                    qr_token_version=1,
                    idempotency_key="key-1",
                    token_jti="jti-1",
                    bottles_delivered=10,
                    photo_url=None,
                    remarks=None,
                    delivered_by=None,
                    source_ip="127.0.0.1",
                    user_agent="test",
                    latitude=None,
                    longitude=None,
                    gps_accuracy=None,
                )
            session.rollback()

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(state.orders_created, 0)

    def test_double_partner_confirmation_mutates_balance_once(self):
        state = _ConcurrentState()
        state.order = SimpleNamespace(
            id=1,
            store_id=state.store.id,
            status=OrderStatusEnum.delivered_pending_confirmation,
            bottles_delivered=10,
            empty_bottles_collected=2,
            confirmed_bottles=None,
            confirmed_empty_bottles=0,
            store_confirmed=False,
            confirmation_remarks=None,
        )
        current_user = SimpleNamespace(id=state.partner.id, role=RoleEnum.partner)
        body = PartnerConfirmRequest(
            confirmed_bottles=10,
            confirmed_empty_bottles=2,
        )
        start = threading.Barrier(2)
        results = []

        def confirm():
            session = _ConcurrentSession(state)
            start.wait()
            try:
                with patch(
                    "backend.routes.partners.sync_order_to_monthly_virtual_card"
                ):
                    results.append(
                        confirm_order_delivery(1, body, session, current_user)
                    )
            except HTTPException as error:
                results.append(error)
            finally:
                session.rollback()

        threads = [threading.Thread(target=confirm), threading.Thread(target=confirm)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2)

        successes = [result for result in results if isinstance(result, dict)]
        conflicts = [result for result in results if isinstance(result, HTTPException)]
        self.assertEqual(len(successes), 1)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0].status_code, 400)
        self.assertEqual(state.store.pending_empty_bottles, 13)
        self.assertFalse(any(thread.is_alive() for thread in threads))


if __name__ == "__main__":
    unittest.main()
