from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, case, and_
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from ..database.db import get_db
from ..utils.jwt import get_current_user
from ..models.user import User, RoleEnum
from ..models.order import Order, OrderStatusEnum
from ..models.store import Store
from sqlalchemy.orm import Session, joinedload
from ..models.partner_store import PartnerStore
from ..utils.permissions import get_employee_store_ids, require_permission
import os

router = APIRouter(
    prefix="/delivery-reports",
    tags=["Delivery Reports"]
)

IST = ZoneInfo("Asia/Kolkata")


def ist_date_range_utc(start_date: date, end_date: date):
    """Return inclusive IST date bounds as an exclusive UTC timestamp range."""
    start_ist = datetime.combine(start_date, time.min, tzinfo=IST)
    end_ist = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=IST)
    return start_ist.astimezone(timezone.utc), end_ist.astimezone(timezone.utc)


def order_date_in_ist(value: datetime) -> datetime:
    # PostgreSQL timestamptz values are aware. Treat a legacy naive value as UTC.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(IST)


def effective_delivered_expression():
    return case(
        (
            Order.status == OrderStatusEnum.delivered_confirmed,
            func.coalesce(Order.confirmed_bottles, Order.bottles_delivered, 0),
        ),
        else_=func.coalesce(Order.bottles_delivered, 0),
    )


def effective_empty_expression():
    return case(
        (
            Order.status == OrderStatusEnum.delivered_confirmed,
            func.coalesce(
                Order.confirmed_empty_bottles,
                Order.empty_bottles_collected,
                0,
            ),
        ),
        else_=func.coalesce(Order.empty_bottles_collected, 0),
    )


def effective_delivered_value(order: Order) -> int:
    if order.status == OrderStatusEnum.delivered_confirmed:
        value = order.confirmed_bottles
        if value is not None:
            return int(value)
    return int(order.bottles_delivered or 0)


def effective_empty_value(order: Order) -> int:
    if order.status == OrderStatusEnum.delivered_confirmed:
        value = order.confirmed_empty_bottles
        if value is not None:
            return int(value)
    return int(order.empty_bottles_collected or 0)


def aggregate_effective_delivered_by_ist_date(orders):
    totals = {}
    for order in orders:
        business_date = order_date_in_ist(order.order_date).date()
        totals[business_date] = (
            totals.get(business_date, 0) + effective_delivered_value(order)
        )
    return totals

# --- Helper for Permissions ---
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


def employee_store_ids_required(current_user: User, db: Session):
    store_ids = get_employee_store_ids(current_user.id, db=db)
    if not store_ids:
        return []
    return store_ids


def apply_role_filters(query, current_user):
    if current_user.role == RoleEnum.superadmin:
        return query

    if current_user.role == RoleEnum.channel_admin:
        # ✅ FIX: Case-insensitive match
        return query.filter(func.lower(Order.channel) == func.lower(current_user.channel))

    if current_user.role == RoleEnum.partner:
        return query.filter(Order.partner_id == current_user.id)

    if current_user.role == RoleEnum.delivery_manager:
        return query.filter(Store.assigned_manager_id == current_user.id)

    if current_user.role == RoleEnum.employee:
        store_ids = get_employee_store_ids(current_user.id, db=query.session)
        return query.filter(Order.store_id.in_(store_ids))

    raise HTTPException(status_code=403, detail="Not authorized")


# --- 1. Order Details ---
@router.get("/orders")
def get_orders(
    from_date: str,
    to_date: str,
    state: str = None,
    city: str = None,
    channel: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    employee_permission_required(
        "delivery_reports.view",
        current_user,
        db
    )

    try:
        start_dt = datetime.strptime(from_date, "%Y-%m-%d")
        end_dt = datetime.strptime(to_date, "%Y-%m-%d")
    except:
        raise HTTPException(status_code=400, detail="Invalid date format")

    # ✅ BASE QUERY
    query = db.query(Order).options(
        joinedload(Order.store)
        .joinedload(Store.partner_associations)
        .joinedload(PartnerStore.user)
    ).join(Store)

    # ✅ DATE FILTER (IMPORTANT)
    start_utc, end_utc = ist_date_range_utc(start_dt.date(), end_dt.date())
    query = query.filter(
        Order.order_date.isnot(None),
        Order.order_date >= start_utc,
        Order.order_date < end_utc,
    )

    # ✅ STATUS FIX (🔥 MAIN FIX)
    query = query.filter(
        Order.status == OrderStatusEnum.delivered_confirmed
        # 👇 agar doubt ho to ye use kar
        # Order.status == "delivered_confirmed"
    )

    # ✅ FILTERS
    if state and state not in ["All States", ""]:
        query = query.filter(Store.state == state)

    if city and city not in ["All Cities", ""]:
        query = query.filter(Store.city == city)

    if current_user.role in [
        RoleEnum.channel_admin,
        RoleEnum.partner,
        RoleEnum.delivery_manager,
        RoleEnum.employee,
    ]:
        query = apply_role_filters(query, current_user)
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Not authorized")

    if current_user.role != RoleEnum.channel_admin and channel and channel not in ["All Entities", ""]:
        query = query.filter(func.upper(Order.channel) == channel.upper())

    orders = query.all()

    # 🧪 DEBUG (TEMP - REMOVE LATER)
    print("TOTAL ORDERS FOUND:", len(orders))

    if not orders:
        return {"rows": [], "dates": []}

    # 📅 DATE RANGE
    selected_days = []
    curr = start_dt
    day_fmt = "#d" if os.name == "nt" else "-d"

    while curr <= end_dt:
        selected_days.append(curr.strftime(f"%{day_fmt}-%b"))
        curr += timedelta(days=1)

    # 🔥 PIVOT BUILD
    pivot_map = {}

    for o in orders:
        if not o.store:
            continue

        s = o.store
        manager = s.partner_associations[0].user if s.partner_associations else None

        # ✅ SAFE DATE
        if not o.order_date:
            continue

        date_str = order_date_in_ist(o.order_date).strftime(f"%{day_fmt}-%b")
        key = f"{s.id}_{s.city}"

        if key not in pivot_map:
            pivot_map[key] = {
                "Region": "NORTH",
                "Entity": str(o.channel or s.channel or "N/A").upper(),
                "STATE": str(s.state or "N/A"),
                "City": str(s.city or "N/A"),
                "Outlet ID": str(s.id),
                "Outlet Name": str(s.store_name or "N/A"),
                "POC Name": str(getattr(manager, "full_name", "N/A")),
                "Contact No": str(getattr(manager, "mobile_number", "N/A")),
                "VENDOR NAME": "VeeKay Aquatech PVT Ltd",
                "License Number": "10013064000321",
                "daily": {d: 0 for d in selected_days},
                "Total Count": 0
            }

        cans = effective_delivered_value(o)

        pivot_map[key]["daily"][date_str] += cans
        pivot_map[key]["Total Count"] += cans

    # 🔄 FINAL RESPONSE
    final_rows = []
    for row in pivot_map.values():
        final_row = {k: v for k, v in row.items() if k != "daily"}
        for d in selected_days:
            final_row[d] = row["daily"].get(d, 0)
        final_rows.append(final_row)

    return {
        "dates": selected_days,
        "rows": final_rows
    }


# --- 2. Store Summary ---
@router.get("/store-summary")
def get_store_summary(
    state: Optional[str] = None,
    city: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    employee_permission_required(
        "delivery_reports.view",
        current_user,
        db
    )

    query = db.query(
        Store.id.label("store_id"),
        Store.store_name.label("outlet_name"),
        func.count(Order.id).label("total_orders"),
        func.sum(effective_delivered_expression()).label("total_cans"),
        func.sum(effective_empty_expression()).label("total_empty"),
        func.sum(
            case((Order.status != OrderStatusEnum.delivered_confirmed, 1), else_=0)
        ).label("incomplete"),
        func.max(Order.delivered_at).label("last_delivery")
    ).join(Order, Order.store_id == Store.id)

    # ✅ role filters
    if current_user.role == RoleEnum.channel_admin:
        query = query.filter(func.lower(Order.channel) == func.lower(current_user.channel))
    elif current_user.role == RoleEnum.partner:
        query = query.filter(Order.partner_id == current_user.id)
    elif current_user.role == RoleEnum.superadmin:
        pass
    elif current_user.role == RoleEnum.employee:
        query = query.filter(
            Store.id.in_(
                employee_store_ids_required(current_user, db)
            )
        )
    else:
        raise HTTPException(status_code=403, detail="Not authorized")

    if state:
        query = query.filter(func.lower(Store.state) == state.lower())

    if city:
        query = query.filter(func.lower(Store.city) == city.lower())

    results = query.group_by(Store.id).all()

    return {
        "rows": [
            dict(
                r._mapping,
                last_delivery=r.last_delivery.isoformat() if r.last_delivery else "-"
            )
            for r in results
        ]
    }


# --- 3. Daily Summary ---
@router.get("/daily-summary")
def get_daily_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    employee_permission_required(
        "delivery_reports.view",
        current_user,
        db
    )

    query = db.query(
        func.date(func.timezone("Asia/Kolkata", Order.order_date)).label("delivery_date"),
        func.count(Order.id).label("total_orders"),
        func.sum(effective_delivered_expression()).label("total_cans"),
        func.sum(effective_empty_expression()).label("total_empty")
    ).join(Store)

    query = apply_role_filters(query, current_user)

    results = (
        query.group_by(func.date(func.timezone("Asia/Kolkata", Order.order_date)))
        .order_by(func.date(func.timezone("Asia/Kolkata", Order.order_date)).desc())
        .all()
    )

    return {"rows": [dict(r._mapping) for r in results]}


# --- 4. Exceptions ---
@router.get("/exceptions")
def get_exceptions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    employee_permission_required(
        "delivery_reports.view",
        current_user,
        db
    )

    time_threshold = datetime.now() - timedelta(hours=24)

    query = db.query(Order).join(Store).filter(
        and_(
            Order.created_at < time_threshold,
            Order.status != OrderStatusEnum.delivered_confirmed
        )
    )

    query = apply_role_filters(query, current_user)

    orders = query.all()

    return {
        "rows": [
            {
                "order_id": o.id,
                "outlet": o.store.store_name if o.store else None,
                "status": o.status.value if o.status else None,
                "created_at": o.created_at,
                "reason": "Delayed > 24 Hours"
            }
            for o in orders
        ]
    }
