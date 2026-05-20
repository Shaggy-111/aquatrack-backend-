from pydantic import BaseModel, EmailStr
from typing import Optional

class OTPRequest(BaseModel):
    """
    Schema for requesting an OTP.
    Requires an email address.
    """
    email: EmailStr

class OTPVerification(BaseModel):
    """
    Schema for verifying an OTP.
    Requires an email address and the 6-digit OTP code.
    """
    email: EmailStr
    otp_code: str

class OTPStatus(BaseModel):
    """
    Schema for a generic status response after an OTP action.
    """
    message: str
    success: bool
