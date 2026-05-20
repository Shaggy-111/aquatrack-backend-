from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship
from sqlalchemy.types import Enum as SQLEnum
from enum import Enum as PyEnum
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, func

from ..database.db import Base

class ComplaintStatusEnum(str, PyEnum):
    pending = "pending"
    resolved = "resolved"

class Complaint(Base):
    __tablename__ = "complaints"

    id = Column(Integer, primary_key=True, index=True)

    subject = Column(String, nullable=False)
    description = Column(String, nullable=False)

    status = Column(
        SQLEnum(ComplaintStatusEnum),
        default=ComplaintStatusEnum.pending,
        nullable=False
    )

    solution = Column(String, nullable=True)

    # Complaint image
    photo_url = Column(String, nullable=True)

    # Who created (Partner)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # NEW: Store ID (useful for channel detection)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)

    # NEW: Two separate assignments
    assigned_to_admin_id = Column(Integer, ForeignKey("users.id"), nullable=True)            # SuperAdmin
    assigned_to_channel_admin_id = Column(Integer, ForeignKey("users.id"), nullable=True)    # ChannelAdmin

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    created_by = relationship("User", foreign_keys=[created_by_id])

    # Assigned users
    assigned_admin = relationship("User", foreign_keys=[assigned_to_admin_id])
    assigned_channel_admin = relationship("User", foreign_keys=[assigned_to_channel_admin_id])

    # Related store
    store = relationship("Store")
