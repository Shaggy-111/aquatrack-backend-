from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session, joinedload

from ..database.db import get_db
from ..models.permission import Permission
from ..models.bottle import Bottle
from ..models.complaint import Complaint, ComplaintStatusEnum
from ..models.employee_store_mapping import EmployeeStoreMapping
from ..models.order import Order, OrderStatusEnum
from ..models.partner_store import PartnerStore
from ..models.store import Store
from ..models.user import RoleEnum, User
from ..schemas.permission import SidebarModuleOut
from ..utils.jwt import get_current_user
from ..utils.permission_seeder import build_sidebar_modules
from ..utils.permissions import get_employee_permissions, require_permission


router = APIRouter(prefix="/employees/me", tags=["Employee Menu"])


SIDEBAR_MODULES = build_sidebar_modules()
RECENT_ORDER_LIMIT = 10


def _employee_only(current_user: User) -> None:
    if current_user.role != RoleEnum.employee:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only employees can access this endpoint.",
        )


def _assigned_store_ids(employee_id: int, db: Session) -> List[str]:
    """The sole EmployeeStoreMapping lookup used by an employee dashboard request."""
    rows = (
        db.query(EmployeeStoreMapping.store_id)
        .filter(EmployeeStoreMapping.employee_id == employee_id)
        .all()
    )
    return list(dict.fromkeys(row.store_id for row in rows))


def _assigned_stores(store_ids: List[str], db: Session):
    if not store_ids:
        return []

    partner_names = {}
    for store_id, partner_name in (
        db.query(PartnerStore.store_id, User.full_name)
        .join(User, User.id == PartnerStore.user_id)
        .filter(PartnerStore.store_id.in_(store_ids))
        .order_by(PartnerStore.store_id.asc(), User.full_name.asc())
        .all()
    ):
        partner_names.setdefault(store_id, partner_name)

    stores = (
        db.query(Store)
        .options(joinedload(Store.assigned_manager))
        .filter(
            Store.id.in_(store_ids),
            Store.is_active.is_(True),
        )
        .order_by(Store.store_name.asc())
        .all()
    )
    return [
        {
            "id": store.id,
            "store_name": store.store_name,
            "city": store.city,
            "channel": store.channel,
            "is_active": store.is_active,
            "partner_name": partner_names.get(store.id),
            "assigned_manager": (
                store.assigned_manager.full_name if store.assigned_manager else None
            ),
        }
        for store in stores
    ]


def _order_payload(order: Order):
    return {
        "id": order.id,
        "store_id": order.store_id,
        "store_name": order.store.store_name if order.store else None,
        "city": order.store.city if order.store else None,
        "channel": order.store.channel if order.store else None,
        "partner_name": order.partner.full_name if order.partner else None,
        "status": order.status.value if hasattr(order.status, "value") else str(order.status),
        "bottles": int(order.order_details) if order.order_details else 0,
        "bottles_delivered": order.bottles_delivered or 0,
        "total_amount": float(order.total_amount or 0),
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
    }


def _get_all_active_permission_keys(db: Session) -> List[str]:
    rows = (
        db.query(Permission.permission_key)
        .filter(Permission.is_active.is_(True))
        .order_by(Permission.sort_order.asc(), Permission.permission_key.asc())
        .all()
    )
    return [row.permission_key for row in rows]


@router.get("/permissions", response_model=List[str])
def get_my_permissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == RoleEnum.superadmin:
        return _get_all_active_permission_keys(db)

    if current_user.role in (RoleEnum.employee, RoleEnum.channel_admin):
        return get_employee_permissions(current_user.id, db=db)

    return []


@router.get("/sidebar", response_model=List[SidebarModuleOut])
def get_my_sidebar(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == RoleEnum.superadmin:
        permission_keys = set(_get_all_active_permission_keys(db))
    elif current_user.role in (RoleEnum.employee, RoleEnum.channel_admin):
        permission_keys = set(get_employee_permissions(current_user.id, db=db))
    else:
        permission_keys = set()

    has_wildcard = "*" in permission_keys or "*.*" in permission_keys
    return [
        item
        for item in SIDEBAR_MODULES
        if has_wildcard or item["permission"] in permission_keys
    ]


@router.get("/stores")
def get_my_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.view")),
):
    _employee_only(current_user)
    store_ids = _assigned_store_ids(current_user.id, db)
    return _assigned_stores(store_ids, db)


@router.get("/store-managers")
def get_my_store_managers(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("store_manager.view")),
):
    _employee_only(current_user)
    store_ids = _assigned_store_ids(current_user.id, db)
    if not store_ids:
        return []

    # One joined query returns managers and only the stores inside employee scope.
    rows = (
        db.query(
            User.id.label("manager_id"),
            User.full_name.label("manager_name"),
            User.email,
            User.mobile_number,
            Store.id.label("store_id"),
            Store.store_name,
            Store.city,
            Store.channel,
            Store.is_active,
        )
        .join(PartnerStore, PartnerStore.user_id == User.id)
        .join(Store, Store.id == PartnerStore.store_id)
        .filter(
            User.role == RoleEnum.partner,
            Store.id.in_(store_ids),
            Store.is_active.is_(True),
        )
        .order_by(User.full_name.asc(), Store.store_name.asc())
        .all()
    )

    managers = {}
    for row in rows:
        manager = managers.setdefault(
            row.manager_id,
            {
                "id": row.manager_id,
                "name": row.manager_name,
                "email": row.email,
                "mobile": row.mobile_number,
                "assigned_store_count": 0,
                "assigned_stores": [],
            },
        )
        manager["assigned_stores"].append(
            {
                "id": row.store_id,
                "store_name": row.store_name,
                "city": row.city,
                "channel": row.channel,
                "is_active": row.is_active,
            }
        )
        manager["assigned_store_count"] += 1

    return list(managers.values())


@router.get("/delivery-managers")
def get_my_delivery_managers(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("delivery_manager.view")),
):
    _employee_only(current_user)
    store_ids = _assigned_store_ids(current_user.id, db)
    if not store_ids:
        return []

    rows = (
        db.query(
            User.id.label("manager_id"),
            User.full_name.label("manager_name"),
            User.email,
            User.mobile_number,
            func.count(Store.id).label("assigned_store_count"),
        )
        .join(Store, Store.assigned_manager_id == User.id)
        .filter(
            User.role == RoleEnum.delivery_manager,
            Store.id.in_(store_ids),
        )
        .group_by(User.id, User.full_name, User.email, User.mobile_number)
        .order_by(User.full_name.asc())
        .all()
    )

    return [
        {
            "id": row.manager_id,
            "name": row.manager_name,
            "email": row.email,
            "mobile": row.mobile_number,
            "assigned_store_count": row.assigned_store_count or 0,
        }
        for row in rows
    ]


@router.get("/dashboard")
def get_my_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.view")),
):
    _employee_only(current_user)

    # Resolve employee scope once. Every data query below uses this exact list.
    store_ids = _assigned_store_ids(current_user.id, db)
    if not store_ids:
        return {
            "assigned_store_count": 0,
            "stores": [],
            "dashboard": {
                "total_orders": 0,
                "pending_orders": 0,
                "completed_orders": 0,
                "complaints": 0,
                "bottles": 0,
            },
            "recent_orders": [],
            "recent_activity": [],
        }

    stores = _assigned_stores(store_ids, db)

    order_metrics = (
        db.query(
            func.count(Order.id).label("total_orders"),
            func.sum(
                case((Order.status == OrderStatusEnum.pending, 1), else_=0)
            ).label("pending_orders"),
            func.sum(
                case((Order.status == OrderStatusEnum.delivered_confirmed, 1), else_=0)
            ).label("completed_orders"),
            func.sum(
                case((Order.status == OrderStatusEnum.cancelled, 1), else_=0)
            ).label("cancelled_orders"),
            func.sum(Order.total_amount).label("revenue"),
        )
        .filter(Order.store_id.in_(store_ids))
        .one()
    )

    complaint_metrics = (
        db.query(
            func.count(Complaint.id).label("total"),
            func.sum(
                case((Complaint.status == ComplaintStatusEnum.pending, 1), else_=0)
            ).label("pending"),
            func.sum(
                case((Complaint.status == ComplaintStatusEnum.resolved, 1), else_=0)
            ).label("resolved"),
        )
        .filter(Complaint.store_id.in_(store_ids))
        .one()
    )

    bottle_rows = (
        db.query(Bottle.status, func.count(Bottle.uuid).label("count"))
        .filter(Bottle.assigned_to_store_id.in_(store_ids))
        .group_by(Bottle.status)
        .all()
    )
    bottle_status_breakdown = {row.status: row.count for row in bottle_rows}
    total_bottles = sum(bottle_status_breakdown.values())

    order_load = (
        joinedload(Order.store),
        joinedload(Order.partner),
    )
    recent_orders = (
        db.query(Order)
        .filter(Order.store_id.in_(store_ids))
        .options(*order_load)
        .order_by(Order.created_at.desc())
        .limit(RECENT_ORDER_LIMIT)
        .all()
    )
    pending_orders = (
        db.query(Order)
        .filter(
            Order.store_id.in_(store_ids),
            Order.status == OrderStatusEnum.pending,
        )
        .options(*order_load)
        .order_by(Order.created_at.desc())
        .limit(RECENT_ORDER_LIMIT)
        .all()
    )

    store_summary_rows = (
        db.query(
            Store.id.label("store_id"),
            Store.store_name,
            func.count(Order.id).label("total_orders"),
            func.sum(
                case((Order.status == OrderStatusEnum.pending, 1), else_=0)
            ).label("pending_orders"),
            func.sum(
                case((Order.status == OrderStatusEnum.delivered_confirmed, 1), else_=0)
            ).label("completed_orders"),
        )
        .outerjoin(Order, and_(Order.store_id == Store.id, Order.store_id.in_(store_ids)))
        .filter(Store.id.in_(store_ids))
        .group_by(Store.id, Store.store_name)
        .order_by(Store.store_name.asc())
        .all()
    )

    return {
        "assigned_store_count": len(stores),
        "stores": stores,
        "dashboard": {
            "total_orders": order_metrics.total_orders or 0,
            "pending_orders": order_metrics.pending_orders or 0,
            "completed_orders": order_metrics.completed_orders or 0,
            "cancelled_orders": order_metrics.cancelled_orders or 0,
            "total_stores": len(stores),
            "complaints": complaint_metrics.total or 0,
            "bottles": total_bottles,
            "revenue": float(order_metrics.revenue or 0),
        },
        "recent_orders": [_order_payload(order) for order in recent_orders],
        # No persisted activity/audit dashboard source exists in the backend.
        "recent_activity": [],
        "pending_orders": [_order_payload(order) for order in pending_orders],
        "complaint_summary": {
            "total": complaint_metrics.total or 0,
            "pending": complaint_metrics.pending or 0,
            "resolved": complaint_metrics.resolved or 0,
        },
        "bottle_summary": {
            "total_bottles": total_bottles,
            "status_breakdown": bottle_status_breakdown,
        },
        "store_summary": [
            {
                "store_id": row.store_id,
                "store_name": row.store_name,
                "total_orders": row.total_orders or 0,
                "pending_orders": row.pending_orders or 0,
                "completed_orders": row.completed_orders or 0,
            }
            for row in store_summary_rows
        ],
    }
