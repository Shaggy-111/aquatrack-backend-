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
from ..utils.permissions import get_employee_store_ids, require_permission

router = APIRouter(prefix="/complaints", tags=["Complaints"])

# Upload directory
COMPLAINTS_UPLOADS_DIR = "uploads/complaints"
os.makedirs(COMPLAINTS_UPLOADS_DIR, exist_ok=True)


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

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "complaints.create",
            current_user,
            db
        )
        employee_store_access_required(
            store_id,
            current_user,
            db
        )

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
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "complaints.view",
            current_user,
            db
        )
        store_filter = Complaint.store_id.in_(
            get_employee_store_ids(
                current_user.id,
                db=db
            )
        )
    else:
        store_filter = Complaint.id != None

    complaints = (
        db.query(Complaint)
        .options(
            joinedload(Complaint.created_by),
            joinedload(Complaint.assigned_admin),
            joinedload(Complaint.assigned_channel_admin)
        )
        .filter(
            Complaint.created_by_id == current_user.id,
            store_filter
        )
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

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "complaints.view",
            current_user,
            db
        )
        assigned_filter = Complaint.store_id.in_(
            get_employee_store_ids(
                current_user.id,
                db=db
            )
        )
    else:
        assigned_filter = (
            (Complaint.assigned_to_admin_id == current_user.id) |
            (Complaint.assigned_to_channel_admin_id == current_user.id)
        )

    complaints = (
        db.query(Complaint)
        .join(Store, Complaint.store_id == Store.id)
        .options(
            joinedload(Complaint.created_by),
            joinedload(Complaint.assigned_admin),
            joinedload(Complaint.assigned_channel_admin)
        )
        .filter(assigned_filter)
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

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "complaints.edit",
            current_user,
            db
        )
        employee_store_access_required(
            complaint.store_id,
            current_user,
            db
        )
    elif not (
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
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "complaints.view",
            current_user,
            db
        )
        store_filter = Complaint.store_id.in_(
            get_employee_store_ids(
                current_user.id,
                db=db
            )
        )
    elif current_user.role != RoleEnum.channel_admin:
        raise HTTPException(403, "Only channel admins can access this.")
    else:
        channel = current_user.channel.upper()
        store_filter = func.upper(Store.channel) == channel

    complaints = (
        db.query(Complaint)
        .join(Store, Complaint.store_id == Store.id)
        .options(
            joinedload(Complaint.created_by),
            joinedload(Complaint.assigned_admin),
            joinedload(Complaint.assigned_channel_admin),
            joinedload(Complaint.store)  # optional
        )
        .filter(store_filter)   # ✅ FIXED
        .order_by(Complaint.created_at.desc())
        .all()
    )

    return complaints


