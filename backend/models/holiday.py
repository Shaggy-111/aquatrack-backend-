from sqlalchemy import Column, Integer, Date, String, UniqueConstraint
from ..database.db import Base


class Holiday(Base):
    __tablename__ = "holidays"
    __table_args__ = (
        UniqueConstraint("date", name="uq_holidays_date"),
    )

    id = Column(Integer, primary_key=True, index=True)

    date = Column(Date, nullable=False)
    title = Column(String, nullable=False)
