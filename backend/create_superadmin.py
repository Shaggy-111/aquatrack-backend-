import sys
import os
from getpass import getpass
from sqlalchemy import create_engine, Column, Integer, String, Enum
from sqlalchemy.orm import sessionmaker, declarative_base, Session
import re
from passlib.context import CryptContext
import uuid
import enum
from datetime import datetime, timezone

# --------------------------------------------------------------------------
# This is an updated standalone utility script. It will check for and
# explicitly delete an old database file to prevent schema mismatch errors.
# --------------------------------------------------------------------------

# Construct an absolute path to the database file.
script_dir = os.path.dirname(os.path.abspath(__file__))
db_dir = os.path.join(script_dir, 'database')
db_path = os.path.join(db_dir, 'aqua_track.db')
SQLALCHEMY_DATABASE_URL = f"sqlite:///{db_path}"

if not SQLALCHEMY_DATABASE_URL:
    print("❌ Error: SQLALCHEMY_DATABASE_URL not found. Aborting.")
    sys.exit(1)

# Database Setupa
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Password Hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

# Role Enum
class RoleEnum(str, enum.Enum):
    superadmin = "superadmin"
    admin = "admin"
    vendor = "vendor"
    delivery = "delivery"
    customer = "customer"
    partner = "partner"

# User Model
class User(Base):
    __tablename__ = "users"
    # Use String for UUID to ensure compatibility with SQLite
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()), unique=True, index=True)
    full_name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    mobile_number = Column(String(20), unique=True, index=True, nullable=True)
    password = Column(String(255), nullable=False)
    role = Column(Enum(RoleEnum), nullable=False)
    status = Column(String(50), nullable=False)
    region_id = Column(Integer, index=True, nullable=True)
    created_at = Column(String(50), nullable=False, default=lambda: str(datetime.now(timezone.utc)))
    govt_id = Column(String(100), nullable=True)
    id_type = Column(String(50), nullable=True)
    current_address = Column(String(255), nullable=True)
    state = Column(String(50), nullable=True)
    city = Column(String(50), nullable=True)
    vehicle_number = Column(String(50), nullable=True)
    driving_license_number = Column(String(50), nullable=True)
    govt_id_photo = Column(String(255), nullable=True)
    delivery_photo = Column(String(255), nullable=True)

# Email validation using a regular expression
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

def create_user():
    """
    This script creates a new user directly in the database based on the selected role.
    """
    print("--- User Creation Utility ---")
    
    # Check for and delete an existing database file to prevent schema errors.
    if os.path.exists(db_path):
        print("\n⚠️ The database file 'aqua_track.db' already exists.")
        print("To prevent schema mismatch errors, it must be deleted.")
        confirm = input("Do you want to delete the existing database and create a new one? (y/n): ")
        if confirm.lower() == 'y':
            try:
                os.remove(db_path)
                print(f"✅ '{db_path}' successfully deleted.")
            except OSError as e:
                print(f"❌ Error deleting database file: {e}")
                print("Please make sure no other applications (like uvicorn) are using the file.")
                sys.exit(1)
        else:
            print("❌ User cancelled. Aborting.")
            sys.exit(1)

    # Ensure the database directory exists before creating the file
    os.makedirs(db_dir, exist_ok=True)
    # This line will only create the table if it doesn't already exist.
    Base.metadata.create_all(bind=engine)
    print(f"✅ Database schema checked/created at '{db_path}'")

    # Get user role
    role_input = input("Enter user role (superadmin, partner, delivery, customer): ").lower()
    if role_input not in ["superadmin", "partner", "delivery", "customer"]:
        print("❌ Error: Invalid role selected. Aborting.")
        sys.exit(1)
    
    role = RoleEnum(role_input)
    
    try:
        email_str = input(f"Enter {role.value} email: ")
        if not EMAIL_REGEX.match(email_str):
            raise ValueError("Invalid email format.")
    except ValueError:
        print("❌ Error: Invalid email format. Aborting.")
        sys.exit(1)

    password = getpass("Enter password: ")
    password_confirm = getpass("Confirm password: ")

    if password != password_confirm:
        print("❌ Error: Passwords do not match. Aborting.")
        sys.exit(1)
    
    if not password or len(password) < 8:
        print("❌ Error: Password must be at least 8 characters long. Aborting.")
        sys.exit(1)

    # Use a session to interact with the database
    db: Session = SessionLocal()
    try:
        # Check if a user with this email already exists
        existing_user = db.query(User).filter(User.email == email_str).first()
        if existing_user:
            print("❌ Error: A user with this email already exists. Aborting.")
            sys.exit(1)
        
        # Hash the password for security
        hashed_password = hash_password(password)
        
        # Collect additional details based on role
        full_name = input("Enter full name: ")
        
        user_details = {
            "email": email_str,
            "password": hashed_password,
            "role": role,
            "full_name": full_name,
            "status": "active"
        }
        
        if role == RoleEnum.delivery:
            user_details["mobile_number"] = input("Enter mobile number: ")
            user_details["govt_id"] = input("Enter government ID: ")
            user_details["id_type"] = input("Enter ID type: ")
            user_details["current_address"] = input("Enter current address: ")
            user_details["state"] = input("Enter state: ")
            user_details["city"] = input("Enter city: ")
            user_details["vehicle_number"] = input("Enter vehicle number: ")
            user_details["driving_license_number"] = input("Enter driving license number: ")

        # Create the new user object
        new_user = User(**user_details)
        
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        
        print(f"✅ {role.value.capitalize()} user '{email_str}' created successfully!")
    except Exception as e:
        db.rollback()
        print(f"❌ An unexpected error occurred: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    create_user()
