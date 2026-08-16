import ast
from collections import Counter
from pathlib import Path
from typing import Dict, Optional, Set

from sqlalchemy.orm import Session

from backend.database.db import SessionLocal
from backend.models.permission import Permission
from backend.routes.employee_menu import SIDEBAR_MODULES
from backend.utils.permission_seeder import (
    FINALIZED_PERMISSION_MATRIX,
    build_permission_rows,
)


GUARD_FUNCTIONS = {
    "employee_permission_required": 0,
    "has_permission": 1,
    "require_permission": 0,
}


def _call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return ""


def collect_route_permission_references(routes_dir: Path) -> Set[str]:
    referenced_keys: Set[str] = set()

    for route_file in sorted(routes_dir.glob("*.py")):
        tree = ast.parse(route_file.read_text(encoding="utf-8"), filename=str(route_file))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue

            argument_index = GUARD_FUNCTIONS.get(_call_name(node))
            if argument_index is None or len(node.args) <= argument_index:
                continue

            argument = node.args[argument_index]
            if isinstance(argument, ast.Constant) and isinstance(argument.value, str):
                referenced_keys.add(argument.value)

    return referenced_keys


def validate_rbac(db: Optional[Session] = None) -> Dict[str, object]:
    backend_dir = Path(__file__).resolve().parents[1]
    permission_rows = build_permission_rows()
    permission_keys = [str(row["permission_key"]) for row in permission_rows]
    sidebar_keys = [item["permission"] for item in SIDEBAR_MODULES]
    sidebar_tabs = [str(item["tab"]) for item in SIDEBAR_MODULES]
    sidebar_routes = [str(item["route"]) for item in SIDEBAR_MODULES]
    sidebar_groups = {str(item["group"]) for item in SIDEBAR_MODULES}
    route_keys = collect_route_permission_references(backend_dir / "routes")

    duplicate_permission_keys = sorted(
        key for key, count in Counter(permission_keys).items() if count > 1
    )
    duplicate_sidebar_permissions = sorted(
        key for key, count in Counter(sidebar_keys).items() if count > 1
    )
    duplicate_sidebar_tabs = sorted(
        tab for tab, count in Counter(sidebar_tabs).items() if count > 1
    )
    duplicate_sidebar_routes = sorted(
        route for route, count in Counter(sidebar_routes).items() if count > 1
    )
    missing_catalog_permissions = sorted(
        (set(sidebar_keys) | route_keys) - set(permission_keys)
    )
    unused_permissions = sorted(
        set(permission_keys) - set(sidebar_keys) - route_keys
    )

    duplicate_database_permission_keys = []
    duplicate_permission_ids = []
    missing_database_sidebar_permissions = []
    inactive_sidebar_permissions = []
    active_database_permissions = None
    if db is not None:
        database_permissions = db.query(Permission).all()
        database_keys = [permission.permission_key for permission in database_permissions]
        database_ids = [permission.id for permission in database_permissions]
        active_keys = {
            permission.permission_key
            for permission in database_permissions
            if permission.is_active
        }
        duplicate_database_permission_keys = sorted(
            key for key, count in Counter(database_keys).items() if count > 1
        )
        duplicate_permission_ids = sorted(
            permission_id
            for permission_id, count in Counter(database_ids).items()
            if count > 1
        )
        missing_database_sidebar_permissions = sorted(
            set(sidebar_keys) - set(database_keys)
        )
        inactive_sidebar_permissions = sorted(
            set(sidebar_keys) - active_keys - set(missing_database_sidebar_permissions)
        )
        active_database_permissions = len(active_keys)

    result: Dict[str, object] = {
        "total_modules": len(FINALIZED_PERMISSION_MATRIX),
        "total_permissions": len(permission_keys),
        "total_sidebar_items": len(SIDEBAR_MODULES),
        "total_groups": len(sidebar_groups),
        "active_database_permissions": active_database_permissions,
        "route_permission_references": len(route_keys),
        "duplicate_permission_keys": duplicate_permission_keys,
        "duplicate_database_permission_keys": duplicate_database_permission_keys,
        "duplicate_permission_ids": duplicate_permission_ids,
        "duplicate_sidebar_permissions": duplicate_sidebar_permissions,
        "duplicate_sidebar_tabs": duplicate_sidebar_tabs,
        "duplicate_sidebar_routes": duplicate_sidebar_routes,
        "missing_catalog_permissions": missing_catalog_permissions,
        "missing_database_sidebar_permissions": missing_database_sidebar_permissions,
        "inactive_sidebar_permissions": inactive_sidebar_permissions,
        "unused_permissions": unused_permissions,
    }

    validation_failures = (
        duplicate_permission_keys
        or duplicate_database_permission_keys
        or duplicate_permission_ids
        or duplicate_sidebar_permissions
        or duplicate_sidebar_tabs
        or duplicate_sidebar_routes
        or missing_catalog_permissions
        or missing_database_sidebar_permissions
        or inactive_sidebar_permissions
    )
    if validation_failures:
        raise RuntimeError(f"RBAC validation failed: {result}")

    return result


def main() -> Dict[str, object]:
    db = SessionLocal()
    try:
        result = validate_rbac(db=db)
    finally:
        db.close()
    for key, value in result.items():
        if isinstance(value, list):
            print(f"{key}: {len(value)}")
            for item in value:
                print(f"  - {item}")
        else:
            print(f"{key}: {value}")
    return result


if __name__ == "__main__":
    main()
