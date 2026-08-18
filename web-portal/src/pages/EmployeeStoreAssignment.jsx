import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { API_BASE_URL } from "../config";
import EmployeeSubpageNav from "../components/EmployeeSubpageNav";
import usePermissions from "../hooks/usePermissions";
import { PERMISSIONS } from "../permissions";

const getToken = () =>
  localStorage.getItem("auth_token") ||
  localStorage.getItem("userToken") ||
  localStorage.getItem("partner_token");

const assignmentUrl = `${API_BASE_URL}/employee-store-assignments/`;
const employeeStoresUrl = (employeeId) => `${API_BASE_URL}/employee-store-assignments/employees/${employeeId}/stores`;
const getErrorMessage = (error) =>
  error.response?.data?.detail || error.response?.data?.message || "Unable to update store assignments.";
const unwrapList = (data, key) => Array.isArray(data) ? data : data[key] || data.items || data.data || [];
const getStoreId = (store) => String(store.id ?? store.store_id ?? "");
const getStoreName = (store) => store.store_name || store.name || "";
const getStoreCode = (store) => store.store_code || store.outlet_code || store.code || "";
const getPartnerName = (store) =>
  store.partner_name || store.assigned_partner_name || store.partner?.full_name ||
  (typeof store.partner === "string" ? store.partner : "");
const getDeliveryManagerName = (store) =>
  store.delivery_manager_name || store.assigned_delivery_manager_name || store.manager_name ||
  store.delivery_manager?.full_name || store.delivery_manager?.name ||
  (typeof store.delivery_manager === "string" ? store.delivery_manager : "") ||
  store.manager?.full_name || store.manager?.name ||
  (typeof store.manager === "string" ? store.manager : "");
const getDeliveryManagerId = (item) => String(
  item.delivery_manager_id ?? item.manager_id ?? item.delivery_manager?.id ?? item.manager?.id ?? ""
);
const getStoreStatus = (store) =>
  store.status || (typeof store.is_active === "boolean" ? (store.is_active ? "active" : "inactive") : "");

export default function EmployeeStoreAssignment() {
  const { employeeId } = useParams();
  const { hasPermission } = usePermissions();
  const canAssignStores = hasPermission(PERMISSIONS.USERS_ASSIGN_STORES);
  const canRemoveStores = hasPermission(PERMISSIONS.USERS_REMOVE_STORES);
  const [employee, setEmployee] = useState(null);
  const [stores, setStores] = useState([]);
  const [assignedIds, setAssignedIds] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ state: "", city: "", channel: "", deliveryManager: "", status: "", assignment: "", storeId: "", storeName: "" });
  const [quickFilter, setQuickFilter] = useState("all");
  const [sortBy, setSortBy] = useState("storeName");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const config = useMemo(() => ({
    headers: { Authorization: `Bearer ${getToken()}` },
  }), []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [employeeResponse, storesResponse, assignedResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/employees/${employeeId}`, config),
        axios.get(`${API_BASE_URL}/store/store/list/all`, config),
        axios.get(employeeStoresUrl(employeeId), config),
      ]);
      setEmployee(employeeResponse.data.employee || employeeResponse.data.data || employeeResponse.data);
      let loadedStores = unwrapList(storesResponse.data, "stores");

      if (!loadedStores.some((store) => getDeliveryManagerName(store))) {
        const managersResponse = await axios.get(
          `${API_BASE_URL}/partners/partners/superadmin/list-delivery-managers`,
          config
        );
        const managers = unwrapList(managersResponse.data, "delivery_managers");
        const managerNamesById = new Map();
        const managerNamesByStoreId = new Map();

        managers.forEach((manager) => {
          const managerName = manager.full_name || manager.name || manager.manager_name || "";
          const managerId = getDeliveryManagerId(manager) || String(manager.id ?? "");
          if (managerId && managerName) managerNamesById.set(managerId, managerName);
          const managerStores = Array.isArray(manager.stores) ? manager.stores : [];
          const managerStoreIds = Array.isArray(manager.store_ids) ? manager.store_ids : [];
          [...managerStores, ...managerStoreIds].forEach((store) => {
            const storeId = typeof store === "object" ? getStoreId(store) : String(store);
            if (storeId && managerName) managerNamesByStoreId.set(storeId, managerName);
          });
        });

        loadedStores = loadedStores.map((store) => ({
          ...store,
          delivery_manager_name: managerNamesByStoreId.get(getStoreId(store)) ||
            managerNamesById.get(getDeliveryManagerId(store)) || "",
        }));
      }
      setStores(loadedStores);
      const assignedStores = unwrapList(assignedResponse.data, "stores");
      const ids = assignedStores.map((store) => String(store.id ?? store.store_id ?? store));
      setAssignedIds(new Set(ids));
      setSelectedIds(new Set(ids));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [config, employeeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filterOptions = useMemo(() => {
    const unique = (values) => [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
    return {
      states: unique(stores.map((store) => store.state)),
      cities: unique(stores.map((store) => store.city)),
      channels: unique(stores.map((store) => store.channel)),
      deliveryManagers: unique(stores.map(getDeliveryManagerName)),
      statuses: unique(stores.map(getStoreStatus)),
    };
  }, [stores]);

  const filteredStores = useMemo(() => {
    const term = search.trim().toLowerCase();
    const includes = (value, target) => !target || String(value || "").toLowerCase().includes(target.toLowerCase());
    const matches = stores.filter((store) => {
      const id = getStoreId(store);
      const assigned = assignedIds.has(id);
      const globalMatch = !term || [getStoreName(store), getStoreCode(store), id, store.address, store.city, getPartnerName(store), getDeliveryManagerName(store)]
        .some((value) => String(value || "").toLowerCase().includes(term));
      if (!globalMatch) return false;
      if (!includes(store.state, filters.state) || !includes(store.city, filters.city) || !includes(store.channel, filters.channel)) return false;
      if (!includes(getDeliveryManagerName(store), filters.deliveryManager) || !includes(getStoreStatus(store), filters.status)) return false;
      if (!includes(id, filters.storeId) || !includes(getStoreName(store), filters.storeName)) return false;
      if (filters.assignment === "assigned" && !assigned) return false;
      if (filters.assignment === "unassigned" && assigned) return false;
      if (quickFilter === "assigned" && !assigned) return false;
      if (quickFilter === "unassigned" && assigned) return false;
      if (quickFilter === "delhi" && String(store.city || "").toLowerCase() !== "delhi") return false;
      if (["blinkit", "zepto"].includes(quickFilter) && String(store.channel || "").toLowerCase() !== quickFilter) return false;
      return true;
    });

    return [...matches].sort((left, right) => {
      const leftAssigned = assignedIds.has(getStoreId(left));
      const rightAssigned = assignedIds.has(getStoreId(right));
      if (sortBy === "assignedFirst" && leftAssigned !== rightAssigned) return leftAssigned ? -1 : 1;
      if (sortBy === "unassignedFirst" && leftAssigned !== rightAssigned) return leftAssigned ? 1 : -1;
      if (sortBy === "newest") {
        const leftDate = new Date(left.created_at || left.createdAt || 0).getTime() || Number(getStoreId(left)) || 0;
        const rightDate = new Date(right.created_at || right.createdAt || 0).getTime() || Number(getStoreId(right)) || 0;
        return rightDate - leftDate;
      }
      const field = sortBy === "city" ? "city" : sortBy === "state" ? "state" : null;
      return String(field ? left[field] : getStoreName(left)).localeCompare(String(field ? right[field] : getStoreName(right)));
    });
  }, [assignedIds, filters, quickFilter, search, sortBy, stores]);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize, quickFilter, search, sortBy]);

  const pageCount = Math.max(1, Math.ceil(filteredStores.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedStores = filteredStores.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allVisibleSelected = filteredStores.length > 0 && filteredStores.every((store) => selectedIds.has(getStoreId(store)));

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      filteredStores.forEach((store) => {
        const id = getStoreId(store);
        allVisibleSelected ? next.delete(id) : next.add(id);
      });
      return next;
    });
  };

  const setSelected = (storeId) => {
    const id = String(storeId);
    setSelectedIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const assignStore = async (storeId) => {
    const id = String(storeId);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await axios.post(assignmentUrl, { employee_id: Number(employeeId), store_id: id }, config);
      setAssignedIds((current) => new Set(current).add(id));
      setSelectedIds((current) => new Set(current).add(id));
      setMessage("Store assigned.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const removeStore = async (storeId) => {
    const id = String(storeId);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await axios.delete(`${employeeStoresUrl(employeeId)}/${id}`, config);
      setAssignedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setMessage("Store removed.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const bulkAssign = async () => {
    const storeIds = [...selectedIds].filter((id) => !assignedIds.has(id));
    if (!storeIds.length) return setMessage("No new stores selected.");
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await axios.post(`${API_BASE_URL}/employee-store-assignments/bulk`, { employee_id: Number(employeeId), store_ids: storeIds }, config);
      setAssignedIds((current) => new Set([...current, ...storeIds]));
      setMessage("Stores assigned successfully.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={styles.page}>
      <EmployeeSubpageNav />
      <section style={styles.header}>
        <div>
          <h1 style={styles.title}>Employee Store Assignment</h1>
          <p style={styles.subtitle}>{employee ? `${employee.full_name} (${employee.email})` : `Employee #${employeeId}`}</p>
        </div>
        {canAssignStores && <button style={{ ...styles.button, ...styles.primaryButton }} disabled={loading || saving} onClick={bulkAssign}>
          {saving ? "Saving..." : "Bulk Assign Selected"}
        </button>}
      </section>

      <section style={styles.card}>
        <div style={styles.quickFilters}>
          {["all", "assigned", "unassigned", "blinkit", "zepto"].map((filter) => (
            <button key={filter} type="button" onClick={() => setQuickFilter(filter)} style={{ ...styles.quickButton, ...(quickFilter === filter ? styles.quickButtonActive : {}) }}>
              {filter[0].toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>

        <div style={styles.filterBar}>
          <input type="search" aria-label="Global store search" placeholder="Search name, code, ID, address, city, partner, or delivery manager" value={search} onChange={(event) => setSearch(event.target.value)} style={{ ...styles.input, ...styles.globalSearch }} />
          <FilterSelect label="State" value={filters.state} options={filterOptions.states} onChange={(value) => setFilters((current) => ({ ...current, state: value }))} />
          <FilterSelect label="City" value={filters.city} options={filterOptions.cities} onChange={(value) => setFilters((current) => ({ ...current, city: value }))} />
          <FilterSelect label="Channel" value={filters.channel} options={filterOptions.channels} onChange={(value) => setFilters((current) => ({ ...current, channel: value }))} />
          <FilterSelect label="Delivery Manager" value={filters.deliveryManager} options={filterOptions.deliveryManagers} onChange={(value) => setFilters((current) => ({ ...current, deliveryManager: value }))} />
          <FilterSelect label="Store Status" value={filters.status} options={filterOptions.statuses} onChange={(value) => setFilters((current) => ({ ...current, status: value }))} />
          <label style={styles.filterField}><span style={styles.filterLabel}>Assignment</span><select value={filters.assignment} onChange={(event) => setFilters((current) => ({ ...current, assignment: event.target.value }))} style={styles.input}><option value="">All</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option></select></label>
          <label style={styles.filterField}><span style={styles.filterLabel}>Store ID</span><input value={filters.storeId} onChange={(event) => setFilters((current) => ({ ...current, storeId: event.target.value }))} style={styles.input} /></label>
          <label style={styles.filterField}><span style={styles.filterLabel}>Store Name</span><input value={filters.storeName} onChange={(event) => setFilters((current) => ({ ...current, storeName: event.target.value }))} style={styles.input} /></label>
          <label style={styles.filterField}><span style={styles.filterLabel}>Sort By</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={styles.input}><option value="storeName">Store Name</option><option value="city">City</option><option value="state">State</option><option value="assignedFirst">Assigned First</option><option value="unassignedFirst">Unassigned First</option><option value="newest">Newest</option></select></label>
        </div>

        <div style={styles.tableToolbar}>
          {canAssignStores && <label style={styles.selectAllLabel}><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={saving || filteredStores.length === 0} /> Select All Visible Stores</label>}
          <span style={styles.resultCount}>{filteredStores.length} stores</span>
        </div>

        {canAssignStores && selectedIds.size > 0 && <div style={styles.bulkBar}>
          <strong>Selected: {selectedIds.size} Stores</strong>
          <div style={styles.bulkActions}>
            <button style={{ ...styles.button, ...styles.primaryButton }} disabled={saving} onClick={bulkAssign}>{saving ? "Saving..." : "Assign Selected"}</button>
            <button style={{ ...styles.button, ...styles.clearButton }} disabled={saving} onClick={() => setSelectedIds(new Set())}>Clear</button>
          </div>
        </div>}

        {error && <div role="alert" style={styles.error}>{error}</div>}
        {message && <div role="status" style={styles.success}>{message}</div>}

        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead><tr style={styles.headerRow}>
              <th style={styles.headerCell}>Select</th><th style={styles.headerCell}>Store</th>
              <th style={styles.headerCell}>Code</th><th style={styles.headerCell}>City</th><th style={styles.headerCell}>State</th>
              <th style={styles.headerCell}>Channel</th><th style={styles.headerCell}>Partner</th><th style={styles.headerCell}>Address</th>
              <th style={styles.headerCell}>Status</th><th style={styles.headerCell}>Action</th>
            </tr></thead>
            <tbody>
              {!loading && paginatedStores.map((store) => {
                const id = getStoreId(store);
                const assigned = assignedIds.has(id);
                return <tr key={id} style={styles.row}>
                  <td style={styles.cell}>{canAssignStores && <input type="checkbox" checked={selectedIds.has(id)} onChange={() => setSelected(id)} disabled={saving} />}</td>
                  <td style={styles.cell}>{getStoreName(store) || `Store #${id}`}</td>
                  <td style={styles.cell}>{getStoreCode(store) || "N/A"}</td>
                  <td style={styles.cell}>{store.city || "N/A"}</td>
                  <td style={styles.cell}>{store.state || "N/A"}</td>
                  <td style={styles.cell}>{store.channel || "N/A"}</td>
                  <td style={styles.cell}>{getPartnerName(store) || "Unassigned"}</td>
                  <td style={styles.cell}>{store.address || "N/A"}</td>
                  <td style={styles.cell}><span style={{ ...styles.badge, ...(assigned ? styles.assigned : styles.unassigned) }}>{assigned ? "Assigned" : "Unassigned"}</span></td>
                  <td style={styles.cell}>{((assigned && canRemoveStores) || (!assigned && canAssignStores)) && <button style={{ ...styles.smallButton, ...(assigned ? styles.removeButton : styles.assignButton) }} disabled={saving} onClick={() => assigned ? removeStore(id) : assignStore(id)}>{assigned ? "Remove" : "Assign"}</button>}</td>
                </tr>;
              })}
              <tr style={{ display: loading || filteredStores.length === 0 ? "table-row" : "none" }}>
                <td colSpan="10" style={styles.empty}>{loading ? "Loading stores..." : "No stores found."}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={styles.pagination}>
          <label style={styles.pageSizeLabel}>Stores/page <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} style={styles.pageSelect}>{[25, 50, 100, 200].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <span>Page {currentPage} of {pageCount}</span>
          <div style={styles.paginationButtons}>
            <button type="button" style={styles.pageButton} disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <button type="button" style={styles.pageButton} disabled={currentPage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button>
          </div>
        </div>
      </section>
    </main>
  );
}

const FilterSelect = ({ label, value, options, onChange }) => (
  <label style={styles.filterField}>
    <span style={styles.filterLabel}>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)} style={styles.input}>
      <option value="">All</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </label>
);

const styles = {
  page: { minHeight: "100vh", background: "#f4f6f8", padding: "28px", color: "#102a43", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px", marginBottom: "20px", flexWrap: "wrap" },
  title: { margin: 0, fontSize: "28px" }, subtitle: { margin: "6px 0 0", color: "#64748b" },
  card: { background: "#fff", borderRadius: "10px", boxShadow: "0 2px 8px rgba(0,0,0,.1)", padding: "20px" },
  quickFilters: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" },
  quickButton: { border: "1px solid #cbd5e1", borderRadius: "999px", padding: "7px 13px", background: "#fff", color: "#475569", cursor: "pointer", fontWeight: 600 },
  quickButtonActive: { background: "#102a43", borderColor: "#102a43", color: "#fff" },
  filterBar: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: "12px", marginBottom: "16px", padding: "16px", background: "#f8fafc", borderRadius: "9px", border: "1px solid #e2e8f0" },
  filterField: { display: "flex", flexDirection: "column", gap: "5px", minWidth: 0 },
  filterLabel: { color: "#64748b", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" },
  input: { width: "100%", boxSizing: "border-box", padding: "9px 10px", border: "1px solid #cbd5e1", borderRadius: "7px", fontSize: "13px", background: "#fff", color: "#102a43", minWidth: 0 },
  globalSearch: { gridColumn: "span 2", alignSelf: "end" },
  tableToolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px", flexWrap: "wrap" },
  selectAllLabel: { display: "flex", alignItems: "center", gap: "8px", color: "#334155", fontWeight: 700, cursor: "pointer" },
  resultCount: { color: "#64748b", fontSize: "13px", fontWeight: 600 },
  bulkBar: { position: "sticky", bottom: "14px", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "14px", padding: "12px 16px", borderRadius: "9px", background: "#102a43", color: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.24)", flexWrap: "wrap" },
  bulkActions: { display: "flex", gap: "8px", flexWrap: "wrap" },
  clearButton: { background: "#e2e8f0", color: "#334155" },
  tableWrapper: { overflow: "auto", maxHeight: "65vh", border: "1px solid #e2e8f0", borderRadius: "8px" }, table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "1250px" },
  headerRow: { background: "#102a43", color: "#fff" }, headerCell: { position: "sticky", top: 0, zIndex: 5, background: "#102a43", textAlign: "left", padding: "13px 12px", fontSize: "13px", whiteSpace: "nowrap" },
  row: { borderBottom: "1px solid #e2e8f0" }, cell: { padding: "13px 12px", color: "#334155", fontSize: "14px" },
  empty: { padding: "30px", textAlign: "center", color: "#64748b" }, badge: { padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 },
  assigned: { background: "#dcfce7", color: "#166534" }, unassigned: { background: "#e2e8f0", color: "#475569" },
  button: { border: 0, borderRadius: "7px", padding: "10px 16px", fontWeight: 600, cursor: "pointer" }, primaryButton: { background: "#4CAF50", color: "#fff" },
  smallButton: { border: 0, borderRadius: "6px", padding: "7px 10px", fontWeight: 600, cursor: "pointer" }, assignButton: { background: "#dcfce7", color: "#166534" }, removeButton: { background: "#fee2e2", color: "#b91c1c" },
  error: { marginBottom: "16px", padding: "10px 12px", background: "#fee2e2", color: "#991b1b", borderRadius: "7px" }, success: { marginBottom: "16px", padding: "10px 12px", background: "#dcfce7", color: "#166534", borderRadius: "7px" },
  pagination: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", marginTop: "16px", color: "#475569", fontSize: "13px", flexWrap: "wrap" },
  pageSizeLabel: { display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 },
  pageSelect: { padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", color: "#334155" },
  paginationButtons: { display: "flex", gap: "8px" },
  pageButton: { padding: "7px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", color: "#334155", cursor: "pointer" },
};
