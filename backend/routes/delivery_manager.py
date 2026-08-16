from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List

from ..database.db import get_db
from ..models.user import User, RoleEnum
from ..models.order import Order, OrderStatusEnum
from ..schemas.user import UserOut
from ..schemas.order import OrderOut
from ..utils.jwt import get_current_user
from datetime import datetime, timedelta

router = APIRouter(prefix="/delivery-manager", tags=["Delivery Manager"])


# ✅ Helper function to check Delivery Manager role
def delivery_manager_required(current_user: User = Depends(get_current_user)):
    if current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a Delivery Manager can perform this action."
        )
    return current_user


# ✅ Delivery Manager Profile
@router.get("/me/profile", response_model=UserOut)
def get_manager_profile(
    current_user: User = Depends(delivery_manager_required)
):
    return current_user


# ✅ Delivery Manager Assigned Orders

@router.get("/me/orders", response_model=List[OrderOut])
def get_manager_assigned_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(delivery_manager_required)
):
    five_days_ago = datetime.utcnow() - timedelta(days=5)

    orders = (
        db.query(Order)
        .options(
            joinedload(Order.store),
            joinedload(Order.partner),
            joinedload(Order.delivery_person)
        )
        .filter(
            Order.assigned_to_manager_id == current_user.id,

            # Active orders only
            Order.status.in_([
                OrderStatusEnum.assigned_to_manager,
                OrderStatusEnum.assigned,
                OrderStatusEnum.in_transit
            ]),

            # Only last 5 days
            Order.created_at >= five_days_ago
        )
        .order_by(Order.created_at.desc())
        .limit(200)
        .all()
    )

    print(
        f"Manager {current_user.id} Orders Returned: {len(orders)}"
    )

    return orders


# ✅ Delivery Manager Team Delivery Partners
@router.get("/me/delivery-partners", response_model=List[UserOut])
def get_manager_delivery_partners(
    db: Session = Depends(get_db),
    current_user: User = Depends(delivery_manager_required)
):
    partners = (
        db.query(User)
        .filter(
            User.role == RoleEnum.delivery,
            User.assigned_manager_id == current_user.id,
            User.status == "active"
        )
        .all()
    )

    # ✅ Return [] instead of 404
    return partners


# ✅ Assign Order to Delivery Partner
@router.patch("/orders/{order_id}/assign-to-dp/{delivery_partner_id}")
def assign_order_to_dp(
    order_id: int,
    delivery_partner_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(delivery_manager_required)
):
    # 1️⃣ Fetch order in manager queue
    order = db.query(Order).filter(
        Order.id == order_id,
        Order.assigned_to_manager_id == current_user.id
    ).first()

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Order not found or not in your queue."
        )

    # Only allow assignment if order is waiting in manager queue
    if order.status != OrderStatusEnum.assigned_to_manager:
        raise HTTPException(
            status_code=400,
            detail="Order is not ready for delivery partner assignment."
        )

    # 2️⃣ Fetch DP under this manager
    dp = db.query(User).filter(
        User.id == delivery_partner_id,
        User.role == RoleEnum.delivery,
        User.assigned_manager_id == current_user.id,
        User.status == "active"
    ).first()

    if not dp:
        raise HTTPException(
            status_code=404,
            detail="Delivery Partner not found or not part of your team."
        )

    # 3️⃣ Assign
    order.delivery_person_id = dp.id
    order.status = OrderStatusEnum.assigned

    db.commit()
    db.refresh(order)

    return {
        "message": "Order successfully assigned to Delivery Partner.",
        "order_id": order.id,
        "delivery_partner_id": dp.id,
        "status": order.status.value
    }
