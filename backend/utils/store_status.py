from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.store import Store


def require_active_store(store) -> None:
    if not store.is_active:
        raise HTTPException(status_code=400, detail="Store is inactive.")


def require_active_store_before_commit(db: Session, store_id: str) -> Store:
    store = (
        db.query(Store)
        .filter(Store.id == store_id)
        .populate_existing()
        .with_for_update()
        .one()
    )
    require_active_store(store)
    return store
