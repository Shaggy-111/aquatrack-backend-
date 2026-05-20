from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List
from datetime import datetime

from ..database.db import get_db
from ..models.order import Order
from ..models.user import User, RoleEnum
from ..models.store import Store
from ..schemas.order import OrderCreate, OrderOut, OrderPatch, OrderUpdateStatusSchema
from ..utils.jwt import get_current_user
import pytz
ist = pytz.timezone("Asia/Kolkata")

# ----------------------------------------------------
# Role-based dependencies
# ----------------------------------------------------
def partner_required(current_user: User = Depends(get_current_user)):
    if current_user.role != RoleEnum.partner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a partner can perform this action."
        )
    return current_user


def super_admin_required(current_user: User = Depends(get_current_user)):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )
    return current_user


router = APIRouter()

# ----------------------------------------------------
# Partner: Get My Orders
# ----------------------------------------------------
@router.get("/partner/orders/me", response_model=List[OrderOut], tags=["Partner"])
def get_my_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(partner_required)
):
    my_orders = (
        db.query(Order)
        .filter(Order.partner_id == current_user.id)
        .options(
            joinedload(Order.store)
            .joinedload(Store.assigned_manager),
            joinedload(Order.delivery_person)
        )
        .all()
    )
    return my_orders


# ----------------------------------------------------
# Partner: Create Order (Auto-routing via Store Manager)
# ----------------------------------------------------
@router.post(
    "/partner/orders",
    response_model=OrderOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Partner"]
)
def create_order(
    order_data: OrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(partner_required)
):
    try:
        # 1️⃣ Validate store ownership
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
            raise HTTPException(status_code=403, detail="No permission for this store.")

        # 2️⃣ Routing decision based on store manager
        assigned_manager_id = store.assigned_manager_id
        if assigned_manager_id:
            status_value = "assigned_to_manager"
        else:
            status_value = "pending"
            print(f"[ROUTING] Store {store.id} has no manager. Order pending.")

        # ⭐ 3️⃣ BACKDATE LOGIC (MAIN FIX)
        order_date_value = (
            order_data.order_date.astimezone(ist)
            if order_data.order_date
            else datetime.now(ist)
)

        # 4️⃣ Create order
        new_order = Order(
            partner_id=current_user.id,
            store_id=store.id,
            order_details=order_data.order_details,
            total_amount=order_data.total_amount,
            assigned_to_manager_id=assigned_manager_id,
            status=status_value,
            channel=store.channel,
            poc_name=order_data.poc_name,
            ordered_by_type=order_data.ordered_by_type,

            # ⭐ MAIN FIX
            order_date=order_date_value
        )

        db.add(new_order)
        db.commit()
        db.refresh(new_order)

        return new_order

    except Exception as e:
        print("ERROR in create_order:", str(e))
        raise HTTPException(status_code=500, detail="Error creating order")


# ----------------------------------------------------
# Delivery: Mark Order Delivered
# ----------------------------------------------------
@router.patch(
    "/orders/{order_id}/mark-delivered",
    response_model=OrderOut,
    tags=["Delivery"]
)
def mark_order_delivered(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role not in [
        RoleEnum.delivery,
        RoleEnum.delivery_manager,
        RoleEnum.superadmin
    ]:
        raise HTTPException(status_code=403, detail="Not authorized")

    order = db.query(Order).filter(Order.id == order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status == "delivered_confirmed":

        raise HTTPException(status_code=400, detail="Order already delivered")

    order.status = "delivered_confirmed"

    # 🔥 BACKDATE DETECTION
    is_backdated = (
        order.order_date
        and order.created_at
        and order.order_date.date() != order.created_at.date()
    )

    if is_backdated:
        # 👉 backdated → same date 00:00 IST
        order.delivered_at = order.order_date.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        # 👉 normal → CURRENT IST TIME (FINAL FIX)
        order.delivered_at = datetime.now(ist)

    db.commit()
    db.refresh(order)

    return order

# ----------------------------------------------------
# Super Admin: Orders needing manual assignment
# ----------------------------------------------------
@router.get(
    "/superadmin/orders/needs-assignment",
    response_model=List[OrderOut],
    tags=["Super Admin"]
)
def get_orders_needing_manual_assignment(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    orders = (
        db.query(Order)
        .filter(
            Order.status == "pending",
            Order.assigned_to_manager_id == None
        )
        .options(
            joinedload(Order.partner),
            joinedload(Order.store)
            .joinedload(Store.assigned_manager)
        )
        .all()
    )
    return orders


# ----------------------------------------------------
# Super Admin: Pending Orders
# ----------------------------------------------------
@router.get(
    "/superadmin/orders/pending",
    response_model=List[OrderOut],
    tags=["Super Admin"]
)
def get_pending_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    pending_orders = (
        db.query(Order)
        .filter(Order.status == "pending")
        .options(
            joinedload(Order.partner),
            joinedload(Order.store)
            .joinedload(Store.assigned_manager)
        )
        .all()
    )
    return pending_orders


# ----------------------------------------------------
# Super Admin: All Orders
# ----------------------------------------------------
@router.get(
    "/superadmin/orders/all",
    tags=["Super Admin"]
)
def get_all_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    all_orders = (
        db.query(Order)
        .options(
            joinedload(Order.partner),
            joinedload(Order.delivery_person),
            joinedload(Order.manager_assigned),
            joinedload(Order.store)
            .joinedload(Store.assigned_manager)
        )
        .order_by(Order.created_at.desc())
        .all()
    )

    orders_list = []

    for order in all_orders:

        store = order.store
        partner = order.partner
        delivery_person = order.delivery_person

        # ✅ SAFE STATUS NORMALIZATION
        status_value = (
            order.status.value
            if hasattr(order.status, "value")
            else str(order.status)
        )

        orders_list.append({

            # 🆔 Order
            "id": order.id,

            # 🧴 Bottles
            "bottles": int(order.order_details)
            if order.order_details else 0,

            "bottles_delivered":
            order.bottles_delivered or 0,

            # ✅ FIXED STATUS
            "status": status_value,

            # 📅 Dates
            "created_at":
            order.created_at.isoformat()
            if order.created_at else None,

            "order_date":
            order.order_date.isoformat()
            if order.order_date else None,

            "delivered_at":
            order.delivered_at.isoformat()
            if order.delivered_at else None,

            # 🏬 Store
            "store_id": order.store_id,

            "store_name":
            store.store_name if store else None,

            "city":
            store.city if store else None,

            "state":
            store.state if store else None,

            # 👤 Ordered By
            "poc_name": order.poc_name,

            "ordered_by_type":
            order.ordered_by_type,

            "partner_name":
            partner.full_name
            if partner else None,

            # 🚚 Delivery Partner
            "delivered_by": (
                delivery_person.full_name
                if delivery_person
                else "Not Assigned"
            ),

            # 👨‍💼 Delivery Manager
            "assigned_manager": (
                order.manager_assigned.full_name
                if order.manager_assigned
                else "Not Assigned"
            ),

            # 🚗 Vehicle
            "vehicle_info":
            order.vehicle_info,

            # 📸 Proof
            "delivery_photo_url":
            order.delivery_photo_url,

            # 🏷️ Channel
            "channel": (
                store.channel.upper()
                if store and store.channel
                else "GENERAL"
            ),
        })

    return {
        "total_orders": len(orders_list),
        "orders": orders_list
    }