from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..database.db import get_db
from ..models.employee_store_mapping import EmployeeStoreMapping
from ..models.store import Store
from ..models.user import RoleEnum, User
from ..schemas.employee_store_assignment import (
    EmployeeAssignedStoreOut,
    EmployeeStoreAssignRequest,
    EmployeeStoreBulkAssignOut,
    EmployeeStoreBulkAssignRequest,
    EmployeeStoreMappingOut,
)
from ..utils.jwt import get_current_user


router = APIRouter(prefix="/employee-store-assignments", tags=["Employee Store Assignments"])


def superadmin_required(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a superadmin can manage employee store assignments.",
        )
    return current_user


def get_employee_or_404(employee_id: int, db: Session) -> User:
    employee = (
        db.query(User)
        .filter(
            User.id == employee_id,
            User.is_deleted.is_(False),
        )
        .first()
    )
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found.",
        )

    if employee.role != RoleEnum.employee:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected user must have employee role.",
        )

    return employee


def get_store_or_404(store_id: str, db: Session) -> Store:
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found.",
        )
    return store


def ensure_mapping_does_not_exist(employee_id: int, store_id: str, db: Session) -> None:
    existing = (
        db.query(EmployeeStoreMapping)
        .filter(
            EmployeeStoreMapping.employee_id == employee_id,
            EmployeeStoreMapping.store_id == store_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Store is already assigned to this employee.",
        )


@router.post("/", response_model=EmployeeStoreMappingOut, status_code=status.HTTP_201_CREATED)
def assign_store_to_employee(
    payload: EmployeeStoreAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(superadmin_required),
):
    get_employee_or_404(payload.employee_id, db)
    get_store_or_404(payload.store_id, db)
    ensure_mapping_does_not_exist(payload.employee_id, payload.store_id, db)

    mapping = EmployeeStoreMapping(
        employee_id=payload.employee_id,
        store_id=payload.store_id,
        assigned_by=current_user.id,
    )

    db.add(mapping)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Store is already assigned to this employee.",
        )

    db.refresh(mapping)
    return mapping


@router.post("/bulk", response_model=EmployeeStoreBulkAssignOut, status_code=status.HTTP_201_CREATED)
def assign_stores_to_employee(
    payload: EmployeeStoreBulkAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(superadmin_required),
):
    get_employee_or_404(payload.employee_id, db)

    unique_store_ids = list(dict.fromkeys(payload.store_ids))
    if len(unique_store_ids) != len(payload.store_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Duplicate store IDs are not allowed in the request.",
        )

    stores = db.query(Store.id).filter(Store.id.in_(unique_store_ids)).all()
    found_store_ids = {store.id for store in stores}
    missing_store_ids = [store_id for store_id in unique_store_ids if store_id not in found_store_ids]
    if missing_store_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"message": "One or more stores were not found.", "store_ids": missing_store_ids},
        )

    existing = (
        db.query(EmployeeStoreMapping.store_id)
        .filter(
            EmployeeStoreMapping.employee_id == payload.employee_id,
            EmployeeStoreMapping.store_id.in_(unique_store_ids),
        )
        .all()
    )
    existing_store_ids = [row.store_id for row in existing]
    if existing_store_ids:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "One or more stores are already assigned to this employee.",
                "store_ids": existing_store_ids,
            },
        )

    mappings = [
        EmployeeStoreMapping(
            employee_id=payload.employee_id,
            store_id=store_id,
            assigned_by=current_user.id,
        )
        for store_id in unique_store_ids
    ]

    db.add_all(mappings)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="One or more stores are already assigned to this employee.",
        )

    for mapping in mappings:
        db.refresh(mapping)

    return {"employee_id": payload.employee_id, "assigned": mappings}


@router.get("/", response_model=List[EmployeeStoreMappingOut])
def list_employee_store_assignments(
    employee_id: Optional[int] = None,
    store_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(superadmin_required),
):
    query = (
        db.query(EmployeeStoreMapping)
        .join(User, EmployeeStoreMapping.employee_id == User.id)
        .filter(User.is_deleted.is_(False))
        .order_by(EmployeeStoreMapping.created_at.desc())
    )

    if employee_id is not None:
        query = query.filter(EmployeeStoreMapping.employee_id == employee_id)

    if store_id is not None:
        query = query.filter(EmployeeStoreMapping.store_id == store_id)

    return query.all()


@router.get("/employees/{employee_id}/stores", response_model=List[EmployeeAssignedStoreOut])
def list_employee_stores(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(superadmin_required),
):
    get_employee_or_404(employee_id, db)

    mappings = (
        db.query(EmployeeStoreMapping)
        .options(joinedload(EmployeeStoreMapping.store))
        .filter(EmployeeStoreMapping.employee_id == employee_id)
        .order_by(EmployeeStoreMapping.created_at.desc())
        .all()
    )

    return [
        EmployeeAssignedStoreOut(
            mapping_id=mapping.id,
            store_id=mapping.store_id,
            store_name=mapping.store.store_name,
            city=mapping.store.city,
            state=mapping.store.state,
            channel=mapping.store.channel,
            assigned_by=mapping.assigned_by,
            created_at=mapping.created_at,
        )
        for mapping in mappings
    ]


@router.delete("/mappings/{mapping_id}", status_code=status.HTTP_200_OK)
def remove_employee_store_assignment(
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(superadmin_required),
):
    mapping = db.query(EmployeeStoreMapping).filter(EmployeeStoreMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee store assignment not found.",
        )

    db.delete(mapping)
    db.commit()

    return {"message": "Employee store assignment removed successfully."}


@router.delete("/employees/{employee_id}/stores/{store_id}", status_code=status.HTTP_200_OK)
def remove_store_from_employee(
    employee_id: int,
    store_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(superadmin_required),
):
    get_employee_or_404(employee_id, db)

    mapping = (
        db.query(EmployeeStoreMapping)
        .filter(
            EmployeeStoreMapping.employee_id == employee_id,
            EmployeeStoreMapping.store_id == store_id,
        )
        .first()
    )
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee store assignment not found.",
        )

    db.delete(mapping)
    db.commit()

    return {"message": "Store removed from employee successfully."}
