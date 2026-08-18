import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import BlinkitReports from "./BlinkitReports";

let mockPermissions = ["*"];
let mockLoading = false;
let mockBlinkitPin = "2468";
const mockNavigate = jest.fn();
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }), { virtual: true });
jest.mock("../config", () => ({ API_BASE_URL: "https://api.example.test", get VITE_BLINKIT_REPORT_PIN() { return mockBlinkitPin; } }));
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock("../hooks/usePermissions", () => ({ __esModule: true, clearPermissionsCache: jest.fn(), default: () => ({ permissionsLoading: mockLoading, hasPermission: (permission) => mockPermissions.includes("*") || mockPermissions.includes("*.*") || mockPermissions.includes(permission) }) }));
jest.mock("../hooks/useSidebar", () => ({ clearSidebarCache: jest.fn() }));
jest.mock("../hooks/usePermissionCatalog", () => ({ clearPermissionCatalogCache: jest.fn() }));
jest.mock("../components/AccessDenied", () => () => <div>Access denied test</div>);

const stores = [
  { id: "OUT-1", region: "South", state: "Tamil Nadu", city: "Chennai", entity: "BCPL" },
  { id: "OUT-2", region: "North", state: "Haryana", city: "Gurugram", entity: "ZHPL" },
  { id: "OUT-3", region: "North", state: "Haryana", city: "Faridabad", entity: "BCPL" },
  { id: "OUT-4", region: "North", state: "Uttar Pradesh", city: "Noida", entity: "BISTRO" },
  { id: "OUT-5", Region: " south ", State: "Tamil Nadu", City: "Madurai", Entity: "AMB" },
  { id: "OUT-6", Region: "   ", State: "", City: "", Entity: "" },
];
const partners = [{ full_name: "Zulu Vendor" }, { vendor_name: "alpha Vendor" }, { full_name: "" }];
const julyDays = ["1-Jul", "2-Jul", "3-Jul", "4-Jul", "5-Jul", "6-Jul"];
const row = { "S.No": 1, Region: "South", Entity: "BCPL", State: "Tamil Nadu", city: "Chennai", "Citi Lead": "Lead", "Outlet Names": "Anna Store", "Outlet Id": "OUT-1", "Mode of Ops": "Direct", "Live Date": "2026-01-01", "Supply start date": "2026-01-02", Status: "Live", "Closed/Dropped Date": null, "Admin POC": "Admin", "Contact No": "9999999999", "Vendor Name": "Vendor", "Total Count": 99, "1-Jul": 0, "2-Jul": 2, "3-Jul": 5, "4-Jul": 7, "5-Jul": 11, "6-Jul": 13 };
const response = (overrides = {}) => ({ data: { year: 2026, month: 7, days: julyDays, page: 1, page_size: 25, total: 1, rows: [row], ...overrides } });
const monthlyCalls = () => axios.get.mock.calls.filter(([url]) => url.endsWith("/blinkit-reports/monthly"));
const exportCalls = () => axios.get.mock.calls.filter(([url]) => url.endsWith("/blinkit-reports/monthly/export"));

describe("BlinkitReports", () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockPermissions = ["*"]; mockLoading = false; mockBlinkitPin = "2468"; localStorage.clear(); sessionStorage.clear(); localStorage.setItem("auth_token", "token");
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/store/store/list/all")) return Promise.resolve({ data: stores });
      if (url.endsWith("/partners/partners/list")) return Promise.resolve({ data: partners });
      if (url.endsWith("/blinkit-reports/monthly/export")) return Promise.resolve({ data: new Blob(["xlsx"]), headers: {} });
      return Promise.resolve(response());
    });
    axios.post.mockResolvedValue({ data: {} }); URL.createObjectURL = jest.fn(() => "blob:report"); URL.revokeObjectURL = jest.fn(); HTMLAnchorElement.prototype.click = jest.fn();
  });

  test("view permission gates page and all page API loading", () => {
    mockPermissions = []; render(<BlinkitReports />); expect(screen.getByText("Access denied test")).toBeTruthy(); expect(axios.get).not.toHaveBeenCalled();
  });

  test("defaults to current IST range, removes Year Month and Status, and sends month contract", async () => {
    render(<BlinkitReports />); await screen.findByText("Anna Store"); const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); expect(screen.getByLabelText("From Date").value).toBe(`${today.slice(0, 7)}-01`); expect(screen.getByLabelText("To Date").value).toBe(today); expect(screen.queryByLabelText("Year")).toBeNull(); expect(screen.queryByLabelText("Month")).toBeNull(); expect(screen.queryByLabelText("Status")).toBeNull(); const params = monthlyCalls()[0][1].params; expect(params.year).toBe(Number(today.slice(0, 4))); expect(params.month).toBe(Number(today.slice(5, 7))); expect(params.status).toBeUndefined();
  });

  test("accepts a same-month range and rejects a cross-month range without a request", async () => {
    render(<BlinkitReports />); await screen.findByText("Anna Store"); fireEvent.change(screen.getByLabelText("From Date"), { target: { value: "2026-07-02" } }); fireEvent.change(screen.getByLabelText("To Date"), { target: { value: "2026-07-05" } }); fireEvent.click(screen.getByRole("button", { name: "Apply" })); await waitFor(() => expect(monthlyCalls().length).toBe(2)); expect(monthlyCalls().at(-1)[1].params).toEqual(expect.objectContaining({ year: 2026, month: 7, page: 1 })); const accepted = monthlyCalls().length; fireEvent.change(screen.getByLabelText("To Date"), { target: { value: "2026-08-05" } }); fireEvent.click(screen.getByRole("button", { name: "Apply" })); expect(await screen.findByText("Please select a date range within the same month.")).toBeTruthy(); expect(monthlyCalls()).toHaveLength(accepted);
  });

  test("shows only selected daily columns and selected-range totals while preserving zero", async () => {
    render(<BlinkitReports />); await screen.findByText("Anna Store"); fireEvent.change(screen.getByLabelText("From Date"), { target: { value: "2026-07-01" } }); fireEvent.change(screen.getByLabelText("To Date"), { target: { value: "2026-07-03" } }); fireEvent.click(screen.getByRole("button", { name: "Apply" })); await screen.findByText("Anna Store"); const headers = screen.getAllByRole("columnheader").map((item) => item.textContent); expect(headers.slice(-3)).toEqual(["1-Jul", "2-Jul", "3-Jul"]); expect(headers).not.toContain("4-Jul"); expect(headers).not.toContain("Status"); expect(headers).not.toContain("Total Count"); expect(headers).toContain("Selected Range Total"); const reportRow = screen.getByText("Anna Store").closest("tr"); expect(within(reportRow).getByText("0")).toBeTruthy(); expect(within(reportRow).getByText("7")).toBeTruthy(); const summary = screen.getByText("Visible Page Bottles").closest("article"); expect(summary.querySelector("strong").textContent).toBe("7");
  });

  test.each([28, 29, 30, 31])("supports %s backend-provided day headers", async (count) => {
    const dynamic = Array.from({ length: count }, (_, index) => `${index + 1}-Jul`); axios.get.mockImplementation((url) => { if (url.includes("store/list")) return Promise.resolve({ data: stores }); if (url.includes("partners/list")) return Promise.resolve({ data: partners }); return Promise.resolve(response({ days: dynamic, rows: [{ ...row, ...Object.fromEntries(dynamic.map((day) => [day, 0])) }] })); }); render(<BlinkitReports />); await screen.findByText("Anna Store"); fireEvent.change(screen.getByLabelText("From Date"), { target: { value: "2026-07-01" } }); fireEvent.change(screen.getByLabelText("To Date"), { target: { value: `2026-07-${count}` } }); fireEvent.click(screen.getByRole("button", { name: "Apply" })); await waitFor(() => expect(screen.getAllByRole("columnheader").slice(-count).map((node) => node.textContent)).toEqual(dynamic));
  });

  test("master-data dropdowns are deduplicated, sorted, and dependent", async () => {
    render(<BlinkitReports />); await screen.findByText("Anna Store"); await waitFor(() => expect(within(screen.getByLabelText("Region")).getByRole("option", { name: "North" })).toBeTruthy()); expect(screen.getByLabelText("Region").tagName).toBe("SELECT"); expect(within(screen.getByLabelText("Region")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Regions", "North", "South"]); expect(screen.getByLabelText("State").tagName).toBe("SELECT"); expect(screen.getByLabelText("City").tagName).toBe("SELECT"); expect(screen.getByLabelText("Entity").tagName).toBe("SELECT"); expect(within(screen.getByLabelText("Entity")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Entities", "AMB", "BCPL", "BISTRO", "ZHPL"]); expect(within(screen.getByLabelText("Entity")).getAllByRole("option", { name: "AMB" })).toHaveLength(1); expect(within(screen.getByLabelText("Vendor Name")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Vendors", "alpha Vendor", "Zulu Vendor"]); fireEvent.change(screen.getByLabelText("Region"), { target: { value: "North" } }); expect(within(screen.getByLabelText("State")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All States", "Haryana", "Uttar Pradesh"]); fireEvent.change(screen.getByLabelText("State"), { target: { value: "Haryana" } }); expect(within(screen.getByLabelText("City")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Cities", "Faridabad", "Gurugram"]); fireEvent.change(screen.getByLabelText("City"), { target: { value: "Gurugram" } }); fireEvent.change(screen.getByLabelText("State"), { target: { value: "Uttar Pradesh" } }); expect(screen.getByLabelText("City").value).toBe(""); fireEvent.change(screen.getByLabelText("City"), { target: { value: "Noida" } }); fireEvent.change(screen.getByLabelText("Region"), { target: { value: "South" } }); expect(screen.getByLabelText("State").value).toBe(""); expect(screen.getByLabelText("City").value).toBe("");
  });

  test("Apply sends selected filters at page one and Reset restores defaults", async () => {
    render(<BlinkitReports />); await screen.findByText("Anna Store"); await screen.findByRole("option", { name: "South" }); fireEvent.change(screen.getByLabelText("Region"), { target: { value: "South" } }); fireEvent.change(screen.getByLabelText("State"), { target: { value: "Tamil Nadu" } }); fireEvent.change(screen.getByLabelText("City"), { target: { value: "Chennai" } }); fireEvent.change(screen.getByLabelText("Entity"), { target: { value: "BCPL" } }); fireEvent.change(screen.getByLabelText("Vendor Name"), { target: { value: "alpha Vendor" } }); fireEvent.change(screen.getByLabelText("Outlet / Search"), { target: { value: "OUT-1" } }); fireEvent.click(screen.getByRole("button", { name: "Apply" })); await waitFor(() => expect(monthlyCalls().length).toBe(2)); expect(monthlyCalls().at(-1)[1].params).toEqual(expect.objectContaining({ region: "South", state: "Tamil Nadu", city: "Chennai", entity: "BCPL", vendor_name: "alpha Vendor", store_id: "OUT-1", page: 1 })); fireEvent.click(screen.getByRole("button", { name: "Reset" })); await waitFor(() => expect(monthlyCalls().length).toBe(3)); expect(screen.getByLabelText("Region").value).toBe(""); expect(screen.getByLabelText("State").value).toBe(""); expect(screen.getByLabelText("City").value).toBe(""); expect(screen.getByLabelText("Entity").value).toBe(""); expect(screen.getByLabelText("Vendor Name").value).toBe(""); expect(screen.getByLabelText("Outlet / Search").value).toBe("");
  });

  test("uses server pagination and supported page sizes", async () => {
    axios.get.mockImplementation((url) => { if (url.includes("store/list")) return Promise.resolve({ data: stores }); if (url.includes("partners/list")) return Promise.resolve({ data: partners }); return Promise.resolve(response({ total: 60 })); }); render(<BlinkitReports />); await screen.findByText("Anna Store"); expect(within(screen.getByLabelText("Rows per page")).getAllByRole("option").map((option) => option.textContent)).toEqual(["25", "50", "100"]); fireEvent.click(screen.getByRole("button", { name: "Next" })); await waitFor(() => expect(monthlyCalls().at(-1)[1].params.page).toBe(2)); fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "50" } }); await waitFor(() => expect(monthlyCalls().at(-1)[1].params).toEqual(expect.objectContaining({ page: 1, page_size: 50 })));
  });

  test("partial range labels exports as full month and preserves month-only request", async () => {
    render(<BlinkitReports />); await screen.findByText("Anna Store"); expect(screen.getByRole("button", { name: "Export Full Month Excel" })).toBeTruthy(); expect(screen.getByText("Excel export currently includes the full selected month.")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Export Full Month Excel" })); await waitFor(() => expect(exportCalls()).toHaveLength(1)); expect(screen.queryByText("Security Verification")).toBeNull(); const params = exportCalls()[0][1].params; expect(params.include_vendor_rate).toBe(false); expect(params.from_date).toBeUndefined(); expect(params.to_date).toBeUndefined(); expect(params.year).toBeDefined(); expect(params.month).toBeDefined();
  });

  test("Vendor Rate remains permission and response controlled", async () => {
    mockPermissions = ["blinkit_reports.view"]; render(<BlinkitReports />); await screen.findByText("Anna Store"); expect(screen.queryByRole("button", { name: /Vendor Rate/ })).toBeNull(); expect(screen.queryByRole("columnheader", { name: "Vendor Rate" })).toBeNull();
  });

  test.each(["38.0000", "42.0000"])("authorized Vendor Rate %s is masked everywhere", async (rate) => {
    axios.get.mockImplementation((url) => { if (url.includes("store/list")) return Promise.resolve({ data: stores }); if (url.includes("partners/list")) return Promise.resolve({ data: partners }); return Promise.resolve(response({ rows: [{ ...row, "Vendor Rate": rate }] })); }); render(<BlinkitReports />); await screen.findByText("Anna Store"); expect(screen.getByRole("columnheader", { name: "Vendor Rate" })).toBeTruthy(); expect(screen.getByText("****")).toBeTruthy(); expect(screen.queryByText(rate)).toBeNull(); expect(document.body.innerHTML).not.toContain(rate);
  });

  test("a full-month range keeps the normal export label", async () => {
    render(<BlinkitReports />); await screen.findByText("Anna Store"); fireEvent.change(screen.getByLabelText("From Date"), { target: { value: "2026-07-01" } }); fireEvent.change(screen.getByLabelText("To Date"), { target: { value: "2026-07-31" } }); fireEvent.click(screen.getByRole("button", { name: "Apply" })); await waitFor(() => expect(screen.getByRole("button", { name: "Export Excel" })).toBeTruthy()); expect(screen.queryByText("Excel export currently includes the full selected month.")).toBeNull();
  });

  test("metadata upload requires PIN, rejects wrong PIN, then preserves XLSX workflow", async () => {
    let release; axios.post.mockImplementation(() => new Promise((resolve) => { release = resolve; })); render(<BlinkitReports />); await screen.findByText("Anna Store"); fireEvent.click(screen.getByRole("button", { name: "Upload Metadata" })); let dialog = screen.getByRole("dialog", { name: "Security Verification" }); const password = within(dialog).getByLabelText("Password"); expect(document.activeElement).toBe(password); fireEvent.change(password, { target: { value: "wrong" } }); fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); expect(await within(dialog).findByText("Incorrect PIN. Please try again.")).toBeTruthy(); expect(axios.post).not.toHaveBeenCalled(); expect(screen.queryByText("Upload Blinkit Metadata")).toBeNull(); fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "2468" } }); fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); dialog = await screen.findByRole("dialog", { name: "Upload Blinkit Metadata" }); expect(localStorage.getItem("VITE_BLINKIT_REPORT_PIN")).toBeNull(); expect(sessionStorage.length).toBe(0); const file = new File(["xlsx"], "metadata.xlsx"); fireEvent.change(within(dialog).getByLabelText("Excel file"), { target: { files: [file] } }); const submit = within(dialog).getByRole("button", { name: "Upload Metadata" }); fireEvent.click(submit); fireEvent.click(submit); expect(axios.post).toHaveBeenCalledTimes(1); expect(axios.post.mock.calls[0][1].get("file")).toBe(file); await act(async () => release({ data: { total_rows: 1, created: 1, updated: 0, skipped: 0 } })); expect(await screen.findByText("Total Rows")).toBeTruthy();
  });

  test("sensitive export requires PIN and correct PIN sends exactly one authorized request", async () => {
    render(<BlinkitReports />); await screen.findByText("Anna Store"); fireEvent.click(screen.getByRole("button", { name: "Export Full Month With Vendor Rate" })); let dialog = screen.getByRole("dialog", { name: "Security Verification" }); fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "wrong" } }); fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); expect(exportCalls()).toHaveLength(0); fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "2468" } }); fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); await waitFor(() => expect(exportCalls()).toHaveLength(1)); expect(exportCalls()[0][1].params.include_vendor_rate).toBe(true);
  });

  test("backend 403 remains authoritative after correct sensitive-export PIN", async () => {
    axios.get.mockImplementation((url) => { if (url.includes("store/list")) return Promise.resolve({ data: stores }); if (url.includes("partners/list")) return Promise.resolve({ data: partners }); if (url.endsWith("/monthly/export")) return Promise.reject({ response: { status: 403 } }); return Promise.resolve(response()); }); render(<BlinkitReports />); await screen.findByText("Anna Store"); fireEvent.click(screen.getByRole("button", { name: "Export Full Month With Vendor Rate" })); const dialog = screen.getByRole("dialog", { name: "Security Verification" }); fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "2468" } }); fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); expect(await screen.findByText("You do not have permission to export Vendor Rate.")).toBeTruthy();
  });

  test.each(["Upload Metadata", "Export Full Month With Vendor Rate"])("missing PIN fails closed for %s", async (action) => {
    mockBlinkitPin = ""; render(<BlinkitReports />); await screen.findByText("Anna Store"); fireEvent.click(screen.getByRole("button", { name: action })); expect(await screen.findByText("Blinkit Report security PIN is not configured.")).toBeTruthy(); expect(screen.queryByText("Security Verification")).toBeNull(); expect(axios.post).not.toHaveBeenCalled(); expect(exportCalls()).toHaveLength(0);
  });

  test("AMB remains unique and uses the existing entity parameter", async () => {
    render(<BlinkitReports />); await screen.findByText("Anna Store"); await screen.findByRole("option", { name: "AMB" }); fireEvent.change(screen.getByLabelText("Entity"), { target: { value: "AMB" } }); fireEvent.click(screen.getByRole("button", { name: "Apply" })); await waitFor(() => expect(monthlyCalls().at(-1)[1].params.entity).toBe("AMB"));
  });
});
