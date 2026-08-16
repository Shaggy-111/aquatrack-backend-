from datetime import datetime

from sqlalchemy.orm import Session

from backend.models.order import Order
from backend.models.store import Store
from backend.utils.same_day_order import same_day_non_cancelled_order_query
from backend.utils.store_status import require_active_store


def validate_store_for_auto_order(store):
    if not store.is_active:
        return False, "Store is inactive."
    if not store.assigned_manager_id:
        return False, "Please create Store Manager first"
    if not store.partners or len(store.partners) == 0:
        return False, "Please map Partner first"
    return True, "OK"


def is_order_day(store):
    if not store.last_order_date:
        return True
    return store.last_order_date < datetime.utcnow().date()


def get_monthly_usage(store_id, db: Session):
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0)
    orders = db.query(Order).filter(
        Order.store_id == store_id,
        Order.order_date >= month_start,
    ).all()
    return sum(
        int(order.order_details)
        for order in orders
        if str(order.order_details).isdigit()
    )


def should_create_order(store, db):
    if not store.is_active:
        return False, "Store is inactive."
    if not store.channel:
        return False, "No channel"
    if not store.assigned_manager_id:
        return False, "Manager missing"
    if not store.partners or len(store.partners) == 0:
        return False, "Partner missing"
    if not is_order_day(store):
        return False, "Not order day"
    return True, "OK"


def create_auto_order(store, db: Session):
    store = (
        db.query(Store)
        .filter(Store.id == store.id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    if not store:
        return False

    require_active_store(store)

    # This is the authoritative duplicate check. It runs while the same Store
    # row used by Store QR delivery creation is locked.
    if same_day_non_cancelled_order_query(db, store.id).first():
        print(f"Store {store.id} already has an order for today.")
        db.rollback()
        return False

    channel = store.channel.upper() if store.channel else ""
    if channel == "ZEPTO":
        frequency = int(store.order_frequency_days or 1)
        consumption = int(store.per_day_consumption or 0)
        order_quantity = max(1, consumption * frequency)
    elif channel == "BLINKIT":
        order_quantity = 20
    else:
        db.rollback()
        return False

    partner = store.partners[0] if store.partners else None
    if not partner:
        print(f"SKIP {store.id}: No Partner/Vendor mapped to this store.")
        db.rollback()
        return False

    today = datetime.utcnow().date()
    try:
        new_order = Order(
            partner_id=partner.id,
            store_id=store.id,
            assigned_to_manager_id=store.assigned_manager_id,
            order_details=str(order_quantity),
            total_amount=0,
            status="assigned_to_manager",
            channel=store.channel,
            order_date=datetime.utcnow(),
        )
        db.add(new_order)
        store.last_order_date = today
        db.commit()
        print(
            f"SUCCESS: {channel} | Store: {store.id} | "
            f"Manager: {store.assigned_manager_id} | Partner: {partner.id}"
        )
        return True
    except Exception as error:
        db.rollback()
        print(f"DATABASE ERROR for Store {store.id}: {str(error)}")
        return False
