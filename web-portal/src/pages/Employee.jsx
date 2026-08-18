import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../config";
import usePermissions from "../hooks/usePermissions";
import AccessDenied from "../components/AccessDenied";
import { PERMISSIONS } from "../permissions";

const emptyForm = { full_name: "", email: "", mobile_number: "", password: "" };
const EMPLOYEE_VIEW_STATE_KEY = "aquatrack.employeeManagement.viewState";
let employeeListCache = null;

const getSavedViewState = () => {
  try {
    return JSON.parse(sessionStorage.getItem(EMPLOYEE_VIEW_STATE_KEY)) || {};
  } catch {
    return {};
  }
};

const getToken = () =>
  localStorage.getItem("auth_token") ||
  localStorage.getItem("userToken") ||
  localStorage.getItem("partner_token");

const getErrorMessage = (error) =>
  error.response?.data?.detail ||
  error.response?.data?.message ||
  "Something went wrong. Please try again.";

const isEmployeeActive = (employee) => {
  if (typeof employee.is_active === "boolean") return employee.is_active;
  return String(employee.status || "active").toLowerCase() === "active";
};

export default function Employee() {
  const navigate = useNavigate();
  const { loading: permissionsLoading, hasPermission } = usePermissions();
  const canViewEmployees = hasPermission(PERMISSIONS.USERS_VIEW);
  const canCreateEmployees = hasPermission(PERMISSIONS.USERS_CREATE);
  const canEditEmployees = hasPermission(PERMISSIONS.USERS_EDIT);
  const canDeleteEmployees = hasPermission(PERMISSIONS.USERS_DELETE);
  const canAssignStores = hasPermission(PERMISSIONS.USERS_ASSIGN_STORES);
  const canAssignPermissions = hasPermission(PERMISSIONS.USERS_ASSIGN_PERMISSIONS);
  const canActivateEmployees = hasPermission(PERMISSIONS.USERS_ACTIVATE);
  const canDeactivateEmployees = hasPermission(PERMISSIONS.USERS_DEACTIVATE);
  const canResetEmployeePasswords = hasPermission(PERMISSIONS.USERS_RESET_PASSWORD);
  const [employees, setEmployees] = useState(() => employeeListCache || []);
  const [search, setSearch] = useState(() => getSavedViewState().search || "");
  const [loading, setLoading] = useState(() => !employeeListCache);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [permanentDeleteEmployee, setPermanentDeleteEmployee] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const requestConfig = () => ({
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  const loadEmployees = useCallback(async ({ force = false } = {}) => {
    if (employeeListCache && !force) {
      setEmployees(employeeListCache);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API_BASE_URL}/employees/list`, requestConfig());
      const data = response.data;
      const list = Array.isArray(data) ? data : data.employees || data.items || data.data || [];
      employeeListCache = list.filter((employee) => !employee.is_deleted && String(employee.status || "").toLowerCase() !== "deleted");
      setEmployees(employeeListCache);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!permissionsLoading && canViewEmployees) loadEmployees();
  }, [canViewEmployees, loadEmployees, permissionsLoading]);

  useEffect(() => {
    const savedScroll = Number(getSavedViewState().scrollY) || 0;
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, savedScroll));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => {
    sessionStorage.setItem(EMPLOYEE_VIEW_STATE_KEY, JSON.stringify({ search, scrollY: window.scrollY }));
  }, [search]);

  const openEmployeeSubpage = (path) => {
    sessionStorage.setItem(EMPLOYEE_VIEW_STATE_KEY, JSON.stringify({ search, scrollY: window.scrollY }));
    navigate(path);
  };

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) =>
      [employee.full_name, employee.email, employee.mobile_number, employee.id]
        .some((value) => String(value ?? "").toLowerCase().includes(term))
    );
  }, [employees, search]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setModalOpen(true);
  };

  const openEdit = async (id) => {
    setError("");
    try {
      const response = await axios.get(`${API_BASE_URL}/employees/${id}`, requestConfig());
      const employee = response.data.employee || response.data.data || response.data;
      setEditingId(id);
      setForm({
        full_name: employee.full_name || "",
        email: employee.email || "",
        mobile_number: employee.mobile_number || "",
        password: "",
      });
      setModalOpen(true);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = { ...form, mobile_number: form.mobile_number || "" };
    if (editingId) delete payload.password;
    else payload.confirm_password = payload.password;

    try {
      if (editingId) {
        await axios.put(`${API_BASE_URL}/employees/${editingId}`, payload, requestConfig());
      } else {
        await axios.post(`${API_BASE_URL}/employees/create`, payload, requestConfig());
      }
      setModalOpen(false);
      await loadEmployees({ force: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (employee) => {
    const active = isEmployeeActive(employee);
    if (!window.confirm(`${active ? "Deactivate" : "Activate"} ${employee.full_name}?`)) return;
    setError("");
    try {
      await axios.patch(
        `${API_BASE_URL}/employees/${employee.id}/status`,
        { status: active ? "inactive" : "active" },
        requestConfig()
      );
      await loadEmployees({ force: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  };

  const showSuccessToast = (message) => {
    setSuccessMessage(message);
    window.setTimeout(() => {
      setSuccessMessage((current) => current === message ? "" : current);
    }, 3000);
  };

  const deleteEmployee = async (employee, { permanent = false } = {}) => {
    if (!permanent && !window.confirm(`Soft delete ${employee.full_name}?`)) return;
    setError("");
    setDeleting(true);
    try {
      const endpoint = `${API_BASE_URL}/employees/${employee.id}${permanent ? "/permanent" : ""}`;
      await axios.delete(endpoint, requestConfig());
      setEmployees((current) => current.filter((item) => String(item.id) !== String(employee.id)));
      showSuccessToast(permanent ? "Employee permanently deleted." : "Employee soft deleted.");
      await loadEmployees({ force: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setDeleting(false);
      if (permanent) setPermanentDeleteEmployee(null);
    }
  };

  if (permissionsLoading) return <main style={styles.page}><section style={styles.card}>Loading permissions...</section></main>;
  if (!canViewEmployees) return <AccessDenied />;

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <div>
          <h1 style={styles.title}>Employee Management</h1>
          <p style={styles.subtitle}>Create, update, activate, and manage employees.</p>
        </div>
        {canCreateEmployees && <button style={{ ...styles.button, ...styles.primaryButton }} onClick={openCreate}>
          + Create Employee
        </button>}
      </section>

      <section style={styles.card}>
        <input
          aria-label="Search employees"
          type="search"
          placeholder="Search by name, email, mobile, or ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={styles.search}
        />

        {error && <div role="alert" style={styles.error}>{error}</div>}
        {successMessage && <div role="status" style={styles.toast}>{successMessage}</div>}

        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.headerRow}>
                <th style={styles.headerCell}>ID</th>
                <th style={styles.headerCell}>Full Name</th>
                <th style={styles.headerCell}>Email</th>
                <th style={styles.headerCell}>Mobile</th>
                <th style={styles.headerCell}>Status</th>
                <th style={styles.headerCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filteredEmployees.map((employee) => {
                const active = isEmployeeActive(employee);
                return (
                  <tr key={employee.id} style={styles.row}>
                    <td style={styles.cell}>{employee.id}</td>
                    <td style={styles.cell}>{employee.full_name}</td>
                    <td style={styles.cell}>{employee.email}</td>
                    <td style={styles.cell}>{employee.mobile_number || "N/A"}</td>
                    <td style={styles.cell}>
                      <span style={{ ...styles.badge, ...(active ? styles.active : styles.inactive) }}>
                        {active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td style={{ ...styles.cell, ...styles.actions }}>
                       {canAssignStores && <button style={{ ...styles.smallButton, ...styles.storeButton }} onClick={() => openEmployeeSubpage(`/employees/${employee.id}/stores`)}>Stores</button>}
                       {canAssignPermissions && <button style={{ ...styles.smallButton, ...styles.permissionButton }} onClick={() => openEmployeeSubpage(`/employees/${employee.id}/permissions`)}>Permissions</button>}
                       {canEditEmployees && <button style={{ ...styles.smallButton, ...styles.editButton }} onClick={() => openEdit(employee.id)}>Edit</button>}
                       {((active && canDeactivateEmployees) || (!active && canActivateEmployees)) && <button style={{ ...styles.smallButton, ...styles.statusButton }} onClick={() => toggleStatus(employee)}>
                         {active ? "Deactivate" : "Activate"}
                       </button>}
                       {canDeleteEmployees && <button style={{ ...styles.smallButton, ...styles.softDeleteButton }} disabled={deleting} onClick={() => deleteEmployee(employee)}>Soft Delete</button>}
                       {canDeleteEmployees && <button style={{ ...styles.smallButton, ...styles.deleteButton }} disabled={deleting} onClick={() => setPermanentDeleteEmployee(employee)}>Permanent Delete</button>}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ display: loading || filteredEmployees.length === 0 ? "table-row" : "none" }}>
                <td colSpan="6" style={styles.empty}>{loading ? "Loading employees..." : "No employees found."}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {permanentDeleteEmployee && (
        <div style={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="permanent-delete-title">
          <section style={styles.confirmModal}>
            <h2 id="permanent-delete-title" style={styles.modalTitle}>⚠️ Permanently Delete Employee?</h2>
            <p style={styles.confirmText}>This action cannot be undone.</p>
            <p style={styles.confirmText}>If this employee has related records, the backend will reject the request.</p>
            <div style={styles.modalActions}>
              <button type="button" style={{ ...styles.button, ...styles.cancelButton }} disabled={deleting} onClick={() => setPermanentDeleteEmployee(null)}>Cancel</button>
              <button type="button" style={{ ...styles.button, ...styles.deleteButton }} disabled={deleting} onClick={() => deleteEmployee(permanentDeleteEmployee, { permanent: true })}>
                {deleting ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </section>
        </div>
      )}

      {modalOpen && (
        <div style={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="employee-form-title">
          <form style={styles.modal} onSubmit={handleSubmit}>
            <h2 id="employee-form-title" style={styles.modalTitle}>{editingId ? "Edit Employee" : "Create Employee"}</h2>
            <label style={styles.label}>Full Name<input style={styles.input} required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
            <label style={styles.label}>Email<input style={styles.input} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label style={styles.label}>Mobile Number<input style={styles.input} value={form.mobile_number} onChange={(e) => setForm({ ...form, mobile_number: e.target.value })} /></label>
            {(!editingId || canResetEmployeePasswords) && <label style={styles.label}>Password{editingId && " (leave blank to keep current)"}<input style={styles.input} type="password" required={!editingId} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>}
            <div style={styles.modalActions}>
              <button type="button" style={{ ...styles.button, ...styles.cancelButton }} onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button>
              <button type="submit" style={{ ...styles.button, ...styles.primaryButton }} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#f4f6f8", padding: "28px", color: "#102a43", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px", marginBottom: "20px", flexWrap: "wrap" },
  title: { margin: 0, fontSize: "28px" },
  subtitle: { margin: "6px 0 0", color: "#64748b" },
  card: { background: "#fff", borderRadius: "10px", boxShadow: "0 2px 8px rgba(0,0,0,.1)", padding: "20px" },
  search: { width: "100%", maxWidth: "420px", padding: "11px 14px", border: "1px solid #cbd5e1", borderRadius: "7px", marginBottom: "18px", fontSize: "14px", background: "#fff", color: "#102a43" },
  tableWrapper: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: "800px" },
  headerRow: { background: "#102a43", color: "#fff" },
  headerCell: { textAlign: "left", padding: "13px 12px", fontSize: "13px" },
  row: { borderBottom: "1px solid #e2e8f0" },
  cell: { padding: "13px 12px", color: "#334155", fontSize: "14px" },
  actions: { display: "flex", gap: "7px", flexWrap: "wrap" },
  empty: { padding: "30px", textAlign: "center", color: "#64748b" },
  badge: { display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 },
  active: { background: "#dcfce7", color: "#166534" },
  inactive: { background: "#fee2e2", color: "#991b1b" },
  button: { border: 0, borderRadius: "7px", padding: "10px 16px", fontWeight: 600 },
  primaryButton: { background: "#4CAF50", color: "#fff" },
  cancelButton: { background: "#e2e8f0", color: "#334155" },
  smallButton: { border: 0, borderRadius: "6px", padding: "7px 10px", fontWeight: 600, cursor: "pointer" },
  editButton: { background: "#dbeafe", color: "#1d4ed8" },
  permissionButton: { background: "#e0e7ff", color: "#4338ca" },
  storeButton: { background: "#ccfbf1", color: "#0f766e" },
  statusButton: { background: "#fef3c7", color: "#92400e" },
  softDeleteButton: { background: "#ffedd5", color: "#c2410c" },
  deleteButton: { background: "#fee2e2", color: "#b91c1c" },
  error: { marginBottom: "16px", padding: "10px 12px", background: "#fee2e2", color: "#991b1b", borderRadius: "7px" },
  toast: { position: "fixed", top: "20px", right: "20px", zIndex: 1100, padding: "12px 16px", background: "#166534", color: "#fff", borderRadius: "7px", boxShadow: "0 8px 24px rgba(0,0,0,.18)", fontWeight: 600 },
  backdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", zIndex: 1000 },
  modal: { width: "100%", maxWidth: "460px", background: "#fff", borderRadius: "10px", padding: "24px", boxShadow: "0 20px 50px rgba(0,0,0,.2)" },
  confirmModal: { width: "100%", maxWidth: "460px", background: "#fff", borderRadius: "10px", padding: "24px", boxShadow: "0 20px 50px rgba(0,0,0,.2)" },
  confirmText: { margin: "10px 0", color: "#475569", lineHeight: 1.5 },
  modalTitle: { margin: "0 0 20px" },
  label: { display: "block", marginBottom: "14px", color: "#334155", fontSize: "14px", fontWeight: 600 },
  input: { display: "block", boxSizing: "border-box", width: "100%", marginTop: "6px", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: "7px", background: "#fff", color: "#102a43", fontSize: "14px" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "22px" },
};
