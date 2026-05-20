from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, TEXT
from sqlalchemy.orm import relationship
from ..database.db import Base
import uuid  # Import the uuid module
# +++ Import the Store model (adjust path if necessary) +++


class Bottle(Base):
    __tablename__ = "bottles"

    # 'uuid' is now the primary key
    uuid = Column(TEXT, primary_key=True, default=lambda: str(uuid.uuid4()))
    qr_code = Column(TEXT, unique=True, index=True, nullable=True) # Change to nullable
    status = Column(String, nullable=False)
    assigned_to_delivery_id = Column(Integer, ForeignKey("users.id"), nullable=True) # Added ForeignKey
    assigned_to_store_id = Column(String, ForeignKey("stores.id"), nullable=True)
    cycle_count = Column(Integer, nullable=False, default=0)
    last_collected_at = Column(DateTime, nullable=True)
    current_order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)


    # Relationship to Transactions
    transactions = relationship(
        "Transaction",
        back_populates="bottle",
        cascade="all, delete-orphan",
        order_by="Transaction.timestamp.desc()"
    )

    # +++ Add relationship to Store +++
    # Assumes Store model has `bottles_at_store = relationship("Bottle", back_populates="store")`
    store = relationship("Store", back_populates="bottles_at_store")
    # +++ End relationship to Store +++

    # +++ Optional: Add relationship to User (Delivery Partner) +++
    # Assumes User model has `assigned_bottles = relationship("Bottle", foreign_keys=[Bottle.assigned_to_delivery_id], back_populates="delivery_partner")`
    delivery_partner = relationship("User", foreign_keys=[assigned_to_delivery_id], back_populates="assigned_bottles")
    order = relationship("Order", back_populates="bottles_in_order", foreign_keys=[current_order_id])

    # +++ End relationship to User +++