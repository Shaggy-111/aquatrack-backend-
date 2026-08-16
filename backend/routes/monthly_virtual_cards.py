from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session, joinedload, selectinload

from ..database.db import get_db
from ..config import settings
from ..models.monthly_virtual_card import (
    MonthlyVirtualCard,
    MonthlyVirtualCardEntry,
    MonthlyVirtualCardEntryOrder,
)
from ..models.order import OrderStatusEnum
from ..models.store import Store
from ..models.user import RoleEnum, User
from ..schemas.monthly_virtual_card import (
    MonthlyVirtualCardDetail,
    MonthlyVirtualCardEntrySummary,
    MonthlyVirtualCardEntryUpsertRequest,
    MonthlyVirtualCardEntryUpsertResponse,
    MonthlyVirtualCardGenerateRequest,
    MonthlyVirtualCardGenerationResult,
    MonthlyVirtualCardSummary,
)
from ..services.monthly_virtual_card import (
    MonthlyVirtualCardAmbiguousQuantityError,
    MonthlyVirtualCardClosedError,
    MonthlyVirtualCardInactiveStoreError,
    MonthlyVirtualCardMonthMismatchError,
    MonthlyVirtualCardNegativeBalanceError,
    MonthlyVirtualCardNotFoundError,
    MonthlyVirtualCardPartnerMappingError,
    MonthlyVirtualCardStoreNotFoundError,
    ensure_monthly_cards_for_active_stores,
    upsert_monthly_virtual_card_entry,
)
from ..utils.jwt import get_current_user
from ..utils.permissions import require_permission
from ..utils.store_qr_public_url import build_store_qr_public_url
from ..utils.store_qr_tokens import create_store_qr_token


router = APIRouter(prefix="/monthly-virtual-cards", tags=["Monthly Virtual Cards"])


def _effective_linked_order_quantities(order) -> tuple[int, int]:
    status_value = order.status.value if hasattr(order.status, "value") else order.status
    if status_value == OrderStatusEnum.delivered_confirmed.value:
        delivered = (
            order.confirmed_bottles
            if order.confirmed_bottles is not None
            else order.bottles_delivered
        )
        empty = (
            order.confirmed_empty_bottles
            if order.confirmed_empty_bottles is not None
            else order.empty_bottles_collected
        )
    else:
        delivered = order.bottles_delivered
        empty = order.empty_bottles_collected
    return int(delivered or 0), int(empty or 0)


def _require_monthly_card_access(
    permission_key: str,
    current_user: User,
    db: Session,
) -> None:
    if current_user.role == RoleEnum.superadmin:
        return
    if current_user.role == RoleEnum.employee:
        require_permission(permission_key)(current_user=current_user, db=db)
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only Super Admin or an authorized employee can access monthly virtual cards.",
    )


@router.post(
    "/generate",
    response_model=MonthlyVirtualCardGenerationResult,
)
def generate_monthly_virtual_cards(
    payload: MonthlyVirtualCardGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_monthly_card_access(
        "monthly_virtual_cards.generate",
        current_user,
        db,
    )

    try:
        result = ensure_monthly_cards_for_active_stores(
            db,
            payload.year,
            payload.month,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Monthly virtual card generation failed.",
        ) from exc


@router.get("", response_model=list[MonthlyVirtualCardSummary])
def list_monthly_virtual_cards(
    year: int,
    month: int = Query(ge=1, le=12),
    store_id: str | None = None,
    region: str | None = None,
    channel: str | None = None,
    entity: str | None = None,
    card_status: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_monthly_card_access(
        "monthly_virtual_cards.view",
        current_user,
        db,
    )

    query = (
        db.query(MonthlyVirtualCard)
        .join(Store, Store.id == MonthlyVirtualCard.store_id)
        .filter(
            MonthlyVirtualCard.year == year,
            MonthlyVirtualCard.month == month,
        )
    )

    if store_id:
        query = query.filter(MonthlyVirtualCard.store_id == store_id)
    if region:
        query = query.filter(Store.region == region)
    if channel:
        query = query.filter(Store.channel == channel)
    if entity:
        query = query.filter(Store.entity == entity)
    if card_status:
        query = query.filter(MonthlyVirtualCard.status == card_status)

    return query.order_by(Store.store_name.asc(), MonthlyVirtualCard.id.asc()).all()


@router.put(
    "/{card_id}/entries/{entry_date}",
    response_model=MonthlyVirtualCardEntryUpsertResponse,
)
def upsert_monthly_virtual_card_daily_entry(
    card_id: int,
    entry_date: date,
    payload: MonthlyVirtualCardEntryUpsertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        _require_monthly_card_access(
            "monthly_virtual_cards.update",
            current_user,
            db,
        )
        result = upsert_monthly_virtual_card_entry(
            db,
            card_id,
            entry_date,
            payload.bottles_delivered,
            payload.empty_bottles_collected,
            payload.remarks,
            current_user,
        )
        entry = result["entry"]
        order = result["order"]
        linked_order_ids = [
            row.order_id
            for row in db.query(MonthlyVirtualCardEntryOrder.order_id)
            .filter(MonthlyVirtualCardEntryOrder.entry_id == entry.id)
            .order_by(MonthlyVirtualCardEntryOrder.order_id.asc())
            .all()
        ]
        response = MonthlyVirtualCardEntryUpsertResponse(
            card_id=result["card"].id,
            entry_id=entry.id,
            entry_date=entry.entry_date,
            entry_source=entry.entry_source,
            remarks=entry.remarks,
            order_id=order.id,
            order_created=result["order_created"],
            entry_created=result["entry_created"],
            order_status=(
                order.status.value
                if hasattr(order.status, "value")
                else str(order.status)
            ),
            previous_bottles_delivered=result["previous_delivered_quantity"],
            previous_empty_bottles_collected=result["previous_empty_quantity"],
            final_bottles_delivered=result["final_delivered_quantity"],
            final_empty_bottles_collected=result["final_empty_quantity"],
            store_pending_empty_bottles=result["card"].store.pending_empty_bottles,
            linked_order_ids=linked_order_ids,
        )
        db.commit()
        return response
    except HTTPException:
        db.rollback()
        raise
    except (MonthlyVirtualCardNotFoundError, MonthlyVirtualCardStoreNotFoundError) as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Monthly virtual card or associated store was not found.",
        ) from exc
    except MonthlyVirtualCardMonthMismatchError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Entry date must belong to the card year and month.",
        ) from exc
    except MonthlyVirtualCardClosedError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Monthly virtual card is not open.",
        ) from exc
    except MonthlyVirtualCardInactiveStoreError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The associated store is inactive.",
        ) from exc
    except MonthlyVirtualCardPartnerMappingError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The store has no valid partner mapping.",
        ) from exc
    except MonthlyVirtualCardAmbiguousQuantityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Existing order quantities cannot be reconciled safely.",
        ) from exc
    except MonthlyVirtualCardNegativeBalanceError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The entry would produce an invalid empty-bottle balance.",
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Monthly virtual card entry update failed.",
        ) from exc


@router.get(
    "/store/{store_id}/{year}/{month}",
    response_model=MonthlyVirtualCardDetail,
)
def get_monthly_virtual_card_detail(
    store_id: str,
    year: int,
    month: int = Path(ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_monthly_card_access(
        "monthly_virtual_cards.view",
        current_user,
        db,
    )

    card = (
        db.query(MonthlyVirtualCard)
        .options(
            joinedload(MonthlyVirtualCard.store),
            selectinload(MonthlyVirtualCard.entries).selectinload(
                MonthlyVirtualCardEntry.order_links
            ).selectinload(MonthlyVirtualCardEntryOrder.order),
        )
        .filter(
            MonthlyVirtualCard.store_id == store_id,
            MonthlyVirtualCard.year == year,
            MonthlyVirtualCard.month == month,
        )
        .first()
    )
    if card is None:
        raise HTTPException(status_code=404, detail="Monthly virtual card not found.")

    store = card.store
    qr_public_url = None
    if store.qr_public_id:
        qr_token = create_store_qr_token(
            store.qr_public_id,
            store.qr_token_version,
        )
        qr_public_url = build_store_qr_public_url(
            qr_token,
            settings.STORE_QR_PUBLIC_BASE_URL,
        )
    entries = []
    for entry in sorted(card.entries, key=lambda item: (item.entry_date, item.id)):
        sorted_links = sorted(entry.order_links, key=lambda link: link.order_id)
        delivered_total = 0
        empty_total = 0
        for link in sorted_links:
            delivered, empty = _effective_linked_order_quantities(link.order)
            delivered_total += delivered
            empty_total += empty

        entries.append(MonthlyVirtualCardEntrySummary(
            id=entry.id,
            entry_date=entry.entry_date,
            entry_source=entry.entry_source,
            remarks=entry.remarks,
            created_by_id=entry.created_by_id,
            updated_by_id=entry.updated_by_id,
            created_at=entry.created_at,
            updated_at=entry.updated_at,
            bottles_delivered=delivered_total,
            empty_bottles_collected=empty_total,
            linked_order_ids=[link.order_id for link in sorted_links],
        ))

    return MonthlyVirtualCardDetail(
        id=card.id,
        store_id=card.store_id,
        year=card.year,
        month=card.month,
        status=card.status,
        created_at=card.created_at,
        updated_at=card.updated_at,
        store_name=store.store_name,
        entity=store.entity,
        channel=store.channel,
        project_code=store.project_code,
        region=store.region,
        state=store.state,
        city=store.city,
        address=store.address,
        zip_code=store.zip_code,
        qr_public_id=store.qr_public_id,
        qr_public_url=qr_public_url,
        entries=entries,
    )
