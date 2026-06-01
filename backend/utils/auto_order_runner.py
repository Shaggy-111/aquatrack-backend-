from datetime import datetime
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from backend.database.db import SessionLocal
from backend.models.store import Store
from backend.models.order import Order

from backend.utils.auto_order import (
    should_create_order,
    create_auto_order,
    is_order_day
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

        # ✅ LOAD PARTNERS PROPERLY
        stores = db.query(Store).options(
            joinedload(Store.partners)
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

                # =========================================
                # DEBUG LOGS
                # =========================================
                print(f"""
==================================================
STORE NAME           : {store.store_name}
STORE ID             : {store.id}

AUTO ENABLED         : {store.auto_order_enabled}
CHANNEL              : {store.channel}

MANAGER ID           : {store.assigned_manager_id}

PARTNERS COUNT       : {len(store.partners) if store.partners else 0}

PER DAY CONSUMPTION  : {store.per_day_consumption}

LAST ORDER DATE      : {store.last_order_date}

IS ORDER DAY         : {is_order_day(store)}
==================================================
""")

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

                # ✅ CREATE ORDER
                print(f"🚀 Creating order for {store.id}")

                create_auto_order(store, db)

                success_count += 1

                print(f"✅ SUCCESS → {store.id}")

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