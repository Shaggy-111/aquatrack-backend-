const ATTENDANCE_TIME_ZONE = "Asia/Kolkata";

const parseTimestamp = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatAttendanceTime = (value) => {
  const date = parseTimestamp(value);
  return date
    ? date.toLocaleTimeString([], {
      timeZone: ATTENDANCE_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
    })
    : "—";
};

export const formatAttendanceDateTime = (value) => {
  const date = parseTimestamp(value);
  return date
    ? date.toLocaleString(undefined, {
      timeZone: ATTENDANCE_TIME_ZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    : "—";
};
