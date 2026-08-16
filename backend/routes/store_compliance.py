from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    UploadFile,
    File,
    Form,
    status
)

from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, case, func

from ..database.db import get_db

from collections import defaultdict


from ..models.store import Store
from ..models.user import User, RoleEnum
from ..models.store_compliance import StoreComplianceDocument
from uuid import uuid4

from ..schemas.store_compliance import StoreComplianceOut

from ..utils.jwt import get_current_user
from ..utils.permissions import get_employee_store_ids, require_permission

from typing import List
from datetime import datetime
import cloudinary
import cloudinary.uploader
from backend.utils.cloudinary_config import *
from io import BytesIO
from urllib.request import urlopen

import shutil
import os


from pydantic import BaseModel

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader




router = APIRouter(
    prefix="/store-compliance",
    tags=["Store Compliance"]
)

UPLOAD_DIR = "uploads/store_compliance"
os.makedirs(UPLOAD_DIR, exist_ok=True)

PDF_DIR = "uploads/generated_pdfs"
os.makedirs(PDF_DIR, exist_ok=True)


# -------------------------------------------------
# DELIVERY MANAGER REQUIRED
# -------------------------------------------------
def delivery_manager_required(
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers allowed."
        )

    return current_user


def super_admin_required(
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only super admin allowed."
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
            status_code=403,
            detail="Store not assigned to you."
        )

class GeneratePDFRequest(BaseModel):
    store_ids: list[str]
    month: int
    year: int


# -------------------------------------------------
# UPLOAD DOCUMENT
# -------------------------------------------------
@router.post(
    "/upload",
    response_model=StoreComplianceOut
)
def upload_store_document(
    store_id: str = Form(...),
    document_type: str = Form(...),
    year: int = Form(...),
    month: int = Form(...),
    week_number: int = Form(None),

    # NEW
    page_number: int = Form(1),

    remarks: str = Form(None),

    file: UploadFile = File(...),

    db: Session = Depends(get_db),

    current_user: User = Depends(get_current_user)
):

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store_compliance.upload",
            current_user,
            db
        )
        employee_store_access_required(
            store_id,
            current_user,
            db
        )

        store = db.query(Store).filter(
            Store.id == store_id
        ).first()

    else:
        if current_user.role != RoleEnum.delivery_manager:
            raise HTTPException(
                status_code=403,
                detail="Only delivery managers allowed."
            )

        store = db.query(Store).filter(
            Store.id == store_id,
            Store.assigned_manager_id == current_user.id
        ).first()

    if not store:
        raise HTTPException(
            status_code=404,
            detail="Store not assigned to you."
        )

    if document_type not in [
        "water_card",
        "invoice"
    ]:
        raise HTTPException(
            status_code=400,
            detail="Invalid document type."
        )

    if (
        document_type == "water_card"
        and not week_number
    ):
        raise HTTPException(
            status_code=400,
            detail="week_number required for water card."
        )

    # PDFs must be uploaded as resource_type="raw" with type="upload" so that
    # Cloudinary stores the original file and delivers it via a public
    # /raw/upload/ URL with Content-Type: application/pdf.
    # Using resource_type="auto" causes Cloudinary to classify PDFs as
    # image assets (/image/upload/) which may require authenticated access
    # and never returns the actual PDF bytes to the browser.
    is_pdf = (
        (file.content_type or "").lower() == "application/pdf"
        or (file.filename or "").lower().endswith(".pdf")
    )
    upload_resource_type = "raw" if is_pdf else "auto"

    result = cloudinary.uploader.upload(
        file.file,
        resource_type=upload_resource_type,
        type="upload",
        folder=f"store_compliance/{store_id}/{year}/{month}",
        public_id=(
            f"{document_type}_"
            f"{week_number or 'monthly'}_"
            f"page_{page_number}_"
            f"{int(datetime.utcnow().timestamp())}"
        )
    )

    print(
        "[CLOUDINARY UPLOAD] delivery_manager upload:",
        {
            "secure_url": result.get("secure_url"),
            "public_id": result.get("public_id"),
            "resource_type": result.get("resource_type"),
            "type": result.get("type"),
        }
    )

    file_url = result["secure_url"]

    # DUPLICATE CHECK
    existing = db.query(
        StoreComplianceDocument
    ).filter(
        StoreComplianceDocument.store_id == store_id,
        StoreComplianceDocument.document_type == document_type,
        StoreComplianceDocument.year == year,
        StoreComplianceDocument.month == month,
        StoreComplianceDocument.week_number == week_number,
        StoreComplianceDocument.page_number == page_number
    ).first()

    if existing:

        existing.file_url = file_url
        existing.remarks = remarks
        existing.created_at = datetime.utcnow()

        db.commit()
        db.refresh(existing)

        return existing

    new_doc = StoreComplianceDocument(
        store_id=store_id,
        uploaded_by=current_user.id,
        document_type=document_type,
        year=year,
        month=month,
        week_number=week_number,
        page_number=page_number,
        file_url=file_url,
        remarks=remarks
    )

    db.add(new_doc)

    db.commit()

    db.refresh(new_doc)

    return new_doc

# -------------------------------------------------
# GET MY STORES DOCUMENTS
# -------------------------------------------------
@router.get(
    "/my-documents",
    response_model=List[StoreComplianceOut]
)
def get_my_documents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store_compliance.view",
            current_user,
            db
        )
        assigned_store_ids = get_employee_store_ids(
            current_user.id,
            db=db
        )

        documents = (
            db.query(StoreComplianceDocument)
            .filter(
                StoreComplianceDocument.store_id.in_(
                    assigned_store_ids
                )
            )
            .order_by(
                StoreComplianceDocument.created_at.desc()
            )
            .all()
        )

    else:
        if current_user.role != RoleEnum.delivery_manager:
            raise HTTPException(
                status_code=403,
                detail="Only delivery managers allowed."
            )

        documents = (
            db.query(StoreComplianceDocument)
            .join(Store)
            .filter(
                Store.assigned_manager_id
                == current_user.id
            )
            .order_by(
                StoreComplianceDocument.created_at.desc()
            )
            .all()
        )

    return documents


# -------------------------------------------------
# STORE HISTORY
# -------------------------------------------------
@router.get(
    "/store/{store_id}",
    response_model=List[StoreComplianceOut]
)
def get_store_history(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store_compliance.view",
            current_user,
            db
        )
        employee_store_access_required(
            store_id,
            current_user,
            db
        )
    elif current_user.role == RoleEnum.delivery_manager:
        store = (
            db.query(Store)
            .filter(
                Store.id == store_id,
                Store.assigned_manager_id == current_user.id
            )
            .first()
        )
        if not store:
            raise HTTPException(
                status_code=404,
                detail="Store not assigned to you."
            )
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to view store compliance documents."
        )

    documents = (
        db.query(StoreComplianceDocument)
        .filter(
            StoreComplianceDocument.store_id
            == store_id
        )
        .order_by(
            StoreComplianceDocument.year.desc(),
            StoreComplianceDocument.month.desc(),
            StoreComplianceDocument.week_number.desc()
        )
        .all()
    )

    return documents

# -------------------------------------------------
# SUPER ADMIN REPOSITORY
# -------------------------------------------------
@router.get("/repository")
def get_compliance_repository(
    month: int,
    year: int,
    region: str = None,
    city: str = None,
    channel: str = None,
    missing_type: str = None,
    compliance_range: str = None,
    status: str = None,
    manager_id: int = None,
    sort_by: str = "compliance_percentage",
    sort_order: str = "asc",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    employee_assigned_store_ids = None

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store_compliance.view",
            current_user,
            db
        )
        employee_assigned_store_ids = get_employee_store_ids(
            current_user.id,
            db=db
        )
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only super admin allowed."
        )

    valid_missing_types = {
        "week1",
        "week2",
        "week3",
        "week4",
        "invoice"
    }
    valid_statuses = {
        "pending",
        "partial",
        "complete"
    }
    valid_compliance_ranges = {
        "0",
        "1-20",
        "21-40",
        "41-60",
        "61-80",
        "81-100"
    }
    valid_sort_fields = {
        "compliance_percentage",
        "store_name",
        "city",
        "channel"
    }
    valid_sort_orders = {"asc", "desc"}

    missing_type = missing_type.lower() if missing_type else None
    status = status.lower() if status else None
    compliance_range = compliance_range.strip() if compliance_range else None
    sort_by = sort_by.lower() if sort_by else "compliance_percentage"
    sort_order = sort_order.lower() if sort_order else "asc"

    if missing_type and missing_type not in valid_missing_types:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid missing_type. "
                "Allowed: week1, week2, week3, week4, invoice"
            )
        )

    if status and status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid status. Allowed: pending, partial, complete"
        )

    if compliance_range and compliance_range not in valid_compliance_ranges:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid compliance_range. "
                "Allowed: 0, 1-20, 21-40, 41-60, 61-80, 81-100"
            )
        )

    if sort_by not in valid_sort_fields:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid sort_by. "
                "Allowed: compliance_percentage, store_name, city, channel"
            )
        )

    if sort_order not in valid_sort_orders:
        raise HTTPException(
            status_code=400,
            detail="Invalid sort_order. Allowed: asc, desc"
        )

    # Aggregate monthly compliance presence per store in SQL.
    docs_presence_subquery = (
        db.query(
            StoreComplianceDocument.store_id.label("store_id"),
            func.max(
                case(
                    (
                        and_(
                            StoreComplianceDocument.document_type == "water_card",
                            StoreComplianceDocument.week_number == 1
                        ),
                        1
                    ),
                    else_=0
                )
            ).label("week1_uploaded"),
            func.max(
                case(
                    (
                        and_(
                            StoreComplianceDocument.document_type == "water_card",
                            StoreComplianceDocument.week_number == 2
                        ),
                        1
                    ),
                    else_=0
                )
            ).label("week2_uploaded"),
            func.max(
                case(
                    (
                        and_(
                            StoreComplianceDocument.document_type == "water_card",
                            StoreComplianceDocument.week_number == 3
                        ),
                        1
                    ),
                    else_=0
                )
            ).label("week3_uploaded"),
            func.max(
                case(
                    (
                        and_(
                            StoreComplianceDocument.document_type == "water_card",
                            StoreComplianceDocument.week_number == 4
                        ),
                        1
                    ),
                    else_=0
                )
            ).label("week4_uploaded"),
            func.max(
                case(
                    (
                        StoreComplianceDocument.document_type == "invoice",
                        1
                    ),
                    else_=0
                )
            ).label("invoice_uploaded")
        )
        .filter(
            StoreComplianceDocument.year == year,
            StoreComplianceDocument.month == month
        )
        .group_by(StoreComplianceDocument.store_id)
        .subquery()
    )

    stores_query = (
        db.query(
            Store,
            func.coalesce(docs_presence_subquery.c.week1_uploaded, 0).label("week1_uploaded"),
            func.coalesce(docs_presence_subquery.c.week2_uploaded, 0).label("week2_uploaded"),
            func.coalesce(docs_presence_subquery.c.week3_uploaded, 0).label("week3_uploaded"),
            func.coalesce(docs_presence_subquery.c.week4_uploaded, 0).label("week4_uploaded"),
            func.coalesce(docs_presence_subquery.c.invoice_uploaded, 0).label("invoice_uploaded")
        )
        .outerjoin(
            docs_presence_subquery,
            Store.id == docs_presence_subquery.c.store_id
        )
        .options(joinedload(Store.assigned_manager))
    )

    if current_user.role == RoleEnum.employee:
        stores_query = stores_query.filter(
            Store.id.in_(employee_assigned_store_ids)
        )

    if region and region.strip():
        stores_query = stores_query.filter(
            func.lower(func.trim(Store.region)) == region.strip().lower()
        )

    if city:
        stores_query = stores_query.filter(
            Store.city.ilike(f"%{city}%")
        )

    if channel:
        stores_query = stores_query.filter(
            Store.channel.ilike(f"%{channel}%")
        )

    if manager_id is not None:
        stores_query = stores_query.filter(
            Store.assigned_manager_id == manager_id
        )

    total_uploaded_expr = (
        func.coalesce(docs_presence_subquery.c.week1_uploaded, 0)
        + func.coalesce(docs_presence_subquery.c.week2_uploaded, 0)
        + func.coalesce(docs_presence_subquery.c.week3_uploaded, 0)
        + func.coalesce(docs_presence_subquery.c.week4_uploaded, 0)
        + func.coalesce(docs_presence_subquery.c.invoice_uploaded, 0)
    )

    compliance_percentage_expr = total_uploaded_expr * 20

    if missing_type:
        missing_expr_map = {
            "week1": func.coalesce(docs_presence_subquery.c.week1_uploaded, 0),
            "week2": func.coalesce(docs_presence_subquery.c.week2_uploaded, 0),
            "week3": func.coalesce(docs_presence_subquery.c.week3_uploaded, 0),
            "week4": func.coalesce(docs_presence_subquery.c.week4_uploaded, 0),
            "invoice": func.coalesce(docs_presence_subquery.c.invoice_uploaded, 0)
        }
        stores_query = stores_query.filter(
            missing_expr_map[missing_type] == 0
        )

    if status:
        if status == "pending":
            stores_query = stores_query.filter(total_uploaded_expr == 0)
        elif status == "partial":
            stores_query = stores_query.filter(
                total_uploaded_expr > 0,
                total_uploaded_expr < 5
            )
        else:  # complete
            stores_query = stores_query.filter(total_uploaded_expr == 5)

    if compliance_range:
        if compliance_range == "0":
            stores_query = stores_query.filter(compliance_percentage_expr == 0)
        elif compliance_range == "1-20":
            stores_query = stores_query.filter(
                compliance_percentage_expr >= 1,
                compliance_percentage_expr <= 20
            )
        elif compliance_range == "21-40":
            stores_query = stores_query.filter(
                compliance_percentage_expr >= 21,
                compliance_percentage_expr <= 40
            )
        elif compliance_range == "41-60":
            stores_query = stores_query.filter(
                compliance_percentage_expr >= 41,
                compliance_percentage_expr <= 60
            )
        elif compliance_range == "61-80":
            stores_query = stores_query.filter(
                compliance_percentage_expr >= 61,
                compliance_percentage_expr <= 80
            )
        else:  # 81-100
            stores_query = stores_query.filter(
                compliance_percentage_expr >= 81,
                compliance_percentage_expr <= 100
            )

    sort_expr_map = {
        "compliance_percentage": compliance_percentage_expr,
        "store_name": func.lower(func.coalesce(Store.store_name, "")),
        "city": func.lower(func.coalesce(Store.city, "")),
        "channel": func.lower(func.coalesce(Store.channel, ""))
    }

    sort_expr = sort_expr_map[sort_by]
    if sort_order == "desc":
        stores_query = stores_query.order_by(sort_expr.desc())
    else:
        stores_query = stores_query.order_by(sort_expr.asc())

    # Stable tie-breaker keeps pagination/order deterministic for same scores.
    stores_query = stores_query.order_by(
        func.lower(func.coalesce(Store.store_name, "")).asc()
    )

    store_rows = stores_query.all()

    if not store_rows:
        return []

    stores = [row[0] for row in store_rows]
    store_ids = [store.id for store in stores]

    all_docs = (
        db.query(StoreComplianceDocument)
        .filter(
            StoreComplianceDocument.store_id.in_(store_ids),
            StoreComplianceDocument.year == year,
            StoreComplianceDocument.month == month
        )
        .order_by(
            StoreComplianceDocument.store_id,
            StoreComplianceDocument.page_number.asc()
        )
        .all()
    )

    docs_map = defaultdict(list)

    for doc in all_docs:
        docs_map[doc.store_id].append(doc)

    response = []

    for store in stores:

        store_docs = docs_map.get(store.id, [])

        week1_docs = []
        week2_docs = []
        week3_docs = []
        week4_docs = []
        invoice_docs = []

        for doc in store_docs:

            if doc.document_type == "water_card":

                if doc.week_number == 1:
                    week1_docs.append(doc)

                elif doc.week_number == 2:
                    week2_docs.append(doc)

                elif doc.week_number == 3:
                    week3_docs.append(doc)

                elif doc.week_number == 4:
                    week4_docs.append(doc)

            elif doc.document_type == "invoice":
                invoice_docs.append(doc)

        uploaded_count = (
            (1 if week1_docs else 0)
            + (1 if week2_docs else 0)
            + (1 if week3_docs else 0)
            + (1 if week4_docs else 0)
            + (1 if invoice_docs else 0)
        )

        response.append({

            "store_id": store.id,
            "store_name": store.store_name,
            "city": store.city,
            "channel": store.channel,
            "delivery_manager_id": store.assigned_manager_id,
            "delivery_manager_name": (
                store.assigned_manager.full_name
                if store.assigned_manager
                else None
            ),

            # WEEK 1
            "week1_uploaded": len(week1_docs) > 0,
            "week1_documents": [
                {
                    "id": d.id,
                    "page_number": d.page_number,
                    "file_url": d.file_url,
                    "created_at": d.created_at
                }
                for d in week1_docs
            ],

            # WEEK 2
            "week2_uploaded": len(week2_docs) > 0,
            "week2_documents": [
                {
                    "id": d.id,
                    "page_number": d.page_number,
                    "file_url": d.file_url,
                    "created_at": d.created_at
                }
                for d in week2_docs
            ],

            # WEEK 3
            "week3_uploaded": len(week3_docs) > 0,
            "week3_documents": [
                {
                    "id": d.id,
                    "page_number": d.page_number,
                    "file_url": d.file_url,
                    "created_at": d.created_at
                }
                for d in week3_docs
            ],

            # WEEK 4
            "week4_uploaded": len(week4_docs) > 0,
            "week4_documents": [
                {
                    "id": d.id,
                    "page_number": d.page_number,
                    "file_url": d.file_url,
                    "created_at": d.created_at
                }
                for d in week4_docs
            ],

            # INVOICE
            "invoice_uploaded": len(invoice_docs) > 0,
            "invoice_documents": [
                {
                    "id": d.id,
                    "page_number": d.page_number,
                    "file_url": d.file_url,
                    "created_at": d.created_at
                }
                for d in invoice_docs
            ],

            # SUMMARY
            "uploaded_documents": uploaded_count,
            "total_required_documents": 5,
            "compliance_percentage": round(
                (uploaded_count / 5) * 100,
                2
            )
        })

    return response
@router.post("/admin-upload")
def admin_upload_store_document(
    store_id: str = Form(...),
    document_type: str = Form(...),
    year: int = Form(...),
    month: int = Form(...),
    week_number: int = Form(None),
    page_number: int = Form(1),
    remarks: str = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    import cloudinary.uploader

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store_compliance.upload",
            current_user,
            db
        )
        employee_store_access_required(
            store_id,
            current_user,
            db
        )
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only super admin allowed."
        )

    folder = f"store_compliance/{store_id}/{year}/{month}"

    store = db.query(Store).filter(
        Store.id == store_id
    ).first()

    if not store:
        raise HTTPException(
            status_code=404,
            detail="Store not found."
        )

    if document_type not in [
        "water_card",
        "invoice"
    ]:
        raise HTTPException(
            status_code=400,
            detail="Invalid document type."
        )

    if (
        document_type == "water_card"
        and not week_number
    ):
        raise HTTPException(
            status_code=400,
            detail="week_number required."
        )

    is_pdf = (
        (file.content_type or "").lower() == "application/pdf"
        or (file.filename or "").lower().endswith(".pdf")
    )
    upload_resource_type = "raw" if is_pdf else "auto"

    result = cloudinary.uploader.upload(
        file.file,
        resource_type=upload_resource_type,
        type="upload",
        folder=folder,
        public_id=(
            f"{document_type}_"
            f"{week_number or 'monthly'}_"
            f"page_{page_number}_"
            f"{int(datetime.utcnow().timestamp())}"
        )
    )

    print(
        "[CLOUDINARY UPLOAD] admin upload:",
        {
            "secure_url": result.get("secure_url"),
            "public_id": result.get("public_id"),
            "resource_type": result.get("resource_type"),
            "type": result.get("type"),
        }
    )

    file_url = result["secure_url"]

    existing = db.query(
        StoreComplianceDocument
    ).filter(
        StoreComplianceDocument.store_id == store_id,
        StoreComplianceDocument.document_type == document_type,
        StoreComplianceDocument.year == year,
        StoreComplianceDocument.month == month,
        StoreComplianceDocument.week_number == week_number,
        StoreComplianceDocument.page_number == page_number
    ).first()

    if existing:

        existing.file_url = file_url
        existing.remarks = remarks
        existing.created_at = datetime.utcnow()

        db.commit()
        db.refresh(existing)

        return existing

    new_doc = StoreComplianceDocument(
        store_id=store_id,
        uploaded_by=current_user.id,
        document_type=document_type,
        year=year,
        month=month,
        week_number=week_number,
        page_number=page_number,
        file_url=file_url,
        remarks=remarks
    )

    db.add(new_doc)

    db.commit()

    db.refresh(new_doc)

    return new_doc
@router.post("/generate-week4-pdf")
def generate_week4_pdf(
    payload: GeneratePDFRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store_compliance.export",
            current_user,
            db
        )
        assigned_store_ids = set(
            get_employee_store_ids(
                current_user.id,
                db=db
            )
        )
        unassigned_store_ids = [
            store_id
            for store_id in payload.store_ids
            if store_id not in assigned_store_ids
        ]

        if unassigned_store_ids:
            raise HTTPException(
                status_code=403,
                detail="One or more stores are not assigned to you."
            )

    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only super admin allowed."
        )

    if not payload.store_ids:
        raise HTTPException(
            status_code=400,
            detail="No stores selected."
        )

    pdf_filename = f"week4_cards_{uuid4().hex}.pdf"

    pdf_path = os.path.join(
        PDF_DIR,
        pdf_filename
    )

    stores = (
        db.query(Store)
        .filter(
            Store.id.in_(payload.store_ids)
        )
        .all()
    )

    store_map = {
        store.id: store
        for store in stores
    }

    docs = (
        db.query(StoreComplianceDocument)
        .filter(
            StoreComplianceDocument.store_id.in_(payload.store_ids),
            StoreComplianceDocument.document_type == "water_card",
            StoreComplianceDocument.year == payload.year,
            StoreComplianceDocument.month == payload.month,
            StoreComplianceDocument.week_number == 4
        )
        .order_by(
            StoreComplianceDocument.store_id.asc(),
            StoreComplianceDocument.page_number.asc()
        )
        .all()
    )

    docs_by_store = defaultdict(list)

    for doc in docs:
        docs_by_store[doc.store_id].append(doc)

    c = canvas.Canvas(
        pdf_path,
        pagesize=A4
    )

    stores_processed = 0
    pages_processed = 0
    missing = 0

    for store_id in payload.store_ids:

        store = store_map.get(store_id)

        if not store:
            missing += 1
            continue

        store_docs = docs_by_store.get(
            store_id,
            []
        )

        if not store_docs:
            missing += 1
            continue

        valid_pages = 0

        for doc in store_docs:

            image_path = doc.file_url

            if not image_path:
                continue

            image_source = None

            if image_path.startswith(("http://", "https://")):
                try:
                    with urlopen(image_path) as response:
                        image_bytes = response.read()

                    image_source = ImageReader(BytesIO(image_bytes))

                except Exception as e:
                    print(
                        f"PDF IMAGE FETCH ERROR: {str(e)}"
                    )
                    continue

            else:
                if not os.path.exists(image_path):
                    continue

                image_source = image_path

            try:

                c.setFont(
                    "Helvetica-Bold",
                    14
                )

                c.drawString(
                    40,
                    800,
                    f"Store: {store.store_name}"
                )

                c.drawString(
                    40,
                    780,
                    f"Month: {payload.month}/{payload.year}"
                )

                c.drawString(
                    40,
                    760,
                    f"Page: {doc.page_number}"
                )

                c.drawImage(
                    image_source,
                    30,
                    100,
                    width=520,
                    height=620,
                    preserveAspectRatio=True
                )

                c.showPage()

                pages_processed += 1
                valid_pages += 1

            except Exception as e:

                print(
                    f"PDF ERROR: {str(e)}"
                )

        if valid_pages > 0:
            stores_processed += 1
        else:
            missing += 1

    if pages_processed == 0:

        c.save()

        if os.path.exists(pdf_path):
            os.remove(pdf_path)

        raise HTTPException(
            status_code=404,
            detail="No valid Week 4 cards found."
        )

    c.save()

    return {
        "success": True,
        "pdf_url": f"/uploads/generated_pdfs/{pdf_filename}",
        "processed": stores_processed,
        "pages_processed": pages_processed,
        "missing": missing,
        "message": (
            f"PDF generated successfully with "
            f"{pages_processed} pages "
            f"from {stores_processed} stores."
        )
    }

@router.get("/filters")
def get_compliance_filters(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    stores_query = db.query(Store)

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store_compliance.view",
            current_user,
            db
        )
        stores_query = stores_query.filter(
            Store.id.in_(
                get_employee_store_ids(
                    current_user.id,
                    db=db
                )
            ),
            Store.is_active.is_(True),
        )
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only super admin allowed."
        )

    cities = stores_query.with_entities(
        Store.city
    ).distinct().all()

    channels = stores_query.with_entities(
        Store.channel
    ).distinct().all()

    return {
        "cities": [c[0] for c in cities if c[0]],
        "channels": [c[0] for c in channels if c[0]]
    }

@router.delete("/document/{document_id}")
def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    doc = (
        db.query(StoreComplianceDocument)
        .filter(
            StoreComplianceDocument.id == document_id
        )
        .first()
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store_compliance.delete",
            current_user,
            db
        )
        employee_store_access_required(
            doc.store_id,
            current_user,
            db
        )
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only super admin allowed."
        )

    try:

        if doc.file_url:

            if doc.file_url.startswith(("http://", "https://")):
                print("CLOUDINARY DELETE SKIPPED:", doc.file_url)

            elif os.path.exists(doc.file_url):
                os.remove(doc.file_url)

    except Exception as e:
        print("FILE DELETE ERROR:", str(e))

    db.delete(doc)
    db.commit()

    return {
        "success": True,
        "message": "Document deleted successfully"
    }
