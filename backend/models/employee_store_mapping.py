from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)

from sqlalchemy.orm import relationship

from ..database.db import Base


class EmployeeStoreMapping(Base):
    __tablename__ = "employee_store_mapping"

    id = Column(Integer, primary_key=True, index=True)

    employee_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    store_id = Column(
        String,
        ForeignKey("stores.id", ondelete="CASCADE"),
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
        nullable=False,
    )

    employee = relationship(
        "User",
        foreign_keys=[employee_id],
    )

    store = relationship("Store")

    assigned_by_user = relationship(
        "User",
        foreign_keys=[assigned_by],
    )

    __table_args__ = (
        UniqueConstraint(
            "employee_id",
            "store_id",
            name="uq_employee_store",
        ),
    )