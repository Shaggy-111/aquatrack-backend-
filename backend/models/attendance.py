from sqlalchemy import Column, Integer, Date, DateTime, Float, String, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database.db import Base


class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    date = Column(Date, nullable=False)

    check_in_time = Column(DateTime(timezone=True), nullable=True)
    check_out_time = Column(DateTime(timezone=True), nullable=True)

    status = Column(String, default="present")

    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    working_hours = Column(Float, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship
    user = relationship("User", backref="attendance_records")