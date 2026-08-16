import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# ---------------------------------------
# Environment Selection
# ---------------------------------------

APP_ENV = os.getenv("APP_ENV", "local").lower()

ENV_FILES = {
    "local": ".env.local",
    "stage": ".env.stage",
    "production": ".env.production",
}

env_file = ENV_FILES.get(APP_ENV, ".env.local")

# Fly Secrets always win because override=False
load_dotenv(env_file, override=False)


class Settings(BaseSettings):
    APP_ENV: str = APP_ENV

    DATABASE_URL: str | None = None

    SECRET_KEY: str

    ALGORITHM: str = "HS256"

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    class Config:
        extra = "ignore"


settings = Settings()