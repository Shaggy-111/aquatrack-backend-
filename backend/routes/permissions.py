from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database.db import get_db
from ..models.permission import Permission
from ..schemas.permission import PermissionCatalogOut


router = APIRouter(prefix="/permissions", tags=["Permissions"])


class PermissionCatalogItem(BaseModel):
    id: int
    key: str
    name: str
    module: str

    class Config:
        json_schema_extra = {
            "example": {
                "id": 1,
                "key": "orders.view",
                "name": "View Orders",
                "module": "Orders",
            }
        }


@router.get("", response_model=List[PermissionCatalogItem])
def list_permissions(db: Session = Depends(get_db)):
    permissions = (
        db.query(Permission)
        .filter(Permission.is_active.is_(True))
        .order_by(Permission.module, Permission.display_name)
        .all()
    )

    return [
        PermissionCatalogItem(
            id=permission.id,
            key=permission.permission_key,
            name=permission.display_name,
            module=permission.module,
        )
        for permission in permissions
    ]


@router.get("/catalog", response_model=List[PermissionCatalogOut])
def list_permission_catalog(db: Session = Depends(get_db)):
    permissions = (
        db.query(Permission)
        .filter(Permission.is_active.is_(True))
        .order_by(
            Permission.module.asc(),
            Permission.sort_order.asc(),
            Permission.permission_key.asc(),
        )
        .all()
    )

    seen_ids = set()
    seen_keys = set()
    catalog = []
    for permission in permissions:
        if permission.id in seen_ids or permission.permission_key in seen_keys:
            continue
        seen_ids.add(permission.id)
        seen_keys.add(permission.permission_key)
        catalog.append(
            PermissionCatalogOut(
                id=permission.id,
                permission_key=permission.permission_key,
                module=permission.module,
                action=permission.action.replace("_", " ").title(),
                description=permission.description,
                is_active=permission.is_active,
                sort_order=permission.sort_order or 0,
                created_at=permission.created_at,
                updated_at=permission.updated_at,
            )
        )

    return catalog
