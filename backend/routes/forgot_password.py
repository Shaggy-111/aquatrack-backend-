# The '..' at the start of these imports tells Python to go up one directory
# (from 'routes' to 'backend') to find the other modules.
from ..database.db import get_db
from ..models.user import User, RoleEnum
from ..models.otp import OTP as OtpModel
from ..utils.auth import verify_password, hash_password
from ..utils.jwt import create_access_token
from ..schemas.user import UserOut, UserCreate # Assuming UserCreate is correct
from ..schemas.otp import OTPRequest, OTPVerification, OTPStatus
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr # Ensure EmailStr is imported
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime, timedelta, timezone

# New imports for email sending, now self-contained in this file
import smtplib
import ssl
from email.message import EmailMessage
import os
import random
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

router = APIRouter(tags=["Auth & OTP"]) # Added a tag for organization

# -------------------------------------------------------------------
# 🟢 Pydantic Models for LOGIN & RESPONSE
# -------------------------------------------------------------------
class LoginRequest(BaseModel):
    # This must match what the web and mobile apps send. 
    # Since the mobile app sends email in the 'username' field, we keep it as username:
    username: EmailStr 
    password: str
    # Assuming mobile sends 'role' for authorization check on the server
    role: Optional[str] = None 

class UnifiedLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_role: str
    channel_name: Optional[str] = None
    # Assuming 'manager_area' might be needed for DM
    manager_area: Optional[str] = None 
    # Assuming 'city' might be needed for DP
    city: Optional[str] = None


# -------------------------------------------------------------------
# HELPER: Send OTP Email
# -------------------------------------------------------------------
def send_otp_email(to_email: str, otp: str):
    # ... (Your existing send_otp_email function code remains here) ...
    sender_email = os.getenv("EMAIL_USER")
    sender_password = os.getenv("EMAIL_PASS")
    smtp_server = "smtp.gmail.com"
    port = 587 # Port for STARTTLS

    if not sender_email or not sender_password:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server email configuration is missing."
        )

    subject = "Your One-Time Password (OTP)"
    body = f"""
    Hello,

    Your OTP is: {otp}

    This code is valid for 15 minutes.
    If you did not request this, please ignore this email.
    """

    msg = EmailMessage()
    msg.set_content(body)
    msg["Subject"] = subject
    msg["From"] = sender_email
    msg["To"] = to_email

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP(smtp_server, port) as server:
            server.starttls(context=context)
            server.login(sender_email, sender_password)
            server.send_message(msg)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not send OTP email: {e}"
        )


# -------------------------------------------------------------------
# 🟢 LOGIN ROUTE - CRITICALLY FIXED FOR 403 ERROR
# -------------------------------------------------------------------

# In routes/auth.py

@router.post("/login", response_model=UnifiedLoginResponse)
def login(
    login_data: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    Unified login endpoint for all roles.
    - Limits mobile app access to Delivery Partners and Delivery Managers.
    - Requires 'active' status for operational roles.
    - Returns role-specific context (city, channel, area).
    """

    # 1. Fetch User and Authenticate
    user = db.query(User).filter(User.email == login_data.username).first()

    if not user or not verify_password(login_data.password,  user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    # Get the role string safely
    user_role_str = user.role.value if user.role else None

    # 2. Define Role Groups for Logic
    MOBILE_FIELD_ROLES = [
        RoleEnum.delivery.value,
        RoleEnum.delivery_manager.value
    ]

    WEB_ONLY_ROLES = [
        RoleEnum.superadmin.value,
        RoleEnum.admin.value,
        RoleEnum.partner.value,
        RoleEnum.channel_admin.value,
        RoleEnum.vendor.value,
        RoleEnum.sub_partner.value,
        RoleEnum.employee.value
    ]

    # 3. Status Check: Enforce active status for field personnel
    # Field staff must be approved by Super Admin before they can log in.
    if user_role_str in MOBILE_FIELD_ROLES and user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access Denied: Your status is '{user.status}'. Please contact support for approval."
        )

    # 4. Mobile Security Check
    # If the request provides a role filter (sent by the mobile app), enforce mobile-only roles.
    if login_data.role:
        if user_role_str not in MOBILE_FIELD_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Login failed: Role '{user_role_str}' is not authorized for the mobile application."
            )

    # 5. General Allowlist (Double check that the role is valid at all)
    if user_role_str not in (MOBILE_FIELD_ROLES + WEB_ONLY_ROLES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Role not permitted for login."
        )

    # 6. Generate JWT Token
    access_token = create_access_token(
        data={"sub": user.email, "user_role": user_role_str}
    )

    # 7. Prepare Role-Specific Context Data
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_role": user_role_str,
        "channel_name": user.channel if hasattr(user, 'channel') else None,
        "manager_area": user.city if user_role_str == RoleEnum.delivery_manager.value else None,
        "city": user.city if user_role_str == RoleEnum.delivery.value else None,
    }
# OTP VERIFICATION ROUTES (Remaining code block starts here)
# -------------------------------------------------------------------
# ... (Rest of your OTP functions: request_otp, verify_forgot_password_otp, verify_signup_otp, signup) ...

@router.post("/request-otp", response_model=OTPStatus)
async def request_otp(
    otp_data: OTPRequest,
    db: Session = Depends(get_db)
):
    # ... (Your request_otp function code remains here) ...
    # Check for an existing unexpired OTP. This prevents overwriting a valid OTP.
    existing_unexpired_otp = db.query(OtpModel).filter(
        OtpModel.email == otp_data.email,
        OtpModel.expires_at > datetime.now(timezone.utc),
        OtpModel.is_for_signup == True
    ).first()

    if existing_unexpired_otp:
        # If an unexpired OTP exists, resend that same code.
        send_otp_email(otp_data.email, existing_unexpired_otp.otp_code)
        return {"message": "An unexpired OTP already exists and has been resent to your email.", "success": True}

    # If no valid OTP exists, create a new one.
    otp_code = str(random.randint(100000, 999999))
    current_time = datetime.now(timezone.utc)
    expiration_time = current_time + timedelta(minutes=15)
    
    # Check for an expired OTP to update it instead of creating a new row
    existing_otp = db.query(OtpModel).filter(
        OtpModel.email == otp_data.email,
        OtpModel.is_for_signup == True
    ).first()
    
    if existing_otp:
        existing_otp.otp_code = otp_code
        existing_otp.created_at = current_time
        existing_otp.expires_at = expiration_time
        existing_otp.verified = False
    else:
        new_otp = OtpModel(
            email=otp_data.email, 
            otp_code=otp_code, 
            expires_at=expiration_time,
            verified=False,
            is_for_signup=True
        )
        db.add(new_otp)
    
    db.commit()
    send_otp_email(otp_data.email, otp_code)
    return {"message": "A new OTP has been sent to your email.", "success": True}

@router.post("/verify-forgot-password-otp", response_model=OTPStatus)
async def verify_forgot_password_otp(
    otp_data: OTPVerification,
    db: Session = Depends(get_db)
):
    # ... (Your verify_forgot_password_otp function code remains here) ...
    otp_record = db.query(OtpModel).filter(
        OtpModel.email == otp_data.email,
        OtpModel.otp_code == otp_data.otp_code,
        OtpModel.is_for_signup == False
    ).first()

    if not otp_record:
        # Check specifically for an expired OTP to provide a more helpful error message
        expired_otp_record = db.query(OtpModel).filter(
            OtpModel.email == otp_data.email,
            OtpModel.is_for_signup == False,
            OtpModel.expires_at <= datetime.now(timezone.utc)
        ).first()
        if expired_otp_record:
            db.delete(expired_otp_record)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The OTP has expired. Please request a new one."
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OTP code. Please check the code and try again."
            )

    if otp_record.verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This OTP has already been verified. Please proceed to reset your password."
        )

    # The OTP is valid and not yet verified. Mark it as verified.
    otp_record.verified = True
    db.commit()
    return {"message": "OTP verified successfully. You can now proceed to reset your password.", "success": True}

@router.post("/verify-signup-otp", response_model=OTPStatus)
async def verify_signup_otp(
    otp_data: OTPVerification,
    db: Session = Depends(get_db)
):
    # ... (Your verify_signup_otp function code remains here) ...
    otp_record = db.query(OtpModel).filter(
        OtpModel.email == otp_data.email,
        OtpModel.otp_code == otp_data.otp_code,
        OtpModel.is_for_signup == True
    ).first()

    if not otp_record:
        # Check specifically for an expired OTP to provide a more helpful error message
        expired_otp_record = db.query(OtpModel).filter(
            OtpModel.email == otp_data.email,
            OtpModel.is_for_signup == True,
            OtpModel.expires_at <= datetime.now(timezone.utc)
        ).first()
        if expired_otp_record:
            db.delete(expired_otp_record)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The OTP has expired. Please request a new one."
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OTP code. Please check the code and try again."
            )

    if otp_record.verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This OTP has already been verified. Please proceed to signup."
        )

    # The OTP is valid and not yet verified. Mark it as verified.
    otp_record.verified = True
    db.commit()
    return {"message": "OTP verified successfully. You can now proceed to signup.", "success": True}

@router.post("/signup", response_model=UserOut)
def signup(user_data: UserCreate, db: Session = Depends(get_db)):
    # ... (Your signup function code remains here) ...
    if user_data.role in [RoleEnum.superadmin, RoleEnum.admin, RoleEnum.vendor]:
        raise HTTPException(status_code=403, detail="This role cannot sign up directly")

    existing = db.query(User).filter(
        (User.email == user_data.email) |
        (User.mobile_number == user_data.mobile_number)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email or mobile number already exists")

    if user_data.role == RoleEnum.customer:
        delivery_required = [
            "govt_id", "id_type", "current_address", "state", "city",
            "vehicle_number", "driving_license_number", "govt_id_photo", "delivery_photo"
        ]
        if all(getattr(user_data, f) for f in delivery_required):
            user_data.role = RoleEnum.delivery
            user_data.status = "pending"

    hashed_pwd = hash_password(user_data.password)

    new_user = User(
        full_name=user_data.full_name,
        email=user_data.email,
        mobile_number=user_data.mobile_number,
        password=hashed_pwd,
        role=user_data.role,
        status=user_data.status,
        region_id=user_data.region_id,
        govt_id=user_data.govt_id,
        id_type=user_data.id_type,
        current_address=user_data.current_address,
        state=user_data.state,
        city=user_data.city,
        vehicle_number=user_data.vehicle_number,
        driving_license_number=user_data.driving_license_number,
        govt_id_photo=user_data.govt_id_photo,
        delivery_photo=user_data.delivery_photo
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user