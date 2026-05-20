# The `..` tells Python to go up one directory level from 'models'
# to find the 'database' directory.
from ..database.db import Base
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

class Region(Base):
    __tablename__ = "regions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
