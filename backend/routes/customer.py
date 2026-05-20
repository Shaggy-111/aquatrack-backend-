from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

# Corrected relative imports
from ..database.db import get_db
from ..models.order import Order
from ..schemas.order import OrderCreate, OrderOut
from ..utils.auth import get_current_user
from ..models.user import User
from ..schemas.user import UserOut

# Create the APIRouter instance
router = APIRouter(
    prefix="/customer",
    tags=["customer"],
)

@router.post("/order", response_model=OrderOut)
def place_order(order: OrderCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Allows a customer to place a new order.
    """
    if order.quantity < 1:
        raise HTTPException(status_code=400, detail="Order quantity must be at least 1")

    # Create a new order with the current user's ID
    new_order = Order(
        user_id=current_user.id,
        quantity=order.quantity,
        address=order.address,
        status="pending",
        type="customer"
    )
    db.add(new_order)
    db.commit()
    db.refresh(new_order)
    return new_order

@router.get("/test")
def test_customer():
    """
    A simple test endpoint to check if the customer router is working.
    """
    return {"msg": "Customer route working"}

@router.get("/view_all_customers", response_model=list[UserOut])
def view_all_customers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Retrieves a list of all customers, with authorization check for admin role.
    """
    # Check if the current user has the 'admin' role
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to view customers")

    customers = db.query(User).filter(User.role == "customer").all()
    return customers
