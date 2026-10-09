import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
VALID_APP_ENVS = {"local", "stage", "production"}


def _get_app_env() -> str:
    app_env = os.getenv("APP_ENV", "local").strip().lower()

    if app_env not in VALID_APP_ENVS:
        valid_envs = ", ".join(sorted(VALID_APP_ENVS))
        raise ValueError(
            f"Invalid APP_ENV '{app_env}'. Expected one of: {valid_envs}."
        )

    return app_env


def _load_env_file(app_env: str) -> None:
    env_file = BASE_DIR / f".env.{app_env}"
    load_dotenv(env_file, override=False)


def _normalize_database_url(database_url: Optional[str]) -> Optional[str]:
    if not database_url:
        return database_url

    # Legacy PostgreSQL scheme used by some providers.
    if database_url.startswith("postgres://"):
        database_url = database_url.replace(
            "postgres://",
            "postgresql://",
            1,
        )

    # Production currently ships psycopg2-binary, not psycopg v3.
    # Normalize an explicit psycopg v3 SQLAlchemy URL to psycopg2.
    if database_url.startswith("postgresql+psycopg://"):
        database_url = database_url.replace(
            "postgresql+psycopg://",
            "postgresql+psycopg2://",
            1,
        )

    return database_url


APP_ENV = _get_app_env()
_load_env_file(APP_ENV)


@dataclass(frozen=True)
class Settings:
    APP_ENV: str = APP_ENV

    DATABASE_URL: Optional[str] = _normalize_database_url(
        os.getenv("DATABASE_URL")
    )

    SECRET_KEY: str = os.getenv(
        "SECRET_KEY",
        "YOUR_SECRET_KEY",
    )

    ALGORITHM: str = os.getenv(
        "ALGORITHM",
        "HS256",
    )

    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv(
            "ACCESS_TOKEN_EXPIRE_MINUTES",
            "1440",
        )
    )

    STORE_QR_PUBLIC_BASE_URL: Optional[str] = os.getenv(
        "STORE_QR_PUBLIC_BASE_URL"
    )

    STORE_QR_SUBMISSION_TOKEN_MINUTES: int = int(
        os.getenv(
            "STORE_QR_SUBMISSION_TOKEN_MINUTES",
            "10",
        )
    )

    STORE_QR_PHOTO_MAX_BYTES: int = int(
        os.getenv(
            "STORE_QR_PHOTO_MAX_BYTES",
            str(5 * 1024 * 1024),
        )
    )


settings = Settings()