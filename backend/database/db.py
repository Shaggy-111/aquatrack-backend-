import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

# -----------------------------
# 🔥 LOAD ENV (important for local scripts)
# -----------------------------
try:
    from dotenv import load_dotenv
    load_dotenv()
except:
    pass

# -----------------------------
# 🔥 GET DATABASE URL
# -----------------------------
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# Fix postgres:// → postgresql://
if SQLALCHEMY_DATABASE_URL and SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# -----------------------------
# ⚠️ SAFETY LOG (important debug)
# -----------------------------
if SQLALCHEMY_DATABASE_URL:
    print(f"✅ Using DB: {SQLALCHEMY_DATABASE_URL.split('@')[-1]}")
else:
    print("⚠️ No DATABASE_URL found → Using SQLite")

# -----------------------------
# 🔥 FALLBACK (local only)
# -----------------------------
if not SQLALCHEMY_DATABASE_URL:
    SQLALCHEMY_DATABASE_URL = "sqlite:///./backend/database/aqua_track.db"

# -----------------------------
# 🔧 CONNECTION CONFIG
# -----------------------------
connect_args = {}

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

# -----------------------------
# 🚀 ENGINE
# -----------------------------
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True  # 🔥 avoid stale connections
)

# -----------------------------
# SESSION
# -----------------------------
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

Base = declarative_base()

# -----------------------------
# DEPENDENCY
# -----------------------------
def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()