from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Text
)

from sqlalchemy.orm import relationship
from datetime import datetime

from ..database.db import Base


class StoreComplianceDocument(Base):
    __tablename__ = "store_compliance_documents"

    id = Column(Integer, primary_key=True, index=True)

    # -------------------------------------------------
    # STORE
    # -------------------------------------------------
    store_id = Column(
        String,
        ForeignKey("stores.id"),
        nullable=False,
        index=True
    )

    # -------------------------------------------------
    # DELIVERY MANAGER
    # -------------------------------------------------
    uploaded_by = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False
    )

    # -------------------------------------------------
    # DOCUMENT TYPE
    # -------------------------------------------------
    # water_card / invoice
    document_type = Column(
        String(50),
        nullable=False
    )

    # -------------------------------------------------
    # DATE TRACKING
    # -------------------------------------------------
    year = Column(Integer, nullable=False)

    # 1-12
    month = Column(Integer, nullable=False)

    # only for water cards
    week_number = Column(Integer, nullable=True)

    # -------------------------------------------------
    # FILE
    # -------------------------------------------------
    file_url = Column(String, nullable=False)

    remarks = Column(Text, nullable=True)

    # uploaded / approved / rejected
    status = Column(String(20), default="uploaded")

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )

    # -------------------------------------------------
    # RELATIONSHIPS
    # -------------------------------------------------
    store = relationship(
        "Store",
        back_populates="compliance_documents"
    )

    uploader = relationship(
        "User"
    )

    # -------------------------------------------------
    # DEBUG
    # -------------------------------------------------
    def __repr__(self):
        return (
            f"<ComplianceDoc("
            f"store_id={self.store_id}, "
            f"type={self.document_type}, "
            f"month={self.month}, "
            f"week={self.week_number}"
            f")>"
        )