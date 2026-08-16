from backend.database.db import SessionLocal
from backend.models.store import Store
from backend.models.user import User, RoleEnum
from backend.models.partner_store import PartnerStore
from backend.utils.auth import hash_password

import pandas as pd
import re
import random


db = SessionLocal()

EXCEL_FILE = "/app/blinkit poc update sheet.xlsx"

df = pd.read_excel(EXCEL_FILE)
df = df.fillna("")

SUPERADMIN_ID = 1
DEFAULT_PASSWORD = "Blinkit@123"

sheet_lookup = {
    str(row["Outlet ID"]).strip(): row
    for _, row in df.iterrows()
}

all_blinkit = (
    db.query(Store)
    .filter(Store.channel == "BLINKIT")
    .all()
)

created_users = 0
created_mappings = 0
skipped_no_poc = 0
skipped_existing_mapping = 0
missing_in_sheet = 0
failed = 0


def make_email(store_name, suffix=0):
    match = re.search(r"([A-Z]{2,3}\d+)$", str(store_name).upper())

    if match:
        base = match.group(1).lower()
    else:
        cleaned = re.sub(r"[^a-zA-Z0-9]", "", str(store_name))
        base = cleaned[:20].lower()

    if suffix:
        return f"{base}{suffix}@blinkit.com"

    return f"{base}@blinkit.com"

def make_dummy_mobile():
    while True:
        mobile = str(random.randint(6000000000, 9999999999))

        exists = (
            db.query(User)
            .filter(User.mobile_number == mobile)
            .first()
        )

        if not exists:
            return mobile


print("\n" + "=" * 60)
print("BLINKIT BULK PARTNER CREATE")
print("=" * 60)

for store in all_blinkit:
    try:
        existing_mapping = (
            db.query(PartnerStore)
            .filter(PartnerStore.store_id == str(store.id))
            .first()
        )

        if existing_mapping:
            skipped_existing_mapping += 1
            continue

        row = sheet_lookup.get(str(store.id))

        if row is None:
            missing_in_sheet += 1
            print(f"MISSING SHEET -> {store.id}")
            continue

        poc_name = str(row["POC Name"]).strip()
        mobile = str(row["POC Contact no"]).strip()


        if (
            not poc_name
            or poc_name.strip().lower() in ["na", "n/a", "not assigned", ""]
        ):
            poc_name = f"Blinkit Partner {store.id}"

# Clean mobile
        mobile = re.sub(r"\D", "", mobile)

# Invalid or missing mobile -> generate unique dummy
        if len(mobile) != 10:
            mobile = make_dummy_mobile()

# Duplicate mobile -> generate unique dummy
        while db.query(User).filter(User.mobile_number == mobile).first():
            mobile = make_dummy_mobile()

        email = make_email(store.store_name)

        counter = 1

        while db.query(User).filter(User.email == email).first():
            email = make_email(store.store_name, counter)
            counter += 1

        partner = User(
            full_name=poc_name,
            email=email,
            password=hash_password(DEFAULT_PASSWORD),
            mobile_number=mobile,
            role=RoleEnum.partner,
            status="active",
            parent_id=SUPERADMIN_ID,
            channel="BLINKIT",
        )

        db.add(partner)
        db.flush()

        mapping = PartnerStore(
            user_id=partner.id,
            store_id=str(store.id),
        )

        db.add(mapping)
        db.commit()

        created_users += 1
        created_mappings += 1

        print(
            f"CREATED -> "
            f"{store.id} | "
            f"{email} | "
            f"{poc_name}"
        )

    except Exception as e:
        db.rollback()

        failed += 1

        print(
            f"FAILED -> "
            f"{store.id} | "
            f"{str(e)}"
        )

print("\n" + "=" * 60)
print("FINAL RESULT")
print("=" * 60)

print(f"Created Users           : {created_users}")
print(f"Created Mappings        : {created_mappings}")
print(f"Skipped Existing Map    : {skipped_existing_mapping}")
print(f"Skipped No POC          : {skipped_no_poc}")
print(f"Missing In Sheet        : {missing_in_sheet}")
print(f"Failed                  : {failed}")

db.close()

