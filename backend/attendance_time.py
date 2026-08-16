"""Timezone rules for attendance and leave calendar calculations."""

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
UTC = timezone.utc


def utc_now() -> datetime:
    return datetime.now(UTC)


def ist_now() -> datetime:
    return utc_now().astimezone(IST)


def ist_today() -> date:
    return ist_now().date()


def as_utc(value: datetime | None) -> datetime | None:
    """Normalize DB timestamps; legacy naive attendance values represent UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def as_ist(value: datetime | None) -> datetime | None:
    normalized = as_utc(value)
    return normalized.astimezone(IST) if normalized else None
