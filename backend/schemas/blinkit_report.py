from typing import Any

from pydantic import BaseModel


class BlinkitMonthlyReportOut(BaseModel):
    year: int
    month: int
    days: list[str]
    page: int
    page_size: int
    total: int
    rows: list[dict[str, Any]]


class BlinkitMetadataImportError(BaseModel):
    row: int
    outlet_id: str
    reason: str


class BlinkitMetadataImportOut(BaseModel):
    total_rows: int
    matched_blinkit_outlet_ids: list[str]
    unmatched_outlet_ids: list[str]
    non_blinkit_outlet_ids: list[str]
    duplicate_outlet_ids: list[str]
    rows_to_create: int
    rows_to_update: int
    invalid_rows: int
    created: int
    updated: int
    skipped: int
    errors: list[BlinkitMetadataImportError]
