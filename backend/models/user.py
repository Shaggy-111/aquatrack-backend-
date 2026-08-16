from ..database.db import Base
from sqlalchemy import Boolean, Column, Integer, String, ForeignKey, Enum, Text, DateTime
from sqlalchemy.orm import relationship, backref
from enum import Enum as PyEnum
from datetime import datetime
from .partner_store import PartnerStore
from .bottle import Bottle

class RoleEnum(PyEnum):
    superadmin = "superadmin"
    admin = "admin"
    vendor = "vendor"
    delivery = "delivery"
    customer = "customer"
    partner = "partner"
    sub_partner = "sub_partner"
    channel_admin = "channel_admin" 
    delivery_manager = "delivery_manager" 
    employee = "employee"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    mobile_number = Column(String, nullable=True)

    govt_id = Column(String, nullable=True)
    id_type = Column(String, nullable=True)
    current_address = Column(Text, nullable=True)
    state = Column(String, nullable=True)
    city = Column(String, nullable=True)
    vehicle_number = Column(String, nullable=True)
    driving_license_number = Column(String, nullable=True)
    delivery_photo = Column(String, nullable=True)
    govt_id_photo = Column(String, nullable=True)

    role = Column(Enum(RoleEnum), nullable=False, default=RoleEnum.customer)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=True)
    status = Column(String, default="pending", nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    parent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    assigned_manager_id = Column(Integer, ForeignKey("users.id"), nullable=True) 


    # ⭐ NEW FIELD ADDED HERE ⭐
    channel = Column(String, nullable=True)   # BLINKIT / ZEPTO / IBM / GENERAL

    # --------------------------------------------
    # Relationships
    # --------------------------------------------
    region = relationship("Region", backref="users")
    reports = relationship("Report", back_populates="uploaded_by")
    
    orders_placed = relationship(
        "Order", 
        back_populates="partner", 
        foreign_keys="[Order.partner_id]"
    )
    
    orders_delivered = relationship(
        "Order", 
        back_populates="delivery_person", 
        foreign_keys="[Order.delivery_person_id]"
    )
    
    stores = relationship(
        "Store",
        secondary="partner_stores",
        back_populates="partners"
    )
    
    children = relationship(
        "User", 
        backref=backref("parent", remote_side="User.id"),
        primaryjoin="User.parent_id == User.id",
        foreign_keys="[User.parent_id]",
    )

    managed_delivery_partners = relationship(
        "User",
        # We link the User's ID (the Manager) to the User's assigned_manager_id (the DP)
        primaryjoin="User.id == User.assigned_manager_id",
        foreign_keys="[User.assigned_manager_id]",
        backref=backref("delivery_manager_ref", remote_side=[id])
    )

    # Complaints created by user
    complaints_created = relationship(
        "Complaint",
        foreign_keys="[Complaint.created_by_id]",
        back_populates="created_by"
    )

    # Assigned as SuperAdmin/Admin
    complaints_assigned_as_admin = relationship(
        "Complaint",
        foreign_keys="[Complaint.assigned_to_admin_id]",
        back_populates="assigned_admin"
    )

    # Assigned as Channel Admin
    complaints_assigned_as_channel_admin = relationship(
        "Complaint",
        foreign_keys="[Complaint.assigned_to_channel_admin_id]",
        back_populates="assigned_channel_admin"
    )

    employee_permissions = relationship(
        "EmployeePermission",
        foreign_keys="EmployeePermission.employee_id",
        cascade="all, delete-orphan",
    )

    employee_store_mappings = relationship(
        "EmployeeStoreMapping",
        foreign_keys="EmployeeStoreMapping.employee_id",
        cascade="all, delete-orphan",
    )

    store_associations = relationship("PartnerStore", back_populates="user")
    assigned_bottles = relationship("Bottle", foreign_keys="[Bottle.assigned_to_delivery_id]", back_populates="delivery_partner")

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "full_name": self.full_name,
            "mobile_number": self.mobile_number,
            "role": self.role.value if self.role else None,
            "status": self.status,
            "region_id": self.region_id,
            "parent_id": self.parent_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "govt_id": self.govt_id,
            "id_type": self.id_type,
            "current_address": self.current_address,
            "state": self.state,
            "city": self.city,
            "assigned_manager_id": self.assigned_manager_id,
            "vehicle_number": self.vehicle_number,
            "driving_license_number": self.driving_license_number,
            "delivery_photo": self.delivery_photo,
            "govt_id_photo": self.govt_id_photo,

            # ⭐ Add channel to response (optional) ⭐
            "channel": self.channel
        }
