from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from datetime import datetime
from pytz import timezone

from backend.utils.auto_order_runner import run_auto_order
from backend.utils.monthly_virtual_card_runner import run_monthly_virtual_card_generation


# -----------------------------
# Scheduler Setup
# -----------------------------
scheduler = BackgroundScheduler(
    timezone=timezone("Asia/Kolkata")
)


scheduler.add_job(
    run_monthly_virtual_card_generation,
    trigger=CronTrigger(
        day=1,
        hour=0,
        minute=10,
    ),
    id="monthly_virtual_card_generation",
    replace_existing=True,
    misfire_grace_time=3600,
    coalesce=True,
    max_instances=1,
)


def schedule_monthly_virtual_card_startup_recovery() -> None:
    scheduler.add_job(
        run_monthly_virtual_card_generation,
        trigger=DateTrigger(
            run_date=datetime.now(timezone("Asia/Kolkata")),
        ),
        id="monthly_virtual_card_startup_recovery",
        replace_existing=True,
        misfire_grace_time=3600,
        coalesce=True,
        max_instances=1,
    )


# -----------------------------
# DAILY AUTO ORDER - 6:00 AM
# -----------------------------
scheduler.add_job(
    run_auto_order,

    trigger=CronTrigger(
        hour=6,
        minute=0
    ),

    id="daily_auto_order",

    replace_existing=True,

    misfire_grace_time=3600,

    coalesce=True,

    max_instances=1
)


print("🔥🔥🔥 AUTO ORDER SCHEDULER CONFIGURED - DAILY 6:00 AM IST 🔥🔥🔥")
