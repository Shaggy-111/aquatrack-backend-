import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../config";
import { API_TIMEOUT_MS, getApiErrorMessage } from "../utils/apiErrors";
import "./HolidayManagement.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HOLIDAYS_URL = `${API_BASE_URL}/attendance/holiday`;
const getToken = () => localStorage.getItem("auth_token") || localStorage.getItem("userToken") || localStorage.getItem("partner_token");
const holidayDate = (holiday) => holiday.holiday_date || holiday.date;
const holidayName = (holiday) => holiday.holiday_name || holiday.name || holiday.title || "Holiday";
const formatDate = (value) => value ? new Date(`${value}`.split("T")[0] + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function HolidayManagement({ adminMode = false }) {
  const [holidays, setHolidays] = useState([]);
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [upcomingOnly, setUpcomingOnly] = useState(false);
  const [viewMode, setViewMode] = useState("calendar");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ date: "", title: "" });

  const config = useMemo(() => ({ headers: { Authorization: `Bearer ${getToken()}` }, timeout: API_TIMEOUT_MS }), []);

  const loadHolidays = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(HOLIDAYS_URL, {
        ...config,
        params: { year: year ? Number(year) : undefined },
      });
      const data = response.data;
      setHolidays(Array.isArray(data) ? data : data.holidays || data.items || data.data || []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to load holidays."));
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  }, [config, year]);

  useEffect(() => { loadHolidays(); }, [loadHolidays]);

  const addHoliday = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await axios.post(HOLIDAYS_URL, holidayForm, config);
      setHolidayForm({ date: "", title: "" });
      setShowCreate(false);
      setMessage("Holiday added successfully.");
      await loadHolidays();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to add the holiday."));
    } finally {
      setSaving(false);
    }
  };

  const filteredHolidays = useMemo(() => {
    const term = search.trim().toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return [...holidays]
      .filter((holiday) => !month || new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00").getMonth() + 1 === Number(month))
      .filter((holiday) => !year || new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00").getFullYear() === Number(year))
      .filter((holiday) => !upcomingOnly || new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00") >= today)
      .filter((holiday) => !term || [holidayName(holiday), holiday.description, holidayDate(holiday)].some((value) => String(value || "").toLowerCase().includes(term)))
      .sort((a, b) => new Date(holidayDate(a)) - new Date(holidayDate(b)));
  }, [holidays, search, month, year, upcomingOnly]);

  const upcomingHolidays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return filteredHolidays.filter((holiday) => new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00") >= today);
  }, [filteredHolidays]);
  const pastHolidays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return filteredHolidays.filter((holiday) => new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00") < today).reverse();
  }, [filteredHolidays]);

  const now = new Date();
  const years = useMemo(() => [...new Set(holidays.map((holiday) => new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00").getFullYear()).filter(Number.isFinite))].sort((a, b) => b - a), [holidays]);
  const allUpcomingHolidays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return [...holidays].filter((holiday) => new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00") >= today).sort((a, b) => new Date(holidayDate(a)) - new Date(holidayDate(b)));
  }, [holidays]);
  const thisYearCount = holidays.filter((holiday) => new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00").getFullYear() === now.getFullYear()).length;
  const thisMonthCount = holidays.filter((holiday) => { const date = new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00"); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); }).length;

  return <main className="holiday-page">
    <div className="holiday-management">
      <section className="holiday-management__header"><div><span>Company calendar</span><h1>Holiday Calendar</h1><p>Plan ahead with your official holiday schedule.</p></div><div className="holiday-header-actions">{adminMode && <button type="button" onClick={() => setShowCreate((value) => !value)}>+ <span>Add Holiday</span></button>}<button type="button" disabled={loading} onClick={loadHolidays} aria-label="Refresh holidays">↻ <span>{loading ? "Refreshing" : "Refresh"}</span></button></div></section>
      {error && <div role="alert" className="holiday-management__error"><HolidayIcon name="alert" /><span>{error}</span><button type="button" onClick={loadHolidays}>Retry</button></div>}
      {message && <div role="status" className="holiday-management__success">{message}</div>}
      {adminMode && showCreate && <form className="holiday-create" onSubmit={addHoliday}><div><span>Add official holiday</span><h2>New Holiday</h2></div><label><span>Date</span><input required type="date" value={holidayForm.date} onChange={(event) => setHolidayForm({ ...holidayForm, date: event.target.value })} /></label><label><span>Title</span><input required minLength="2" value={holidayForm.title} onChange={(event) => setHolidayForm({ ...holidayForm, title: event.target.value })} placeholder="Holiday name" /></label><button type="submit" disabled={saving}>{saving ? "Adding..." : "Add Holiday"}</button></form>}

      {loading ? <HolidaySummarySkeleton /> : <section className="holiday-summary">
        <HolidaySummaryCard label="Total Holidays" value={holidays.length} icon="calendar" tone="blue" />
        <HolidaySummaryCard label="Upcoming" value={allUpcomingHolidays.length} icon="sparkle" tone="emerald" />
        <HolidaySummaryCard label="This Month" value={thisMonthCount} icon="month" tone="violet" />
        <HolidaySummaryCard label="This Year" value={thisYearCount} icon="flag" tone="amber" />
      </section>}

      {!loading && allUpcomingHolidays.length > 0 && <section className="holiday-featured"><div className="holiday-section-heading"><div><span>Coming up</span><h2>Upcoming Holidays</h2></div><small>{allUpcomingHolidays.length} remaining</small></div><div className="holiday-featured__grid">{allUpcomingHolidays.slice(0, 4).map((holiday, index) => <HolidayCard key={holiday.id || `${holidayDate(holiday)}-featured-${index}`} holiday={holiday} featured />)}</div></section>}

      <section className="holiday-explorer">
        <div className="holiday-explorer__top"><div><span>Holiday directory</span><h2>Explore Calendar</h2></div><div className="holiday-view-toggle"><button type="button" className={viewMode === "calendar" ? "is-active" : ""} aria-pressed={viewMode === "calendar"} onClick={() => setViewMode("calendar")}><HolidayIcon name="grid" />Calendar</button><button type="button" className={viewMode === "list" ? "is-active" : ""} aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}><HolidayIcon name="list" />List</button></div></div>
        <div className="holiday-explorer__toolbar"><label className="holiday-search"><HolidayIcon name="search" /><input type="search" aria-label="Search holidays" placeholder="Search holidays..." value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search">×</button>}</label><div className="holiday-filters"><label><span>Month</span><select aria-label="Month" value={month} onChange={(event) => setMonth(event.target.value)}><option value="">All Months</option>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label><label><span>Year</span><select aria-label="Year" value={year} onChange={(event) => setYear(event.target.value)}><option value="">All Years</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button type="button" className={upcomingOnly ? "holiday-upcoming-filter is-active" : "holiday-upcoming-filter"} aria-pressed={upcomingOnly} onClick={() => setUpcomingOnly((value) => !value)}><i />Upcoming only</button></div></div>

        {loading ? <HolidayContentSkeleton /> : filteredHolidays.length === 0 ? <HolidayEmptyState hasFilters={Boolean(search || month || year || upcomingOnly)} onClear={() => { setSearch(""); setMonth(""); setYear(""); setUpcomingOnly(false); }} /> : viewMode === "calendar" ? <HolidayCalendar holidays={filteredHolidays} month={Number(month) || now.getMonth() + 1} year={Number(year) || now.getFullYear()} /> : <HolidayList upcoming={upcomingHolidays} past={pastHolidays} />}
      </section>
    </div>
  </main>;
}

const HolidayIcon = ({ name }) => { const paths = { calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>, month: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 2v5M16 2v5M8 14h.01M12 14h.01M16 14h.01" /></>, sparkle: <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />, flag: <><path d="M5 21V4" /><path d="M5 5h11l-2 4 2 4H5" /></>, search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>, grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>, list: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>, alert: <><path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>, empty: <><path d="M4 5h16v14H4zM8 2v6M16 2v6M4 10h16" /><path d="M9 15h6" /></> }; return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; };

const getCountdown = (value) => { const today = new Date(); today.setHours(0, 0, 0, 0); const target = new Date(`${value}`.split("T")[0] + "T00:00:00"); return Math.ceil((target - today) / 86400000); };
const CountdownBadge = ({ date }) => { const days = getCountdown(date); return <span className={days < 0 ? "holiday-countdown is-past" : days === 0 ? "holiday-countdown is-today" : "holiday-countdown"}>{days < 0 ? "Past" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`}</span>; };
const HolidaySummaryCard = ({ label, value, icon, tone }) => <article className={`holiday-summary__card holiday-summary__card--${tone}`}><span><HolidayIcon name={icon} /></span><div><small>{label}</small><strong>{value}</strong></div></article>;
const HolidaySummarySkeleton = () => <section className="holiday-summary holiday-summary--loading">{[1, 2, 3, 4].map((item) => <div key={item} />)}</section>;
const HolidayCard = ({ holiday, featured = false }) => { const date = new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00"); return <article className={featured ? "holiday-card holiday-card--featured" : "holiday-card"}><div className="holiday-card__date"><strong>{date.getDate()}</strong><span>{MONTHS[date.getMonth()].slice(0, 3)}</span></div><div className="holiday-card__content"><div><h3>{holidayName(holiday)}</h3><CountdownBadge date={holidayDate(holiday)} /></div><time>{formatDate(holidayDate(holiday))}</time>{holiday.description && <p>{holiday.description}</p>}</div></article>; };

const HolidayCalendar = ({ holidays, month, year }) => { const firstDay = new Date(year, month - 1, 1).getDay(); const daysInMonth = new Date(year, month, 0).getDate(); const cells = Array.from({ length: 42 }, (_, index) => { const day = index - firstDay + 1; return day > 0 && day <= daysInMonth ? day : null; }); const today = new Date(); return <div className="holiday-calendar"><div className="holiday-calendar__month"><HolidayIcon name="calendar" /><strong>{MONTHS[month - 1]} {year}</strong><span>{holidays.filter((holiday) => { const date = new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00"); return date.getMonth() + 1 === month && date.getFullYear() === year; }).length} holidays</span></div><div className="holiday-calendar__weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="holiday-calendar__grid">{cells.map((day, index) => { const dayHolidays = day ? holidays.filter((holiday) => { const date = new Date(`${holidayDate(holiday)}`.split("T")[0] + "T00:00:00"); return date.getDate() === day && date.getMonth() + 1 === month && date.getFullYear() === year; }) : []; const isToday = day && today.getDate() === day && today.getMonth() + 1 === month && today.getFullYear() === year; return <div key={index} className={`${day ? "" : "is-empty"} ${isToday ? "is-today" : ""} ${dayHolidays.length ? "has-holiday" : ""}`}><span>{day}</span>{dayHolidays.map((holiday, holidayIndex) => <small key={holiday.id || holidayIndex} title={holidayName(holiday)}>{holidayName(holiday)}</small>)}</div>; })}</div></div>; };
const HolidayList = ({ upcoming, past }) => <div>{upcoming.length > 0 && <section><div className="holiday-list__heading"><h3>Upcoming holidays</h3><span>{upcoming.length}</span></div><div className="holiday-list">{upcoming.map((holiday, index) => <HolidayCard key={holiday.id || `${holidayDate(holiday)}-upcoming-${index}`} holiday={holiday} />)}</div></section>}{past.length > 0 && <section><div className="holiday-list__heading"><h3>Past holidays</h3><span>{past.length}</span></div><div className="holiday-list">{past.map((holiday, index) => <HolidayCard key={holiday.id || `${holidayDate(holiday)}-past-${index}`} holiday={holiday} />)}</div></section>}</div>;
const HolidayContentSkeleton = () => <div className="holiday-content-skeleton">{Array.from({ length: 5 }, (_, index) => <div key={index}><span /><span /><span /></div>)}</div>;
const HolidayEmptyState = ({ hasFilters, onClear }) => <div className="holiday-empty"><span><HolidayIcon name="empty" /></span><h3>{hasFilters ? "No matching holidays" : "No holidays available"}</h3><p>{hasFilters ? "Try changing your search or calendar filters." : "Published holidays will appear here."}</p>{hasFilters && <button type="button" onClick={onClear}>Clear filters</button>}</div>;
