import { formatAttendanceDateTime, formatAttendanceTime } from "./dateTime";

describe("attendance date/time formatting", () => {
  test.each([
    ["IST-offset timestamp", "2026-08-03T12:00:00+05:30"],
    ["UTC timestamp", "2026-08-03T06:30:00Z"],
  ])("formats %s as the same Kolkata time", (_, value) => {
    expect(formatAttendanceTime(value)).toMatch(/12:00\s*PM/i);
  });

  test("formats date and time in Kolkata", () => {
    expect(formatAttendanceDateTime("2026-08-03T06:30:00Z")).toMatch(/03.*Aug.*2026.*12:00\s*PM/i);
  });

  test.each([null, undefined, "", "not-a-timestamp"])("returns an em dash for %p", (value) => {
    expect(formatAttendanceTime(value)).toBe("—");
    expect(formatAttendanceDateTime(value)).toBe("—");
  });

  test.each(["UTC", "Asia/Kolkata"])("passes Asia/Kolkata when the browser timezone is %s", (browserTimeZone) => {
    const resolvedOptions = jest.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ timeZone: browserTimeZone });
    const localeTime = jest.spyOn(Date.prototype, "toLocaleTimeString");
    const localeDateTime = jest.spyOn(Date.prototype, "toLocaleString");

    formatAttendanceTime("2026-08-03T06:30:00Z");
    formatAttendanceDateTime("2026-08-03T06:30:00Z");

    expect(localeTime).toHaveBeenCalledWith([], expect.objectContaining({ timeZone: "Asia/Kolkata" }));
    expect(localeDateTime).toHaveBeenCalledWith(undefined, expect.objectContaining({ timeZone: "Asia/Kolkata" }));

    resolvedOptions.mockRestore();
    localeTime.mockRestore();
    localeDateTime.mockRestore();
  });
});
