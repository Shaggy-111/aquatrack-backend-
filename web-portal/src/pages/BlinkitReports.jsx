import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL, VITE_BLINKIT_REPORT_PIN } from "../config";
import AccessDenied from "../components/AccessDenied";
import usePermissions, { clearPermissionsCache } from "../hooks/usePermissions";
import { clearSidebarCache } from "../hooks/useSidebar";
import { clearPermissionCatalogCache } from "../hooks/usePermissionCatalog";
import { PERMISSIONS } from "../permissions";
import "./BlinkitReports.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PAGE_SIZES = [25, 50, 100];
// Frontend PIN is an additional UX gate only. Backend permissions remain authoritative.
const blinkitReportPin = () => VITE_BLINKIT_REPORT_PIN;
const token = () => localStorage.getItem("auth_token") || localStorage.getItem("userToken") || localStorage.getItem("partner_token");
const auth = () => ({ Authorization: `Bearer ${token()}` });
const optional = (value) => value === "" ? undefined : value;
const display = (value) => value === null || value === undefined || value === "" ? "—" : String(value);
const isoDate = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const istToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const defaultDates = () => { const to_date = istToday(); return { from_date: `${to_date.slice(0, 7)}-01`, to_date }; };
const emptyFilters = () => ({ ...defaultDates(), region: "", state: "", city: "", entity: "", store_id: "", vendor_name: "", page: 1, page_size: 25 });
const dateParts = (value) => { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || ""); return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null; };
const validRange = (filters) => { const from = dateParts(filters.from_date); const to = dateParts(filters.to_date); return Boolean(from && to && from.year === to.year && from.month === to.month && filters.from_date <= filters.to_date); };
const requestParams = (filters) => { const from = dateParts(filters.from_date); return { year: from?.year, month: from?.month, region: optional(filters.region), state: optional(filters.state), city: optional(filters.city), entity: optional(filters.entity), store_id: optional(filters.store_id), vendor_name: optional(filters.vendor_name), page: Number(filters.page), page_size: Number(filters.page_size) }; };
const sortText = (values) => [...values.reduce((unique, value) => { const text = String(value || "").trim(); if (text && !unique.has(text.toLocaleLowerCase())) unique.set(text.toLocaleLowerCase(), text); return unique; }, new Map()).values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
const rowsFrom = (payload, key) => Array.isArray(payload) ? payload : Array.isArray(payload?.[key]) ? payload[key] : [];
const storeField = (store, key) => store?.[key] ?? store?.[key.charAt(0).toUpperCase() + key.slice(1)];
const sameOption = (left, right) => String(left || "").trim().toLocaleLowerCase() === String(right || "").trim().toLocaleLowerCase();
const sessionExpired = (navigate) => { ["auth_token", "userToken", "partner_token", "user_role", "store_id", "store_name"].forEach((key) => localStorage.removeItem(key)); clearPermissionsCache(); clearSidebarCache(); clearPermissionCatalogCache(); navigate("/login"); };
const safeError = (error, action, navigate, vendorRate = false) => {
  const status = error?.response?.status;
  if (status === 401) { sessionExpired(navigate); return "Your session has expired. Please sign in again."; }
  if (status === 403) return vendorRate ? "You do not have permission to export Vendor Rate." : `You do not have permission to ${action}.`;
  if (status === 422) return "The selected Blinkit Report filters are invalid. Please review them.";
  return action === "load Blinkit Report" ? "Unable to load Blinkit Report. Please try again." : `Unable to ${action}. Please try again.`;
};
const filenameFrom = (header, fallback) => { const match = String(header || "").match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i); if (!match) return fallback; const decoded = decodeURIComponent(match[1].trim()); return decoded.replace(/[\\/:*?"<>|]/g, "_") || fallback; };
const safeReason = (value) => { const text = typeof value === "string" ? value.trim() : ""; return !text || /traceback|stack|sql|exception|file\s+"/i.test(text) ? "Row could not be imported." : text.slice(0, 180); };

const COLUMNS = [
  ["S.No", "S.No"], ["Region", "Region"], ["Entity", "Entity"], ["State", "State"], ["city", "city"], ["Citi Lead", "Citi Lead"], ["Outlet Names", "Outlet Names"], ["Outlet Id", "Outlet Id"], ["Mode of Ops", "Mode of Ops"], ["Live Date", "Live Date"], ["Supply start date", "Supply start date"], ["Closed/Dropped Date", "Closed/Dropped Date"], ["Admin POC", "Admin POC"], ["Contact No", "Contact No"], ["Vendor Name", "Vendor Name"],
];

function useModal(ref, onClose, blocked) {
  useEffect(() => { const previous = document.activeElement; const node = ref.current; const focusable = () => Array.from(node?.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex='-1'])") || []); focusable()[0]?.focus(); const keydown = (event) => { if (event.key === "Escape" && !blocked) onClose(); if (event.key === "Tab") { const items = focusable(); if (!items.length) return; const first = items[0]; const last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }; window.addEventListener("keydown", keydown); return () => { window.removeEventListener("keydown", keydown); previous?.focus?.(); }; }, [blocked, onClose, ref]);
}

export default function BlinkitReports() {
  const navigate = useNavigate();
  const { hasPermission, permissionsLoading } = usePermissions();
  const canView = hasPermission(PERMISSIONS.BLINKIT_REPORTS_VIEW);
  const canExport = hasPermission(PERMISSIONS.BLINKIT_REPORTS_EXPORT);
  const canManage = hasPermission(PERMISSIONS.BLINKIT_REPORTS_METADATA_MANAGE);
  const canVendorExport = canExport && hasPermission(PERMISSIONS.BLINKIT_REPORTS_VENDOR_RATE_EXPORT);
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [payload, setPayload] = useState({ days: [], rows: [], total: 0, page: 1, page_size: 25 });
  const [stores, setStores] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [vendorDropdown, setVendorDropdown] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [pinAction, setPinAction] = useState("");
  const requestRef = useRef({ id: 0, controller: null });
  const pinGateLock = useRef(false);
  const exportLock = useRef(false);

  useEffect(() => {
    if (permissionsLoading || !canView) return undefined;
    const controller = new AbortController();
    const options = { headers: auth(), signal: controller.signal };
    axios.get(`${API_BASE_URL}/store/store/list/all`, options).then((response) => setStores(rowsFrom(response.data, "stores"))).catch((requestError) => { if (!controller.signal.aborted && requestError?.response?.status === 401) sessionExpired(navigate); });
    axios.get(`${API_BASE_URL}/partners/partners/list`, options).then((response) => { const partners = rowsFrom(response.data, "partners"); setVendors(sortText(partners.map((item) => item.vendor_name || item.full_name || item.name))); setVendorDropdown(true); }).catch((requestError) => { if (!controller.signal.aborted) { setVendorDropdown(false); if (requestError?.response?.status === 401) sessionExpired(navigate); } });
    return () => controller.abort();
  }, [canView, navigate, permissionsLoading]);

  const regionOptions = useMemo(() => sortText(stores.map((store) => storeField(store, "region"))), [stores]);
  const stateOptions = useMemo(() => sortText(stores.filter((store) => !draft.region || sameOption(storeField(store, "region"), draft.region)).map((store) => storeField(store, "state"))), [draft.region, stores]);
  const cityOptions = useMemo(() => sortText(stores.filter((store) => (!draft.region || sameOption(storeField(store, "region"), draft.region)) && (!draft.state || sameOption(storeField(store, "state"), draft.state))).map((store) => storeField(store, "city"))), [draft.region, draft.state, stores]);
  const entityOptions = useMemo(() => sortText([...stores.map((store) => storeField(store, "entity")), "AMB"]), [stores]);

  const load = useCallback(async () => {
    if (permissionsLoading || !canView || !validRange(filters)) return;
    requestRef.current.controller?.abort(); const controller = new AbortController(); const id = requestRef.current.id + 1; requestRef.current = { id, controller }; setLoading(true); setError("");
    try { const response = await axios.get(`${API_BASE_URL}/blinkit-reports/monthly`, { params: requestParams(filters), headers: auth(), signal: controller.signal }); if (requestRef.current.id === id) setPayload({ days: Array.isArray(response.data?.days) ? response.data.days : [], rows: Array.isArray(response.data?.rows) ? response.data.rows : [], total: Number(response.data?.total) || 0, page: Number(response.data?.page) || filters.page, page_size: Number(response.data?.page_size) || filters.page_size }); }
    catch (requestError) { if (!controller.signal.aborted && requestRef.current.id === id) { setPayload((current) => ({ ...current, days: [], rows: [], total: 0 })); setError(safeError(requestError, "load Blinkit Report", navigate)); } }
    finally { if (requestRef.current.id === id) setLoading(false); }
  }, [canView, filters, navigate, permissionsLoading]);
  useEffect(() => { load(); return () => requestRef.current.controller?.abort(); }, [load]);

  const updateDraft = (name, value) => setDraft((current) => ({ ...current, [name]: value }));
  const updateRegion = (value) => setDraft((current) => ({ ...current, region: value, state: "", city: "" }));
  const updateState = (value) => setDraft((current) => ({ ...current, state: value, city: "" }));
  const apply = (event) => { event.preventDefault(); if (!validRange(draft)) return setError("Please select a date range within the same month."); setFilters({ ...draft, page: 1, page_size: filters.page_size }); setError(""); };
  const reset = () => { const next = emptyFilters(); setDraft(next); setFilters(next); setError(""); };
  const changePage = (page) => setFilters((current) => ({ ...current, page }));
  const changePageSize = (page_size) => setFilters((current) => ({ ...current, page: 1, page_size }));

  const appliedFrom = dateParts(filters.from_date);
  const appliedTo = dateParts(filters.to_date);
  const selectedDays = useMemo(() => payload.days.filter((day) => { const number = Number.parseInt(day, 10); return Number.isInteger(number) && number >= appliedFrom.day && number <= appliedTo.day; }), [appliedFrom.day, appliedTo.day, payload.days]);
  const rowRangeTotal = useCallback((row) => selectedDays.reduce((sum, day) => sum + (Number(row[day]) || 0), 0), [selectedDays]);
  const isFullMonth = appliedFrom.day === 1 && appliedTo.day === new Date(appliedFrom.year, appliedFrom.month, 0).getDate();
  const rangeLabel = `${String(appliedFrom.day).padStart(2, "0")} ${MONTHS[appliedFrom.month - 1].slice(0, 3)} – ${String(appliedTo.day).padStart(2, "0")} ${MONTHS[appliedTo.month - 1].slice(0, 3)} ${appliedTo.year}`;

  const exportReport = async (includeVendorRate) => {
    if (!canExport || (includeVendorRate && !canVendorExport) || exportLock.current) return;
    exportLock.current = true;
    setExporting(includeVendorRate ? "vendor" : "normal"); setError("");
    try { const response = await axios.get(`${API_BASE_URL}/blinkit-reports/monthly/export`, { params: { ...requestParams({ ...filters, page: undefined, page_size: undefined }), page: undefined, page_size: undefined, include_vendor_rate: includeVendorRate }, headers: auth(), responseType: "blob" }); const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filenameFrom(response.headers?.["content-disposition"], `Blinkit_Distribution_${appliedFrom.year}_${String(appliedFrom.month).padStart(2, "0")}.xlsx`); document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
    catch (requestError) { setError(safeError(requestError, "export Blinkit Report", navigate, includeVendorRate)); }
    finally { exportLock.current = false; setExporting(""); }
  };
  const requestPin = (action) => {
    if (pinGateLock.current || pinAction) return;
    if (!blinkitReportPin()) { setError("Blinkit Report security PIN is not configured."); return; }
    pinGateLock.current = true; setPinAction(action); setError("");
  };
  const closePin = () => { pinGateLock.current = false; setPinAction(""); };
  const verifiedPin = () => { const action = pinAction; closePin(); if (action === "upload") setImportOpen(true); if (action === "vendor") exportReport(true); };

  if (permissionsLoading) return <div className="blinkit-state">Loading permissions…</div>;
  if (!canView) return <AccessDenied />;
  const rows = payload.rows;
  const hasVendorRate = hasPermission(PERMISSIONS.BLINKIT_REPORTS_VENDOR_RATE_EXPORT) && rows.some((row) => Object.prototype.hasOwnProperty.call(row, "Vendor Rate"));
  const visibleBottles = rows.reduce((sum, row) => sum + rowRangeTotal(row), 0);
  const totalPages = Math.max(1, Math.ceil(payload.total / filters.page_size));
  const exportPrefix = isFullMonth ? "Export" : "Export Full Month";

  return <section className="blinkit-page"><header className="blinkit-header"><div><span>Blinkit distribution</span><h2>Blinkit Report</h2><p>Month-wise Blinkit delivery distribution and store metadata.</p></div><div className="blinkit-actions">{canExport && <button type="button" onClick={() => exportReport(false)} disabled={Boolean(exporting)}>{exporting === "normal" ? "Exporting…" : `${exportPrefix} Excel`}</button>}{canVendorExport && <button type="button" onClick={() => requestPin("vendor")} disabled={Boolean(exporting)}>{exporting === "vendor" ? "Exporting…" : `${exportPrefix} With Vendor Rate`}</button>}{canManage && <button type="button" onClick={() => requestPin("upload")}>Upload Metadata</button>}<button type="button" onClick={load} disabled={loading}>Refresh</button>{!isFullMonth && canExport && <small>Excel export currently includes the full selected month.</small>}</div></header>
    <form className="blinkit-filters" onSubmit={apply}>
      <Filter label="From Date"><input aria-label="From Date" type="date" value={draft.from_date} onChange={(event) => updateDraft("from_date", event.target.value)} required /></Filter>
      <Filter label="To Date"><input aria-label="To Date" type="date" value={draft.to_date} onChange={(event) => updateDraft("to_date", event.target.value)} required /></Filter>
      <Filter label="Region"><Select label="Region" value={draft.region} onChange={(event) => updateRegion(event.target.value)} allLabel="All Regions" options={regionOptions} /></Filter>
      <Filter label="State"><Select label="State" value={draft.state} onChange={(event) => updateState(event.target.value)} allLabel="All States" options={stateOptions} /></Filter>
      <Filter label="City"><Select label="City" value={draft.city} onChange={(event) => updateDraft("city", event.target.value)} allLabel="All Cities" options={cityOptions} /></Filter>
      <Filter label="Entity"><Select label="Entity" value={draft.entity} onChange={(event) => updateDraft("entity", event.target.value)} allLabel="All Entities" options={entityOptions} /></Filter>
      <Filter label="Vendor Name">{vendorDropdown ? <Select label="Vendor Name" value={draft.vendor_name} onChange={(event) => updateDraft("vendor_name", event.target.value)} allLabel="All Vendors" options={vendors} /> : <input aria-label="Vendor Name" value={draft.vendor_name} onChange={(event) => updateDraft("vendor_name", event.target.value)} placeholder="Vendor name" />}</Filter>
      <Filter label="Outlet / Search"><input aria-label="Outlet / Search" value={draft.store_id} onChange={(event) => updateDraft("store_id", event.target.value)} placeholder="Search outlet ID or store" /></Filter>
      <div className="blinkit-filter-actions"><button type="submit">Apply</button><button type="button" onClick={reset}>Reset</button></div>
    </form>
    {error && <div className="blinkit-error" role="alert">{error}</div>}
    <div className="blinkit-summary"><Summary label="Total Outlets" value={payload.total.toLocaleString()} /><Summary label="Visible Page Bottles" value={visibleBottles.toLocaleString()} /><Summary label="Selected Range" value={rangeLabel} /><Summary label="Rows Showing" value={rows.length} /></div>
    <div className="blinkit-table-card"><div className="blinkit-table-wrap" tabIndex="0" aria-label="Scrollable Blinkit report table"><table><thead><tr>{COLUMNS.map(([, label]) => <th key={label}>{label}</th>)}{hasVendorRate && <th>Vendor Rate</th>}<th>Selected Range Total</th>{selectedDays.map((day) => <th className="blinkit-day" key={day}>{day}</th>)}</tr></thead><tbody>{loading ? Array.from({ length: 6 }, (_, index) => <tr className="blinkit-skeleton" key={index}><td colSpan={COLUMNS.length + selectedDays.length + 2}><i /></td></tr>) : rows.length ? rows.map((row, index) => <tr key={row["Outlet Id"] ?? index}>{COLUMNS.map(([key]) => <td key={key}>{display(row[key])}</td>)}{hasVendorRate && <td>****</td>}<td>{rowRangeTotal(row)}</td>{selectedDays.map((day) => <td className="blinkit-day" key={day}>{display(row[day])}</td>)}</tr>) : <tr><td className="blinkit-empty" colSpan={COLUMNS.length + selectedDays.length + 2}>No Blinkit report data found for the selected filters.</td></tr>}</tbody></table></div><div className="blinkit-pagination"><span>Total records: <strong>{payload.total}</strong> · Page {filters.page} of {totalPages}</span><label>Rows per page <select aria-label="Rows per page" value={filters.page_size} onChange={(event) => changePageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option key={size}>{size}</option>)}</select></label><button type="button" disabled={filters.page <= 1 || loading} onClick={() => changePage(filters.page - 1)}>Previous</button><button type="button" disabled={filters.page >= totalPages || loading} onClick={() => changePage(filters.page + 1)}>Next</button></div></div>
    {pinAction && <PinModal onClose={closePin} onVerified={verifiedPin} expectedPin={blinkitReportPin()} />}
    {importOpen && canManage && <ImportModal onClose={() => setImportOpen(false)} onImported={load} navigate={navigate} />}
  </section>;
}

const Filter = ({ label, children }) => <label className="blinkit-field"><span>{label}</span>{children}</label>;
const Select = ({ label, value, onChange, allLabel, options }) => <select aria-label={label} value={value} onChange={onChange}><option value="">{allLabel}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
const Summary = ({ label, value }) => <article><span>{label}</span><strong>{value}</strong></article>;

function PinModal({ onClose, onVerified, expectedPin }) {
  const [pin, setPin] = useState(""); const [error, setError] = useState(""); const ref = useRef(null); useModal(ref, onClose, false);
  const submit = (event) => { event.preventDefault(); if (pin !== expectedPin) { setError("Incorrect PIN. Please try again."); setPin(""); return; } setPin(""); onVerified(); };
  return <div className="blinkit-modal-backdrop" data-testid="blinkit-pin-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={ref} className="blinkit-modal blinkit-pin-modal" role="dialog" aria-modal="true" aria-labelledby="blinkit-pin-title"><h2 id="blinkit-pin-title">Security Verification</h2><p>Enter the Blinkit Report security PIN to continue.</p><form onSubmit={submit}><label className="blinkit-upload"><span>Password</span><input autoFocus aria-label="Password" type="password" value={pin} onChange={(event) => setPin(event.target.value)} autoComplete="off" /></label>{error && <div className="blinkit-error" role="alert">{error}</div>}<div className="blinkit-modal-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit">Continue</button></div></form></section></div>;
}

function ImportModal({ onClose, onImported, navigate }) {
  const [file, setFile] = useState(null); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [result, setResult] = useState(null); const lock = useRef(false); const ref = useRef(null); useModal(ref, onClose, saving);
  const submit = async (event) => { event.preventDefault(); if (!file || !/\.xlsx$/i.test(file.name)) return setError("Please upload an XLSX file."); if (lock.current) return; lock.current = true; setSaving(true); setError(""); const body = new FormData(); body.append("file", file); try { const response = await axios.post(`${API_BASE_URL}/blinkit-reports/metadata/import`, body, { headers: auth() }); setResult(response.data || {}); await onImported(); } catch (requestError) { setError(safeError(requestError, "upload Blinkit metadata", navigate)); } finally { lock.current = false; setSaving(false); } };
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  return <div className="blinkit-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section ref={ref} className="blinkit-modal" role="dialog" aria-modal="true" aria-labelledby="blinkit-import-title"><h2 id="blinkit-import-title">Upload Blinkit Metadata</h2><p>Updates Blinkit report metadata using Outlet ID. Stores and Orders are not created or modified.</p><div className="blinkit-columns"><strong>Expected columns</strong><span>Outlet Id, Citi Lead, Mode of Ops, Live Date, Supply start date, Status, Closed/Dropped Date, Admin POC, Contact No, Vendor Name, Vendor Rate</span><em>Duplicacy Check is not required.</em></div>{result ? <div className="blinkit-import-result" role="status"><div><Summary label="Total Rows" value={result.total_rows ?? 0} /><Summary label="Created" value={result.created ?? 0} /><Summary label="Updated" value={result.updated ?? 0} /><Summary label="Skipped" value={result.skipped ?? 0} /></div>{errors.length > 0 && <table><thead><tr><th>Row</th><th>Outlet ID</th><th>Reason</th></tr></thead><tbody>{errors.map((item, index) => <tr key={`${item.row_number}-${index}`}><td>{display(item.row_number)}</td><td>{display(item.outlet_id)}</td><td>{safeReason(item.reason)}</td></tr>)}</tbody></table>}<button type="button" onClick={onClose}>Close</button></div> : <form onSubmit={submit}><label className="blinkit-upload"><span>Excel file</span><input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>{error && <div className="blinkit-error" role="alert">{error}</div>}<div className="blinkit-modal-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Uploading…" : "Upload Metadata"}</button></div></form>}</section></div>;
}
