from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, TEXT
from sqlalchemy.orm import relationship
from datetime import datetime
from ..database.db import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)

    # Bottle reference: Changed to TEXT to match bottles.uuid
    bottle_uuid = Column(TEXT, ForeignKey("bottles.uuid"), nullable=False)
    
    # Delivery boy (if applicable)
    delivery_boy_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Movement type
    transaction_type = Column(String, nullable=False)

    # Flexible source/destination tracking (no 'type' columns as per schema)
    from_location_id = Column(Integer, nullable=True)
    to_location_id = Column(Integer, nullable=True)

    # When movement happened
    timestamp = Column(DateTime, default=datetime.utcnow)

    # Relationships
    bottle = relationship("Bottle", back_populates="transactions", foreign_keys=[bottle_uuid])
    delivery_boy = relationship("User", foreign_keys=[delivery_boy_id])