from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PermissionCatalogOut(BaseModel):
    id: int
    permission_key: str
    module: str
    action: str
    description: Optional[str] = None
    is_active: bool
    sort_order: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class SidebarModuleOut(BaseModel):
    module: str
    permission: str
    icon: str
    tab: str
    route: str
    order: int
    group: str
    description: str
