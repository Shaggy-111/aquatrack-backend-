from sqlalchemy.exc import IntegrityError
from datetime import date, datetime, time, timedelta, timezone

import pytz
from sqlalchemy.orm import Session

from ..models.monthly_virtual_card import (
    MonthlyVirtualCard,
    MonthlyVirtualCardEntry,
    MonthlyVirtualCardEntryOrder,
)
from ..models.order import Order, OrderStatusEnum
from ..models.partner_store import PartnerStore
from ..models.store import Store
from ..models.user import RoleEnum, User


IST = pytz.timezone("Asia/Kolkata")
NORMAL_ORDER_SOURCE_MARKERS = {
    "",
    "AUTO",
    "AUTOMATIC",
    "SCHEDULED",
    "SYSTEM",
    "VIRTUAL_CARD",
}
ACTIVE_ORDER_STATUSES = {
    OrderStatusEnum.pending,
    OrderStatusEnum.accepted,
    OrderStatusEnum.assigned_to_manager,
    OrderStatusEnum.assigned,
    OrderStatusEnum.in_transit,
}


class MonthlyVirtualCardDomainError(ValueError):
    """Expected Monthly Virtual Card business-rule failure."""


class MonthlyVirtualCardNotFoundError(MonthlyVirtualCardDomainError):
    pass


class MonthlyVirtualCardStoreNotFoundError(MonthlyVirtualCardDomainError):
    pass


class MonthlyVirtualCardMonthMismatchError(MonthlyVirtualCardDomainError):
    pass


class MonthlyVirtualCardClosedError(MonthlyVirtualCardDomainError):
    pass


class MonthlyVirtualCardInactiveStoreError(MonthlyVirtualCardDomainError):
    pass


class MonthlyVirtualCardPartnerMappingError(MonthlyVirtualCardDomainError):
    pass


class MonthlyVirtualCardAmbiguousQuantityError(MonthlyVirtualCardDomainError):
    pass


class MonthlyVirtualCardNegativeBalanceError(MonthlyVirtualCardDomainError):
    pass


def _validate_month(month: int) -> None:
    if month < 1 or month > 12:
        raise ValueError("month must be between 1 and 12")


def _card_query(db: Session, store_id: str, year: int, month: int):
    return db.query(MonthlyVirtualCard).filter(
        MonthlyVirtualCard.store_id == store_id,
        MonthlyVirtualCard.year == year,
        MonthlyVirtualCard.month == month,
    )


def _create_card_with_savepoint(
    db: Session,
    *,
    store_id: str,
    year: int,
    month: int,
) -> tuple[MonthlyVirtualCard, bool]:
    try:
        with db.connection().begin_nested():
            result = db.connection().execute(
                MonthlyVirtualCard.__table__.insert().values(
                    store_id=store_id,
                    year=year,
                    month=month,
                )
            )
            card_id = result.inserted_primary_key[0]
    except IntegrityError:
        existing = _card_query(db, store_id, year, month).first()
        if existing is not None:
            return existing, False
        raise

    card = db.query(MonthlyVirtualCard).filter(
        MonthlyVirtualCard.id == card_id
    ).first()
    if card.created_at is not None and card.created_at.tzinfo is None:
        card.created_at = card.created_at.replace(tzinfo=timezone.utc)
    return card, True


def ensure_monthly_card(
    db: Session,
    store_id: str,
    year: int,
    month: int,
) -> tuple[MonthlyVirtualCard, bool]:
    _validate_month(month)

    store = db.query(Store).filter(Store.id == store_id).first()
    if store is None:
        raise ValueError(f"Store '{store_id}' does not exist")

    existing = _card_query(db, store_id, year, month).first()
    if existing is not None:
        return existing, False

    return _create_card_with_savepoint(
        db,
        store_id=store_id,
        year=year,
        month=month,
    )


def ensure_monthly_cards_for_active_stores(
    db: Session,
    year: int,
    month: int,
) -> dict:
    _validate_month(month)

    active_store_ids = [
        row.id
        for row in db.query(Store.id)
        .filter(Store.is_active.is_(True))
        .order_by(Store.id.asc())
        .all()
    ]

    if not active_store_ids:
        return {
            "total_active_stores": 0,
            "created_count": 0,
            "existing_count": 0,
            "created_card_ids": [],
        }

    existing_store_ids = {
        row.store_id
        for row in db.query(MonthlyVirtualCard.store_id)
        .filter(
            MonthlyVirtualCard.store_id.in_(active_store_ids),
            MonthlyVirtualCard.year == year,
            MonthlyVirtualCard.month == month,
        )
        .all()
    }

    created_card_ids = []
    existing_count = len(existing_store_ids)

    for store_id in active_store_ids:
        if store_id in existing_store_ids:
            continue

        card, created = _create_card_with_savepoint(
            db,
            store_id=store_id,
            year=year,
            month=month,
        )
        if created:
            created_card_ids.append(card.id)
        else:
            existing_count += 1

    return {
        "total_active_stores": len(active_store_ids),
        "created_count": len(created_card_ids),
        "existing_count": existing_count,
        "created_card_ids": created_card_ids,
    }


def _order_business_date(order: Order) -> date:
    """Return the order's calendar date under the card's IST convention."""
    order_date = order.order_date
    if order_date.tzinfo is None:
        order_date = IST.localize(order_date)
    else:
        order_date = order_date.astimezone(IST)
    return order_date.date()


def _create_entry_with_savepoint(
    db: Session,
    *,
    card_id: int,
    business_date: date,
    actor_id: int | None,
) -> tuple[MonthlyVirtualCardEntry, bool]:
    try:
        with db.connection().begin_nested():
            result = db.connection().execute(
                MonthlyVirtualCardEntry.__table__.insert().values(
                    card_id=card_id,
                    entry_date=business_date,
                    entry_source="delivery_manager",
                    created_by_id=actor_id,
                )
            )
            entry_id = result.inserted_primary_key[0]
    except IntegrityError:
        existing = db.query(MonthlyVirtualCardEntry).filter(
            MonthlyVirtualCardEntry.card_id == card_id,
            MonthlyVirtualCardEntry.entry_date == business_date,
        ).first()
        if existing is not None:
            return existing, False
        raise
    entry = db.query(MonthlyVirtualCardEntry).filter(
        MonthlyVirtualCardEntry.id == entry_id
    ).first()
    return entry, True


def _ensure_entry_order_link(
    db: Session,
    *,
    entry_id: int,
    order_id: int,
) -> tuple[MonthlyVirtualCardEntryOrder, bool]:
    existing = db.query(MonthlyVirtualCardEntryOrder).filter(
        MonthlyVirtualCardEntryOrder.entry_id == entry_id,
        MonthlyVirtualCardEntryOrder.order_id == order_id,
    ).first()
    if existing is not None:
        return existing, False

    try:
        with db.connection().begin_nested():
            result = db.connection().execute(
                MonthlyVirtualCardEntryOrder.__table__.insert().values(
                    entry_id=entry_id,
                    order_id=order_id,
                )
            )
            link_id = result.inserted_primary_key[0]
    except IntegrityError:
        existing = db.query(MonthlyVirtualCardEntryOrder).filter(
            MonthlyVirtualCardEntryOrder.entry_id == entry_id,
            MonthlyVirtualCardEntryOrder.order_id == order_id,
        ).first()
        if existing is not None:
            return existing, False
        raise
    link = db.query(MonthlyVirtualCardEntryOrder).filter(
        MonthlyVirtualCardEntryOrder.id == link_id
    ).first()
    return link, True


def sync_order_to_monthly_virtual_card(
    db: Session,
    order: Order,
    actor=None,
):
    """Reflect a delivered order on its store's monthly virtual card.

    Quantities remain sourced from the linked production Order.  This service
    deliberately does not mutate either the Order or the store bottle balance.
    """
    ignored_statuses = {
        OrderStatusEnum.cancelled,
        OrderStatusEnum.rejected,
        OrderStatusEnum.delivery_disputed,
    }
    status = order.status
    if isinstance(status, str):
        try:
            status = OrderStatusEnum(status)
        except ValueError:
            pass
    if status in ignored_statuses:
        return None

    business_date = _order_business_date(order)
    actor_id = getattr(actor, "id", None)

    # Global mutation lock order: Store -> Card -> Entry -> Order.  Targeted
    # flushes above prevent pending Order changes from being flushed (and thus
    # row-locked) before the card structures have been locked.
    with db.no_autoflush:
        store = (
            db.query(Store)
            .filter(Store.id == order.store_id)
            .with_for_update()
            .first()
        )
        if store is None:
            raise MonthlyVirtualCardStoreNotFoundError(
                f"Store '{order.store_id}' does not exist"
            )

        card = _card_query(
            db, order.store_id, business_date.year, business_date.month
        ).with_for_update().first()
        card_created = card is None
        if card is None:
            card, card_created = _create_card_with_savepoint(
                db,
                store_id=order.store_id,
                year=business_date.year,
                month=business_date.month,
            )
            if not card_created:
                card = _card_query(
                    db, order.store_id, business_date.year, business_date.month
                ).with_for_update().first()

        entry = (
            db.query(MonthlyVirtualCardEntry)
            .filter(
                MonthlyVirtualCardEntry.card_id == card.id,
                MonthlyVirtualCardEntry.entry_date == business_date,
            )
            .with_for_update()
            .first()
        )
        if entry is None:
            entry, entry_created = _create_entry_with_savepoint(
                db,
                card_id=card.id,
                business_date=business_date,
                actor_id=actor_id,
            )
            if not entry_created:
                entry = (
                    db.query(MonthlyVirtualCardEntry)
                    .filter(
                        MonthlyVirtualCardEntry.card_id == card.id,
                        MonthlyVirtualCardEntry.entry_date == business_date,
                    )
                    .with_for_update()
                    .first()
                )
        else:
            entry_created = False

        if order.id is None:
            db.flush([order])
        else:
            locked_order = (
                db.query(Order)
                .filter(Order.id == order.id)
                .with_for_update()
                .first()
            )
            if locked_order is None:
                raise MonthlyVirtualCardDomainError(
                    f"Order '{order.id}' does not exist"
                )

    # A null source is legacy delivery-manager data.  Super-admin entries own
    # their manually supplied values; the delivery path may only add its link.
    if entry.entry_source != "super_admin":
        entry.entry_source = "delivery_manager"
        entry.remarks = order.confirmation_remarks or order.delivery_note
        entry.updated_by_id = actor_id

    _, link_created = _ensure_entry_order_link(
        db,
        entry_id=entry.id,
        order_id=order.id,
    )
    db.flush()

    return {
        "card": card,
        "entry": entry,
        "link_created": link_created,
        "entry_created": entry_created,
        "card_created": card_created,
    }


def _entry_day_bounds_utc(entry_date: date) -> tuple[datetime, datetime]:
    start_ist = IST.localize(datetime.combine(entry_date, time.min))
    end_ist = start_ist + timedelta(days=1)
    return start_ist.astimezone(timezone.utc), end_ist.astimezone(timezone.utc)


def _normalized_source(order: Order) -> str:
    return str(order.ordered_by_type or "").strip().upper()


def _is_manual_or_special_order(order: Order) -> bool:
    source = _normalized_source(order)
    if source == "QR_DELIVERY" or source == "ADMIN":
        return True
    if "POC" in source or "MANUAL" in source:
        return True
    if str(order.delivered_by or "").strip().upper() == "EXCEL UPLOAD":
        return True
    return str(order.vehicle_info or "").strip().upper() == "MANUAL UPLOAD"


def _select_order_for_entry(
    db: Session,
    *,
    entry: MonthlyVirtualCardEntry | None,
    store_id: str,
    entry_date: date,
) -> tuple[Order | None, bool]:
    if entry is not None:
        linked_order = (
            db.query(Order)
            .join(
                MonthlyVirtualCardEntryOrder,
                MonthlyVirtualCardEntryOrder.order_id == Order.id,
            )
            .filter(MonthlyVirtualCardEntryOrder.entry_id == entry.id)
            .order_by(MonthlyVirtualCardEntryOrder.id.asc())
            .with_for_update()
            .first()
        )
        if linked_order is not None:
            return linked_order, True

    start_utc, end_utc = _entry_day_bounds_utc(entry_date)
    candidates = (
        db.query(Order)
        .filter(
            Order.store_id == store_id,
            Order.order_date >= start_utc,
            Order.order_date < end_utc,
            Order.status.in_(ACTIVE_ORDER_STATUSES),
        )
        .order_by(Order.id.asc())
        .with_for_update()
        .all()
    )

    eligible = [
        order
        for order in candidates
        if not _is_manual_or_special_order(order)
        and _normalized_source(order) in NORMAL_ORDER_SOURCE_MARKERS
    ]
    for order in eligible:
        return order, False
    return None, False


def _mapped_partner(db: Session, store_id: str) -> User | None:
    return (
        db.query(User)
        .join(PartnerStore, PartnerStore.user_id == User.id)
        .filter(
            PartnerStore.store_id == store_id,
            User.role.in_([RoleEnum.partner, RoleEnum.sub_partner]),
        )
        .order_by(User.id.asc())
        .first()
    )


def upsert_monthly_virtual_card_entry(
    db: Session,
    card_id: int,
    entry_date: date,
    bottles_delivered: int,
    empty_bottles_collected: int | None,
    remarks: str | None,
    current_user,
) -> dict:
    if not isinstance(entry_date, date):
        raise ValueError("entry_date must be a valid calendar date")
    if bottles_delivered < 0:
        raise ValueError("bottles_delivered must be non-negative")
    if empty_bottles_collected is not None and empty_bottles_collected < 0:
        raise ValueError("empty_bottles_collected must be non-negative")
    if current_user is None or getattr(current_user, "id", None) is None:
        raise ValueError("current_user is required")

    card = (
        db.query(MonthlyVirtualCard)
        .filter(MonthlyVirtualCard.id == card_id)
        .first()
    )
    if card is None:
        raise MonthlyVirtualCardNotFoundError(
            f"Monthly virtual card '{card_id}' does not exist"
        )

    store = (
        db.query(Store)
        .filter(Store.id == card.store_id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    if store is None:
        raise MonthlyVirtualCardStoreNotFoundError(
            f"Store '{card.store_id}' does not exist"
        )
    if not store.is_active:
        raise MonthlyVirtualCardInactiveStoreError("Store is inactive")

    card = (
        db.query(MonthlyVirtualCard)
        .filter(MonthlyVirtualCard.id == card_id)
        .populate_existing()
        .with_for_update()
        .first()
    )
    if card is None:
        raise MonthlyVirtualCardNotFoundError(
            f"Monthly virtual card '{card_id}' does not exist"
        )
    if card.status != "open":
        raise MonthlyVirtualCardClosedError("Monthly virtual card is not open")
    if entry_date.year != card.year or entry_date.month != card.month:
        raise MonthlyVirtualCardMonthMismatchError(
            "entry_date must belong to the card year and month"
        )

    entry = (
        db.query(MonthlyVirtualCardEntry)
        .filter(
            MonthlyVirtualCardEntry.card_id == card.id,
            MonthlyVirtualCardEntry.entry_date == entry_date,
        )
        .with_for_update()
        .first()
    )
    entry_created = entry is None

    order, order_already_linked = _select_order_for_entry(
        db,
        entry=entry,
        store_id=store.id,
        entry_date=entry_date,
    )
    order_created = order is None

    partner = None
    if order_created:
        partner = _mapped_partner(db, store.id)
        if partner is None:
            raise MonthlyVirtualCardPartnerMappingError(
                f"Store '{store.id}' has no valid mapped partner/POC for order creation"
            )

    previous_delivered = int(order.bottles_delivered or 0) if order else 0
    previous_empty = int(order.empty_bottles_collected or 0) if order else 0
    final_delivered = int(bottles_delivered)
    final_empty = (
        previous_empty
        if empty_bottles_collected is None and order is not None
        else int(empty_bottles_collected or 0)
    )

    if (
        order is not None
        and not order_already_linked
        and (previous_delivered != 0 or previous_empty != 0)
    ):
        raise MonthlyVirtualCardAmbiguousQuantityError(
            "Active order has nonzero delivery quantities with ambiguous balance history"
        )

    balance_delta = (
        final_delivered
        - previous_delivered
        - (final_empty - previous_empty)
    )
    new_store_balance = int(store.pending_empty_bottles or 0) + balance_delta
    if new_store_balance < 0:
        raise MonthlyVirtualCardNegativeBalanceError(
            "Virtual card entry would make pending empty bottle balance negative"
        )

    order_datetime_ist = IST.localize(datetime.combine(entry_date, time(hour=12)))
    delivered_at = datetime.combine(entry_date, time.min)

    if order_created:
        delivered_by = (
            getattr(current_user, "full_name", None)
            or getattr(current_user, "email", None)
            or "Virtual Card Entry"
        )
        order = Order(
            partner_id=partner.id,
            store_id=store.id,
            assigned_to_manager_id=store.assigned_manager_id,
            status=OrderStatusEnum.delivered_confirmed,
            order_details=str(final_delivered),
            total_amount=0,
            channel=store.channel,
            order_date=order_datetime_ist,
            delivered_at=delivered_at,
            bottles_delivered=final_delivered,
            empty_bottles_collected=final_empty,
            confirmed_bottles=final_delivered,
            confirmed_empty_bottles=final_empty,
            store_confirmed=True,
            delivered_by=delivered_by,
            poc_name=partner.full_name,
            ordered_by_type="VIRTUAL_CARD",
        )
        db.add(order)
        db.flush()
    else:
        order.order_details = str(final_delivered)
        order.status = OrderStatusEnum.delivered_confirmed
        order.delivered_at = delivered_at
        order.bottles_delivered = final_delivered
        order.empty_bottles_collected = final_empty
        order.confirmed_bottles = final_delivered
        order.confirmed_empty_bottles = final_empty
        order.store_confirmed = True

    store.pending_empty_bottles = new_store_balance

    if entry_created:
        entry = MonthlyVirtualCardEntry(
            card_id=card.id,
            entry_date=entry_date,
            created_by_id=current_user.id,
        )
        db.add(entry)
        db.flush()

    entry.entry_source = "super_admin"
    entry.remarks = remarks
    entry.updated_by_id = current_user.id

    existing_link = (
        db.query(MonthlyVirtualCardEntryOrder)
        .filter(
            MonthlyVirtualCardEntryOrder.entry_id == entry.id,
            MonthlyVirtualCardEntryOrder.order_id == order.id,
        )
        .first()
    )
    if existing_link is None:
        db.add(
            MonthlyVirtualCardEntryOrder(
                entry_id=entry.id,
                order_id=order.id,
            )
        )

    db.flush()
    return {
        "card": card,
        "entry": entry,
        "order": order,
        "order_created": order_created,
        "entry_created": entry_created,
        "previous_delivered_quantity": previous_delivered,
        "previous_empty_quantity": previous_empty,
        "final_delivered_quantity": final_delivered,
        "final_empty_quantity": final_empty,
    }
