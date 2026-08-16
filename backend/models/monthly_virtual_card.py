from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from ..database.db import Base


class MonthlyVirtualCard(Base):
    __tablename__ = "monthly_virtual_cards"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False, index=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="open")
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    store = relationship("Store")
    entries = relationship(
        "MonthlyVirtualCardEntry",
        back_populates="card",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint(
            "store_id",
            "year",
            "month",
            name="uq_monthly_virtual_card_store_year_month",
        ),
        CheckConstraint(
            "month >= 1 AND month <= 12",
            name="ck_monthly_virtual_card_month",
        ),
    )


class MonthlyVirtualCardEntry(Base):
    __tablename__ = "monthly_virtual_card_entries"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(
        Integer,
        ForeignKey("monthly_virtual_cards.id"),
        nullable=False,
        index=True,
    )
    entry_date = Column(Date, nullable=False)
    entry_source = Column(String(30), nullable=True)
    remarks = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    card = relationship("MonthlyVirtualCard", back_populates="entries")
    created_by = relationship("User", foreign_keys=[created_by_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])
    order_links = relationship(
        "MonthlyVirtualCardEntryOrder",
        back_populates="entry",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint(
            "card_id",
            "entry_date",
            name="uq_monthly_virtual_card_entry_date",
        ),
    )


class MonthlyVirtualCardEntryOrder(Base):
    __tablename__ = "monthly_virtual_card_entry_orders"

    id = Column(Integer, primary_key=True, index=True)
    entry_id = Column(
        Integer,
        ForeignKey("monthly_virtual_card_entries.id"),
        nullable=False,
        index=True,
    )
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    linked_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    entry = relationship("MonthlyVirtualCardEntry", back_populates="order_links")
    order = relationship("Order")

    __table_args__ = (
        UniqueConstraint(
            "entry_id",
            "order_id",
            name="uq_monthly_virtual_card_entry_order",
        ),
    )
