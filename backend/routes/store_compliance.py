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


from pydantic import BaseModel

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4




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

# -------------------------------------------------
# SUPER ADMIN REPOSITORY
# -------------------------------------------------
@router.get("/repository")
def get_compliance_repository(
    month: int,
    year: int,
    city: str = None,
    channel: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):

    stores_query = db.query(Store)

    if city:
        stores_query = stores_query.filter(
            Store.city.ilike(f"%{city}%")
        )

    if channel:
        stores_query = stores_query.filter(
            Store.channel.ilike(f"%{channel}%")
        )

    stores = stores_query.all()

    response = []

    for store in stores:

        week1_doc = (
            db.query(StoreComplianceDocument)
            .filter(
                StoreComplianceDocument.store_id == store.id,
                StoreComplianceDocument.document_type == "water_card",
                StoreComplianceDocument.year == year,
                StoreComplianceDocument.month == month,
                StoreComplianceDocument.week_number == 1
            )
            .first()
        )

        week2_doc = (
            db.query(StoreComplianceDocument)
            .filter(
                StoreComplianceDocument.store_id == store.id,
                StoreComplianceDocument.document_type == "water_card",
                StoreComplianceDocument.year == year,
                StoreComplianceDocument.month == month,
                StoreComplianceDocument.week_number == 2
            )
            .first()
        )

        week3_doc = (
            db.query(StoreComplianceDocument)
            .filter(
                StoreComplianceDocument.store_id == store.id,
                StoreComplianceDocument.document_type == "water_card",
                StoreComplianceDocument.year == year,
                StoreComplianceDocument.month == month,
                StoreComplianceDocument.week_number == 3
            )
            .first()
        )

        week4_doc = (
            db.query(StoreComplianceDocument)
            .filter(
                StoreComplianceDocument.store_id == store.id,
                StoreComplianceDocument.document_type == "water_card",
                StoreComplianceDocument.year == year,
                StoreComplianceDocument.month == month,
                StoreComplianceDocument.week_number == 4
            )
            .first()
        )

        invoice_doc = (
            db.query(StoreComplianceDocument)
            .filter(
                StoreComplianceDocument.store_id == store.id,
                StoreComplianceDocument.document_type == "invoice",
                StoreComplianceDocument.year == year,
                StoreComplianceDocument.month == month
            )
            .first()
        )

        response.append({

            "store_id": store.id,
            "store_name": store.store_name,
            "city": store.city,
            "channel": store.channel,

            # Week 1
            "week1_uploaded": week1_doc is not None,
            "week1_file_url":
                week1_doc.file_url
                if week1_doc else None,

            # Week 2
            "week2_uploaded": week2_doc is not None,
            "week2_file_url":
                week2_doc.file_url
                if week2_doc else None,

            # Week 3
            "week3_uploaded": week3_doc is not None,
            "week3_file_url":
                week3_doc.file_url
                if week3_doc else None,

            # Week 4
            "week4_uploaded": week4_doc is not None,
            "week4_file_url":
                week4_doc.file_url
                if week4_doc else None,

            # Invoice
            "invoice_uploaded": invoice_doc is not None,
            "invoice_file_url":
                invoice_doc.file_url
                if invoice_doc else None,

            # Summary
            "uploaded_at":
                week4_doc.created_at
                if week4_doc
                else None,

            "compliance_percentage": (
                (
                    (1 if week1_doc else 0)
                    + (1 if week2_doc else 0)
                    + (1 if week3_doc else 0)
                    + (1 if week4_doc else 0)
                ) / 4
            ) * 100

        })

    return response

@router.post("/admin-upload")
def admin_upload_store_document(
    store_id: str = Form(...),
    document_type: str = Form(...),
    year: int = Form(...),
    month: int = Form(...),
    week_number: int = Form(None),
    remarks: str = Form(None),
    file: UploadFile = File(...),

    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):

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

    if document_type == "water_card" and not week_number:
        raise HTTPException(
            status_code=400,
            detail="week_number required."
        )

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

@router.post("/generate-week4-pdf")
def generate_week4_pdf(
    payload: GeneratePDFRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):

    timestamp = int(datetime.utcnow().timestamp())

    pdf_filename = f"week4_cards_{timestamp}.pdf"

    pdf_path = os.path.join(
        PDF_DIR,
        pdf_filename
    )

    c = canvas.Canvas(
        pdf_path,
        pagesize=A4
    )

    processed = 0
    missing = 0

    for store_id in payload.store_ids:

        print("\n==============================")
        print("STORE ID:", store_id)
        print("MONTH:", payload.month)
        print("YEAR:", payload.year)

        all_docs = (
            db.query(StoreComplianceDocument)
            .filter(
                StoreComplianceDocument.store_id == store_id
            )
            .all()
        )

        print("ALL DOCS FOUND:", len(all_docs))

        for d in all_docs:
            print(
                f"ID={d.id}, "
                f"STORE={d.store_id}, "
                f"TYPE={d.document_type}, "
                f"YEAR={d.year}, "
                f"MONTH={d.month}, "
                f"WEEK={d.week_number}, "
                f"FILE={d.file_url}"
            )

        doc = (
            db.query(StoreComplianceDocument)
            .filter(
                StoreComplianceDocument.store_id == store_id,
                StoreComplianceDocument.document_type == "water_card",
                StoreComplianceDocument.year == payload.year,
                StoreComplianceDocument.month == payload.month,
                StoreComplianceDocument.week_number == 4
            )
            .first()
        )

        print("MATCHED DOC:", doc)

        if not doc:
            print("❌ NO MATCHING WEEK4 DOC FOUND")
            missing += 1
            continue

        store = (
            db.query(Store)
            .filter(Store.id == store_id)
            .first()
        )

        print("STORE OBJECT:", store)

        if not store:
            print("❌ STORE NOT FOUND")
            missing += 1
            continue

        try:

            image_path = doc.file_url

            print("IMAGE PATH:", image_path)

            if not os.path.exists(image_path):

                print(f"❌ FILE NOT FOUND: {image_path}")

                missing += 1
                continue

            print("✅ FILE EXISTS")

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

            c.drawImage(
                image_path,
                30,
                100,
                width=520,
                height=620,
                preserveAspectRatio=True
            )

            c.showPage()

            processed += 1

            print("✅ PAGE ADDED TO PDF")

        except Exception as e:

            print(f"❌ PDF ERROR: {str(e)}")

            missing += 1

    print("\n==============================")
    print("PROCESSED:", processed)
    print("MISSING:", missing)
    print("==============================\n")

    if processed == 0:

        c.save()

        if os.path.exists(pdf_path):
            os.remove(pdf_path)

        raise HTTPException(
            status_code=404,
            detail="No Week 4 cards found for selected stores."
        )

    c.save()

    return {
        "success": True,
        "pdf_url": f"/uploads/generated_pdfs/{pdf_filename}",
        "processed": processed,
        "missing": missing,
        "message": f"PDF generated successfully with {processed} cards."
    }

@router.get("/filters")
def get_compliance_filters(
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):

    cities = (
        db.query(Store.city)
        .distinct()
        .all()
    )

    channels = (
        db.query(Store.channel)
        .distinct()
        .all()
    )

    return {
        "cities": [c[0] for c in cities if c[0]],
        "channels": [c[0] for c in channels if c[0]]
    }