# --- Imports ---
from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Float,
    ForeignKey
)
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from sqlalchemy import Date

from ..database.db import Base
from .partner_store import PartnerStore
from sqlalchemy import Boolean


class Store(Base):
    __tablename__ = "stores"

    # -------------------------------------------------
    # Core Columns
    # -------------------------------------------------
    id = Column(String, primary_key=True, index=True)

    store_name = Column(String(255), nullable=False)
    address = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    zip_code = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    pending_empty_bottles = Column(Integer, default=0, nullable=False)

    # -------------------------------------------------
    # Location & Channel
    # -------------------------------------------------
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    entity = Column(String(100), nullable=True)
    region = Column(String(100), nullable=True)
    project_code = Column(String(100), nullable=True)
    channel = Column(String(30), nullable=False, default="GENERAL")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    qr_public_id = Column(
        String(36),
        nullable=False,
        unique=True,
        index=True,
        default=lambda: str(uuid.uuid4()),
    )
    qr_token_version = Column(Integer, nullable=False, default=1, server_default="1")
    qr_enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    per_day_consumption = Column(Integer, default=0)
    monthly_cap = Column(Integer, default=0)
    last_order_date = Column(Date, nullable=True)
    auto_order_enabled = Column(Boolean, default=False)
    order_frequency_days = Column(Integer, default=1)

    # -------------------------------------------------
    # ⭐ DELIVERY MANAGER OWNERSHIP (CRITICAL)
    # -------------------------------------------------
    assigned_manager_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        index=True
    )

    assigned_manager = relationship(
        "User",
        backref="managed_stores",
        foreign_keys=[assigned_manager_id]
    )

    # -------------------------------------------------
    # Relationships
    # -------------------------------------------------
    partners = relationship(
        "User",
        secondary="partner_stores",
        back_populates="stores"
    )

    partner_associations = relationship(
        "PartnerStore",
        back_populates="store",
        cascade="all, delete-orphan"
    )

    orders = relationship(
        "Order",
        back_populates="store",
        cascade="all, delete-orphan"
    )

    bottles_at_store = relationship(
        "Bottle",
        back_populates="store",
        cascade="all, delete-orphan"
    )

    compliance_documents = relationship(
        "StoreComplianceDocument",
        back_populates="store",
        cascade="all, delete-orphan"
    )

    qr_delivery_submissions = relationship(
        "StoreQrDeliverySubmission",
        back_populates="store",
    )

    # -------------------------------------------------
    # Virtual Properties (Partner / POC Resolution)
    # -------------------------------------------------
    @property
    def poc_name(self):
        if self.partners and len(self.partners) > 0:
            return self.partners[0].full_name
        return None

    @property
    def poc_phone(self):
        if self.partners and len(self.partners) > 0:
            return self.partners[0].mobile_number
        return None

    # -------------------------------------------------
    # String Representation
    # -------------------------------------------------
    def __repr__(self):
        return (
            f"<Store("
            f"id={self.id}, "
            f"name='{self.store_name}', "
            f"city='{self.city}', "
            f"assigned_manager_id={self.assigned_manager_id}"
            f")>"
        )

