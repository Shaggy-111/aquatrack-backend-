import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytz
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.models
from backend.database.db import Base
from backend.models.monthly_virtual_card import MonthlyVirtualCard
from backend.models.store import Store
from backend.utils import monthly_virtual_card_runner


IST = pytz.timezone("Asia/Kolkata")


class MonthlyVirtualCardRunnerTests(unittest.TestCase):
    def test_runner_uses_current_ist_year_month_and_logs_summary(self):
        db = Mock()
        fixed_now = IST.localize(datetime(2027, 2, 1, 0, 10))
        summary = {
            "total_active_stores": 5,
            "created_count": 3,
            "existing_count": 2,
            "created_card_ids": [1, 2, 3],
        }

        with (
            patch.object(monthly_virtual_card_runner, "SessionLocal", return_value=db),
            patch.object(monthly_virtual_card_runner, "datetime") as mocked_datetime,
            patch.object(
                monthly_virtual_card_runner,
                "ensure_monthly_cards_for_active_stores",
                return_value=summary,
            ) as ensure,
            patch("builtins.print") as output,
        ):
            mocked_datetime.now.return_value = fixed_now
            monthly_virtual_card_runner.run_monthly_virtual_card_generation()

        ensure.assert_called_once_with(db, 2027, 2)
        db.commit.assert_called_once_with()
        db.rollback.assert_not_called()
        db.close.assert_called_once_with()
        log = " ".join(str(call.args[0]) for call in output.call_args_list)
        self.assertIn("year=2027, month=2", log)
        self.assertIn("total_active_stores=5", log)
        self.assertIn("created_count=3", log)
        self.assertIn("existing_count=2", log)

    def test_runner_failure_rolls_back_closes_and_does_not_raise(self):
        db = Mock()

        with (
            patch.object(monthly_virtual_card_runner, "SessionLocal", return_value=db),
            patch.object(
                monthly_virtual_card_runner,
                "ensure_monthly_cards_for_active_stores",
                side_effect=RuntimeError("database unavailable"),
            ),
            patch("builtins.print") as output,
        ):
            monthly_virtual_card_runner.run_monthly_virtual_card_generation()

        db.commit.assert_not_called()
        db.rollback.assert_called_once_with()
        db.close.assert_called_once_with()
        log = " ".join(str(call.args[0]) for call in output.call_args_list)
        self.assertIn("generation failed", log)
        self.assertIn("database unavailable", log)

    def test_repeated_runner_execution_creates_no_duplicates(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine, autoflush=False)
        setup_db = Session()
        setup_db.add_all(
            [
                Store(id="active-1", store_name="Active 1", is_active=True),
                Store(id="active-2", store_name="Active 2", is_active=True),
                Store(id="inactive-1", store_name="Inactive", is_active=False),
            ]
        )
        setup_db.commit()
        setup_db.close()

        try:
            with (
                patch.object(monthly_virtual_card_runner, "SessionLocal", Session),
                patch("builtins.print"),
            ):
                monthly_virtual_card_runner.run_monthly_virtual_card_generation()
                monthly_virtual_card_runner.run_monthly_virtual_card_generation()

            verify_db = Session()
            try:
                cards = verify_db.query(MonthlyVirtualCard).all()
                self.assertEqual(len(cards), 2)
                self.assertEqual(
                    {card.store_id for card in cards},
                    {"active-1", "active-2"},
                )
            finally:
                verify_db.close()
        finally:
            Base.metadata.drop_all(engine)
            engine.dispose()


class MonthlyVirtualCardSchedulerConfigurationTests(unittest.TestCase):
    def test_monthly_and_daily_cron_jobs_are_registered(self):
        from backend.scheduler import scheduler

        monthly = scheduler.get_job("monthly_virtual_card_generation")
        daily = scheduler.get_job("daily_auto_order")

        self.assertIsNotNone(monthly)
        monthly_fields = {field.name: str(field) for field in monthly.trigger.fields}
        self.assertEqual(monthly_fields["day"], "1")
        self.assertEqual(monthly_fields["hour"], "0")
        self.assertEqual(monthly_fields["minute"], "10")
        self.assertIn(str(monthly.trigger.timezone), {"Asia/Kolkata", "Asia/Calcutta"})
        self.assertTrue(monthly.coalesce)
        self.assertEqual(monthly.max_instances, 1)
        self.assertEqual(monthly.misfire_grace_time, 3600)

        self.assertIsNotNone(daily)
        daily_fields = {field.name: str(field) for field in daily.trigger.fields}
        self.assertEqual(daily_fields["hour"], "6")
        self.assertEqual(daily_fields["minute"], "0")
        self.assertTrue(daily.coalesce)
        self.assertEqual(daily.max_instances, 1)
        self.assertEqual(daily.misfire_grace_time, 3600)

    def test_startup_recovery_registers_immediate_one_time_job(self):
        from apscheduler.triggers.date import DateTrigger
        from backend.scheduler import (
            schedule_monthly_virtual_card_startup_recovery,
            scheduler,
        )

        schedule_monthly_virtual_card_startup_recovery()
        try:
            recovery = scheduler.get_job("monthly_virtual_card_startup_recovery")
            self.assertIsNotNone(recovery)
            self.assertIsInstance(recovery.trigger, DateTrigger)
            self.assertIn(
                str(recovery.trigger.run_date.tzinfo),
                {"Asia/Kolkata", "Asia/Calcutta"},
            )
        finally:
            scheduler.remove_job("monthly_virtual_card_startup_recovery")

    def test_production_startup_registers_recovery_and_starts_scheduler(self):
        import backend.main as main

        fake_scheduler = Mock()
        fake_scheduler.running = False

        with (
            patch.object(main, "settings", SimpleNamespace(APP_ENV="production")),
            patch.object(main, "scheduler", fake_scheduler),
            patch.object(
                main,
                "schedule_monthly_virtual_card_startup_recovery",
            ) as recovery,
            patch("builtins.print"),
        ):
            main.start_scheduler()

        recovery.assert_called_once_with()
        fake_scheduler.start.assert_called_once_with()

    def test_non_production_startup_does_not_register_recovery(self):
        import backend.main as main

        fake_scheduler = Mock()
        fake_scheduler.running = False

        for app_env in ("local", "stage"):
            with self.subTest(app_env=app_env):
                with (
                    patch.object(main, "settings", SimpleNamespace(APP_ENV=app_env)),
                    patch.object(main, "scheduler", fake_scheduler),
                    patch.object(
                        main,
                        "schedule_monthly_virtual_card_startup_recovery",
                    ) as recovery,
                    patch("builtins.print"),
                ):
                    main.start_scheduler()

                recovery.assert_not_called()


if __name__ == "__main__":
    unittest.main()
