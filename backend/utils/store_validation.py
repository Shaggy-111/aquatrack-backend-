import io
import re
from typing import Any, Dict, List, Optional, Set, Tuple
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy.orm import Session

from backend.models.partner_store import PartnerStore
from backend.models.store import Store
from backend.models.user import RoleEnum, User
from backend.utils.auth import hash_password

# =============================================================================
# CANONICAL MASTER DATA VALUES (EXACT, CASE-SENSITIVE)
# =============================================================================

ALLOWED_REGIONS: Set[str] = {
    "NORTH",
    "SOUTH",
    "EAST",
    "WEST",
    "CENTRAL",
}

ALLOWED_CHANNELS: Set[str] = {
    "BLINKIT",
    "ZEPTO",
    "IBM",
    "GENERAL",
    "CUSTOM",
}

# Verified actual canonical entities from production sheets & application masters
ALLOWED_ENTITIES: Set[str] = {
    "AMB",
    "BCPL",
    "BCPL-DS",
    "BFL",
    "BISTRO",
    "ZHPL",
    "ZEPTO",
}

# 28 States and 8 Union Territories in standard Indian official format
# (including 'Jammu & Kashmir' as used in current production operational files)
ALLOWED_STATES: Set[str] = {
    # 28 States
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chhattisgarh",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
    # 8 Union Territories
    "Andaman and Nicobar Islands",
    "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi",
    "Jammu and Kashmir",
    "Jammu & Kashmir",
    "Ladakh",
    "Lakshadweep",
    "Puducherry",
}

ALLOWED_IS_ACTIVE: Set[str] = {
    "TRUE",
    "FALSE",
}

# =============================================================================
# EXCEL COLUMNS (EXACT, UPPERCASE)
# =============================================================================

REQUIRED_EXCEL_HEADERS: List[str] = [
    "STORE_ID",
    "STORE_NAME",
    "CHANNEL",
]

ALL_EXCEL_HEADERS: List[str] = [
    "STORE_ID",
    "STORE_NAME",
    "REGION",
    "ENTITY",
    "STATE",
    "CITY",
    "ADDRESS",
    "PINCODE",
    "LATITUDE",
    "LONGITUDE",
    "CHANNEL",
    "PROJECT_CODE",
    "POC_NAME",
    "POC_PHONE",
    "IS_ACTIVE",
]


# =============================================================================
# MASTER VALUE VALIDATORS
# (STRICT: Exact match, no silent auto-uppercasing or trimming)
# =============================================================================

def validate_region(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError(f"Invalid REGION: must be a string, got {type(value).__name__}.")
    if value not in ALLOWED_REGIONS:
        allowed = ", ".join(sorted(ALLOWED_REGIONS))
        raise ValueError(f"Invalid REGION: '{value}'. Allowed values: {allowed}")
    return value


def validate_channel(value: Optional[str]) -> str:
    if value is None or value == "":
        raise ValueError("CHANNEL is required.")
    if not isinstance(value, str):
        raise ValueError(f"Invalid CHANNEL: must be a string, got {type(value).__name__}.")
    if value not in ALLOWED_CHANNELS:
        allowed = ", ".join(sorted(ALLOWED_CHANNELS))
        raise ValueError(f"Invalid CHANNEL: '{value}'. Allowed values: {allowed}")
    return value


def validate_entity(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError(f"Invalid ENTITY: must be a string, got {type(value).__name__}.")
    if value not in ALLOWED_ENTITIES:
        allowed = ", ".join(sorted(ALLOWED_ENTITIES))
        raise ValueError(f"Invalid ENTITY: '{value}'. Allowed values: {allowed}")
    return value


def validate_state(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError(f"Invalid STATE: must be a string, got {type(value).__name__}.")
    if value not in ALLOWED_STATES:
        allowed = ", ".join(sorted(ALLOWED_STATES))
        raise ValueError(f"Invalid STATE: '{value}'. Allowed values: {allowed}")
    return value


def validate_pincode(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    str_val = str(value).strip() if isinstance(value, (int, str)) else str(value)
    if not re.match(r"^\d{6}$", str_val):
        raise ValueError(f"Invalid PINCODE: '{value}'. Must be an exact 6-digit number.")
    return str_val


def validate_phone(value: Optional[str], field_name: str = "POC_PHONE") -> Optional[str]:
    if value is None or value == "":
        return None
    str_val = str(value).strip() if isinstance(value, (int, str)) else str(value)
    if not re.match(r"^\d{10}$", str_val):
        raise ValueError(f"Invalid {field_name}: '{value}'. Must be an exact 10-digit number.")
    return str_val


def validate_latitude(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        f_val = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid LATITUDE: '{value}'. Must be a valid numeric decimal.")
    if not (-90.0 <= f_val <= 90.0):
        raise ValueError(f"Invalid LATITUDE: {f_val}. Must be between -90.0 and 90.0.")
    return f_val


def validate_longitude(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        f_val = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid LONGITUDE: '{value}'. Must be a valid numeric decimal.")
    if not (-180.0 <= f_val <= 180.0):
        raise ValueError(f"Invalid LONGITUDE: {f_val}. Must be between -180.0 and 180.0.")
    return f_val


def validate_is_active(value: Any) -> bool:
    if value is None or value == "":
        return True
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value == "TRUE":
            return True
        elif value == "FALSE":
            return False
        else:
            raise ValueError(f"Invalid IS_ACTIVE: '{value}'. Allowed values: TRUE, FALSE")
    raise ValueError(f"Invalid IS_ACTIVE: '{value}'. Allowed values: TRUE, FALSE")


# =============================================================================
# EXCEL TEMPLATE GENERATOR
# =============================================================================

def generate_bulk_upload_template() -> bytes:
    wb = openpyxl.Workbook()

    # Sheet 1: Stores
    ws_stores = wb.active
    ws_stores.title = "Stores"

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
    req_fill = PatternFill(start_color="27538C", end_color="27538C", fill_type="solid")

    for col_idx, header in enumerate(ALL_EXCEL_HEADERS, start=1):
        cell = ws_stores.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = req_fill if header in REQUIRED_EXCEL_HEADERS else header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    # One clearly marked example row
    example_row = [
        "EX-DEL-001",
        "Example Super Store",
        "NORTH",
        "BCPL",
        "Delhi",
        "New Delhi",
        "Plot 12, Industrial Area",
        "110020",
        28.5355,
        77.2410,
        "BLINKIT",
        "PRJ-DEL-01",
        "Rajesh Kumar",
        "9876543210",
        "TRUE",
    ]
    for col_idx, val in enumerate(example_row, start=1):
        cell = ws_stores.cell(row=2, column=col_idx, value=val)
        cell.alignment = Alignment(horizontal="left", vertical="center")

    # Set column widths
    for col in ws_stores.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws_stores.column_dimensions[col_letter].width = max(max_len + 4, 14)

    # Sheet 2: Allowed Values
    ws_allowed = wb.create_sheet(title="Allowed Values")

    allowed_columns = [
        ("REGION", sorted(ALLOWED_REGIONS)),
        ("CHANNEL", sorted(ALLOWED_CHANNELS)),
        ("ENTITY", sorted(ALLOWED_ENTITIES)),
        ("STATE", sorted(ALLOWED_STATES)),
        ("IS_ACTIVE", sorted(ALLOWED_IS_ACTIVE)),
    ]

    sec_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")

    for col_idx, (title, vals) in enumerate(allowed_columns, start=1):
        cell = ws_allowed.cell(row=1, column=col_idx, value=title)
        cell.font = header_font
        cell.fill = sec_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        for row_idx, val in enumerate(vals, start=2):
            val_cell = ws_allowed.cell(row=row_idx, column=col_idx, value=val)
            val_cell.alignment = Alignment(horizontal="left", vertical="center")

    for col in ws_allowed.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws_allowed.column_dimensions[col_letter].width = max(max_len + 4, 16)

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


# =============================================================================
# EXCEL PARSING & WORKBOOK VALIDATION
# =============================================================================

def parse_and_validate_stores_excel(
    file_bytes: bytes,
    db: Session,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
    """
    Parses and validates an uploaded stores Excel file.
    Returns (valid_rows, error_items, total_data_rows).
    Does NOT write to database.
    """
    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=False)
    except Exception as e:
        raise ValueError(f"Invalid Excel file. The file could not be parsed as a valid .xlsx workbook: {str(e)}")

    if "Stores" in wb.sheetnames:
        ws = wb["Stores"]
    else:
        ws = wb.active

    if not ws:
        raise ValueError("Worksheet could not be found in uploaded workbook.")

    # 1. Read header row
    rows_iter = ws.iter_rows(values_only=True)
    header_row = next(rows_iter, None)

    if not header_row:
        raise ValueError("The uploaded workbook is empty.")

    # Strip and validate headers
    headers: List[str] = []
    header_col_map: Dict[str, int] = {}
    seen_headers: Set[str] = set()

    for idx, cell_val in enumerate(header_row):
        if cell_val is None:
            # Trailing empty header columns
            break
        header_name = str(cell_val).strip()
        if not header_name:
            break
        if header_name in seen_headers:
            raise ValueError(f"Duplicate header found in worksheet: '{header_name}'")
        seen_headers.add(header_name)
        headers.append(header_name)
        header_col_map[header_name] = idx

    if not headers:
        raise ValueError("No valid headers found in the first row.")

    # Validate required headers
    missing_headers = [h for h in REQUIRED_EXCEL_HEADERS if h not in seen_headers]
    if missing_headers:
        raise ValueError(f"Missing required header(s): {', '.join(missing_headers)}")

    # Check for unrecognized headers
    valid_headers_set = set(ALL_EXCEL_HEADERS)
    unrecognized = [h for h in headers if h not in valid_headers_set]
    if unrecognized:
        raise ValueError(
            f"Unrecognized column header(s): {', '.join(unrecognized)}. "
            f"Allowed headers: {', '.join(ALL_EXCEL_HEADERS)}"
        )

    # 2. Parse data rows
    errors: List[Dict[str, Any]] = []
    parsed_rows: List[Tuple[int, Dict[str, Any]]] = []

    workbook_store_ids: Dict[str, int] = {}
    workbook_store_names: Dict[str, int] = {}
    workbook_poc_phones: Dict[str, Tuple[int, str]] = {}

    row_number = 1  # Header was row 1

    for row_values in rows_iter:
        row_number += 1

        # Check if row is entirely empty
        if not row_values or all(v is None or str(v).strip() == "" for v in row_values):
            continue

        row_data: Dict[str, Any] = {}
        for header_name, col_idx in header_col_map.items():
            if col_idx < len(row_values):
                val = row_values[col_idx]
                row_data[header_name] = val
            else:
                row_data[header_name] = None

        # Check for formula injection attempts
        for col_name, val in row_data.items():
            if isinstance(val, str) and val.startswith(("=", "+", "-", "@")):
                errors.append({
                    "row": row_number,
                    "column": col_name,
                    "value": str(val)[:20],
                    "message": "Formula cells are not allowed.",
                })

        # --- Validate STORE_ID ---
        raw_id = row_data.get("STORE_ID")
        if raw_id is None or str(raw_id).strip() == "":
            errors.append({
                "row": row_number,
                "column": "STORE_ID",
                "value": str(raw_id) if raw_id is not None else "",
                "message": "STORE_ID is required and cannot be blank.",
            })
            clean_id = None
        else:
            clean_id = str(raw_id).strip()
            if clean_id in workbook_store_ids:
                prev_row = workbook_store_ids[clean_id]
                errors.append({
                    "row": row_number,
                    "column": "STORE_ID",
                    "value": clean_id,
                    "message": f"Duplicate STORE_ID '{clean_id}' within file (first seen on row {prev_row}).",
                })
            else:
                workbook_store_ids[clean_id] = row_number

        # --- Validate STORE_NAME ---
        raw_name = row_data.get("STORE_NAME")
        if raw_name is None or str(raw_name).strip() == "":
            errors.append({
                "row": row_number,
                "column": "STORE_NAME",
                "value": str(raw_name) if raw_name is not None else "",
                "message": "STORE_NAME is required and cannot be blank.",
            })
            clean_name = None
        else:
            clean_name = str(raw_name).strip()
            if clean_name in workbook_store_names:
                prev_row = workbook_store_names[clean_name]
                errors.append({
                    "row": row_number,
                    "column": "STORE_NAME",
                    "value": clean_name,
                    "message": f"Duplicate STORE_NAME '{clean_name}' within file (first seen on row {prev_row}).",
                })
            else:
                workbook_store_names[clean_name] = row_number

        # --- Validate CHANNEL ---
        raw_channel = row_data.get("CHANNEL")
        try:
            clean_channel = validate_channel(raw_channel)
        except ValueError as ex:
            errors.append({
                "row": row_number,
                "column": "CHANNEL",
                "value": str(raw_channel) if raw_channel is not None else "",
                "message": str(ex),
            })
            clean_channel = "GENERAL"

        # --- Validate REGION ---
        raw_region = row_data.get("REGION")
        clean_region = None
        try:
            clean_region = validate_region(raw_region)
        except ValueError as ex:
            errors.append({
                "row": row_number,
                "column": "REGION",
                "value": str(raw_region),
                "message": str(ex),
            })

        # --- Validate ENTITY ---
        raw_entity = row_data.get("ENTITY")
        clean_entity = None
        try:
            clean_entity = validate_entity(raw_entity)
        except ValueError as ex:
            errors.append({
                "row": row_number,
                "column": "ENTITY",
                "value": str(raw_entity),
                "message": str(ex),
            })

        # --- Validate STATE ---
        raw_state = row_data.get("STATE")
        clean_state = None
        try:
            clean_state = validate_state(raw_state)
        except ValueError as ex:
            errors.append({
                "row": row_number,
                "column": "STATE",
                "value": str(raw_state),
                "message": str(ex),
            })

        # --- Validate PINCODE ---
        raw_pincode = row_data.get("PINCODE")
        clean_pincode = None
        try:
            clean_pincode = validate_pincode(raw_pincode)
        except ValueError as ex:
            errors.append({
                "row": row_number,
                "column": "PINCODE",
                "value": str(raw_pincode),
                "message": str(ex),
            })

        # --- Validate POC_PHONE & POC_NAME ---
        raw_phone = row_data.get("POC_PHONE")
        clean_phone = None
        try:
            clean_phone = validate_phone(raw_phone, "POC_PHONE")
        except ValueError as ex:
            errors.append({
                "row": row_number,
                "column": "POC_PHONE",
                "value": str(raw_phone),
                "message": str(ex),
            })

        clean_poc_name = str(row_data["POC_NAME"]).strip() if row_data.get("POC_NAME") is not None and str(row_data["POC_NAME"]).strip() != "" else None

        # Check in-workbook POC phone consistency:
        # Same POC phone is valid for multiple stores, BUT must have identical POC_NAME
        if clean_phone:
            if clean_phone in workbook_poc_phones:
                prev_row, prev_name = workbook_poc_phones[clean_phone]
                if clean_poc_name and prev_name and clean_poc_name.casefold() != prev_name.casefold():
                    errors.append({
                        "row": row_number,
                        "column": "POC_NAME",
                        "value": clean_poc_name,
                        "message": (
                            f"POC_PHONE '{clean_phone}' has conflicting POC_NAMEs within uploaded file "
                            f"('{prev_name}' on row {prev_row} vs '{clean_poc_name}' on row {row_number})."
                        ),
                    })
            else:
                workbook_poc_phones[clean_phone] = (row_number, clean_poc_name or "")

        # --- Validate LATITUDE ---
        raw_lat = row_data.get("LATITUDE")
        clean_lat = None
        try:
            clean_lat = validate_latitude(raw_lat)
        except ValueError as ex:
            errors.append({
                "row": row_number,
                "column": "LATITUDE",
                "value": str(raw_lat),
                "message": str(ex),
            })

        # --- Validate LONGITUDE ---
        raw_lng = row_data.get("LONGITUDE")
        clean_lng = None
        try:
            clean_lng = validate_longitude(raw_lng)
        except ValueError as ex:
            errors.append({
                "row": row_number,
                "column": "LONGITUDE",
                "value": str(raw_lng),
                "message": str(ex),
            })

        # --- Validate IS_ACTIVE ---
        raw_active = row_data.get("IS_ACTIVE")
        clean_active = True
        try:
            clean_active = validate_is_active(raw_active)
        except ValueError as ex:
            errors.append({
                "row": row_number,
                "column": "IS_ACTIVE",
                "value": str(raw_active),
                "message": str(ex),
            })

        # Other plain string fields
        clean_city = str(row_data["CITY"]).strip() if row_data.get("CITY") is not None and str(row_data["CITY"]).strip() != "" else None
        clean_address = str(row_data["ADDRESS"]).strip() if row_data.get("ADDRESS") is not None and str(row_data["ADDRESS"]).strip() != "" else None
        clean_project = str(row_data["PROJECT_CODE"]).strip() if row_data.get("PROJECT_CODE") is not None and str(row_data["PROJECT_CODE"]).strip() != "" else None

        parsed_rows.append((row_number, {
            "id": clean_id,
            "store_name": clean_name,
            "region": clean_region,
            "entity": clean_entity,
            "state": clean_state,
            "city": clean_city,
            "address": clean_address,
            "zip_code": clean_pincode,
            "latitude": clean_lat,
            "longitude": clean_lng,
            "channel": clean_channel,
            "project_code": clean_project,
            "poc_name": clean_poc_name,
            "poc_phone": clean_phone,
            "is_active": clean_active,
        }))

    total_data_rows = len(parsed_rows)
    if total_data_rows == 0:
        raise ValueError("The uploaded workbook contains no data rows.")

    # 3. Database conflict checks (CREATE-ONLY)
    # Check if any store IDs already exist in DB
    candidate_ids = [r["id"] for _, r in parsed_rows if r["id"]]
    if candidate_ids:
        existing_db_stores = db.query(Store.id).filter(Store.id.in_(candidate_ids)).all()
        existing_db_id_set = {str(s[0]) for s in existing_db_stores}

        for row_num, r in parsed_rows:
            sid = r["id"]
            if sid and sid in existing_db_id_set:
                errors.append({
                    "row": row_num,
                    "column": "STORE_ID",
                    "value": sid,
                    "message": f"STORE_ID '{sid}' already exists in database.",
                })

    # Check if any store names already exist in DB
    candidate_names = [r["store_name"] for _, r in parsed_rows if r["store_name"]]
    if candidate_names:
        existing_db_names = db.query(Store.store_name).filter(Store.store_name.in_(candidate_names)).all()
        existing_db_name_set = {str(s[0]) for s in existing_db_names}

        for row_num, r in parsed_rows:
            sname = r["store_name"]
            if sname and sname in existing_db_name_set:
                errors.append({
                    "row": row_num,
                    "column": "STORE_NAME",
                    "value": sname,
                    "message": f"Store with STORE_NAME '{sname}' already exists in database.",
                })

    # Check candidate POC phones against DB
    candidate_phones = [r["poc_phone"] for _, r in parsed_rows if r["poc_phone"]]
    if candidate_phones:
        existing_users = db.query(User).filter(User.mobile_number.in_(candidate_phones)).all()
        user_by_phone: Dict[str, User] = {u.mobile_number: u for u in existing_users}

        for row_num, r in parsed_rows:
            phone = r["poc_phone"]
            if not phone or phone not in user_by_phone:
                continue

            existing_user = user_by_phone[phone]
            # If phone belongs to a non-partner user -> reject
            if existing_user.role != RoleEnum.partner:
                errors.append({
                    "row": row_num,
                    "column": "POC_PHONE",
                    "value": phone,
                    "message": (
                        f"POC_PHONE '{phone}' already belongs to an existing non-partner user "
                        f"(Role: {existing_user.role.value}). Cannot assign as partner POC."
                    ),
                })
            else:
                # If phone belongs to an existing partner but submitted POC_NAME conflicts
                submitted_name = r["poc_name"]
                if submitted_name and existing_user.full_name and submitted_name.casefold() != existing_user.full_name.casefold():
                    errors.append({
                        "row": row_num,
                        "column": "POC_NAME",
                        "value": submitted_name,
                        "message": (
                            f"POC_PHONE '{phone}' already belongs to an existing partner named "
                            f"'{existing_user.full_name}', which conflicts with submitted name '{submitted_name}'."
                        ),
                    })

    valid_rows = [r for _, r in parsed_rows]
    return valid_rows, errors, total_data_rows


# =============================================================================
# ATOMIC INSERTION HELPER
# =============================================================================

def execute_bulk_store_insert(
    valid_rows: List[Dict[str, Any]],
    db: Session,
    created_by_user_id: Optional[int] = None,
) -> List[str]:
    """
    Atomically inserts stores into database.
    If POC info is provided:
      - Reuses existing Partner User if POC_PHONE matches.
      - If POC_PHONE was already seen in this batch, reuses the batch-created partner.
      - Creates a new partner User only if phone does not exist in DB or batch.
      - Links PartnerStore(user_id=partner.id, store_id=store.id).
    Rolls back transaction on any failure.
    """
    created_ids: List[str] = []
    batch_partners_by_phone: Dict[str, User] = {}

    try:
        for row in valid_rows:
            poc_name = row.pop("poc_name", None)
            poc_phone = row.pop("poc_phone", None)

            store = Store(**row)
            db.add(store)
            db.flush()

            # If POC information provided, link or create Partner User
            if poc_phone or poc_name:
                partner: Optional[User] = None

                # 1. Check in-batch created partners by phone
                if poc_phone and poc_phone in batch_partners_by_phone:
                    partner = batch_partners_by_phone[poc_phone]

                # 2. Check DB for existing Partner User by phone
                if not partner and poc_phone:
                    partner = db.query(User).filter(
                        User.mobile_number == poc_phone,
                        User.role == RoleEnum.partner
                    ).first()

                # 3. Create new Partner User if not found
                if not partner:
                    partner_name = poc_name or f"POC {store.id}"
                    dummy_email = f"poc_{store.id.lower()}@aquatrack.internal"
                    # Ensure dummy_email uniqueness
                    counter = 1
                    while db.query(User).filter(User.email == dummy_email).first():
                        dummy_email = f"poc_{store.id.lower()}_{counter}@aquatrack.internal"
                        counter += 1

                    partner = User(
                        full_name=partner_name,
                        email=dummy_email,
                        password=hash_password("AquaTrack@123"),
                        mobile_number=poc_phone,
                        role=RoleEnum.partner,
                        status="active",
                        parent_id=created_by_user_id,
                        channel=store.channel,
                    )
                    db.add(partner)
                    db.flush()

                    if poc_phone:
                        batch_partners_by_phone[poc_phone] = partner

                # 4. Create PartnerStore mapping
                mapping = db.query(PartnerStore).filter(
                    PartnerStore.user_id == partner.id,
                    PartnerStore.store_id == store.id
                ).first()
                if not mapping:
                    db.add(PartnerStore(user_id=partner.id, store_id=store.id))

            created_ids.append(store.id)

        db.commit()
        return created_ids
    except Exception as e:
        db.rollback()
        raise e
