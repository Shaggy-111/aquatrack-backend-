from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from datetime import date



from ..database.db import get_db
from ..utils.jwt import get_current_user
from ..models.user import User, RoleEnum
from ..models.order import Order, OrderStatusEnum
from ..models.store import Store

router = APIRouter(
    prefix="/delivery-reports",
    tags=["Store Reports"]
)

@router.get("/store-summary")
def store_summary(
    from_date: date | None = None,
    to_date: date | None = None,
    state: str | None = None,
    city: str | None = None,
    channel: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = (
        db.query(
            Store.id.label("store_id"),
            Store.store_name,
            Store.state,
            Store.city,
            Order.channel,
            func.count(Order.id).label("total_orders"),
            func.sum(Order.bottles_delivered).label("total_cans"),
            func.sum(Order.empty_bottles_collected).label("total_empty"),
            func.sum(
                case(
                    (
                        Order.status.notin_([
                            OrderStatusEnum.delivered_confirmed,
                            OrderStatusEnum.delivered_pending_confirmation
                        ]),
                    1
                    ),
                    else_=0
                )
            ).label("incomplete_orders"),
            func.max(Order.delivered_at).label("last_delivered_at")
        )
        .join(Order, Order.store_id == Store.id)
        .group_by(Store.id, Order.channel)
    )


    # 🔐 Role filter
    if current_user.role == RoleEnum.channel_admin:
        query = query.filter(Store.channel == current_user.channel)

    if current_user.role == RoleEnum.partner:
        query = query.filter(Order.partner_id == current_user.id)

    # 📅 Date filters
    if from_date:
        query = query.filter(Order.created_at >= from_date)

    if to_date:
        query = query.filter(Order.created_at <= to_date)

    # 🏙 Filters
    if state:
        query = query.filter(Store.state == state)

    if city:
        query = query.filter(Store.city == city)

    if channel:
        query = query.filter(Store.channel == channel)

    rows = query.all()

    return {
        "rows": [
            {
                "store_id": r.store_id,
                "outlet_name": r.store_name,
                "state": r.state,
                "city": r.city,
                "channel": r.channel,
                "total_orders": r.total_orders,
                "total_cans": r.total_cans or 0,
                "total_empty": r.total_empty or 0,
                "incomplete_orders": r.incomplete_orders,
                "last_delivered_at": r.last_delivered_at.isoformat() if r.last_delivered_at else None
            }
            for r in rows
        ]
    }
