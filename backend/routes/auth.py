from datetime import timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
# We will STOP using OAuth2PasswordRequestForm as the frontend sends JSON
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr # Added EmailStr for type hinting

# Corrected relative imports
from ..database.db import get_db
# 💡 Assuming your User model is defined here or imported correctly
from ..models.user import User, RoleEnum  # <-- ASSUMING RoleEnum is available here
from ..schemas.token import Token
from ..utils.auth import verify_password, create_access_token, hash_password, get_current_user

# Define the Pydantic model for the JSON login request
class LoginRequest(BaseModel):
    # Frontend sends 'username' as email
    username: EmailStr 
    password: str

# Define the model for the extended response the frontend needs
class UnifiedLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_role: str # The frontend needs this for redirection
    channel_name: Optional[str] = None # For Channel Admin, if applicable

router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

# NOTE: Keeping /register and /me as they are, but removing @router.post("/register")
# since it uses OAuth2PasswordRequestForm and your frontend sends JSON.
# If you use the JSON payload in the frontend for registration, that route needs similar modification.


@router.post("/login", response_model=UnifiedLoginResponse)
async def login(
    login_data: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    Handles unified user login by checking all allowed roles and returning role/channel data.
    """
    user = db.query(User).filter(User.email == login_data.username).first()
    
    # Check 1: User existence and password verification
    # CRITICAL FIX: Changed user.hashed_password to user.password to match User model
    if not user or not verify_password(login_data.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_role_str = user.role.value if user.role else None
    
    # 2. Define ALLOWED ROLES for Dashboard Access
    ALLOWED_DASHBOARD_ROLES = [
        # Roles that access dashboards (Super Admin, Partner, Channel Admin, etc.)
        RoleEnum.superadmin.value, 
        RoleEnum.admin.value,
        RoleEnum.partner.value, 
        RoleEnum.sub_partner.value,
        RoleEnum.channel_admin.value, 
        RoleEnum.vendor.value,
        RoleEnum.employee.value,
       
    ]

    # Check 3: Authorization (Is this user allowed in the dashboard interface?)
    if user_role_str not in ALLOWED_DASHBOARD_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{user_role_str}' is not authorized for dashboard access."
        )

    # 4. Handle Channel Admin specific data
    channel_name = None
    if user_role_str == RoleEnum.channel_admin.value:
        # CRITICAL FIX: Fetch channel name from the correct 'channel' column
        channel_name = user.channel 
        
    # 5. Token Creation: Include the role for internal API checks
    access_token_expires = timedelta(minutes=30)
    access_token = create_access_token(
        data={"sub": user.email, "user_role": user_role_str}, 
        expires_delta=access_token_expires
    )
    
    # 6. Return the data needed by the frontend (AuthScreen.jsx)
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "user_role": user_role_str,
        "channel_name": channel_name
    }
@router.get("/me")
async def read_users_me(current_user: Annotated[User, Depends(get_current_user)]):
    """
    Returns the current authenticated user's information.
    """
    return current_user