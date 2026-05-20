from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime, timezone
from ..database.db import Base


class VendorLicense(Base):
    __tablename__ = "vendor_licenses"

    id = Column(Integer, primary_key=True, index=True)
    vendor_name = Column(String, nullable=False)
    license_number = Column(String, nullable=False)
    state = Column(String, nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )