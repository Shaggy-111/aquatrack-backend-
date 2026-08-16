from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    UniqueConstraint,
)

from sqlalchemy.orm import relationship

from ..database.db import Base


class EmployeePermission(Base):
    __tablename__ = "employee_permissions"

    id = Column(Integer, primary_key=True, index=True)

    employee_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    permission_id = Column(
        Integer,
        ForeignKey("permissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    assigned_by = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )

    employee = relationship(
        "User",
        foreign_keys=[employee_id],
    )


    assigned_by_user = relationship(
        "User",
        foreign_keys=[assigned_by],
    )

    permission = relationship(
        "Permission",
        back_populates="permissions",
    )

    __table_args__ = (
        UniqueConstraint(
            "employee_id",
            "permission_id",
            name="uq_employee_permission",
        ),
    )