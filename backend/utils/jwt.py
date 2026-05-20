from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database.db import get_db
from ..models.user import User as UserModel, RoleEnum

# Load your secret key and algorithm from environment variables
# You might need to add these to your .env file
SECRET_KEY = "YOUR_SECRET_KEY"  # Replace with your actual secret key
ALGORITHM = "HS256"

# This is a dependency that will be used in your route to get the token
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token") 

# Pydantic model for the token data
class TokenData(BaseModel):
    sub: Optional[str] = None
    role: Optional[RoleEnum] = None

# Function to create a new JWT token
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=30) # Default expiry
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# The missing function that caused the error
async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        # Decode the token using your secret key and algorithm
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        role: str = payload.get("role")
        if email is None:
            raise credentials_exception
        token_data = TokenData(sub=email, role=role)
    except JWTError:
        raise credentials_exception
    
    # Query the database to get the user based on the email from the token
    user = db.query(UserModel).filter(UserModel.email == token_data.sub).first()
    
    if user is None:
        raise credentials_exception
    
    return user