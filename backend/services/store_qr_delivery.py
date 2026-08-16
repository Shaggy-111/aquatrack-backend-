from datetime import datetime, timedelta, timezone
from typing import Optional

import pytz
from fastapi import HTTPException, status
from sqlalchemy import case, or_
from sqlalchemy.orm import Session

from ..models.order import Order, OrderStatusEnum
from ..models.partner_store import PartnerStore
from ..models.store import Store
from ..models.store_qr_delivery_submission import StoreQrDeliverySubmission
from ..models.user import User
from ..utils.same_day_order import (
    business_day_bounds_utc,
    same_day_non_cancelled_order_query,
)
from .order_delivery import apply_delivery_confirmation, apply_delivery_update
from .monthly_virtual_card import (
    MonthlyVirtualCardDomainError,
    sync_order_to_monthly_virtual_card,
)


IST = pytz.timezone("Asia/Kolkata")
ELIGIBLE_STATUSES = [
    OrderStatusEnum.in_transit,
    OrderStatusEnum.assigned,
    OrderStatusEnum.assigned_to_manager,
    OrderStatusEnum.pending,
]


def _eligible_order_query(db: Session, store_id: str):
    start_utc, end_utc = business_day_bounds_utc()
    priority = case(
        (Order.status == OrderStatusEnum.in_transit, 1),
        (Order.status == OrderStatusEnum.assigned, 2),
        (Order.status == OrderStatusEnum.assigned_to_manager, 3),
        (Order.status == OrderStatusEnum.pending, 4),
        else_=99,
    )
    return (
        db.query(Order)
        .filter(
            Order.store_id == store_id,
            Order.order_date >= start_utc,
            Order.order_date < end_utc,
            Order.status.in_(ELIGIBLE_STATUSES),
        )
        .order_by(priority.asc(), Order.id.asc())
    )


def get_scan_context(db: Session, qr_public_id: str) -> tuple[Store, Optional[Order]]:
    store = db.query(Store).filter(Store.qr_public_id == qr_public_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Invalid Store QR.")
    if not store.qr_enabled:
        raise HTTPException(status_code=410, detail="Store QR is disabled.")
    if not store.is_active:
        raise HTTPException(status_code=409, detail="Store is inactive.")
    return store, _eligible_order_query(db, store.id).first()


def _existing_submission(
    db: Session,
    idempotency_key: str,
    token_jti: str,
) -> Optional[StoreQrDeliverySubmission]:
    return (
        db.query(StoreQrDeliverySubmission)
        .filter(
            or_(
                StoreQrDeliverySubmission.idempotency_key == idempotency_key,
                StoreQrDeliverySubmission.token_jti == token_jti,
            )
        )
        .first()
    )


def submission_response(submission: StoreQrDeliverySubmission) -> dict:
    return {
        "success": True,
        "order_id": submission.order_id,
        "created_order": submission.created_order,
        "status": OrderStatusEnum.delivered_confirmed.value,
        "bottles_delivered": submission.order.bottles_delivered,
        "empty_bottles_collected": submission.order.empty_bottles_collected,
        "submitted_at": submission.submitted_at,
    }


def submit_store_qr_delivery(
    db: Session,
    *,
    qr_public_id: str,
    qr_token_version: int,
    idempotency_key: str,
    token_jti: str,
    bottles_delivered: int,
    empty_bottles_collected: int = 0,
    photo_url: Optional[str],
    remarks: Optional[str],
    delivered_by: Optional[str],
    source_ip: Optional[str],
    user_agent: Optional[str],
    latitude: Optional[float],
    longitude: Optional[float],
    gps_accuracy: Optional[float],
) -> dict:
    replay = _existing_submission(db, idempotency_key, token_jti)
    if replay:
        return submission_response(replay)

    store = (
        db.query(Store)
        .filter(Store.qr_public_id == qr_public_id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    if not store:
        raise HTTPException(status_code=404, detail="Invalid Store QR.")
    if not store.qr_enabled or store.qr_token_version != qr_token_version:
        raise HTTPException(status_code=410, detail="Store QR has been rotated or disabled.")
    if not store.is_active:
        raise HTTPException(status_code=409, detail="Store is inactive.")

    replay = _existing_submission(db, idempotency_key, token_jti)
    if replay:
        return submission_response(replay)

    recent_cutoff = datetime.now(timezone.utc) - timedelta(minutes=1)
    recent_submissions = (
        db.query(StoreQrDeliverySubmission.id)
        .filter(
            StoreQrDeliverySubmission.source_ip == source_ip,
            StoreQrDeliverySubmission.submitted_at >= recent_cutoff,
        )
        .count()
    )
    if recent_submissions >= 10:
        raise HTTPException(status_code=429, detail="Too many QR submissions.")

    start_utc, end_utc = business_day_bounds_utc()
    prior_qr_delivery = (
        db.query(StoreQrDeliverySubmission.id)
        .filter(
            StoreQrDeliverySubmission.store_id == store.id,
            StoreQrDeliverySubmission.submitted_at >= start_utc,
            StoreQrDeliverySubmission.submitted_at < end_utc,
        )
        .first()
    )
    if prior_qr_delivery:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A QR delivery has already been submitted for this store today.",
        )

    order = _eligible_order_query(db, store.id).first()
    created_order = order is None

    if created_order:
        if same_day_non_cancelled_order_query(db, store.id).first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An order already exists for this store today.",
            )

        partner = (
            db.query(User)
            .join(PartnerStore, PartnerStore.user_id == User.id)
            .filter(PartnerStore.store_id == store.id)
            .order_by(User.id.asc())
            .first()
        )
        if not partner:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Store has no Partner mapping.",
            )

        order = Order(
            partner_id=partner.id,
            store_id=store.id,
            assigned_to_manager_id=store.assigned_manager_id,
            status=OrderStatusEnum.delivered_confirmed,
            order_details=str(bottles_delivered),
            total_amount=0,
            channel=store.channel,
            order_date=datetime.now(timezone.utc),
            ordered_by_type="QR_DELIVERY",
        )
        db.add(order)
        db.flush([order])

    delivered_at = datetime.now(IST).replace(tzinfo=None)
    resulting_balance = (
        int(store.pending_empty_bottles or 0)
        + bottles_delivered
        - empty_bottles_collected
    )
    if resulting_balance < 0:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="QR delivery would make pending empty bottle balance negative.",
        )
    apply_delivery_update(
        order,
        status=OrderStatusEnum.delivered_confirmed,
        delivered_at=delivered_at,
        bottles_delivered=bottles_delivered,
        empty_bottles_collected=empty_bottles_collected,
        photo_url=photo_url,
        delivered_by=delivered_by or "QR Browser",
        delivery_note=remarks,
    )
    apply_delivery_confirmation(
        order,
        store,
        confirmed_bottles=bottles_delivered,
        confirmed_empty_bottles=empty_bottles_collected,
        confirmation_remarks=remarks or "Confirmed via Store QR.",
    )

    submission = StoreQrDeliverySubmission(
        store_id=store.id,
        order_id=order.id,
        idempotency_key=idempotency_key,
        token_jti=token_jti,
        qr_token_version=qr_token_version,
        source_ip=source_ip,
        user_agent=user_agent,
        latitude=latitude,
        longitude=longitude,
        gps_accuracy=gps_accuracy,
        delivered_by=delivered_by,
        photo_url=photo_url,
        remarks=remarks,
        created_order=created_order,
    )
    db.add(submission)
    try:
        sync_order_to_monthly_virtual_card(db, order)
        db.commit()
    except MonthlyVirtualCardDomainError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    db.refresh(submission)
    return submission_response(submission)
