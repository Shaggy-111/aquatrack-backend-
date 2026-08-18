import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import { API_BASE_URL } from "../config";
import usePermissions from "../hooks/usePermissions";
import AccessDenied from "../components/AccessDenied";
import { PERMISSIONS } from "../permissions";
import "./Reports.css";

const CHANNELS = ["BLINKIT", "ZEPTO", "IBM", "GENERAL", "CUSTOM"];
const PAGE_SIZES = [10, 25, 50, 100];
const MONTHLY_PIVOT_URL = `${API_BASE_URL}/reports/reports/monthly-pivot/export`;

const normalizeKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const renderValue = (value) => {
  if (value === null || value === undefined || value === "") return "";
  if (["string", "number"].includes(typeof value)) return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleDateString("en-GB");
  if (Array.isArray(value)) return value.map(renderValue).join(", ");
  if (typeof value === "object") {
    const property = ["name", "label", "title", "code", "value", "id"]
      .map((key) => value[key])
      .find((item) => item !== null && item !== undefined && typeof item !== "object");
    if (property !== undefined) return String(property);
    try { return JSON.stringify(value); } catch { return ""; }
  }
  return String(value);
};

const findHeaderRow = (matrix) => {
  const index = matrix.findIndex((row) => {
    const keys = row.map(normalizeKey);
    return keys.includes("region") && keys.includes("channel") &&
      (keys.includes("outlet") || keys.includes("outletname"));
  });
  return index >= 0 ? index : 0;
};

const parseWorkbook = async (blob) => {
  const bytes = await blob.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (!matrix.length) return { headers: [], rows: [] };

  const headerIndex = findHeaderRow(matrix);
  const rawHeaders = matrix[headerIndex].map((value, index) => renderValue(value) || `Column ${index + 1}`);
  const lastColumn = rawHeaders.reduce((last, header, index) => header ? index : last, -1);
  const headers = rawHeaders.slice(0, lastColumn + 1);
  const rows = matrix
    .slice(headerIndex + 1)
    .map((row) => headers.map((_, index) => renderValue(row[index])))
    .filter((row) => row.some((value) => value !== ""));
  return { headers, rows };
};

const Reports = () => {
  const token =
    localStorage.getItem("auth_token") ||
    localStorage.getItem("partner_token") ||
    localStorage.getItem("userToken");
  const userChannel =
    localStorage.getItem("channel_name") ||
    localStorage.getItem("channel") ||
    localStorage.getItem("channelName") ||
    "";
  const { hasPermission, permissionsLoading } = usePermissions();
  const canViewReports = hasPermission(PERMISSIONS.REPORTS_VIEW);
  const canExportReports = hasPermission(PERMISSIONS.REPORTS_EXPORT);
  const canUploadReports = hasPermission(PERMISSIONS.REPORTS_UPLOAD);
  const fixedChannel = !permissionsLoading && !canExportReports && userChannel
    ? userChannel.toUpperCase()
    : "";

  const [filters, setFilters] = useState({
    fromDate: "",
    toDate: "",
    channel: fixedChannel,
    state: "",
    city: "",
  });
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [workbookBlob, setWorkbookBlob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [manualFile, setManualFile] = useState(null);
  const [uploadingManual, setUploadingManual] = useState(false);

  useEffect(() => {
    if (fixedChannel) {
      setFilters((current) => ({ ...current, channel: fixedChannel }));
    }
  }, [fixedChannel]);

  const updateFilter = (name, value) => {
    setFilters((current) => ({
      ...current,
      [name]: value,
      ...(name === "state" ? { city: "" } : {}),
    }));
    setPage(1);
  };

  const generateReport = async (nextFilters = filters) => {
    if (!nextFilters.fromDate || !nextFilters.toDate) {
      setHeaders([]);
      setRows([]);
      setWorkbookBlob(null);
      setError("Select both Date From and Date To to generate the daily report.");
      return;
    }
    if (nextFilters.fromDate > nextFilters.toDate) {
      setError("Date From cannot be after Date To.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await axios.get(MONTHLY_PIVOT_URL, {
        params: {
          from_date: nextFilters.fromDate,
          to_date: nextFilters.toDate,
          state: nextFilters.state || undefined,
          city: nextFilters.city || undefined,
          channel: nextFilters.channel || undefined,
        },
        responseType: "blob",
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const parsed = await parseWorkbook(blob);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setWorkbookBlob(blob);
      setPage(1);
    } catch (requestError) {
      console.error("Daily pivot report failed:", requestError);
      setHeaders([]);
      setRows([]);
      setWorkbookBlob(null);
      setError("Unable to generate the daily matrix report.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (permissionsLoading || !canViewReports || !filters.fromDate || !filters.toDate) return undefined;
    const timer = window.setTimeout(() => generateReport(filters), 350);
    return () => window.clearTimeout(timer);
    // Every report filter regenerates the legacy workbook and its date columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.fromDate, filters.toDate, filters.channel, filters.state, filters.city, permissionsLoading, canViewReports]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize]
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const exportWorkbook = () => {
    if (!workbookBlob) return;
    const url = window.URL.createObjectURL(workbookBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Distribution_${filters.fromDate}_to_${filters.toDate}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setFilters({ fromDate: "", toDate: "", channel: fixedChannel, state: "", city: "" });
    setHeaders([]);
    setRows([]);
    setWorkbookBlob(null);
    setError("");
    setPage(1);
  };

  const handleManualDeliveryUpload = async () => {
    if (!manualFile) return window.alert("Please select an Excel file.");
    if (!window.confirm("Are you sure you want to upload this Excel?\n\nThis action will automatically mark orders as delivered and may create missing orders.")) return;
    if (window.prompt("Enter 4-digit security PIN to continue:") !== "5518") {
      return window.alert("Invalid security PIN. Upload cancelled.");
    }
    try {
      setUploadingManual(true);
      const formData = new FormData();
      formData.append("file", manualFile);
      const response = await axios.post(`${API_BASE_URL}/reports/reports/upload-manual-delivery`, formData, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
      });
      const data = response.data || {};
      window.alert(`Upload Successful!\n\nStores Processed: ${renderValue(data.stores_processed)}\nOrders Updated: ${renderValue(data.orders_updated)}\nOrders Created: ${renderValue(data.orders_created)}\nSkipped: ${renderValue(data.skipped)}`);
      setManualFile(null);
      if (filters.fromDate && filters.toDate) await generateReport();
    } catch (uploadError) {
      console.error("Upload failed:", uploadError);
      window.alert(renderValue(uploadError?.response?.data?.detail) || "Manual delivery upload failed.");
    } finally {
      setUploadingManual(false);
    }
  };

  if (!permissionsLoading && !canViewReports) return <AccessDenied />;

  return (
    <div className="reports-page">
      <div className="reports-heading">
        <div>
          <p className="reports-eyebrow">Delivery reports</p>
          <h2>Daily Distribution Report</h2>
          <p>One store per row with delivered bottle counts for every selected day.</p>
        </div>
        {canExportReports && (
          <button className="reports-button reports-button-export" onClick={exportWorkbook} disabled={!workbookBlob || loading}>
            Export Excel
          </button>
        )}
      </div>

      {canUploadReports && (
        <section className="reports-card reports-upload-card">
          <div><h3>Manual Delivery Upload</h3><p>Upload Excel to mark orders as delivered and create missing orders.</p></div>
          <div className="reports-upload-actions">
            <input type="file" accept=".xlsx,.xls" onChange={(event) => setManualFile(event.target.files?.[0] || null)} />
            <button className="reports-button reports-button-primary" onClick={handleManualDeliveryUpload} disabled={!manualFile || uploadingManual}>
              {uploadingManual ? "Uploading…" : "Upload Excel"}
            </button>
          </div>
        </section>
      )}

      <section className="reports-card reports-filters">
        <div className="reports-section-title">
          <div><h3>Report Filters</h3><p>Changing the date range regenerates the daily columns.</p></div>
        </div>
        <div className="reports-filter-grid reports-filter-grid-pivot">
          <Field label="Date From"><input type="date" value={filters.fromDate} onChange={(event) => updateFilter("fromDate", event.target.value)} /></Field>
          <Field label="Date To"><input type="date" value={filters.toDate} onChange={(event) => updateFilter("toDate", event.target.value)} /></Field>
          <Field label="Channel">
            <select value={filters.channel} onChange={(event) => updateFilter("channel", event.target.value)} disabled={Boolean(fixedChannel)}>
              <option value="">All Channels</option>
              {CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
            </select>
          </Field>
          <Field label="State"><input value={filters.state} onChange={(event) => updateFilter("state", event.target.value)} placeholder="All States" /></Field>
          <Field label="City"><input value={filters.city} onChange={(event) => updateFilter("city", event.target.value)} placeholder="All Cities" /></Field>
          <div className="reports-filter-actions">
            <button className="reports-button reports-button-primary" onClick={() => generateReport()} disabled={loading || !filters.fromDate || !filters.toDate}>{loading ? "Generating…" : "Generate Report"}</button>
            <button className="reports-button reports-button-secondary" onClick={resetFilters} disabled={loading}>Reset</button>
          </div>
        </div>
        {error && <div className="reports-error" role="alert">{error}</div>}
      </section>

      <section className="reports-card reports-table-card">
        <div className="reports-table-toolbar">
          <div><h3>Daily Delivery Matrix</h3><p>{loading ? "Loading report…" : `${rows.length.toLocaleString("en-IN")} stores`}</p></div>
          <label>Rows per page <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        </div>
        <div className="reports-table-wrap">
          <table className="reports-table reports-pivot-table">
            <thead><tr><th className="reports-row-number">#</th>{headers.map((header, index) => <th key={`${String(header)}-${index}`}>{renderValue(header)}</th>)}</tr></thead>
            <tbody>
              {loading ? Array.from({ length: 8 }, (_, rowIndex) => <tr key={`skeleton-${rowIndex}`} className="reports-skeleton-row"><td><i /></td>{Array.from({ length: Math.max(headers.length, 8) }, (_, cellIndex) => <td key={`skeleton-${rowIndex}-${cellIndex}`}><i /></td>)}</tr>) : visibleRows.length ? visibleRows.map((row, rowIndex) => { const absoluteIndex = (safePage - 1) * pageSize + rowIndex; return <tr key={`matrix-row-${absoluteIndex}`}><td className="reports-row-number">{absoluteIndex + 1}</td>{headers.map((_, cellIndex) => <td key={`matrix-cell-${absoluteIndex}-${cellIndex}`} title={String(renderValue(row[cellIndex]))}>{renderValue(row[cellIndex])}</td>)}</tr>; }) : <tr><td className="reports-empty" colSpan={Math.max(headers.length + 1, 2)}><strong>No daily report generated</strong><span>Select a From and To date to load the original matrix report.</span></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="reports-pagination">
          <span>Showing {rows.length ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, rows.length)} of {rows.length}</span>
          <div><button onClick={() => setPage(1)} disabled={safePage === 1}>«</button><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage === 1}>‹</button><span>Page {safePage} of {pageCount}</span><button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage === pageCount}>›</button><button onClick={() => setPage(pageCount)} disabled={safePage === pageCount}>»</button></div>
        </div>
      </section>
    </div>
  );
};

const Field = ({ label, children }) => <label className="reports-field"><span>{label}</span>{children}</label>;

export default Reports;
