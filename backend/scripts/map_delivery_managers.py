import pandas as pd
from backend.database.db import SessionLocal
from backend.models.user import User
from backend.models.store import Store

db = SessionLocal()

df = pd.read_excel("delivery manager list.xlsx")

for _, row in df.iterrows():

    email = row["email"]
    name = row["full_name"]
    phone = str(row["mobile_number"])
    store_id = row["store_id"]

    # ❌ SKIP invalid email
    if pd.isna(email) or str(email).strip() == "":
        print(f"⚠️ Skipping row (invalid email): {row}")
        continue

    # 1. Check user
    user = db.query(User).filter(
        User.email == email,
        User.channel == "ZEPTO"
    ).first()

    if not user:
        user = User(
            full_name=name,
            email=email,
            mobile_number=phone,
            password="123456",
            role="delivery_manager",
            channel="ZEPTO"
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"✅ Created user: {email}")

    # 2. Check store
    store = db.query(Store).filter(
        Store.id == store_id,
        Store.channel == "ZEPTO"
    ).first()

    if not store:
        print(f"❌ Store not found or not ZEPTO: {store_id}")
        continue

    # 3. Assign store
    if store not in user.stores:
        user.stores.append(store)
        db.commit()
        print(f"🔗 Mapped {store_id} → {email}")
    else:
        print(f"⚠️ Already mapped: {store_id}")

db.close()
print("🚀 DONE")