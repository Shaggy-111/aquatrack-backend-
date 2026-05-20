from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

# Corrected relative imports
from ..database.db import get_db
from ..models.region import Region
from ..schemas.region import RegionCreate, RegionOut

router = APIRouter()

# ----- Create a new region -----
@router.post("/", response_model=RegionOut)
def create_region(region: RegionCreate, db: Session = Depends(get_db)):
    """
    Creates a new region if it doesn't already exist.
    """
    # Check if a region with the same name already exists
    existing_region = db.query(Region).filter(Region.name == region.name).first()
    if existing_region:
        raise HTTPException(status_code=400, detail="Region already exists")
    
    # Create the new region and add it to the database
    new_region = Region(name=region.name)
    db.add(new_region)
    db.commit()
    db.refresh(new_region)
    return new_region

# ----- Get all regions -----
@router.get("/", response_model=List[RegionOut])
def get_regions(db: Session = Depends(get_db)):
    """
    Retrieves a list of all regions.
    """
    return db.query(Region).all()
