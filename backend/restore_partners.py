"""
restore_partners.py

Bulk-create partners from Blinkit CSV and assign them to stores.

Usage on Fly machine (from /app):

    PYTHONPATH=/app python3 backend/restore_partners.py
"""

import csv
from pathlib import Path

from backend.database.db import SessionLocal
from backend.models.user import User, RoleEnum
from backend.models.store import Store
from backend.models.partner_store import PartnerStore
from backend.utils.auth import hash_password


# ======= CONFIG: adjust if your paths / headers differ =======

CSV_PATH = Path("backend/data/blinkit_partners.csv")

# Column names in the CSV
COL_OUTLET_NAME = "Outlet Name"   # must match stores.store_name
COL_STORE_ID = "Store ID"         # will become login email
COL_PASSWORD = "Pswd"             # plain text password
COL_STORE_MANAGER = "Store Ma"    # partner full_name
COL_MOBILE = "Number"             # partner mobile number

DEFAULT_PASSWORD = "bs002"        # used if Pswd column empty
# =============================================================


def main():
    if not CSV_PATH.exists():
        raise SystemExit(f"CSV file not found at: {CSV_PATH}")

    db = SessionLocal()

    # Get a superadmin to use as parent_id
    superadmin = db.query(User).filter(User.role == RoleEnum.superadmin).first()
    if not superadmin:
        raise SystemExit("No superadmin user found in database. Create one first.")

    created_users = 0
    linked_stores = 0
    skipped_rows = 0

    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        row_number = 1  # header is row 1
        for row in reader:
            row_number += 1

            outlet_name = (row.get(COL_OUTLET_NAME) or "").strip()
            store_email = (row.get(COL_STORE_ID) or "").strip()
            password_raw = (row.get(COL_PASSWORD) or "").strip() or DEFAULT_PASSWORD
            manager_name = (row.get(COL_STORE_MANAGER) or "").strip()
            mobile_number = (row.get(COL_MOBILE) or "").strip()

            # Basic validation
            if not outlet_name or not store_email:
                print(
                    f"[ROW {row_number}] Skipped: missing Outlet Name or Store ID "
                    f"(Outlet Name='{outlet_name}', Store ID='{store_email}')"
                )
                skipped_rows += 1
                continue

            # Find store by name
            store = (
                db.query(Store)
                .filter(Store.store_name == outlet_name)
                .first()
            )
            if not store:
                print(
                    f"[ROW {row_number}] Skipped: store not found in DB "
                    f"for Outlet Name='{outlet_name}'"
                )
                skipped_rows += 1
                continue

            email = store_email.lower()

            # Check if partner (user) already exists
            user = db.query(User).filter(User.email == email).first()
            if user:
                # Optionally update name/mobile if empty or different
                updated = False
                if manager_name and user.full_name != manager_name:
                    user.full_name = manager_name
                    updated = True
                if mobile_number and user.mobile_number != mobile_number:
                    user.mobile_number = mobile_number
                    updated = True
                if user.role != RoleEnum.partner:
                    user.role = RoleEnum.partner
                    updated = True
                if updated:
                    print(f"[ROW {row_number}] Updated existing user {email}")
            else:
                # Create new partner user
                user = User(
                    full_name=manager_name or outlet_name,
                    email=email,
                    password=hash_password(password_raw),
                    mobile_number=mobile_number,
                    role=RoleEnum.partner,
                    status="active",
                    parent_id=superadmin.id,
                )
                db.add(user)
                db.flush()  # get user.id
                created_users += 1
                print(f"[ROW {row_number}] Created partner user {email}")

            # Link user to store in PartnerStore (if not already linked)
            existing_link = (
                db.query(PartnerStore)
                .filter(
                    PartnerStore.user_id == user.id,
                    PartnerStore.store_id == store.id,
                )
                .first()
            )

            if not existing_link:
                db.add(PartnerStore(user_id=user.id, store_id=store.id))
                linked_stores += 1
                print(
                    f"[ROW {row_number}] Linked {email} -> store '{store.store_name}' (id={store.id})"
                )
            else:
                print(
                    f"[ROW {row_number}] Link already exists for {email} -> '{store.store_name}'"
                )

    db.commit()
    db.close()

    print("\n=== DONE ===")
    print(f"New partner users created : {created_users}")
    print(f"Store links created       : {linked_stores}")
    print(f"Rows skipped              : {skipped_rows}")


if __name__ == "__main__":
    main()
