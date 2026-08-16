from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from datetime import date



from ..database.db import get_db
from ..utils.jwt import get_current_user
from ..models.user import User, RoleEnum
from ..models.order import Order, OrderStatusEnum
from ..models.store import Store
from ..utils.permissions import (
    filter_query_by_employee_stores,
    get_employee_store_ids,
    require_permission,
)
from .delivery_reports import (
    effective_delivered_expression,
    effective_empty_expression,
    ist_date_range_utc,
)

router = APIRouter(
    prefix="/store-reports",
    tags=["Store Reports"]
)


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
    employee_permission_required(
        "store_reports.view",
        current_user,
        db
    )

    query = (
        db.query(
            Store.id.label("store_id"),
            Store.store_name,
            Store.state,
            Store.city,
            Order.channel,
            func.count(Order.id).label("total_orders"),
            func.sum(effective_delivered_expression()).label("total_cans"),
            func.sum(effective_empty_expression()).label("total_empty"),
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

    if current_user.role == RoleEnum.employee:
        store_ids = get_employee_store_ids(current_user.id, db=db)
        if not store_ids:
            return {"rows": []}
        query = filter_query_by_employee_stores(query, current_user)

    # 📅 Date filters
    if from_date:
        start_utc, _ = ist_date_range_utc(from_date, from_date)
        query = query.filter(Order.order_date >= start_utc)

    if to_date:
        _, end_utc = ist_date_range_utc(to_date, to_date)
        query = query.filter(Order.order_date < end_utc)

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
