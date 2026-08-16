from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..database.db import get_db
from ..models.employee_permission import EmployeePermission
from ..models.permission import Permission
from ..models.user import RoleEnum, User
from ..schemas.employee_permission_assignment import (
    EmployeePermissionAssignRequest,
    EmployeePermissionAssignmentOut,
    EmployeePermissionBulkAssignOut,
    EmployeePermissionBulkAssignRequest,
    EmployeePermissionDetailOut,
    EmployeePermissionListOut,
    EmployeePermissionRemoveOut,
)
from ..utils.jwt import get_current_user
from ..utils.permissions import get_employee_permissions


router = APIRouter(prefix="/employees", tags=["Employee Permissions"])


def superadmin_required(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a superadmin can manage employee permissions.",
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


def get_permission_or_404(permission_id: int, db: Session) -> Permission:
    permission = db.query(Permission).filter(Permission.id == permission_id).first()
    if not permission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission not found.",
        )
    return permission


def ensure_assignment_does_not_exist(employee_id: int, permission_id: int, db: Session) -> None:
    existing = (
        db.query(EmployeePermission)
        .filter(
            EmployeePermission.employee_id == employee_id,
            EmployeePermission.permission_id == permission_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Permission is already assigned to this employee.",
        )


@router.post(
    "/{employee_id}/permissions",
    response_model=EmployeePermissionAssignmentOut,
    status_code=status.HTTP_201_CREATED,
)
def assign_permission_to_employee(
    employee_id: int,
    payload: EmployeePermissionAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(superadmin_required),
):
    get_employee_or_404(employee_id, db)
    get_permission_or_404(payload.permission_id, db)
    ensure_assignment_does_not_exist(employee_id, payload.permission_id, db)

    assignment = EmployeePermission(
        employee_id=employee_id,
        permission_id=payload.permission_id,
        assigned_by=current_user.id,
    )

    db.add(assignment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Permission is already assigned to this employee.",
        )

    db.refresh(assignment)
    return assignment


@router.post(
    "/{employee_id}/permissions/bulk",
    response_model=EmployeePermissionBulkAssignOut,
    status_code=status.HTTP_201_CREATED,
)
def assign_permissions_to_employee(
    employee_id: int,
    payload: EmployeePermissionBulkAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(superadmin_required),
):
    get_employee_or_404(employee_id, db)

    unique_permission_ids = list(dict.fromkeys(payload.permission_ids))
    if len(unique_permission_ids) != len(payload.permission_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Duplicate permission IDs are not allowed in the request.",
        )

    permissions = db.query(Permission.id).filter(Permission.id.in_(unique_permission_ids)).all()
    found_permission_ids = {permission.id for permission in permissions}
    missing_permission_ids = [
        permission_id
        for permission_id in unique_permission_ids
        if permission_id not in found_permission_ids
    ]
    if missing_permission_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "message": "One or more permissions were not found.",
                "permission_ids": missing_permission_ids,
            },
        )

    existing = (
        db.query(EmployeePermission.permission_id)
        .filter(
            EmployeePermission.employee_id == employee_id,
            EmployeePermission.permission_id.in_(unique_permission_ids),
        )
        .all()
    )
    existing_permission_ids = [row.permission_id for row in existing]
    if existing_permission_ids:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "One or more permissions are already assigned to this employee.",
                "permission_ids": existing_permission_ids,
            },
        )

    assignments = [
        EmployeePermission(
            employee_id=employee_id,
            permission_id=permission_id,
            assigned_by=current_user.id,
        )
        for permission_id in unique_permission_ids
    ]

    db.add_all(assignments)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="One or more permissions are already assigned to this employee.",
        )

    for assignment in assignments:
        db.refresh(assignment)

    return {"employee_id": employee_id, "assigned": assignments}


@router.get("/{employee_id}/permissions", response_model=EmployeePermissionListOut)
def list_employee_permissions(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(superadmin_required),
):
    get_employee_or_404(employee_id, db)
    permission_keys = get_employee_permissions(employee_id, db=db)

    assignments = (
        db.query(EmployeePermission)
        .options(joinedload(EmployeePermission.permission))
        .filter(EmployeePermission.employee_id == employee_id)
        .order_by(EmployeePermission.created_at.desc())
        .all()
    )

    permissions: List[EmployeePermissionDetailOut] = [
        EmployeePermissionDetailOut(
            assignment_id=assignment.id,
            permission_id=assignment.permission_id,
            permission_key=assignment.permission.permission_key,
            module=assignment.permission.module,
            action=assignment.permission.action,
            display_name=assignment.permission.display_name,
            description=assignment.permission.description,
            assigned_by=assignment.assigned_by,
            created_at=assignment.created_at,
        )
        for assignment in assignments
    ]

    return {
        "employee_id": employee_id,
        "permission_keys": permission_keys,
        "permissions": permissions,
    }


@router.delete(
    "/{employee_id}/permissions/{permission_id}",
    response_model=EmployeePermissionRemoveOut,
    status_code=status.HTTP_200_OK,
)
def remove_permission_from_employee(
    employee_id: int,
    permission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(superadmin_required),
):
    get_employee_or_404(employee_id, db)
    get_permission_or_404(permission_id, db)

    assignment = (
        db.query(EmployeePermission)
        .filter(
            EmployeePermission.employee_id == employee_id,
            EmployeePermission.permission_id == permission_id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee permission assignment not found.",
        )

    db.delete(assignment)
    db.commit()

    return {"message": "Permission removed from employee successfully."}
