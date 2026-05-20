from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.sql import func
from datetime import datetime
from ..database.db import Base # Import the Base from your database module

class OTP(Base):
    """
    Model for storing OTPs for email verification.
    """
    __tablename__ = "otps"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    otp_code = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    verified = Column(Boolean, default=False)
    is_for_signup = Column(Boolean, default=True) 
    def __repr__(self):
        return f"<OTP(id={self.id}, email={self.email}, verified={self.verified})>"
