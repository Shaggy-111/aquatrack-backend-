from datetime import date, datetime, timezone
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
from ..models.store_compliance_monthly import (
    StoreComplianceAttachment,
    StoreComplianceAttachmentType,
    StoreComplianceInvoice,
    StoreCompliancePayment,
    StoreCompliancePaymentStatus,
    StoreMonthlyCardStatus,
    StoreMonthlyCompliance,
)
from ..models.user import RoleEnum, User
from ..schemas.store_compliance_monthly import (
    StoreComplianceAttachmentOut,
    StoreComplianceAttachmentVoidRequest,
    StoreComplianceInvoiceCreate,
    StoreComplianceInvoiceOut,
    StoreComplianceInvoiceUpdate,
    StoreCompliancePaymentCreate,
    StoreCompliancePaymentOut,
    StoreMonthlyComplianceCreate,
    StoreMonthlyComplianceDetailOut,
    StoreMonthlyComplianceListResponse,
    StoreMonthlyComplianceOut,
    StoreMonthlyComplianceSummaryResponse,
)
from ..services.store_compliance_monthly import (
    StoreComplianceMonthlyAttachmentError,
    StoreComplianceMonthlyDomainError,
    StoreComplianceMonthlyNotFoundError,
    StoreComplianceMonthlyPaymentError,
    StoreComplianceMonthlyStateError,
    StoreComplianceMonthlyStoreAccessError,
    create_compliance_invoice,
    create_store_monthly_compliance,
    generate_compliance_monthly_excel,
    record_compliance_payment,
    update_compliance_invoice,
    upload_compliance_attachment,
    upload_monthly_card,
    void_compliance_attachment,
)
from ..utils.jwt import get_current_user
from ..utils.permissions import (
    filter_query_by_employee_stores,
    get_employee_store_ids,
    require_permission,
)

router = APIRouter(prefix="/store-compliance/monthly", tags=["Store Compliance Monthly"])


def _check_access(permission_key: str, current_user: User, db: Session) -> None:
    """SuperAdmin bypasses all permission checks; employees require specific permission key."""
    if current_user.role == RoleEnum.superadmin:
        return
    if current_user.role == RoleEnum.employee:
        require_permission(permission_key)(current_user=current_user, db=db)
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only Super Admin or an authorized employee can perform this action.",
    )


def _check_superadmin_only(current_user: User) -> None:
    """Strict SuperAdmin role requirement."""
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can perform this action.",
        )


def _check_superadmin_with_permission(permission_key: str, current_user: User, db: Session) -> None:
    """Strict SuperAdmin role requirement associated with designated permission key."""
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can perform this action.",
        )


def _format_monthly_compliance_out(r: StoreMonthlyCompliance) -> StoreMonthlyComplianceOut:
    inv = r.invoice
    has_inv = inv is not None
    payments_count = len(inv.payments) if has_inv and "payments" in inv.__dict__ else 0
    active_attachments = [a for a in r.attachments if a.voided_at is None] if "attachments" in r.__dict__ else []
    attachments_count = len(active_attachments)

    return StoreMonthlyComplianceOut(
        id=r.id,
        compliance_number=r.compliance_number,
        store_id=r.store_id,
        store_name=r.store_name,
        store_channel=r.store_channel,
        store_region=r.store_region,
        store_entity=r.store_entity,
        delivery_manager_id=r.delivery_manager_id,
        delivery_manager_name=r.delivery_manager_name,
        year=r.year,
        month=r.month,
        card_status=r.card_status,
        card_file_url=r.card_file_url,
        card_file_name=r.card_file_name,
        card_remarks=r.card_remarks,
        card_uploaded_by_id=r.card_uploaded_by_id,
        card_uploaded_by_name=r.card_uploaded_by.full_name if r.card_uploaded_by else None,
        card_uploaded_at=r.card_uploaded_at,
        has_invoice=has_inv,
        invoice_id=inv.id if has_inv else None,
        invoice_number=inv.invoice_number if has_inv else None,
        invoice_date=inv.invoice_date if has_inv else None,
        invoice_amount=inv.invoice_amount if has_inv else None,
        payment_status=inv.payment_status if has_inv else "NO_INVOICE",
        total_paid=inv.total_paid if has_inv else Decimal("0.00"),
        outstanding_amount=inv.outstanding_amount if has_inv else Decimal("0.00"),
        created_by_id=r.created_by_id,
        created_by_name=r.created_by.full_name if r.created_by else None,
        created_at=r.created_at,
        updated_at=r.updated_at,
        attachments_count=attachments_count,
        payments_count=payments_count,
    )


def _format_detail_out(r: StoreMonthlyCompliance) -> StoreMonthlyComplianceDetailOut:
    base = _format_monthly_compliance_out(r)
    inv = r.invoice
    inv_out = None
    payments_out = []

    if inv:
        inv_out = StoreComplianceInvoiceOut(
            id=inv.id,
            monthly_compliance_id=inv.monthly_compliance_id,
            invoice_number=inv.invoice_number,
            invoice_date=inv.invoice_date,
            invoice_amount=inv.invoice_amount,
            total_paid=inv.total_paid,
            outstanding_amount=inv.outstanding_amount,
            payment_status=inv.payment_status,
            file_url=inv.file_url,
            file_name=inv.file_name,
            file_size=inv.file_size,
            remarks=inv.remarks,
            created_by_id=inv.created_by_id,
            created_by_name=inv.created_by.full_name if inv.created_by else None,
            created_at=inv.created_at,
            updated_at=inv.updated_at,
        )

        for p in inv.payments:
            p_attachments = [
                StoreComplianceAttachmentOut(
                    id=a.id,
                    monthly_compliance_id=a.monthly_compliance_id,
                    invoice_id=a.invoice_id,
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
                for a in p.attachments
            ]
            payments_out.append(
                StoreCompliancePaymentOut(
                    id=p.id,
                    invoice_id=p.invoice_id,
                    payment_number=p.payment_number,
                    amount=p.amount,
                    payment_date=p.payment_date,
                    payment_mode=p.payment_mode,
                    transaction_reference=p.transaction_reference,
                    remarks=p.remarks,
                    paid_by_id=p.paid_by_id,
                    paid_by_name=p.paid_by.full_name if p.paid_by else None,
                    created_at=p.created_at,
                    attachments=p_attachments,
                )
            )

    attachments_out = [
        StoreComplianceAttachmentOut(
            id=a.id,
            monthly_compliance_id=a.monthly_compliance_id,
            invoice_id=a.invoice_id,
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

    return StoreMonthlyComplianceDetailOut(
        **base.model_dump(),
        invoice=inv_out,
        payments=payments_out,
        attachments=attachments_out,
    )


def _apply_filters(
    query: Query,
    current_user: User,
    search: Optional[str] = None,
    store_id: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    card_status: Optional[str] = None,
    payment_status: Optional[str] = None,
    region: Optional[str] = None,
    channel: Optional[str] = None,
    entity: Optional[str] = None,
    has_invoice: Optional[bool] = None,
    outstanding_only: bool = False,
) -> Query:
    if current_user.role == RoleEnum.employee:
        query = filter_query_by_employee_stores(query, current_user)

    if isinstance(search, str) and search.strip():
        term = f"%{search.strip()}%"
        query = query.outerjoin(StoreMonthlyCompliance.invoice).filter(
            or_(
                StoreMonthlyCompliance.compliance_number.ilike(term),
                StoreMonthlyCompliance.store_id.ilike(term),
                StoreMonthlyCompliance.store_name.ilike(term),
                StoreComplianceInvoice.invoice_number.ilike(term),
            )
        )

    if isinstance(store_id, str) and store_id.strip():
        query = query.filter(StoreMonthlyCompliance.store_id == store_id.strip())

    if isinstance(year, int) and not isinstance(year, bool):
        query = query.filter(StoreMonthlyCompliance.year == year)

    if isinstance(month, int) and not isinstance(month, bool):
        query = query.filter(StoreMonthlyCompliance.month == month)

    if isinstance(card_status, str) and card_status.strip():
        query = query.filter(StoreMonthlyCompliance.card_status == card_status.strip().upper())

    if isinstance(region, str) and region.strip():
        query = query.filter(StoreMonthlyCompliance.store_region.ilike(region.strip()))

    if isinstance(channel, str) and channel.strip():
        query = query.filter(StoreMonthlyCompliance.store_channel.ilike(channel.strip()))

    if isinstance(entity, str) and entity.strip():
        query = query.filter(StoreMonthlyCompliance.store_entity.ilike(entity.strip()))

    if has_invoice is True:
        query = query.filter(StoreMonthlyCompliance.invoice.has())
    elif has_invoice is False:
        query = query.filter(~StoreMonthlyCompliance.invoice.has())

    if isinstance(payment_status, str) and payment_status.strip():
        ps_clean = payment_status.strip().upper()
        if ps_clean == "NO_INVOICE":
            query = query.filter(~StoreMonthlyCompliance.invoice.has())
        else:
            query = query.filter(StoreMonthlyCompliance.invoice.has(StoreComplianceInvoice.payment_status == ps_clean))

    if outstanding_only:
        query = query.filter(StoreMonthlyCompliance.invoice.has(StoreComplianceInvoice.outstanding_amount > Decimal("0.00")))

    return query


# =============================================================================
# ENDPOINTS (STATIC PATHS FIRST)
# =============================================================================

@router.get(
    "",
    response_model=StoreMonthlyComplianceListResponse,
    summary="List store monthly compliances with filters and pagination",
)
def list_monthly_compliances_endpoint(
    search: Optional[str] = None,
    store_id: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    card_status: Optional[str] = None,
    payment_status: Optional[str] = None,
    region: Optional[str] = None,
    channel: Optional[str] = None,
    entity: Optional[str] = None,
    has_invoice: Optional[bool] = None,
    outstanding_only: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_compliance.view", current_user, db)

    base_query = db.query(StoreMonthlyCompliance)
    filtered_query = _apply_filters(
        base_query,
        current_user=current_user,
        search=search,
        store_id=store_id,
        year=year,
        month=month,
        card_status=card_status,
        payment_status=payment_status,
        region=region,
        channel=channel,
        entity=entity,
        has_invoice=has_invoice,
        outstanding_only=outstanding_only,
    )

    total = filtered_query.count()

    page_num = page if isinstance(page, int) and not isinstance(page, bool) and page >= 1 else 1
    page_limit = page_size if isinstance(page_size, int) and not isinstance(page_size, bool) and 1 <= page_size <= 100 else 20

    items = (
        filtered_query.options(
            joinedload(StoreMonthlyCompliance.created_by),
            joinedload(StoreMonthlyCompliance.card_uploaded_by),
            selectinload(StoreMonthlyCompliance.invoice).selectinload(StoreComplianceInvoice.payments),
            selectinload(StoreMonthlyCompliance.attachments),
        )
        .order_by(StoreMonthlyCompliance.year.desc(), StoreMonthlyCompliance.month.desc(), StoreMonthlyCompliance.id.desc())
        .offset((page_num - 1) * page_limit)
        .limit(page_limit)
        .all()
    )

    total_pages = (total + page_limit - 1) // page_limit if total > 0 else 0

    return StoreMonthlyComplianceListResponse(
        items=[_format_monthly_compliance_out(r) for r in items],
        total=total,
        page=page_num,
        page_size=page_limit,
        total_pages=total_pages,
    )


@router.get(
    "/summary",
    response_model=StoreMonthlyComplianceSummaryResponse,
    summary="Get monthly compliance summary KPIs and aggregations",
)
def get_monthly_compliance_summary_endpoint(
    year: Optional[int] = None,
    month: Optional[int] = None,
    region: Optional[str] = None,
    channel: Optional[str] = None,
    entity: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_compliance.view", current_user, db)

    base_query = db.query(StoreMonthlyCompliance)
    filtered = _apply_filters(
        base_query,
        current_user=current_user,
        year=year,
        month=month,
        region=region,
        channel=channel,
        entity=entity,
    )

    compliances = (
        filtered.options(
            selectinload(StoreMonthlyCompliance.invoice),
        ).all()
    )

    total_records = len(compliances)
    cards_uploaded = 0
    pending_cards = 0
    with_invoice = 0
    without_invoice = 0
    unpaid_count = 0
    partially_paid_count = 0
    paid_count = 0
    total_invoice_amt = Decimal("0.00")
    total_paid_amt = Decimal("0.00")
    total_outstanding_amt = Decimal("0.00")

    for c in compliances:
        if c.card_status == StoreMonthlyCardStatus.CARD_UPLOADED.value:
            cards_uploaded += 1
        else:
            pending_cards += 1

        inv = c.invoice
        if inv:
            with_invoice += 1
            total_invoice_amt += inv.invoice_amount
            total_paid_amt += inv.total_paid
            total_outstanding_amt += inv.outstanding_amount

            if inv.payment_status == StoreCompliancePaymentStatus.PAID.value:
                paid_count += 1
            elif inv.payment_status == StoreCompliancePaymentStatus.PARTIALLY_PAID.value:
                partially_paid_count += 1
            else:
                unpaid_count += 1
        else:
            without_invoice += 1

    return StoreMonthlyComplianceSummaryResponse(
        total_monthly_records=total_records,
        cards_uploaded=cards_uploaded,
        pending_cards=pending_cards,
        with_invoice=with_invoice,
        without_invoice=without_invoice,
        unpaid_count=unpaid_count,
        partially_paid_count=partially_paid_count,
        paid_count=paid_count,
        total_invoice_amount=total_invoice_amt,
        total_paid_amount=total_paid_amt,
        total_outstanding_amount=total_outstanding_amt,
    )


@router.get(
    "/export",
    summary="Export monthly compliance records to Excel (.xlsx)",
)
def export_monthly_compliance_excel_endpoint(
    search: Optional[str] = None,
    store_id: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    card_status: Optional[str] = None,
    payment_status: Optional[str] = None,
    region: Optional[str] = None,
    channel: Optional[str] = None,
    entity: Optional[str] = None,
    has_invoice: Optional[bool] = None,
    outstanding_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_compliance.export", current_user, db)

    base_query = db.query(StoreMonthlyCompliance)
    filtered = _apply_filters(
        base_query,
        current_user=current_user,
        search=search,
        store_id=store_id,
        year=year,
        month=month,
        card_status=card_status,
        payment_status=payment_status,
        region=region,
        channel=channel,
        entity=entity,
        has_invoice=has_invoice,
        outstanding_only=outstanding_only,
    )

    rows = (
        filtered.options(
            selectinload(StoreMonthlyCompliance.invoice),
        )
        .order_by(StoreMonthlyCompliance.year.desc(), StoreMonthlyCompliance.month.desc(), StoreMonthlyCompliance.id.desc())
        .all()
    )

    excel_buffer = generate_compliance_monthly_excel(rows)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"store_compliance_monthly_{timestamp}.xlsx"

    return Response(
        content=excel_buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "",
    response_model=StoreMonthlyComplianceOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create store monthly compliance record",
)
def create_monthly_compliance_endpoint(
    payload: StoreMonthlyComplianceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_compliance.create", current_user, db)

    try:
        compliance = create_store_monthly_compliance(payload, db, current_user)
        db.commit()
        db.refresh(compliance)
        return _format_monthly_compliance_out(compliance)
    except StoreComplianceMonthlyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StoreComplianceMonthlyStoreAccessError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except StoreComplianceMonthlyDomainError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create monthly compliance: {str(exc)}",
        ) from exc


# =============================================================================
# DYNAMIC RESOURCE ENDPOINTS (BY COMPLIANCE ID)
# =============================================================================

@router.get(
    "/{compliance_id}",
    response_model=StoreMonthlyComplianceDetailOut,
    summary="Get monthly compliance detail with invoice, payments, and attachments",
)
def get_monthly_compliance_detail_endpoint(
    compliance_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_compliance.view", current_user, db)

    compliance = (
        db.query(StoreMonthlyCompliance)
        .options(
            joinedload(StoreMonthlyCompliance.created_by),
            joinedload(StoreMonthlyCompliance.card_uploaded_by),
            selectinload(StoreMonthlyCompliance.invoice).selectinload(StoreComplianceInvoice.payments).selectinload(StoreCompliancePayment.attachments),
            selectinload(StoreMonthlyCompliance.attachments),
        )
        .filter(StoreMonthlyCompliance.id == compliance_id)
        .first()
    )
    if not compliance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Monthly compliance with ID {compliance_id} not found.",
        )

    # Scoping check for employees
    if current_user.role == RoleEnum.employee:
        assigned_ids = get_employee_store_ids(current_user.id, db=db)
        if compliance.store_id not in assigned_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Store '{compliance.store_id}' is not assigned to your employee account.",
            )

    return _format_detail_out(compliance)


@router.post(
    "/{compliance_id}/card",
    response_model=StoreMonthlyComplianceOut,
    summary="Upload or replace monthly water card (SuperAdmin or scoped employee)",
)
async def upload_monthly_card_endpoint(
    compliance_id: int,
    file: UploadFile = File(...),
    remarks: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_compliance.upload", current_user, db)

    compliance = db.query(StoreMonthlyCompliance).filter(StoreMonthlyCompliance.id == compliance_id).first()
    if not compliance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Monthly compliance with ID {compliance_id} not found.",
        )

    if current_user.role == RoleEnum.employee:
        assigned_ids = get_employee_store_ids(current_user.id, db=db)
        if compliance.store_id not in assigned_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Store '{compliance.store_id}' is not assigned to your employee account.",
            )

    try:
        content = await file.read()
        clean_remarks = remarks.strip() if isinstance(remarks, str) else None
        updated = await upload_monthly_card(
            compliance=compliance,
            content=content,
            filename=file.filename or "water_card",
            content_type=file.content_type or "application/octet-stream",
            remarks=clean_remarks,
            db=db,
            current_user=current_user,
        )
        db.commit()
        db.refresh(updated)
        return _format_monthly_compliance_out(updated)
    except StoreComplianceMonthlyAttachmentError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except StoreComplianceMonthlyDomainError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Card upload failed: {str(exc)}",
        ) from exc


@router.post(
    "/{compliance_id}/invoice",
    response_model=StoreComplianceInvoiceOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create commercial invoice with required invoice document (SuperAdmin only)",
)
async def create_compliance_invoice_endpoint(
    compliance_id: int,
    file: UploadFile = File(...),
    invoice_number: str = Form(..., min_length=1, max_length=100),
    invoice_date: date = Form(...),
    invoice_amount: Decimal = Form(..., gt=Decimal("0.00")),
    remarks: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_superadmin_with_permission("store_compliance.invoice_manage", current_user, db)

    compliance = db.query(StoreMonthlyCompliance).filter(StoreMonthlyCompliance.id == compliance_id).first()
    if not compliance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Monthly compliance with ID {compliance_id} not found.",
        )

    clean_remarks = remarks.strip() if isinstance(remarks, str) else None

    if not file or not hasattr(file, "read"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An invoice document (PDF or image) is required to create an invoice.",
        )

    try:
        content = await file.read()
        if not content or len(content) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded invoice file is empty.",
            )

        invoice = await create_compliance_invoice(
            compliance=compliance,
            invoice_number=str(invoice_number).strip(),
            invoice_date=invoice_date,
            invoice_amount=invoice_amount,
            content=content,
            filename=file.filename or "invoice",
            content_type=file.content_type or "application/octet-stream",
            remarks=clean_remarks,
            db=db,
            current_user=current_user,
        )
        db.commit()
        db.refresh(invoice)
        return StoreComplianceInvoiceOut.model_validate(invoice)
    except HTTPException:
        db.rollback()
        raise
    except (StoreComplianceMonthlyStateError, StoreComplianceMonthlyDomainError, StoreComplianceMonthlyAttachmentError) as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create compliance invoice: {str(exc)}",
        ) from exc


@router.patch(
    "/{compliance_id}/invoice",
    response_model=StoreComplianceInvoiceOut,
    summary="Edit invoice fields or replace document before payment begins (SuperAdmin only)",
)
async def update_compliance_invoice_endpoint(
    compliance_id: int,
    invoice_number: Optional[str] = Form(None),
    invoice_date: Optional[date] = Form(None),
    invoice_amount: Optional[Decimal] = Form(None),
    remarks: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    payload: Optional[StoreComplianceInvoiceUpdate] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_superadmin_with_permission("store_compliance.invoice_manage", current_user, db)

    invoice = (
        db.query(StoreComplianceInvoice)
        .filter(StoreComplianceInvoice.monthly_compliance_id == compliance_id)
        .first()
    )
    if not invoice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No invoice found for monthly compliance ID {compliance_id}.",
        )

    clean_num = None
    clean_dt = None
    clean_amt = None
    clean_rem = None

    if payload is not None:
        clean_num = payload.invoice_number
        clean_dt = payload.invoice_date
        clean_amt = payload.invoice_amount
        clean_rem = payload.remarks
    else:
        if isinstance(invoice_number, str):
            clean_num = invoice_number.strip()
        if isinstance(invoice_date, (date, datetime)):
            clean_dt = invoice_date
        if isinstance(invoice_amount, (Decimal, int, float)) and not isinstance(invoice_amount, bool):
            clean_amt = Decimal(str(invoice_amount))
        if isinstance(remarks, str):
            clean_rem = remarks.strip()

    update_payload = StoreComplianceInvoiceUpdate(
        invoice_number=clean_num,
        invoice_date=clean_dt,
        invoice_amount=clean_amt,
        remarks=clean_rem,
    )

    new_content = None
    new_filename = None
    new_content_type = None

    if file is not None and hasattr(file, "read"):
        new_content = await file.read()
        new_filename = file.filename
        new_content_type = file.content_type

    try:
        updated = await update_compliance_invoice(
            invoice=invoice,
            payload=update_payload,
            new_file_content=new_content,
            new_filename=new_filename,
            new_content_type=new_content_type,
            db=db,
            current_user=current_user,
        )
        db.commit()
        db.refresh(updated)
        return StoreComplianceInvoiceOut.model_validate(updated)
    except (StoreComplianceMonthlyStateError, StoreComplianceMonthlyDomainError, StoreComplianceMonthlyAttachmentError) as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/{compliance_id}/payments",
    response_model=StoreCompliancePaymentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record payment installment (SuperAdmin only)",
)
def record_compliance_payment_endpoint(
    compliance_id: int,
    payload: StoreCompliancePaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_superadmin_with_permission("store_compliance.record_payment", current_user, db)

    try:
        payment, invoice = record_compliance_payment(compliance_id, payload, db, current_user)
        db.commit()
        db.refresh(payment)
        return StoreCompliancePaymentOut.model_validate(payment)
    except StoreComplianceMonthlyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StoreComplianceMonthlyPaymentError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except StoreComplianceMonthlyDomainError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Payment execution failed: {str(exc)}",
        ) from exc


@router.post(
    "/{compliance_id}/attachments",
    response_model=StoreComplianceAttachmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Upload supporting document or proof",
)
async def upload_compliance_attachment_endpoint(
    compliance_id: int,
    file: UploadFile = File(...),
    attachment_type: str = Form("OTHER"),
    invoice_id: Optional[int] = Form(None),
    payment_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access("store_compliance.upload", current_user, db)

    compliance = db.query(StoreMonthlyCompliance).filter(StoreMonthlyCompliance.id == compliance_id).first()
    if not compliance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Monthly compliance with ID {compliance_id} not found.",
        )

    clean_att_type = attachment_type if isinstance(attachment_type, str) else "OTHER"
    clean_inv_id = invoice_id if isinstance(invoice_id, int) and not isinstance(invoice_id, bool) else None
    clean_pay_id = payment_id if isinstance(payment_id, int) and not isinstance(payment_id, bool) else None

    # Strict Employee restriction: Employees can ONLY upload OTHER supporting attachments
    if current_user.role == RoleEnum.employee:
        assigned_ids = get_employee_store_ids(current_user.id, db=db)
        if compliance.store_id not in assigned_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Store '{compliance.store_id}' is not assigned to your employee account.",
            )
        if clean_att_type != StoreComplianceAttachmentType.OTHER.value:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Employees cannot upload attachment type '{clean_att_type}'. Employees may only upload OTHER supporting documents (or water cards via /card).",
            )

    try:
        content = await file.read()
        attachment = await upload_compliance_attachment(
            compliance=compliance,
            attachment_type=clean_att_type,
            invoice_id=clean_inv_id,
            payment_id=clean_pay_id,
            content=content,
            filename=file.filename or "attachment",
            content_type=file.content_type or "application/octet-stream",
            db=db,
            current_user=current_user,
        )
        db.commit()
        db.refresh(attachment)
        return StoreComplianceAttachmentOut.model_validate(attachment)
    except StoreComplianceMonthlyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StoreComplianceMonthlyAttachmentError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except StoreComplianceMonthlyDomainError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Attachment upload failed: {str(exc)}",
        ) from exc


@router.post(
    "/{compliance_id}/attachments/{attachment_id}/void",
    response_model=StoreComplianceAttachmentOut,
    summary="Soft-void an attachment (SuperAdmin only)",
)
def void_compliance_attachment_endpoint(
    compliance_id: int,
    attachment_id: int,
    payload: StoreComplianceAttachmentVoidRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_superadmin_only(current_user)

    try:
        voided = void_compliance_attachment(
            compliance_id=compliance_id,
            attachment_id=attachment_id,
            void_reason=payload.void_reason,
            db=db,
            current_user=current_user,
        )
        db.commit()
        db.refresh(voided)
        return StoreComplianceAttachmentOut.model_validate(voided)
    except StoreComplianceMonthlyNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StoreComplianceMonthlyStateError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except StoreComplianceMonthlyDomainError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
