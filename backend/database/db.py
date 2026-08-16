from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker, Session

from backend.config import settings

DATABASE_URL = settings.DATABASE_URL

if not DATABASE_URL:
    if settings.APP_ENV == "local":
        print("⚠️ DATABASE_URL missing -> Using SQLite")
        DATABASE_URL = "sqlite:///./backend/database/aqua_track.db"
    else:
        raise RuntimeError(
            f"DATABASE_URL is required for {settings.APP_ENV}"
        )

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgres://",
        "postgresql://",
        1,
    )

print(f"Using Environment : {settings.APP_ENV}")
print(f"Using Database    : {DATABASE_URL.split('@')[-1]}")

connect_args = {}

if DATABASE_URL.startswith("sqlite"):
    connect_args = {
        "check_same_thread": False
    }

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()