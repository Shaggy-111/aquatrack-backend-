from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from backend.models.order import Order


def validate_store_for_auto_order(store):
    if not store.assigned_manager_id:
        return False, "Please create Store Manager first"

    if not store.partners or len(store.partners) == 0:
        return False, "Please map Partner first"

    if not store.per_day_consumption or store.per_day_consumption <= 0:
        return False, "Please set per day consumption"

    return True, "OK"


# -----------------------------
# Daily Order Check
# -----------------------------
def is_order_day(store):

    # ✅ Naya store ho toh turant order lage
    if not store.last_order_date:
        return True

    today = datetime.utcnow().date()

    # ✅ Daily order logic
    return store.last_order_date < today


# -----------------------------
# Monthly Usage (ZEPTO only)
# -----------------------------
def get_monthly_usage(store_id, db: Session):
    month_start = datetime.utcnow().replace(
        day=1,
        hour=0,
        minute=0,
        second=0
    )

    orders = db.query(Order).filter(
        Order.store_id == store_id,
        Order.order_date >= month_start
    ).all()

    return sum([
        int(o.order_details)
        for o in orders
        if str(o.order_details).isdigit()
    ])


# -----------------------------
# Decision Engine
# -----------------------------
def should_create_order(store, db):

    # ❌ No channel
    if not store.channel:
        return False, "No channel"

    # ❌ Auto disabled
    if not store.auto_order_enabled:
        return False, "Auto order disabled"

    # ❌ Manager missing
    if not store.assigned_manager_id:
        return False, "Manager missing"

    # ❌ Partner missing
    if not store.partners or len(store.partners) == 0:
        return False, "Partner missing"

    # ❌ Consumption missing
    if not store.per_day_consumption or store.per_day_consumption <= 0:
        return False, "Consumption missing"

    # ❌ Not order day
    if not is_order_day(store):
        return False, "Not order day"

    # 🔥 CHANNEL LOGIC
    channel = (store.channel or "").upper()

    if channel == "ZEPTO":
        return True, "OK"

    elif channel == "BLINKIT":
        return True, "OK"

    # ✅ DEFAULT
    return True, "OK"


# -----------------------------
# Create Order
# -----------------------------
def create_auto_order(store, db: Session):

    channel = store.channel.upper() if store.channel else ""

    # -----------------------------
    # 1. Quantity Calculation
    # -----------------------------
    if channel == "ZEPTO":
        freq = int(store.order_frequency_days or 1)
        order_qty = store.per_day_consumption * freq

    elif channel == "BLINKIT":
        order_qty = 20

    else:
        return

    # -----------------------------
    # 2. Partner Validation
    # -----------------------------
    partner = store.partners[0] if store.partners else None

    if not partner:
        print(
            f"⚠️ SKIP {store.id}: "
            f"No Partner/Vendor mapped to this store."
        )
        return

    # -----------------------------
    # 3. Duplicate Check
    # -----------------------------
    today = datetime.utcnow().date()

    existing_auto = db.query(Order).filter(
        Order.store_id == store.id,
        func.date(Order.order_date) == today,
        Order.status == "assigned_to_manager"
    ).first()

    if existing_auto:
        print(
            f"ℹ️ {store.id} already has "
            f"an automated order for today."
        )
        return

    # -----------------------------
    # 4. Resilient Order Creation
    # -----------------------------
    try:

        new_order = Order(
            partner_id=partner.id,
            store_id=store.id,
            assigned_to_manager_id=store.assigned_manager_id,
            order_details=str(order_qty),
            total_amount=0,
            status="assigned_to_manager",
            channel=store.channel,
            order_date=datetime.utcnow()
        )

        db.add(new_order)

        # ✅ Update last order date
        store.last_order_date = today

        db.commit()

        print(
            f"🚀 SUCCESS: "
            f"{channel} | "
            f"Store: {store.id} | "
            f"Manager: {store.assigned_manager_id} | "
            f"Partner: {partner.id}"
        )

    except Exception as e:

        db.rollback()

        print(
            f"❌ DATABASE ERROR for "
            f"Store {store.id}: {str(e)}"
        )

        return