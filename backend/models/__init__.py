# Import the 'Base' declarative class from the database module.
from ..database.db import Base
import importlib

# IMPORTANT: Include *every* model file here
modules = [
    "store",
    "user",
    "order",
    "region",
    "otp",
    "bottle",
    "transaction",
    "report",
    "complaint",
    "partner_store",
    "permission",
    "employee_permission",
    "employee_store_mapping",
    "store_qr_delivery_submission",
    "monthly_virtual_card",
    "blinkit_report_store_metadata",
]

for module in modules:
    importlib.import_module(f"backend.models.{module}")
from .store_compliance import StoreComplianceDocument
