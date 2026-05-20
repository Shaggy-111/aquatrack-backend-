from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from pytz import timezone

from backend.utils.auto_order_runner import run_auto_order


# -----------------------------
# Scheduler Setup
# -----------------------------
scheduler = BackgroundScheduler(
    timezone=timezone("Asia/Kolkata")
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