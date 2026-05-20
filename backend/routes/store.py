from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..database.db import get_db
from ..models.store import Store
from ..models.user import User, RoleEnum
from ..schemas.store import StoreCreate, StoreOut, StoreUpdate
from ..utils.jwt import get_current_user
from backend.utils.auto_order import validate_store_for_auto_order
from sqlalchemy.orm import joinedload


# Helper function to check super admin
def super_admin_required(current_user: User = Depends(get_current_user)):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )
    return current_user


# The prefix is correct for the main router: /store
router = APIRouter(prefix="/store", tags=["Store"])


# ✅ Create Store
@router.post("/create", response_model=StoreOut, status_code=status.HTTP_201_CREATED)
def create_store(
    store: StoreCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Create a new store (only Super Admin).
    Allows manual Store ID entry from frontend.
    """

    # 🔒 1. Prevent duplicate STORE ID
    existing_id = db.query(Store).filter(Store.id == store.id).first()
    if existing_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Store ID {store.id} already exists."
        )

    # 🔒 2. Prevent duplicate STORE NAME
    existing_name = db.query(Store).filter(Store.store_name == store.store_name).first()
    if existing_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Store with this name already exists."
        )

    # ✅ 3. Normalize channel
    channel_to_save = store.channel.upper() if store.channel else "GENERAL"

    # ⭐ 4. CREATE STORE WITH MANUAL ID ⭐
    new_store = Store(
        id=store.id,                     # ⭐ THIS IS THE KEY LINE
        store_name=store.store_name,
        address=store.address,
        city=store.city,
        state=store.state,
        zip_code=store.zip_code,
        latitude=store.latitude,
        longitude=store.longitude,
        channel=channel_to_save,
    )

    db.add(new_store)
    db.commit()
    db.refresh(new_store)

    return new_store



# ⭐ FIX: Renamed /list to /list/all to match frontend call, ensuring Super Admin authentication.
@router.get("/list/all")
def get_all_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Returns all stores across all channels
    with Delivery Manager details.
    """

    stores = (
        db.query(Store)
        .options(
            joinedload(Store.assigned_manager)
        )
        .all()
    )

    response = []

    for store in stores:

        response.append({

            "id": store.id,

            "store_name": store.store_name,

            "address": store.address,

            "city": store.city,

            "state": store.state,

            "zip_code": store.zip_code,

            "latitude": store.latitude,

            "longitude": store.longitude,

            "channel": store.channel,

            "auto_order_enabled":
            store.auto_order_enabled,

            "order_frequency_days":
            store.order_frequency_days,

            "monthly_cap":
            store.monthly_cap,

            # ✅ DELIVERY MANAGER
            "assigned_manager": (
                store.assigned_manager.full_name
                if store.assigned_manager
                else None
            ),

            "assigned_manager_id":
            store.assigned_manager_id
        })

    return response


# ✅ Get Stores (Renamed route to avoid confusion, keeping /list functionality)
@router.get("/list", response_model=List[StoreOut])
def get_stores(db: Session = Depends(get_db)):
    """
    Returns all stores (open for partners/superadmin).
    """
    stores = db.query(Store).all()
    return stores


# ✅ Get Store by ID
@router.get("/{store_id}", response_model=StoreOut)
def get_store_by_id(store_id: str, db: Session = Depends(get_db)):
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found."
        )
    return store


# ✅ Update Store
@router.patch("/update/{store_id}", response_model=StoreOut)
def update_store(
    store_id: str,   # 🔥 FIX: string hona chahiye (tera model string hai)
    store_update: StoreUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    store_to_update = db.query(Store).filter(Store.id == store_id).first()

    if not store_to_update:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found."
        )

    update_data = store_update.model_dump(exclude_unset=True)

    # 🔥 VALIDATION ONLY WHEN ENABLING AUTO ORDER
    if update_data.get("auto_order_enabled") == True:
        valid, msg = validate_store_for_auto_order(store_to_update)
        if not valid:
            raise HTTPException(400, msg)

    # 🔥 APPLY UPDATE
    for key, value in update_data.items():
        setattr(store_to_update, key, value)

    db.commit()
    db.refresh(store_to_update)

    return store_to_update

# ✅ Delete Store
@router.delete("/{store_id}/delete", status_code=status.HTTP_200_OK)
def delete_store(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Delete a store (only Super Admin).
    """
    store_to_delete = db.query(Store).filter(Store.id == store_id).first()
    if not store_to_delete:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found."
        )

    db.delete(store_to_delete)
    db.commit()
    return {"message": "Store deleted successfully."}


@router.patch("/{store_id}/auto-order")
def update_auto_order(
    store_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    store = db.query(Store).filter(Store.id == store_id).first()

    if not store:
        raise HTTPException(404, "Store not found")

    # 🔥 VALIDATION BEFORE ENABLE
    if payload.get("auto_order_enabled") == True:
        valid, msg = validate_store_for_auto_order(store)
        if not valid:
            raise HTTPException(400, msg)

    for key, value in payload.items():
        setattr(store, key, value)

    db.commit()
    db.refresh(store)

    return store