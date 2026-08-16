from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database.db import Base


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_attendance_user_date"),
        CheckConstraint(
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
            name="ck_attendance_latitude_range",
        ),
        CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="ck_attendance_longitude_range",
        ),
        CheckConstraint(
            "check_out_time IS NULL OR check_in_time IS NOT NULL",
            name="ck_attendance_checkout_requires_checkin",
        ),
        CheckConstraint(
            "check_out_time IS NULL OR check_out_time >= check_in_time",
            name="ck_attendance_time_sequence",
        ),
        Index("ix_attendance_date", "date"),
    )

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
