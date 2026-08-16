import pandas as pd

from backend.database.db import SessionLocal
from backend.models.store import Store
from backend.models.order import Order

db = SessionLocal()

EXCEL_FILE = "/app/ZEPTO PAN INDIA PROJECT CODE.xlsx"

df = pd.read_excel(EXCEL_FILE)
df.columns = df.columns.str.strip()

print(df.columns.tolist())  

# Adjust these names if sheet headers differ
STORE_CODE_COL = "STORE CODE"
STORE_NAME_COL = "Store Name"
CITY_COL = "CITY"
STATE_COL = "State"
REGION_COL = "Zone"          # Zone -> Region
PROJECT_COL = "Project Code"

df = df.fillna("")

sheet_codes = set(
    df[STORE_CODE_COL]
    .astype(str)
    .str.strip()
)

sheet_lookup = {}

for _, row in df.iterrows():
    code = str(row[STORE_CODE_COL]).strip()

    sheet_lookup[code] = {
        "store_name": str(row.get(STORE_NAME_COL, "")).strip(),
        "city": str(row.get(CITY_COL, "")).strip(),
        "state": str(row.get(STATE_COL, "")).strip(),
        "region": str(row.get(REGION_COL, "")).strip(),
        "project_code": str(row.get(PROJECT_COL, "")).strip(),
    }

zepto_stores = (
    db.query(Store)
    .filter(Store.channel == "ZEPTO")
    .all()
)

db_codes = {str(s.id).strip() for s in zepto_stores}

to_create = sheet_codes - db_codes
to_delete = db_codes - sheet_codes
to_update = sheet_codes.intersection(db_codes)

print("\n========================")
print("ZEPTO MASTER EXECUTION")
print("========================")

print(f"Sheet Stores : {len(sheet_codes)}")
print(f"DB Zepto     : {len(db_codes)}")
print(f"Update       : {len(to_update)}")
print(f"Create       : {len(to_create)}")
print(f"Delete       : {len(to_delete)}")

created = 0
updated = 0
deleted = 0

# ------------------
# UPDATE EXISTING
# ------------------

for store in zepto_stores:

    code = str(store.id).strip()

    if code not in to_update:
        continue

    sheet_row = sheet_lookup[code]

    if sheet_row["store_name"]:
        store.store_name = sheet_row["store_name"]

    store.city = sheet_row["city"]
    store.state = sheet_row["state"]

    # New fields
    store.region = sheet_row["region"]
    store.project_code = sheet_row["project_code"]

    updated += 1

# ------------------
# CREATE NEW
# ------------------

for code in to_create:

    row = sheet_lookup[code]

    new_store = Store(
        id=code,
        store_name=row["store_name"] or code,
        city=row["city"],
        state=row["state"],
        region=row["region"],
        project_code=row["project_code"],
        channel="ZEPTO"
    )

    db.add(new_store)
    created += 1

# ------------------
# DELETE EXTRA ZEPTO
# ------------------

for store in zepto_stores:

    code = str(store.id).strip()

    if code not in to_delete:
        continue

    db.query(Order).filter(
        Order.store_id == store.id
    ).delete(synchronize_session=False)

    db.delete(store)

    deleted += 1

db.commit()

print("\n========================")
print("SYNC COMPLETED")
print("========================")

print(f"Created : {created}")
print(f"Updated : {updated}")
print(f"Deleted : {deleted}")

db.close()