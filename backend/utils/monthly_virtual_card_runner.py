from datetime import datetime

import pytz

from backend.database.db import SessionLocal
from backend.services.monthly_virtual_card import ensure_monthly_cards_for_active_stores


IST = pytz.timezone("Asia/Kolkata")


def run_monthly_virtual_card_generation() -> None:
    now_ist = datetime.now(IST)
    year = now_ist.year
    month = now_ist.month
    db = None

    print(
        f"Monthly virtual card generation started: "
        f"year={year}, month={month}"
    )

    try:
        db = SessionLocal()
        summary = ensure_monthly_cards_for_active_stores(db, year, month)
        db.commit()
        print(
            "Monthly virtual card generation completed: "
            f"year={year}, month={month}, "
            f"total_active_stores={summary['total_active_stores']}, "
            f"created_count={summary['created_count']}, "
            f"existing_count={summary['existing_count']}"
        )
    except Exception as exc:
        if db is not None:
            db.rollback()
        print(
            "Monthly virtual card generation failed: "
            f"year={year}, month={month}, error={str(exc)}"
        )
    finally:
        if db is not None:
            db.close()
