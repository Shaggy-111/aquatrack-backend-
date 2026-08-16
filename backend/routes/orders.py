from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import func, distinct, case, and_, or_
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import datetime
import logging

from ..database.db import get_db
from ..models.order import Order, OrderStatusEnum
from ..models.user import User, RoleEnum
from ..models.store import Store
from ..schemas.order import OrderCreate, OrderOut, OrderPatch, OrderUpdateStatusSchema
from ..utils.jwt import get_current_user
from ..utils.store_status import require_active_store, require_active_store_before_commit
from ..utils.permissions import get_employee_store_ids, require_permission
from ..services.monthly_virtual_card import (
    MonthlyVirtualCardDomainError,
    sync_order_to_monthly_virtual_card,
)
import pytz
ist = pytz.timezone("Asia/Kolkata")
logger = logging.getLogger(__name__)

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


def employee_store_access_required(
    store_id: str,
    current_user: User,
    db: Session
):
    if current_user.role != RoleEnum.employee:
        return

    assigned_store_ids = get_employee_store_ids(
        current_user.id,
        db=db
    )

    if store_id not in assigned_store_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Store not assigned to you."
        )


router = APIRouter()

# ----------------------------------------------------
# Partner: Get My Orders
# ----------------------------------------------------
@router.get("/partner/orders/me", response_model=List[OrderOut], tags=["Partner"])
def get_my_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "orders.view",
            current_user,
            db
        )
        my_orders = (
            db.query(Order)
            .filter(
                Order.store_id.in_(
                    get_employee_store_ids(
                        current_user.id,
                        db=db
                    )
                )
            )
            .options(
                joinedload(Order.store)
                .joinedload(Store.assigned_manager),
                joinedload(Order.delivery_person)
            )
            .all()
        )
    else:
        if current_user.role != RoleEnum.partner:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only a partner can perform this action."
            )

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
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "orders.create",
            current_user,
            db
        )
        employee_store_access_required(
            order_data.store_id,
            current_user,
            db
        )
    elif current_user.role != RoleEnum.partner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a partner can perform this action."
        )

    try:
        # 1️⃣ Validate store ownership
        if current_user.role == RoleEnum.employee:
            store = (
                db.query(Store)
                .filter(Store.id == order_data.store_id)
                .first()
            )
        else:
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

        require_active_store(store)

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
        require_active_store_before_commit(db, store.id)
        db.commit()
        db.refresh(new_order)

        return new_order

    except HTTPException:
        raise
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
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "orders.edit",
            current_user,
            db
        )
    elif current_user.role not in [
        RoleEnum.delivery,
        RoleEnum.delivery_manager,
        RoleEnum.superadmin
    ]:
        raise HTTPException(status_code=403, detail="Not authorized")

    order = db.query(Order).filter(Order.id == order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    employee_store_access_required(
        order.store_id,
        current_user,
        db
    )

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

    effective_delivered = (
        order.confirmed_bottles
        if order.confirmed_bottles is not None
        else order.bottles_delivered
    )
    try:
        if int(effective_delivered or 0) > 0:
            sync_order_to_monthly_virtual_card(db, order)
        else:
            logger.info(
                "Monthly Virtual Card sync skipped for delivered order %s: "
                "no positive delivered quantity",
                order.id,
            )
        db.commit()
    except MonthlyVirtualCardDomainError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
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
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "orders.view",
            current_user,
            db
        )
        store_filter = Order.store_id.in_(
            get_employee_store_ids(
                current_user.id,
                db=db
            )
        )
    else:
        if current_user.role != RoleEnum.superadmin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only a super admin can perform this action."
            )
        store_filter = Order.id != None

    orders = (
        db.query(Order)
        .filter(
            Order.status == "pending",
            Order.assigned_to_manager_id == None,
            store_filter
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
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "orders.view",
            current_user,
            db
        )
        store_filter = Order.store_id.in_(
            get_employee_store_ids(
                current_user.id,
                db=db
            )
        )
    else:
        if current_user.role != RoleEnum.superadmin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only a super admin can perform this action."
            )
        store_filter = Order.id != None

    pending_orders = (
        db.query(Order)
        .filter(
            Order.status == "pending",
            store_filter
        )
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
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    channel: Optional[str] = None,
    supplier: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "orders.view",
            current_user,
            db
        )
        orders_query = db.query(Order).filter(
            Order.store_id.in_(
                get_employee_store_ids(
                    current_user.id,
                    db=db
                )
            )
        )
    else:
        orders_query = db.query(Order)

    requires_store_join = bool(search or channel)
    requires_partner_join = bool(supplier)

    if requires_store_join:
        orders_query = orders_query.join(Order.store)

    if requires_partner_join:
        orders_query = orders_query.join(Order.partner)

    if search:
        search_like = f"%{search.strip()}%"
        orders_query = orders_query.filter(
            or_(
                Store.store_name.ilike(search_like),
                Order.poc_name.ilike(search_like)
            )
        )

    if status_filter:
        normalized_filter = status_filter.strip().lower()

        if normalized_filter == "delivered":
            orders_query = orders_query.filter(
                Order.status == OrderStatusEnum.delivered_confirmed
            )
        elif normalized_filter == "pending":
            orders_query = orders_query.filter(
                Order.status != OrderStatusEnum.delivered_confirmed
            )
        elif normalized_filter != "all":
            try:
                normalized_status = OrderStatusEnum(normalized_filter)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid status filter."
                )
            orders_query = orders_query.filter(Order.status == normalized_status)

    if channel:
        orders_query = orders_query.filter(
            func.lower(Store.channel) == channel.lower()
        )

    if supplier:
        orders_query = orders_query.filter(
            func.lower(User.full_name) == supplier.lower()
        )

    if from_date:
        orders_query = orders_query.filter(Order.order_date >= from_date)

    if to_date:
        orders_query = orders_query.filter(Order.order_date <= to_date)

    total = (
        orders_query
        .with_entities(func.count(Order.id))
        .order_by(None)
        .scalar()
        or 0
    )

    offset = (page - 1) * page_size

    all_orders = (
        orders_query
        .options(
            joinedload(Order.partner),
            joinedload(Order.delivery_person),
            joinedload(Order.manager_assigned),
            joinedload(Order.store)
        )
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(page_size)
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
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
        "total_orders": total,
        "orders": orders_list
    }


# ----------------------------------------------------
# Super Admin: Manager-wise Orders Summary
# ----------------------------------------------------
@router.get(
    "/superadmin/orders/summary",
    tags=["Super Admin"]
)
def get_manager_orders_summary(
    search: Optional[str] = None,
    channel: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "orders.view",
            current_user,
            db
        )
        store_filter = Order.store_id.in_(
            get_employee_store_ids(
                current_user.id,
                db=db
            )
        )
    else:
        if current_user.role != RoleEnum.superadmin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only a super admin can perform this action."
            )
        store_filter = Order.id != None

    base_query = (
        db.query(
            Order.assigned_to_manager_id.label("manager_id"),
            User.full_name.label("manager_name"),
            func.count(Order.id).label("total_orders"),
            func.sum(
                case((Order.status != OrderStatusEnum.delivered_confirmed, 1), else_=0)
            ).label("pending_orders"),
            func.sum(
                case((Order.status == OrderStatusEnum.delivered_confirmed, 1), else_=0)
            ).label("delivered_orders"),
            func.count(distinct(Order.store_id)).label("stores_count")
        )
        .outerjoin(User, User.id == Order.assigned_to_manager_id)
        .filter(
            Order.assigned_to_manager_id.isnot(None),
            store_filter
        )
    )

    # Keep original query path unchanged for maximum performance.
    if search or channel:
        base_query = base_query.join(Order.store)

        if search:
            search_like = f"%{search.strip()}%"
            base_query = base_query.filter(
                or_(
                    Store.store_name.ilike(search_like),
                    Order.poc_name.ilike(search_like)
                )
            )

        if channel:
            base_query = base_query.filter(
                func.lower(Store.channel) == channel.lower()
            )

    summary_rows = (
        base_query
        .group_by(
            Order.assigned_to_manager_id,
            User.full_name
        )
        .order_by(User.full_name.asc())
        .all()
    )

    return [
        {
            "manager_id": row.manager_id,
            "manager_name": row.manager_name,
            "total_orders": row.total_orders,
            "pending_orders": row.pending_orders,
            "delivered_orders": row.delivered_orders,
            "stores_count": row.stores_count,
        }
        for row in summary_rows
    ]


# ----------------------------------------------------
# Super Admin: One Manager Orders
# ----------------------------------------------------
@router.get(
    "/superadmin/orders/manager/{manager_id}",
    tags=["Super Admin"]
)
def get_manager_orders(
    manager_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    channel: Optional[str] = None,
    search: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "orders.view",
            current_user,
            db
        )
        query = db.query(Order).filter(
            Order.store_id.in_(
                get_employee_store_ids(
                    current_user.id,
                    db=db
                )
            )
        )
    else:
        if current_user.role != RoleEnum.superadmin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only a super admin can perform this action."
            )
        query = db.query(Order)

    # Apply manager filter first.
    query = query.filter(Order.assigned_to_manager_id == manager_id)

    requires_store_join = bool(channel or search)
    if requires_store_join:
        query = query.join(Order.store)

    if status_filter:
        try:
            normalized_status = OrderStatusEnum(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid status filter."
            )
        query = query.filter(Order.status == normalized_status)

    if channel:
        query = query.filter(func.lower(Store.channel) == channel.lower())

    if search:
        search_like = f"%{search.strip()}%"
        query = query.filter(
            Store.store_name.ilike(search_like)
            | Order.poc_name.ilike(search_like)
        )

    if from_date:
        query = query.filter(Order.order_date >= from_date)

    if to_date:
        query = query.filter(Order.order_date <= to_date)

    total = query.with_entities(func.count(Order.id)).order_by(None).scalar() or 0

    offset = (page - 1) * page_size

    orders = (
        query
        .options(
            joinedload(Order.partner),
            joinedload(Order.delivery_person),
            joinedload(Order.manager_assigned),
            joinedload(Order.store)
        )
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )

    orders_list = []

    for order in orders:
        store = order.store
        partner = order.partner
        delivery_person = order.delivery_person

        status_value = (
            order.status.value
            if hasattr(order.status, "value")
            else str(order.status)
        )

        orders_list.append({
            "id": order.id,
            "bottles": int(order.order_details)
            if order.order_details else 0,
            "bottles_delivered": order.bottles_delivered or 0,
            "status": status_value,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "order_date": order.order_date.isoformat() if order.order_date else None,
            "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
            "store_id": order.store_id,
            "store_name": store.store_name if store else None,
            "city": store.city if store else None,
            "state": store.state if store else None,
            "poc_name": order.poc_name,
            "partner_name": partner.full_name if partner else None,
            "delivered_by": (
                delivery_person.full_name
                if delivery_person
                else "Not Assigned"
            ),
            "assigned_manager": (
                order.manager_assigned.full_name
                if order.manager_assigned
                else "Not Assigned"
            ),
            "vehicle_info": order.vehicle_info,
            "delivery_photo_url": order.delivery_photo_url,
            "channel": (
                store.channel.upper()
                if store and store.channel
                else "GENERAL"
            ),
        })

    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "orders": orders_list,
    }


def _build_manager_order_payload(order: Order):
    store = order.store
    partner = order.partner
    delivery_person = order.delivery_person

    status_value = (
        order.status.value
        if hasattr(order.status, "value")
        else str(order.status)
    )

    return {
        "id": order.id,
        "bottles": int(order.order_details)
        if order.order_details else 0,
        "bottles_delivered": order.bottles_delivered or 0,
        "status": status_value,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
        "store_id": order.store_id,
        "store_name": store.store_name if store else None,
        "city": store.city if store else None,
        "state": store.state if store else None,
        "poc_name": order.poc_name,
        "partner_name": partner.full_name if partner else None,
        "delivered_by": (
            delivery_person.full_name
            if delivery_person
            else "Not Assigned"
        ),
        "assigned_manager": (
            order.manager_assigned.full_name
            if order.manager_assigned
            else "Not Assigned"
        ),
        "vehicle_info": order.vehicle_info,
        "delivery_photo_url": order.delivery_photo_url,
        "channel": (
            store.channel.upper()
            if store and store.channel
            else "GENERAL"
        ),
    }


# ----------------------------------------------------
# Super Admin: Manager-wise Store Summary
# ----------------------------------------------------
@router.get(
    "/superadmin/orders/manager/{manager_id}/stores",
    tags=["Super Admin"]
)
def get_manager_store_summary(
    manager_id: int,
    search: Optional[str] = None,
    channel: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "orders.view",
            current_user,
            db
        )
        store_scope = Store.id.in_(
            get_employee_store_ids(
                current_user.id,
                db=db
            )
        )
    else:
        if current_user.role != RoleEnum.superadmin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only a super admin can perform this action."
            )
        store_scope = Store.assigned_manager_id == manager_id

    order_join_conditions = [
        Order.store_id == Store.id,
        Order.assigned_to_manager_id == manager_id,
    ]

    if status_filter:
        try:
            normalized_status = OrderStatusEnum(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid status filter."
            )
        order_join_conditions.append(Order.status == normalized_status)

    if from_date:
        order_join_conditions.append(Order.order_date >= from_date)

    if to_date:
        order_join_conditions.append(Order.order_date <= to_date)

    query = (
        db.query(
            Store.id.label("store_id"),
            Store.store_name.label("store_name"),
            Store.city.label("city"),
            Store.channel.label("channel"),
            func.count(Order.id).label("total_orders"),
            func.coalesce(
                func.sum(
                    case((Order.status != OrderStatusEnum.delivered_confirmed, 1), else_=0)
                ),
                0
            ).label("pending_orders"),
            func.coalesce(
                func.sum(
                    case((Order.status == OrderStatusEnum.delivered_confirmed, 1), else_=0)
                ),
                0
            ).label("delivered_orders"),
        )
        .select_from(Store)
        .outerjoin(Order, and_(*order_join_conditions))
        .filter(store_scope)
    )

    if channel:
        query = query.filter(func.lower(Store.channel) == channel.lower())

    if search:
        search_like = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Store.store_name.ilike(search_like),
                Order.poc_name.ilike(search_like)
            )
        )

    store_rows = (
        query
        .group_by(Store.id)
        .order_by(Store.store_name.asc())
        .all()
    )

    return [
        {
            "store_id": row.store_id,
            "store_name": row.store_name,
            "city": row.city,
            "channel": row.channel.upper() if row.channel else "GENERAL",
            "total_orders": row.total_orders,
            "pending_orders": row.pending_orders,
            "delivered_orders": row.delivered_orders,
        }
        for row in store_rows
    ]


# ----------------------------------------------------
# Super Admin: One Store Orders
# ----------------------------------------------------
@router.get(
    "/superadmin/orders/store/{store_id}",
    tags=["Super Admin"]
)
def get_store_orders(
    store_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    channel: Optional[str] = None,
    search: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "orders.view",
            current_user,
            db
        )
        query = db.query(Order).filter(
            Order.store_id.in_(
                get_employee_store_ids(
                    current_user.id,
                    db=db
                )
            )
        )
    else:
        if current_user.role != RoleEnum.superadmin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only a super admin can perform this action."
            )
        query = db.query(Order)

    query = query.filter(Order.store_id == store_id)

    if channel or search:
        query = query.join(Order.store)

    if status_filter:
        try:
            normalized_status = OrderStatusEnum(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid status filter."
            )
        query = query.filter(Order.status == normalized_status)

    if channel:
        query = query.filter(func.lower(Store.channel) == channel.lower())

    if search:
        search_like = f"%{search.strip()}%"
        query = query.filter(
            Store.store_name.ilike(search_like)
            | Order.poc_name.ilike(search_like)
        )

    if from_date:
        query = query.filter(Order.order_date >= from_date)

    if to_date:
        query = query.filter(Order.order_date <= to_date)

    total = query.with_entities(func.count(Order.id)).order_by(None).scalar() or 0
    offset = (page - 1) * page_size

    orders = (
        query
        .options(
            joinedload(Order.partner),
            joinedload(Order.delivery_person),
            joinedload(Order.manager_assigned),
            joinedload(Order.store)
        )
        .order_by(Order.created_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )

    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
        "orders": [
            _build_manager_order_payload(order)
            for order in orders
        ],
    }
