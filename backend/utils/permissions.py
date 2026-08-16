from contextlib import contextmanager
from typing import Callable, List, Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Query, Session

from ..database.db import SessionLocal, get_db
from ..models.employee_permission import EmployeePermission
from ..models.employee_store_mapping import EmployeeStoreMapping
from ..models.permission import Permission
from ..models.user import RoleEnum, User
from ..utils.jwt import get_current_user


@contextmanager
def _session_scope(db: Optional[Session] = None):
    if db is not None:
        yield db
        return

    owned_db = SessionLocal()
    try:
        yield owned_db
    finally:
        owned_db.close()


def get_employee_permissions(employee_id: int, db: Optional[Session] = None) -> List[str]:
    with _session_scope(db) as session:
        rows = (
            session.query(Permission.permission_key)
            .join(EmployeePermission, EmployeePermission.permission_id == Permission.id)
            .filter(
                EmployeePermission.employee_id == employee_id,
                Permission.is_active.is_(True),
            )
            .all()
        )

    return [row.permission_key for row in rows]


def has_permission(
    employee_id: int,
    permission_key: str,
    db: Optional[Session] = None,
) -> bool:
    with _session_scope(db) as session:
        exists = (
            session.query(EmployeePermission.id)
            .join(Permission, EmployeePermission.permission_id == Permission.id)
            .filter(
                EmployeePermission.employee_id == employee_id,
                Permission.permission_key == permission_key,
                Permission.is_active.is_(True),
            )
            .first()
        )

    return exists is not None


def require_permission(permission_key: str) -> Callable:
    def dependency(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if current_user.role != RoleEnum.employee:
            return current_user

        try:
            permitted = has_permission(current_user.id, permission_key, db=db)
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Permission service is temporarily unavailable.",
            ) from exc

        if not permitted:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action.",
            )

        return current_user

    return dependency


def get_employee_store_ids(employee_id: int, db: Optional[Session] = None) -> List[str]:
    with _session_scope(db) as session:
        rows = (
            session.query(EmployeeStoreMapping.store_id)
            .filter(EmployeeStoreMapping.employee_id == employee_id)
            .all()
        )

    return [row.store_id for row in rows]


def filter_query_by_employee_stores(query: Query, employee: User) -> Query:
    store_ids = get_employee_store_ids(employee.id, db=query.session)

    entity = None
    if query.column_descriptions:
        entity = query.column_descriptions[0].get("entity")

    if entity is not None and hasattr(entity, "store_id"):
        return query.filter(entity.store_id.in_(store_ids))

    if entity is not None and getattr(entity, "__tablename__", None) == "stores":
        return query.filter(entity.id.in_(store_ids))

    raise ValueError("Query entity must expose store_id or be the Store model.")
