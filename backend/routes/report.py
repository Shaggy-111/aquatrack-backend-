from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from typing import List
from datetime import datetime, timedelta, date
import os
import shutil
import pandas as pd
from io import BytesIO
import calendar
from sqlalchemy import text


from ..database.db import get_db
from ..models.user import User, RoleEnum
from ..models.report import Report
from ..models.order import Order, OrderStatusEnum
from ..models.store import Store
from ..schemas.report import ReportOut
from ..utils.jwt import get_current_user
from ..models.partner_store import PartnerStore

router = APIRouter(prefix="/reports", tags=["Reports"])

# Ensure uploads directory exists for the reports
UPLOADS_DIR = "uploads"
if not os.path.exists(UPLOADS_DIR):
    os.makedirs(UPLOADS_DIR)

@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_report(
    report_date: str = Form(...),
    valid_upto: str = Form(None), # Explicitly accept valid_upto from Frontend Form
    report_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Allows a Super Admin to upload a water report and SAVES it to disk and Database.
    """
    # 1. Security Check
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can upload reports."
        )

    # 2. File Type Validation
    if report_file.content_type != 'application/pdf':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Only PDF files are allowed."
        )

    # DEBUG: Terminal check to see what data is arriving
    print(f"DEBUG INCOMING: report_date={report_date}, valid_upto={valid_upto}")

    # 3. Handle File Saving to Disk
    file_name = f"report_{date.today().isoformat()}_{report_file.filename}"
    file_location = os.path.join(UPLOADS_DIR, file_name)

    try:
        with open(file_location, "wb") as buffer:
            shutil.copyfileobj(report_file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    # 4. Handle Date Logic (Safe Parsing)
    try:
        # report_date handling
        parsed_report_date = date.fromisoformat(report_date)
        
        # valid_upto handling (Check for empty strings or 'null' from JS)
        parsed_valid_upto = None
        if valid_upto and valid_upto not in ["", "null", "undefined"]:
            parsed_valid_upto = date.fromisoformat(valid_upto)
            
    except ValueError:
        raise HTTPException(
            status_code=400, 
            detail="Invalid date format. Use YYYY-MM-DD"
        )

    # 5. Save reference in Database
    new_report = Report(
        report_date=parsed_report_date,
        valid_upto=parsed_valid_upto,  # <--- THIS SAVES THE DATE
        file_path=file_location,
        uploaded_by_id=current_user.id
    )
    
    try:
        db.add(new_report)
        db.commit()
        db.refresh(new_report)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database Error: {str(e)}")

    return {
        "message": "Report uploaded successfully", 
        "report_id": new_report.id, 
        "valid_upto": new_report.valid_upto,
        "file_path": file_location
    }

@router.get("/list", response_model=List[ReportOut])
def get_all_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves a list of all water quality reports.
    """
    allowed_roles = [RoleEnum.superadmin, RoleEnum.partner, RoleEnum.channel_admin]
    
    if current_user.role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view this resource."
        )

    reports = db.query(Report).all()
    return reports

@router.get("/monthly-pivot/export")
async def export_monthly_pivot(
    from_date: str, 
    to_date: str,   
    state: str = None,
    city: str = None,
    channel: str = None,  
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        start_dt = datetime.strptime(from_date, '%Y-%m-%d')
        end_dt = datetime.strptime(to_date, '%Y-%m-%d')
    except:
        raise HTTPException(status_code=400, detail="Invalid date format")

    query = db.query(Store).options(
        joinedload(Store.partner_associations).joinedload(PartnerStore.user),
        joinedload(Store.orders)
    )

    # ✅ Filters
    if state and state not in ["state", "All States", ""]:
        query = query.filter(Store.state == state)

    if city and city not in ["city", "All Cities", ""]:
        query = query.filter(Store.city == city)

    if current_user.role == RoleEnum.channel_admin:
        query = query.filter(func.upper(Store.channel) == current_user.channel.upper())
    elif channel and channel not in ["All Entities", ""]:
        query = query.filter(func.upper(Store.channel) == channel.upper())

    stores = query.all()

    if not stores:
        raise HTTPException(status_code=404, detail="No stores found")

    # 📅 Dates
    selected_days = []
    curr = start_dt
    day_fmt = "#d" if os.name == "nt" else "-d"

    while curr <= end_dt:
        selected_days.append(curr.strftime(f'%{day_fmt}-%b'))
        curr += timedelta(days=1)

    data = []

    for s in stores:
        manager = s.partner_associations[0].user if s.partner_associations else None

        # 🔥 ALWAYS INITIALIZE (CRITICAL FIX)
        mapping = None

        # 🔥 DEFAULT PRIMARY
        primary_vendor = "VeeKay Aquatech PVT Ltd"
        primary_license = "10013064000321"

        secondary_vendor = ""
        secondary_license = ""

        # 🔥 APPLY ONLY FOR ZEPTO
        if (s.channel or "").upper() == "ZEPTO":

            mapping = db.execute(text("""
                SELECT secondary_vendor_name, license_number
                FROM vendor_mapping
                WHERE TRIM(store_id) = :store_id
                AND entity = 'ZEPTO'
            """), {
                "store_id": str(s.id).strip()
            }).fetchone()

            if mapping:
                secondary_vendor = mapping[0] or ""
                secondary_license = mapping[1] or ""

        # 👉 Date Map
        date_map = {day: 0 for day in selected_days}

        for o in s.orders:
            if not o.order_date:
                continue

            if o.status != OrderStatusEnum.delivered_confirmed:
                continue

            order_date = o.order_date.date()

            if not (start_dt.date() <= order_date <= end_dt.date()):
                continue

            day_key = o.order_date.strftime(f'%{day_fmt}-%b')
            date_map[day_key] += int(o.bottles_delivered or 0)

        row = {
            "Region": "NORTH",
            "Entity": str(s.channel or "N/A").upper(),
            "STATE": str(s.state or "N/A"),
            "City": str(s.city or "N/A"),
            "Outlet ID": str(s.id),
            "Outlet Name": str(s.store_name or "N/A"),
            "POC Name": str(getattr(manager, 'full_name', 'N/A')),
            "Contact No": str(getattr(manager, 'mobile_number', 'N/A')),

            # 🔥 PRIMARY (ALWAYS)
            "PRIMARY VENDOR NAME": primary_vendor,
            "PRIMARY LICENSE NUMBER": primary_license,

            # 🔥 SECONDARY (ONLY ZEPTO)
            "SECONDARY VENDOR NAME": secondary_vendor,
            "SECONDARY LICENSE NUMBER": secondary_license,
        }

        row.update(date_map)
        row["Total Count"] = sum(date_map.values())

        data.append(row)

    df = pd.DataFrame(data)

    info_cols = [
        "Region", "Entity", "STATE", "City", "Outlet ID",
        "Outlet Name", "POC Name", "Contact No",
        "PRIMARY VENDOR NAME", "PRIMARY LICENSE NUMBER",
        "SECONDARY VENDOR NAME", "SECONDARY LICENSE NUMBER"
    ]

    final_cols = info_cols + ["Total Count"] + selected_days
    df = df[final_cols]

    output = BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name="Distribution")

    output.seek(0)

    filename = f"Distribution_{channel or 'All'}_{from_date}_to_{to_date}.xlsx"

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
@router.get("/download/{report_id}")
async def download_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Serves the PDF file content.
    Accessible to Super Admins, Partners, and Channel Admins.
    """
    allowed_roles = [RoleEnum.superadmin, RoleEnum.partner, RoleEnum.channel_admin]
    
    if current_user.role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized to download reports."
        )

    report = db.query(Report).filter(Report.id == report_id).first()
    
    if not report:
        raise HTTPException(status_code=404, detail="Report record not found.")

    if not os.path.exists(report.file_path):
        raise HTTPException(status_code=404, detail="PDF file not found on server.")

    return FileResponse(
        path=report.file_path, 
        media_type='application/pdf', 
        filename=os.path.basename(report.file_path)
    )