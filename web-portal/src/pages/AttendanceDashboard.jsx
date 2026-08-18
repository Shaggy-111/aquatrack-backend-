import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API_BASE_URL } from "../config";
import usePermissions from "../hooks/usePermissions";
import AccessDenied from "../components/AccessDenied";
import { PERMISSIONS } from "../permissions";
import { API_TIMEOUT_MS, getApiErrorMessage } from "../utils/apiErrors";
import { formatAttendanceDateTime, formatAttendanceTime } from "../utils/dateTime";
import LeaveManagement from "./LeaveManagement";
import HolidayManagement from "./HolidayManagement";
import "./AttendanceDashboard.css";

const getToken = () =>
  localStorage.getItem("auth_token") ||
  localStorage.getItem("userToken") ||
  localStorage.getItem("partner_token");

const getLocation = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error("Location is not supported by this browser."));
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
    () => reject(new Error("Location permission is required to mark attendance."))
  );
});

const unwrapRecords = (payload) => {
  if (Array.isArray(payload)) return payload;
  const list = payload?.records || payload?.attendance || payload?.history || payload?.items || payload?.data;
  if (Array.isArray(list)) return list;
  return payload && (payload.date || payload.attendance_date || payload.status || payload.check_in_time) ? [payload] : [];
};

const localDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

const fieldValue = (record, ...keys) => keys.map((key) => record?.[key]).find((value) => value !== undefined && value !== null && value !== "");
const employeeKey = (record) => String(fieldValue(record, "employee_id", "user_id", "employee_email", "email", "employee_name", "full_name") || "");

const buildAdminAttendanceParams = (filters, search) => {
  const params = { page: Number(filters.page) || 1, page_size: Number(filters.page_size) || 10 };
  const employeeId = Number(filters.employee_id);
  const storeId = Number(filters.store_id);
  if (filters.employee_id && String(filters.employee_id).toLowerCase() !== "all" && Number.isInteger(employeeId)) params.employee_id = employeeId;
  if (filters.store_id && String(filters.store_id).toLowerCase() !== "all" && Number.isInteger(storeId)) params.store_id = storeId;
  if (filters.status && String(filters.status).toLowerCase() !== "all") params.status = filters.status;
  if (filters.from_date) params.from_date = filters.from_date;
  if (filters.to_date) params.to_date = filters.to_date;
  if (search) params.search = search;
  return params;
};

const exportAttendanceCsv = (records) => {
  const columns = [
    ["Employee", (record) => record.employee_name], ["Employee Code", (record) => record.employee_code],
    ["Email", (record) => record.employee_email], ["Store", (record) => record.store_name],
    ["Attendance Date", (record) => record.attendance_date], ["Check In", (record) => formatAttendanceTime(record.check_in)],
    ["Check Out", (record) => formatAttendanceTime(record.check_out)], ["Working Hours", (record) => record.working_hours],
    ["Attendance Status", (record) => record.attendance_status], ["Late Minutes", (record) => record.late_minutes],
    ["Half Day", (record) => record.half_day], ["Leave Status", (record) => record.leave_status],
    ["Leave Type", (record) => record.leave_type], ["Leave Reason", (record) => record.leave_reason],
    ["Approved By", (record) => record.approved_by], ["Approved At", (record) => formatAttendanceDateTime(record.approved_at)],
    ["Location", (record) => record.latitude != null && record.longitude != null ? `https://maps.google.com/?q=${record.latitude},${record.longitude}` : ""],
  ];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [columns.map(([label]) => escape(label)).join(","), ...records.map((record) => columns.map(([, read]) => escape(read(record))).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `Attendance_${localDateKey()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function AttendanceDashboard() {
  const { hasPermission, permissionsLoading } = usePermissions();
  const canViewAttendance = hasPermission(PERMISSIONS.ATTENDANCE_VIEW);
  const canCheckIn = hasPermission(PERMISSIONS.ATTENDANCE_CHECK_IN);
  const canCheckOut = hasPermission(PERMISSIONS.ATTENDANCE_CHECK_OUT);
  const canApplyLeave = hasPermission(PERMISSIONS.LEAVE_APPLY);
  const canExportAttendance = hasPermission(PERMISSIONS.ATTENDANCE_EXPORT);
  const currentRole = String(localStorage.getItem("user_role") || "").toLowerCase().replace(/[\s_-]/g, "");
  const isEmployeeRole = currentRole === "employee";
  const isSuperAdminRole = currentRole === "superadmin";
  const managementTitle = isSuperAdminRole ? "Attendance Management" : currentRole === "deliverymanager" ? "Team Attendance" : "Store Attendance";
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({ employee_id: "", store_id: "", status: "", from_date: "", to_date: "", search: "", page: 1, page_size: 10 });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());

  const config = useMemo(() => ({ headers: { Authorization: `Bearer ${getToken()}` }, timeout: API_TIMEOUT_MS }), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  const loadAttendance = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const currentDate = new Date();
      if (isEmployeeRole) {
        const [response, summaryResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/attendance/me`, config),
          axios.get(`${API_BASE_URL}/attendance/summary/me`, {
            ...config,
            params: { month: currentDate.getMonth() + 1, year: currentDate.getFullYear() },
          }),
        ]);
        setPayload({ ...response.data, today: response.data, records: [response.data], summary: summaryResponse.data });
      } else if (isSuperAdminRole) {
        const response = await axios.get(`${API_BASE_URL}/attendance/admin/all`, {
          ...config,
          params: buildAdminAttendanceParams(filters, debouncedSearch),
        });
        setPayload(response.data);
      } else {
        const response = await axios.get(`${API_BASE_URL}/attendance/all`, config);
        setPayload(response.data);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to load attendance."));
      setPayload(null);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [config, debouncedSearch, filters.employee_id, filters.from_date, filters.page, filters.page_size, filters.status, filters.store_id, filters.to_date, isEmployeeRole, isSuperAdminRole]);

  useEffect(() => { loadAttendance(); }, [loadAttendance]);
  useEffect(() => {
    const clock = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  const records = useMemo(() => unwrapRecords(payload), [payload]);
  const today = payload?.today || payload?.today_attendance || records.find((record) =>
    localDateKey(record.date || record.attendance_date) === localDateKey()
  ) || {};
  const backendSummary = payload?.summary || payload?.monthly_summary || payload?.totals || {};
  const statusCount = (status) => records.filter((record) => String(record.attendance_status || record.status || "").toLowerCase().replace("_", " ") === status).length;
  const presentCount = statusCount("present");
  const summary = {
    present: fieldValue(backendSummary, "present", "present_days", "present_count") ?? presentCount,
    absent: fieldValue(backendSummary, "absent", "absent_days", "absent_count") ?? statusCount("absent"),
    leave: fieldValue(backendSummary, "leave", "leave_days", "leave_count") ?? records.filter((record) => record.leave_status || String(record.attendance_status || record.status || "").toLowerCase() === "leave").length,
    holiday: fieldValue(backendSummary, "holiday", "holiday_days", "holiday_count") ?? statusCount("holiday"),
    late: fieldValue(backendSummary, "late", "late_count") ?? records.filter((record) => Number(record.late_minutes) > 0).length,
    halfDay: fieldValue(backendSummary, "half_day", "half_day_count") ?? records.filter((record) => Boolean(record.half_day) || ["half day", "half-day"].includes(String(record.attendance_status || record.status || "").toLowerCase().replace("_", " "))).length,
    checkedIn: fieldValue(backendSummary, "checked_in", "checked_in_count") ?? records.filter((record) => fieldValue(record, "check_in_time", "check_in")).length,
    checkedOut: fieldValue(backendSummary, "checked_out", "checked_out_count") ?? records.filter((record) => fieldValue(record, "check_out_time", "check_out")).length,
    workingHours: fieldValue(backendSummary, "working_hours", "total_working_hours") ?? records.reduce((total, record) => total + Number(record.working_hours || record.total_working_hours || 0), 0).toFixed(2),
    percentage: fieldValue(backendSummary, "attendance_percentage", "percentage") ?? (records.length ? ((presentCount / records.length) * 100).toFixed(1) : 0),
    approvedLeaves: fieldValue(backendSummary, "approved_leaves", "approved_leave_count") ?? 0,
    pendingLeaves: fieldValue(backendSummary, "pending_leaves", "pending_leave_count") ?? 0,
  };

  const checkedIn = Boolean(fieldValue(today, "check_in_time", "check_in", "checked_in"));
  const checkedOut = Boolean(fieldValue(today, "check_out_time", "check_out", "checked_out"));

  const markAttendance = async (type) => {
    setActionLoading(true);
    setError("");
    setMessage(type === "checkin" ? "Getting location..." : "Checking out...");
    try {
      const endpoint = type === "checkin" ? "check-in" : "check-out";
      if (type === "checkin") {
        const location = await getLocation();
        await axios.post(`${API_BASE_URL}/attendance/${endpoint}`, null, { ...config, params: location });
      } else {
        await axios.post(`${API_BASE_URL}/attendance/${endpoint}`, null, config);
      }
      setMessage(type === "checkin" ? "Checked in successfully." : "Checked out successfully.");
      await loadAttendance({ quiet: true });
    } catch (requestError) {
      setMessage("");
      setError(getApiErrorMessage(requestError, `Unable to ${type === "checkin" ? "check in" : "check out"}.`));
    } finally {
      setActionLoading(false);
    }
  };

  const filterOptions = useMemo(() => {
    const unique = (values) => [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
    return {
      employees: unique(records.map((record) => record.employee_id)),
      stores: unique(records.map((record) => record.store_id)),
      statuses: unique(records.map((record) => record.attendance_status || record.status)),
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (isSuperAdminRole) return records;
    const includes = (value, filter) => !filter || String(value || "").toLowerCase().includes(filter.toLowerCase());
    return records.filter((record) => {
      const date = localDateKey(record.date || record.attendance_date);
      if (!includes(record.user_id, filters.employee_id)) return false;
      if (!includes(record.status, filters.status)) return false;
      if (filters.from_date && date < filters.from_date) return false;
      if (filters.to_date && date > filters.to_date) return false;
      if (filters.search && ![record.user_id, record.date, record.status]
        .some((value) => String(value || "").toLowerCase().includes(filters.search.toLowerCase()))) return false;
      return true;
    });
  }, [filters, isSuperAdminRole, records]);

  if (permissionsLoading) return <main style={styles.page}><section style={styles.card}>Loading permissions...</section></main>;
  if (!canViewAttendance) return <AccessDenied />;

  return (
    <main style={styles.page} className={isEmployeeRole ? "employee-dashboard-page" : undefined}>
      {!isEmployeeRole && <section style={styles.header}>
        <div>
          <h1 style={styles.title}>{isEmployeeRole ? "My Attendance" : managementTitle}</h1>
          <p style={styles.subtitle}>{isEmployeeRole ? "View your attendance, working hours, leaves and holidays." : "Review attendance records available to your assigned scope."}</p>
        </div>
        {isEmployeeRole && <nav style={styles.nav}>
          <button type="button" style={styles.refreshButton} disabled={loading} onClick={() => loadAttendance()}>{loading ? "Refreshing..." : "Refresh"}</button>
        </nav>}
      </section>}

      {error && <div role="alert" style={styles.error} className={isEmployeeRole ? "employee-dashboard-notice employee-dashboard-notice--error" : undefined}>{error}<button type="button" style={styles.retryButton} onClick={() => loadAttendance()}>Retry</button></div>}
      {message && <div role="status" style={styles.success} className={isEmployeeRole ? "employee-dashboard-notice employee-dashboard-notice--success" : undefined}>{message}</div>}

      {loading ? (isEmployeeRole ? <EmployeeDashboardSkeleton /> : <section style={styles.card}>Loading attendance...</section>) : !isEmployeeRole ? (
        <ManagementView
          records={records}
          filteredRecords={filteredRecords}
          filters={filters}
          setFilters={setFilters}
          filterOptions={filterOptions}
          summary={summary}
          canExport={isSuperAdminRole && canExportAttendance}
          isSuperAdmin={isSuperAdminRole}
          pagination={{ page: Number(payload?.page) || filters.page, pageSize: Number(payload?.page_size) || filters.page_size, totalPages: Number(payload?.total_pages) || 1, totalCount: Number(payload?.total_count) || records.length }}
        />
      ) : (
        <EmployeeView
          records={records}
          payload={payload}
          today={today}
          summary={summary}
          checkedIn={checkedIn}
          checkedOut={checkedOut}
          canCheckIn={canCheckIn}
          canCheckOut={canCheckOut}
          canApplyLeave={canApplyLeave || isEmployeeRole}
          canViewAttendance={canViewAttendance}
          actionLoading={actionLoading}
          markAttendance={markAttendance}
          currentTime={currentTime}
          onRefresh={() => loadAttendance()}
        />
      )}
    </main>
  );
}

const SummaryCards = ({ cards }) => <section style={styles.summaryGrid}>{cards.map(([label, value, suffix = ""]) => (
  <article key={label} style={styles.statCard}><span style={styles.statLabel}>{label}</span><strong style={styles.statValue}>{value ?? "—"}{suffix}</strong></article>
))}</section>;

const Timeline = ({ record }) => {
  const suppliedEvents = fieldValue(record, "events", "timeline", "attendance_events");
  const events = Array.isArray(suppliedEvents) ? suppliedEvents.map((event) => [
    fieldValue(event, "time", "event_time", "created_at", "timestamp"),
    fieldValue(event, "label", "event", "event_type", "type") || "Attendance event",
  ]) : [
    [fieldValue(record, "check_in_time", "check_in"), "Checked In"],
    [fieldValue(record, "check_out_time", "check_out"), "Checked Out"],
  ].filter(([time]) => time);
  return <div style={styles.timeline}>{events.length ? events.map(([time, label]) => (
    <div key={label} style={styles.timelineItem}><span style={styles.timelineDot} /><div><strong>{formatAttendanceTime(time)}</strong><span style={styles.timelineLabel}>{label}</span></div></div>
  )) : <span style={styles.muted}>No attendance events recorded.</span>}</div>;
};

const DashboardIcon = ({ name }) => {
  const paths = {
    login: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5M15 12H3" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m14 17 5-5-5-5M19 12H9" /></>,
    leave: <><path d="M8 2v4M16 2v4M3 10h18" /><rect x="3" y="4" width="18" height="17" rx="2" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    trend: <><path d="m3 17 6-6 4 4 8-9" /><path d="M15 6h6v6" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" /></>,
  };
  return <svg className="employee-dashboard__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
};

const EmployeeDashboardSkeleton = () => (
  <div className="employee-dashboard employee-dashboard--loading" aria-label="Loading attendance dashboard">
    <div className="employee-skeleton employee-skeleton--hero" />
    <div className="employee-skeleton-grid">{[1, 2, 3, 4].map((item) => <div key={item} className="employee-skeleton employee-skeleton--stat" />)}</div>
    <div className="employee-dashboard__main-grid"><div className="employee-skeleton employee-skeleton--panel" /><div className="employee-skeleton employee-skeleton--panel" /></div>
  </div>
);

const EmployeeStatCard = ({ label, value, suffix, icon, tone }) => (
  <article className={`employee-stat employee-stat--${tone}`}>
    <span className="employee-stat__icon"><DashboardIcon name={icon} /></span>
    <div><span className="employee-stat__label">{label}</span><strong className="employee-stat__value">{value ?? "—"}{suffix}</strong></div>
  </article>
);

const RecentTimeline = ({ record }) => {
  const suppliedEvents = fieldValue(record, "events", "timeline", "attendance_events");
  const events = Array.isArray(suppliedEvents) ? suppliedEvents.map((event) => [
    fieldValue(event, "time", "event_time", "created_at", "timestamp"),
    fieldValue(event, "label", "event", "event_type", "type") || "Attendance event",
  ]) : [
    [fieldValue(record, "check_in_time", "check_in"), "Checked in for the day"],
    [fieldValue(record, "check_out_time", "check_out"), "Checked out for the day"],
  ].filter(([time]) => time);

  if (!events.length) return <div className="employee-empty"><span className="employee-empty__icon"><DashboardIcon name="clock" /></span><strong>No activity yet</strong><p>Your attendance events will appear here after you check in.</p></div>;

  return <div className="employee-timeline">{events.map(([time, label], index) => (
    <div className="employee-timeline__item" key={`${label}-${index}`}>
      <span className="employee-timeline__marker"><DashboardIcon name={index === 0 ? "login" : "logout"} /></span>
      <div className="employee-timeline__content"><strong>{label}</strong><span>{formatAttendanceTime(time)}</span></div>
    </div>
  ))}</div>;
};

const EmployeeView = ({ records, payload, today, summary, checkedIn, checkedOut, canCheckIn, canCheckOut, canApplyLeave, canViewAttendance, actionLoading, markAttendance, currentTime, onRefresh }) => {
  const employeeName = fieldValue(payload, "employee_name", "full_name", "name") || payload?.employee?.full_name || fieldValue(today, "employee_name", "full_name") || fieldValue(records[0], "employee_name", "full_name") || "Employee";
  const istHour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(currentTime));
  const greeting = istHour < 12 ? "Good Morning" : istHour < 17 ? "Good Afternoon" : "Good Evening";
  const currentDate = currentTime.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const currentIstTime = currentTime.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const status = today.status || (checkedOut ? "Checked Out" : checkedIn ? "In Progress" : "Not Checked In");
  const expectedCheckout = fieldValue(today, "expected_checkout", "expected_checkout_time", "expected_check_out", "expected_check_out_time");
  const checkInValue = fieldValue(today, "check_in_time", "check_in");
  const liveWorkingHours = (() => {
    if (!checkedIn || checkedOut || !checkInValue) return fieldValue(today, "working_hours", "total_working_hours") ?? "—";
    const started = new Date(checkInValue);
    if (Number.isNaN(started.getTime())) return fieldValue(today, "working_hours", "total_working_hours") ?? "—";
    const seconds = Math.max(0, Math.floor((currentTime.getTime() - started.getTime()) / 1000));
    return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  })();

  return <div className="employee-dashboard">
    <section className="employee-dashboard__hero">
      <div><span className="employee-dashboard__eyebrow">{greeting},</span><h1>{employeeName}</h1><p>{currentDate}</p></div>
      <div className="employee-dashboard__hero-actions"><div className="employee-dashboard__clock"><span className="employee-dashboard__clock-icon"><DashboardIcon name="clock" /></span><div><span>Current IST Time</span><strong>{currentIstTime}</strong></div></div><button type="button" className="employee-refresh" onClick={onRefresh} aria-label="Refresh attendance" title="Refresh attendance">↻</button></div>
    </section>

    <section className="employee-dashboard__stats" aria-label="Monthly attendance summary">
      <EmployeeStatCard label="Present Days" value={summary.present} icon="calendar" tone="emerald" />
      <EmployeeStatCard label="Absent Days" value={summary.absent} icon="calendar" tone="rose" />
      <EmployeeStatCard label="Late Days" value={summary.late} icon="clock" tone="amber" />
      <EmployeeStatCard label="Attendance" value={summary.percentage} suffix="%" icon="trend" tone="blue" />
      <EmployeeStatCard label="Approved Leaves" value={summary.approvedLeaves} icon="leave" tone="emerald" />
      <EmployeeStatCard label="Pending Leaves" value={summary.pendingLeaves} icon="leave" tone="amber" />
    </section>

    <section className="employee-dashboard__main-grid">
      <article className="employee-panel employee-panel--attendance">
        <div className="employee-panel__header"><div><span className="employee-panel__kicker">Daily overview</span><h2>Today's Attendance</h2></div><span className={`employee-status ${checkedOut ? "employee-status--complete" : checkedIn ? "employee-status--active" : "employee-status--idle"}`}><i />{status}</span></div>
        <div className="employee-attendance-grid">
          <div><span>Check In</span><strong>{formatAttendanceTime(fieldValue(today, "check_in_time", "check_in"))}</strong></div>
          <div><span>Check Out</span><strong>{formatAttendanceTime(fieldValue(today, "check_out_time", "check_out"))}</strong></div>
          <div><span>Working Hours</span><strong>{liveWorkingHours}{typeof liveWorkingHours === "number" ? " hrs" : ""}</strong></div>
          <div><span>Late Minutes</span><strong>{fieldValue(today, "late_minutes") ?? "—"}</strong></div>
          <div><span>Expected Checkout</span><strong>{formatAttendanceTime(expectedCheckout)}</strong></div>
        </div>
      </article>

      <article className="employee-panel employee-panel--actions">
        <div className="employee-panel__header"><div><span className="employee-panel__kicker">Shortcuts</span><h2>Quick Actions</h2></div></div>
        <div className="employee-actions">
          {canCheckIn && <button type="button" className="employee-action employee-action--checkin" disabled={checkedIn || actionLoading} onClick={() => markAttendance("checkin")}><span><DashboardIcon name="login" /></span><div><strong>{actionLoading && !checkedIn ? "Processing..." : "Check In"}</strong><small>{checkedIn ? "Completed for today" : "Start your workday"}</small></div></button>}
          {canCheckOut && <button type="button" className="employee-action employee-action--checkout" disabled={!checkedIn || checkedOut || actionLoading} onClick={() => markAttendance("checkout")}><span><DashboardIcon name="logout" /></span><div><strong>{actionLoading && checkedIn ? "Processing..." : "Check Out"}</strong><small>{checkedOut ? "Completed for today" : "End your workday"}</small></div></button>}
          {canApplyLeave && <Link className="employee-action" to="/leave"><span><DashboardIcon name="leave" /></span><div><strong>Apply Leave</strong><small>Submit a leave request</small></div></Link>}
          {canApplyLeave && <Link className="employee-action" to="/leave"><span><DashboardIcon name="history" /></span><div><strong>My Leaves</strong><small>Track leave requests</small></div></Link>}
          {canViewAttendance && <Link className="employee-action" to="/holidays"><span><DashboardIcon name="calendar" /></span><div><strong>Holiday Calendar</strong><small>View upcoming holidays</small></div></Link>}
          <Link className="employee-action" to="/attendance/history"><span><DashboardIcon name="history" /></span><div><strong>Attendance History</strong><small>Review past records</small></div></Link>
        </div>
      </article>
    </section>

    <section className="employee-panel employee-panel--timeline">
      <div className="employee-panel__header"><div><span className="employee-panel__kicker">Today</span><h2>Recent Timeline</h2></div><Link className="employee-text-link" to="/attendance/history">View all <span>→</span></Link></div>
      <RecentTimeline record={today} />
    </section>
  </div>;
};

const ManagementView = ({ filteredRecords, filters, setFilters, filterOptions, summary, canExport, isSuperAdmin, pagination }) => {
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const resetFilters = () => setFilters({ employee_id: "", store_id: "", status: "", from_date: "", to_date: "", search: "", page: 1, page_size: 10 });
  const nullableColumns = [
    ["Employee Code", "employee_code", (record) => record.employee_code], ["Late Minutes", "late_minutes", (record) => record.late_minutes],
    ["Half Day", "half_day", (record) => record.half_day ? "Yes" : "No"], ["Leave Status", "leave_status", (record) => <AdminStatusBadge value={record.leave_status} leave />],
    ["Leave Reason", "leave_reason", (record) => record.leave_reason], ["Approved By", "approved_by", (record) => record.approved_by],
    ["Approved At", "approved_at", (record) => formatAttendanceDateTime(record.approved_at)],
  ].filter(([, key]) => filteredRecords.some((record) => record[key] !== null && record[key] !== undefined && record[key] !== ""));
  const columns = [
    ["Employee", (record) => record.employee_name || "—"], ...nullableColumns.filter(([label]) => label === "Employee Code").map(([label,, render]) => [label, render]),
    ["Email", (record) => record.employee_email || "—"], ["Store", (record) => record.store_name || "—"],
    ["Attendance Date", (record) => formatDate(record.attendance_date)], ["Check In", (record) => formatAttendanceTime(record.check_in)],
    ["Check Out", (record) => formatAttendanceTime(record.check_out)], ["Working Hours", (record) => record.working_hours == null ? "—" : `${Number(record.working_hours).toFixed(2)} hrs`],
    ["Attendance Status", (record) => <AdminStatusBadge value={record.attendance_status} />],
    ...nullableColumns.filter(([label]) => label !== "Employee Code").map(([label,, render]) => [label, render]),
    ["Location", (record) => record.latitude != null && record.longitude != null ? <a href={`https://maps.google.com/?q=${record.latitude},${record.longitude}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>View Location</a> : "—"],
  ];
  return <>
    <SummaryCards cards={[["Present", summary.present], ["Absent", summary.absent], ["Late", summary.late], ["Half Day", summary.halfDay], ["Leave", summary.leave], ["Checked In", summary.checkedIn], ["Checked Out", summary.checkedOut]]} />
    <section style={{ ...styles.card, marginTop: "20px" }}>
      <div style={styles.managementActions}><button type="button" style={styles.resetButton} onClick={resetFilters}>Reset Filters</button>{canExport && <button type="button" style={styles.exportButton} onClick={() => exportAttendanceCsv(filteredRecords)}>Export</button>}</div>
      <div style={styles.filterGrid}>
        <Filter label="Employee" value={filters.employee_id} options={filterOptions.employees} onChange={(value) => updateFilter("employee_id", value)} />
        <Filter label="Store" value={filters.store_id} options={filterOptions.stores} onChange={(value) => updateFilter("store_id", value)} />
        <Filter label="Attendance Status" value={filters.status} options={filterOptions.statuses} onChange={(value) => updateFilter("status", value)} />
        <DateFilter label="From Date" value={filters.from_date} onChange={(value) => updateFilter("from_date", value)} />
        <DateFilter label="To Date" value={filters.to_date} onChange={(value) => updateFilter("to_date", value)} />
        <label style={styles.filterField}><span style={styles.filterLabel}>Search</span><input style={styles.input} type="search" value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} /></label>
      </div>
      <div style={styles.tableWrapper}><table style={styles.managementTable}><thead><tr>{columns.map(([label]) => <th key={label} style={styles.headerCell}>{label}</th>)}</tr></thead><tbody>{filteredRecords.map((record, index) => <tr key={record.attendance_id || index} style={styles.row}>{columns.map(([label, render]) => <td key={label} style={styles.cell}>{render(record) ?? "—"}</td>)}</tr>)}{!filteredRecords.length && <tr><td colSpan={columns.length} style={styles.empty}>No attendance records found.</td></tr>}</tbody></table></div>
      <AdminPagination {...pagination} setFilters={setFilters} />
    </section>
    {isSuperAdmin && <section style={styles.consoleSection}><LeaveManagement adminMode attendanceRecords={filteredRecords} /></section>}
    {isSuperAdmin && <section style={styles.consoleSection}><HolidayManagement adminMode /></section>}
  </>;
};

const AdminStatusBadge = ({ value, leave = false }) => { const normalized = String(value || "").toLowerCase().replace(/[ _]/g, "-"); return <span className={`admin-attendance-badge admin-attendance-badge--${leave ? "leave-" : ""}${normalized || "unknown"}`}>{value || "—"}</span>; };
const AdminPagination = ({ page, pageSize, totalPages, totalCount, setFilters }) => <div className="admin-attendance-pagination"><span>Total Records: <strong>{totalCount}</strong> · Page {page} of {totalPages}</span><label>Page Size <select value={pageSize} onChange={(event) => setFilters((current) => ({ ...current, page: 1, page_size: Number(event.target.value) }))}>{[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label><button type="button" disabled={page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Previous</button><button type="button" disabled={page >= totalPages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Next</button></div>;

const AttendanceDetailDrawer = ({ record, records, onClose }) => {
  const history = records.filter((item) => employeeKey(item) === employeeKey(record));
  const present = history.filter((item) => String(item.status || "").toLowerCase() === "present").length;
  const absent = history.filter((item) => String(item.status || "").toLowerCase() === "absent").length;
  const leave = history.filter((item) => String(item.status || "").toLowerCase() === "leave").length;
  const late = history.filter((item) => Number(item.late_minutes) > 0).length;
  const hours = history.reduce((total, item) => total + Number(item.working_hours || item.total_working_hours || 0), 0).toFixed(2);
  const percentage = history.length ? ((present / history.length) * 100).toFixed(1) : 0;
  return <div style={styles.drawerBackdrop} onClick={onClose}><aside style={styles.drawer} onClick={(event) => event.stopPropagation()}>
    <button type="button" style={styles.closeButton} onClick={onClose}>×</button>
    <h2 style={styles.sectionTitle}>{record.user_id != null ? `Employee ${record.user_id}` : "Attendance Details"}</h2>
    <Timeline record={record} />
    <div style={styles.detailGrid}><Detail label="Date" value={formatDate(record.date || record.attendance_date)} /><Detail label="Status" value={record.status || "—"} /><Detail label="Working Hours" value={fieldValue(record, "working_hours", "total_working_hours") ?? "—"} /><Detail label="Remarks" value={fieldValue(record, "remarks", "remark", "notes") || "—"} /></div>
    <h3>Monthly Summary</h3>
    <SummaryCards cards={[["Present", present], ["Absent", absent], ["Leave", leave], ["Late", late], ["Working Hours", hours, " hrs"], ["Attendance %", percentage, "%"]]} />
    <AttendanceTable records={history} compact />
  </aside></div>;
};

const Detail = ({ label, value }) => <div><span style={styles.detailLabel}>{label}</span><strong style={styles.detailValue}>{value}</strong></div>;
const Filter = ({ label, value, options, onChange }) => <label style={styles.filterField}><span style={styles.filterLabel}>{label}</span><select style={styles.input} value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
const DateFilter = ({ label, value, onChange }) => <label style={styles.filterField}><span style={styles.filterLabel}>{label}</span><input style={styles.input} type="date" value={value} onChange={(event) => onChange(event.target.value)} /></label>;

const AttendanceTable = ({ records, compact = false, title = "Attendance History" }) => <section style={compact ? styles.compactHistory : { ...styles.card, marginTop: "20px" }}><h2 style={styles.sectionTitle}>{title}</h2><div style={styles.tableWrapper}><table style={styles.historyTable}><thead><tr>{["Date", "Check In", "Check Out", "Working Hours", "Status", "Late", "Remarks"].map((column) => <th key={column} style={styles.headerCell}>{column}</th>)}</tr></thead><tbody>{records.map((record, index) => <tr key={record.id || `${record.date}-${index}`} style={styles.row}><td style={styles.cell}>{formatDate(record.date || record.attendance_date)}</td><td style={styles.cell}>{formatAttendanceTime(fieldValue(record, "check_in_time", "check_in"))}</td><td style={styles.cell}>{formatAttendanceTime(fieldValue(record, "check_out_time", "check_out"))}</td><td style={styles.cell}>{fieldValue(record, "working_hours", "total_working_hours") ?? "—"}</td><td style={styles.cell}>{record.status || "—"}</td><td style={styles.cell}>{record.late_minutes ?? "—"}</td><td style={styles.cell}>{fieldValue(record, "remarks", "remark", "notes") || "—"}</td></tr>)}{!records.length && <tr><td colSpan="7" style={styles.empty}>No attendance records found.</td></tr>}</tbody></table></div></section>;

const styles = {
  page: { minHeight: "100vh", background: "#f4f6f8", padding: "28px", color: "#102a43", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap", marginBottom: "20px" }, title: { margin: 0, fontSize: "28px" }, subtitle: { margin: "6px 0 0", color: "#64748b" },
  nav: { display: "flex", gap: "8px", flexWrap: "wrap" }, navLink: { padding: "8px 12px", borderRadius: "7px", background: "#e2e8f0", color: "#334155", textDecoration: "none", fontWeight: 600 },
  actionBar: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", background: "#fff", padding: "14px", borderRadius: "12px", boxShadow: "0 2px 10px rgba(15,23,42,.07)", marginBottom: "22px" }, actionLink: { padding: "10px 16px", borderRadius: "8px", background: "#e8f4fd", color: "#1565C0", textDecoration: "none", fontWeight: 700, fontSize: "14px" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "14px" }, statCard: { background: "#fff", borderRadius: "10px", boxShadow: "0 2px 8px rgba(0,0,0,.1)", padding: "18px", borderLeft: "4px solid #4CAF50" }, statLabel: { display: "block", color: "#64748b", fontSize: "13px", marginBottom: "8px" }, statValue: { color: "#102a43", fontSize: "22px" },
  card: { background: "#fff", borderRadius: "10px", boxShadow: "0 2px 8px rgba(0,0,0,.1)", padding: "20px" }, todayHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }, sectionTitle: { margin: "0 0 16px", fontSize: "20px" },
  detailGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px", margin: "18px 0" }, detailLabel: { display: "block", color: "#64748b", fontSize: "12px", marginBottom: "5px" }, detailValue: { display: "block", color: "#334155", fontSize: "15px" },
  badge: { padding: "5px 11px", borderRadius: "999px", fontSize: "12px", fontWeight: 700 }, present: { background: "#dcfce7", color: "#166534" }, notMarked: { background: "#e2e8f0", color: "#475569" },
  button: { border: 0, borderRadius: "7px", padding: "10px 18px", color: "#fff", fontWeight: 600, cursor: "pointer" }, checkInButton: { background: "#4CAF50" }, checkOutButton: { background: "#f44336" },
  timeline: { borderLeft: "2px solid #cbd5e1", marginLeft: "8px", paddingLeft: "20px" }, timelineItem: { position: "relative", padding: "0 0 20px" }, timelineDot: { position: "absolute", width: "10px", height: "10px", borderRadius: "50%", background: "#4CAF50", left: "-26px", top: "4px" }, timelineLabel: { display: "block", marginTop: "3px", color: "#64748b", fontSize: "13px" }, muted: { color: "#64748b" },
  filterGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "18px" }, filterField: { display: "flex", flexDirection: "column", gap: "5px" }, filterLabel: { color: "#64748b", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }, input: { width: "100%", boxSizing: "border-box", padding: "9px 10px", border: "1px solid #cbd5e1", borderRadius: "7px", background: "#fff", color: "#102a43" },
  managementActions: { display: "flex", justifyContent: "flex-end", gap: "10px", marginBottom: "14px" }, exportButton: { border: 0, borderRadius: "7px", padding: "10px 16px", background: "#1565C0", color: "#fff", fontWeight: 600, cursor: "pointer" }, resetButton: { border: "1px solid #cbd5e1", borderRadius: "7px", padding: "10px 16px", background: "#fff", color: "#334155", fontWeight: 600, cursor: "pointer" },
  tableWrapper: { overflowX: "auto" }, managementTable: { width: "100%", borderCollapse: "collapse", minWidth: "900px" }, historyTable: { width: "100%", borderCollapse: "collapse", minWidth: "850px" }, headerCell: { position: "sticky", top: 0, background: "#102a43", color: "#fff", textAlign: "left", padding: "12px", fontSize: "12px", whiteSpace: "nowrap", zIndex: 2 }, row: { borderBottom: "1px solid #e2e8f0" }, clickableRow: { borderBottom: "1px solid #e2e8f0", cursor: "pointer" }, cell: { padding: "12px", color: "#334155", fontSize: "13px" }, empty: { padding: "28px", textAlign: "center", color: "#64748b" },
  drawerBackdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000 }, drawer: { position: "absolute", top: 0, right: 0, width: "min(620px, 92vw)", height: "100%", overflowY: "auto", boxSizing: "border-box", background: "#fff", padding: "26px", boxShadow: "-8px 0 30px rgba(0,0,0,.2)" }, closeButton: { position: "absolute", top: "12px", right: "16px", border: 0, background: "transparent", fontSize: "28px", cursor: "pointer", color: "#475569" }, compactHistory: { marginTop: "20px" },
  historyCallout: { marginTop: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap" }, historyText: { margin: 0, color: "#64748b" }, historyButton: { padding: "10px 16px", borderRadius: "8px", background: "#102a43", color: "#fff", textDecoration: "none", fontWeight: 700 },
  error: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", padding: "10px 12px", background: "#fee2e2", color: "#991b1b", borderRadius: "7px" }, retryButton: { marginLeft: "auto", padding: "6px 10px", color: "#991b1b", background: "#fff", border: "1px solid #fecaca", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }, success: { marginBottom: "16px", padding: "10px 12px", background: "#dcfce7", color: "#166534", borderRadius: "7px" },
  consoleSection: { marginTop: "24px", borderRadius: "18px", overflow: "hidden" },
};
