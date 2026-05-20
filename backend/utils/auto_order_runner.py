from datetime import datetime
from sqlalchemy import func

from backend.database.db import SessionLocal
from backend.models.store import Store
from backend.models.order import Order

from backend.utils.auto_order import (
    should_create_order,
    create_auto_order
)


# -----------------------------
# Prevent duplicate SYSTEM orders
# -----------------------------
def already_auto_ordered_today(store_id, db):

    today = datetime.utcnow().date()

    existing = db.query(Order).filter(
        Order.store_id == store_id,
        func.date(Order.order_date) == today,
        Order.status == "assigned_to_manager"
    ).first()

    return existing is not None


# -----------------------------
# Runner
# -----------------------------
def run_auto_order():

    db = SessionLocal()

    try:

        stores = db.query(Store).filter(
            Store.per_day_consumption > 0
        ).all()

        total_stores = len(stores)

        success_count = 0
        already_count = 0
        failed_count = 0

        failed_reasons = []

        print(
            f"\n🚀 Checking Auto-Order "
            f"for {total_stores} stores...\n"
        )

        for store in stores:

            try:

                db.refresh(store)

                # ❌ Skip if auto order disabled
                if hasattr(store, "auto_order_enabled") and not store.auto_order_enabled:

                    failed_count += 1

                    failed_reasons.append({
                        "store": store.id,
                        "reason": "Auto order disabled"
                    })

                    print(f"⛔ {store.id} → Auto order disabled")

                    continue

                # ❌ Skip if already ordered today
                if already_auto_ordered_today(store.id, db):

                    already_count += 1

                    print(f"ℹ️ {store.id} → Already ordered today")

                    continue

                # 🔥 MAIN LOGIC
                should_create, reason = should_create_order(store, db)

                if not should_create:

                    failed_count += 1

                    failed_reasons.append({
                        "store": store.id,
                        "reason": reason
                    })

                    print(f"❌ {store.id} → {reason}")

                    continue

                # ✅ Create order
                create_auto_order(store, db)

                success_count += 1

            except Exception as store_error:

                failed_count += 1

                failed_reasons.append({
                    "store": store.id,
                    "reason": str(store_error)
                })

                print(
                    f"❌ STORE ERROR "
                    f"{store.id}: {str(store_error)}"
                )

                db.rollback()

                continue

        # --------------------------------
        # FINAL SUMMARY
        # --------------------------------
        print("\n================ AUTO ORDER SUMMARY ================\n")

        print(f"✅ Orders Created      : {success_count}")
        print(f"ℹ️ Already Ordered    : {already_count}")
        print(f"❌ Failed              : {failed_count}")
        print(f"🏪 Total Stores        : {total_stores}")

        print("\n================ FAILED STORES ====================\n")

        for item in failed_reasons:
            print(f"❌ {item['store']} → {item['reason']}")

        print("\n===================================================\n")

    except Exception as e:

        print(f"❌ Runner Error: {e}")

    finally:

        db.close()


# -----------------------------
# Manual Run
# -----------------------------
if __name__ == "__main__":
    run_auto_order()