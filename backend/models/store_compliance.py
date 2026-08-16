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
    document_type = Column(
        String(50),
        nullable=False
    )

    # -------------------------------------------------
    # DATE TRACKING
    # -------------------------------------------------
    year = Column(
        Integer,
        nullable=False
    )

    month = Column(
        Integer,
        nullable=False
    )

    week_number = Column(
        Integer,
        nullable=True
    )

    # -------------------------------------------------
    # NEW
    # MULTI PAGE SUPPORT
    # -------------------------------------------------
    page_number = Column(
        Integer,
        nullable=False,
        default=1
    )

    # -------------------------------------------------
    # FILE
    # -------------------------------------------------
    file_url = Column(
        String,
        nullable=False
    )

    remarks = Column(
        Text,
        nullable=True
    )

    status = Column(
        String(20),
        default="uploaded"
    )

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
            f"week={self.week_number}, "
            f"page={self.page_number}"
            f")>"
        )