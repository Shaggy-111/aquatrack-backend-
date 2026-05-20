from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

# Corrected relative imports
from ..database.db import get_db
from ..models.order import Order, OrderStatusEnum
from ..models.user import User, RoleEnum
from ..schemas.order import OrderOut, OrderPatch
from ..schemas.user import UserOut
from ..utils.jwt import get_current_user


# Helper function for super admin authorization
def super_admin_required(current_user: User = Depends(get_current_user)):
    """Dependency to ensure only a superadmin can access the route."""
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )
    return current_user

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/orders", response_model=List[OrderOut])
def get_all_orders_for_admin(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Retrieves a complete history of all orders for the super admin dashboard.
    """
    all_orders = db.query(Order).options(
        joinedload(Order.partner),
        joinedload(Order.store)
    ).all()
    return all_orders


@router.get("/customers", response_model=List[UserOut])
def get_all_customers_and_deliveries(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Retrieves a list of all customers and delivery persons for the admin dashboard.
    """
    users = db.query(User).filter(
        (User.role == RoleEnum.customer) | (User.role == RoleEnum.delivery)
    ).all()
    
    return users


@router.patch("/orders/{order_id}/assign", response_model=OrderOut)
def assign_order(
    order_id: int, 
    delivery_person_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    """
    Assigns a pending order to a delivery person.
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    if order.status != OrderStatusEnum.accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Order status must be '{OrderStatusEnum.accepted.value}' to be assigned."
        )
    
    delivery_person = db.query(User).filter(
        User.id == delivery_person_id,
        User.role == RoleEnum.delivery,
        User.status == "active"
    ).first()
    if not delivery_person:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery person not found or not active")
    
    # Check if a delivery person is already assigned
    if order.delivery_person_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This order is already assigned to a delivery person."
        )

    order.delivery_person_id = delivery_person_id
    order.status = OrderStatusEnum.in_transit # Update status to in-transit
    db.commit()
    db.refresh(order)

    return order