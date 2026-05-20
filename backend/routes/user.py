# Keep these imports at the top
from fastapi import APIRouter, Depends, HTTPException, status, Form, File, UploadFile
from sqlalchemy.orm import Session
from typing import Annotated , Optional# Or Optional if using older FastAPI


# ... other imports ...
from ..schemas.user import UserOut, RoleEnum as SchemaRoleEnum # Keep UserOut, remove UserCreate if not used elsewhere
from ..models.user import User, RoleEnum as ModelRoleEnum
from ..models.otp import OTP as OtpModel
from ..database.db import get_db
from ..utils.auth import hash_password
from ..utils.auth import get_current_user
import shutil # Example for saving files locally
import os     # Example for saving files locally
from datetime import datetime # Add this line
from pydantic import BaseModel, EmailStr



class EmployeeCreateRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    mobile_number: str

router = APIRouter()

# Define upload directory (adjust as needed)
UPLOAD_DIRECTORY = "./uploads"
os.makedirs(UPLOAD_DIRECTORY, exist_ok=True) # Create dir if it doesn't exist

@router.post("/signup") # Removed response_model=UserOut temporarily for debugging, add back later
async def create_user(
    # Define parameters using Form() and File()
    full_name: Annotated[str, Form()],
    email: Annotated[str, Form()],
    mobile_number: Annotated[str, Form()],
    password: Annotated[str, Form()],
    confirm_password: Annotated[str, Form()],
    role: Annotated[SchemaRoleEnum, Form()], # Use the schema enum here for validation
    status: Annotated[str, Form()] = "pending", # Default if needed, or pass from frontend
    region_id: Annotated[int, Form()] = 0, # Default if needed, or pass from frontend
    govt_id: Annotated[Optional[str], Form()] = None,
    id_type: Annotated[Optional[str], Form()] = None,
    current_address: Annotated[Optional[str], Form()] = None,
    state: Annotated[Optional[str], Form()] = None,
    city: Annotated[Optional[str], Form()] = None,
    vehicle_number: Annotated[Optional[str], Form()] = None,
    driving_license_number: Annotated[Optional[str], Form()] = None,
    govt_id_photo: Annotated[Optional[UploadFile], File()] = None,
    delivery_photo: Annotated[Optional[UploadFile], File()] = None,
    db: Session = Depends(get_db)
):
    """
    Handles user signup after a verified OTP is provided, accepting form data.
    """
    # 1. Check for a verified OTP
    otp_record = db.query(OtpModel).filter(
        OtpModel.email == email,
        OtpModel.verified == True,
        OtpModel.is_for_signup == True
    ).first()

    if not otp_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email has not been verified with an OTP for signup."
        )

    # 2. Check if user exists
    if db.query(User).filter(User.email == email).first():
        db.delete(otp_record)
        db.commit()
        raise HTTPException(status_code=400, detail="Email already registered")

    # 3. Validate password match
    if password != confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    # --- File Handling Example (Save locally) ---
    govt_id_photo_path: Optional[str] = None
    delivery_photo_path: Optional[str] = None

    try:
        if govt_id_photo and govt_id_photo.filename:
            # Sanitize filename (basic example)
            filename = f"govt_id_{datetime.now().timestamp()}_{govt_id_photo.filename.replace(' ', '_')}"
            file_path = os.path.join(UPLOAD_DIRECTORY, filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(govt_id_photo.file, buffer)
            govt_id_photo_path = file_path # Store path to save in DB
            print(f"Saved govt_id_photo to: {govt_id_photo_path}") # Debug log

        if delivery_photo and delivery_photo.filename:
            # Sanitize filename
            filename = f"delivery_{datetime.now().timestamp()}_{delivery_photo.filename.replace(' ', '_')}"
            file_path = os.path.join(UPLOAD_DIRECTORY, filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(delivery_photo.file, buffer)
            delivery_photo_path = file_path # Store path to save in DB
            print(f"Saved delivery_photo to: {delivery_photo_path}") # Debug log

    except Exception as e:
        print(f"Error saving files: {e}") # Log file saving error
        raise HTTPException(status_code=500, detail=f"Could not save uploaded file: {e}")
    finally:
        # Close file handles if they were opened
        if govt_id_photo:
            await govt_id_photo.close()
        if delivery_photo:
            await delivery_photo.close()
    # --- End File Handling Example ---


    # 4. Hash password and create the new user
    hashed_pw = hash_password(password)

    # Use ModelRoleEnum for database model
    db_role = ModelRoleEnum(role.value)

    new_user = User(
        email=email,
        password=hashed_pw,
        full_name=full_name,
        mobile_number=mobile_number,
        role=db_role,
        status=status,
        region_id=region_id,
        # Only assign delivery-specific fields if the role is delivery
        govt_id=govt_id if role == SchemaRoleEnum.delivery else None,
        id_type=id_type if role == SchemaRoleEnum.delivery else None,
        current_address=current_address if role == SchemaRoleEnum.delivery else None,
        state=state if role == SchemaRoleEnum.delivery else None,
        city=city if role == SchemaRoleEnum.delivery else None,
        vehicle_number=vehicle_number if role == SchemaRoleEnum.delivery else None,
        driving_license_number=driving_license_number if role == SchemaRoleEnum.delivery else None,
        # Save the *path* or identifier of the saved photo, not the UploadFile object
        govt_id_photo=govt_id_photo_path if role == SchemaRoleEnum.delivery else None,
        delivery_photo=delivery_photo_path if role == SchemaRoleEnum.delivery else None
    )

    db.add(new_user)

    # 5. Delete the used OTP record
    db.delete(otp_record)

    try:
        db.commit()
        db.refresh(new_user)
        # Manually create the output dictionary if response_model is removed
        return {
            "id": new_user.id,
            "email": new_user.email,
            "full_name": new_user.full_name,
            "mobile_number": new_user.mobile_number,
            "role": new_user.role.value,
            "status": new_user.status,
            "created_at": new_user.created_at,
             # Include other fields from UserOut as needed
            "govt_id": new_user.govt_id,
            "id_type": new_user.id_type,
            "current_address": new_user.current_address,
            "state": new_user.state,
            "city": new_user.city,
            "vehicle_number": new_user.vehicle_number,
            "driving_license_number": new_user.driving_license_number,
            "govt_id_photo": new_user.govt_id_photo,
            "delivery_photo": new_user.delivery_photo,
        }
    except Exception as e:
        db.rollback()
        print(f"Database commit error: {e}") # Log DB error
        raise HTTPException(status_code=500, detail=f"Error saving user to database: {e}")

# Keep other routes (/login, /me, /users) as they are

@router.post("/superadmin/create-employee")
def create_employee(
    request: EmployeeCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 🔒 Only superadmin
    if current_user.role != ModelRoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only superadmin allowed")

    # 🔁 Duplicate check
    existing = db.query(User).filter(User.email == request.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # 🔐 Hash password
    hashed_pwd = hash_password(request.password)

    # 👤 Create employee
    new_employee = User(
        full_name=request.full_name,
        email=request.email,
        password=hashed_pwd,
        mobile_number=request.mobile_number,
        role=ModelRoleEnum.employee,   # ✅ IMPORTANT
        status="active",
        parent_id=current_user.id
    )

    db.add(new_employee)
    db.commit()
    db.refresh(new_employee)

    return {
        "message": "Employee created successfully",
        "user_id": new_employee.id
    }