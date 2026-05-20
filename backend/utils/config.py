# File: backend/config.py

from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Your JWT Secret Key for token encoding/decoding
    SECRET_KEY: str

    # The algorithm used for JWT
    ALGORITHM: str = "HS256"

    # The access token lifetime in minutes
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8')

settings = Settings()