from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import func
from typing import List
from datetime import datetime, timedelta, date
import os
import shutil
import pandas as pd
from io import BytesIO
import calendar
import logging
import re
from sqlalchemy import text


from ..database.db import get_db
from ..models.user import User, RoleEnum
from ..models.report import Report
from ..models.order import Order, OrderStatusEnum
from ..models.store import Store
from ..schemas.report import ReportOut
from ..utils.jwt import get_current_user
from ..utils.permissions import filter_query_by_employee_stores, has_permission, require_permission
from ..utils.store_status import require_active_store
from ..models.partner_store import PartnerStore
from .delivery_reports import (
    aggregate_effective_delivered_by_ist_date,
    ist_date_range_utc,
)

router = APIRouter(prefix="/reports", tags=["Reports"])
logger = logging.getLogger(__name__)

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
    if current_user.role == RoleEnum.employee:
        if not has_permission(current_user.id, "reports.view", db=db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to view reports."
            )

        return []

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

    if current_user.role == RoleEnum.employee:
        if not has_permission(current_user.id, "reports.export", db=db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to export reports."
            )

    query = db.query(Store).options(
        joinedload(Store.partner_associations).joinedload(PartnerStore.user),
    ).filter(Store.is_active.is_(True))

    # ✅ Filters
    if state and state not in ["state", "All States", ""]:
        query = query.filter(Store.state == state)

    if city and city not in ["city", "All Cities", ""]:
        query = query.filter(Store.city == city)

    if current_user.role == RoleEnum.channel_admin:
        query = query.filter(func.upper(Store.channel) == current_user.channel.upper())
    elif channel and channel not in ["All Entities", ""]:
        query = query.filter(func.upper(Store.channel) == channel.upper())

    if current_user.role == RoleEnum.employee:
        query = filter_query_by_employee_stores(query, current_user)

    stores = query.all()

    if not stores:
        raise HTTPException(status_code=404, detail="No stores found")

    start_utc, end_utc = ist_date_range_utc(start_dt.date(), end_dt.date())
    included_statuses = [
        OrderStatusEnum.delivered_confirmed,
        OrderStatusEnum.delivered_pending_confirmation,
    ]
    report_orders = db.query(Order).filter(
        Order.store_id.in_([store.id for store in stores]),
        Order.order_date >= start_utc,
        Order.order_date < end_utc,
        Order.status.in_(included_statuses),
    ).all()
    orders_by_store = {}
    for order in report_orders:
        orders_by_store.setdefault(order.store_id, []).append(order)

    store_channels = {
        (store.channel or "").strip().upper()
        for store in stores
    }
    include_project_code = store_channels != {"BLINKIT"}

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

        daily_totals = aggregate_effective_delivered_by_ist_date(
            orders_by_store.get(s.id, [])
        )
        for order_date, quantity in daily_totals.items():
            day_key = datetime.combine(order_date, datetime.min.time()).strftime(
                f'%{day_fmt}-%b'
            )
            date_map[day_key] += quantity

        row = {
            "Region": str(s.region or "N/A"),
            "Channel": str(s.channel or "N/A").upper(),
            "Entity": str(s.entity or "N/A"),
            "STATE": str(s.state or "N/A"),
            "City": str(s.city or "N/A"),
            "Outlet ID": str(s.id),
            "Project Code": str(s.project_code or "N/A"),
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
        "Region","Channel", "Entity", "STATE", "City", "Outlet ID",
        "Outlet Name", "POC Name", "Contact No",
        "PRIMARY VENDOR NAME", "PRIMARY LICENSE NUMBER",
        "SECONDARY VENDOR NAME", "SECONDARY LICENSE NUMBER"
    ]

    if include_project_code:
        info_cols.insert(info_cols.index("Outlet Name"), "Project Code")

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

    if current_user.role == RoleEnum.employee:
        require_permission("reports.export")(
            current_user=current_user,
            db=db
        )
    elif current_user.role not in allowed_roles:
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
    """Upload manual deliveries using in-memory lookups and batched queries."""
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only Super Admin can upload manual delivery data."
        )

    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Please upload a valid Excel file.")

    try:
        contents = await file.read()
        df = pd.read_excel(BytesIO(contents))
        df = df.dropna(how="all").dropna(axis=1, how="all")
        df.columns = [str(col).strip() for col in df.columns]
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to read Excel file: {str(exc)}"
        )

    if "Outlet ID" not in df.columns:
        raise HTTPException(status_code=400, detail="Excel must contain 'Outlet ID' column.")

    ignore_columns = {
        "Region", "Channel", "Entity", "STATE", "City", "Outlet ID", "Project Code",
        "Outlet Name", "POC Name", "Contact No", "PRIMARY VENDOR NAME",
        "PRIMARY LICENSE NUMBER", "SECONDARY VENDOR NAME",
        "SECONDARY LICENSE NUMBER", "Total Count"
    }
    date_column_pattern = re.compile(
        r"^(?:0?[1-9]|[12]\d|3[01])-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$"
    )
    date_columns = [
        col
        for col in df.columns
        if str(col).strip() not in ignore_columns
        and date_column_pattern.fullmatch(str(col).strip())
    ]
    if not date_columns:
        raise HTTPException(status_code=400, detail="No date columns found in Excel.")

    for col in date_columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    valid_rows = df[df[date_columns].fillna(0).gt(0).any(axis=1)].copy()
    if valid_rows.empty:
        raise HTTPException(status_code=400, detail="No delivery quantities found in Excel.")

    invalid_values = {"", "nan", "none", "null"}

    def normalize_outlet_id(value):
        """Return the trimmed ID and its leading-zero-insensitive form."""
        if pd.isna(value):
            return "", ""
        value_text = str(value).strip()
        if value_text.lower() in invalid_values:
            return "", ""
        numeric_match = re.fullmatch(r"([+-]?\d+)\.0+", value_text)
        if numeric_match:
            value_text = numeric_match.group(1)
        if re.fullmatch(r"\+?\d+", value_text):
            unsigned = value_text.lstrip("+")
            normalized = unsigned.lstrip("0") or "0"
        else:
            normalized = value_text
        return value_text, normalized

    def normalize_outlet_name(value):
        """Trim and collapse whitespace; callers casefold when appropriate."""
        if pd.isna(value):
            return ""
        value_text = str(value).strip()
        if value_text.lower() in invalid_values:
            return ""
        return " ".join(value_text.split())

    unique_stores = list(dict.fromkeys(
        normalized_id
        for outlet_id, normalized_id in (
            normalize_outlet_id(value) for value in valid_rows["Outlet ID"]
        )
        if outlet_id
    ))
    if len(unique_stores) > 700:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum 700 stores allowed per upload. Found {len(unique_stores)} stores."
        )

    def parse_day_column(column_name: str) -> date:
        try:
            column_name = str(column_name).strip()
            day_part, month_part = column_name.split("-")
            month_map = {
                "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4,
                "May": 5, "Jun": 6, "Jul": 7, "Aug": 8,
                "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
            }
            return date(
                datetime.utcnow().year,
                month_map[month_part[:3].title()],
                int(day_part),
            )
        except Exception:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid date column format: {column_name}"
            )

    # Validate all headers before any database work, as in the original flow.
    parsed_dates = {col: parse_day_column(col) for col in date_columns}

    # Stores, partner relationships, and assigned managers are loaded once.
    all_stores = (
        db.query(Store)
        .options(selectinload(Store.partners), joinedload(Store.assigned_manager))
        .all()
    )

    exact_ids = {}
    trimmed_ids = {}
    normalized_ids = {}
    exact_names = {}
    casefold_names = {}
    normalized_names = {}
    searchable_names = []

    def add_first(lookup, key, store):
        if key and key not in lookup:
            lookup[key] = store

    for store in all_stores:
        raw_id = str(store.id)
        trimmed_id, normalized_id = normalize_outlet_id(raw_id)
        raw_name = str(store.store_name or "").strip()
        normalized_name = normalize_outlet_name(store.store_name)
        add_first(exact_ids, raw_id, store)
        add_first(trimmed_ids, trimmed_id, store)
        add_first(normalized_ids, normalized_id, store)
        add_first(exact_names, raw_name, store)
        add_first(casefold_names, raw_name.casefold(), store)
        add_first(normalized_names, normalized_name.casefold(), store)
        searchable_names.append((normalized_name.casefold(), store))

    resolved_rows = []
    matched_store_ids = set()
    for row_index, row in valid_rows.iterrows():
        raw_id_value = row.get("Outlet ID", "")
        outlet_id, normalized_id = normalize_outlet_id(raw_id_value)
        raw_name_value = row.get("Outlet Name", "")
        raw_name = "" if pd.isna(raw_name_value) else str(raw_name_value).strip()
        outlet_name = normalize_outlet_name(raw_name_value)

        store = None
        if outlet_id:
            store = exact_ids.get(str(raw_id_value))
            store = store or trimmed_ids.get(outlet_id)
            store = store or normalized_ids.get(normalized_id)
        if not store and raw_name:
            store = exact_names.get(raw_name)
            store = store or casefold_names.get(raw_name.casefold())
        if not store and outlet_name:
            store = normalized_names.get(outlet_name.casefold())
        if not store and outlet_name:
            needle = outlet_name.casefold()
            store = next(
                (candidate for name, candidate in searchable_names if needle in name),
                None,
            )

        resolved_rows.append((row_index, row, outlet_id, outlet_name, store))
        if store:
            matched_store_ids.add(store.id)

    # One order query replaces the previous query for every positive cell.
    existing_orders = []
    if matched_store_ids:
        existing_orders = (
            db.query(Order)
            .filter(
                Order.store_id.in_(matched_store_ids),
                func.date(Order.order_date).in_(set(parsed_dates.values())),
            )
            .order_by(Order.id.asc())
            .all()
        )
    orders_by_key = {
        (order.store_id, order.order_date.date()): order
        for order in existing_orders
    }

    stores_processed = 0
    processed_rows = 0
    orders_updated = 0
    orders_created = 0
    skipped = 0
    unknown_stores = []
    failed_rows = []
    duplicate_rows = 0
    seen_keys = set()

    for row_index, row, outlet_id, outlet_name, store in resolved_rows:
        if not store:
            unknown = {"outlet_id": outlet_id, "outlet_name": outlet_name}
            unknown_stores.append(unknown)
            logger.warning("Manual delivery store not found: %s", unknown)
            skipped += 1
            continue

        require_active_store(store)
        stores_processed += 1
        partner = store.partners[0] if store.partners else None
        manager_id = store.assigned_manager_id
        if not partner or not manager_id:
            logger.warning("Skipped store %s: partner or manager missing", store.id)
            skipped += 1
            continue

        row_created = []
        row_updated = 0
        row_keys = []
        try:
            # A savepoint isolates database errors to this spreadsheet row.
            with db.begin_nested():
                for col in date_columns:
                    raw_value = row.get(col)
                    if pd.isna(raw_value):
                        continue
                    try:
                        qty = int(float(raw_value))
                    except Exception:
                        continue
                    if qty <= 0:
                        continue

                    delivery_date = parsed_dates[col]
                    key = (store.id, delivery_date)
                    row_keys.append(key)
                    existing_order = orders_by_key.get(key)
                    if existing_order:
                        existing_order.status = OrderStatusEnum.delivered_confirmed
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
                            delivery_date, datetime.min.time()
                        )
                        existing_order.updated_at = datetime.utcnow()
                        row_updated += 1
                    else:
                        new_order = Order(
                            partner_id=partner.id,
                            store_id=store.id,
                            assigned_to_manager_id=manager_id,
                            order_details=str(qty),
                            total_amount=0,
                            status=OrderStatusEnum.delivered_confirmed,
                            channel=store.channel,
                            order_date=datetime.combine(delivery_date, datetime.min.time()),
                            bottles_delivered=qty,
                            empty_bottles_collected=qty,
                            confirmed_empty_bottles=qty,
                            confirmed_bottles=qty,
                            store_confirmed=True,
                            delivered_by="Excel Upload",
                            vehicle_info="Manual Upload"
                        )
                        db.add(new_order)
                        row_created.append((key, new_order))

            for key, new_order in row_created:
                orders_by_key[key] = new_order
            orders_created += len(row_created)
            orders_updated += row_updated
            duplicate_rows += sum(key in seen_keys for key in row_keys)
            seen_keys.update(row_keys)
            processed_rows += 1
        except Exception as row_error:
            failed = {
                "row": int(row_index) + 2,
                "outlet_id": outlet_id,
                "outlet_name": outlet_name,
                "error": str(row_error),
            }
            failed_rows.append(failed)
            logger.exception("Manual delivery row failed: %s", failed)
            skipped += 1

    try:
        if matched_store_ids:
            stores_before_commit = (
                db.query(Store)
                .filter(Store.id.in_(matched_store_ids))
                .populate_existing()
                .with_for_update()
                .all()
            )
            for store in stores_before_commit:
                require_active_store(store)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(exc)}")

    logger.info(
        "Manual delivery completed: rows=%s processed=%s created=%s updated=%s skipped=%s",
        len(valid_rows), processed_rows, orders_created, orders_updated, skipped,
    )
    return {
        "success": True,
        "message": "Manual delivery upload completed successfully.",
        "stores_processed": stores_processed,
        "orders_updated": orders_updated,
        "orders_created": orders_created,
        "skipped": skipped,
        "skipped_rows": skipped,
        "unknown_stores": unknown_stores,
        "date_columns_processed": date_columns,
        "unique_stores_found": len(unique_stores),
        "total_rows": len(df),
        "processed_rows": processed_rows,
        "failed_rows": failed_rows,
        "duplicate_rows": duplicate_rows,
    }
