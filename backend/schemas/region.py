from pydantic import BaseModel

# Schema for creating a region
class RegionCreate(BaseModel):
    name: str

# Schema for returning a region (with ID)
class RegionOut(BaseModel):
    id: int
    name: str

    class Config:
        orm_mode = True
