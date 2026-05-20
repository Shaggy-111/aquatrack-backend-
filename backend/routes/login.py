# The '..' at the start of these imports tells Python to go up one directory
# (from 'routes' to 'backend') to find the other modules.
from ..database.db import get_db
from ..models.user import User, RoleEnum
from ..models.otp import OTP as OtpModel
from ..utils.auth import verify_password, hash_password
from ..utils.jwt import create_access_token
from ..schemas.user import UserOut, UserCreate
from ..schemas.otp import OTPRequest, OTPVerification, OTPStatus
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime, timedelta, timezone
import smtplib
import ssl
from email.message import EmailMessage
import os
import random
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

router = APIRouter()

# -------------------------------------------------------------------
# HELPER: Send OTP Email
# -------------------------------------------------------------------
def send_otp_email(to_email: str, otp: str):
    sender_email = os.getenv("EMAIL_USER")
    sender_password = os.getenv("EMAIL_PASS")
    smtp_server = "smtp.gmail.com"
    port = 587  # STARTTLS

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
# LOGIN SCHEMA & ROUTE
# -------------------------------------------------------------------
class UserLogin(BaseModel):
    username: Optional[str] = None  # allow frontend "username"
    email: Optional[str] = None      # also allow "email"
    password: str
    role: RoleEnum

# -------- LOGIN (JSON-based) - FIXED ROLE CHECK --------

@router.post("/login", response_model=UnifiedLoginResponse)
def login(
    login_data: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    Handles unified user login by allowing all dashboard roles (Super Admin, Partner, etc.).
    """
    user = db.query(User).filter(User.email == login_data.username).first()
    
    # Check 1: Authentication
    if not user or not verify_password(login_data.password, user.password):
        # Changed 400 to 401 for better security practice
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    user_role_str = user.role.value if user.role else None

    # 2. CRITICAL FIX: Expanded list of permitted roles (Allowing Super Admin, Partner, Channel Admin)
    ALLOWED_DASHBOARD_ROLES = [
        RoleEnum.superadmin.value, 
        RoleEnum.admin.value,
        RoleEnum.partner.value, 
        RoleEnum.channel_admin.value, 
        # Include any other roles you want to access the dashboard:
        # RoleEnum.vendor.value,
        # RoleEnum.sub_partner.value,
    ]

    if user_role_str not in ALLOWED_DASHBOARD_ROLES:
        # This is the line that caused the 403, now bypassed if the role is correct
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{user_role_str}' is not permitted to log in via this endpoint."
        )

    # 3. Handle Channel Admin data (Must match your User model's 'channel' field)
    channel_name = None
    if user_role_str == RoleEnum.channel_admin.value:
        channel_name = user.channel 

    # 4. Token Creation (Include role for frontend redirection and subsequent API calls)
    # Ensure create_access_token is imported from ..utils.auth
    access_token = create_access_token(data={"sub": user.email, "user_role": user_role_str})
    
    # 5. Return Unified Response
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_role": user_role_str,
        "channel_name": channel_name
    }


# -------------------------------------------------------------------
# OTP VERIFICATION ROUTES
# -------------------------------------------------------------------
@router.post("/request-otp", response_model=OTPStatus)
async def request_otp(otp_data: OTPRequest, db: Session = Depends(get_db)):
    existing_unexpired_otp = db.query(OtpModel).filter(
        OtpModel.email == otp_data.email,
        OtpModel.expires_at > datetime.now(timezone.utc),
        OtpModel.is_for_signup == True
    ).first()

    if existing_unexpired_otp:
        send_otp_email(otp_data.email, existing_unexpired_otp.otp_code)
        return {"message": "An unexpired OTP already exists and has been resent to your email.", "success": True}

    otp_code = str(random.randint(100000, 999999))
    current_time = datetime.now(timezone.utc)
    expiration_time = current_time + timedelta(minutes=15)

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
async def verify_forgot_password_otp(otp_data: OTPVerification, db: Session = Depends(get_db)):
    otp_record = db.query(OtpModel).filter(
        OtpModel.email == otp_data.email,
        OtpModel.otp_code == otp_data.otp_code,
        OtpModel.is_for_signup == False
    ).first()

    if not otp_record:
        expired_otp_record = db.query(OtpModel).filter(
            OtpModel.email == otp_data.email,
            OtpModel.is_for_signup == False,
            OtpModel.expires_at <= datetime.now(timezone.utc)
        ).first()
        if expired_otp_record:
            db.delete(expired_otp_record)
            db.commit()
            raise HTTPException(status_code=400, detail="The OTP has expired. Please request a new one.")
        raise HTTPException(status_code=400, detail="Invalid OTP code. Please try again.")

    if otp_record.verified:
        raise HTTPException(status_code=400, detail="This OTP has already been verified.")

    otp_record.verified = True
    db.commit()
    return {"message": "OTP verified successfully.", "success": True}


@router.post("/verify-signup-otp", response_model=OTPStatus)
async def verify_signup_otp(otp_data: OTPVerification, db: Session = Depends(get_db)):
    otp_record = db.query(OtpModel).filter(
        OtpModel.email == otp_data.email,
        OtpModel.otp_code == otp_data.otp_code,
        OtpModel.is_for_signup == True
    ).first()

    if not otp_record:
        expired_otp_record = db.query(OtpModel).filter(
            OtpModel.email == otp_data.email,
            OtpModel.is_for_signup == True,
            OtpModel.expires_at <= datetime.now(timezone.utc)
        ).first()
        if expired_otp_record:
            db.delete(expired_otp_record)
            db.commit()
            raise HTTPException(status_code=400, detail="The OTP has expired. Please request a new one.")
        raise HTTPException(status_code=400, detail="Invalid OTP code. Please try again.")

    if otp_record.verified:
        raise HTTPException(status_code=400, detail="This OTP has already been verified.")

    otp_record.verified = True
    db.commit()
    return {"message": "OTP verified successfully.", "success": True}


# -------------------------------------------------------------------
# SIGNUP ROUTE
# -------------------------------------------------------------------
@router.post("/signup", response_model=UserOut)
def signup(user_data: UserCreate, db: Session = Depends(get_db)):
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


