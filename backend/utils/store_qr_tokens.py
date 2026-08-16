import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from ..config import settings


STORE_QR_PURPOSE = "store_delivery_qr"
STORE_QR_SUBMISSION_PURPOSE = "store_delivery_submission"


class StoreQrTokenError(ValueError):
    pass


def _signing_key() -> str:
    if settings.APP_ENV == "production" and settings.SECRET_KEY == "YOUR_SECRET_KEY":
        raise RuntimeError("SECRET_KEY must be configured for Store QR tokens.")
    material = f"{settings.SECRET_KEY}:aquatrack:store-qr:v1"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def create_store_qr_token(qr_public_id: str, version: int) -> str:
    return jwt.encode(
        {
            "purpose": STORE_QR_PURPOSE,
            "qid": qr_public_id,
            "ver": version,
        },
        _signing_key(),
        algorithm=settings.ALGORITHM,
    )


def decode_store_qr_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            _signing_key(),
            algorithms=[settings.ALGORITHM],
            options={"verify_exp": False},
        )
    except JWTError as exc:
        raise StoreQrTokenError("Invalid Store QR.") from exc

    if (
        payload.get("purpose") != STORE_QR_PURPOSE
        or not payload.get("qid")
        or not isinstance(payload.get("ver"), int)
    ):
        raise StoreQrTokenError("Invalid Store QR.")
    return payload


def create_submission_token(
    qr_public_id: str,
    version: int,
) -> tuple[str, str, str]:
    idempotency_key = str(uuid.uuid4())
    token_jti = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.STORE_QR_SUBMISSION_TOKEN_MINUTES
    )
    token = jwt.encode(
        {
            "purpose": STORE_QR_SUBMISSION_PURPOSE,
            "qid": qr_public_id,
            "ver": version,
            "idem": idempotency_key,
            "jti": token_jti,
            "exp": expires_at,
        },
        _signing_key(),
        algorithm=settings.ALGORITHM,
    )
    return token, idempotency_key, token_jti


def decode_submission_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            _signing_key(),
            algorithms=[settings.ALGORITHM],
        )
    except JWTError as exc:
        raise StoreQrTokenError("Invalid or expired submission token.") from exc

    if (
        payload.get("purpose") != STORE_QR_SUBMISSION_PURPOSE
        or not payload.get("qid")
        or not isinstance(payload.get("ver"), int)
        or not payload.get("idem")
        or not payload.get("jti")
    ):
        raise StoreQrTokenError("Invalid or expired submission token.")
    return payload
