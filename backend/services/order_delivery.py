from datetime import datetime
from typing import Optional

from ..models.order import Order, OrderStatusEnum
from ..models.store import Store
from ..models.user import RoleEnum


def apply_delivery_update(
    order: Order,
    *,
    status: OrderStatusEnum,
    delivered_at: datetime,
    bottles_delivered: Optional[int] = None,
    empty_bottles_collected: Optional[int] = None,
    photo_url: Optional[str] = None,
    vehicle_info: Optional[str] = None,
    delivered_by: Optional[str] = None,
    actor_id: Optional[int] = None,
    actor_role: Optional[RoleEnum] = None,
    delivery_note: Optional[str] = None,
) -> None:
    if photo_url is not None:
        order.delivery_photo_url = photo_url
    if bottles_delivered is not None:
        order.bottles_delivered = bottles_delivered
    if empty_bottles_collected is not None:
        order.empty_bottles_collected = empty_bottles_collected
    if vehicle_info:
        order.vehicle_info = vehicle_info
    if delivered_by:
        order.delivered_by = delivered_by
    if delivery_note:
        order.delivery_note = delivery_note

    order.status = status
    order.delivered_at = delivered_at

    if actor_role in [RoleEnum.delivery, RoleEnum.delivery_manager]:
        order.delivery_person_id = actor_id


def apply_delivery_confirmation(
    order: Order,
    store: Store,
    *,
    confirmed_bottles: Optional[int],
    confirmed_empty_bottles: Optional[int],
    confirmation_remarks: Optional[str],
) -> tuple[int, int]:
    order.status = OrderStatusEnum.delivered_confirmed
    order.store_confirmed = True

    delivered = confirmed_bottles or order.bottles_delivered or 0
    collected = (
        confirmed_empty_bottles
        if confirmed_empty_bottles is not None
        else order.empty_bottles_collected or 0
    )

    order.confirmed_bottles = delivered
    order.confirmed_empty_bottles = collected

    current_pending = store.pending_empty_bottles or 0
    store.pending_empty_bottles = max(0, current_pending + delivered - collected)
    order.confirmation_remarks = confirmation_remarks or "Confirmed by store."

    return delivered, collected
