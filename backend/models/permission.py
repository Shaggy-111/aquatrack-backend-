from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from ..database.db import Base
from sqlalchemy.orm import relationship


class Permission(Base):
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)

    # Example: Orders, Reports, Attendance
    module = Column(String(100), nullable=False)

    # Example: View, Create, Edit, Delete
    action = Column(String(100), nullable=False)

    # Example: orders.view
    permission_key = Column(String(150), nullable=False, unique=True, index=True)

    # Example: View Orders
    display_name = Column(String(150), nullable=False)

    # Optional description
    description = Column(Text, nullable=True)

    # Sidebar / UI sorting
    sort_order = Column(Integer, default=0)

    # Soft enable / disable
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    permissions = relationship(
        "EmployeePermission",
        back_populates="permission",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint(
            "permission_key",
            name="uq_permission_key",
        ),
    )

    def __repr__(self):
        return (
            f"<Permission("
            f"module='{self.module}', "
            f"action='{self.action}', "
            f"key='{self.permission_key}'"
            f")>"
        )