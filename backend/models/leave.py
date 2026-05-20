from sqlalchemy import Column, Integer, Date, String, ForeignKey, DateTime
from sqlalchemy.sql import func
from ..database.db import Base


class Leave(Base):
    __tablename__ = "leaves"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=False)

    reason = Column(String, nullable=True)

    status = Column(String, default="pending")

    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())