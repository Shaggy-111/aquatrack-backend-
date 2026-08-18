import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import fs from "fs";
import path from "path";
import MonthlyVirtualCards from "./MonthlyVirtualCards";

let mockPermissionState = { permissionsLoading: false, allowed: true, permissions: ["*"] };
const mockNavigate = jest.fn();
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }), { virtual: true });
jest.mock("qrcode.react", () => ({ QRCodeSVG: ({ value, title, size, level, bgColor, fgColor, includeMargin }) => <svg data-testid="store-qr-code" data-value={value} data-size={size} data-level={level} data-bg={bgColor} data-fg={fgColor} data-margin={String(includeMargin)}><title>{title}</title></svg> }));
jest.mock("../config", () => ({ API_BASE_URL: "https://api.example.test" }));
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock("../hooks/usePermissions", () => ({ __esModule: true, clearPermissionsCache: jest.fn(), default: () => ({ permissionsLoading: mockPermissionState.permissionsLoading, hasPermission: (key) => mockPermissionState.allowed && (mockPermissionState.permissions.includes("*") || mockPermissionState.permissions.includes(key)) }) }));
jest.mock("../hooks/useSidebar", () => ({ clearSidebarCache: jest.fn() }));
jest.mock("../hooks/usePermissionCatalog", () => ({ clearPermissionCatalogCache: jest.fn() }));
jest.mock("../components/AccessDenied", () => () => <div>Access denied test</div>);

const cards = Array.from({ length: 26 }, (_, index) => ({ id: index + 1, store_id: String(3300 + index), year: 2026, month: 8, status: "open", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z" }));

describe("MonthlyVirtualCards", () => {
  beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); localStorage.setItem("auth_token", "token"); mockPermissionState = { permissionsLoading: false, allowed: true, permissions: ["*"] }; axios.get.mockResolvedValue({ data: [] }); });

  test("does not call APIs while permissions load and denies missing permission", () => {
    mockPermissionState = { permissionsLoading: true, allowed: false, permissions: [] };
    const { rerender } = render(<MonthlyVirtualCards />);
    expect(screen.getByText("Loading permissions…")).toBeTruthy(); expect(axios.get).not.toHaveBeenCalled();
    mockPermissionState = { permissionsLoading: false, allowed: false, permissions: [] }; rerender(<MonthlyVirtualCards />);
    expect(screen.getByText("Access denied test")).toBeTruthy(); expect(axios.get).not.toHaveBeenCalled();
  });

  test("loads with current IST month/year and omits blank optional filters", async () => {
    render(<MonthlyVirtualCards />);
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(1));
    const params = axios.get.mock.calls[0][1].params;
    const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    expect(params.year).toBe(ist.getFullYear()); expect(params.month).toBe(ist.getMonth() + 1);
    expect(params.store_id).toBeUndefined(); expect(params.region).toBeUndefined(); expect(params.channel).toBeUndefined(); expect(params.entity).toBeUndefined(); expect(params.status).toBeUndefined();
  });

  test("wildcard permission access reaches the list API", async () => {
    // usePermissions owns wildcard normalization; an allowed result must enter the same view path.
    mockPermissionState = { permissionsLoading: false, allowed: true, permissions: ["*"] };
    render(<MonthlyVirtualCards />);
    await waitFor(() => expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("/monthly-virtual-cards"), expect.any(Object)));
  });

  test("applies list filters and supports client pagination and reset", async () => {
    axios.get.mockImplementation((url) => url.includes("/store/store/list/all") ? Promise.resolve({ data: [{ region: "West" }] }) : Promise.resolve({ data: cards })); render(<MonthlyVirtualCards />);
    await screen.findByText("#1"); expect(screen.queryByText("#26")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "→" })); expect(await screen.findByText("#26")).toBeTruthy();
    fireEvent.focus(screen.getByLabelText("Region")); await screen.findByRole("option", { name: "West" }); fireEvent.change(screen.getByLabelText("Region"), { target: { value: "West" } }); fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(axios.get.mock.calls.filter(([url]) => url.includes("/monthly-virtual-cards")).at(-1)[1].params.region).toBe("West")); expect(screen.getByText(/Page 1 of/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Reset" })); expect(screen.getByLabelText("Region").value).toBe("");
  });

  test("loads database-derived Region Channel and Entity dropdowns once and preserves filter params", async () => {
    const master = [{ region: " West ", channel: "BLINKIT", entity: "BCPL" }, { Region: "west", Channel: "ZEPTO", Entity: "BISTRO" }, { region: "", channel: "  ", entity: null }, { region: "North", channel: "BLINKIT", entity: "AMB" }];
    axios.get.mockImplementation((url) => url.includes("/store/store/list/all") ? Promise.resolve({ data: { stores: master } }) : Promise.resolve({ data: [] })); render(<MonthlyVirtualCards />); await screen.findByText("No virtual cards found");
    expect(screen.getByLabelText("Region").tagName).toBe("SELECT"); expect(screen.getByLabelText("Channel").tagName).toBe("SELECT"); expect(screen.getByLabelText("Entity").tagName).toBe("SELECT"); fireEvent.focus(screen.getByLabelText("Region")); await screen.findByRole("option", { name: "West" }); fireEvent.focus(screen.getByLabelText("Channel")); fireEvent.focus(screen.getByLabelText("Entity"));
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/store/store/list/all"))).toHaveLength(1); expect(within(screen.getByLabelText("Region")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Regions", "North", "West"]); expect(within(screen.getByLabelText("Channel")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Channels", "BLINKIT", "ZEPTO"]); expect(within(screen.getByLabelText("Entity")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Entities", "AMB", "BCPL", "BISTRO"]);
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "West" } }); fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "ZEPTO" } }); fireEvent.change(screen.getByLabelText("Entity"), { target: { value: "AMB" } }); fireEvent.click(screen.getByRole("button", { name: "Apply" })); await waitFor(() => expect(axios.get.mock.calls.filter(([url]) => url.includes("/monthly-virtual-cards")).at(-1)[1].params).toEqual(expect.objectContaining({ region: "West", channel: "ZEPTO", entity: "AMB" })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset" }).disabled).toBe(false)); fireEvent.click(screen.getByRole("button", { name: "Reset" })); expect(screen.getByLabelText("Region").value).toBe(""); expect(screen.getByLabelText("Channel").value).toBe(""); expect(screen.getByLabelText("Entity").value).toBe(""); expect(axios.post).not.toHaveBeenCalled(); expect(axios.put).not.toHaveBeenCalled();
  });

  test("fetches detail lazily, renders sorted dynamic entries and closes with Escape", async () => {
    axios.get.mockResolvedValueOnce({ data: [cards[0]] }).mockResolvedValueOnce({ data: { ...cards[0], store_name: "Aqua Store", entity: "BCPL", channel: "BLINKIT", region: "West", state: "Goa", city: "Panaji", address: "Market Road", project_code: "PX", qr_public_id: "qr-1", entries: [{ id: 2, entry_date: "2026-08-05", linked_order_ids: [9, 10] }, { id: 1, entry_date: "2026-08-01", linked_order_ids: [7] }] } });
    render(<MonthlyVirtualCards />); await screen.findByText("#1"); expect(axios.get).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "View Card" })); await screen.findAllByText("Aqua Store");
    expect(screen.getAllByText("BCPL")).toHaveLength(2); expect(screen.getByText("9, 10")).toBeTruthy();
    const dates = screen.getAllByText(/2026-08-0[15]/).map((node) => node.textContent); expect(dates.indexOf("2026-08-01")).toBeLessThan(dates.indexOf("2026-08-05"));
    fireEvent.keyDown(window, { key: "Escape" }); expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("closes drawer from backdrop and shows list empty and error states", async () => {
    axios.get.mockResolvedValueOnce({ data: [cards[0]] }).mockResolvedValueOnce({ data: { ...cards[0], store_name: "Store", entries: [] } });
    render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findByRole("dialog");
    fireEvent.mouseDown(screen.getByTestId("drawer-backdrop")); expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("shows safe empty and request error states", async () => {
    axios.get.mockResolvedValueOnce({ data: [] }); const first = render(<MonthlyVirtualCards />); await screen.findByText("No virtual cards found"); first.unmount();
    axios.get.mockRejectedValueOnce({ response: { status: 500, data: { detail: "internal" } } }); render(<MonthlyVirtualCards />); expect(await screen.findByText("Unable to load monthly virtual cards.")).toBeTruthy();
  });

  test("hides mutation actions without their permissions", async () => {
    mockPermissionState = { permissionsLoading: false, allowed: true, permissions: ["monthly_virtual_cards.view"] };
    axios.get.mockResolvedValueOnce({ data: [cards[0]] }).mockResolvedValueOnce({ data: { ...cards[0], store_name: "Store", entries: [{ id: 1, entry_date: "2026-08-01" }] } });
    render(<MonthlyVirtualCards />); await screen.findByText("#1"); expect(screen.queryByText("Generate Cards")).toBeNull(); fireEvent.click(screen.getByText("View Card")); await screen.findAllByText("Store"); expect(screen.queryByText("Add Entry")).toBeNull(); expect(screen.queryByText("Edit")).toBeNull();
  });

  test("generates idempotently with the active period and refreshes the list", async () => {
    axios.get.mockResolvedValue({ data: [] }); axios.post.mockResolvedValue({ data: { total_active_stores: 988, created_count: 0, existing_count: 988 } });
    render(<MonthlyVirtualCards />); await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(1)); fireEvent.click(screen.getByText("Generate Cards"));
    const year = Number(screen.getByLabelText("Generate year").value); const month = Number(screen.getByLabelText("Generate month").value); fireEvent.click(screen.getAllByRole("button", { name: "Generate Cards" })[1]);
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(expect.stringContaining("/generate"), { year, month }, expect.any(Object))); expect(await screen.findByText("Created: 0")).toBeTruthy(); expect(screen.getByText("Already existing: 988")).toBeTruthy(); expect(axios.get.mock.calls.length).toBeGreaterThan(1);
  });

  test("validates add entry and saves correct URL/body then refreshes detail", async () => {
    const detail = { ...cards[0], id: 49, store_name: "Store", entries: [] }; axios.get.mockResolvedValueOnce({ data: [detail] }).mockResolvedValue({ data: detail }); axios.put.mockResolvedValue({ data: { order_id: 10, order_created: false, entry_created: true, final_bottles_delivered: 4, final_empty_bottles_collected: 3, store_pending_empty_bottles: 8 } });
    render(<MonthlyVirtualCards />); await screen.findByText("#49"); fireEvent.click(screen.getByText("View Card")); await screen.findAllByText("Store"); fireEvent.click(screen.getByText("Add Entry"));
    fireEvent.change(screen.getByLabelText("Entry date"), { target: { value: "2026-09-01" } }); fireEvent.click(screen.getByText("Save Entry")); expect(await screen.findByText("Entry date must belong to the card month.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Entry date"), { target: { value: "2026-08-05" } }); fireEvent.change(screen.getByLabelText("Final Bottles Delivered"), { target: { value: "4" } }); fireEvent.change(screen.getByLabelText("Final Empty Bottles Collected"), { target: { value: "3" } }); fireEvent.change(screen.getByLabelText("Remarks"), { target: { value: "UAT" } }); fireEvent.click(screen.getByText("Save Entry"));
    await waitFor(() => expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/49/entries/2026-08-05"), { bottles_delivered: 4, empty_bottles_collected: 3, remarks: "UAT" }, expect.any(Object))); expect(await screen.findByText(/Order reused: 10/)).toBeTruthy(); expect(axios.get.mock.calls.length).toBeGreaterThan(2);
  });

  test("edit prefills quantities and date and sends the final values", async () => {
    const detail = { ...cards[0], store_name: "Store", entries: [{ id: 1, entry_date: "2026-08-05", bottles_delivered: 7, empty_bottles_collected: 6, remarks: "old" }] }; axios.get.mockResolvedValueOnce({ data: [detail] }).mockResolvedValue({ data: detail }); axios.put.mockResolvedValue({ data: {} }); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findAllByText("Store"); fireEvent.click(screen.getByText("Edit")); expect(screen.getByLabelText("Entry date").readOnly).toBe(true); expect(screen.getByLabelText("Final Bottles Delivered").value).toBe("7"); expect(screen.getByLabelText("Final Empty Bottles Collected").value).toBe("6"); expect(screen.getByLabelText("Remarks").value).toBe("old"); fireEvent.click(screen.getByText("Save Entry")); await waitFor(() => expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/1/entries/2026-08-05"), { bottles_delivered: 7, empty_bottles_collected: 6, remarks: "old" }, expect.any(Object)));
  });

  test("rejects invalid generate year and locks duplicate submissions", async () => {
    let release; axios.post.mockImplementation(() => new Promise((resolve) => { release = resolve; })); render(<MonthlyVirtualCards />); await screen.findByText("No virtual cards found"); fireEvent.click(screen.getByText("Generate Cards")); fireEvent.change(screen.getByLabelText("Generate year"), { target: { value: "2019" } }); fireEvent.submit(screen.getByLabelText("Generate year").closest("form")); expect(await screen.findByText("Year must be an integer from 2020 to 2100.")).toBeTruthy(); expect(axios.post).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText("Generate year"), { target: { value: "2026" } }); const form = screen.getByLabelText("Generate year").closest("form"); fireEvent.submit(form); fireEvent.submit(form); expect(axios.post).toHaveBeenCalledTimes(1); await act(async () => release({ data: { total_active_stores: 1, created_count: 1, existing_count: 0 } }));
  });

  test("blocks drawer close paths while save and detail refresh are pending", async () => {
    let releasePut; let releaseRefresh; const detail = { ...cards[0], store_name: "Store", entries: [] }; axios.get.mockResolvedValueOnce({ data: [detail] }).mockResolvedValueOnce({ data: detail }).mockImplementationOnce(() => new Promise((resolve) => { releaseRefresh = resolve; })); axios.put.mockImplementation(() => new Promise((resolve) => { releasePut = resolve; })); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findByText("Store"); fireEvent.click(screen.getByText("Add Entry")); fireEvent.change(screen.getByLabelText("Entry date"), { target: { value: "2026-08-05" } }); fireEvent.click(screen.getByText("Save Entry")); expect(screen.getByLabelText("Close card details").disabled).toBe(true); fireEvent.keyDown(window, { key: "Escape" }); fireEvent.mouseDown(screen.getByTestId("drawer-backdrop")); expect(screen.getByRole("dialog", { name: "Add Daily Entry" })).toBeTruthy(); await act(async () => releasePut({ data: { entry_created: true } })); expect(screen.getByText("Saving…")).toBeTruthy(); await act(async () => releaseRefresh({ data: detail })); await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Daily Entry" })).toBeNull()); expect(screen.getByRole("dialog", { name: /Store/ })).toBeTruthy();
  });

  test("failed PUT unlocks retry and maps safe conflict and validation errors", async () => {
    const detail = { ...cards[0], store_name: "Store", entries: [] }; axios.get.mockResolvedValueOnce({ data: [detail] }).mockResolvedValueOnce({ data: detail }); axios.put.mockRejectedValueOnce({ response: { status: 409, data: { detail: "card closed" } } }).mockRejectedValueOnce({ response: { status: 422, data: { detail: [{ loc: ["body", "remarks"], msg: "secret internals" }] } } }); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findByText("Store"); fireEvent.click(screen.getByText("Add Entry")); fireEvent.change(screen.getByLabelText("Entry date"), { target: { value: "2026-08-05" } }); fireEvent.click(screen.getByText("Save Entry")); expect(await screen.findByText("This monthly card is closed and cannot be updated.")).toBeTruthy(); fireEvent.click(screen.getByText("Save Entry")); expect(await screen.findByText("Please correct the remarks field.")).toBeTruthy(); expect(screen.queryByText("secret internals")).toBeNull(); expect(axios.put).toHaveBeenCalledTimes(2);
  });

  test("401 clears the session and returns to login", async () => {
    localStorage.setItem("user_role", "employee"); axios.get.mockRejectedValueOnce({ response: { status: 401 } }); render(<MonthlyVirtualCards />); await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login")); expect(localStorage.getItem("auth_token")).toBeNull(); expect(localStorage.getItem("user_role")).toBeNull();
  });

  test("focus enters and returns from generate dialog", async () => {
    render(<MonthlyVirtualCards />); await screen.findByText("No virtual cards found"); const trigger = screen.getByText("Generate Cards"); trigger.focus(); fireEvent.click(trigger); await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Generate year"))); fireEvent.click(screen.getByText("Cancel")); expect(document.activeElement).toBe(trigger);
  });

  test("ignores an older list response after generation refresh", async () => {
    let releaseOld; let releaseFresh; axios.get.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; })).mockImplementationOnce(() => new Promise((resolve) => { releaseFresh = resolve; })); axios.post.mockResolvedValue({ data: { total_active_stores: 1, created_count: 1, existing_count: 0 } }); render(<MonthlyVirtualCards />); fireEvent.click(screen.getByText("Generate Cards")); fireEvent.submit(screen.getByLabelText("Generate year").closest("form")); await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2)); await act(async () => releaseFresh({ data: [{ ...cards[0], id: 200 }] })); expect(await screen.findByText("#200")).toBeTruthy(); await act(async () => releaseOld({ data: [{ ...cards[0], id: 100 }] })); expect(screen.queryByText("#100")).toBeNull(); expect(screen.getByText("#200")).toBeTruthy();
  });

  test("closing a drawer invalidates its pending detail response", async () => {
    let releaseOldDetail; const first = { ...cards[0], id: 1, store_id: "3300" }; const secondDetail = { ...first, store_name: "Fresh Store", entries: [] }; axios.get.mockResolvedValueOnce({ data: [first] }).mockImplementationOnce(() => new Promise((resolve) => { releaseOldDetail = resolve; })).mockResolvedValueOnce({ data: secondDetail }); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); fireEvent.click(screen.getByLabelText("Close card details")); fireEvent.click(screen.getByText("View Card")); expect(await screen.findByText("Fresh Store")).toBeTruthy(); await act(async () => releaseOldDetail({ data: { ...secondDetail, store_name: "Stale Store" } })); expect(screen.queryByText("Stale Store")).toBeNull(); expect(screen.getByText("Fresh Store")).toBeTruthy();
  });

  test.each([[2025, 2, 28], [2024, 2, 29], [2026, 4, 30], [2026, 8, 31]])("print grid renders every day for %s-%s", async (year, month, expected) => {
    const card = { ...cards[0], year, month, store_name: "Calendar Store", entries: [] }; axios.get.mockResolvedValueOnce({ data: [card] }).mockResolvedValueOnce({ data: card }); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findAllByText("Calendar Store"); expect(screen.getAllByTestId("print-day-row")).toHaveLength(expected);
  });

  test("print preview maps entries and preserves blank missing dates", async () => {
    const exactUrl = "https://veekayaquatech.com/qr/test-signed-token"; const card = { ...cards[0], store_name: "Preview Store", entity: "BCPL", channel: "BLINKIT", region: "West", qr_public_id: "store-qr-123", qr_public_url: `  ${exactUrl}  `, entries: [{ id: 1, entry_date: "2026-08-05", bottles_delivered: 12, empty_bottles_collected: 9, remarks: "Mapped", linked_order_ids: [77] }] }; axios.get.mockResolvedValueOnce({ data: [card] }).mockResolvedValueOnce({ data: card }); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findAllByText("Preview Store"); const preview = document.querySelector(".mvc-print-card"); expect(within(preview).getByText("VEE KAY AQUATECH PVT LTD")).toBeTruthy(); expect(within(preview).queryByText("Veekay Aquatech Pvt Ltd")).toBeNull(); expect(within(preview).getByText("August 2026")).toBeTruthy(); expect(within(preview).queryByText(/GST/i)).toBeNull(); expect(within(preview).queryByText("Authorized Signatory")).toBeNull(); expect(within(preview).getByText("Store Manager Signature")).toBeTruthy(); expect(within(preview).getByText("Delivery Executive Signature")).toBeTruthy(); expect(within(preview).getByAltText("Veekay")).toBeTruthy(); expect(within(preview).getByAltText("Veekay official stamp")).toBeTruthy(); expect(within(preview).getByText("Scan to verify store")).toBeTruthy(); expect(within(preview).getByTitle("Store verification QR code")).toBeTruthy(); const qr = within(preview).getByTestId("store-qr-code"); const qrValue = qr.getAttribute("data-value"); expect(qrValue).toBe(exactUrl); expect(Number(qr.getAttribute("data-size"))).toBeGreaterThanOrEqual(150); expect(qr.getAttribute("data-level")).toBe("M"); expect(qr.getAttribute("data-margin")).toBe("true"); expect(qr.getAttribute("data-bg")).toBe("#FFFFFF"); expect(qr.getAttribute("data-fg")).toBe("#000000"); expect(qrValue).not.toContain("qr_public_url"); expect(qrValue).not.toContain('"'); expect(qrValue.startsWith("{")).toBe(false); expect(qrValue).not.toBe(card.qr_public_id); const source = fs.readFileSync(path.join(process.cwd(), "src/pages/MonthlyVirtualCards.jsx"), "utf8"); expect(source).not.toMatch(/QRCodeSVG[^>]*value=\{JSON\.stringify/); const mapped = screen.getAllByTestId("print-day-row").find((row) => row.cells[0].textContent === "2026-08-05"); expect(within(mapped).getByText("12")).toBeTruthy(); expect(within(mapped).getByText("9")).toBeTruthy(); expect(within(mapped).getByText("Mapped")).toBeTruthy(); const missing = screen.getAllByTestId("print-day-row").find((row) => row.cells[0].textContent === "2026-08-06"); expect(missing.cells[1].textContent).toBe(""); expect(missing.cells[2].textContent).toBe(""); expect(screen.getByRole("columnheader", { name: "Delivered Bottles" })).toBeTruthy(); expect(screen.getByRole("columnheader", { name: "Empty Bottles" })).toBeTruthy(); expect(screen.getByText("77")).toBeTruthy(); expect(preview).toBeTruthy(); expect(document.querySelector(".mvc-digital-entries")).toBeTruthy();
  });

  test("shows a safe placeholder when the signed QR URL is missing", async () => {
    const card = { ...cards[0], store_name: "No QR Store", qr_public_id: "text-only-id", entries: [] }; axios.get.mockResolvedValueOnce({ data: [card] }).mockResolvedValueOnce({ data: card }); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findAllByText("No QR Store"); const preview = document.querySelector(".mvc-print-card"); expect(within(preview).getByText("QR unavailable")).toBeTruthy(); expect(within(preview).queryByTestId("store-qr-code")).toBeNull(); expect(within(preview).getByText("text-only-id")).toBeTruthy();
  });

  test("does not render a QR for a non-string or untrusted URL", async () => {
    const card = { ...cards[0], store_name: "Invalid QR Store", qr_public_id: "fallback-must-not-encode", qr_public_url: { url: "https://veekayaquatech.com/qr/object-token" }, entries: [] }; axios.get.mockResolvedValueOnce({ data: [card] }).mockResolvedValueOnce({ data: card }); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findAllByText("Invalid QR Store"); const preview = document.querySelector(".mvc-print-card"); expect(within(preview).getByText("QR unavailable")).toBeTruthy(); expect(within(preview).queryByTestId("store-qr-code")).toBeNull();
  });

  test("print actions use browser print and expose the PDF fallback label", async () => {
    const signedUrl = "https://veekayaquatech.com/qr/test-signed-token"; const rawModes = []; const rawCompanies = []; const rawRowCounts = []; const printedQrValues = []; const print = jest.spyOn(window, "print").mockImplementation(() => { const raw = document.body.classList.contains("mvc-printing-raw"); rawModes.push(raw); printedQrValues.push(screen.getByTestId("store-qr-code").getAttribute("data-value")); if (raw) { rawCompanies.push(document.querySelector(".mvc-print-brand h2").textContent); rawRowCounts.push(screen.getAllByTestId("print-day-row").length); } }); const card = { ...cards[0], year: 2024, month: 2, store_name: "Print Store", qr_public_id: "print-store-qr", qr_public_url: signedUrl, entries: [] }; axios.get.mockResolvedValueOnce({ data: [card] }).mockResolvedValueOnce({ data: card }); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findAllByText("Print Store"); fireEvent.click(screen.getByText("Print Card")); fireEvent.click(screen.getByText("Print / Save PDF")); fireEvent.click(screen.getAllByText("Download Raw Card")[0]); expect(print).toHaveBeenCalledTimes(3); expect(rawModes).toEqual([false, false, true]); expect(printedQrValues).toEqual([signedUrl, signedUrl, signedUrl]); expect(rawCompanies).toEqual(["VEE KAY AQUATECH PVT LTD"]); expect(rawRowCounts).toEqual([29]); expect(document.body.classList.contains("mvc-printing-raw")).toBe(false); print.mockRestore();
  });

  test("detail view keeps the printable card and digital content in separate desktop columns", async () => {
    const card = { ...cards[0], store_name: "Layout Store", qr_public_id: "layout-store-qr", entries: [] }; axios.get.mockResolvedValueOnce({ data: [card] }).mockResolvedValueOnce({ data: card }); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findAllByText("Layout Store"); const layout = screen.getByTestId("monthly-card-detail-layout"); const left = within(layout).getByTestId("monthly-card-left-column"); const right = within(layout).getByTestId("monthly-card-right-column"); const printable = within(left).getByLabelText("Printable monthly virtual delivery card"); const digital = within(right).getByText("Detailed Digital Entries").closest(".mvc-digital-entries"); expect(printable.classList.contains("mvc-print-card")).toBe(true); expect(printable.contains(digital)).toBe(false); expect(within(right).getByText("About Raw Card")).toBeTruthy(); expect(within(right).getByText("Verified by QR Scan")).toBeTruthy(); ["Print Card", "Print / Save PDF", "Add Entry"].forEach((name) => expect(screen.getByRole("button", { name })).toBeTruthy()); expect(screen.getAllByRole("button", { name: "Download Raw Card" })).toHaveLength(2);
  });

  test("print footer aligns the official stamp, generated time and sustainability message", async () => {
    const card = { ...cards[0], store_name: "Footer Store", qr_public_id: "footer-store-qr", entries: [] }; axios.get.mockResolvedValueOnce({ data: [card] }).mockResolvedValueOnce({ data: card }); render(<MonthlyVirtualCards />); await screen.findByText("#1"); fireEvent.click(screen.getByText("View Card")); await screen.findAllByText("Footer Store"); const bottom = document.querySelector(".mvc-print-bottom"); expect(within(bottom).getByAltText("Veekay official stamp")).toBeTruthy(); expect(within(bottom).getByText(/Generated On:/)).toBeTruthy(); expect(within(bottom).getByText("Thank you for helping us build a sustainable future.")).toBeTruthy();
  });

  test("detail CSS defines desktop columns and a mobile single-column breakpoint", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/pages/MonthlyVirtualCards.css"), "utf8"); expect(css).toMatch(/\.mvc-detail-layout\{[^}]*display:grid[^}]*grid-template-columns:/); expect(css).toMatch(/@media\(max-width:1050px\)[\s\S]*?\.mvc-detail-layout\{grid-template-columns:minmax\(0,1fr\)\}/); expect(css).toMatch(/@media print\{[^}]*\.mvc-detail-toolbar[^}]*\.mvc-digital-column/); expect(css).toMatch(/\.mvc-official-stamp\{top:auto;right:auto;bottom:8px;left:8px;[^}]*opacity:\.76/); expect(css).toMatch(/body\.mvc-printing-raw \.mvc-print-grid :is\(th,td\):first-child\{display:table-cell!important/); expect(css).toMatch(/body\.mvc-printing-raw \.mvc-print-grid tbody td\{color:transparent!important;text-shadow:none!important\}/); expect(css).not.toMatch(/body\.mvc-printing-raw \.mvc-print-grid tbody td:first-child\{color:#172d36!important/);
  });

  test("QR CSS prevents shrinking and preserves printable physical size", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/pages/MonthlyVirtualCards.css"), "utf8");
    expect(css).toMatch(/\.mvc-print-qr\{[^}]*min-width:180px;flex:0 0 180px/);
    expect(css).toMatch(/\.mvc-qr-surface\{[^}]*width:180px;height:180px[^}]*padding:10px[^}]*background:#fff/);
    expect(css).toMatch(/\.mvc-qr-surface svg\{[^}]*width:160px;height:160px[^}]*flex-shrink:0[^}]*transform:none/);
    expect(css).toMatch(/@media\(max-width:700px\)[\s\S]*?\.mvc-print-qr\{min-width:180px;flex-basis:180px/);
    expect(css).toMatch(/@media print\{\.mvc-print-qr\{[^}]*min-width:42mm!important[\s\S]*?\.mvc-qr-surface svg\{width:38mm!important;height:38mm!important/);
  });
});
