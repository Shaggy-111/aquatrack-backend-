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


# ==========================================================
# MANUAL DELIVERY EXCEL UPLOAD
# ==========================================================

@router.post("/upload-manual-delivery")
async def upload_manual_delivery(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload Excel in report format and:
    1. Update existing orders as delivered
    2. Create missing orders and mark delivered
    3. Set filled and empty bottles equal to uploaded quantity
    4. Handles Outlet ID formats like:
       - 4580
       - 4580.0
       - " 4580 "
       - "04580"
    5. Allows maximum 50 UNIQUE stores only
    """

    # --------------------------------------------------
    # Role Validation
    # --------------------------------------------------
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only Super Admin can upload manual delivery data."
        )

    # --------------------------------------------------
    # File Validation
    # --------------------------------------------------
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Please upload a valid Excel file."
        )

    # --------------------------------------------------
    # Read Excel File
    # --------------------------------------------------
    try:
        contents = await file.read()
        df = pd.read_excel(BytesIO(contents))

        # Remove completely blank rows
        df = df.dropna(how="all")

        # Remove completely blank columns
        df = df.dropna(axis=1, how="all")

        # Clean column names
        df.columns = [str(col).strip() for col in df.columns]

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to read Excel file: {str(e)}"
        )

    # --------------------------------------------------
    # Validate Required Column
    # --------------------------------------------------
    if "Outlet ID" not in df.columns:
        raise HTTPException(
            status_code=400,
            detail="Excel must contain 'Outlet ID' column."
        )

    # --------------------------------------------------
    # Static Columns to Ignore
    # --------------------------------------------------
    ignore_columns = {
        "Region",
        "Entity",
        "STATE",
        "City",
        "Outlet ID",
        "Outlet Name",
        "POC Name",
        "Contact No",
        "PRIMARY VENDOR NAME",
        "PRIMARY LICENSE NUMBER",
        "SECONDARY VENDOR NAME",
        "SECONDARY LICENSE NUMBER",
        "Total Count"
    }

    # --------------------------------------------------
    # Detect Date Columns
    # --------------------------------------------------
    date_columns = [
        col for col in df.columns
        if str(col).strip() not in ignore_columns
    ]

    if not date_columns:
        raise HTTPException(
            status_code=400,
            detail="No date columns found in Excel."
        )

    # --------------------------------------------------
    # Count Unique Stores (ROBUST FIX)
    # Counts only rows having at least one positive quantity
    # --------------------------------------------------
    for col in date_columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    valid_rows = df[
        df[date_columns]
        .fillna(0)
        .gt(0)
        .any(axis=1)
    ].copy()

    if valid_rows.empty:
        raise HTTPException(
            status_code=400,
            detail="No delivery quantities found in Excel."
        )

    cleaned_outlet_ids = (
        valid_rows["Outlet ID"]
        .fillna("")
        .astype(str)
        .str.replace(".0", "", regex=False)
        .str.strip()
    )

    cleaned_outlet_ids = cleaned_outlet_ids[
        (cleaned_outlet_ids != "") &
        (~cleaned_outlet_ids.str.lower().isin(
            ["nan", "none", "null"]
        ))
    ]

    unique_stores = cleaned_outlet_ids.unique()

    print("=" * 80)
    print("VALID ROWS:", len(valid_rows))
    print("UNIQUE STORES:", len(unique_stores))
    print("STORE IDS:", unique_stores.tolist())
    print("=" * 80)

    if len(unique_stores) > 50:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Maximum 50 stores allowed per upload. "
                f"Found {len(unique_stores)} stores."
            )
        )

    # --------------------------------------------------
    # Parse Date Column Names
    # Example: "01-May"
    # --------------------------------------------------
    def parse_day_column(column_name: str) -> date:
        try:
            column_name = str(column_name).strip()

            day_part, month_part = column_name.split("-")
            day_num = int(day_part)

            month_map = {
                "Jan": 1,
                "Feb": 2,
                "Mar": 3,
                "Apr": 4,
                "May": 5,
                "Jun": 6,
                "Jul": 7,
                "Aug": 8,
                "Sep": 9,
                "Oct": 10,
                "Nov": 11,
                "Dec": 12
            }

            month_num = month_map[month_part[:3].title()]
            current_year = datetime.utcnow().year

            return date(current_year, month_num, day_num)

        except Exception:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid date column format: {column_name}"
            )

    # --------------------------------------------------
    # Counters
    # --------------------------------------------------
    stores_processed = 0
    orders_updated = 0
    orders_created = 0
    skipped = 0
    unknown_stores = []

    # --------------------------------------------------
    # Process Each Row
    # --------------------------------------------------
    for _, row in valid_rows.iterrows():

        # ----------------------------------------------
        # Normalize Outlet ID + Outlet Name
        # ----------------------------------------------
        outlet_raw = row.get("Outlet ID", "")
        outlet_name = str(
            row.get("Outlet Name", "")
        ).strip()

        # Skip if both missing
        if pd.isna(outlet_raw) and not outlet_name:
            continue

        # Convert Outlet ID safely
        try:
            if pd.isna(outlet_raw):
                outlet_id = ""
            elif isinstance(outlet_raw, (int, float)):
                outlet_id = str(int(outlet_raw))
            else:
                outlet_id = (
                    str(outlet_raw)
                    .replace(".0", "")
                    .strip()
                )
        except Exception:
            outlet_id = (
                str(outlet_raw)
                .replace(".0", "")
                .strip()
            )

        # Normalize invalid strings
        if outlet_id.lower() in ["nan", "none", "null"]:
            outlet_id = ""

        normalized_outlet_id = (
            outlet_id.lstrip("0") or "0"
        )

        # ----------------------------------------------
        # Store Lookup
        # ----------------------------------------------
        store = None

        # 1. Exact match by Store ID
        if outlet_id:
            store = (
                db.query(Store)
                .filter(Store.id == outlet_id)
                .first()
            )

        # 2. Trimmed match
        if not store and outlet_id:
            store = (
                db.query(Store)
                .filter(func.trim(Store.id) == outlet_id)
                .first()
            )

        # 3. Leading-zero insensitive match
        if not store and outlet_id:
            all_stores = db.query(Store).all()

            for candidate in all_stores:
                candidate_id = str(candidate.id).strip()
                candidate_normalized = (
                    candidate_id.lstrip("0") or "0"
                )

                if candidate_normalized == normalized_outlet_id:
                    store = candidate
                    break

        # 4. Exact Outlet Name match
        if not store and outlet_name:
            store = (
                db.query(Store)
                .filter(
                    func.lower(
                        func.trim(Store.store_name)
                    ) == outlet_name.lower()
                )
                .first()
            )

        # 5. Partial Outlet Name match
        if not store and outlet_name:
            store = (
                db.query(Store)
                .filter(
                    func.lower(Store.store_name).contains(
                        outlet_name.lower()
                    )
                )
                .first()
            )

        # ----------------------------------------------
        # Store Not Found
        # ----------------------------------------------
        if not store:
            print(
                f"❌ Store not found | "
                f"Outlet ID: {outlet_id} | "
                f"Outlet Name: {outlet_name}"
            )

            unknown_stores.append({
                "outlet_id": outlet_id,
                "outlet_name": outlet_name
            })

            skipped += 1
            continue

        stores_processed += 1

        # ----------------------------------------------
        # Validate Partner and Manager
        # ----------------------------------------------
        partner = (
            store.partners[0]
            if store.partners
            else None
        )

        manager_id = store.assigned_manager_id

        if not partner or not manager_id:
            print(
                f"⚠️ Skipped {store.id}: "
                f"Partner or Manager missing"
            )
            skipped += 1
            continue

        # ----------------------------------------------
        # Process Each Date Column
        # ----------------------------------------------
        for col in date_columns:
            raw_value = row.get(col)

            # Skip blank cells
            if pd.isna(raw_value):
                continue

            # Convert quantity
            try:
                qty = int(float(raw_value))
            except Exception:
                continue

            # Skip zero or negative
            if qty <= 0:
                continue

            # Parse delivery date
            delivery_date = parse_day_column(col)

            # ------------------------------------------
            # Find Existing Order
            # ------------------------------------------
            existing_order = (
                db.query(Order)
                .filter(
                    Order.store_id == store.id,
                    func.date(Order.order_date)
                    == delivery_date
                )
                .order_by(Order.id.desc())
                .first()
            )

            # ------------------------------------------
            # Update Existing Order
            # ------------------------------------------
            if existing_order:
                existing_order.status = (
                    OrderStatusEnum.delivered_confirmed
                )
                existing_order.order_details = str(qty)
                existing_order.total_amount = 0
                existing_order.bottles_delivered = qty
                existing_order.empty_bottles_collected = qty
                existing_order.confirmed_empty_bottles = qty
                existing_order.confirmed_bottles = qty
                existing_order.store_confirmed = True
                existing_order.delivered_by = "Excel Upload"
                existing_order.vehicle_info = "Manual Upload"
                existing_order.order_date = datetime.combine(
                    delivery_date,
                    datetime.min.time()
                )
                existing_order.updated_at = datetime.utcnow()

                orders_updated += 1

            # ------------------------------------------
            # Create New Order
            # ------------------------------------------
            else:
                try:
                    new_order = Order(
                        partner_id=partner.id,
                        store_id=store.id,
                        assigned_to_manager_id=manager_id,
                        order_details=str(qty),
                        total_amount=0,
                        status=(
                            OrderStatusEnum
                            .delivered_confirmed
                        ),
                        channel=store.channel,
                        order_date=datetime.combine(
                            delivery_date,
                            datetime.min.time()
                        ),
                        bottles_delivered=qty,
                        empty_bottles_collected=qty,
                        confirmed_empty_bottles=qty,
                        confirmed_bottles=qty,
                        store_confirmed=True,
                        delivered_by="Excel Upload",
                        vehicle_info="Manual Upload"
                    )

                    db.add(new_order)
                    db.flush()

                    orders_created += 1

                except Exception as create_error:
                    print(
                        f"❌ Failed to create order "
                        f"for Store {store.id}: "
                        f"{str(create_error)}"
                    )
                    db.rollback()
                    skipped += 1
                    continue

    # --------------------------------------------------
    # Commit Database
    # --------------------------------------------------
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Database error: {str(e)}"
        )

    # --------------------------------------------------
    # Response
    # --------------------------------------------------
    return {
        "success": True,
        "message": "Manual delivery upload completed successfully.",
        "stores_processed": stores_processed,
        "orders_updated": orders_updated,
        "orders_created": orders_created,
        "skipped": skipped,
        "unknown_stores": unknown_stores,
        "date_columns_processed": date_columns,
        "unique_stores_found": len(unique_stores)
    }
