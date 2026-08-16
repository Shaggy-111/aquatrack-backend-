from datetime import datetime, date, timedelta
import pytz

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, case, and_
from sqlalchemy.orm import Session

from ..database.db import get_db

from ..models.user import User, RoleEnum
from ..models.order import Order, OrderStatusEnum
from ..models.store import Store
from ..models.report import Report
from ..models.complaint import Complaint, ComplaintStatusEnum
from ..models.bottle import Bottle

from ..utils.jwt import get_current_user

router = APIRouter()

IST = pytz.timezone("Asia/Kolkata")


def _authorize_dashboard(current_user: User):
    """
    Dashboard is only accessible by Super Admin.
    (Employee support can be added later if required.)
    """
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can access dashboard."
        )


@router.get(
    "/summary",
    tags=["Dashboard"]
)
def dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    _authorize_dashboard(current_user)

    # ------------------------------------------------------
    # Time Boundary Pre-computations (PostgreSQL Index-friendly)
    # ------------------------------------------------------
    now_ist = datetime.now(IST)
    
    # Today's boundaries
    today_start = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_start = today_start + timedelta(days=1)
    
    # Current month's boundaries
    month_start = now_ist.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start.month == 12:
        next_month_start = month_start.replace(year=month_start.year + 1, month=1)
    else:
        next_month_start = month_start.replace(month=month_start.month + 1)

    # Initialize exact required JSON structure
    summary = {
        "orders": {},
        "stores": {},
        "users": {},
        "complaints": {},
        "reports": {},
        "bottles": {},
        "revenue": {}
    }

    # ======================================================
    # 1. Orders & Revenue Aggregated Core Query
    # ======================================================
    order_stmt = select(
        func.count(Order.id).label("total"),
        func.count(case((Order.status == OrderStatusEnum.pending, 1))).label("pending"),
        func.count(case((and_(Order.order_date >= today_start, Order.order_date < tomorrow_start), 1))).label("today"),
        func.count(case((and_(Order.status == OrderStatusEnum.delivered_confirmed, Order.delivered_at >= today_start, Order.delivered_at < tomorrow_start), 1))).label("delivered_today"),
        func.count(case((and_(Order.status == OrderStatusEnum.pending, Order.assigned_to_manager_id.is_(None)), 1))).label("manual_assignment"),
        func.count(case((and_(Order.order_date >= month_start, Order.order_date < next_month_start), 1))).label("monthly"),
        func.count(case((and_(Order.status == OrderStatusEnum.delivered_confirmed, Order.order_date >= month_start, Order.order_date < next_month_start), 1))).label("monthly_delivered"),
        func.sum(Order.total_amount).label("total_revenue"),
        func.sum(case((and_(Order.order_date >= month_start, Order.order_date < next_month_start), Order.total_amount), else_=0)).label("monthly_revenue")
    )
    
    order_metrics = db.execute(order_stmt).one()

    summary["orders"]["total"] = order_metrics.total or 0
    summary["orders"]["pending"] = order_metrics.pending or 0
    summary["orders"]["today"] = order_metrics.today or 0
    summary["orders"]["delivered_today"] = order_metrics.delivered_today or 0
    summary["orders"]["manual_assignment"] = order_metrics.manual_assignment or 0
    summary["orders"]["monthly"] = order_metrics.monthly or 0
    summary["orders"]["monthly_delivered"] = order_metrics.monthly_delivered or 0
    
    summary["revenue"]["total"] = float(order_metrics.total_revenue or 0)
    summary["revenue"]["monthly"] = float(order_metrics.monthly_revenue or 0)

    # ======================================================
    # 2. Stores Count Query
    # ======================================================
    store_stmt = select(func.count(Store.id))
    summary["stores"]["total"] = db.execute(store_stmt).scalar() or 0

    # ======================================================
    # 3. Users Aggregated Metrics
    # ======================================================
    user_stmt = select(
        func.count(case((User.role == RoleEnum.partner, 1))).label("partners"),
        func.count(case((User.role == RoleEnum.delivery, 1))).label("delivery_partners"),
        func.count(case((User.role == RoleEnum.delivery_manager, 1))).label("delivery_managers"),
        func.count(case((User.role == RoleEnum.channel_admin, 1))).label("channel_admins")
    )
    user_metrics = db.execute(user_stmt).one()
    
    summary["users"]["partners"] = user_metrics.partners or 0
    summary["users"]["delivery_partners"] = user_metrics.delivery_partners or 0
    summary["users"]["delivery_managers"] = user_metrics.delivery_managers or 0
    summary["users"]["channel_admins"] = user_metrics.channel_admins or 0

    # ======================================================
    # 4. Complaints Aggregated Metrics
    # ======================================================
    complaint_stmt = select(
        func.count(case((Complaint.status == ComplaintStatusEnum.pending, 1))).label("pending"),
        func.count(case((Complaint.status == ComplaintStatusEnum.resolved, 1))).label("resolved")
    )
    complaint_metrics = db.execute(complaint_stmt).one()
    
    summary["complaints"]["pending"] = complaint_metrics.pending or 0
    summary["complaints"]["resolved"] = complaint_metrics.resolved or 0

    # ======================================================
    # 5. Reports Count Query
    # ======================================================
    report_stmt = select(func.count(Report.id))
    summary["reports"]["total"] = db.execute(report_stmt).scalar() or 0

    # ======================================================
    # 6. Bottles Aggregated Metrics
    # ======================================================
    bottle_stmt = select(
        func.count(Bottle.uuid).label("total"),
        func.count(case((Bottle.assigned_to_store_id.is_(None), 1))).label("warehouse"),
        func.count(case((Bottle.assigned_to_store_id.isnot(None), 1))).label("at_store"),
        func.count(case((Bottle.assigned_to_delivery_id.isnot(None), 1))).label("with_delivery")
    )
    bottle_metrics = db.execute(bottle_stmt).one()
    
    summary["bottles"]["total"] = bottle_metrics.total or 0
    summary["bottles"]["warehouse"] = bottle_metrics.warehouse or 0
    summary["bottles"]["at_store"] = bottle_metrics.at_store or 0
    summary["bottles"]["with_delivery"] = bottle_metrics.with_delivery or 0

    # ======================================================
    # Dashboard Response
    # ======================================================
    return summary