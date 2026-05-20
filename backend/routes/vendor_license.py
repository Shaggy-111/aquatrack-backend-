from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database.db import get_db
from ..models.vendor_license import VendorLicense
from ..schemas.vendor_license import VendorLicenseCreate, VendorLicenseOut

# 🔐 AUTH IMPORTS
from ..models.user import User, RoleEnum
from ..utils.jwt import get_current_user
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


# =====================================================
# 🔥 ADD / UPDATE LICENSE (1 STATE = 1 VENDOR)
# =====================================================
@router.post("/", response_model=VendorLicenseOut)
def add_license(
    data: VendorLicenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    existing = db.query(VendorLicense).filter(
        VendorLicense.state.ilike(data.state)
    ).first()

    if existing:
        existing.vendor_name = data.vendor_name
        existing.license_number = data.license_number
        db.commit()
        db.refresh(existing)
        return existing

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
def get_license_by_state(state: str, db: Session = Depends(get_db)):
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
def get_all_vendors(db: Session = Depends(get_db)):
    return db.query(VendorLicense).all()


# =====================================================
# 📍 GET LICENSE BY LOCATION (QR MAIN API 🔥)
# =====================================================
@router.get("/by-location")
def get_license_by_location(
    lat: float = None,
    lng: float = None,
    db: Session = Depends(get_db)
):
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
def get_available_states(db: Session = Depends(get_db)):
    all_states = [
        "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh",
        "Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka",
        "Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya",
        "Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim",
        "Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand",
        "West Bengal","Delhi"
    ]

    used_states = db.query(VendorLicense.state).all()
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
    current_user: User = Depends(super_admin_required)  # 🔒 ONLY SUPER ADMIN
):
    vendor = db.query(VendorLicense).filter(
        VendorLicense.id == vendor_id
    ).first()

    if not vendor:
        raise HTTPException(
            status_code=404,
            detail="Vendor not found"
        )

    db.delete(vendor)
    db.commit()

    return {
        "message": "Vendor deleted successfully"
    }