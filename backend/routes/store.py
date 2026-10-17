import os
from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form, Response, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, load_only, joinedload
from typing import List, Optional
from datetime import datetime, timedelta
from sqlalchemy import func, extract, or_

from ..database.db import get_db
from ..models.employee_store_mapping import EmployeeStoreMapping
from ..models.partner_store import PartnerStore
from ..models.store import Store
from ..models.user import User, RoleEnum
from ..models.order import Order
from ..schemas.store import (
    StoreCreate,
    StoreOut,
    StoreStatusUpdate,
    StoreUpdate,
    StoreDeliverySummary,
    StoreBulkUploadSuccessResponse,
    StoreBulkUploadErrorResponse,
    StoreSelectorResponse,
    StoreSelectorFilters,
)
from ..utils.jwt import get_current_user
from ..utils.auth import hash_password
from ..utils.permissions import (
    filter_query_by_employee_stores,
    get_employee_store_ids,
    get_employee_permissions,
    require_permission
)
from backend.utils.auto_order import validate_store_for_auto_order
from backend.utils.store_validation import (
    validate_region,
    validate_channel,
    validate_entity,
    validate_state,
    validate_pincode,
    validate_phone,
    validate_latitude,
    validate_longitude,
    validate_is_active,
    generate_bulk_upload_template,
    parse_and_validate_stores_excel,
    execute_bulk_store_insert,
)


# Helper function to check super admin
def super_admin_required(current_user: User = Depends(get_current_user)):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
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
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Store not assigned to you."
        )


def store_access_required(
    store: Store,
    current_user: User,
    db: Session
):
    if current_user.role in [RoleEnum.superadmin, RoleEnum.admin]:
        return

    if current_user.role == RoleEnum.employee:
        employee_store_access_required(store.id, current_user, db)
        return

    if current_user.role == RoleEnum.delivery_manager:
        if store.assigned_manager_id == current_user.id:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Store not assigned to you."
        )

    if current_user.role == RoleEnum.partner:
        if any(partner.id == current_user.id for partner in store.partners):
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Store not assigned to you."
        )

    if current_user.role == RoleEnum.channel_admin:
        if (store.channel or "").upper() == (current_user.channel or "").upper():
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Store not assigned to your channel."
        )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Not authorized to access this store."
    )


# The prefix is correct for the main router: /store
router = APIRouter(prefix="/store", tags=["Store"])
status_router = APIRouter(prefix="/stores", tags=["Store"])


def _selector_scope(db: Session, current_user: User):
    """Authorize reimbursement lookup without loading assigned Store IDs."""
    if current_user.role == RoleEnum.superadmin:
        return db.query(Store)
    if current_user.role != RoleEnum.employee:
        raise HTTPException(status_code=403, detail="Only Super Admin or an authorized employee can select stores.")
    allowed = {"store_reimbursement.view", "store_reimbursement.create"}
    if not allowed.intersection(get_employee_permissions(current_user.id, db=db)):
        raise HTTPException(status_code=403, detail="Store Reimbursement permission required.")
    return db.query(Store).filter(
        db.query(EmployeeStoreMapping.id).filter(
            EmployeeStoreMapping.employee_id == current_user.id,
            EmployeeStoreMapping.store_id == Store.id,
        ).exists()
    )


def _selector_filters(query, **filters):
    for field, value in filters.items():
        if isinstance(value, str) and value.strip():
            query = query.filter(getattr(Store, field) == value.strip())
    return query


@status_router.get("/selector/filters", response_model=StoreSelectorFilters)
def get_store_selector_filters(
    region: Optional[str] = None,
    channel: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Each level uses only its upstream selections, never a paginated Store list.
    base = _selector_scope(db, current_user)

    def values(query, column):
        return [row[0] for row in query.with_entities(column).filter(
            column.isnot(None), func.trim(column) != ""
        ).distinct().order_by(column).all()]

    region_query = _selector_filters(base, region=region)
    channel_query = _selector_filters(region_query, channel=channel)
    state_query = _selector_filters(channel_query, state=state)
    return {
        "regions": values(base, Store.region),
        "channels": values(region_query, Store.channel),
        "states": values(channel_query, Store.state),
        "cities": values(state_query, Store.city),
    }


@status_router.get("/selector", response_model=StoreSelectorResponse)
def get_store_selector(
    region: Optional[str] = None,
    channel: Optional[str] = None,
    state: Optional[str] = None,
    city: Optional[str] = None,
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = _selector_filters(
        _selector_scope(db, current_user),
        region=region, channel=channel, state=state, city=city,
    )
    if search and search.strip():
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        term = f"%{escaped}%"
        query = query.filter(or_(
            Store.store_name.ilike(term, escape="\\"),
            Store.id.ilike(term, escape="\\"),
        ))
    if is_active is not None:
        query = query.filter(Store.is_active.is_(is_active))
    rows = query.with_entities(
        Store.id, Store.store_name, Store.region, Store.channel, Store.entity,
        Store.state, Store.city, Store.is_active,
    ).order_by(Store.store_name, Store.id).offset((page - 1) * page_size).limit(page_size + 1).all()
    return {
        "items": [dict(row._mapping) for row in rows[:page_size]],
        "page": page,
        "page_size": page_size,
        "has_more": len(rows) > page_size,
    }


# ✅ Create Store
@router.post("/create", response_model=StoreOut, status_code=status.HTTP_201_CREATED)
def create_store(
    store: StoreCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new store (Admin or Super Admin).
    Allows manual Store ID entry from frontend.
    """

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.create",
            current_user,
            db
        )
    elif current_user.role not in [RoleEnum.superadmin, RoleEnum.admin]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin or super admin can perform this action."
        )

    # Validate master fields using canonical validators
    try:
        clean_channel = validate_channel(store.channel)
        clean_region = validate_region(store.region)
        clean_entity = validate_entity(store.entity)
        clean_state = validate_state(store.state)
        clean_pincode = validate_pincode(store.zip_code)
        clean_lat = validate_latitude(store.latitude)
        clean_lng = validate_longitude(store.longitude)
        clean_phone = validate_phone(store.poc_phone, "POC_PHONE") if store.poc_phone else None
        clean_active = validate_is_active(store.is_active)
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )

    # 🔒 1. Prevent duplicate STORE ID
    existing_id = db.query(Store).filter(Store.id == store.id).first()
    if existing_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Store ID {store.id} already exists."
        )

    # 🔒 2. Prevent duplicate STORE NAME
    existing_name = db.query(Store).filter(Store.store_name == store.store_name).first()
    if existing_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Store with this name already exists."
        )

    # ⭐ 3. CREATE STORE WITH MANUAL ID ⭐
    new_store = Store(
        id=store.id,
        store_name=store.store_name,
        address=store.address,
        city=store.city,
        state=clean_state,
        region=clean_region,
        entity=clean_entity,
        project_code=store.project_code,
        zip_code=clean_pincode,
        latitude=clean_lat,
        longitude=clean_lng,
        channel=clean_channel,
        is_active=clean_active,
    )

    db.add(new_store)
    db.flush()

    # Link POC / Partner if provided
    if store.poc_name or clean_phone:
        partner_name = store.poc_name or f"POC {new_store.id}"
        dummy_email = f"poc_{new_store.id.lower()}@aquatrack.internal"
        partner = db.query(User).filter(User.email == dummy_email).first()
        if not partner:
            partner = User(
                full_name=partner_name,
                email=dummy_email,
                password=hash_password("AquaTrack@123"),
                mobile_number=clean_phone,
                role=RoleEnum.partner,
                status="active",
                parent_id=current_user.id,
                channel=clean_channel,
            )
            db.add(partner)
            db.flush()
        else:
            if store.poc_name:
                partner.full_name = store.poc_name
            if clean_phone:
                partner.mobile_number = clean_phone
        db.add(PartnerStore(user_id=partner.id, store_id=new_store.id))

    if current_user.role == RoleEnum.employee:
        db.add(
            EmployeeStoreMapping(
                employee_id=current_user.id,
                store_id=new_store.id,
                assigned_by=current_user.id
            )
        )
    db.commit()
    db.refresh(new_store)

    return new_store


# ✅ Download Official Bulk Upload Excel Template
@router.get("/bulk-upload/template")
def download_bulk_upload_template(
    current_user: User = Depends(get_current_user)
):
    """
    Download official Excel template (.xlsx) for Store Bulk Upload.
    Sheet 1 contains exact supported column headers and an example row.
    Sheet 2 contains canonical allowed master values.
    Requires Admin/Superadmin session.
    """
    if current_user.role not in [RoleEnum.superadmin, RoleEnum.admin]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin or super admin can perform this action."
        )

    template_bytes = generate_bulk_upload_template()
    return Response(
        content=template_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": "attachment; filename=store_bulk_upload_template.xlsx"
        }
    )


# ✅ Bulk Upload Stores through Excel
@router.post(
    "/bulk-upload",
    response_model=StoreBulkUploadSuccessResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"model": StoreBulkUploadErrorResponse},
        403: {"description": "Forbidden - invalid role or bulk upload password"},
        500: {"description": "Server misconfiguration or database error"}
    }
)
async def bulk_upload_stores(
    file: UploadFile = File(...),
    password: Optional[str] = Form(None),
    pin: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Bulk create Stores from an uploaded Excel (.xlsx) file.
    CREATE-ONLY: Does not update existing stores.
    Atomic: All rows succeed or zero stores are created.
    Requires Admin/Superadmin session + STORE_BULK_UPLOAD_PASSWORD.
    """
    # 1. Authorization check: Admin and Superadmin only
    if current_user.role not in [RoleEnum.superadmin, RoleEnum.admin]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin or super admin can perform this action."
        )

    # 2. Bulk upload password / PIN check
    expected_password = os.getenv("STORE_BULK_UPLOAD_PASSWORD")
    if not expected_password:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Bulk upload is disabled: STORE_BULK_UPLOAD_PASSWORD is not configured on the server."
        )

    submitted_password = password or pin
    if not submitted_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bulk upload password/PIN is required."
        )

    if submitted_password != expected_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid bulk upload password."
        )

    # 3. File extension and type check
    filename = file.filename or ""
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Only .xlsx Excel files are supported."
        )

    # 4. File size limit (10 MB)
    MAX_FILE_SIZE = 10 * 1024 * 1024
    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file exceeds maximum allowed size (10 MB)."
        )

    # 5. Parse and strictly validate workbook
    try:
        valid_rows, errors, total_data_rows = parse_and_validate_stores_excel(file_bytes, db)
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )

    # 6. If any validation errors exist, fail atomically with zero inserts
    if errors:
        invalid_row_set = {e["row"] for e in errors}
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "total_rows": total_data_rows,
                "valid_rows": total_data_rows - len(invalid_row_set),
                "invalid_rows": len(invalid_row_set),
                "errors": errors,
            }
        )

    # 7. Atomic database insertion
    try:
        created_ids = execute_bulk_store_insert(
            valid_rows,
            db,
            created_by_user_id=current_user.id
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during bulk creation: {str(e)}"
        )

    return {
        "success": True,
        "total_rows": total_data_rows,
        "created_count": len(created_ids),
        "skipped_count": 0,
        "created_store_ids": created_ids,
    }



# ⭐ FIX: Renamed /list to /list/all to match frontend call, ensuring Super Admin authentication.
@router.get("/list/all")
def get_all_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns all stores across all channels
    with Delivery Manager details.
    """

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )
        stores_query = filter_query_by_employee_stores(
            db.query(Store),
            current_user
        )
    else:
        if current_user.role not in [RoleEnum.superadmin, RoleEnum.admin]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only an admin or super admin can perform this action."
            )
        stores_query = db.query(Store)

    if current_user.role == RoleEnum.employee:
        stores_query = stores_query.filter(Store.is_active.is_(True))

    stores = (
        stores_query
        .options(
            load_only(
                Store.id,
                Store.store_name,
                Store.address,
                Store.city,
                Store.state,
                Store.region,
                Store.zip_code,
                Store.latitude,
                Store.longitude,
                Store.channel,
                Store.entity,
                Store.is_active,
                Store.auto_order_enabled,
                Store.order_frequency_days,
                Store.monthly_cap,
                Store.assigned_manager_id,
            ),
            joinedload(Store.assigned_manager)
        )
        .all()
    )

    response = []

    for store in stores:

        response.append({

            "id": store.id,

            "store_name": store.store_name,

            "address": store.address,

            "city": store.city,

            "state": store.state,

            "region": store.region,

            "zip_code": store.zip_code,

            "latitude": store.latitude,

            "longitude": store.longitude,

            "channel": store.channel,

            "entity": store.entity,

            "is_active": store.is_active,

            "auto_order_enabled":
            store.auto_order_enabled,

            "order_frequency_days":
            store.order_frequency_days,

            "monthly_cap":
            store.monthly_cap,

            # ✅ DELIVERY MANAGER
            "assigned_manager": (
                store.assigned_manager.full_name
                if store.assigned_manager
                else None
            ),

            "assigned_manager_id":
            store.assigned_manager_id,

            # ✅ POC INFO
            "poc_name": store.poc_name,
            "poc_phone": store.poc_phone,
        })

    return response


# ✅ Get Stores (Renamed route to avoid confusion, keeping /list functionality)
@router.get("/list", response_model=List[StoreOut])
def get_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns all stores (open for partners/superadmin).
    """
    stores_query = db.query(Store)

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )
        stores_query = filter_query_by_employee_stores(
            stores_query,
            current_user
        )

    if current_user.role not in [RoleEnum.superadmin, RoleEnum.admin]:
        stores_query = stores_query.filter(Store.is_active.is_(True))

    stores = stores_query.all()
    return stores


# ✅ Get Store by ID


# ✅ Update Store
@router.patch("/update/{store_id}", response_model=StoreOut)
def update_store(
    store_id: str,
    store_update: StoreUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role not in [RoleEnum.superadmin, RoleEnum.admin]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin or super admin can perform this action."
        )

    store_to_update = db.query(Store).filter(Store.id == store_id).first()

    if not store_to_update:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found."
        )

    update_data = store_update.model_dump(exclude_unset=True)

    # 🔒 NON-NEGOTIABLE RULE: Store ID is immutable
    if "id" in update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Store ID is immutable and cannot be modified."
        )

    # Validate master fields using canonical validators
    try:
        if "region" in update_data:
            update_data["region"] = validate_region(update_data["region"])
        if "channel" in update_data:
            update_data["channel"] = validate_channel(update_data["channel"])
        if "entity" in update_data:
            update_data["entity"] = validate_entity(update_data["entity"])
        if "state" in update_data:
            update_data["state"] = validate_state(update_data["state"])
        if "zip_code" in update_data:
            update_data["zip_code"] = validate_pincode(update_data["zip_code"])
        if "latitude" in update_data:
            update_data["latitude"] = validate_latitude(update_data["latitude"])
        if "longitude" in update_data:
            update_data["longitude"] = validate_longitude(update_data["longitude"])
        if "is_active" in update_data:
            update_data["is_active"] = validate_is_active(update_data["is_active"])
        if "poc_phone" in update_data:
            update_data["poc_phone"] = validate_phone(update_data["poc_phone"], "POC_PHONE")
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )

    # 🔒 Check duplicate Store Name if being updated
    if "store_name" in update_data and update_data["store_name"]:
        existing = db.query(Store).filter(
            Store.store_name == update_data["store_name"],
            Store.id != store_id
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Store with this name already exists."
            )

    # Handle assigned_manager_id relationship
    if "assigned_manager_id" in update_data:
        manager_id = update_data.pop("assigned_manager_id")
        if manager_id is not None:
            manager = db.query(User).filter(
                User.id == manager_id,
                User.role.in_([RoleEnum.delivery_manager, RoleEnum.vendor, RoleEnum.admin, RoleEnum.superadmin])
            ).first()
            if not manager:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"User with ID {manager_id} is not a valid Delivery Manager."
                )
            store_to_update.assigned_manager_id = manager.id
        else:
            store_to_update.assigned_manager_id = None

    # Handle POC (poc_name, poc_phone) relationship
    has_poc_update = ("poc_name" in update_data) or ("poc_phone" in update_data)
    poc_name = update_data.pop("poc_name", None) if "poc_name" in update_data else None
    poc_phone = update_data.pop("poc_phone", None) if "poc_phone" in update_data else None

    if has_poc_update:
        current_partner = store_to_update.partners[0] if (store_to_update.partners and len(store_to_update.partners) > 0) else None

        target_name = poc_name if poc_name is not None else (current_partner.full_name if current_partner else f"POC {store_to_update.id}")
        target_phone = poc_phone if poc_phone is not None else (current_partner.mobile_number if current_partner else None)

        # 1. Non-partner phone collision check
        if target_phone:
            existing_user_with_phone = db.query(User).filter(User.mobile_number == target_phone).first()
            if existing_user_with_phone and existing_user_with_phone.role != RoleEnum.partner:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"POC_PHONE '{target_phone}' already belongs to an existing user with role '{existing_user_with_phone.role.value}' and cannot be used as a POC phone."
                )

        # 2. Check if current partner is shared across other stores
        is_shared = False
        if current_partner:
            partner_store_count = db.query(PartnerStore).filter(PartnerStore.user_id == current_partner.id).count()
            if partner_store_count > 1:
                is_shared = True

        if is_shared:
            # Shared partner: DO NOT mutate in place!
            # Unlink current_partner from this store
            db.query(PartnerStore).filter(
                PartnerStore.user_id == current_partner.id,
                PartnerStore.store_id == store_to_update.id
            ).delete()
            db.flush()

            # Find existing partner user by target_phone or create a new one
            new_partner = None
            if target_phone:
                new_partner = db.query(User).filter(
                    User.mobile_number == target_phone,
                    User.role == RoleEnum.partner
                ).first()

            if not new_partner:
                dummy_email = f"poc_{store_to_update.id.lower()}@aquatrack.internal"
                counter = 1
                while db.query(User).filter(User.email == dummy_email).first():
                    dummy_email = f"poc_{store_to_update.id.lower()}_{counter}@aquatrack.internal"
                    counter += 1

                new_partner = User(
                    full_name=target_name,
                    email=dummy_email,
                    password=hash_password("AquaTrack@123"),
                    mobile_number=target_phone,
                    role=RoleEnum.partner,
                    status="active",
                    parent_id=current_user.id,
                    channel=store_to_update.channel,
                )
                db.add(new_partner)
                db.flush()
            else:
                if poc_name is not None and poc_name:
                    new_partner.full_name = poc_name

            db.add(PartnerStore(user_id=new_partner.id, store_id=store_to_update.id))
            db.flush()
            db.expire(store_to_update, ["partners"])

        else:
            # Partner is dedicated to this store (or store has no partner yet)
            if current_partner:
                if target_phone and current_partner.mobile_number != target_phone:
                    existing_partner = db.query(User).filter(
                        User.mobile_number == target_phone,
                        User.role == RoleEnum.partner
                    ).first()
                    if existing_partner and existing_partner.id != current_partner.id:
                        # Link store to existing partner
                        db.query(PartnerStore).filter(
                            PartnerStore.user_id == current_partner.id,
                            PartnerStore.store_id == store_to_update.id
                        ).delete()
                        db.add(PartnerStore(user_id=existing_partner.id, store_id=store_to_update.id))
                        if poc_name is not None and poc_name:
                            existing_partner.full_name = poc_name
                        db.delete(current_partner)
                        db.flush()
                        db.expire(store_to_update, ["partners"])
                    else:
                        if poc_name is not None:
                            current_partner.full_name = target_name
                        current_partner.mobile_number = target_phone
                else:
                    if poc_name is not None:
                        current_partner.full_name = target_name
                    if poc_phone is not None:
                        current_partner.mobile_number = target_phone
            else:
                # No partner existed for this store
                partner = None
                if target_phone:
                    partner = db.query(User).filter(
                        User.mobile_number == target_phone,
                        User.role == RoleEnum.partner
                    ).first()

                if not partner:
                    dummy_email = f"poc_{store_to_update.id.lower()}@aquatrack.internal"
                    counter = 1
                    while db.query(User).filter(User.email == dummy_email).first():
                        dummy_email = f"poc_{store_to_update.id.lower()}_{counter}@aquatrack.internal"
                        counter += 1

                    partner = User(
                        full_name=target_name,
                        email=dummy_email,
                        password=hash_password("AquaTrack@123"),
                        mobile_number=target_phone,
                        role=RoleEnum.partner,
                        status="active",
                        parent_id=current_user.id,
                        channel=store_to_update.channel,
                    )
                    db.add(partner)
                    db.flush()
                else:
                    if poc_name is not None and poc_name:
                        partner.full_name = poc_name

                db.add(PartnerStore(user_id=partner.id, store_id=store_to_update.id))
                db.flush()
                db.expire(store_to_update, ["partners"])

    # 🔥 VALIDATION ONLY WHEN ENABLING AUTO ORDER
    if update_data.get("auto_order_enabled") is True:
        valid, msg = validate_store_for_auto_order(store_to_update)
        if not valid:
            raise HTTPException(400, msg)

    # 🔥 APPLY PARTIAL UPDATE (PATCH semantics)
    for key, value in update_data.items():
        setattr(store_to_update, key, value)

    db.commit()
    db.refresh(store_to_update)

    return store_to_update

# ✅ Delete Store
@status_router.patch("/{store_id}/status", response_model=StoreOut)
def update_store_status(
    store_id: str,
    payload: StoreStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required),
):
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found.",
        )

    store.is_active = payload.is_active
    db.commit()
    db.refresh(store)
    return store


@router.delete("/{store_id}/delete", status_code=status.HTTP_200_OK)
def delete_store(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a store (only Super Admin).
    """
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.delete",
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
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Store deletion is disabled. Use Active/Inactive instead."
    )


@router.patch("/{store_id}/auto-order")
def update_auto_order(
    store_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.edit",
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
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )

    store = db.query(Store).filter(Store.id == store_id).first()

    if not store:
        raise HTTPException(404, "Store not found")

    # 🔥 VALIDATION BEFORE ENABLE
    if "is_active" in payload:
        raise HTTPException(
            status_code=400,
            detail="Use the store status endpoint to change is_active.",
        )

    if payload.get("auto_order_enabled") == True:
        valid, msg = validate_store_for_auto_order(store)
        if not valid:
            raise HTTPException(400, msg)

    for key, value in payload.items():
        setattr(store, key, value)

    db.commit()
    db.refresh(store)

    return store


@router.get(
    "/store-delivery-summary",
    response_model=List[StoreDeliverySummary]
)
def get_store_delivery_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    # ✅ ONLY DELIVERY MANAGER
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )
    elif current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers allowed."
        )

    # ✅ DATE CALCULATIONS
    today = datetime.utcnow()

    month_start = today.replace(day=1)

    week_start = today - timedelta(days=7)

    # ✅ FETCH ONLY ASSIGNED STORES
    stores_query = db.query(Store)

    if current_user.role == RoleEnum.employee:
        stores_query = filter_query_by_employee_stores(
            stores_query,
            current_user
        )
    else:
        stores_query = stores_query.filter(
            Store.assigned_manager_id
            == current_user.id
        )

    stores = stores_query.filter(Store.is_active.is_(True)).all()

    result = []

    for store in stores:

        # ✅ MONTH DELIVERED
        month_delivered = (
            db.query(
                func.sum(Order.bottles_delivered)
            )
            .filter(
                Order.store_id == store.id,

                Order.status.in_([
                    "delivered_confirmed",
                    "delivered_pending_confirmation"
                ]),

                Order.updated_at >= month_start
            )
            .scalar()
        ) or 0

        # ✅ WEEK DELIVERED
        week_delivered = (
            db.query(
                func.sum(Order.bottles_delivered)
            )
            .filter(
                Order.store_id == store.id,

                Order.status.in_([
                    "delivered_confirmed",
                    "delivered_pending_confirmation"
                ]),

                Order.updated_at >= week_start
            )
            .scalar()
        ) or 0

        # ✅ TOTAL ORDERS
        total_orders = (
            db.query(Order)
            .filter(
                Order.store_id == store.id
            )
            .count()
        )

        # ✅ LAST DELIVERY
        last_order = (
            db.query(Order)
            .filter(
                Order.store_id == store.id
            )
            .order_by(
                Order.updated_at.desc()
            )
            .first()
        )

        # ✅ FINAL RESPONSE
        result.append({

            "store_id": store.id,

            "store_name": store.store_name,

            "city": store.city,

            "state": store.state,

            "channel": store.channel,

            "is_active": store.is_active,

            "month_delivered_bottles":
                month_delivered,

            "week_delivered_bottles":
                week_delivered,

            "total_orders":
                total_orders,

            "last_delivery_date":
                last_order.updated_at
                if last_order else None
        })

    return result

# ✅ DELIVERY MANAGER MY STORES
@router.get(
    "/my-stores",
    response_model=List[StoreOut]
)
def get_my_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    # ✅ ONLY DELIVERY MANAGER
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )
    elif current_user.role != RoleEnum.delivery_manager:
        raise HTTPException(
            status_code=403,
            detail="Only delivery managers allowed."
        )

    # ✅ FETCH ONLY ASSIGNED STORES
    stores_query = (
        db.query(Store)
        .options(
            joinedload(Store.assigned_manager)
        )
    )

    if current_user.role == RoleEnum.employee:
        stores_query = filter_query_by_employee_stores(
            stores_query,
            current_user
        )
    else:
        stores_query = stores_query.filter(
            Store.assigned_manager_id
            == current_user.id
        )

    stores = stores_query.filter(Store.is_active.is_(True)).all()

    return stores


@router.get("/{store_id}", response_model=StoreOut)
def get_store_by_id(
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )

    store = (
        db.query(Store)
        .options(joinedload(Store.partners))
        .filter(Store.id == store_id)
        .first()
    )
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found."
        )

    if (
        current_user.role not in [RoleEnum.superadmin, RoleEnum.admin]
        and not store.is_active
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found.",
        )

    store_access_required(store, current_user, db)
    return store


@router.get("/store/{store_id}/analytics")
def get_store_analytics(
    store_id: str,
    month: int,
    year: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "store.view",
            current_user,
            db
        )

    # Verify store exists
    store = (
        db.query(Store)
        .options(joinedload(Store.partners))
        .filter(Store.id == store_id)
        .first()
    )

    if not store:
        raise HTTPException(
            status_code=404,
            detail="Store not found"
        )

    store_access_required(store, current_user, db)

    # MONTHLY BOTTLES
    monthly_bottles = (
        db.query(
            func.sum(Order.bottles_delivered)
        )
        .filter(
            Order.store_id == store_id,

            Order.status.in_([
                "delivered_confirmed",
                "delivered_pending_confirmation"
            ]),

            extract("month", Order.order_date) == month,
            extract("year", Order.order_date) == year
        )
        .scalar()
    ) or 0

    # TOTAL ORDERS OF MONTH
    total_orders = (
        db.query(Order)
        .filter(
            Order.store_id == store_id,

            extract("month", Order.order_date) == month,
            extract("year", Order.order_date) == year
        )
        .count()
    )

    # WEEKLY BOTTLES (currently same logic as monthly in your code)
    weekly_bottles = (
        db.query(
            func.sum(Order.bottles_delivered)
        )
        .filter(
            Order.store_id == store_id,

            Order.status.in_([
                "delivered_confirmed",
                "delivered_pending_confirmation"
            ]),

            extract("month", Order.order_date) == month,
            extract("year", Order.order_date) == year
        )
        .scalar()
    ) or 0

    return {
        "store_id": store_id,
        "month": month,
        "year": year,
        "monthly": monthly_bottles,
        "weekly": weekly_bottles,
        "orders": total_orders
    }
