from datetime import datetime, timezone

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import relationship

from ..database.db import Base


class BlinkitReportStoreMetadata(Base):
    __tablename__ = "blinkit_report_store_metadata"

    id = Column(Integer, primary_key=True)
    store_id = Column(
        String,
        ForeignKey("stores.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    citi_lead = Column(String(255), nullable=True)
    mode_of_ops = Column(String(100), nullable=True)
    live_date = Column(Date, nullable=True)
    supply_start_date = Column(Date, nullable=True)
    report_status = Column(String(100), nullable=True)
    closed_dropped_date = Column(Date, nullable=True)
    admin_poc = Column(String(255), nullable=True)
    contact_no = Column(String(100), nullable=True)
    vendor_name = Column(String(255), nullable=True)
    vendor_rate = Column(Numeric(12, 4), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    store = relationship("Store")
