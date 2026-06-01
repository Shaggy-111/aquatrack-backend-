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

from ..database.db import get_db

from ..models.store import Store
from ..models.user import User, RoleEnum
from ..models.store_compliance import StoreComplianceDocument

from ..schemas.store_compliance import StoreComplianceOut

from ..utils.jwt import get_current_user

from typing import List
from datetime import datetime

import shutil
import os


router = APIRouter(
    prefix="/store-compliance",
    tags=["Store Compliance"]
)

UPLOAD_DIR = "uploads/store_compliance"
os.makedirs(UPLOAD_DIR, exist_ok=True)


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
    remarks: str = Form(None),

    file: UploadFile = File(...),

    db: Session = Depends(get_db),

    current_user: User = Depends(
        delivery_manager_required
    )
):

    # -------------------------------------------------
    # VALIDATE STORE
    # -------------------------------------------------
    store = db.query(Store).filter(
        Store.id == store_id,
        Store.assigned_manager_id == current_user.id
    ).first()

    if not store:
        raise HTTPException(
            status_code=404,
            detail="Store not assigned to you."
        )

    # -------------------------------------------------
    # VALIDATION
    # -------------------------------------------------
    if document_type not in [
        "water_card",
        "invoice"
    ]:
        raise HTTPException(
            status_code=400,
            detail="Invalid document type."
        )

    # water card needs week number
    if document_type == "water_card" and not week_number:
        raise HTTPException(
            status_code=400,
            detail="week_number required for water card."
        )

    # -------------------------------------------------
    # FILE SAVE
    # -------------------------------------------------
    folder_path = os.path.join(
        UPLOAD_DIR,
        store_id,
        str(year),
        str(month)
    )

    os.makedirs(folder_path, exist_ok=True)

    filename = (
        f"{document_type}_"
        f"{week_number or 'monthly'}_"
        f"{int(datetime.utcnow().timestamp())}_"
        f"{file.filename}"
    )

    filepath = os.path.join(
        folder_path,
        filename
    )

    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    file_url = filepath.replace("\\", "/")

    # -------------------------------------------------
    # DUPLICATE CHECK
    # -------------------------------------------------
    existing = db.query(
        StoreComplianceDocument
    ).filter(
        StoreComplianceDocument.store_id == store_id,
        StoreComplianceDocument.document_type == document_type,
        StoreComplianceDocument.year == year,
        StoreComplianceDocument.month == month,
        StoreComplianceDocument.week_number == week_number
    ).first()

    if existing:
        existing.file_url = file_url
        existing.remarks = remarks
        existing.created_at = datetime.utcnow()

        db.commit()
        db.refresh(existing)

        return existing

    # -------------------------------------------------
    # CREATE ENTRY
    # -------------------------------------------------
    new_doc = StoreComplianceDocument(
        store_id=store_id,
        uploaded_by=current_user.id,
        document_type=document_type,
        year=year,
        month=month,
        week_number=week_number,
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
    current_user: User = Depends(
        delivery_manager_required
    )
):

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