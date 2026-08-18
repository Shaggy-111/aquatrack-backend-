import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { API_BASE_URL } from "../config";
import EmployeeSubpageNav from "../components/EmployeeSubpageNav";
import usePermissions from "../hooks/usePermissions";
import usePermissionCatalog from "../hooks/usePermissionCatalog";
import AccessDenied from "../components/AccessDenied";
import { PERMISSIONS } from "../permissions";

const employeePermissionsUrl = (employeeId) => `${API_BASE_URL}/employees/${employeeId}/permissions`;

const getToken = () =>
  localStorage.getItem("auth_token") ||
  localStorage.getItem("userToken") ||
  localStorage.getItem("partner_token");

const getErrorMessage = (error) => {
  const detail = error.response?.data?.detail || error.response?.data?.message;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join(", ");
  return "Unable to update permissions.";
};

const getPermissionList = (payload) =>
  Array.isArray(payload)
    ? payload
    : payload?.permissions || payload?.items || payload?.data || [];

export default function EmployeePermissions() {
  const { employeeId } = useParams();
  const { loading: permissionsLoading, hasPermission } = usePermissions();
  const { catalog, groups: permissionGroups, loading: catalogLoading, error: catalogError } = usePermissionCatalog();
  const canEditPermissions = hasPermission(PERMISSIONS.USERS_ASSIGN_PERMISSIONS);
  const [employee, setEmployee] = useState(null);
  const [assigned, setAssigned] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [collapsedModules, setCollapsedModules] = useState(new Set());

  const config = useMemo(() => ({
    headers: { Authorization: `Bearer ${getToken()}` },
  }), []);

  const loadPermissions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [employeeResponse, permissionsResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/employees/${employeeId}`, config),
        axios.get(employeePermissionsUrl(employeeId), config),
      ]);
      setEmployee(employeeResponse.data.employee || employeeResponse.data.data || employeeResponse.data);
      const data = permissionsResponse.data;
      const permissions = getPermissionList(data);
      const ids = permissions.map((permission) =>
        Number(typeof permission === "number" ? permission : permission.permission_id ?? permission.permission?.id ?? permission.id)
      ).filter(Number.isInteger);
      setAssigned(new Set(ids));
      setSelected(new Set(ids));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [config, employeeId]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const toggleSelection = (permissionId) => {
    setSelected((current) => {
      const next = new Set(current);
      next.has(permissionId) ? next.delete(permissionId) : next.add(permissionId);
      return next;
    });
  };

  const allPermissionIds = useMemo(
    () => catalog.map((permission) => permission.id).filter(Number.isInteger),
    [catalog]
  );

  const allPermissionsSelected = allPermissionIds.length > 0 &&
    allPermissionIds.every((permissionId) => selected.has(permissionId));

  const toggleAllPermissions = () => {
    setSelected(allPermissionsSelected ? new Set() : new Set(allPermissionIds));
  };

  const toggleModulePermissions = (modulePermissions) => {
    const moduleIds = modulePermissions.map((permission) => permission.id).filter(Number.isInteger);
    const moduleSelected = moduleIds.length > 0 && moduleIds.every((permissionId) => selected.has(permissionId));
    setSelected((current) => {
      const next = new Set(current);
      moduleIds.forEach((permissionId) => moduleSelected ? next.delete(permissionId) : next.add(permissionId));
      return next;
    });
  };

  const toggleModuleCollapse = (module) => {
    setCollapsedModules((current) => {
      const next = new Set(current);
      next.has(module) ? next.delete(module) : next.add(module);
      return next;
    });
  };

  const filteredPermissionGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return permissionGroups;
    return permissionGroups.reduce((matches, group) => {
      const moduleMatches = String(group.module).toLowerCase().includes(term);
      const permissions = moduleMatches ? group.permissions : group.permissions.filter((permission) =>
        [permission.key, permission.name, permission.code, permission.action, permission.module]
          .some((value) => String(value || "").toLowerCase().includes(term))
      );
      if (permissions.length) matches.push({ ...group, permissions });
      return matches;
    }, []);
  }, [permissionGroups, search]);

  const assignPermission = async (permissionId) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await axios.post(employeePermissionsUrl(employeeId), { permission_id: permissionId }, config);
      setAssigned((current) => new Set(current).add(permissionId));
      setSelected((current) => new Set(current).add(permissionId));
      setMessage("Permission assigned.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const removePermission = async (permissionId) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await axios.delete(`${employeePermissionsUrl(employeeId)}/${permissionId}`, config);
      setAssigned((current) => {
        const next = new Set(current);
        next.delete(permissionId);
        return next;
      });
      setSelected((current) => {
        const next = new Set(current);
        next.delete(permissionId);
        return next;
      });
      setMessage("Permission removed.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const bulkAssign = async () => {
    const permissionIds = [...selected].filter((permissionId) => !assigned.has(permissionId));
    if (!permissionIds.length) return setMessage("No new permissions selected.");
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await axios.post(`${employeePermissionsUrl(employeeId)}/bulk`, { permission_ids: permissionIds }, config);
      setAssigned((current) => new Set([...current, ...permissionIds]));
      setMessage("Permissions assigned successfully.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  if (permissionsLoading) {
    return <main style={styles.page}><section style={styles.card}>Loading permissions...</section></main>;
  }

  if (!hasPermission(PERMISSIONS.USERS_VIEW)) return <AccessDenied />;

  return (
    <main style={styles.page}>
      <EmployeeSubpageNav />
      <section style={styles.header}>
        <div>
          <h1 style={styles.title}>Employee Permissions</h1>
          <p style={styles.subtitle}>{employee ? `${employee.full_name} (${employee.email})` : `Employee #${employeeId}`}</p>
        </div>
      </section>

      {error && <div role="alert" style={styles.error}>{error}</div>}
      {message && <div role="status" style={styles.success}>{message}</div>}

      {loading || catalogLoading ? <section style={styles.card}>Loading permissions...</section> : catalog.length === 0 ? (
        <section style={styles.card}>
          <h2 style={styles.moduleTitle}>Permission catalog unavailable</h2>
          <p style={styles.catalogMessage}>
            {catalogError?.response?.data?.detail || catalogError?.message || "No permissions were returned by the catalog."}
          </p>
        </section>
      ) : (
        <>
          <section style={{ ...styles.card, ...styles.controls }}>
            <label style={styles.masterLabel}>
              <input
                type="checkbox"
                checked={allPermissionsSelected}
                onChange={toggleAllPermissions}
                disabled={saving || !canEditPermissions}
              />
              <span>Select All Permissions</span>
            </label>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search module, permission, or action"
              aria-label="Search permissions"
              style={styles.search}
            />
          </section>

          {canEditPermissions && selected.size > 0 && (
            <section style={styles.actionBar}>
              <strong>Selected: {selected.size} permissions</strong>
              <div style={styles.actionBarButtons}>
                <button style={{ ...styles.button, ...styles.primaryButton }} disabled={saving} onClick={bulkAssign}>
                  {saving ? "Saving..." : "Assign Selected"}
                </button>
                <button style={{ ...styles.button, ...styles.clearButton }} disabled={saving} onClick={() => setSelected(new Set())}>
                  Clear Selection
                </button>
              </div>
            </section>
          )}

          {filteredPermissionGroups.length === 0 ? (
            <section style={styles.card}>No permissions match your search.</section>
          ) : <section style={styles.grid}>
          {filteredPermissionGroups.map(({ module, permissions: visibleModulePermissions }) => {
            const completeModule = permissionGroups.find((group) => group.module === module)?.permissions || visibleModulePermissions;
            const moduleIds = completeModule.map((permission) => permission.id).filter(Number.isInteger);
            const moduleSelectedCount = moduleIds.filter((permissionId) => selected.has(permissionId)).length;
            const moduleSelected = moduleIds.length > 0 && moduleSelectedCount === moduleIds.length;
            const collapsed = collapsedModules.has(module);
            return (
            <article key={module} style={styles.card}>
              <div style={styles.moduleHeader}>
                <label style={styles.moduleSelector}>
                  <input
                    type="checkbox"
                    checked={moduleSelected}
                    onChange={() => toggleModulePermissions(completeModule)}
                    disabled={saving || !canEditPermissions}
                  />
                  <span>{module}</span>
                </label>
                <button
                  type="button"
                  style={styles.collapseButton}
                  onClick={() => toggleModuleCollapse(module)}
                  aria-expanded={!collapsed}
                  aria-label={`${collapsed ? "Expand" : "Collapse"} ${module}`}
                >
                  {collapsed ? "▶" : "▼"}
                </button>
              </div>
              <p style={styles.selectionCounter}>{moduleSelectedCount} / {moduleIds.length} selected</p>
              {!collapsed && visibleModulePermissions.map((permission) => {
                const hasAssignmentId = Number.isInteger(permission.id);
                const isAssigned = assigned.has(permission.id);
                return (
                  <div key={permission.id ?? permission.key} style={styles.permissionRow}>
                    <label style={styles.label}>
                      <input type="checkbox" checked={hasAssignmentId && selected.has(permission.id)} onChange={() => toggleSelection(permission.id)} disabled={saving || !hasAssignmentId || !canEditPermissions} />
                      <span style={styles.permissionName}>{permission.action[0].toUpperCase() + permission.action.slice(1)}</span>
                    </label>
                    {canEditPermissions && hasAssignmentId ? <button
                      style={{ ...styles.smallButton, ...(isAssigned ? styles.removeButton : styles.assignButton) }}
                      disabled={saving}
                      onClick={() => isAssigned ? removePermission(permission.id) : assignPermission(permission.id)}
                    >
                      {isAssigned ? "Remove" : "Assign"}
                    </button> : !hasAssignmentId ? <span style={styles.catalogOnly}>Catalog ID required</span> : null}
                  </div>
                );
              })}
            </article>
          );})}
        </section>}
        </>
      )}
    </main>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#f4f6f8", padding: "28px", color: "#102a43", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px", marginBottom: "20px", flexWrap: "wrap" },
  title: { margin: 0, fontSize: "28px" },
  subtitle: { margin: "6px 0 0", color: "#64748b" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "18px" },
  card: { background: "#fff", borderRadius: "10px", boxShadow: "0 2px 8px rgba(0,0,0,.1)", padding: "20px" },
  controls: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "18px", marginBottom: "18px", flexWrap: "wrap" },
  masterLabel: { display: "flex", alignItems: "center", gap: "10px", color: "#102a43", fontWeight: 700, cursor: "pointer" },
  search: { width: "100%", maxWidth: "420px", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: "7px", color: "#102a43", background: "#fff" },
  actionBar: { position: "sticky", bottom: "16px", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "14px 18px", marginBottom: "18px", background: "#102a43", color: "#fff", borderRadius: "10px", boxShadow: "0 8px 24px rgba(15,23,42,.25)", flexWrap: "wrap" },
  actionBarButtons: { display: "flex", gap: "10px", flexWrap: "wrap" },
  clearButton: { background: "#e2e8f0", color: "#334155" },
  moduleHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", paddingBottom: "10px", borderBottom: "1px solid #e2e8f0" },
  moduleSelector: { display: "flex", alignItems: "center", gap: "9px", color: "#102a43", fontSize: "18px", fontWeight: 700, cursor: "pointer", minWidth: 0 },
  collapseButton: { border: 0, background: "transparent", color: "#475569", cursor: "pointer", padding: "5px", fontSize: "14px", flexShrink: 0 },
  selectionCounter: { margin: "10px 0 4px", color: "#64748b", fontSize: "13px", fontWeight: 600 },
  permissionRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "9px 0" },
  label: { display: "flex", alignItems: "center", gap: "9px", color: "#334155", cursor: "pointer" },
  permissionName: { minWidth: "60px" },
  button: { border: 0, borderRadius: "7px", padding: "10px 16px", fontWeight: 600, cursor: "pointer" },
  primaryButton: { background: "#4CAF50", color: "#fff" },
  smallButton: { border: 0, borderRadius: "6px", padding: "6px 10px", fontWeight: 600, cursor: "pointer" },
  assignButton: { background: "#dcfce7", color: "#166534" },
  removeButton: { background: "#fee2e2", color: "#b91c1c" },
  error: { marginBottom: "16px", padding: "10px 12px", background: "#fee2e2", color: "#991b1b", borderRadius: "7px" },
  success: { marginBottom: "16px", padding: "10px 12px", background: "#dcfce7", color: "#166534", borderRadius: "7px" },
  catalogMessage: { margin: 0, color: "#64748b", lineHeight: 1.6 },
  catalogOnly: { color: "#94a3b8", fontSize: "12px" },
};
