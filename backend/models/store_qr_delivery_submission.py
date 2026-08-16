import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from ..database.db import Base


class StoreQrDeliverySubmission(Base):
    __tablename__ = "store_qr_delivery_submissions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    idempotency_key = Column(String(36), nullable=False, unique=True, index=True)
    token_jti = Column(String(36), nullable=False, unique=True, index=True)
    qr_token_version = Column(Integer, nullable=False)
    submitted_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
    source_ip = Column(String(64), nullable=True)
    user_agent = Column(Text, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    gps_accuracy = Column(Float, nullable=True)
    delivered_by = Column(String(255), nullable=True)
    photo_url = Column(Text, nullable=True)
    remarks = Column(Text, nullable=True)
    created_order = Column(Boolean, nullable=False, default=False)

    store = relationship("Store", back_populates="qr_delivery_submissions")
    order = relationship("Order")
