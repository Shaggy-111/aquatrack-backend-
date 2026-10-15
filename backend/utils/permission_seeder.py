import re
from typing import Dict, List

from sqlalchemy.orm import Session

from ..models.employee_permission import EmployeePermission
from ..models.permission import Permission
from ..models.user import RoleEnum, User


CHANNEL_ADMIN_BASE_PERMISSION_KEYS = (
    "dashboard.view",
    "orders.view",
    "unassigned_orders.view",
    "store.view",
    "partner_poc.view",
    "complaints.view",
    "reports.view",
)
BLINKIT_CHANNEL_ADMIN_PERMISSION_KEYS = (
    "blinkit_reports.view",
)


FINALIZED_PERMISSION_MATRIX: List[Dict[str, object]] = [
    # Dashboard
    {"module": "Dashboard", "actions": ["view", "view_own_scope", "view_team_scope", "view_org_scope"], "icon": "dashboard"},

    # Orders
    {"module": "Orders", "actions": ["view", "create", "edit", "export", "cancel", "confirm_delivery", "change_status", "view_financials", "view_delivery_proof"], "icon": "shopping_cart"},
    {"module": "Unassigned Orders", "actions": ["view", "assign", "export", "route_to_manager", "bulk_assign", "escalation_queue"], "icon": "assignment_late"},
    {"module": "Customer Orders", "actions": ["view", "create", "edit", "cancel", "export", "duplicate_order", "customer_order_history"], "icon": "receipt_long"},
    {"module": "Commercial Orders", "key": "commercial_bulk_orders", "actions": ["view", "create", "upload", "download", "export", "approve", "reject", "validate_bulk_order", "bulk_import", "bulk_import_preview", "bulk_import_rollback"], "icon": "inventory"},

    # Stores
    {"module": "Stores", "key": "store", "actions": ["view", "create", "edit", "delete", "assign", "export", "activate", "deactivate", "history", "analytics", "manage_auto_order"], "icon": "store"},
    {"module": "Active Stores", "actions": ["view", "create", "edit", "delete", "assign", "export", "deactivate", "reactivate", "view_store_health", "view_store_history"], "icon": "storefront"},
    {"module": "Store Analytics", "actions": ["view", "export", "drilldown", "compare_periods", "view_trends"], "icon": "analytics"},
    {"module": "Store Auto Order", "actions": ["view", "edit", "approve", "reject", "manage", "pause_auto_order", "resume_auto_order", "override_quantity"], "icon": "autorenew"},
    {"module": "Store Reimbursement", "key": "store_reimbursement", "actions": ["view", "create", "edit", "approve", "record_payment", "upload_proof", "cancel", "export"], "icon": "receipt_long"},
    {"module": "Partner / POC", "actions": ["view", "create", "edit", "delete", "assign", "approve", "reject", "export", "activate", "deactivate", "assign_stores", "view_partner_performance"], "icon": "handshake"},
    {"module": "Customers", "actions": ["view", "create", "edit", "delete", "export", "activate", "deactivate", "merge_customer", "customer_history", "communication_log"], "icon": "groups"},

    # Store Managers
    {"module": "Store Manager", "actions": ["view", "create", "edit", "delete", "assign", "export", "reassign_store", "transfer_ownership", "view_team_performance"], "icon": "manage_accounts", "sidebar_items": [{"module": "Create Store Manager", "action": "create", "icon": "person_add"}, {"module": "Store Managers List", "action": "view", "icon": "groups"}]},

    # Delivery
    {"module": "Delivery", "actions": ["view", "edit", "mark_delivered", "upload_delivery_proof", "confirm_delivery", "delivery_exception"], "icon": "local_shipping"},
    {"module": "Delivery Routes", "actions": ["view", "assign", "edit", "reassign_route", "optimize_route", "view_route_history"], "icon": "route"},
    {"module": "Delivery Partner", "actions": ["view", "create", "edit", "delete", "assign", "approve", "reject", "export", "activate", "deactivate", "move_to_manager", "view_performance"], "icon": "delivery_dining"},
    {"module": "Delivery Manager", "actions": ["view", "create", "edit", "delete", "assign", "export", "assign_stores", "remove_stores", "reassign_team", "view_workload"], "icon": "supervisor_account"},
    {"module": "Delivery Area Manager", "actions": ["view", "create", "edit", "delete", "assign_stores", "remove_stores", "assign_delivery_partners", "reassign_delivery_partners", "view_performance", "view_workload"], "icon": "manage_accounts"},
    {"module": "QR Management", "actions": ["view", "create", "assign", "export", "generate_qr", "download_stickers", "regenerate_qr", "deactivate_qr"], "icon": "qr_code", "sidebar_label": "QR"},
    {"module": "Bottles", "actions": ["view", "create", "edit", "assign", "export", "change_status", "transfer", "reconcile_inventory", "bottle_history"], "icon": "inventory_2"},
    {"module": "Collectable Bottles", "actions": ["view", "assign", "edit", "mark_collected", "collection_exception", "transfer_to_warehouse"], "icon": "recycling"},
    {"module": "Warehouse Bottles", "actions": ["view", "edit", "export", "receive", "dispatch", "reconcile", "stock_adjustment"], "icon": "warehouse"},

    # Employees
    {"module": "Employee Management", "key": "users", "actions": ["view", "create", "edit", "delete", "manage", "activate", "deactivate", "reset_password", "impersonation_request", "view_permissions", "assign_permissions", "revoke_permissions", "view_store_scope", "assign_stores", "remove_stores", "history"], "icon": "badge"},

    # Attendance
    {"module": "Attendance", "actions": ["view", "create", "edit", "approve", "reject", "export", "check_in", "check_out", "regularize", "view_team_attendance"], "icon": "event_available"},
    {"module": "Leave", "actions": ["view", "create", "edit", "approve", "reject", "export", "cancel_leave", "leave_balance_adjustment", "delegation"], "icon": "event_busy"},
    {"module": "Holiday", "key": "holidays", "actions": ["view", "create", "edit", "delete", "upload", "export", "holiday_calendar_publish", "regional_holiday_scope"], "icon": "calendar_month"},

    # Compliance
    {"module": "Complaints", "actions": ["view", "create", "edit", "assign", "approve", "reject", "export", "resolve", "reopen", "escalate", "add_internal_note", "sla_override"], "icon": "support_agent"},
    {"module": "Store Compliance", "actions": ["view", "create", "edit", "upload", "invoice_manage", "record_payment", "approve", "reject", "delete", "export", "generate_pdf", "compliance_review", "version_history", "document_archive"], "icon": "fact_check"},
    {"module": "Vendor License", "actions": ["view", "create", "edit", "delete", "upload", "export", "verify_license", "expire_license", "renew_license", "location_lookup"], "icon": "verified"},
    {"module": "Regions", "actions": ["view", "create", "edit", "delete", "assign", "export", "territory_mapping", "region_hierarchy_manage"], "icon": "map"},

    # Reports
    {"module": "Reports", "actions": ["view", "upload", "export", "download", "schedule_report", "share_report", "archive_report"], "icon": "bar_chart"},
    {"module": "Delivery Reports", "actions": ["view", "download", "export", "schedule_report", "view_exceptions", "drilldown"], "icon": "assessment"},
    {
        "module": "Blinkit Report",
        "key": "blinkit_reports",
        "actions": ["view", "export", "metadata_manage", "vendor_rate_export"],
        "permission_sort_orders": {
            "view": 900010,
            "export": 900020,
            "metadata_manage": 900030,
            "vendor_rate_export": 900040,
        },
        "action_display_names": {
            "vendor_rate_export": "Export Blinkit Vendor Rate",
        },
        "icon": "assessment",
        "sidebar_order": 322,
    },
    {"module": "Monthly Virtual Cards", "key": "monthly_virtual_cards", "actions": ["view", "generate", "update"], "icon": "calendar_month", "sidebar_order": 325},
    {"module": "Store Reports", "actions": ["view", "download", "export", "schedule_report", "store_performance_drilldown"], "icon": "query_stats"},
    {"module": "Manual Delivery Upload", "actions": ["view", "upload", "download", "approve", "reject", "bulk_import", "import_preview", "import_rollback", "exception_review", "history"], "icon": "upload_file", "sidebar_action": "view"},
    {"module": "Uploads", "actions": ["view", "upload", "approve", "reject", "delete", "import_preview", "import_validation", "import_rollback", "upload_history"], "icon": "cloud_upload"},
    {"module": "Exports", "actions": ["export", "export_sensitive_data", "scheduled_export", "export_audit"], "icon": "download", "sidebar_action": "export"},

    # Administration
    {"module": "Channel Admin", "actions": ["view", "create", "edit", "delete", "assign", "export", "activate", "deactivate", "channel_scope_admin"], "icon": "admin_panel_settings"},
    {"module": "Notifications", "actions": ["view", "create", "edit", "delete", "manage", "activate", "deactivate", "send_notification", "template_manage", "notification_audit"], "icon": "notifications"},
    {"module": "Audit Logs", "actions": ["view", "export", "archive", "view_sensitive_audit", "retention_manage"], "icon": "history"},
    {"module": "RBAC", "key": "rbac_permissions", "actions": ["view", "manage", "approve", "reject", "assign_permissions", "revoke_permissions", "role_clone", "permission_diff", "access_review", "temporary_access"], "icon": "security"},
    {"module": "Workflow Approvals", "actions": ["view", "approve", "reject", "assign", "approval_delegation", "multi_level_approval", "approval_audit"], "icon": "approval"},
    {"module": "Data Retention", "actions": ["view", "manage", "archive", "restore", "purge_request"], "icon": "archive"},
    {"module": "Admin Operations", "actions": ["view", "manage", "system_health", "operational_override", "maintenance_mode"], "icon": "settings_suggest"},
    {"module": "Google Sheet Sync", "actions": ["view", "upload", "manage", "sync_now", "sync_schedule", "sync_error_review", "sync_history"], "icon": "sync"},
    {"module": "Blinkit Sync", "key": "blinkit_master_sync", "actions": ["view", "upload", "manage", "sync_now", "sync_schedule", "sync_history", "import_preview", "rollback_sync"], "icon": "sync_alt"},
    {"module": "Zepto Sync", "key": "zepto_master_sync", "actions": ["view", "upload", "manage", "sync_now", "sync_schedule", "sync_history", "import_preview", "rollback_sync"], "icon": "sync_alt"},

    # Settings
    {"module": "System Settings", "actions": ["view", "edit", "manage", "feature_flag_manage", "integration_settings", "security_settings"], "icon": "settings"},
    {"module": "App Version", "actions": ["view", "manage", "publish", "activate", "deactivate", "history", "force_update", "release_notes_manage"], "icon": "system_update"},
    {"module": "Profile", "key": "user_profile", "actions": ["view", "edit", "change_password", "manage_preferences", "manage_devices"], "icon": "account_circle"},
    {"module": "Auth / OTP", "actions": ["view", "manage", "revoke_session", "reset_mfa", "otp_audit"], "icon": "password", "sidebar": False},
]


ATTENDANCE_PERMISSION_ROWS: List[Dict[str, object]] = [
    {
        "module": "Attendance",
        "action": permission_key.removeprefix("attendance.").replace(".", "_"),
        "permission_key": permission_key,
        "display_name": display_name,
        "description": f"Allows employee role access to {display_name.lower()}.",
        "is_active": True,
    }
    for permission_key, display_name in [
        ("attendance.checkin", "Check In Attendance"),
        ("attendance.checkout", "Check Out Attendance"),
        ("attendance.leave.apply", "Apply Attendance Leave"),
        ("attendance.leave.approve", "Approve Attendance Leave"),
        ("attendance.holiday.manage", "Manage Attendance Holidays"),
        ("attendance.report.view", "View Attendance Reports"),
        ("attendance.export", "Export Attendance"),
    ]
]


def _slug(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_")


def _display_action(action: str) -> str:
    return action.replace("_", " ").title()


def _module_key(module_entry: Dict[str, object]) -> str:
    return str(module_entry.get("key") or _slug(str(module_entry["module"])))


def _camel_case(value: str) -> str:
    words = _slug(value).split("_")
    return words[0] + "".join(word.title() for word in words[1:])


SIDEBAR_NAVIGATION_OVERRIDES: Dict[str, Dict[str, str]] = {
    "Create Store Manager": {"tab": "createStoreManager", "route": "createPartner"},
    "Store Managers List": {"tab": "storeManagers", "route": "myPartners"},
    "Delivery Partner": {"tab": "deliveryPartner", "route": "deliveryPartners"},
    "Delivery Area Manager": {"tab": "deliveryAreaManager", "route": "deliveryManagers"},
    "QR": {"tab": "qr", "route": "qrManagement"},
    "Active Stores": {"tab": "activeStores", "route": "activeStoresList"},
    "Blinkit Report": {"tab": "blinkitReports", "route": "blinkitReports"},
}


SIDEBAR_GROUP_BY_MODULE: Dict[str, str] = {
    "Dashboard": "Operations",
    "Orders": "Operations",
    "Unassigned Orders": "Operations",
    "Customer Orders": "Operations",
    "Commercial Orders": "Operations",
    "Stores": "Stores",
    "Active Stores": "Stores",
    "Store Analytics": "Stores",
    "Store Auto Order": "Stores",
    "Store Reimbursement": "Stores",
    "Partner / POC": "Stores",
    "Customers": "Stores",
    "Store Manager": "Stores",
    "Delivery": "Delivery",
    "Delivery Routes": "Delivery",
    "Delivery Partner": "Delivery",
    "Delivery Manager": "Delivery",
    "Delivery Area Manager": "Delivery",
    "QR Management": "Delivery",
    "Bottles": "Warehouse",
    "Collectable Bottles": "Warehouse",
    "Warehouse Bottles": "Warehouse",
    "Employee Management": "HR",
    "Attendance": "HR",
    "Leave": "HR",
    "Holiday": "HR",
    "Complaints": "Compliance",
    "Store Compliance": "Compliance",
    "Vendor License": "Compliance",
    "Regions": "Compliance",
    "Reports": "Reports",
    "Delivery Reports": "Reports",
    "Blinkit Report": "Reports",
    "Monthly Virtual Cards": "Reports",
    "Store Reports": "Reports",
    "Manual Delivery Upload": "Reports",
    "Uploads": "Reports",
    "Exports": "Reports",
    "Channel Admin": "Administration",
    "Notifications": "Administration",
    "Audit Logs": "Administration",
    "RBAC": "Administration",
    "Workflow Approvals": "Administration",
    "Data Retention": "Administration",
    "Admin Operations": "Administration",
    "Google Sheet Sync": "Administration",
    "Blinkit Sync": "Administration",
    "Zepto Sync": "Administration",
    "System Settings": "Settings",
    "App Version": "Settings",
    "Profile": "Settings",
}


def build_sidebar_modules() -> List[Dict[str, object]]:
    sidebar_modules: List[Dict[str, object]] = []
    custom_order_count = 0

    for module_entry in FINALIZED_PERMISSION_MATRIX:
        if module_entry.get("sidebar", True) is False:
            continue

        module = str(module_entry["module"])
        module_key = _module_key(module_entry)
        actions = [str(action) for action in module_entry["actions"]]
        configured_items = module_entry.get("sidebar_items")

        if configured_items:
            sidebar_items = list(configured_items)
        else:
            sidebar_items = [
                {
                    "module": str(module_entry.get("sidebar_label") or module),
                    "action": str(module_entry.get("sidebar_action") or "view"),
                    "icon": str(module_entry.get("icon") or "apps"),
                }
            ]

        for sidebar_item in sidebar_items:
            action = str(sidebar_item["action"])
            if action not in actions:
                raise ValueError(
                    f"Sidebar action '{action}' is not defined for module '{module}'."
                )

            sidebar_label = str(sidebar_item["module"])
            navigation = SIDEBAR_NAVIGATION_OVERRIDES.get(sidebar_label, {})
            tab = navigation.get("tab") or _camel_case(sidebar_label)
            route = navigation.get("route") or tab
            action_label = _display_action(_slug(action))
            configured_order = module_entry.get("sidebar_order")
            default_order = (len(sidebar_modules) + 1 - custom_order_count) * 10
            sidebar_modules.append(
                {
                    "module": sidebar_label,
                    "permission": f"{module_key}.{_slug(action)}",
                    "icon": str(sidebar_item.get("icon") or module_entry.get("icon") or "apps"),
                    "tab": tab,
                    "route": route,
                    "order": int(configured_order or default_order),
                    "group": SIDEBAR_GROUP_BY_MODULE[module],
                    "description": f"{action_label} access for {sidebar_label}.",
                }
            )
            if configured_order is not None:
                custom_order_count += 1

    return sidebar_modules


def build_permission_rows() -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    sort_order = 10
    module_names: List[str] = []

    for module_entry in FINALIZED_PERMISSION_MATRIX:
        module = str(module_entry["module"])
        module_key = _module_key(module_entry)
        module_names.append(module)

        for action in module_entry["actions"]:
            action_key = _slug(str(action))
            configured_sort_order = module_entry.get("permission_sort_orders", {}).get(
                action_key
            )
            display_name = str(
                module_entry.get("action_display_names", {}).get(
                    action_key,
                    f"{_display_action(action_key)} {module}",
                )
            )
            rows.append(
                {
                    "module": module,
                    "action": action_key,
                    "permission_key": f"{module_key}.{action_key}",
                    "display_name": display_name,
                    "description": f"Allows employee role access to {_display_action(action_key).lower()} for {module}.",
                    "sort_order": int(configured_sort_order or sort_order),
                    "is_active": True,
                }
            )
            if configured_sort_order is None:
                sort_order += 10

    existing_keys = {row["permission_key"] for row in rows}
    for attendance_row in ATTENDANCE_PERMISSION_ROWS:
        if attendance_row["permission_key"] not in existing_keys:
            row = dict(attendance_row)
            row["sort_order"] = sort_order
            rows.append(row)
            sort_order += 10

    duplicate_modules = sorted(
        module
        for module in set(module_names)
        if module_names.count(module) > 1
    )
    permission_keys = [str(row["permission_key"]) for row in rows]
    duplicate_permission_keys = sorted(
        key
        for key in set(permission_keys)
        if permission_keys.count(key) > 1
    )
    sidebar_modules = build_sidebar_modules()
    sidebar_permission_keys = [item["permission"] for item in sidebar_modules]
    duplicate_sidebar_permissions = sorted(
        key
        for key in set(sidebar_permission_keys)
        if sidebar_permission_keys.count(key) > 1
    )
    missing_sidebar_permissions = sorted(
        set(sidebar_permission_keys) - set(permission_keys)
    )

    validation_errors = {
        "duplicate_modules": duplicate_modules,
        "duplicate_permission_keys": duplicate_permission_keys,
        "duplicate_sidebar_permissions": duplicate_sidebar_permissions,
        "missing_sidebar_permissions": missing_sidebar_permissions,
    }
    if any(validation_errors.values()):
        raise ValueError(f"Invalid RBAC catalog: {validation_errors}")

    return rows


def seed_default_permissions(db: Session) -> Dict[str, int]:
    permission_rows = build_permission_rows()
    permission_keys = [row["permission_key"] for row in permission_rows]

    existing_permissions = {
        permission.permission_key: permission
        for permission in db.query(Permission)
        .filter(Permission.permission_key.in_(permission_keys))
        .all()
    }

    new_permissions = [
        Permission(**row)
        for row in permission_rows
        if row["permission_key"] not in existing_permissions
    ]
    updated_count = 0

    for row in permission_rows:
        permission = existing_permissions.get(str(row["permission_key"]))
        if permission is None:
            continue

        changed = False
        for field in (
            "module",
            "action",
            "display_name",
            "description",
            "sort_order",
        ):
            expected_value = row[field]
            if getattr(permission, field) != expected_value:
                setattr(permission, field, expected_value)
                changed = True

        if changed:
            updated_count += 1

    if new_permissions or updated_count:
        db.add_all(new_permissions)
        db.commit()

    channel_admin_assignments = assign_channel_admin_permissions(db)
    if channel_admin_assignments:
        db.commit()

    return {
        "created_count": len(new_permissions),
        "updated_count": updated_count,
        "skipped_count": len(permission_rows) - len(new_permissions),
        "channel_admin_assignments_created": channel_admin_assignments,
    }


def channel_admin_permission_keys(channel: object) -> tuple[str, ...]:
    keys = list(CHANNEL_ADMIN_BASE_PERMISSION_KEYS)
    if str(channel or "").strip().upper() == "BLINKIT":
        keys.extend(BLINKIT_CHANNEL_ADMIN_PERMISSION_KEYS)
    return tuple(keys)


def assign_channel_admin_permissions(
    db: Session,
    channel_admins: List[User] | None = None,
) -> int:
    """Create the role/channel defaults using the existing assignment model."""
    if channel_admins is None:
        channel_admins = (
            db.query(User)
            .filter(
                User.role == RoleEnum.channel_admin,
                User.is_deleted.is_(False),
            )
            .all()
        )
    if not channel_admins:
        return 0

    requested_keys = {
        key
        for user in channel_admins
        for key in channel_admin_permission_keys(user.channel)
    }
    permissions_by_key = {
        permission.permission_key: permission
        for permission in db.query(Permission)
        .filter(
            Permission.permission_key.in_(requested_keys),
            Permission.is_active.is_(True),
        )
        .all()
    }
    user_ids = [user.id for user in channel_admins]
    existing = {
        (assignment.employee_id, assignment.permission_id)
        for assignment in db.query(EmployeePermission)
        .filter(EmployeePermission.employee_id.in_(user_ids))
        .all()
    }
    assignments = []
    for user in channel_admins:
        for key in channel_admin_permission_keys(user.channel):
            permission = permissions_by_key.get(key)
            if permission and (user.id, permission.id) not in existing:
                assignments.append(
                    EmployeePermission(
                        employee_id=user.id,
                        permission_id=permission.id,
                    )
                )
                existing.add((user.id, permission.id))
    db.add_all(assignments)
    return len(assignments)
