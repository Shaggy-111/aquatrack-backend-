from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import date
from datetime import datetime, timedelta
from sqlalchemy import or_

# --- (NEW IMPORTS) ---
from fastapi import UploadFile, File, Form
import shutil
import os
# --- (END NEW IMPORTS) ---


from ..schemas.store import AssignStoresRequest

from ..database.db import get_db
from ..models.user import User, RoleEnum
from ..models.store import Store
from ..models.partner_store import PartnerStore
from ..models.order import Order, OrderStatusEnum
from ..schemas.user import UserOut, DeliveryManagerCreate
from ..schemas.order import OrderOut, OrderCreate
from ..schemas.store import StoreOut
from ..utils.auth import hash_password
from ..utils.jwt import get_current_user
from ..utils.store_status import require_active_store, require_active_store_before_commit
from ..services.order_delivery import (
    apply_delivery_confirmation,
    apply_delivery_update,
)
from ..services.monthly_virtual_card import (
    MonthlyVirtualCardDomainError,
    sync_order_to_monthly_virtual_card,
)



# The router prefix is set to "/partners"
router = APIRouter(prefix="/partners", tags=["Partners"])

# --- (NEW) ---
# Create a directory to store photo proofs
UPLOADS_DIR = "uploads"
os.makedirs(UPLOADS_DIR, exist_ok=True)
# --- (END NEW) ---


def _remove_new_local_photo(filepath: Optional[str]) -> None:
    if not filepath:
        return
    try:
        if os.path.isfile(filepath):
            os.remove(filepath)
    except OSError:
        pass

# ---------------------------
# Schemas
# ---------------------------
class PartnerCreateRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    mobile_number: str
    stores: List[str] = Field(..., description="List of store IDs to assign to the partner")
    # Assuming 'channel' is sent here by the Super Admin form
    channel: Optional[str] = None 

class PartnerUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    mobile_number: Optional[str] = None
    stores: Optional[List[str]] = None # Pass the new list of store IDs

class OrderStatusUpdateRequest(BaseModel):
    status: OrderStatusEnum

class ManagerUpdateRequest(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None

class PartnerConfirmRequest(BaseModel):
    confirmed_bottles: Optional[int] = None
    confirmed_empty_bottles: Optional[int] = None 
    confirmation_remarks: Optional[str] = None

class ChannelAdminCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    channel: str  # BLINKIT / ZEPTO / IBM / GENERAL


class UpdateManagerStoresRequest(BaseModel):
    store_ids: List[str]


# Helper function to check super admin
def super_admin_required(current_user: User = Depends(get_current_user)):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a super admin can perform this action.")
    return current_user



@router.post("/superadmin/managers/{manager_id}/stores/add")
def add_stores_to_manager(
    manager_id: int,
    payload: UpdateManagerStoresRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    # 1️⃣ Validate manager
    manager = db.query(User).filter(
        User.id == manager_id,
        User.role == RoleEnum.delivery_manager
    ).first()

    if not manager:
        raise HTTPException(status_code=404, detail="Delivery Manager not found")

    # 2️⃣ Validate payload
    if not payload.store_ids:
        raise HTTPException(status_code=400, detail="store_ids cannot be empty")

    # IMPORTANT: DO NOT cast to int (supports Zepto / alphanumeric IDs)
    store_ids = payload.store_ids

    # 3️⃣ Fetch all requested stores
    stores = db.query(Store).filter(Store.id.in_(store_ids)).with_for_update().all()

    # 4️⃣ Ensure ALL stores exist (no partial assignment)
    if len(stores) != len(store_ids):
        found_ids = {str(s.id) for s in stores}
        missing = [sid for sid in store_ids if str(sid) not in found_ids]
        raise HTTPException(
            status_code=404,
            detail=f"Store(s) not found: {missing}"
        )

    # 5️⃣ Ensure ALL stores are FREE
    for store in stores:
        if store.assigned_manager_id is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Store '{store.store_name}' is not free"
            )

    # 6️⃣ Assign stores
    for store in stores:
        store.assigned_manager_id = manager_id

    # 7️⃣ Commit atomically
    db.commit()

    return {
        "message": "Stores added to Delivery Manager successfully",
        "manager_id": manager_id,
        "added_store_ids": store_ids
    }


@router.post("/superadmin/managers/{manager_id}/stores/remove")
def remove_stores_from_manager(
    manager_id: int,
    payload: UpdateManagerStoresRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    manager = db.query(User).filter(
        User.id == manager_id,
        User.role == RoleEnum.delivery_manager
    ).first()

    if not manager:
        raise HTTPException(status_code=404, detail="Delivery Manager not found")

    # ✅ DO NOT CAST TO INT — support alphanumeric IDs
    store_ids = payload.store_ids

    stores = db.query(Store).filter(
        Store.id.in_(store_ids),
        Store.assigned_manager_id == manager_id
    ).all()

    if not stores:
        raise HTTPException(status_code=400, detail="No matching stores found for this manager")

    for store in stores:
        store.assigned_manager_id = None

    db.commit()

    return {
        "message": "Stores removed successfully",
        "manager_id": manager_id,
        "removed_store_ids": store_ids
    }

@router.post("/superadmin/create-channel-admin")
def create_channel_admin(
    data: ChannelAdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only a superadmin can perform this action.")

    # Check duplicate email
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered.")

    hashed = hash_password(data.password)

    new_admin = User(
        full_name=data.full_name,
        email=data.email,
        password=hashed,
        role=RoleEnum.channel_admin,    # IMPORTANT
        channel=data.channel.upper() if data.channel else None, # Store channel uppercase
        status="active"
    )

    db.add(new_admin)
    db.commit()
    db.refresh(new_admin)

    return {"message": "Channel Admin created successfully", "user_id": new_admin.id}


# ---------------------------
# Superadmin: Create Partner
# ---------------------------
@router.post("/superadmin/create", status_code=status.HTTP_201_CREATED)
def create_partner(
    request: PartnerCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only a super admin can perform this action.")

    existing_user = db.query(User).filter(
         User.email == request.email 
    ).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email  already registered.")

    hashed_pwd = hash_password(request.password)

    new_partner = User(
        full_name=request.full_name,
        email=request.email,
        password=hashed_pwd,
        mobile_number=request.mobile_number,
        role=RoleEnum.partner,
        status="active",
        parent_id=current_user.id,
        # Ensure channel is saved here
        channel=request.channel.upper() if request.channel else None 
    )
    db.add(new_partner)
    db.commit()
    db.refresh(new_partner)

    for store_id in request.stores:
        store = db.query(Store).filter(Store.id == store_id).first()
        if not store:
            raise HTTPException(status_code=404, detail=f"Store with ID {store_id} not found.")
        db.add(PartnerStore(user_id=new_partner.id, store_id=store_id))

    db.commit()
    return {"message": "Partner created and stores assigned successfully.", "partner_id": new_partner.id}

@router.put("/superadmin/update/{partner_id}", response_model=UserOut)
def update_partner(
    partner_id: int,
    request: PartnerUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only a super admin can perform this action.")

    partner = db.query(User).filter(User.id == partner_id, User.role == RoleEnum.partner).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found.")

    try:
        # Check for email/mobile conflicts if they are being changed
        if request.email and request.email != partner.email:
            existing = db.query(User).filter(User.email == request.email, User.id != partner_id).first()
            if existing:
                raise HTTPException(status_code=400, detail="Email already registered by another user.")
            partner.email = request.email

        if request.mobile_number and request.mobile_number != partner.mobile_number:
            existing = db.query(User).filter(User.mobile_number == request.mobile_number, User.id != partner_id).first()
            if existing:
                raise HTTPException(status_code=400, detail="Mobile number already registered by another user.")
            partner.mobile_number = request.mobile_number
        
        if request.full_name:
            partner.full_name = request.full_name

        # Update stores if a new list is provided
        if request.stores is not None:
            # 1. Delete old store associations
            db.query(PartnerStore).filter(PartnerStore.user_id == partner_id).delete()
            
            # 2. Add new store associations
            for store_id in request.stores:
                store = db.query(Store).filter(Store.id == store_id).first()
                if not store:
                    # Rollback EVERYTHING if one store is wrong
                    db.rollback()
                    raise HTTPException(status_code=404, detail=f"Store with ID {store_id} not found.")
                
                db.add(PartnerStore(user_id=partner.id, store_id=store_id))

        db.commit()
        db.refresh(partner)
        return partner

    except HTTPException as he:
        raise he
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


# --- [NEW ADDITION] Superadmin: Delete Partner ---
@router.delete("/superadmin/delete/{partner_id}", status_code=status.HTTP_200_OK)
def delete_partner(
    partner_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only a super admin can perform this action.")

    partner = db.query(User).filter(User.id == partner_id, User.role == RoleEnum.partner).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found.")

    # 3. ADD THIS CHECK FOR ORDERS
    order_count = db.query(Order).filter(Order.partner_id == partner_id).count()
    if order_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, # 409 Conflict
            detail=f"Cannot delete partner. They are associated with {order_count} order(s). Please reassign or delete those orders first."
        )
    # --- END OF NEW CHECK ---

    # 1. Delete associations in PartnerStore first to avoid foreign key violation
    db.query(PartnerStore).filter(PartnerStore.user_id == partner_id).delete()

    # 2. Now delete the partner (User)
    db.delete(partner)
    
    db.commit()
    # 4. NOW THIS RETURN IS VALID
    return {"message": "Partner deleted successfully"}


# ---------------------------
# Superadmin: List Channel Admins (FIXED)
# ---------------------------
@router.get("/superadmin/list-channel-admins", response_model=List[UserOut])
def list_channel_admins(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Returns a list of all users who have the role 'channel_admin'.
    (Super Admin only)
    """
    # ⭐ FIX: Fetch all users with the channel_admin role
    channel_admins = db.query(User).filter(
        User.role == RoleEnum.channel_admin
    ).all()
    
    # UserOut schema ensures that the 'channel' field is correctly exposed
    return channel_admins 
    
# ---------------------------
# Partner CRUD (FIXES UNASSIGNED Channel)
# ---------------------------
@router.get("/list", response_model=List[UserOut])
def get_partners(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns all partners with their associated stores loaded.
    (Fixes the UNASSIGNED channel issue on the frontend).
    """
    partners = db.query(User).filter(
        User.role == RoleEnum.partner
    ).options(
        # Load stores eagerly for frontend serialization
        joinedload(User.stores) 
    ).all()
    
    return partners

@router.get("/me/stores", response_model=List[StoreOut])
def get_my_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.partner:
        raise HTTPException(status_code=403, detail="Only partners can access their stores.")

    stores = (
        db.query(Store)
        .join(PartnerStore, Store.id == PartnerStore.store_id)
        .filter(
            PartnerStore.user_id == current_user.id,
            Store.is_active.is_(True),
        )
        .all()
    )
    if not stores:
        raise HTTPException(status_code=404, detail="No stores found for this partner")

    return stores


# --- ADD THESE ENDPOINTS TO routes/partners.py ---

# 1. NEW: Delivery Manager Profile (Fixes 404 Not Found)
@router.get("/delivery-manager/me/profile", response_model=UserOut)
def get_delivery_manager_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(status_code=403, detail="Not a delivery manager")
    return current_user



@router.get("/delivery-manager/me/orders", response_model=List[OrderOut])
def get_manager_area_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers can view assigned orders."
        )

    seven_days_ago = datetime.utcnow() - timedelta(days=7)

    orders = (
        db.query(Order)
        .filter(
            Order.assigned_to_manager_id == current_user.id,

            # Pending orders only
            Order.status.in_([
                OrderStatusEnum.assigned_to_manager,
                OrderStatusEnum.assigned,
                OrderStatusEnum.in_transit
            ]),

            # Last 7 days only
            Order.created_at >= seven_days_ago
        )
        .options(
            joinedload(Order.store),
            joinedload(Order.partner),
            joinedload(Order.delivery_person)
        )
        .order_by(
            Order.store_id.asc(),
            Order.created_at.desc()
        )
        .all()
    )

    print(
        f"Manager {current_user.id} -> Orders Returned: {len(orders)}"
    )

    store_count = len(
        set(order.store_id for order in orders)
    )

    print(
        f"Manager {current_user.id} -> Unique Stores: {store_count}"
    )

    return orders

@router.get("/delivery-manager/dashboard")
def delivery_manager_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers can access dashboard."
        )

    pending_orders = db.query(Order).filter(
        Order.assigned_to_manager_id == current_user.id,
        Order.status.in_([
            OrderStatusEnum.assigned_to_manager,
            OrderStatusEnum.assigned,
            OrderStatusEnum.in_transit
        ])
    ).count()

    delivered_orders = db.query(Order).filter(
        Order.assigned_to_manager_id == current_user.id,
        Order.status.in_([
            OrderStatusEnum.delivered_confirmed,
            OrderStatusEnum.delivered_pending_confirmation
        ])
    ).count()

    total_orders = db.query(Order).filter(
        Order.assigned_to_manager_id == current_user.id
    ).count()

    return {
        "pending_orders": pending_orders,
        "delivered_orders": delivered_orders,
        "total_orders": total_orders
    }

@router.get("/delivery-manager/orders/pending")
def get_manager_pending_orders(
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers can access pending orders."
        )

    query = (
        db.query(Order)
        .join(Store)
        .options(
            joinedload(Order.store)
        )
        .filter(
            Order.assigned_to_manager_id == current_user.id,
            Order.status.in_([
                OrderStatusEnum.assigned_to_manager,
                OrderStatusEnum.assigned,
                OrderStatusEnum.in_transit
            ])
        )
    )

    if search:
        query = query.filter(
            Store.store_name.ilike(f"%{search}%")
        )

    total_count = query.count()

    offset = (page - 1) * limit

    orders = (
        query
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    result = []

    for order in orders:
        result.append({
            "id": order.id,
            "status": order.status.value,
            "store_id": order.store_id,
            "store_name": order.store.store_name if order.store else None,
            "channel": order.channel,
            "pending_empty_bottles": (
                order.store.pending_empty_bottles
                if order.store else 0
            ),
            "created_at": order.created_at,
            "order_date": order.order_date,
            "order_details": order.order_details,
            "total_amount": order.total_amount,
            "assigned_to_manager_id": order.assigned_to_manager_id,
            "delivery_person_id": order.delivery_person_id
        })

    return {
        "data": result,
        "has_more": (offset + limit) < total_count,
        "total_count": total_count,
        "page": page,
        "limit": limit
    }

@router.get("/delivery-manager/orders/delivered")
def get_manager_delivered_orders(
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers can access delivered orders."
        )

    query = (
        db.query(Order)
        .join(Store)
        .options(
            joinedload(Order.store)
        )
        .filter(
            Order.assigned_to_manager_id == current_user.id,
            Order.status.in_([
                OrderStatusEnum.delivered_confirmed,
                OrderStatusEnum.delivered_pending_confirmation
            ])
        )
    )

    if search:
        query = query.filter(
            Store.store_name.ilike(f"%{search}%")
        )

    total_count = query.count()

    offset = (page - 1) * limit

    orders = (
        query
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    result = []

    for order in orders:
        result.append({
            "id": order.id,
            "status": order.status.value,
            "store_id": order.store_id,
            "store_name": order.store.store_name if order.store else None,
            "channel": order.channel,
            "bottles_delivered": order.bottles_delivered,
            "empty_bottles_collected": order.empty_bottles_collected,
            "confirmed_empty_bottles": order.confirmed_empty_bottles,
            "confirmed_bottles": order.confirmed_bottles,
            "store_confirmed": order.store_confirmed,
            "created_at": order.created_at,
            "order_date": order.order_date,
            "delivered_at": order.delivered_at,
            "order_details": order.order_details,
            "total_amount": order.total_amount
        })

    return {
        "data": result,
        "has_more": (offset + limit) < total_count,
        "total_count": total_count,
        "page": page,
        "limit": limit
    }


@router.get("/delivery-manager/stores-summary/pending")
def get_pending_store_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers can access this."
        )

    orders = (
        db.query(Order)
        .join(Store)
        .filter(
            Order.assigned_to_manager_id == current_user.id,
            Order.status.in_([
                OrderStatusEnum.assigned_to_manager,
                OrderStatusEnum.assigned,
                OrderStatusEnum.in_transit
            ])
        )
        .options(joinedload(Order.store))
        .all()
    )

    def get_bottle_count(order):
        try:
            total = 0

            if not order.order_details:
                return 0

            # Case 1: List of dicts
            if isinstance(order.order_details, list):
                for item in order.order_details:
                    if isinstance(item, dict):
                        total += int(item.get("quantity", 0) or 0)

            # Case 2: Direct integer field fallback
            elif hasattr(order, "bottles_delivered"):
                total = int(order.bottles_delivered or 0)

            return total

        except Exception:
            return 0

    stores_map = {}

    for order in orders:

        if not order.store:
            continue

        store_id = order.store_id

        if store_id not in stores_map:
            stores_map[store_id] = {
                "store_id": store_id,
                "store_name": order.store.store_name,
                "pending_empty_bottles": getattr(
                    order.store,
                    "pending_empty_bottles",
                    0
                ) or 0,
                "total_orders": 0,
                "total_bottles": 0,
                "oldest_date": order.created_at
            }

        stores_map[store_id]["total_orders"] += 1
        stores_map[store_id]["total_bottles"] += get_bottle_count(order)

        if (
            order.created_at
            and order.created_at < stores_map[store_id]["oldest_date"]
        ):
            stores_map[store_id]["oldest_date"] = order.created_at

    return list(stores_map.values())

@router.get("/delivery-manager/stores-summary/delivered")
def get_delivered_store_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers can access this."
        )

    orders = (
        db.query(Order)
        .join(Store)
        .filter(
            Order.assigned_to_manager_id == current_user.id,
            Order.status.in_([
                OrderStatusEnum.delivered_confirmed,
                OrderStatusEnum.delivered_pending_confirmation
            ])
        )
        .options(joinedload(Order.store))
        .all()
    )

    stores_map = {}

    for order in orders:

        if not order.store:
            continue

        store_id = order.store_id

        if store_id not in stores_map:

            stores_map[store_id] = {
                "store_id": store_id,
                "store_name": order.store.store_name,
                "completed_orders": 0,
                "total_bottles": 0
            }

        stores_map[store_id]["completed_orders"] += 1

        bottles = 0

        if hasattr(order, "confirmed_bottles"):
            bottles = int(order.confirmed_bottles or 0)

        if bottles == 0 and hasattr(order, "bottles_delivered"):
            bottles = int(order.bottles_delivered or 0)

        stores_map[store_id]["total_bottles"] += bottles

    return sorted(
        list(stores_map.values()),
        key=lambda x: x["completed_orders"],
        reverse=True
    )







# ---------------------------------------------------------------------------------------
# ⭐ MODIFIED: create_order endpoint with Automatic Delivery Manager Assignment ⭐
# ---------------------------------------------------------------------------------------
@router.post("/me/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    order_data: OrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 🔒 Role check
    if current_user.role != RoleEnum.partner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a partner can perform this action."
        )

    # 🚫 BLOCK NEW ORDER IF PREVIOUS ORDER IS NOT CONFIRMED
    pending_confirmation = (
        db.query(Order)
        .filter(
            Order.partner_id == current_user.id,
            Order.status == OrderStatusEnum.delivered_pending_confirmation
        )
        .first()
    )

    if pending_confirmation:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You must confirm the previous delivery before placing a new order."
        )

    # 1️⃣ Fetch store & validate partner ownership
    store = (
        db.query(Store)
        .join(Store.partners)
        .filter(
            Store.id == order_data.store_id,
            User.id == current_user.id
        )
        .first()
    )

    if not store:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to create an order for this store."
        )

    require_active_store(store)

    # 2️⃣ Decide assignment (SINGLE SOURCE OF TRUTH)
    assigned_manager_id = None
    initial_status = OrderStatusEnum.pending

    # ✅ Auto-routing ONLY if store already has a DM
    if store.assigned_manager_id:
        assigned_manager_id = store.assigned_manager_id
        initial_status = OrderStatusEnum.assigned_to_manager

    # 3️⃣ Create Order
    # ⭐ MODIFIED: We now check if order_date is provided to override the current timestamp
    new_order = Order(
        partner_id=current_user.id,
        store_id=order_data.store_id,
        order_details=order_data.order_details,
        total_amount=order_data.total_amount,
        poc_name=order_data.poc_name,           # Payload se utha kar DB column mein daalna
        ordered_by_type=order_data.ordered_by_type,

        # Assignment fields
        assigned_to_manager_id=assigned_manager_id,
        status=initial_status,

        # Metadata
        channel=store.channel,

        # 📅 BACK-DATE FIX: Use the date from the frontend if it exists
        created_at=order_data.order_date if hasattr(order_data, 'order_date') and order_data.order_date else None
    )

    db.add(new_order)
    require_active_store_before_commit(db, store.id)
    db.commit()
    db.refresh(new_order)

    return new_order


# ---------------------------------------------------------------------------------------
# ⭐ END MODIFIED create_order endpoint ⭐
# ---------------------------------------------------------------------------------------




@router.get("/{partner_id}", response_model=UserOut)
def get_partner_by_id(partner_id: int, db: Session = Depends(get_db)):
    partner = db.query(User).filter(User.id == partner_id, User.role == RoleEnum.partner).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    return partner

@router.get("/{partner_id}/stores", response_model=List[StoreOut])
def get_partner_stores(partner_id: int, db: Session = Depends(get_db)):
    stores = (
        db.query(Store)
        .join(PartnerStore, Store.id == PartnerStore.store_id)
        .filter(PartnerStore.user_id == partner_id)
        .all()
    )
    if not stores:
        raise HTTPException(status_code=404, detail="No stores found for this partner")
    return stores


# ---------------------------
# Delivery Partner Management
# ---------------------------
@router.get("/superadmin/delivery-partners", response_model=List[UserOut])
def get_all_delivery_partners(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Returns a list of all users who have the role 'delivery'.
    (Super Admin only)
    """
    delivery_partners = (
        db.query(User)
        .filter(User.role == RoleEnum.delivery)
        .all()
    )

    if not delivery_partners:
        raise HTTPException(status_code=404, detail="No delivery partners found.")

    return delivery_partners

@router.get("/superadmin/delivery-partners/active")
def get_active_delivery_partners(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only a Super Admin can access this resource.")

    delivery_partners = (
        db.query(User)
        .filter(User.role == RoleEnum.delivery)
        .filter(User.status == "active")
        .all()
    )

    if not delivery_partners:
        raise HTTPException(status_code=404, detail="No active delivery partners found.")

    return delivery_partners

@router.patch("/superadmin/delivery-partners/{delivery_partner_id}/approve")
def approve_delivery_partner(
    delivery_partner_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only a super admin can approve delivery partners.")

    delivery_partner = db.query(User).filter(
        User.id == delivery_partner_id, User.role == RoleEnum.delivery
    ).first()

    if not delivery_partner:
        raise HTTPException(status_code=404, detail="Delivery partner not found")

    if delivery_partner.status == "active":
        raise HTTPException(status_code=400, detail="Delivery partner already active")

    delivery_partner.status = "active"
    db.commit()
    db.refresh(delivery_partner)

    return {"message": "Delivery partner approved successfully", "delivery_partner_id": delivery_partner.id}

@router.patch("/superadmin/delivery-partners/{dp_id}/assign-manager/{manager_id}")
def assign_dp_to_manager(
    dp_id: int,
    manager_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Super Admin links an approved Delivery Partner to a Delivery Manager.
    """
    # 1. Validate Delivery Partner
    dp = db.query(User).filter(User.id == dp_id, User.role == RoleEnum.delivery).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery Partner not found.")
        
    # 2. Validate Manager
    manager = db.query(User).filter(User.id == manager_id, User.role == RoleEnum.delivery_manager).first()
    if not manager:
        raise HTTPException(status_code=404, detail="Delivery Manager not found.")

    # 3. Assign
    dp.assigned_manager_id = manager.id
    db.commit()
    db.refresh(dp)
    
    return {"message": f"Delivery Partner {dp.full_name} assigned to Manager {manager.full_name}."}

@router.patch("/superadmin/orders/{order_id}/assign-manager/{manager_id}")
def superadmin_assign_order_to_manager(
    order_id: int,
    manager_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Super Admin manually assigns a Delivery Manager to an order
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    manager = db.query(User).filter(
        User.id == manager_id,
        User.role == RoleEnum.delivery_manager
    ).first()
    if not manager:
        raise HTTPException(status_code=404, detail="Delivery Manager not found")

    order.assigned_to_manager_id = manager.id
    order.status = OrderStatusEnum.assigned_to_manager

    db.commit()
    db.refresh(order)

    return {
        "message": "Order successfully assigned to Delivery Manager",
        "order_id": order.id,
        "manager_id": manager.id
    }

@router.patch("/superadmin/orders/{order_id}/route-to-manager")
def route_order_to_manager(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required) # Use the existing helper
):
    """
    Super Admin action: Routes an order from 'pending' or 'accepted' to the 
    responsible Delivery Manager (DM) based on the Store's city. 
    The order status changes to 'assigned_to_manager'.
    """
    # 1. Fetch Order and Store data
    # Ensure Store model is eagerly loaded for the city
    order = db.query(Order).options(joinedload(Order.store)).filter(Order.id == order_id).first()
    
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
        
    store_city = order.store.city if order.store else None
    if not store_city:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order store details are missing a city for routing.")

    # 2. Find the Delivery Manager responsible for this city
    target_manager = db.query(User).filter(
        User.role == RoleEnum.delivery_manager,
        User.city.ilike(store_city) # Case-insensitive city match (DM's city column holds their zone)
    ).first()

    if not target_manager:
        # If no DM is found, inform the Super Admin that manual assignment is required.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"No Delivery Manager found for city: {store_city}. The Super Admin must manually assign a DP later."
        )

    # 3. Update Order status and manager FK
    order.assigned_to_manager_id = target_manager.id
    order.status = OrderStatusEnum.assigned_to_manager # ⭐ NEW STATUS ⭐
    
    db.commit()
    db.refresh(order)
    
    return {
        "message": f"Order successfully routed to Delivery Manager: {target_manager.full_name} for {store_city}.",
        "order_id": order.id,
        "manager_id": target_manager.id
    }
# In routes/partners.py, add this endpoint:

@router.patch("/superadmin/move-dp/{dp_id}/to-manager/{new_manager_id}")
def move_dp_to_new_manager(
    dp_id: int,
    # Use 0 to indicate unassigning the DP
    new_manager_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Super Admin moves a Delivery Partner (DP) to a new manager.
    new_manager_id=0 signifies unassignment.
    """
    dp = db.query(User).filter(User.id == dp_id, User.role == RoleEnum.delivery).first()
    if not dp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery Partner not found.")
    
    new_manager = None
    target_manager_id = None
    
    if new_manager_id != 0:
        # Validate the new manager ID if it's provided
        new_manager = db.query(User).filter(
            User.id == new_manager_id, 
            User.role == RoleEnum.delivery_manager
        ).first()
        if not new_manager:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="New Delivery Manager not found.")
        target_manager_id = new_manager_id
        
    # Perform the reassignment: target_manager_id will be None if new_manager_id was 0
    dp.assigned_manager_id = target_manager_id
    
    db.commit()
    db.refresh(dp)
    
    manager_name = new_manager.full_name if new_manager else "Unassigned"
    
    return {
        "message": f"Delivery Partner {dp.full_name} reassigned to {manager_name}.",
        "dp_id": dp.id
    }

# New Endpoint for authenticated delivery partners
@router.get("/delivery-partner/me/orders", response_model=List[OrderOut])
def get_my_assigned_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.delivery:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a delivery partner can view their assigned orders."
        )

    # Query orders with related store, partner, and delivery person eagerly loaded
    orders = (
        db.query(Order)
        .options(
            joinedload(Order.store),      # Eager load the store details
            joinedload(Order.partner),      # Eager load the partner details
            joinedload(Order.delivery_person) # Eager load the delivery person details
        )
        .filter(Order.delivery_person_id == current_user.id)
        .all()
    )

    result = []
    for order in orders:
        
        # Validate related objects using Pydantic schemas
        partner_out = UserOut.model_validate(order.partner) if order.partner else None
        # --- (MODIFIED LINE) ---
        # Pass the ORM object directly to model_validate
        store_out = StoreOut.model_validate(order.store) if order.store else None
        # --- (END MODIFIED LINE) ---
        delivery_person_out = UserOut.model_validate(order.delivery_person) if order.delivery_person else None

        # Append validated data to the result list
        result.append(OrderOut(
            id=order.id,
            status=order.status,
            order_details=order.order_details,
            total_amount=order.total_amount,
            created_at=order.created_at,
            updated_at=order.updated_at,
            
            # Use names from the validated objects if available, otherwise None
            partner_name=partner_out.full_name if partner_out else None,
            store_name=store_out.store_name if store_out else None,
            delivery_person_name=delivery_person_out.full_name if delivery_person_out else None,

            # Assign the validated Pydantic models
            partner=partner_out,
            store=store_out,
            delivery_person=delivery_person_out
        ))

    # Check if any orders were found after processing
    if not result:
            pass # Currently returns empty list if no orders

    return result

# --- (THIS IS THE REPLACED FUNCTION) ---
@router.put("/delivery-partner/orders/{order_id}")
def update_order_status_with_photo(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),

    status: OrderStatusEnum = Form(...),
    bottles_delivered: Optional[int] = Form(None),
    empty_bottles_collected: Optional[int] = Form(None),

    # 🔥 EXISTING FIELDS
    vehicle_info: Optional[str] = Form(None),
    delivered_by: Optional[str] = Form(None),

    # 🆕 NEW FIELD (OPTIONAL BACKDATE SUPPORT)
    delivery_date: Optional[str] = Form(None),  # Format: YYYY-MM-DD

    photo: Optional[UploadFile] = File(None),
):
    # ✅ ALLOW DELIVERY PARTNER, DELIVERY MANAGER, AND SUPER ADMIN
    if current_user.role not in [
        RoleEnum.delivery,
        RoleEnum.delivery_manager,
        RoleEnum.superadmin
    ]:
        raise HTTPException(
            status_code=403,
            detail="Only delivery partners, delivery managers, or super admins can perform this action."
        )

    # 🔥 LOAD STORE ALSO
    order = (
        db.query(Order)
        .options(joinedload(Order.store))
        .filter(Order.id == order_id)
        .first()
    )

    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    # 🔒 AUTHORIZATION CHECK
    if current_user.role == RoleEnum.delivery:
        if order.delivery_person_id != current_user.id:
            raise HTTPException(
                status_code=403,
                detail="Unauthorized for this order."
            )

    if current_user.role == RoleEnum.delivery_manager:
        if order.assigned_to_manager_id != current_user.id:
            raise HTTPException(
                status_code=403,
                detail="Order not under your area."
            )

    # ✅ SUPER ADMIN CAN UPDATE ANY ORDER
    # No additional restriction needed.

    # ---------------------------------------------------
    # 📅 DELIVERY DATE PARSING + VALIDATION
    # ---------------------------------------------------
    selected_delivery_datetime = datetime.now()

    if delivery_date:
        try:
            selected_date = datetime.strptime(
                delivery_date,
                "%Y-%m-%d"
            )

            # Use order_date if available, otherwise created_at
            order_base_date = (
                order.order_date
                or order.created_at
            )

            if order_base_date:
                if (
                    selected_date.date()
                    < order_base_date.date()
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Delivery date cannot "
                            "be before order date."
                        )
                    )

            if (
                selected_date.date()
                > datetime.now().date()
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Delivery date cannot "
                        "be in the future."
                    )
                )

            # Keep current time, replace only date portion
            now = datetime.now()

            selected_delivery_datetime = (
                selected_date.replace(
                    hour=now.hour,
                    minute=now.minute,
                    second=now.second,
                    microsecond=now.microsecond
                )
            )

        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid delivery date format. "
                    "Use YYYY-MM-DD."
                )
            )

    # ---------------------------------------------------
    # 📸 SAVE DELIVERY PHOTO
    # ---------------------------------------------------
    photo_url = order.delivery_photo_url
    new_photo_path = None

    if photo:
        try:
            filename = (
                f"order_{order_id}_{photo.filename}"
            )

            filepath = os.path.join(
                UPLOADS_DIR,
                filename
            )

            with open(filepath, "wb+") as f:
                shutil.copyfileobj(photo.file, f)

            new_photo_path = filepath
            photo_url = f"/{UPLOADS_DIR}/{filename}"

            order.delivery_photo_url = photo_url

        finally:
            photo.file.close()

    # ---------------------------------------------------
    # 🧴 BOTTLES DELIVERED
    # ---------------------------------------------------
    resolved_delivered_by = delivered_by
    if not resolved_delivered_by and not order.delivered_by:
        resolved_delivered_by = current_user.full_name

    # ---------------------------------------------------
    # 🆕 EMPTY BOTTLES COLLECTED
    # ---------------------------------------------------
    # Delivery field mutations are applied together after status validation.

    # ---------------------------------------------------
    # 🚚 VEHICLE INFO
    # ---------------------------------------------------
    # Vehicle information is applied by the shared delivery service.

    # ---------------------------------------------------
    # 👤 DELIVERED BY
    # ---------------------------------------------------
    # Delivered-by fallback is resolved above without changing existing behavior.

    # ---------------------------------------------------
    # ✅ SIMPLE DELIVERY FLOW
    # ---------------------------------------------------
    if status not in [
        OrderStatusEnum.delivered_confirmed,
        OrderStatusEnum.delivered_pending_confirmation
    ]:
        raise HTTPException(
            status_code=400,
            detail="Invalid status update."
        )

    # ---------------------------------------------------
    # 👤 TRACK WHO MARKED DELIVERY
    # ---------------------------------------------------
    # IMPORTANT:
    # - Delivery Partner: same behavior as before
    # - Delivery Manager: same behavior as before
    # - Super Admin: DO NOT overwrite delivery_person_id
    apply_delivery_update(
        order,
        status=status,
        delivered_at=selected_delivery_datetime,
        bottles_delivered=bottles_delivered,
        empty_bottles_collected=empty_bottles_collected,
        photo_url=photo_url if photo else None,
        vehicle_info=vehicle_info,
        delivered_by=resolved_delivered_by,
        actor_id=current_user.id,
        actor_role=current_user.role,
    )

    # ---------------------------------------------------
    # 💾 SAVE
    # ---------------------------------------------------
    try:
        sync_order_to_monthly_virtual_card(db, order)
        db.commit()
    except MonthlyVirtualCardDomainError:
        db.rollback()
        _remove_new_local_photo(new_photo_path)
        raise
    except Exception:
        db.rollback()
        _remove_new_local_photo(new_photo_path)
        raise

    db.refresh(order)

    return {
        "message": (
            "Order delivered successfully."
            if (
                order.status
                == OrderStatusEnum.delivered_confirmed
            )
            else (
                "Order marked delivered, "
                "waiting for store confirmation."
            )
        ),

        "order_id": order.id,

        "photo_url": photo_url,

        "bottles_delivered":
            order.bottles_delivered,

        "empty_bottles_collected":
            order.empty_bottles_collected,

        "vehicle_info":
            order.vehicle_info,

        "delivered_by":
            order.delivered_by,

        "delivered_at": (
            order.delivered_at.isoformat()
            if order.delivered_at
            else None
        ),

        "marked_by":
            current_user.role.value,

        "status":
            order.status.value
    }

# ---------------------------
# NEW API Endpoints for Data Export
# ---------------------------

@router.get("/superadmin/orders/by-date")
def get_superadmin_orders_by_date(
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves all orders for a Super Admin within a specified date range.
    This API is used for the "Export by Date" functionality in the Super Admin dashboard.
    """
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only a Super Admin can perform this action.")
    
    # MODIFIED: Joined the 'store' model to get its data
    orders = db.query(Order).options(joinedload(Order.store)).filter(
        Order.created_at.between(start_date, end_date)
    ).all()
    
    if not orders:
        raise HTTPException(status_code=404, detail="No orders found for the specified date range.")
    
    return orders

@router.get("/me/orders/by-date")
def get_partner_orders_by_date(
    start_date: date,
    end_date: date,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves a Partner's orders within a specified date range.
    This API is used for the "Export by Date" functionality in the Partner dashboard.
    """
    if current_user.role != RoleEnum.partner:
        raise HTTPException(status_code=403, detail="Only a Partner can perform this action.")
    
    partner_stores = db.query(PartnerStore.store_id).filter(
        PartnerStore.user_id == current_user.id
    ).all()
    
    store_ids = [store.store_id for store in partner_stores]
    
    if not store_ids:
        raise HTTPException(status_code=404, detail="No stores found for this partner.")

    # MODIFIED: Joined the 'store' model to get its data
    orders = db.query(Order).options(joinedload(Order.store)).filter(
        Order.store_id.in_(store_ids),
        Order.created_at.between(start_date, end_date)
    ).all()
    
    if not orders:
        raise HTTPException(status_code=404, detail="No orders found for the specified date range.")
    
    return orders

@router.get("/superadmin/orders/export-all")
def get_all_orders_superadmin(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves all orders for a Super Admin.
    This API is for the "Export All Data" functionality.
    """
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only a Super Admin can perform this action.")
    
    # MODIFIED: Joined the 'store' model to get its data
    orders = db.query(Order).options(joinedload(Order.store)).all()
    
    if not orders:
        raise HTTPException(status_code=404, detail="No orders found in the system.")
    
    return orders

# In routes/partners.py (Implement this function)

# --- API to List Delivery Managers ---
@router.get("/superadmin/list-delivery-managers")
def list_delivery_managers(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    managers = (
        db.query(User)
        .filter(User.role == RoleEnum.delivery_manager)
        .all()
    )

    result = []

    for manager in managers:
        # 🔥 KEY PART: fetch stores assigned to this manager
        stores = (
            db.query(Store)
            .filter(Store.assigned_manager_id == manager.id)
            .all()
        )

        result.append({
            "id": manager.id,
            "full_name": manager.full_name,
            "email": manager.email,
            "mobile_number": manager.mobile_number,
            "status": manager.status,
            "assigned_area": manager.city or "Unassigned",

            # ✅ NEW FIELDS
            "store_count": len(stores),
            "stores": [
                {
                    "id": store.id,
                    "store_name": store.store_name,
                    "city": store.city,
                    "channel": store.channel,
                    "is_active": store.is_active,
                }
                for store in stores
            ]
        })

    return result


@router.get("/me/orders/export-all")
def get_all_orders_partner(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves all orders for the current Partner's assigned stores.
    This API is for the "Export All Data" functionality.
    """
    if current_user.role != RoleEnum.partner:
        raise HTTPException(status_code=403, detail="Only a Partner can perform this action.")
        
    partner_stores = db.query(PartnerStore.store_id).filter(
        PartnerStore.user_id == current_user.id
    ).all()
    
    store_ids = [store.store_id for store in partner_stores]
    
    if not store_ids:
        raise HTTPException(status_code=404, detail="No stores found for this partner.")
        
    # MODIFIED: Joined the 'store' model to get its data
    orders = db.query(Order).options(joinedload(Order.store)).filter(
        Order.store_id.in_(store_ids)
    ).all()

    if not orders:
        raise HTTPException(status_code=404, detail="No orders found for your stores.")
    
    return orders
@router.delete("/superadmin/delete-channel-admin/{admin_id}", status_code=200)
def delete_channel_admin(
    admin_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)  # <-- FIXED
):
    """
    Delete a Channel Admin (Super Admin only)
    """
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only a super admin can perform this action.")

    admin = db.query(User).filter(
        User.id == admin_id,
        User.role == RoleEnum.channel_admin
    ).first()

    if not admin:
        raise HTTPException(status_code=404, detail="Channel admin not found")

    db.delete(admin)
    db.commit()

    return {"message": "Channel Admin deleted successfully"}

@router.delete("/superadmin/delete-manager/{manager_id}", status_code=status.HTTP_200_OK)
def delete_delivery_manager(
    manager_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    ✅ FIXED:
    - Only block deletion if ACTIVE orders are still pending in manager queue
    - Unassign stores before deleting manager
    """
    manager = db.query(User).filter(
        User.id == manager_id,
        User.role == RoleEnum.delivery_manager
    ).first()

    if not manager:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Delivery Manager not found."
        )

    # ✅ Check 1: Linked DPs must be unassigned first
    linked_dp_count = db.query(User).filter(
        User.assigned_manager_id == manager_id,
        User.role == RoleEnum.delivery
    ).count()

    if linked_dp_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete manager. {linked_dp_count} Delivery Partner(s) must be reassigned first."
        )

    # ✅ Check 2: ONLY active orders should block deletion (FIXED ✅)
    active_order_count = db.query(Order).filter(
        Order.assigned_to_manager_id == manager_id,
        Order.status.in_([
            OrderStatusEnum.assigned_to_manager,  # waiting for DP assignment
            OrderStatusEnum.assigned              # assigned to DP but not completed
        ])
    ).count()

    if active_order_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete manager. {active_order_count} active Order(s) are pending in their queue."
        )

    # ✅ Unassign all stores before deleting manager (IMPORTANT ✅)
    db.query(Store).filter(
        Store.assigned_manager_id == manager_id
    ).update({"assigned_manager_id": None}, synchronize_session=False)

    db.delete(manager)
    db.commit()

    return {"message": f"Delivery Manager ID {manager_id} deleted successfully."}


@router.put("/partner/orders/{order_id}/confirm-delivery")
def confirm_order_delivery(
    order_id: int,
    body: PartnerConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 🔒 Role check
    if current_user.role != RoleEnum.partner:
        raise HTTPException(
            status_code=403,
            detail="Only partners can confirm deliveries."
        )

    # 🔎 Fetch order
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    # 🔐 Ensure partner owns the store
    owns_store = (
        db.query(PartnerStore)
        .filter(
            PartnerStore.user_id == current_user.id,
            PartnerStore.store_id == order.store_id
        )
        .first()
    )
    if not owns_store:
        raise HTTPException(
            status_code=403,
            detail="You are not authorized for this store’s orders."
        )

    # ⛔ Status guard
    # -----------------------------
    # ✅ CONFIRM DELIVERY
    # -----------------------------
    # Values are returned by the shared confirmation service below.

    # ✅ Save confirmed empty bottles if column exists
    # Confirmation fields are applied after the Store is loaded.

    # -----------------------------
    # ✅ UPDATE STORE RUNNING BALANCE (FIXED ✅)
    # -----------------------------
    store = (
        db.query(Store)
        .filter(Store.id == order.store_id)
        .with_for_update()
        .first()
    )
    if not store:
        raise HTTPException(status_code=404, detail="Store not found.")

    order = (
        db.query(Order)
        .filter(Order.id == order_id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    if order.status != OrderStatusEnum.delivered_pending_confirmation:
        raise HTTPException(
            status_code=400,
            detail="Order not awaiting confirmation."
        )

    # ✅ Safe handling if pending_empty_bottles is None
    delivered, collected = apply_delivery_confirmation(
        order,
        store,
        confirmed_bottles=body.confirmed_bottles,
        confirmed_empty_bottles=body.confirmed_empty_bottles,
        confirmation_remarks=body.confirmation_remarks,
    )

    # -----------------------------
    # 📝 Remarks
    # -----------------------------
    # Remarks are applied by the shared delivery service.

    # -----------------------------
    # 💾 COMMIT (with rollback safety)
    # -----------------------------
    try:
        sync_order_to_monthly_virtual_card(db, order)
        db.commit()
        db.refresh(order)
        db.refresh(store)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Confirm delivery failed.")

    return {
        "message": "Delivery confirmed successfully.",
        "order_id": order.id,
        "status": order.status.value,
        "confirmed_bottles": delivered,
        "confirmed_empty_bottles": collected,
        "store_pending_empty_bottles": store.pending_empty_bottles
    }




@router.post("/superadmin/create-delivery-manager", status_code=201)
def create_delivery_manager(
    manager_data: DeliveryManagerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    # 1. Email check
    if db.query(User).filter(User.email == manager_data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    # 2. Create Delivery Manager
    new_manager = User(
        full_name=manager_data.full_name,
        email=manager_data.email,
        password=hash_password(manager_data.password),
        mobile_number=manager_data.mobile_number,
        role=RoleEnum.delivery_manager,
        status="active",
        parent_id=current_user.id,
        city=manager_data.area_city  # optional, informational only
    )

    db.add(new_manager)
    db.commit()



    db.refresh(new_manager)

    # 3. Assign stores (CRITICAL FIX)
    if manager_data.assigned_stores:
        stores = db.query(Store).filter(
            Store.id.in_(manager_data.assigned_stores),
            Store.assigned_manager_id.is_(None)  # only FREE stores
        ).all()

        for store in stores:
            store.assigned_manager_id = new_manager.id

        db.commit()

    return {
        "message": "Delivery Manager created and stores assigned successfully",
        "user_id": new_manager.id,
        "assigned_store_count": len(manager_data.assigned_stores)
    }

@router.post("/superadmin/assign-stores-to-manager")
def assign_stores_to_manager(
    payload: AssignStoresRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    manager = db.query(User).filter(
        User.id == payload.manager_id,
        User.role == RoleEnum.delivery_manager
    ).first()

    if not manager:
        raise HTTPException(status_code=404, detail="Delivery Manager not found")

    stores = db.query(Store).filter(
        Store.id.in_(payload.store_ids)
    ).all()

    if not stores:
        raise HTTPException(status_code=400, detail="No valid stores found")

    for store in stores:
        store.assigned_manager_id = manager.id

    db.commit()

    return {
        "message": f"{len(stores)} store(s) assigned successfully",
        "manager_id": manager.id
    }




@router.get("/superadmin/free-stores", response_model=List[StoreOut])
def get_free_stores(
    city: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    q = db.query(Store).filter(Store.assigned_manager_id == None)

    if city:
        q = q.filter(Store.city.ilike(city))

    return q.all()




# ----------------------------------------------------
# ⭐ NEW: Super Admin Endpoint to List Routing Failures ⭐
# ----------------------------------------------------
@router.get("/superadmin/orders/needs-manual-assignment", response_model=List[OrderOut], tags=["Super Admin"])
def get_orders_needing_manual_assignment(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Returns orders that require manual routing. These are orders that
    failed automatic city-based assignment (status is 'pending' AND assigned_to_manager_id is NULL).
    """
    orders_for_manual_assignment = db.query(Order).filter(
        # Criterion 1: Order is in the default status
        Order.status == OrderStatusEnum.pending, 
        # Criterion 2: No manager ID was set by the automatic routing logic
        Order.assigned_to_manager_id == None   
    ).options(
        joinedload(Order.partner),
        joinedload(Order.store),
        joinedload(Order.manager_assigned)
    ).all()
    
    return orders_for_manual_assignment

@router.patch("/superadmin/update-manager/{manager_id}")
def update_manager_credentials(
    manager_id: int,
    request: ManagerUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    # First try Delivery Manager
    manager = db.query(User).filter(
        User.id == manager_id,
        User.role == RoleEnum.delivery_manager
    ).first()

    # If not found, try Store Manager (partner)
    if not manager:
        manager = db.query(User).filter(
            User.id == manager_id,
            User.role == RoleEnum.partner
        ).first()

    if not manager:
        raise HTTPException(
            status_code=404,
            detail="Manager not found."
        )

    # Update email
    if request.email and request.email != manager.email:
        existing_user = db.query(User).filter(
            User.email == request.email,
            User.id != manager_id
        ).first()

        if existing_user:
            raise HTTPException(
                status_code=400,
                detail="Email already registered."
            )

        manager.email = request.email

    # Update password
    if request.password:
        if len(request.password) < 6:
            raise HTTPException(
                status_code=400,
                detail="Password must be at least 6 characters."
            )

        manager.password = hash_password(request.password)

    db.commit()
    db.refresh(manager)

    return {
        "message": "Credentials updated successfully.",
        "id": manager.id,
        "email": manager.email,
        "role": manager.role.value
    }
