from sqlalchemy import CheckConstraint, Column, Integer, Date, String, ForeignKey, DateTime, Index
from sqlalchemy.sql import func
from ..database.db import Base


class Leave(Base):
    __tablename__ = "leaves"
    __table_args__ = (
        CheckConstraint("to_date >= from_date", name="ck_leave_date_sequence"),
        Index("ix_leaves_user_dates", "user_id", "from_date", "to_date"),
        Index("ix_leaves_status", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=False)

    reason = Column(String, nullable=True)

    status = Column(String, default="pending")

    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    rejected_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
