from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class MonthlyVirtualCardGenerateRequest(BaseModel):
    year: int
    month: int = Field(ge=1, le=12)


class MonthlyVirtualCardSummary(BaseModel):
    id: int
    store_id: str
    year: int
    month: int
    status: str
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class MonthlyVirtualCardEntrySummary(BaseModel):
    id: int
    entry_date: date
    entry_source: str | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    updated_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    bottles_delivered: int
    empty_bottles_collected: int
    linked_order_ids: list[int]


class MonthlyVirtualCardDetail(MonthlyVirtualCardSummary):
    store_name: str
    entity: str | None = None
    channel: str | None = None
    project_code: str | None = None
    region: str | None = None
    state: str | None = None
    city: str | None = None
    address: str | None = None
    zip_code: str | None = None
    qr_public_id: str
    qr_public_url: str | None = None
    entries: list[MonthlyVirtualCardEntrySummary]


class MonthlyVirtualCardGenerationResult(BaseModel):
    total_active_stores: int
    created_count: int
    existing_count: int
    created_card_ids: list[int]


class MonthlyVirtualCardEntryUpsertRequest(BaseModel):
    bottles_delivered: int = Field(ge=0)
    empty_bottles_collected: int | None = Field(default=0, ge=0)
    remarks: str | None = Field(default=None, max_length=2000)


class MonthlyVirtualCardEntryUpsertResponse(BaseModel):
    card_id: int
    entry_id: int
    entry_date: date
    entry_source: str | None = None
    remarks: str | None = None
    order_id: int
    order_created: bool
    entry_created: bool
    order_status: str
    previous_bottles_delivered: int
    previous_empty_bottles_collected: int
    final_bottles_delivered: int
    final_empty_bottles_collected: int
    store_pending_empty_bottles: int
    linked_order_ids: list[int]
