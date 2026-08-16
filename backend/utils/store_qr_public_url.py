DEFAULT_STORE_QR_PUBLIC_BASE_URL = "https://aquatrack-prod-final.fly.dev/qr"


def build_store_qr_public_url(
    token: str,
    configured_base_url: str | None,
) -> str:
    base = (configured_base_url or DEFAULT_STORE_QR_PUBLIC_BASE_URL).rstrip("/")
    if base.startswith("http://"):
        base = f"https://{base.removeprefix('http://')}"
    elif not base.startswith("https://"):
        base = f"https://{base.lstrip('/')}"
    return f"{base}/{token}"
