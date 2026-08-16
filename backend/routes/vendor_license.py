from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database.db import get_db
from ..models.store import Store
from ..models.vendor_license import VendorLicense
from ..schemas.vendor_license import VendorLicenseCreate, VendorLicenseOut

# 🔐 AUTH IMPORTS
from ..models.user import User, RoleEnum
from ..utils.jwt import get_current_user
from ..utils.permissions import get_employee_store_ids, require_permission
from sqlalchemy import func
import requests


router = APIRouter(tags=["Vendor License"])


# =====================================================
# 🔒 SUPER ADMIN CHECK
# =====================================================
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


def get_employee_license_states(employee_id: int, db: Session) -> list[str]:
    store_ids = get_employee_store_ids(employee_id, db=db)
    if not store_ids:
        return []

    rows = (
        db.query(Store.state)
        .filter(
            Store.id.in_(store_ids),
            Store.state.isnot(None)
        )
        .distinct()
        .all()
    )

    return [
        row.state.lower().strip()
        for row in rows
        if row.state and row.state.strip()
    ]


def employee_state_access_required(
    state: str,
    current_user: User,
    db: Session
):
    if current_user.role != RoleEnum.employee:
        return

    employee_states = get_employee_license_states(current_user.id, db)
    if state.lower().strip() not in employee_states:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vendor license is not related to your assigned stores."
        )


def filter_vendor_license_query_for_employee(query, current_user: User, db: Session):
    if current_user.role != RoleEnum.employee:
        return query

    employee_states = get_employee_license_states(current_user.id, db)
    if not employee_states:
        return query.filter(False)

    return query.filter(func.lower(VendorLicense.state).in_(employee_states))


# =====================================================
# 🔥 ADD / UPDATE LICENSE (1 STATE = 1 VENDOR)
# =====================================================
@router.post("/", response_model=VendorLicenseOut)
def add_license(
    data: VendorLicenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role == RoleEnum.employee:
        employee_state_access_required(data.state, current_user, db)
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )

    existing = db.query(VendorLicense).filter(
        VendorLicense.state.ilike(data.state)
    ).first()

    if existing:
        employee_permission_required(
            "vendor_license.edit",
            current_user,
            db
        )
        existing.vendor_name = data.vendor_name
        existing.license_number = data.license_number
        db.commit()
        db.refresh(existing)
        return existing

    employee_permission_required(
        "vendor_license.create",
        current_user,
        db
    )

    new_vendor = VendorLicense(
        vendor_name=data.vendor_name,
        license_number=data.license_number,
        state=data.state
    )

    db.add(new_vendor)
    db.commit()
    db.refresh(new_vendor)

    return new_vendor


# =====================================================
# 🌐 GET LICENSE BY STATE
# =====================================================
@router.get("/by-state", response_model=VendorLicenseOut)
def get_license_by_state(
    state: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    employee_permission_required(
        "vendor_license.view",
        current_user,
        db
    )
    employee_state_access_required(state, current_user, db)

    vendor = db.query(VendorLicense).filter(
        VendorLicense.state.ilike(state)
    ).first()

    if not vendor:
        return {
            "vendor_name": "Not Available",
            "license_number": "N/A",
            "state": state
        }

    return vendor


# =====================================================
# 📋 GET ALL VENDORS
# =====================================================
@router.get("/all", response_model=list[VendorLicenseOut])
def get_all_vendors(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    employee_permission_required(
        "vendor_license.view",
        current_user,
        db
    )

    query = filter_vendor_license_query_for_employee(
        db.query(VendorLicense),
        current_user,
        db
    )

    return query.all()


# =====================================================
# 📍 GET LICENSE BY LOCATION (QR MAIN API 🔥)
# =====================================================
@router.get("/by-location")
def get_license_by_location(
    lat: float = None,
    lng: float = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    employee_permission_required(
        "vendor_license.view",
        current_user,
        db
    )

    if lat is None or lng is None:
        return {
            "vendor_name": "Not Available",
            "license_number": "N/A",
            "state": "Unknown"
        }

    try:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json"

        # 🔥 REQUIRED HEADERS (VERY IMPORTANT)
        headers = {
            "User-Agent": "AquaTrackApp/1.0 (support@aquatrack.com)"
        }

        response = requests.get(url, headers=headers, timeout=5)

        print("🔥 STATUS:", response.status_code)
        print("🔥 RAW RESPONSE:", response.text)

        res = response.json()
        address = res.get("address", {})

        # 🔥 HANDLE MULTIPLE POSSIBLE KEYS
        state = (
            address.get("state")
            or address.get("region")
            or address.get("state_district")
            or ""
        )

        print("🔥 RAW STATE:", state)

        if not state:
            return {
                "vendor_name": "Not Available",
                "license_number": "N/A",
                "state": "Unknown"
            }

        # 🔥 CLEAN STATE
        clean_state = state.lower().replace("state of", "").strip()

        print("🔥 CLEAN STATE:", clean_state)

        # 🔥 FLEXIBLE MATCH
        employee_state_access_required(clean_state, current_user, db)

        vendor = db.query(VendorLicense).filter(
            func.lower(VendorLicense.state).like(f"%{clean_state}%")
        ).first()

        if not vendor:
            return {
                "vendor_name": "Not Available",
                "license_number": "N/A",
                "state": state
            }

        return vendor

    except Exception as e:
        print("❌ ERROR:", e)
        return {
            "vendor_name": "Not Available",
            "license_number": "N/A",
            "state": "Error"
        }


# =====================================================
# 🌍 GET AVAILABLE STATES
# =====================================================
@router.get("/states")
def get_available_states(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    employee_permission_required(
        "vendor_license.view",
        current_user,
        db
    )

    all_states = [
        "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh",
        "Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka",
        "Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya",
        "Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim",
        "Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand",
        "West Bengal","Delhi"
    ]

    if current_user.role == RoleEnum.employee:
        employee_states = set(get_employee_license_states(current_user.id, db))
        all_states = [
            state for state in all_states
            if state.lower().strip() in employee_states
        ]

    used_states_query = db.query(VendorLicense.state)
    used_states_query = filter_vendor_license_query_for_employee(
        used_states_query,
        current_user,
        db
    )
    used_states = used_states_query.all()
    used_states = [s[0].lower() for s in used_states]

    available_states = [
        s for s in all_states if s.lower() not in used_states
    ]

    return {
        "available_states": available_states,
        "used_states": list(set([s.capitalize() for s in used_states]))
    }

@router.delete("/delete/{vendor_id}")
def delete_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)  # 🔒 ONLY SUPER ADMIN
):
    if current_user.role == RoleEnum.employee:
        employee_permission_required(
            "vendor_license.delete",
            current_user,
            db
        )
    elif current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can perform this action."
        )

    vendor = db.query(VendorLicense).filter(
        VendorLicense.id == vendor_id
    ).first()

    if not vendor:
        raise HTTPException(
            status_code=404,
            detail="Vendor not found"
        )

    employee_state_access_required(vendor.state, current_user, db)

    db.delete(vendor)
    db.commit()

    return {
        "message": "Vendor deleted successfully"
    }

