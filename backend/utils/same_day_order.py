from datetime import datetime, time, timedelta, timezone

import pytz
from sqlalchemy.orm import Session

from backend.models.order import Order, OrderStatusEnum


IST = pytz.timezone("Asia/Kolkata")


def business_day_bounds_utc() -> tuple[datetime, datetime]:
    today_ist = datetime.now(IST).date()
    start_ist = IST.localize(datetime.combine(today_ist, time.min))
    end_ist = start_ist + timedelta(days=1)
    return start_ist.astimezone(timezone.utc), end_ist.astimezone(timezone.utc)


def same_day_non_cancelled_order_query(db: Session, store_id: str):
    start_utc, end_utc = business_day_bounds_utc()
    return db.query(Order).filter(
        Order.store_id == store_id,
        Order.order_date >= start_utc,
        Order.order_date < end_utc,
        Order.status != OrderStatusEnum.cancelled,
    )
