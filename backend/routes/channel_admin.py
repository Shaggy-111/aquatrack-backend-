from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database.db import get_db
from ..models.user import User, RoleEnum
from ..models.store import Store
from ..models.order import Order
from ..utils.jwt import get_current_user

router = APIRouter(prefix="/channel-admin", tags=["Channel Admin"])


@router.get("/me/dashboard")
def channel_admin_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 🔐 Role check
    if current_user.role != RoleEnum.channel_admin:
        raise HTTPException(status_code=403, detail="Only channel admins allowed.")

    if not current_user.channel:
        raise HTTPException(status_code=400, detail="Channel not assigned.")

    # ✅ Normalize channel
    channel = current_user.channel.strip().lower()

    # =====================================================
    # 📦 FETCH STORES
    # =====================================================
    stores = db.query(Store).filter(
        func.lower(Store.channel) == channel
    ).all()

    store_map = {s.id: s for s in stores}
    store_ids = list(store_map.keys())

    # =====================================================
    # 👥 FETCH PARTNERS
    # =====================================================
    partners = db.query(User).filter(
        User.role == RoleEnum.partner,
        func.lower(User.channel) == channel
    ).all()

    partner_map = {p.id: p for p in partners}

    # =====================================================
    # 📦 FETCH ORDERS
    # =====================================================
    orders = []
    if store_ids:
        orders = db.query(Order).filter(
            Order.store_id.in_(store_ids)
        ).order_by(Order.created_at.desc()).all()

    # =====================================================
    # 🚀 BUILD RESPONSE
    # =====================================================
    orders_list = []

    for order in orders:
        store = store_map.get(order.store_id)
        partner = partner_map.get(order.partner_id)

        orders_list.append({
            "id": order.id,

            # 🧴 Bottles
            "bottles": int(order.order_details) if order.order_details else 0,
            "bottles_delivered": order.bottles_delivered or 0,

            # 📊 Status
            "status": order.status.value if hasattr(order.status, "value") else str(order.status),

            # 📅 Dates
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "order_date": order.order_date.isoformat() if order.order_date else None,
            "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,

            # 🏬 Store
            "store_id": order.store_id,
            "store_name": store.store_name if store else None,
            "city": store.city if store else None,

            # 👤 Ordered By
            "poc_name": order.poc_name,
            "ordered_by_type": order.ordered_by_type,
            "partner_name": partner.full_name if partner else None,

            # 🚚 Delivery Info (🔥 IMPORTANT FIX)
            "delivery_person_name": (
                order.delivery_person.full_name
                if order.delivery_person else None
            ),
            "delivered_by": order.delivered_by,
            "vehicle_info": order.vehicle_info,

            # 📸 Proof
            "delivery_photo_url": order.delivery_photo_url,
        })

    # =====================================================
    # 📤 FINAL RESPONSE
    # =====================================================
    return {
        "channel": channel.upper(),
        "total_stores": len(stores),
        "total_partners": len(partners),
        "total_orders": len(orders),

        # ⚠️ Avoid raw SQLAlchemy objects (future safe)
        "stores": [
            {"id": s.id, "name": s.store_name , "city": s.city, "state": s.state} for s in stores
        ],
        "partners": [
            {"id": p.id, "name": p.full_name} for p in partners
        ],

        # 🔥 MAIN DATA
        "orders": orders_list,
    }