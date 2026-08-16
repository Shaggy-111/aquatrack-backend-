import inspect
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

from backend.models.order import OrderStatusEnum
from backend.routes import delivery_reports, report, store_reports


def order(
    *,
    status=OrderStatusEnum.delivered_confirmed,
    delivered=0,
    confirmed=None,
    empty=0,
    confirmed_empty=None,
    order_date=datetime(2026, 8, 5, 6, 30, tzinfo=timezone.utc),
    source="VIRTUAL_CARD",
    order_id=1,
):
    return SimpleNamespace(
        id=order_id,
        status=status,
        bottles_delivered=delivered,
        confirmed_bottles=confirmed,
        empty_bottles_collected=empty,
        confirmed_empty_bottles=confirmed_empty,
        order_date=order_date,
        ordered_by_type=source,
    )


class ReportCorrectnessTests(unittest.TestCase):
    def test_confirmed_quantities_take_precedence_including_zero(self):
        value = order(delivered=12, confirmed=7, empty=5, confirmed_empty=3)
        self.assertEqual(delivery_reports.effective_delivered_value(value), 7)
        self.assertEqual(delivery_reports.effective_empty_value(value), 3)

        zero = order(delivered=12, confirmed=0, empty=5, confirmed_empty=0)
        self.assertEqual(delivery_reports.effective_delivered_value(zero), 0)
        self.assertEqual(delivery_reports.effective_empty_value(zero), 0)

    def test_pending_confirmation_uses_delivered_fields(self):
        value = order(
            status=OrderStatusEnum.delivered_pending_confirmation,
            delivered=12,
            confirmed=7,
            empty=5,
            confirmed_empty=3,
        )
        self.assertEqual(delivery_reports.effective_delivered_value(value), 12)
        self.assertEqual(delivery_reports.effective_empty_value(value), 5)

    def test_sql_expressions_encode_null_not_truthiness_precedence(self):
        delivered_sql = str(
            delivery_reports.effective_delivered_expression().compile(
                dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
            )
        )
        empty_sql = str(
            delivery_reports.effective_empty_expression().compile(
                dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
            )
        )
        self.assertIn("coalesce(orders.confirmed_bottles, orders.bottles_delivered, 0)", delivered_sql)
        self.assertIn("coalesce(orders.confirmed_empty_bottles, orders.empty_bottles_collected, 0)", empty_sql)

    def test_virtual_card_once_update_and_same_day_aggregation(self):
        virtual = order(delivered=10, confirmed=10, order_id=1)
        totals = delivery_reports.aggregate_effective_delivered_by_ist_date([virtual])
        self.assertEqual(totals, {date(2026, 8, 5): 10})

        virtual.confirmed_bottles = 14
        virtual.bottles_delivered = 14
        totals = delivery_reports.aggregate_effective_delivered_by_ist_date([virtual])
        self.assertEqual(totals, {date(2026, 8, 5): 14})

        second = order(delivered=6, confirmed=6, order_id=2)
        totals = delivery_reports.aggregate_effective_delivered_by_ist_date(
            [virtual, second]
        )
        self.assertEqual(totals, {date(2026, 8, 5): 20})
        self.assertEqual([virtual.id, second.id], [1, 2])  # raw Orders stay separate

    def test_ist_near_midnight_month_end_and_full_end_day(self):
        late = order(order_date=datetime(2026, 8, 5, 18, 20, tzinfo=timezone.utc))
        early = order(order_date=datetime(2026, 8, 5, 18, 40, tzinfo=timezone.utc))
        month_end = order(order_date=datetime(2026, 8, 31, 18, 20, tzinfo=timezone.utc))
        self.assertEqual(delivery_reports.order_date_in_ist(late.order_date).date(), date(2026, 8, 5))
        self.assertEqual(delivery_reports.order_date_in_ist(early.order_date).date(), date(2026, 8, 6))
        self.assertEqual(delivery_reports.order_date_in_ist(month_end.order_date).date(), date(2026, 8, 31))

        start, end = delivery_reports.ist_date_range_utc(date(2026, 8, 5), date(2026, 8, 5))
        self.assertEqual(start, datetime(2026, 8, 4, 18, 30, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2026, 8, 5, 18, 30, tzinfo=timezone.utc))
        self.assertLess(late.order_date, end)  # 23:50 IST on the final date is included
        self.assertGreaterEqual(early.order_date, end)  # 00:10 IST belongs to next day

    def test_qr_and_partner_confirmed_quantity_rules(self):
        qr = order(delivered=9, confirmed=9, source="QR_DELIVERY")
        partner_confirmed = order(delivered=10, confirmed=8, source="POC")
        self.assertEqual(delivery_reports.effective_delivered_value(qr), 9)
        self.assertEqual(delivery_reports.effective_delivered_value(partner_confirmed), 8)

    def test_summaries_use_order_date_and_routes_do_not_write_reports(self):
        daily_source = inspect.getsource(delivery_reports.get_daily_summary)
        store_source = inspect.getsource(store_reports.store_summary)
        pivot_source = inspect.getsource(report.export_monthly_pivot)
        self.assertIn("Order.order_date", daily_source)
        self.assertNotIn("Order.created_at", daily_source)
        self.assertIn("Order.order_date", store_source)
        self.assertNotIn("Order.created_at", store_source)
        self.assertNotIn("db.add", pivot_source)
        self.assertNotIn("Report(", pivot_source)


if __name__ == "__main__":
    unittest.main()
