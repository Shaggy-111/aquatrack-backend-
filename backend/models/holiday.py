from sqlalchemy import Column, Integer, Date, String
from ..database.db import Base


class Holiday(Base):
    __tablename__ = "holidays"

    id = Column(Integer, primary_key=True, index=True)

    date = Column(Date, nullable=False)
    title = Column(String, nullable=False)