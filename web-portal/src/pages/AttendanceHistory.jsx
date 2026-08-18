import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import { API_BASE_URL } from "../config";
import { API_TIMEOUT_MS, getApiErrorMessage } from "../utils/apiErrors";
import { formatAttendanceTime } from "../utils/dateTime";
import "./AttendanceHistory.css";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const getToken = () =>
  localStorage.getItem("auth_token") ||
  localStorage.getItem("userToken") ||
  localStorage.getItem("partner_token");

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
};

const normalizeAttendanceRow = (row) => ({
  ...row,
  check_in: row.check_in ?? row.check_in_time ?? null,
  check_out: row.check_out ?? row.check_out_time ?? null,
  working_hours: row.working_hours,
  late_minutes: row.late_minutes,
});

export default function AttendanceHistory() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "date", direction: "desc" });
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 10;

  const config = useMemo(() => ({ headers: { Authorization: `Bearer ${getToken()}` }, timeout: API_TIMEOUT_MS }), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sortingFields = {
        date: "date",
        checkIn: "check_in",
        checkOut: "check_out",
        workingHours: "working_hours",
        status: "status",
        lateMinutes: "late_minutes",
        earlyDeparture: "early_departure",
        remarks: "remarks",
      };
      const sortingField = sortingFields[sortConfig.key] || "date";
      const response = await axios.get(`${API_BASE_URL}/attendance/all`, {
        ...config,
        params: {
          month,
          year,
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
          search: debouncedSearch || undefined,
          page,
          page_size: pageSize,
          sorting: sortConfig.direction === "asc" ? sortingField : `-${sortingField}`,
        },
      });
      const data = response.data;
      const allRecords = Array.isArray(data?.items) ? data.items.map(normalizeAttendanceRow) : [];
      setRecords(allRecords);
      setTotalCount(Number(data?.total_count) || 0);
      setPage(Number(data?.page) || page);
      setTotalPages(Math.max(1, Number(data?.total_pages) || 1));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to load attendance history."));
      setRecords([]);
      setTotalCount(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [config, month, year, fromDate, toDate, debouncedSearch, page, sortConfig, pageSize]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const years = Array.from({ length: 6 }, (_, index) => now.getFullYear() - index);
  const filteredRecords = records;
  const pageCount = totalPages;
  const pageRecords = records;

  useEffect(() => { setPage(1); }, [month, year, fromDate, toDate, debouncedSearch, sortConfig]);

  const handleSort = (key) => setSortConfig((current) => ({
    key,
    direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
  }));

  const handleExport = () => {
    const rows = filteredRecords.map((record) => ({
      "Date": record.date || record.attendance_date || "",
      "Check In": formatAttendanceTime(record.check_in),
      "Check Out": formatAttendanceTime(record.check_out),
      "Working Hours": record.working_hours ?? "",
      "Status": record.status || "Not Marked",
      "Late Minutes": record.late_minutes ?? "",
      "Early Departure": record.early_departure_minutes ?? record.early_departure ?? "",
      "Remarks": record.remarks ?? record.remark ?? record.notes ?? "",
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: ["Date", "Check In", "Check Out", "Working Hours", "Status", "Late Minutes", "Early Departure", "Remarks"] });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance History");
    XLSX.writeFile(workbook, `Attendance_History_${year}-${String(month).padStart(2, "0")}.xlsx`);
  };

  return (
    <main className="attendance-history-page">
      <div className="attendance-history">
        <section className="attendance-history__header">
          <div className="attendance-history__heading">
            <span className="attendance-history__eyebrow">Employee attendance</span>
            <h1>Attendance History</h1>
            <p>Review, search and export your monthly attendance records.</p>
          </div>
          <div className="attendance-history__header-actions">
            <button type="button" className="attendance-history__export" onClick={handleExport} disabled={loading || filteredRecords.length === 0}>
              <HistoryIcon name="download" /> Export Excel
            </button>
            <button type="button" className="attendance-history__refresh" onClick={loadHistory} disabled={loading} aria-label="Refresh history" title="Refresh history">↻</button>
          </div>
        </section>

        {error && <div role="alert" className="attendance-history__error"><HistoryIcon name="alert" /><span>{error}</span><button type="button" onClick={loadHistory}>Retry</button></div>}

        <section className="attendance-history__card">
          <div className="attendance-history__toolbar">
            <label className="attendance-history__search">
              <HistoryIcon name="search" />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search attendance records..." aria-label="Search attendance records" />
              {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search">×</button>}
            </label>
            <div className="attendance-history__filters">
              <label><span>From</span><input aria-label="From date" type="date" max={toDate || undefined} value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
              <label><span>To</span><input aria-label="To date" type="date" min={fromDate || undefined} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
              <label><span>Month</span><select aria-label="Month" value={month} onChange={(event) => setMonth(Number(event.target.value))}>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
              <label><span>Year</span><select aria-label="Year" value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            </div>
          </div>

          <div className="attendance-history__meta">
            <span><strong>{totalCount}</strong> {totalCount === 1 ? "record" : "records"}</span>
            <span>{MONTHS[month - 1]} {year}</span>
          </div>

          {loading ? <HistorySkeleton /> : filteredRecords.length === 0 ? <HistoryEmptyState hasFilters={Boolean(search || fromDate || toDate)} onClear={() => { setSearch(""); setFromDate(""); setToDate(""); }} /> : <>
            <div className="attendance-history__table-wrap">
              <table className="attendance-history__table">
                <thead><tr>
                  <SortableHeader label="Date" sortKey="date" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Check In" sortKey="checkIn" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Check Out" sortKey="checkOut" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Working Hours" sortKey="workingHours" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Status" sortKey="status" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Late Minutes" sortKey="lateMinutes" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Early Departure" sortKey="earlyDeparture" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Remarks" sortKey="remarks" sortConfig={sortConfig} onSort={handleSort} />
                  <th aria-label="View details" />
                </tr></thead>
                <tbody>{pageRecords.map((record, index) => {
                  const status = String(record.status || "Not Marked");
                  return <tr key={record.attendance_id || record.date || index} onClick={() => setSelectedRecord(record)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelectedRecord(record); }}>
                    <td><div className="attendance-history__date"><span><HistoryIcon name="calendar" /></span><strong>{formatDate(record.date || record.attendance_date)}</strong></div></td>
                    <td>{formatAttendanceTime(record.check_in)}</td>
                    <td>{formatAttendanceTime(record.check_out)}</td>
                    <td><strong>{record.working_hours ?? "—"}</strong></td>
                    <td><StatusBadge status={status} /></td>
                    <td>{record.late_minutes ?? "—"}</td>
                    <td>{record.early_departure_minutes ?? record.early_departure ?? "—"}</td>
                    <td className="attendance-history__remarks" title={record.remarks ?? record.remark ?? record.notes ?? ""}>{record.remarks ?? record.remark ?? record.notes ?? "—"}</td>
                    <td><button type="button" className="attendance-history__row-action" onClick={(event) => { event.stopPropagation(); setSelectedRecord(record); }} aria-label="View attendance details">→</button></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <HistoryPagination page={page} pageCount={pageCount} total={totalCount} pageSize={pageSize} setPage={setPage} />
          </>}
        </section>
      </div>
      {selectedRecord && <HistoryDetailsDrawer record={selectedRecord} onClose={() => setSelectedRecord(null)} />}
    </main>
  );
}

const HistoryIcon = ({ name }) => {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    alert: <><path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
    empty: <><path d="M4 5h16v14H4zM8 2v6M16 2v6M4 10h16" /><path d="M9 15h6" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
};

const SortableHeader = ({ label, sortKey, sortConfig, onSort }) => {
  const active = sortConfig.key === sortKey;
  return <th aria-sort={active ? (sortConfig.direction === "asc" ? "ascending" : "descending") : "none"}><button type="button" className={active ? "is-active" : ""} onClick={() => onSort(sortKey)}>{label}<span>{active ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>;
};

const StatusBadge = ({ status }) => {
  const normalized = status.toLowerCase().replace(/[ _]/g, "-");
  const tone = normalized.includes("present") ? "present" : normalized.includes("absent") ? "absent" : normalized.includes("leave") ? "leave" : normalized.includes("half") ? "half-day" : "neutral";
  return <span className={`attendance-history__status attendance-history__status--${tone}`}><i />{status}</span>;
};

const HistorySkeleton = () => <div className="attendance-history__skeleton" aria-label="Loading attendance history">{Array.from({ length: 7 }, (_, index) => <div key={index}>{Array.from({ length: 7 }, (_, cell) => <span key={cell} />)}</div>)}</div>;

const HistoryEmptyState = ({ hasFilters, onClear }) => <div className="attendance-history__empty"><span><HistoryIcon name="empty" /></span><h2>{hasFilters ? "No matching records" : "No attendance records"}</h2><p>{hasFilters ? "Try adjusting your search or date filter." : "Attendance entries for this month will appear here."}</p>{hasFilters && <button type="button" onClick={onClear}>Clear filters</button>}</div>;

const HistoryPagination = ({ page, pageCount, total, pageSize, setPage }) => {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const visiblePages = Array.from({ length: pageCount }, (_, index) => index + 1).filter((item) => item === 1 || item === pageCount || Math.abs(item - page) <= 1);
  return <div className="attendance-history__pagination"><span>Showing {start}–{end} of {total}</span><div><button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>←</button>{visiblePages.map((item, index) => <React.Fragment key={item}>{index > 0 && item - visiblePages[index - 1] > 1 && <span>…</span>}<button type="button" className={item === page ? "is-current" : ""} onClick={() => setPage(item)}>{item}</button></React.Fragment>)}<button type="button" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>→</button></div></div>;
};

const HistoryDetailsDrawer = ({ record, onClose }) => {
  useEffect(() => {
    const handleEscape = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const status = String(record.status || "Not Marked");
  return <div className="attendance-history__drawer-backdrop" onClick={onClose}><aside className="attendance-history__drawer" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Attendance record details">
    <button type="button" className="attendance-history__drawer-close" onClick={onClose} aria-label="Close details"><HistoryIcon name="close" /></button>
    <span className="attendance-history__drawer-kicker">Attendance record</span><h2>{formatDate(record.date || record.attendance_date)}</h2><StatusBadge status={status} />
    <div className="attendance-history__drawer-times"><div><span><HistoryIcon name="clock" /></span><small>Check In</small><strong>{formatAttendanceTime(record.check_in)}</strong></div><div><span><HistoryIcon name="clock" /></span><small>Check Out</small><strong>{formatAttendanceTime(record.check_out)}</strong></div></div>
    <div className="attendance-history__drawer-details"><HistoryDetail label="Working Hours" value={record.working_hours ?? "—"} /><HistoryDetail label="Late Minutes" value={record.late_minutes ?? "—"} /><HistoryDetail label="Early Departure" value={record.early_departure_minutes ?? record.early_departure ?? "—"} /><HistoryDetail label="Remarks" value={record.remarks ?? record.remark ?? record.notes ?? "—"} wide /></div>
  </aside></div>;
};

const HistoryDetail = ({ label, value, wide = false }) => <div className={wide ? "is-wide" : ""}><span>{label}</span><strong>{value}</strong></div>;
