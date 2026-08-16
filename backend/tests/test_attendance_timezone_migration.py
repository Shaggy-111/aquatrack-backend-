import ast
import importlib
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from backend.attendance_time import as_ist


MIGRATION_MODULE = (
    "backend.alembic.versions."
    "c3e7a9b1d5f2_attendance_timestamps_with_timezone"
)
VERSIONS_DIR = Path(__file__).parents[1] / "alembic" / "versions"
COLUMNS = ("check_in_time", "check_out_time", "created_at")


def _migration():
    return importlib.import_module(MIGRATION_MODULE)


def _captured_sql(function):
    with patch.object(_migration().op, "execute") as execute:
        function()
    return [call.args[0] for call in execute.call_args_list]


def test_ist_wall_clock_value_becomes_expected_utc_and_api_returns_ist():
    stored_wall_clock = datetime(2026, 8, 5, 10, 31)
    migrated_value = stored_wall_clock.replace(tzinfo=ZoneInfo("Asia/Kolkata"))

    assert migrated_value.astimezone(timezone.utc) == datetime(
        2026, 8, 5, 5, 1, tzinfo=timezone.utc
    )
    assert as_ist(migrated_value.astimezone(timezone.utc)) == migrated_value
    assert as_ist(migrated_value.astimezone(timezone.utc)).strftime("%H:%M") == "10:31"


def test_null_check_out_remains_null_through_timezone_conversion():
    assert as_ist(None) is None


def test_upgrade_uses_ist_wall_clock_conversion_for_all_columns():
    migration = _migration()
    statements = _captured_sql(migration.upgrade)

    assert statements == [
        f"""ALTER TABLE attendance
ALTER COLUMN {column}
TYPE TIMESTAMP WITH TIME ZONE
USING {column} AT TIME ZONE 'Asia/Kolkata'"""
        for column in COLUMNS
    ]


def test_downgrade_restores_ist_wall_clock_values_for_all_columns():
    migration = _migration()
    statements = _captured_sql(migration.downgrade)

    assert statements == [
        f"""ALTER TABLE attendance
ALTER COLUMN {column}
TYPE TIMESTAMP WITHOUT TIME ZONE
USING {column} AT TIME ZONE 'Asia/Kolkata'"""
        for column in COLUMNS
    ]


def test_alembic_chain_has_one_head_and_new_migration_follows_current_head():
    revisions = {}
    parents = set()
    for migration_file in VERSIONS_DIR.glob("*.py"):
        tree = ast.parse(migration_file.read_text(encoding="utf-8"))
        values = {}
        for node in tree.body:
            if isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for target in targets:
                    if isinstance(target, ast.Name) and target.id in {
                        "revision",
                        "down_revision",
                    }:
                        values[target.id] = ast.literal_eval(node.value)
        revision = values.get("revision")
        if revision:
            revisions[revision] = values.get("down_revision")
            parent = values.get("down_revision")
            if isinstance(parent, str):
                parents.add(parent)
            elif parent:
                parents.update(parent)

    heads = set(revisions) - parents
    assert heads == {"c3e7a9b1d5f2"}
    assert revisions["c3e7a9b1d5f2"] == "a1f4c8d2e6b0"
