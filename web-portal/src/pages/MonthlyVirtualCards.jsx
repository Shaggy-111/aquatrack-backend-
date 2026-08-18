import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { API_BASE_URL } from "../config";
import AccessDenied from "../components/AccessDenied";
import usePermissions from "../hooks/usePermissions";
import { PERMISSIONS } from "../permissions";
import { clearPermissionsCache } from "../hooks/usePermissions";
import { clearSidebarCache } from "../hooks/useSidebar";
import { clearPermissionCatalogCache } from "../hooks/usePermissionCatalog";
import logo from "../assets/logo.png";
import veekayStamp from "../assets/veekay-stamp.png";
import "./MonthlyVirtualCards.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PAGE_SIZES = [25, 50, 100];
const COMPANY_NAME = "VEE KAY AQUATECH PVT LTD";

const getToken = () => localStorage.getItem("auth_token") || localStorage.getItem("userToken") || localStorage.getItem("partner_token");
const getIstNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
const initialFilters = () => { const now = getIstNow(); return { year: now.getFullYear(), month: now.getMonth() + 1, store_id: "", region: "", channel: "", entity: "", status: "" }; };
const display = (value) => value === null || value === undefined || value === "" ? "—" : String(value);
const formatDateTime = (value) => { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-IN"); };
const daysInMonth = (year, month) => new Date(Number(year), Number(month), 0).getDate();
const dateKey = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const rowsFrom = (payload, key) => Array.isArray(payload) ? payload : Array.isArray(payload?.[key]) ? payload[key] : [];
const storeField = (store, key) => store?.[key] ?? store?.[key.charAt(0).toUpperCase() + key.slice(1)];
const uniqueOptions = (values) => [...values.reduce((items, value) => { const text = String(value || "").trim(); if (text && !items.has(text.toLocaleLowerCase())) items.set(text.toLocaleLowerCase(), text); return items; }, new Map()).values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
const sessionExpired = (navigate) => {
  ["auth_token", "userToken", "partner_token", "user_role", "store_id", "store_name"].forEach((key) => localStorage.removeItem(key));
  clearPermissionsCache(); clearSidebarCache(); clearPermissionCatalogCache();
  navigate("/login");
};
const normalizedDetail = (error) => String(error?.response?.data?.detail || error?.response?.data?.message || "").toLowerCase();
const errorMessage = (error, fallback, onUnauthorized) => {
  const status = error?.response?.status;
  if (status === 400) return "The selected month or entry date is invalid.";
  if (status === 401) { onUnauthorized?.(); return "Your session has expired. Please sign in again."; }
  if (status === 403) return "You do not have permission to view this resource.";
  if (status === 404) return "The requested virtual card was not found.";
  if (status === 409) { const detail = normalizedDetail(error); if (detail.includes("closed")) return "This monthly card is closed and cannot be updated."; if (detail.includes("inactive")) return "This store is inactive and cannot receive an entry."; if (detail.includes("partner") && detail.includes("map")) return "The store does not have a valid partner mapping."; if (detail.includes("ambiguous") || detail.includes("quantit")) return "The bottle quantities are ambiguous. Review the final delivered and empty values."; if (detail.includes("negative") || detail.includes("balance")) return "This update would create a negative bottle balance."; return "This entry conflicts with the current card or store state."; }
  if (status === 422) { const fields = error?.response?.data?.detail; const allowed = new Set(["entry_date", "bottles_delivered", "empty_bottles_collected", "remarks", "year", "month"]); if (Array.isArray(fields)) { const field = fields.map((item) => Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : "").find((name) => allowed.has(name)); if (field) return `Please correct the ${String(field).replaceAll("_", " ")} field.`; } return "Please check the entered date and quantities and try again."; }
  return fallback;
};

const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
function useDialogBehavior(dialogRef, onClose, pending = false) {
  const restoreRef = useRef(null);
  useEffect(() => { restoreRef.current = document.activeElement; const timer = window.setTimeout(() => dialogRef.current?.querySelector(focusableSelector)?.focus(), 0); return () => { window.clearTimeout(timer); restoreRef.current?.focus?.(); }; }, [dialogRef]);
  useEffect(() => { const handle = (event) => { if (event.key === "Escape") { if (!pending) onClose(); return; } if (event.key !== "Tab") return; const items = [...(dialogRef.current?.querySelectorAll(focusableSelector) || [])]; if (!items.length) return; const first = items[0]; const last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }; window.addEventListener("keydown", handle); return () => window.removeEventListener("keydown", handle); }, [dialogRef, onClose, pending]);
}

export default function MonthlyVirtualCards() {
  const navigate = useNavigate();
  const { hasPermission, permissionsLoading } = usePermissions();
  const canView = hasPermission(PERMISSIONS.MONTHLY_VIRTUAL_CARDS_VIEW);
  const canGenerate = hasPermission(PERMISSIONS.MONTHLY_VIRTUAL_CARDS_GENERATE);
  const canUpdate = hasPermission(PERMISSIONS.MONTHLY_VIRTUAL_CARDS_UPDATE);
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedCard, setSelectedCard] = useState(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [storeMaster, setStoreMaster] = useState([]);
  const listRequestRef = useRef({ id: 0, controller: null });
  const storeMasterRequestRef = useRef({ loaded: false, pending: false, controller: null });
  const handleUnauthorized = useCallback(() => sessionExpired(navigate), [navigate]);

  const loadCards = useCallback(async () => {
    if (permissionsLoading || !canView) return;
    listRequestRef.current.controller?.abort();
    const controller = new AbortController(); const requestId = listRequestRef.current.id + 1; listRequestRef.current = { id: requestId, controller };
    setLoading(true); setError("");
    try {
      const response = await axios.get(`${API_BASE_URL}/monthly-virtual-cards`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        params: { year: filters.year, month: filters.month, store_id: filters.store_id || undefined, region: filters.region || undefined, channel: filters.channel || undefined, entity: filters.entity || undefined, status: filters.status || undefined },
        signal: controller.signal,
      });
      if (listRequestRef.current.id === requestId) setCards(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      if (controller.signal.aborted || listRequestRef.current.id !== requestId) return;
      setCards([]); setError(errorMessage(requestError, "Unable to load monthly virtual cards.", handleUnauthorized));
    } finally { if (listRequestRef.current.id === requestId) setLoading(false); }
  }, [canView, filters, handleUnauthorized, permissionsLoading]);

  useEffect(() => { loadCards(); }, [loadCards]);
  const loadStoreMaster = useCallback(() => {
    if (storeMasterRequestRef.current.loaded || storeMasterRequestRef.current.pending) return;
    const controller = new AbortController(); storeMasterRequestRef.current = { loaded: false, pending: true, controller };
    axios.get(`${API_BASE_URL}/store/store/list/all`, { headers: { Authorization: `Bearer ${getToken()}` }, signal: controller.signal })
      .then((response) => { setStoreMaster(rowsFrom(response.data, "stores")); storeMasterRequestRef.current.loaded = true; })
      .catch((requestError) => { if (!controller.signal.aborted && requestError?.response?.status === 401) handleUnauthorized(); })
      .finally(() => { storeMasterRequestRef.current.pending = false; });
  }, [handleUnauthorized]);
  useEffect(() => () => { listRequestRef.current.id += 1; listRequestRef.current.controller?.abort(); storeMasterRequestRef.current.controller?.abort(); }, []);
  const regionOptions = useMemo(() => uniqueOptions(storeMaster.map((store) => storeField(store, "region"))), [storeMaster]);
  const channelOptions = useMemo(() => uniqueOptions(storeMaster.map((store) => storeField(store, "channel"))), [storeMaster]);
  const entityOptions = useMemo(() => uniqueOptions([...storeMaster.map((store) => storeField(store, "entity")), "AMB"]), [storeMaster]);
  const pageCount = Math.max(1, Math.ceil(cards.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleCards = useMemo(() => cards.slice((safePage - 1) * pageSize, safePage * pageSize), [cards, safePage, pageSize]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const updateDraft = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const applyFilters = (event) => { event.preventDefault(); setPage(1); setFilters({ ...draft, year: Number(draft.year), month: Number(draft.month) }); };
  const resetFilters = () => { const next = initialFilters(); setDraft(next); setPage(1); setFilters(next); };

  if (permissionsLoading) return <div className="mvc-state">Loading permissions…</div>;
  if (!canView) return <AccessDenied />;

  return <main className="mvc-page">
    <header className="mvc-header"><div><span>Store operations</span><h2>Monthly Virtual Cards</h2><p>Review month-wise virtual cards and daily entries for every store.</p></div><div className="mvc-header-actions">{canGenerate && <button type="button" className="mvc-generate" onClick={() => setGenerateOpen(true)}>Generate Cards</button>}<button type="button" onClick={loadCards} disabled={loading}>↻ Refresh</button></div></header>
    <form className="mvc-card mvc-filters" onSubmit={applyFilters}>
      <Field label="Year"><select aria-label="Year" value={draft.year} onChange={(e) => updateDraft("year", e.target.value)}>{Array.from({ length: 7 }, (_, i) => getIstNow().getFullYear() + 1 - i).map((year) => <option key={year}>{year}</option>)}</select></Field>
      <Field label="Month"><select aria-label="Month" value={draft.month} onChange={(e) => updateDraft("month", e.target.value)}>{MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></Field>
      <Field label="Store ID / Search"><input aria-label="Store ID / Search" value={draft.store_id} onChange={(e) => updateDraft("store_id", e.target.value)} placeholder="All stores" /></Field>
      <Field label="Region"><FilterSelect label="Region" value={draft.region} onChange={(e) => updateDraft("region", e.target.value)} onFocus={loadStoreMaster} allLabel="All Regions" options={regionOptions} /></Field>
      <Field label="Channel"><FilterSelect label="Channel" value={draft.channel} onChange={(e) => updateDraft("channel", e.target.value)} onFocus={loadStoreMaster} allLabel="All Channels" options={channelOptions} /></Field>
      <Field label="Entity"><FilterSelect label="Entity" value={draft.entity} onChange={(e) => updateDraft("entity", e.target.value)} onFocus={loadStoreMaster} allLabel="All Entities" options={entityOptions} /></Field>
      <Field label="Status"><select aria-label="Status" value={draft.status} onChange={(e) => updateDraft("status", e.target.value)}><option value="">All</option><option value="open">Open</option><option value="closed">Closed</option></select></Field>
      <div className="mvc-filter-actions"><button type="submit" className="primary" disabled={loading}>Apply</button><button type="button" onClick={resetFilters} disabled={loading}>Reset</button></div>
    </form>
    {error && <div className="mvc-error" role="alert">{error}</div>}
    <section className="mvc-card mvc-table-card">
      <div className="mvc-toolbar"><div><h3>Virtual cards</h3><p>{loading ? "Loading cards…" : `${cards.length.toLocaleString("en-IN")} cards`}</p></div><label>Rows per page <select aria-label="Rows per page" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{PAGE_SIZES.map((size) => <option key={size}>{size}</option>)}</select></label></div>
      <div className="mvc-table-wrap"><table><thead><tr><th>Card ID</th><th>Store ID</th><th>Year / Month</th><th>Status</th><th>Created At</th><th>Updated At</th><th>Action</th></tr></thead><tbody>
        {loading ? Array.from({ length: 6 }, (_, i) => <tr className="mvc-skeleton" key={i}>{Array.from({ length: 7 }, (_, j) => <td key={j}><i /></td>)}</tr>) : visibleCards.length ? visibleCards.map((card) => <tr key={card.id}><td>#{display(card.id)}</td><td>{display(card.store_id)}</td><td>{MONTHS[Number(card.month) - 1] || display(card.month)} {display(card.year)}</td><td><Status value={card.status} /></td><td>{formatDateTime(card.created_at)}</td><td>{formatDateTime(card.updated_at)}</td><td><button type="button" className="mvc-view" onClick={() => setSelectedCard(card)}>View Card</button></td></tr>) : <tr><td className="mvc-empty" colSpan="7"><strong>No virtual cards found</strong><span>Try changing the selected month or filters.</span></td></tr>}
      </tbody></table></div>
      <div className="mvc-pagination"><span>Showing {cards.length ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, cards.length)} of {cards.length}</span><div><button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>←</button><span>Page {safePage} of {pageCount}</span><button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage === pageCount}>→</button></div></div>
    </section>
    {selectedCard && <CardDrawer card={selectedCard} canUpdate={canUpdate} onUnauthorized={handleUnauthorized} onClose={() => setSelectedCard(null)} />}
    {generateOpen && canGenerate && <GenerateModal filters={filters} onClose={() => setGenerateOpen(false)} onGenerated={loadCards} onUnauthorized={handleUnauthorized} />}
  </main>;
}

const Field = ({ label, children }) => <label className="mvc-field"><span>{label}</span>{children}</label>;
const FilterSelect = ({ label, value, onChange, onFocus, allLabel, options }) => <select aria-label={label} value={value} onChange={onChange} onFocus={onFocus}><option value="">{allLabel}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
const Status = ({ value }) => <span className={`mvc-status mvc-status-${String(value || "").toLowerCase()}`}>{display(value)}</span>;

function GenerateModal({ filters, onClose, onGenerated, onUnauthorized }) {
  const [year, setYear] = useState(filters.year); const [month, setMonth] = useState(filters.month); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [result, setResult] = useState(null);
  const submitLock = useRef(false); const dialogRef = useRef(null); useDialogBehavior(dialogRef, onClose, saving);
  const submit = async (event) => { event.preventDefault(); if (submitLock.current) return; const numericYear = Number(year); const numericMonth = Number(month); if (!Number.isInteger(numericYear) || numericYear < 2020 || numericYear > 2100) return setError("Year must be an integer from 2020 to 2100."); if (!Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) return setError("Month must be from 1 to 12."); submitLock.current = true; setSaving(true); setError(""); try { const response = await axios.post(`${API_BASE_URL}/monthly-virtual-cards/generate`, { year: numericYear, month: numericMonth }, { headers: { Authorization: `Bearer ${getToken()}` } }); setResult(response.data || {}); await onGenerated(); } catch (requestError) { setError(errorMessage(requestError, "Unable to generate monthly virtual cards.", onUnauthorized)); } finally { submitLock.current = false; setSaving(false); } };
  return <div className="mvc-modal-backdrop" data-testid="generate-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}><section ref={dialogRef} className="mvc-modal" role="dialog" aria-modal="true" aria-labelledby="generate-title"><h2 id="generate-title">Generate Monthly Cards</h2><p>This will ensure one monthly card exists for every active store. Existing cards will not be duplicated.</p>{result ? <div className="mvc-success" role="status"><strong>Cards generated successfully</strong><span>Total active stores: {display(result.total_active_stores)}</span><span>Created: {display(result.created_count)}</span><span>Already existing: {display(result.existing_count)}</span><button type="button" onClick={onClose}>Close</button></div> : <form onSubmit={submit}><div className="mvc-modal-grid"><Field label="Year"><input aria-label="Generate year" type="number" min="2020" max="2100" step="1" value={year} onChange={(e) => setYear(e.target.value)} required /></Field><Field label="Month"><select aria-label="Generate month" value={month} onChange={(e) => setMonth(e.target.value)}>{MONTHS.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></Field></div>{error && <div className="mvc-error" role="alert">{error}</div>}<div className="mvc-modal-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Generating…" : "Generate Cards"}</button></div></form>}</section></div>;
}

function CardDrawer({ card, canUpdate, onUnauthorized, onClose }) {
  const [detail, setDetail] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [entryModal, setEntryModal] = useState(null); const [saveSummary, setSaveSummary] = useState(null); const [mutationPending, setMutationPending] = useState(false); const [editError, setEditError] = useState("");
  const detailRequestRef = useRef({ id: 0, controller: null }); const dialogRef = useRef(null); useDialogBehavior(dialogRef, onClose, mutationPending || Boolean(entryModal));
  const loadDetail = useCallback(async () => { detailRequestRef.current.controller?.abort(); const controller = new AbortController(); const requestId = detailRequestRef.current.id + 1; detailRequestRef.current = { id: requestId, controller }; setLoading(true); setError(""); try { const response = await axios.get(`${API_BASE_URL}/monthly-virtual-cards/store/${encodeURIComponent(card.store_id)}/${card.year}/${card.month}`, { headers: { Authorization: `Bearer ${getToken()}` }, signal: controller.signal }); if (detailRequestRef.current.id === requestId) setDetail(response.data); } catch (requestError) { if (controller.signal.aborted || detailRequestRef.current.id !== requestId) return; setError(errorMessage(requestError, "Unable to load this virtual card.", onUnauthorized)); } finally { if (detailRequestRef.current.id === requestId) setLoading(false); } }, [card, onUnauthorized]);
  useEffect(() => { loadDetail(); }, [loadDetail]);
  useEffect(() => () => { detailRequestRef.current.id += 1; detailRequestRef.current.controller?.abort(); }, []);
  const entries = useMemo(() => [...(detail?.entries || [])].sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date))), [detail]);
  const openEdit = (entry) => { const quantities = [entry.bottles_delivered, entry.empty_bottles_collected]; if (!quantities.every((value) => Number.isInteger(Number(value)) && Number(value) >= 0)) { setEditError("This entry cannot be edited because its current bottle quantities are unavailable or invalid."); return; } setEditError(""); setEntryModal({ mode: "edit", entry }); };
  const printRawCard = () => { document.body.classList.add("mvc-printing-raw"); try { window.print(); } finally { document.body.classList.remove("mvc-printing-raw"); } };
  return <div className="mvc-drawer-backdrop" data-testid="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !entryModal && !mutationPending) onClose(); }}><aside ref={dialogRef} className="mvc-drawer" role="dialog" aria-modal="true" aria-label={`${display(detail?.store_name || card.store_name)} card details`}><button type="button" className="mvc-close" onClick={onClose} disabled={mutationPending} aria-label="Close card details">×</button>
    <div className="mvc-drawer-content" aria-hidden={Boolean(entryModal)} {...(entryModal ? { inert: "" } : {})}>{loading ? <div className="mvc-state">Loading card details…</div> : error ? <div className="mvc-error" role="alert">{error}</div> : detail && <><div className="mvc-detail-toolbar"><div className="mvc-drawer-heading"><span>Monthly virtual card</span><div><h2 id="mvc-drawer-title">Card Details</h2><Status value={detail.status} /></div></div><div className="mvc-drawer-actions"><button type="button" onClick={() => window.print()}>Print Card</button><button type="button" onClick={() => window.print()}>Print / Save PDF</button><button type="button" onClick={printRawCard}>Download Raw Card</button>{canUpdate && <button type="button" className="primary" onClick={() => setEntryModal({ mode: "add" })} disabled={mutationPending}>Add Entry</button>}</div></div>
      <div className="mvc-detail-layout" data-testid="monthly-card-detail-layout"><section className="mvc-card-column" data-testid="monthly-card-left-column"><PrintableCard card={detail} entries={entries} /><div className="mvc-details mvc-screen-details"><Detail label="Store ID" value={detail.store_id} /><Detail label="Entity" value={detail.entity} /><Detail label="Channel" value={detail.channel} /><Detail label="Region" value={detail.region} /><Detail label="State / City" value={[detail.state, detail.city].filter(Boolean).join(" / ")} /><Detail label="Project code" value={detail.project_code} /><Detail label="Month / Year" value={`${MONTHS[Number(detail.month) - 1] || detail.month} ${detail.year}`} /><Detail label="QR public ID" value={detail.qr_public_id} /><Detail label="Address" value={[detail.address, detail.zip_code].filter(Boolean).join(", ")} wide /></div></section>
        <section className="mvc-digital-column" data-testid="monthly-card-right-column">{saveSummary && <div className="mvc-success mvc-save-summary" role="status"><strong>Entry saved successfully</strong><span>Order {saveSummary.order_created ? "created" : "reused"}: {display(saveSummary.order_id)}</span><span>Entry {saveSummary.entry_created ? "created" : "updated"}</span><span>Final delivered: {display(saveSummary.final_bottles_delivered)} · Final empty: {display(saveSummary.final_empty_bottles_collected)} · Pending empty balance: {display(saveSummary.store_pending_empty_bottles)}</span></div>}{editError && <div className="mvc-error" role="alert">{editError}</div>}
          <section className="mvc-digital-entries"><div className="mvc-entry-heading"><div><span className="mvc-section-kicker">Digital record</span><h3 className="mvc-entry-title">Detailed Digital Entries</h3></div><span className="mvc-entry-count">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span></div><div className="mvc-table-wrap"><table className="mvc-entry-table"><thead><tr><th>Date</th><th>Delivered Bottles</th><th>Empty Bottles</th><th>Source</th><th>Remarks</th><th>Linked Order IDs</th><th>Created By</th><th>Updated By</th><th>Created At</th><th>Updated At</th>{canUpdate && <th>Action</th>}</tr></thead><tbody>{entries.length ? entries.map((entry) => <tr key={entry.id || entry.entry_date}><td>{display(entry.entry_date)}</td><td>{display(entry.bottles_delivered)}</td><td>{display(entry.empty_bottles_collected)}</td><td>{display(entry.entry_source)}</td><td>{display(entry.remarks)}</td><td>{entry.linked_order_ids?.length ? entry.linked_order_ids.join(", ") : "—"}</td><td>{display(entry.created_by_id)}</td><td>{display(entry.updated_by_id)}</td><td>{formatDateTime(entry.created_at)}</td><td>{formatDateTime(entry.updated_at)}</td>{canUpdate && <td><button type="button" className="mvc-view" onClick={() => openEdit(entry)} disabled={mutationPending}>Edit</button></td>}</tr>) : <tr><td className="mvc-empty" colSpan={canUpdate ? 11 : 10}>No entries recorded for this card.</td></tr>}</tbody></table></div><div className="mvc-entry-pagination"><span>Showing all {entries.length} entries</span><span>Page 1 of 1</span></div></section>
          <aside className="mvc-info-box mvc-raw-card-info"><div><strong>About Raw Card</strong><span>Raw card provides a completely blank monthly grid for manual handwritten entry by the vendor.</span></div><button type="button" onClick={printRawCard}>Download Raw Card</button></aside>
          <aside className="mvc-info-box mvc-qr-verification"><div><strong>Verified by QR Scan</strong><span>This card is linked to the store’s unique QR code for verification and authenticity.</span></div></aside>
        </section>
      </div></>}</div>
    {entryModal && canUpdate && <EntryModal card={detail || card} context={entryModal} onUnauthorized={onUnauthorized} onBusy={setMutationPending} onComplete={() => setEntryModal(null)} onClose={() => { if (!mutationPending) setEntryModal(null); }} onSaved={async (summary) => { setSaveSummary(summary); await loadDetail(); }} />}
  </aside></div>;
}
const Detail = ({ label, value, wide }) => <div className={wide ? "wide" : ""}><span>{label}</span><strong>{display(value)}</strong></div>;

function PrintableCard({ card, entries }) {
  const entryByDate = useMemo(() => { const map = new Map(); entries.forEach((entry) => { if (!map.has(entry.entry_date)) map.set(entry.entry_date, entry); }); return map; }, [entries]);
  const rows = Array.from({ length: daysInMonth(card.year, card.month) }, (_, index) => { const key = dateKey(card.year, card.month, index + 1); return { key, entry: entryByDate.get(key) }; });
  const candidateQrUrl = typeof card?.qr_public_url === "string" ? card.qr_public_url.trim() : "";
  const signedQrUrl = candidateQrUrl.startsWith("https://veekayaquatech.com/qr/") ? candidateQrUrl : "";
  return <article className="mvc-print-card" aria-label="Printable monthly virtual delivery card"><header className="mvc-print-header"><div className="mvc-print-brand"><img src={logo} alt="Veekay" /><div><h2>{COMPANY_NAME}</h2><p>Monthly Virtual Delivery Card</p></div></div><div className="mvc-print-period"><strong>{MONTHS[Number(card.month) - 1]} {card.year}</strong><Status value={card.status} /></div><div className="mvc-print-qr"><div className="mvc-qr-surface">{signedQrUrl ? <QRCodeSVG value={signedQrUrl} size={160} level="M" bgColor="#FFFFFF" fgColor="#000000" includeMargin title="Store verification QR code" /> : <span className="mvc-qr-unavailable" role="status">QR unavailable</span>}</div><small>Scan to verify store</small></div></header><section className="mvc-print-store"><PrintField label="Store Name" value={card.store_name} /><PrintField label="Store / Outlet ID" value={card.store_id} /><PrintField label="Entity" value={card.entity} /><PrintField label="Channel" value={card.channel} /><PrintField label="Project Code" value={card.project_code} /><PrintField label="Region" value={card.region} /><PrintField label="State" value={card.state} /><PrintField label="City" value={card.city} /><PrintField label="Address" value={[card.address, card.zip_code].filter(Boolean).join(", ")} wide /><PrintField label="QR Public ID" value={card.qr_public_id} wide /></section><table className="mvc-print-grid"><thead><tr><th>Date</th><th>Filled / Delivered Bottles</th><th>Empty Bottles Collected</th><th>Remarks</th><th>Vendor Signature</th></tr></thead><tbody>{rows.map(({ key, entry }) => <tr key={key} data-testid="print-day-row"><td>{key}</td><td>{entry ? display(entry.bottles_delivered) : ""}</td><td>{entry ? display(entry.empty_bottles_collected) : ""}</td><td>{entry ? display(entry.remarks) : ""}</td><td /></tr>)}</tbody></table><footer className="mvc-print-footer"><div className="mvc-signatures"><span>Store Manager Signature</span><span>Delivery Executive Signature</span></div><div className="mvc-print-verification-note">This card may be maintained digitally or printed for manual verification. Verify this card using the linked store QR.</div><div className="mvc-print-bottom"><img className="mvc-official-stamp" src={veekayStamp} alt="Veekay official stamp" /><span>Generated On: {new Date().toLocaleString("en-IN")}</span><strong>Thank you for helping us build a sustainable future.</strong></div></footer></article>;
}
const PrintField = ({ label, value, wide }) => <div className={wide ? "wide" : ""}><span>{label}</span><strong>{display(value)}</strong></div>;

function EntryModal({ card, context, onClose, onSaved, onBusy, onComplete, onUnauthorized }) {
  const edit = context.mode === "edit"; const today = getIstNow(); const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`; const belongs = today.getFullYear() === Number(card.year) && today.getMonth() + 1 === Number(card.month);
  const [form, setForm] = useState({ entry_date: edit ? context.entry.entry_date : belongs ? todayValue : "", bottles_delivered: edit ? String(context.entry.bottles_delivered) : "0", empty_bottles_collected: edit ? String(context.entry.empty_bottles_collected) : "0", remarks: edit ? context.entry.remarks || "" : "" }); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const submitLock = useRef(false); const dialogRef = useRef(null); useDialogBehavior(dialogRef, onClose, saving); const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const validate = () => { if (!form.entry_date) return "Entry date is required."; if (!form.entry_date.startsWith(`${card.year}-${String(card.month).padStart(2, "0")}-`)) return "Entry date must belong to the card month."; if (!/^\d+$/.test(form.bottles_delivered)) return "Final bottles delivered must be a non-negative integer."; if (!/^\d+$/.test(form.empty_bottles_collected)) return "Final empty bottles collected must be a non-negative integer."; if (form.remarks.length > 2000) return "Remarks cannot exceed 2000 characters."; return ""; };
  const submit = async (event) => { event.preventDefault(); if (submitLock.current) return; const invalid = validate(); if (invalid) return setError(invalid); submitLock.current = true; setSaving(true); onBusy(true); setError(""); let succeeded = false; try { const response = await axios.put(`${API_BASE_URL}/monthly-virtual-cards/${card.id}/entries/${form.entry_date}`, { bottles_delivered: Number(form.bottles_delivered), empty_bottles_collected: Number(form.empty_bottles_collected), remarks: form.remarks }, { headers: { Authorization: `Bearer ${getToken()}` } }); await onSaved(response.data || {}); succeeded = true; } catch (requestError) { setError(errorMessage(requestError, "Unable to save this daily entry.", onUnauthorized)); } finally { submitLock.current = false; setSaving(false); onBusy(false); if (succeeded) onComplete(); } };
  return <div className="mvc-modal-backdrop mvc-entry-backdrop" data-testid="entry-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}><section ref={dialogRef} className="mvc-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title"><h2 id="entry-title">{edit ? "Edit Daily Entry" : "Add Daily Entry"}</h2>{edit && <p>Review the current quantities and enter the intended final values before saving.</p>}<form onSubmit={submit}><div className="mvc-modal-grid"><Field label="Entry Date"><input aria-label="Entry date" type="date" value={form.entry_date} onChange={(e) => update("entry_date", e.target.value)} readOnly={edit} required /></Field><Field label="Final Bottles Delivered"><input aria-label="Final Bottles Delivered" inputMode="numeric" value={form.bottles_delivered} onChange={(e) => update("bottles_delivered", e.target.value)} required /></Field><Field label="Final Empty Bottles Collected"><input aria-label="Final Empty Bottles Collected" inputMode="numeric" value={form.empty_bottles_collected} onChange={(e) => update("empty_bottles_collected", e.target.value)} required /></Field><label className="mvc-field mvc-remarks"><span>Remarks</span><textarea aria-label="Remarks" maxLength="2000" value={form.remarks} onChange={(e) => update("remarks", e.target.value)} /><small>{form.remarks.length}/2000</small></label></div>{error && <div className="mvc-error" role="alert">{error}</div>}<div className="mvc-modal-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary" disabled={saving}>{saving ? "Saving…" : "Save Entry"}</button></div></form></section></div>;
}
