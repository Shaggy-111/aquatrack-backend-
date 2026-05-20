# routes/delivery.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

# Corrected imports
from ..database.db import get_db
from ..models.order import Order, OrderStatusEnum
from ..models.user import User, RoleEnum
from ..utils.jwt import get_current_user
from ..schemas.order import OrderOut


# Dependency to check for delivery role
def delivery_person_required(current_user: User = Depends(get_current_user)):
    """Dependency to ensure only a delivery person can access the route."""
    if current_user.role != RoleEnum.delivery:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to perform this action."
        )
    return current_user


# Define router with a prefix
router = APIRouter(prefix="/delivery", tags=["Delivery"])


@router.get("/dashboard", response_model=List[OrderOut])
def get_delivery_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(delivery_person_required)
):
    """
    Retrieves all orders assigned to the currently authenticated delivery person.
    """
    # Use the current user's ID from the token for security
    assigned_orders = db.query(Order).filter(
        Order.delivery_person_id == current_user.id
    ).all()

    return assigned_orders


@router.put("/deliver-order/{order_id}")
def deliver_order(
    order_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(delivery_person_required)
):
    """
    Endpoint for a delivery person to mark an order as delivered.
    """
    order = db.query(Order).filter(Order.id == order_id).first()

    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    # Security check: Ensure the order is assigned to the current user
    if order.delivery_person_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to update this order."
        )

    # Check if the order is in a valid state to be delivered
    if order.status not in [OrderStatusEnum.in_transit]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Order status must be '{OrderStatusEnum.in_transit.value}' to be delivered."
        )

    order.status = OrderStatusEnum.delivered
    db.commit()
    db.refresh(order)
    
    return order