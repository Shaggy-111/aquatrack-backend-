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
]

for module in modules:
    importlib.import_module(f"backend.models.{module}")

