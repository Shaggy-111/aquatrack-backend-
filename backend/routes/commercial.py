from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

# Corrected relative imports
from ..database.db import get_db
from ..models.order import Order
from ..schemas.order import OrderCreate, OrderOut
from ..utils.auth import get_current_user
from ..models.user import User

router = APIRouter()

@router.post("/bulk-order", response_model=OrderOut)
def place_bulk_order(order: OrderCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Endpoint for placing a new bulk order, with a minimum quantity of 50.
    """
    if order.quantity < 50:
        raise HTTPException(status_code=400, detail="Bulk orders must be at least 50 units")

    # Create a new order with the current user's ID
    new_order = Order(
        user_id=current_user.id,
        quantity=order.quantity,
        address=order.address,
        status="pending",
        type="commercial"
    )
    db.add(new_order)
    db.commit()
    db.refresh(new_order)
    return new_order

@router.get("/test-commercial")
def test_commercial():
    """
    A simple test endpoint to check if the commercial router is working.
    """
    return {"msg": "Commercial route working"}
