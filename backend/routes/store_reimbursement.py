from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from ..database.db import get_db
from ..models.store_reimbursement import (
    StoreReimbursement,
    StoreReimbursementAttachment,
    StoreReimbursementPayment,
    StoreReimbursementStatus,
)
from ..models.user import RoleEnum, User
from ..schemas.store_reimbursement import (
    StoreReimbursementAttachmentOut,
    StoreReimbursementAttachmentVoidRequest,
    StoreReimbursementCancel,
    StoreReimbursementCreate,
    StoreReimbursementDetailOut,
    StoreReimbursementListResponse,
    StoreReimbursementOut,
    StoreReimbursementPaymentCreate,
    StoreReimbursementPaymentOut,
    StoreReimbursementReject,
    StoreReimbursementSummaryResponse,
    StoreReimbursementUpdate,
)
from ..services.store_reimbursement import (
    StoreReimbursementAttachmentError,
    StoreReimbursementDomainError,
    StoreReimbursementNotFoundError,
    StoreReimbursementPaymentError,
    StoreReimbursementPOCError,
    StoreReimbursementStateError,
    StoreReimbursementStoreAccessError,
    approve_store_reimbursement,
    cancel_store_reimbursement,
    create_store_reimbursement,
    generate_reimbursement_excel,
    record_reimbursement_payment,
    reject_store_reimbursement,
    update_store_reimbursement,
    upload_reimbursement_attachment,
    void_reimbursement_attachment,
)
from ..utils.jwt import get_current_user
from ..utils.permissions import (
    filter_query_by_employee_stores,
    get_employee_store_ids,
    require_permission,
)

router = APIRouter(prefix="/store-reimbursements", tags=["Store Reimbursement"])


def _check_access(permission_key: str, current_user: User, db: Session) -> None:
    if current_user.role == RoleEnum.superadmin:
        return
    if current_user.role == RoleEnum.employee:
        require_permission(permission_key)(current_user=current_user, db=db)
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only Super Admin or an authorized employee can perform this action.",
    )


def _format_reimbursement_out(r: StoreReimbursement) -> StoreReimbursementOut:
    payments_count = len(r.payments) if "payments" in r.__dict__ else 0
    attachments_count = len([a for a in r.attachments if a.voided_at is None]) if "attachments" in r.__dict__ else 0

    return StoreReimbursementOut(
        id=r.id,
        reimbursement_number=r.reimbursement_number,
        store_id=r.store_id,
        store_name=r.store_name,
        store_channel=r.store_channel,
        store_region=r.store_region,
        store_entity=r.store_entity,
        poc_id=r.poc_id,
        poc_name=r.poc_name,
        poc_phone=r.poc_phone,
        purchase_date=r.purchase_date,
        total_amount=r.total_amount,
        total_paid=r.total_paid,
        outstanding_amount=r.outstanding_amount,
        status=r.status,
        reason=r.reason,
        notes=r.notes,
        instructed_by_user_id=r.instructed_by_user_id,
        instructed_by_name=r.instructed_by_name,
        created_by_id=r.created_by_id,
        created_by_name=r.created_by.full_name if r.created_by else None,
        updated_by_id=r.updated_by_id,
        approved_by_id=r.approved_by_id,
        approved_by_name=r.approved_by.full_name if r.approved_by else None,
        approved_at=r.approved_at,
        rejected_by_id=r.rejected_by_id,
        rejected_by_name=r.rejected_by.full_name if r.rejected_by else None,
        rejected_at=r.rejected_at,
        rejection_reason=r.rejection_reason,
        cancelled_by_id=r.cancelled_by_id,
        cancelled_by_name=r.cancelled_by.full_name if r.cancelled_by else None,
        cancelled_at=r.cancelled_at,
        cancellation_reason=r.cancellation_reason,
        created_at=r.created_at,
        updated_at=r.updated_at,
        payments_count=payments_count,
        attachments_count=attachments_count,
    )


def _format_detail_out(r: StoreReimbursement) -> StoreReimbursementDetailOut:
    base = _format_reimbursement_out(r)

    payments_out = []
    for p in r.payments:
        p_attachments = [
            StoreReimbursementAttachmentOut.model_validate(a)
            for a in p.attachments
        ]
        payments_out.append(
            StoreReimbursementPaymentOut(
                id=p.id,
                reimbursement_id=p.reimbursement_id,
                payment_number=p.payment_number,
                amount=p.amount,
                payment_date=p.payment_date,
                payment_mode=p.payment_mode,
                transaction_reference=p.transaction_reference,
                remarks=p.remarks,
                paid_to_name=p.paid_to_name,
                paid_to_phone=p.paid_to_phone,
                paid_by_id=p.paid_by_id,
                paid_by_name=p.paid_by.full_name if p.paid_by else None,
                created_at=p.created_at,
                attachments=p_attachments,
            )
        )

    attachments_out = [
        StoreReimbursementAttachmentOut(
            id=a.id,
            reimbursement_id=a.reimbursement_id,
            payment_id=a.payment_id,
            attachment_type=a.attachment_type,
            file_url=a.file_url,
            file_name=a.file_name,
            file_type=a.file_type,
            file_size=a.file_size,
            uploaded_by_id=a.uploaded_by_id,
            uploaded_by_name=a.uploaded_by.full_name if a.uploaded_by else None,
            created_at=a.created_at,
            voided_at=a.voided_at,
            voided_by_id=a.voided_by_id,
            voided_by_name=a.voided_by.full_name if a.voided_by else None,
            void_reason=a.void_reason,
        )
        for a in r.attachments
    ]

    return StoreReimbursementDetailOut(
        **base.model_dump(),
        payments=payments_out,
        attachments=attachments_out,
    )


def _apply_filters(
    query: Query,
    db: Session,
    current_user: User,
    search: Optional[str] = None,
    store_id: Optional[str] = None,
    reimb_status: Optional[str] = None,
    purchase_date_from: Optional[date] = None,
    purchase_date_to: Optional[date] = None,
    created_at_from: Optional[datetime] = None,
    created_at_to: Optional[datetime] = None,
    region: Optional[str] = None,
    channel: Optional[str] = None,
    entity: Optional[str] = None,
    poc_id: Optional[int] = None,
    instructed_by_user_id: Optional[int] = None,
    created_by_id: Optional[int] = None,
    amount_min: Optional[Decimal] = None,
    amount_max: Optional[Decimal] = None,
    outstanding_only: bool = False,
) -> Query:
    # 1. Employee store scope
    if current_user.role == RoleEnum.employee:
        query = filter_query_by_employee_stores(query, current_user)

    # 2. Search
    if isinstance(search, str) and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                StoreReimbursement.reimbursement_number.ilike(term),
                StoreReimbursement.store_id.ilike(term),
                StoreReimbursement.store_name.ilike(term),
                StoreReimbursement.poc_name.ilike(term),
                StoreReimbursement.poc_phone.ilike(term),
            )
        )

    # 3. Direct field filters
    if isinstance(store_id, str) and store_id.strip():
        query = query.filter(StoreReimbursement.store_id == store_id.strip())

    if isinstance(reimb_status, str) and reimb_status.strip():
        query = query.filter(StoreReimbursement.status == reimb_status.strip().upper())

    if isinstance(purchase_date_from, (date, datetime)):
        query = query.filter(StoreReimbursement.purchase_date >= purchase_date_from)
    if isinstance(purchase_date_to, (date, datetime)):
        query = query.filter(StoreReimbursement.purchase_date <= purchase_date_to)

    if isinstance(created_at_from, datetime):
        query = query.filter(StoreReimbursement.created_at >= created_at_from)
    if isinstance(created_at_to, datetime):
        query = query.filter(StoreReimbursement.created_at <= created_at_to)

    if isinstance(region, str) and region.strip():
        query = query.filter(StoreReimbursement.store_region == region.strip())

    if isinstance(channel, str) and channel.strip():
        query = query.filter(StoreReimbursement.store_channel == channel.strip())

    if isinstance(entity, str) and entity.strip():
        query = query.filter(StoreReimbursement.store_entity == entity.strip())

    if isinstance(poc_id, int) and not isinstance(poc_id, bool):
        query = query.filter(StoreReimbursement.poc_id == poc_id)

    if isinstance(instructed_by_user_id, int) and not isinstance(instructed_by_user_id, bool):
        query = query.filter(StoreReimbursement.instructed_by_user_id == instructed_by_user_id)

    if isinstance(created_by_id, int) and not isinstance(created_by_id, bool):
        query = query.filter(StoreReimbursement.created_by_id == created_by_id)

    if isinstance(amount_min, (Decimal, int, float)) and not isinstance(amount_min, bool):
        query = query.filter(StoreReimbursement.total_amount >= Decimal(str(amount_min)))
    if isinstance(amount_max, (Decimal, int, float)) and not isinstance(amount_max, bool):
        query = query.filter(StoreReimbursement.total_amount <= Decimal(str(amount_max)))

    if isinstance(outstanding_only, bool) and outstanding_only:
        query = query.filter(StoreReimbursement.outstanding_amount > Decimal("0.00"))

    return query


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post(
    "",
    response_model=StoreReimbursementOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new store reimbursement claim",
)
def create_reimbursement_endpoint(
    payload: StoreReimbursementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_reimbursement.create", current_user, db)

    try:
        reimbursement = create_store_reimbursement(payload, db, current_user)
        db.commit()
        db.refresh(reimbursement)
        return _format_reimbursement_out(reimbursement)
    except StoreReimbursementNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StoreReimbursementStoreAccessError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except StoreReimbursementPOCError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except StoreReimbursementDomainError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create store reimbursement: {str(exc)}",
        ) from exc


@router.get(
    "",
    response_model=StoreReimbursementListResponse,
    summary="List store reimbursements with filters and pagination",
)
def list_reimbursements_endpoint(
    search: Optional[str] = None,
    store_id: Optional[str] = None,
    reimb_status: Optional[str] = Query(None, alias="status"),
    purchase_date_from: Optional[date] = None,
    purchase_date_to: Optional[date] = None,
    created_at_from: Optional[datetime] = None,
    created_at_to: Optional[datetime] = None,
    region: Optional[str] = None,
    channel: Optional[str] = None,
    entity: Optional[str] = None,
    poc_id: Optional[int] = None,
    instructed_by_user_id: Optional[int] = None,
    created_by_id: Optional[int] = None,
    amount_min: Optional[Decimal] = None,
    amount_max: Optional[Decimal] = None,
    outstanding_only: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_reimbursement.view", current_user, db)

    base_query = db.query(StoreReimbursement)
    filtered_query = _apply_filters(
        base_query,
        db=db,
        current_user=current_user,
        search=search,
        store_id=store_id,
        reimb_status=reimb_status,
        purchase_date_from=purchase_date_from,
        purchase_date_to=purchase_date_to,
        created_at_from=created_at_from,
        created_at_to=created_at_to,
        region=region,
        channel=channel,
        entity=entity,
        poc_id=poc_id,
        instructed_by_user_id=instructed_by_user_id,
        created_by_id=created_by_id,
        amount_min=amount_min,
        amount_max=amount_max,
        outstanding_only=outstanding_only,
    )

    total = filtered_query.count()

    page_num = page if isinstance(page, int) and not isinstance(page, bool) and page >= 1 else 1
    page_limit = page_size if isinstance(page_size, int) and not isinstance(page_size, bool) and 1 <= page_size <= 100 else 20

    items = (
        filtered_query.options(
            joinedload(StoreReimbursement.created_by),
            joinedload(StoreReimbursement.approved_by),
            selectinload(StoreReimbursement.payments),
            selectinload(StoreReimbursement.attachments),
        )
        .order_by(StoreReimbursement.created_at.desc(), StoreReimbursement.id.desc())
        .offset((page_num - 1) * page_limit)
        .limit(page_limit)
        .all()
    )

    total_pages = (total + page_limit - 1) // page_limit if total > 0 else 0

    return StoreReimbursementListResponse(
        items=[_format_reimbursement_out(item) for item in items],
        total=total,
        page=page_num,
        page_size=page_limit,
        total_pages=total_pages,
    )


@router.get(
    "/summary",
    response_model=StoreReimbursementSummaryResponse,
    summary="Get summary card totals and metrics",
)
def get_reimbursement_summary_endpoint(
    search: Optional[str] = None,
    store_id: Optional[str] = None,
    purchase_date_from: Optional[date] = None,
    purchase_date_to: Optional[date] = None,
    region: Optional[str] = None,
    channel: Optional[str] = None,
    entity: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_reimbursement.view", current_user, db)

    query = db.query(StoreReimbursement)
    query = _apply_filters(
        query,
        db=db,
        current_user=current_user,
        search=search,
        store_id=store_id,
        purchase_date_from=purchase_date_from,
        purchase_date_to=purchase_date_to,
        region=region,
        channel=channel,
        entity=entity,
    )

    rows = query.all()

    total_claims = len(rows)
    pending_count = sum(1 for r in rows if r.status == StoreReimbursementStatus.PENDING.value)
    approved_count = sum(1 for r in rows if r.status == StoreReimbursementStatus.APPROVED.value)
    partially_paid_count = sum(1 for r in rows if r.status == StoreReimbursementStatus.PARTIALLY_PAID.value)
    paid_count = sum(1 for r in rows if r.status == StoreReimbursementStatus.PAID.value)
    rejected_count = sum(1 for r in rows if r.status == StoreReimbursementStatus.REJECTED.value)
    cancelled_count = sum(1 for r in rows if r.status == StoreReimbursementStatus.CANCELLED.value)

    total_reimb = sum((r.total_amount for r in rows), Decimal("0.00")).quantize(Decimal("0.01"))
    total_paid = sum((r.total_paid for r in rows), Decimal("0.00")).quantize(Decimal("0.01"))
    total_outstanding = sum((r.outstanding_amount for r in rows), Decimal("0.00")).quantize(Decimal("0.01"))

    return StoreReimbursementSummaryResponse(
        total_claims=total_claims,
        pending_count=pending_count,
        approved_count=approved_count,
        partially_paid_count=partially_paid_count,
        paid_count=paid_count,
        rejected_count=rejected_count,
        cancelled_count=cancelled_count,
        total_reimbursement_amount=total_reimb,
        total_paid_amount=total_paid,
        total_outstanding_amount=total_outstanding,
    )


@router.get(
    "/export",
    summary="Export filtered store reimbursements to Excel",
)
def export_reimbursements_endpoint(
    search: Optional[str] = None,
    store_id: Optional[str] = None,
    reimb_status: Optional[str] = Query(None, alias="status"),
    purchase_date_from: Optional[date] = None,
    purchase_date_to: Optional[date] = None,
    region: Optional[str] = None,
    channel: Optional[str] = None,
    entity: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_reimbursement.export", current_user, db)

    query = db.query(StoreReimbursement)
    query = _apply_filters(
        query,
        db=db,
        current_user=current_user,
        search=search,
        store_id=store_id,
        reimb_status=reimb_status,
        purchase_date_from=purchase_date_from,
        purchase_date_to=purchase_date_to,
        region=region,
        channel=channel,
        entity=entity,
    )

    items = (
        query.options(
            joinedload(StoreReimbursement.created_by),
            joinedload(StoreReimbursement.approved_by),
        )
        .order_by(StoreReimbursement.created_at.desc())
        .all()
    )

    excel_bytes = generate_reimbursement_excel(items)

    filename = f"store_reimbursements_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get(
    "/{reimbursement_id}",
    response_model=StoreReimbursementDetailOut,
    summary="Get reimbursement detail with ledger and attachments",
)
def get_reimbursement_detail_endpoint(
    reimbursement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_reimbursement.view", current_user, db)

    reimbursement = (
        db.query(StoreReimbursement)
        .options(
            joinedload(StoreReimbursement.created_by),
            joinedload(StoreReimbursement.approved_by),
            joinedload(StoreReimbursement.rejected_by),
            joinedload(StoreReimbursement.cancelled_by),
            selectinload(StoreReimbursement.payments).joinedload(StoreReimbursementPayment.paid_by),
            selectinload(StoreReimbursement.payments).selectinload(StoreReimbursementPayment.attachments),
            selectinload(StoreReimbursement.attachments).joinedload(StoreReimbursementAttachment.uploaded_by),
            selectinload(StoreReimbursement.attachments).joinedload(StoreReimbursementAttachment.voided_by),
        )
        .filter(StoreReimbursement.id == reimbursement_id)
        .first()
    )
    if not reimbursement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Reimbursement with ID {reimbursement_id} not found.",
        )

    # Employee scope check
    if current_user.role == RoleEnum.employee:
        assigned_ids = get_employee_store_ids(current_user.id, db=db)
        if reimbursement.store_id not in assigned_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Store '{reimbursement.store_id}' is not assigned to your employee account.",
            )

    return _format_detail_out(reimbursement)


@router.patch(
    "/{reimbursement_id}",
    response_model=StoreReimbursementOut,
    summary="Edit pending reimbursement claim",
)
def update_reimbursement_endpoint(
    reimbursement_id: int,
    payload: StoreReimbursementUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_reimbursement.edit", current_user, db)

    reimbursement = db.query(StoreReimbursement).filter(StoreReimbursement.id == reimbursement_id).first()
    if not reimbursement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Reimbursement with ID {reimbursement_id} not found.",
        )

    try:
        updated = update_store_reimbursement(reimbursement, payload, db, current_user)
        db.commit()
        db.refresh(updated)
        return _format_reimbursement_out(updated)
    except StoreReimbursementStoreAccessError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except (StoreReimbursementStateError, StoreReimbursementPOCError, StoreReimbursementDomainError) as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/{reimbursement_id}/approve",
    response_model=StoreReimbursementOut,
    summary="Approve a pending reimbursement claim (SuperAdmin only)",
)
def approve_reimbursement_endpoint(
    reimbursement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can approve reimbursements.",
        )

    reimbursement = db.query(StoreReimbursement).filter(StoreReimbursement.id == reimbursement_id).first()
    if not reimbursement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Reimbursement with ID {reimbursement_id} not found.",
        )

    try:
        approved = approve_store_reimbursement(reimbursement, db, current_user)
        db.commit()
        db.refresh(approved)
        return _format_reimbursement_out(approved)
    except (StoreReimbursementStateError, StoreReimbursementDomainError) as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/{reimbursement_id}/reject",
    response_model=StoreReimbursementOut,
    summary="Reject a pending reimbursement claim (SuperAdmin only)",
)
def reject_reimbursement_endpoint(
    reimbursement_id: int,
    payload: StoreReimbursementReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can reject reimbursements.",
        )

    reimbursement = db.query(StoreReimbursement).filter(StoreReimbursement.id == reimbursement_id).first()
    if not reimbursement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Reimbursement with ID {reimbursement_id} not found.",
        )

    try:
        rejected = reject_store_reimbursement(reimbursement, payload.rejection_reason, db, current_user)
        db.commit()
        db.refresh(rejected)
        return _format_reimbursement_out(rejected)
    except (StoreReimbursementStateError, StoreReimbursementDomainError) as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/{reimbursement_id}/cancel",
    response_model=StoreReimbursementOut,
    summary="Cancel an unpaid reimbursement claim",
)
def cancel_reimbursement_endpoint(
    reimbursement_id: int,
    payload: StoreReimbursementCancel,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_reimbursement.cancel", current_user, db)

    reimbursement = db.query(StoreReimbursement).filter(StoreReimbursement.id == reimbursement_id).first()
    if not reimbursement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Reimbursement with ID {reimbursement_id} not found.",
        )

    try:
        cancelled = cancel_store_reimbursement(reimbursement, payload.cancellation_reason, db, current_user)
        db.commit()
        db.refresh(cancelled)
        return _format_reimbursement_out(cancelled)
    except StoreReimbursementStoreAccessError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except (StoreReimbursementStateError, StoreReimbursementDomainError) as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/{reimbursement_id}/payments",
    response_model=StoreReimbursementPaymentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record a payment installment (SuperAdmin only)",
)
def record_payment_endpoint(
    reimbursement_id: int,
    payload: StoreReimbursementPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_reimbursement.record_payment", current_user, db)
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can record payments.",
        )

    try:
        payment, reimbursement = record_reimbursement_payment(reimbursement_id, payload, db, current_user)
        db.commit()
        db.refresh(payment)
        return StoreReimbursementPaymentOut.model_validate(payment)
    except StoreReimbursementNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StoreReimbursementPaymentError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except StoreReimbursementDomainError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Payment execution failed: {str(exc)}",
        ) from exc


@router.post(
    "/{reimbursement_id}/attachments",
    response_model=StoreReimbursementAttachmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Upload invoice or payment proof attachment",
)
async def upload_attachment_endpoint(
    reimbursement_id: int,
    file: UploadFile = File(...),
    attachment_type: str = Form("INVOICE"),
    payment_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_reimbursement.upload_proof", current_user, db)

    try:
        attachment = await upload_reimbursement_attachment(
            reimbursement_id=reimbursement_id,
            file=file,
            attachment_type=attachment_type,
            payment_id=payment_id,
            db=db,
            current_user=current_user,
        )
        db.commit()
        db.refresh(attachment)
        return StoreReimbursementAttachmentOut.model_validate(attachment)
    except StoreReimbursementNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StoreReimbursementStoreAccessError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except (StoreReimbursementAttachmentError, StoreReimbursementDomainError) as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Attachment upload failed: {str(exc)}",
        ) from exc


@router.post(
    "/{reimbursement_id}/attachments/{attachment_id}/void",
    response_model=StoreReimbursementAttachmentOut,
    summary="Audit-safe void of an uploaded attachment",
)
def void_attachment_endpoint(
    reimbursement_id: int,
    attachment_id: int,
    payload: StoreReimbursementAttachmentVoidRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_reimbursement.upload_proof", current_user, db)

    try:
        voided = void_reimbursement_attachment(
            reimbursement_id=reimbursement_id,
            attachment_id=attachment_id,
            void_reason=payload.void_reason,
            db=db,
            current_user=current_user,
        )
        db.commit()
        db.refresh(voided)
        return StoreReimbursementAttachmentOut.model_validate(voided)
    except StoreReimbursementNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StoreReimbursementStoreAccessError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except (StoreReimbursementAttachmentError, StoreReimbursementStateError, StoreReimbursementDomainError) as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
