from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, load_only
from typing import List

from ..database.db import get_db
from ..models.employee_store_mapping import EmployeeStoreMapping
from ..models.store import Store
from ..models.user import User, RoleEnum
from ..schemas.store import (
    StoreCreate,
    StoreOut,
    StoreStatusUpdate,
    StoreUpdate,
    StoreDeliverySummary
)
from ..utils.jwt import get_current_user
from ..utils.permissions import (
    filter_query_by_employee_stores,
    get_employee_store_ids,
    require_permission
)
from backend.utils.auto_order import validate_store_for_auto_order
from sqlalchemy.orm import joinedload

from sqlalchemy import func, extract
from datetime import datetime, timedelta

from ..models.order import Order

from ..schemas.store import (
    StoreCreate,
    StoreOut,
    StoreUpdate,
    StoreDeliverySummary
)


# Helper function to check super admin
def super_admin_required(current_user: User = Depends(get_current_user)):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )
    return current_user


def employee_permission_required(
    permission_key: str,
    current_user: User,
    db: Session
):
    if current_user.role == RoleEnum.employee:
        require_permission(permission_key)(
            current_user=current_user,
            db=db
        )


def employee_store_access_required(
    store_id: str,
    current_user: User,
    db: Session
):
    if current_user.role != RoleEnum.employee:
        return

    assigned_store_ids = get_employee_store_ids(
        current_user.id,
        db=db
    )

    if store_id not in assigned_store_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Store not assigned to you."
        )


def store_access_required(
    store: Store,
    current_user: User,
    db: Session
):
    if current_user.role in [RoleEnum.superadmin, RoleEnum.admin]:
        return

    if current_user.role == RoleEnum.employee:
        employee_store_access_required(store.id, current_user, db)
        return

    if current_user.role == RoleEnum.delivery_manager:
        if store.assigned_manager_id == current_user.id:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Store not assigned to you."
        )

    if current_user.role == RoleEnum.partner:
        if any(partner.id == current_user.id for partner in store.partners):
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Store not assigned to you."
        )

    if current_user.role == RoleEnum.channel_admin:
        if (store.channel or "").upper() == (current_user.channel or "").upper():
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Store not assigned to your channel."
        )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Not authorized to access this store."
    )


# The prefix is correct for the main router: /store
router = APIRouter(prefix="/store", tags=["Store"])
status_router = APIRouter(prefix="/stores", tags=["Store"])


# ✅ Create Store
@router.post("/create", response_model=StoreOut, status_code=status.HTTP_201_CREATED)
def create_store(
    store: StoreCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new store (only Super Admin).
    Allows manual Store ID entry from frontend.
    """

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.create",
            current_user,
            db
        )
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )

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
        is_active=store.is_active,
    )

    db.add(new_store)
    if current_user.role == RoleEnum.employee:
        db.add(
            EmployeeStoreMapping(
                employee_id=current_user.id,
                store_id=new_store.id,
                assigned_by=current_user.id
            )
        )
    db.commit()
    db.refresh(new_store)

    return new_store



# ⭐ FIX: Renamed /list to /list/all to match frontend call, ensuring Super Admin authentication.
@router.get("/list/all")
def get_all_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns all stores across all channels
    with Delivery Manager details.
    """

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )
        stores_query = filter_query_by_employee_stores(
            db.query(Store),
            current_user
        )
    else:
        if current_user.role != RoleEnum.superadmin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only a super admin can perform this action."
            )
        stores_query = db.query(Store)

    if current_user.role == RoleEnum.employee:
        stores_query = stores_query.filter(Store.is_active.is_(True))

    stores = (
        stores_query
        .options(
            load_only(
                Store.id,
                Store.store_name,
                Store.address,
                Store.city,
                Store.state,
                Store.region,
                Store.zip_code,
                Store.latitude,
                Store.longitude,
                Store.channel,
                Store.entity,
                Store.is_active,
                Store.auto_order_enabled,
                Store.order_frequency_days,
                Store.monthly_cap,
                Store.assigned_manager_id,
            ),
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

            "region": store.region,

            "zip_code": store.zip_code,

            "latitude": store.latitude,

            "longitude": store.longitude,

            "channel": store.channel,

            "entity": store.entity,

            "is_active": store.is_active,

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
def get_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns all stores (open for partners/superadmin).
    """
    stores_query = db.query(Store)

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )
        stores_query = filter_query_by_employee_stores(
            stores_query,
            current_user
        )

    if current_user.role not in [RoleEnum.superadmin, RoleEnum.admin]:
        stores_query = stores_query.filter(Store.is_active.is_(True))

    stores = stores_query.all()
    return stores


# ✅ Get Store by ID


# ✅ Update Store
@router.patch("/update/{store_id}", response_model=StoreOut)
def update_store(
    store_id: str,   # 🔥 FIX: string hona chahiye (tera model string hai)
    store_update: StoreUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.edit",
            current_user,
            db
        )
        employee_store_access_required(
            store_id,
            current_user,
            db
        )
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )

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
@status_router.patch("/{store_id}/status", response_model=StoreOut)
def update_store_status(
    store_id: str,
    payload: StoreStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required),
):
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found.",
        )

    store.is_active = payload.is_active
    db.commit()
    db.refresh(store)
    return store


@router.delete("/{store_id}/delete", status_code=status.HTTP_200_OK)
def delete_store(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a store (only Super Admin).
    """
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.delete",
            current_user,
            db
        )
        employee_store_access_required(
            store_id,
            current_user,
            db
        )
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Store deletion is disabled. Use Active/Inactive instead."
    )


@router.patch("/{store_id}/auto-order")
def update_auto_order(
    store_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.edit",
            current_user,
            db
        )
        employee_store_access_required(
            store_id,
            current_user,
            db
        )
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )

    store = db.query(Store).filter(Store.id == store_id).first()

    if not store:
        raise HTTPException(404, "Store not found")

    # 🔥 VALIDATION BEFORE ENABLE
    if "is_active" in payload:
        raise HTTPException(
            status_code=400,
            detail="Use the store status endpoint to change is_active.",
        )

    if payload.get("auto_order_enabled") == True:
        valid, msg = validate_store_for_auto_order(store)
        if not valid:
            raise HTTPException(400, msg)

    for key, value in payload.items():
        setattr(store, key, value)

    db.commit()
    db.refresh(store)

    return store


@router.get(
    "/store-delivery-summary",
    response_model=List[StoreDeliverySummary]
)
def get_store_delivery_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    # ✅ ONLY DELIVERY MANAGER
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )
    elif current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers allowed."
        )

    # ✅ DATE CALCULATIONS
    today = datetime.utcnow()

    month_start = today.replace(day=1)

    week_start = today - timedelta(days=7)

    # ✅ FETCH ONLY ASSIGNED STORES
    stores_query = db.query(Store)

    if current_user.role == RoleEnum.employee:
        stores_query = filter_query_by_employee_stores(
            stores_query,
            current_user
        )
    else:
        stores_query = stores_query.filter(
            Store.assigned_manager_id
            == current_user.id
        )

    stores = stores_query.filter(Store.is_active.is_(True)).all()

    result = []

    for store in stores:

        # ✅ MONTH DELIVERED
        month_delivered = (
            db.query(
                func.sum(Order.bottles_delivered)
            )
            .filter(
                Order.store_id == store.id,

                Order.status.in_([
                    "delivered_confirmed",
                    "delivered_pending_confirmation"
                ]),

                Order.updated_at >= month_start
            )
            .scalar()
        ) or 0

        # ✅ WEEK DELIVERED
        week_delivered = (
            db.query(
                func.sum(Order.bottles_delivered)
            )
            .filter(
                Order.store_id == store.id,

                Order.status.in_([
                    "delivered_confirmed",
                    "delivered_pending_confirmation"
                ]),

                Order.updated_at >= week_start
            )
            .scalar()
        ) or 0

        # ✅ TOTAL ORDERS
        total_orders = (
            db.query(Order)
            .filter(
                Order.store_id == store.id
            )
            .count()
        )

        # ✅ LAST DELIVERY
        last_order = (
            db.query(Order)
            .filter(
                Order.store_id == store.id
            )
            .order_by(
                Order.updated_at.desc()
            )
            .first()
        )

        # ✅ FINAL RESPONSE
        result.append({

            "store_id": store.id,

            "store_name": store.store_name,

            "city": store.city,

            "state": store.state,

            "channel": store.channel,

            "is_active": store.is_active,

            "month_delivered_bottles":
                month_delivered,

            "week_delivered_bottles":
                week_delivered,

            "total_orders":
                total_orders,

            "last_delivery_date":
                last_order.updated_at
                if last_order else None
        })

    return result

# ✅ DELIVERY MANAGER MY STORES
@router.get(
    "/my-stores",
    response_model=List[StoreOut]
)
def get_my_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    # ✅ ONLY DELIVERY MANAGER
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )
    elif current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers allowed."
        )

    # ✅ FETCH ONLY ASSIGNED STORES
    stores_query = (
        db.query(Store)
        .options(
            joinedload(Store.assigned_manager)
        )
    )

    if current_user.role == RoleEnum.employee:
        stores_query = filter_query_by_employee_stores(
            stores_query,
            current_user
        )
    else:
        stores_query = stores_query.filter(
            Store.assigned_manager_id
            == current_user.id
        )

    stores = stores_query.filter(Store.is_active.is_(True)).all()

    return stores


@router.get("/{store_id}", response_model=StoreOut)
def get_store_by_id(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )

    store = (
        db.query(Store)
        .options(joinedload(Store.partners))
        .filter(Store.id == store_id)
        .first()
    )
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found."
        )

    if (
        current_user.role not in [RoleEnum.superadmin, RoleEnum.admin]
        and not store.is_active
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found.",
        )

    store_access_required(store, current_user, db)
    return store


@router.get("/store/{store_id}/analytics")
def get_store_analytics(
    store_id: str,
    month: int,
    year: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )

    # Verify store exists
    store = (
        db.query(Store)
        .options(joinedload(Store.partners))
        .filter(Store.id == store_id)
        .first()
    )

    if not store:
        raise HTTPException(
            status_code=404,
            detail="Store not found"
        )

    store_access_required(store, current_user, db)

    # MONTHLY BOTTLES
    monthly_bottles = (
        db.query(
            func.sum(Order.bottles_delivered)
        )
        .filter(
            Order.store_id == store_id,

            Order.status.in_([
                "delivered_confirmed",
                "delivered_pending_confirmation"
            ]),

            extract("month", Order.order_date) == month,
            extract("year", Order.order_date) == year
        )
        .scalar()
    ) or 0

    # TOTAL ORDERS OF MONTH
    total_orders = (
        db.query(Order)
        .filter(
            Order.store_id == store_id,

            extract("month", Order.order_date) == month,
            extract("year", Order.order_date) == year
        )
        .count()
    )

    # WEEKLY BOTTLES (currently same logic as monthly in your code)
    weekly_bottles = (
        db.query(
            func.sum(Order.bottles_delivered)
        )
        .filter(
            Order.store_id == store_id,

            Order.status.in_([
                "delivered_confirmed",
                "delivered_pending_confirmation"
            ]),

            extract("month", Order.order_date) == month,
            extract("year", Order.order_date) == year
        )
        .scalar()
    ) or 0

    return {
        "store_id": store_id,
        "month": month,
        "year": year,
        "monthly": monthly_bottles,
        "weekly": weekly_bottles,
        "orders": total_orders
    }
