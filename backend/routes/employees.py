from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import (
    MetaData,
    Table,
    delete as sqlalchemy_delete,
    func,
    inspect as sqlalchemy_inspect,
    select,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database.db import get_db

from ..models.user import User, RoleEnum
from ..schemas.user import (
    EmployeeCreateRequest,
    EmployeeUpdateRequest,
    EmployeeStatusRequest,
    EmployeeListItem,
)

from ..utils.auth import hash_password
from ..utils.jwt import get_current_user


router = APIRouter(
    prefix="/employees",
    tags=["Employees"]
)


def _active_employee_query(db: Session):
    return db.query(User).filter(
        User.role == RoleEnum.employee,
        User.is_deleted.is_(False),
    )


def _employee_reference_counts(db: Session, employee_id: int) -> dict[str, int]:
    bind = db.get_bind()
    inspector = sqlalchemy_inspect(bind)
    schema = inspector.default_schema_name
    metadata = MetaData()
    reflected_tables: dict[str, Table] = {}
    references: dict[str, int] = {}
    checked_columns: set[tuple[str, str]] = set()

    for table_name in inspector.get_table_names(schema=schema):
        for foreign_key in inspector.get_foreign_keys(table_name, schema=schema):
            if foreign_key.get("referred_table") != User.__tablename__:
                continue

            constrained_columns = foreign_key.get("constrained_columns") or []
            referred_columns = foreign_key.get("referred_columns") or []
            for constrained_column, referred_column in zip(
                constrained_columns,
                referred_columns,
            ):
                if referred_column != "id":
                    continue

                reference_key = (table_name, constrained_column)
                if reference_key in checked_columns:
                    continue
                checked_columns.add(reference_key)

                table = reflected_tables.get(table_name)
                if table is None:
                    table = Table(
                        table_name,
                        metadata,
                        schema=schema,
                        autoload_with=bind,
                    )
                    reflected_tables[table_name] = table

                count = db.execute(
                    select(func.count())
                    .select_from(table)
                    .where(table.c[constrained_column] == employee_id)
                ).scalar_one()
                if count:
                    references[f"{table_name}.{constrained_column}"] = count

    return references


def super_admin_required(
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can perform this action."
        )

    return current_user

@router.post("/create")
def create_employee(
    request: EmployeeCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):

    existing = (
        db.query(User)
        .filter(User.email == request.email)
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Email already registered."
        )

    employee = User(

        full_name=request.full_name,

        email=request.email.lower(),

        mobile_number=request.mobile_number,

        password=hash_password(request.password),

        role=RoleEnum.employee,

        status="active",

        parent_id=current_user.id

    )

    db.add(employee)

    try:

        db.commit()

        db.refresh(employee)

    except Exception:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Unable to create employee."
        )

    return {

        "message": "Employee created successfully.",

        "employee_id": employee.id

    }


@router.get(
    "/list",
    response_model=list[EmployeeListItem]
)
def get_all_employees(

    db: Session = Depends(get_db),

    current_user: User = Depends(super_admin_required)

):

    employees = (

        _active_employee_query(db)

        .order_by(User.created_at.desc())

        .all()

    )

    return employees

@router.get(
    "/{employee_id}",
    response_model=EmployeeListItem
)
def get_employee_details(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):

    employee = (
        _active_employee_query(db)
        .filter(User.id == employee_id)
        .first()
    )

    if not employee:
        raise HTTPException(
            status_code=404,
            detail="Employee not found."
        )

    return employee

@router.put("/{employee_id}")
def update_employee(
    employee_id: int,
    request: EmployeeUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):

    employee = (
        _active_employee_query(db)
        .filter(User.id == employee_id)
        .first()
    )

    if not employee:
        raise HTTPException(
            status_code=404,
            detail="Employee not found."
        )

    if request.email:

        existing = (
            db.query(User)
            .filter(
                User.email == request.email.lower(),
                User.id != employee_id
            )
            .first()
        )

        if existing:
            raise HTTPException(
                status_code=400,
                detail="Email already exists."
            )

        employee.email = request.email.lower()

    if request.full_name is not None:
        employee.full_name = request.full_name

    if request.mobile_number is not None:
        employee.mobile_number = request.mobile_number

    db.commit()
    db.refresh(employee)

    return {
        "message": "Employee updated successfully."
    }

@router.patch("/{employee_id}/status")
def update_employee_status(
    employee_id: int,
    request: EmployeeStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):

    employee = (
        _active_employee_query(db)
        .filter(User.id == employee_id)
        .first()
    )

    if not employee:
        raise HTTPException(
            status_code=404,
            detail="Employee not found."
        )

    if request.status not in ["active", "inactive"]:
        raise HTTPException(
            status_code=400,
            detail="Status must be active or inactive."
        )

    employee.status = request.status

    db.commit()

    return {
        "message": f"Employee {request.status} successfully."
    }

@router.delete("/{employee_id}/permanent")
def permanently_delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):
    employee = (
        db.query(User)
        .filter(
            User.id == employee_id,
            User.role == RoleEnum.employee
        )
        .first()
    )

    if not employee:
        raise HTTPException(
            status_code=404,
            detail="Employee not found."
        )

    references = _employee_reference_counts(db, employee_id)
    if references:
        reference_summary = ", ".join(
            f"{reference} ({count})"
            for reference, count in sorted(references.items())
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Employee cannot be permanently deleted because related "
                f"records exist: {reference_summary}."
            ),
        )

    try:
        db.execute(
            sqlalchemy_delete(User).where(User.id == employee.id)
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Employee cannot be permanently deleted because related "
                "records exist."
            ),
        )

    return {
        "message": "Employee permanently deleted successfully."
    }


@router.delete("/{employee_id}")
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(super_admin_required)
):

    employee = (
        _active_employee_query(db)
        .filter(User.id == employee_id)
        .first()
    )

    if not employee:
        raise HTTPException(
            status_code=404,
            detail="Employee not found."
        )

    employee.status = "inactive"
    employee.is_deleted = True
    employee.deleted_at = datetime.utcnow()
    employee.deleted_by = current_user.id

    db.commit()

    return {
        "message": "Employee deleted successfully."
    }

