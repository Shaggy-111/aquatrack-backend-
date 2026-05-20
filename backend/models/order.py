from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Enum,
    Float,
    Boolean,
    Text,
)
from sqlalchemy.orm import relationship, backref
from datetime import datetime, timezone
from ..database.db import Base
import enum
import pytz

ist = pytz.timezone("Asia/Kolkata")


# =====================================================
# ORDER STATUS ENUM (CLEAN & ROUTING SAFE)
# =====================================================
class OrderStatusEnum(enum.Enum):
    # Order just created
    pending = "pending"

    accepted = "accepted"

    

    # ⭐ Auto-routed to Delivery Manager (CRITICAL)
    assigned_to_manager = "assigned_to_manager"

    # Delivery Manager assigned to Delivery Partner
    assigned = "assigned"

    # Delivery Partner picked order
    in_transit = "in_transit"

    # Delivered, waiting store confirmation
    delivered_pending_confirmation = "delivered_pending_confirmation"

    # Final confirmed
    delivered_confirmed = "delivered_confirmed"

    # Other states
    cancelled = "cancelled"
    rejected = "rejected"
    delivery_disputed = "delivery_disputed"


# =====================================================
# ORDER MODEL
# =====================================================
class Order(Base):
    __tablename__ = "orders"

    # -------------------------------------------------
    # Core
    # -------------------------------------------------
    id = Column(Integer, primary_key=True, index=True)

    partner_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False
    )

    store_id = Column(
         String,
        ForeignKey("stores.id"),
        nullable=False
    )

    # Final Delivery Partner
    delivery_person_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True
    )

    # ⭐ AUTO ROUTING TO DELIVERY MANAGER ⭐
    assigned_to_manager_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        index=True
    )

    status = Column(
        Enum(OrderStatusEnum),
        default=OrderStatusEnum.pending,
        nullable=False
    )

    order_details = Column(String, nullable=False)
    total_amount = Column(Float, nullable=False)

    channel = Column(String(30), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    order_date = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(ist),
        nullable=False
    )

    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )

    delivered_at = Column(DateTime, nullable=True)

    

    # -------------------------------------------------
    # Delivery Partner Flow
    # -------------------------------------------------
    bottles_delivered = Column(Integer, default=0)
    delivery_photo_url = Column(String, nullable=True)
    delivery_note = Column(Text, nullable=True)
    vehicle_info = Column(String, nullable=True)
    delivered_by = Column(String, nullable=True)

    # -------------------------------------------------
    # Empty Bottle Tracking
    # -------------------------------------------------
    empty_bottles_collected = Column(Integer, default=0)
    confirmed_empty_bottles = Column(Integer, default=0)

    # -------------------------------------------------
    # Store Confirmation
    # -------------------------------------------------
    store_confirmed = Column(Boolean, default=False)
    confirmed_bottles = Column(Integer, nullable=True)
    confirmation_remarks = Column(Text, nullable=True)
    poc_name = Column(String, nullable=True)  # Store POC ka naam jo order de raha hai
    ordered_by_type = Column(String, nullable=True) # 'ADMIN' ya 'POC' differentiate karne ke liye

    # =================================================
    # RELATIONSHIPS
    # =================================================

    # Partner who placed order
    partner = relationship(
        "User",
        foreign_keys=[partner_id],
        back_populates="orders_placed"
    )

    # Delivery Partner
    delivery_person = relationship(
        "User",
        foreign_keys=[delivery_person_id],
        back_populates="orders_delivered"
    )

    # ⭐ Delivery Manager (AUTO ROUTED)
    manager_assigned = relationship(
        "User",
        foreign_keys=[assigned_to_manager_id],
        backref=backref("assigned_orders_manager", lazy="dynamic")
    )

    # Store
    store = relationship(
        "Store",
        back_populates="orders"
    )

    bottles_in_order = relationship(
        "Bottle",
        back_populates="order"
    )

    # -------------------------------------------------
    # Debug Helper
    # -------------------------------------------------
    def __repr__(self):
        return (
            f"<Order id={self.id} "
            f"store={self.store_id} "
            f"manager={self.assigned_to_manager_id} "
            f"status={self.status}>"
        )
