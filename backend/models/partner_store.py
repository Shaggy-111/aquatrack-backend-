# backend/models/partner_store.py

from sqlalchemy import Column, Integer, ForeignKey
from sqlalchemy.orm import relationship # <--- MAKE SURE THIS IMPORT IS HERE
from ..database.db import Base
from sqlalchemy import Column, Integer, String, ForeignKey

class PartnerStore(Base):
    __tablename__ = "partner_stores"

    user_id = Column(Integer, ForeignKey('users.id'), primary_key=True)
    store_id = Column(String, ForeignKey('stores.id'), primary_key=True)

    # --- THESE TWO LINES ARE MISSING AND CAUSING THE CRASH ---

    # This links back to the 'store_associations' property in the User model
    user = relationship("User", back_populates="store_associations")

    # This links back to the 'partner_associations' property in the Store model
    store = relationship("Store", back_populates="partner_associations")
    # --- END OF FIX ---

    def __repr__(self):
        return f"<PartnerStore(user_id='{self.user_id}', store_id='{self.store_id}')>"