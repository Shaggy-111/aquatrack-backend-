from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from sqlalchemy import func
from sqlalchemy import Column, String
import shutil
import os
from datetime import datetime

from ..database.db import get_db
from ..models.user import User, RoleEnum
from ..models.store import Store
from ..models.complaint import Complaint, ComplaintStatusEnum
from ..schemas.complaint import ComplaintCreate, ComplaintOut, ComplaintResolve
from ..utils.jwt import get_current_user

router = APIRouter(prefix="/complaints", tags=["Complaints"])

# Upload directory
COMPLAINTS_UPLOADS_DIR = "uploads/complaints"
os.makedirs(COMPLAINTS_UPLOADS_DIR, exist_ok=True)


# ------------------ SUBMIT COMPLAINT ------------------
@router.post("/submit", status_code=status.HTTP_201_CREATED)
async def submit_complaint(
    subject: str = Form(...),
    description: str = Form(...),
    store_id: str = Form(...),
    photo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    from ..models.store import Store
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(404, "Store not found")

    channel = store.channel.upper()

    # Find channel admin
    channel_admin = db.query(User).filter(
        User.role == RoleEnum.channel_admin,
        User.channel == channel
    ).first()

    if not channel_admin:
        raise HTTPException(404, f"No channel admin found for channel {channel}")

    # Find superadmin
    superadmin = db.query(User).filter(User.role == RoleEnum.superadmin).first()
    if not superadmin:
        raise HTTPException(500, "SuperAdmin not found!")

    # Upload image
    photo_url_to_save = None
    if photo:
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        safe_filename = f"complaint_{current_user.id}_{timestamp}_{photo.filename}"
        file_location = os.path.join(COMPLAINTS_UPLOADS_DIR, safe_filename)

        with open(file_location, "wb+") as f:
            await photo.seek(0)
            f.write(await photo.read())

        photo_url_to_save = file_location

    # Create
    new_complaint = Complaint(
        subject=subject,
        description=description,
        created_by_id=current_user.id,
        store_id=store_id,
        photo_url=photo_url_to_save,
        channel=channel,
        assigned_to_admin_id=superadmin.id,
        assigned_to_channel_admin_id=channel_admin.id
    )

    db.add(new_complaint)
    db.commit()
    db.refresh(new_complaint)

    return {
        "message": "Complaint submitted successfully.",
        "assigned_to": {
            "superadmin": superadmin.email,
            "channel_admin": channel_admin.email,
            "channel": channel
        }
    }


# ------------------ MY COMPLAINTS ------------------
@router.get("/me", response_model=List[ComplaintOut])
def get_my_complaints(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    complaints = (
        db.query(Complaint)
        .options(
            joinedload(Complaint.created_by),
            joinedload(Complaint.assigned_admin),
            joinedload(Complaint.assigned_channel_admin)
        )
        .filter(Complaint.created_by_id == current_user.id)
        .order_by(Complaint.created_at.desc())
        .all()
    )
    return complaints


# ------------------ COMPLAINTS ASSIGNED TO ME ------------------
@router.get("/assigned", response_model=List[ComplaintOut])
def get_complaints_assigned_to_me(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    complaints = (
        db.query(Complaint)
        .join(Store, Complaint.store_id == Store.id)
        .options(
            joinedload(Complaint.created_by),
            joinedload(Complaint.assigned_admin),
            joinedload(Complaint.assigned_channel_admin)
        )
        .filter(
            (Complaint.assigned_to_admin_id == current_user.id) |
            (Complaint.assigned_to_channel_admin_id == current_user.id)
        )
        .order_by(Complaint.created_at.desc())
        .all()
    )

    return complaints


# ------------------ RESOLVE COMPLAINT ------------------
@router.patch("/{complaint_id}/resolve")
def resolve_complaint(
    complaint_id: int,
    request: ComplaintResolve,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint:
        raise HTTPException(404, "Complaint not found.")

    if not (
        current_user.role == RoleEnum.superadmin or
        complaint.assigned_to_admin_id == current_user.id or
        complaint.assigned_to_channel_admin_id == current_user.id
    ):
        raise HTTPException(403, "Not authorized to resolve this complaint.")

    if complaint.status == ComplaintStatusEnum.resolved:
        raise HTTPException(400, "Complaint already resolved.")

    complaint.status = request.status
    complaint.solution = request.solution
    complaint.updated_at = func.now()
    db.commit()
    db.refresh(complaint)

    return {"message": "Complaint resolved successfully."}


# ------------------ CHANNEL ADMIN COMPLAINTS ------------------
@router.get("/channel-admin/my-channel", response_model=List[ComplaintOut])
def get_complaints_for_channel_admin(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.channel_admin:
        raise HTTPException(403, "Only channel admins can access this.")

    channel = current_user.channel.upper()

    complaints = (
        db.query(Complaint)
        .join(Store, Complaint.store_id == Store.id)
        .options(
            joinedload(Complaint.created_by),
            joinedload(Complaint.assigned_admin),
            joinedload(Complaint.assigned_channel_admin),
            joinedload(Complaint.store)  # optional
        )
        .filter(func.upper(Store.channel) == channel)   # ✅ FIXED
        .order_by(Complaint.created_at.desc())
        .all()
    )

    return complaints


