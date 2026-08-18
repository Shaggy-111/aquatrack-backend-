import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import { API_BASE_URL } from "../config";
import usePermissions from "../hooks/usePermissions";
import { PERMISSIONS } from "../permissions";
import { API_TIMEOUT_MS, getApiErrorMessage } from "../utils/apiErrors";
import "./LeaveManagement.css";

const LEAVE_URLS = {
  list: `${API_BASE_URL}/attendance/leave/me`,
  apply: `${API_BASE_URL}/attendance/leave/apply`,
  cancel: (leaveId) => `${API_BASE_URL}/attendance/leave/cancel/${leaveId}`,
  approve: (leaveId) => `${API_BASE_URL}/attendance/leave/approve/${leaveId}`,
};

const emptyForm = { leave_type: "annual", start_date: "", end_date: "", reason: "" };
const EMPTY_ATTENDANCE_RECORDS = [];
const getToken = () => localStorage.getItem("auth_token") || localStorage.getItem("userToken") || localStorage.getItem("partner_token");
const formatDate = (value) => value ? new Date(`${value}`.split("T")[0] + "T00:00:00").toLocaleDateString() : "—";

export default function LeaveManagement({ adminMode = false, attendanceRecords = EMPTY_ATTENDANCE_RECORDS }) {
  const { hasPermission } = usePermissions();
  const isEmployeeRole = String(localStorage.getItem("user_role") || "").toLowerCase().replace(/[\s_-]/g, "") === "employee";
  const canApplyLeave = hasPermission(PERMISSIONS.LEAVE_APPLY) || isEmployeeRole;
  const [leaves, setLeaves] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [selectedLeave, setSelectedLeave] = useState(null);

  const config = useMemo(() => ({ headers: { Authorization: `Bearer ${getToken()}` }, timeout: API_TIMEOUT_MS }), []);

  const loadLeaves = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(LEAVE_URLS.list, config);
      const data = response.data;
      setLeaves(Array.isArray(data) ? data : data.leaves || data.items || data.data || []);
    } catch (requestError) {
      if (adminMode && [403, 404].includes(requestError.response?.status)) {
        setLeaves([]);
        setError("");
      } else {
        setError(getApiErrorMessage(requestError, "Unable to load leave requests."));
      }
    } finally {
      setLoading(false);
    }
  }, [adminMode, config]);

  useEffect(() => {
    if (adminMode) {
      setLeaves(attendanceRecords.filter((record) => record.leave_status).map((record) => ({
        attendance_id: record.attendance_id,
        employee_name: record.employee_name,
        employee_email: record.employee_email,
        user_id: record.employee_id,
        from_date: record.attendance_date,
        to_date: record.attendance_date,
        leave_type: record.leave_type,
        reason: record.leave_reason,
        status: record.leave_status,
        approved_by: record.approved_by,
        approved_at: record.approved_at,
      })));
      setError("");
      setLoading(false);
      return;
    }
    loadLeaves();
  }, [adminMode, attendanceRecords, loadLeaves]);

  const applyLeave = async (event) => {
    event.preventDefault();
    if (!form.start_date || !form.end_date || !form.reason.trim()) {
      setError("From date, to date and reason are required.");
      return;
    }
    if (form.end_date < form.start_date) {
      setError("To date cannot be earlier than from date.");
      return;
    }
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDatePattern.test(form.start_date) || !isoDatePattern.test(form.end_date)) {
      setError("Leave dates must use the YYYY-MM-DD format.");
      return;
    }
    const payload = { from_date: form.start_date, to_date: form.end_date, reason: form.reason.trim() };
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await axios.post(LEAVE_URLS.apply, payload, config);
      setForm(emptyForm);
      setShowForm(false);
      setMessage("Leave application submitted.");
      await loadLeaves();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to submit the leave request."));
    } finally {
      setSaving(false);
    }
  };

  const cancelLeave = async (leave) => {
    const leaveId = leave.id || leave.leave_id;
    if (!leaveId) return;
    setCancellingId(leaveId);
    setError("");
    setMessage("");
    try {
      await axios.put(LEAVE_URLS.cancel(leaveId), null, config);
      setSelectedLeave(null);
      setMessage("Leave request cancelled.");
      await loadLeaves();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to cancel the leave request."));
    } finally {
      setCancellingId(null);
    }
  };

  const approveLeave = async (leave) => {
    const leaveId = leave.id || leave.leave_id;
    if (!leaveId) return;
    setApprovingId(leaveId);
    setError("");
    setMessage("");
    try {
      await axios.put(LEAVE_URLS.approve(leaveId), null, config);
      setMessage("Leave request approved.");
      await loadLeaves();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to approve the leave request."));
    } finally {
      setApprovingId(null);
    }
  };

  const leaveSummary = leaves.reduce((summary, leave) => {
    const status = String(leave.status || "pending").toLowerCase();
    if (status === "approved") summary.approved += 1;
    else if (["rejected", "cancelled", "canceled"].includes(status)) summary.rejected += 1;
    else summary.pending += 1;
    return summary;
  }, { pending: 0, approved: 0, rejected: 0 });
  const leaveBalance = leaves.find((leave) => leave.leave_balance !== undefined)?.leave_balance;

  const filteredLeaves = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return leaves.filter((leave) => {
      const status = String(leave.status || "pending");
      const fromDate = String(leave.from_date || leave.start_date || "").slice(0, 10);
      const toDate = String(leave.to_date || leave.end_date || "").slice(0, 10);
      if (statusFilter && status.toLowerCase() !== statusFilter.toLowerCase()) return false;
      if (dateFilter && dateFilter !== fromDate && dateFilter !== toDate) return false;
      if (normalizedSearch && ![
        leave.leave_type || leave.type,
        leave.reason,
        status,
        formatDate(fromDate),
        formatDate(toDate),
      ].some((value) => String(value || "").toLowerCase().includes(normalizedSearch))) return false;
      return true;
    });
  }, [leaves, search, statusFilter, dateFilter]);

  const statusOptions = useMemo(() => [...new Set(leaves.map((leave) => String(leave.status || "pending")).filter(Boolean))], [leaves]);
  const pendingLeaves = useMemo(() => leaves.filter((leave) => String(leave.status || "pending").toLowerCase() === "pending"), [leaves]);
  const approvedLeaves = useMemo(() => leaves.filter((leave) => String(leave.status || "").toLowerCase() === "approved"), [leaves]);
  const rejectedLeaves = useMemo(() => leaves.filter((leave) => String(leave.status || "").toLowerCase() === "rejected"), [leaves]);

  const exportLeaves = () => {
    const rows = filteredLeaves.map((leave) => ({
      "Leave Type": leave.leave_type || leave.type || "",
      "Start Date": leave.from_date || leave.start_date || "",
      "End Date": leave.to_date || leave.end_date || "",
      "Reason": leave.reason || "",
      "Status": leave.status || "pending",
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: ["Leave Type", "Start Date", "End Date", "Reason", "Status"] });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Leave History");
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(workbook, `Leave_History_${date}.xlsx`);
  };

  return <main className="leave-page">
    <div className="leave-management">
      <section className="leave-management__header">
        <div><span className="leave-management__eyebrow">{adminMode ? "Admin approvals" : "Employee leave"}</span><h1>{adminMode ? "Leave Requests" : "Leave Management"}</h1><p>{adminMode ? "Review and approve leave requests available to your administrative scope." : "Plan your time away and track every leave request."}</p></div>
        <div className="leave-management__header-actions"><button type="button" className="leave-management__export" onClick={exportLeaves} disabled={loading || filteredLeaves.length === 0}><LeaveIcon name="download" />Export Excel</button>{canApplyLeave && <button type="button" className="leave-management__primary" onClick={() => setShowForm((value) => !value)}><LeaveIcon name={showForm ? "close" : "plus"} />{showForm ? "Close Form" : "Apply Leave"}</button>}</div>
      </section>

      {error && <div role="alert" className="leave-notice leave-notice--error"><LeaveIcon name="alert" /><span>{error}</span>{!showForm && !saving && !cancellingId && <button type="button" onClick={loadLeaves}>Retry</button>}</div>}
      {message && <div role="status" className="leave-notice leave-notice--success"><LeaveIcon name="check" /><span>{message}</span></div>}

      {loading ? <LeaveSummarySkeleton /> : <section className="leave-summary">
        <LeaveSummaryCard label="Pending" value={leaveSummary.pending} icon="clock" tone="amber" />
        <LeaveSummaryCard label="Approved" value={leaveSummary.approved} icon="check" tone="emerald" />
        <LeaveSummaryCard label="Rejected" value={leaveSummary.rejected} icon="close" tone="rose" />
        {leaveBalance !== undefined && <LeaveSummaryCard label="Leave Balance" value={leaveBalance} icon="calendar" tone="blue" />}
      </section>}

      {adminMode && !loading && <section className="leave-history leave-pending"><div className="leave-history__title"><div><span>Approval queue</span><h2>Pending Leave Requests</h2></div><strong>{pendingLeaves.length} pending</strong></div>{pendingLeaves.length === 0 ? <div className="leave-empty"><h3>No pending leave requests.</h3></div> : <div className="leave-history__table-wrap"><table className="leave-history__table"><thead><tr><th>Employee</th><th>Start Date</th><th>End Date</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody>{pendingLeaves.map((leave) => { const leaveId = leave.id || leave.leave_id; return <tr key={leaveId || leave.attendance_id} tabIndex={0} onClick={() => setSelectedLeave(leave)}><td>{leave.employee_name || leave.full_name || leave.user_name || leave.user_id || "—"}</td><td>{formatDate(leave.from_date || leave.start_date)}</td><td>{formatDate(leave.to_date || leave.end_date)}</td><td className="leave-history__reason">{leave.reason || "—"}</td><td><LeaveStatusBadge status={String(leave.status || "pending")} /></td><td>{leaveId ? <button type="button" className="leave-approve" disabled={approvingId === leaveId} onClick={(event) => { event.stopPropagation(); approveLeave(leave); }}>{approvingId === leaveId ? "Approving..." : "Approve"}</button> : "—"}</td></tr>; })}</tbody></table></div>}</section>}
      {adminMode && !loading && <div className="leave-admin-status-grid"><AdminLeaveStatusSection title="Approved Leave Requests" leaves={approvedLeaves} empty="No approved leave requests." onSelect={setSelectedLeave} /><AdminLeaveStatusSection title="Rejected Leave Requests" leaves={rejectedLeaves} empty="No rejected leave requests." onSelect={setSelectedLeave} /></div>}

      {canApplyLeave && showForm && <div className="leave-form__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowForm(false); }}><form className="leave-form" role="dialog" aria-modal="true" aria-labelledby="apply-leave-title" onSubmit={applyLeave}>
        <div className="leave-form__header"><div><span>New request</span><h2 id="apply-leave-title">Apply for Leave</h2><p>Provide the details below to submit your application.</p></div><button type="button" className="leave-form__close" onClick={() => setShowForm(false)} disabled={saving} aria-label="Close apply leave dialog"><LeaveIcon name="close" /></button></div>
        <div className="leave-form__grid">
          <label><span>Leave Type</span><select value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}><option value="annual">Annual</option><option value="sick">Sick</option><option value="casual">Casual</option><option value="unpaid">Unpaid</option></select></label>
          <label><span>Start Date</span><input required type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
          <label><span>End Date</span><input required type="date" min={form.start_date} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
          <label className="leave-form__reason"><span>Reason</span><textarea required minLength="3" rows="4" placeholder="Briefly explain the reason for your leave..." value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        </div>
        <div className="leave-form__footer"><span>Requests are subject to manager approval.</span><button type="submit" disabled={saving}>{saving && <i />} {saving ? "Submitting Request..." : "Submit Application"}</button></div>
      </form></div>}

      <section className="leave-history">
        <div className="leave-history__title"><div><span>Request archive</span><h2>Leave History</h2></div><strong>{filteredLeaves.length} {filteredLeaves.length === 1 ? "request" : "requests"}</strong></div>
        <div className="leave-history__toolbar">
          <label className="leave-history__search"><LeaveIcon name="search" /><input type="search" placeholder="Search leave requests..." value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search">×</button>}</label>
          <div className="leave-history__filters"><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></label><label><span>Date</span><input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label></div>
        </div>

        {loading ? <LeaveTableSkeleton /> : filteredLeaves.length === 0 ? <LeaveEmptyState hasFilters={Boolean(search || statusFilter || dateFilter)} onClear={() => { setSearch(""); setStatusFilter(""); setDateFilter(""); }} canApplyLeave={canApplyLeave} onApply={() => setShowForm(true)} /> : <div className="leave-history__table-wrap"><table className="leave-history__table"><thead><tr><th>Type</th><th>Start Date</th><th>End Date</th><th>Reason</th><th>Status</th>{adminMode && <><th>Approved By / At</th><th>Rejected By / At</th></>}<th aria-label="View details" /></tr></thead><tbody>{filteredLeaves.map((leave, index) => {
          const status = String(leave.status || "pending");
          return <tr key={leave.id || index} tabIndex={0} onClick={() => setSelectedLeave(leave)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedLeave(leave); }}><td><span className="leave-history__type"><LeaveIcon name="calendar" />{leave.leave_type || leave.type || "—"}</span></td><td>{formatDate(leave.from_date || leave.start_date)}</td><td>{formatDate(leave.to_date || leave.end_date)}</td><td className="leave-history__reason" title={leave.reason || ""}>{leave.reason || "—"}</td><td><LeaveStatusBadge status={status} /></td>{adminMode && <><td>{leave.approved_by_name || leave.approved_by || "—"}<small>{leave.approved_at ? formatDate(leave.approved_at) : ""}</small></td><td>{leave.rejected_by_name || leave.rejected_by || "—"}<small>{leave.rejected_at ? formatDate(leave.rejected_at) : ""}</small></td></>}<td><button type="button" onClick={(event) => { event.stopPropagation(); setSelectedLeave(leave); }} aria-label="View leave details">→</button></td></tr>;
        })}</tbody></table></div>}
      </section>
    </div>
    {selectedLeave && <LeaveDetailsDrawer leave={selectedLeave} cancelling={cancellingId === (selectedLeave.id || selectedLeave.leave_id)} onCancel={() => cancelLeave(selectedLeave)} onClose={() => setSelectedLeave(null)} />}
  </main>;
}

const LeaveIcon = ({ name }) => {
  const paths = {
    download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>, plus: <path d="M12 5v14M5 12h14" />, close: <path d="m6 6 12 12M18 6 6 18" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>, search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, check: <path d="m5 12 4 4L19 6" />, alert: <><path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>, empty: <><path d="M4 5h16v14H4zM8 2v6M16 2v6M4 10h16" /><path d="M9 15h6" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
};

const LeaveSummaryCard = ({ label, value, icon, tone }) => <article className={`leave-summary__card leave-summary__card--${tone}`}><span><LeaveIcon name={icon} /></span><div><small>{label}</small><strong>{value}</strong></div></article>;
const LeaveSummarySkeleton = () => <section className="leave-summary leave-summary--loading">{[1, 2, 3, 4].map((item) => <div key={item} />)}</section>;
const LeaveStatusBadge = ({ status }) => { const value = status.toLowerCase(); const tone = value === "approved" ? "approved" : ["rejected", "cancelled", "canceled"].includes(value) ? "rejected" : "pending"; return <span className={`leave-status leave-status--${tone}`}><i />{status}</span>; };
const LeaveTableSkeleton = () => <div className="leave-table-skeleton">{Array.from({ length: 6 }, (_, row) => <div key={row}>{Array.from({ length: 5 }, (_, cell) => <span key={cell} />)}</div>)}</div>;
const LeaveEmptyState = ({ hasFilters, onClear, canApplyLeave, onApply }) => <div className="leave-empty"><span><LeaveIcon name="empty" /></span><h3>{hasFilters ? "No matching requests" : canApplyLeave ? "No leave requests yet" : "No leave history."}</h3><p>{hasFilters ? "Try changing your search or filters." : canApplyLeave ? "Your submitted leave applications will appear here." : "Completed leave requests will appear here."}</p>{hasFilters ? <button type="button" onClick={onClear}>Clear filters</button> : canApplyLeave && <button type="button" onClick={onApply}>Apply for leave</button>}</div>;
const AdminLeaveStatusSection = ({ title, leaves, empty, onSelect }) => <section className="leave-history"><div className="leave-history__title"><h2>{title}</h2><strong>{leaves.length}</strong></div>{leaves.length === 0 ? <div className="leave-admin-empty">{empty}</div> : <div className="leave-history__table-wrap"><table className="leave-history__table"><thead><tr><th>Employee</th><th>Dates</th><th>Status</th></tr></thead><tbody>{leaves.map((leave) => <tr key={leave.id || leave.leave_id} onClick={() => onSelect(leave)}><td>{leave.employee_name || leave.user_id || "—"}</td><td>{formatDate(leave.from_date)} – {formatDate(leave.to_date)}</td><td><LeaveStatusBadge status={String(leave.status)} /></td></tr>)}</tbody></table></div>}</section>;

const LeaveDetailsDrawer = ({ leave, cancelling, onCancel, onClose }) => {
  useEffect(() => { const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]);
  const status = String(leave.status || "pending");
  const canCancel = ["pending", "approved"].includes(status.toLowerCase()) && Boolean(leave.id || leave.leave_id);
  return <div className="leave-drawer__backdrop" onClick={onClose}><aside className="leave-drawer" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Leave request details"><button type="button" className="leave-drawer__close" onClick={onClose} aria-label="Close leave details"><LeaveIcon name="close" /></button><span className="leave-drawer__eyebrow">Leave request</span><h2>{leave.leave_type || leave.type || "Leave Details"}</h2><LeaveStatusBadge status={status} /><div className="leave-drawer__dates"><div><small>Start date</small><strong>{formatDate(leave.from_date || leave.start_date)}</strong></div><span>→</span><div><small>End date</small><strong>{formatDate(leave.to_date || leave.end_date)}</strong></div></div><div className="leave-drawer__detail"><span>Reason</span><p>{leave.reason || "—"}</p></div>{leave.leave_balance !== undefined && <div className="leave-drawer__detail"><span>Leave Balance</span><strong>{leave.leave_balance}</strong></div>}{canCancel && <button type="button" className="leave-drawer__cancel" disabled={cancelling} onClick={onCancel}>{cancelling ? "Cancelling..." : "Cancel Leave"}</button>}</aside></div>;
};
