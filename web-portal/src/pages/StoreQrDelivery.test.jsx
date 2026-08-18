import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import fs from "fs";
import path from "path";
import StoreQrDelivery from "./StoreQrDelivery";

let mockRouteToken = "signed/value";
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }), { virtual: true });
jest.mock("../config", () => ({ API_BASE_URL: "https://api.example.test" }));
jest.mock("react-router-dom", () => ({ useParams: () => ({ token: mockRouteToken }) }), { virtual: true });

const scan = {
  store: { store_name: "Marina Store", city: "Chennai", channel: "Retail", store_id: 99 },
  eligible_order_exists: true,
  expected_quantity: 12,
  submission_token: "short-lived-token",
  idempotency_key: "server-key",
  expires_in_seconds: 300,
  business_date: "2026-08-05",
};

describe("StoreQrDelivery", () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockRouteToken = "signed/value";
    axios.get.mockResolvedValue({ data: scan });
    axios.post.mockResolvedValue({ data: { submission_id: 7, order_id: 8, status: "recorded" } });
    URL.createObjectURL = jest.fn(() => "blob:preview");
    URL.revokeObjectURL = jest.fn();
  });

  test("scans the route token publicly and renders confirmed scan fields", async () => {
    render(<StoreQrDelivery />);
    expect(screen.getByText("Opening delivery form")).toBeTruthy();
    await screen.findByText("Marina Store");
    expect(axios.get).toHaveBeenCalledWith("https://api.example.test/store-qr/scan/signed%2Fvalue", expect.objectContaining({ signal: expect.anything() }));
    expect(screen.getByText("2026-08-05")).toBeTruthy();
    expect(screen.getByLabelText("Bottles Delivered *").value).toBe("12");
    expect(screen.getByLabelText("Empty Bottles Collected *").value).toBe("0");
  });

  test("is registered as a public signed-token route before dashboard routes", () => {
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    expect(app).toMatch(/<Route path="\/qr\/:token" element=\{<StoreQrDelivery \/>\} \/>/);
    expect(app.indexOf('path="/qr/:token"')).toBeLessThan(app.indexOf('path="/dashboard/superadmin"'));
    expect(app).not.toMatch(/\/qr\/.*(?:store_id|qr_public_id)/);
  });

  test("blocks invalid quantities and focuses the first invalid field", async () => {
    render(<StoreQrDelivery />); await screen.findByText("Marina Store");
    const delivered = screen.getByLabelText("Bottles Delivered *");
    fireEvent.change(delivered, { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Empty Bottles Collected *"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Delivery" }));
    expect(screen.getAllByText("Enter a non-negative whole number.")).toHaveLength(2);
    expect(document.activeElement).toBe(delivered);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("submits only the allowed multipart fields and locks duplicate taps", async () => {
    let release;
    axios.post.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    render(<StoreQrDelivery />); await screen.findByText("Marina Store");
    fireEvent.change(screen.getByLabelText("Delivered By"), { target: { value: "Ravi" } });
    fireEvent.change(screen.getByLabelText("Remarks"), { target: { value: "Received" } });
    const button = screen.getByRole("button", { name: "Submit Delivery" });
    fireEvent.click(button); fireEvent.click(button);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const body = axios.post.mock.calls[0][1];
    expect(body.get("submission_token")).toBe("short-lived-token");
    expect(body.get("idempotency_key")).toBe("server-key");
    expect(body.get("bottles_delivered")).toBe("12");
    expect(body.get("empty_bottles_collected")).toBe("0");
    expect(body.get("delivered_by")).toBe("Ravi");
    expect(body.get("remarks")).toBe("Received");
    ["store_id", "qr_public_id", "order_id", "business_date", "token_version"].forEach((key) => expect(body.has(key)).toBe(false));
    expect(screen.getByRole("button", { name: "Submitting delivery…" }).disabled).toBe(true);
    await act(async () => release({ data: { submission_id: 7 } }));
    expect(await screen.findByText("Delivery submitted successfully")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit Delivery" })).toBeNull();
  });

  test("validates, previews, replaces, removes and revokes photos", async () => {
    const { unmount } = render(<StoreQrDelivery />); await screen.findByText("Marina Store");
    const input = screen.getByLabelText("Delivery Photo");
    fireEvent.change(input, { target: { files: [new File(["x"], "bad.gif", { type: "image/gif" })] } });
    expect(screen.getByText("Choose a JPEG, PNG, or WebP image.")).toBeTruthy();
    const first = new File(["one"], "first.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [first] } });
    expect(await screen.findByAltText("Selected delivery preview")).toBeTruthy();
    const second = new File(["two"], "second.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [second] } });
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview"));
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.queryByAltText("Selected delivery preview")).toBeNull();
    unmount();
  });

  test.each([
    [403, "expired_token", "Link expired"],
    [403, "qr_rotated", "QR unavailable"],
    [409, "store_inactive", "Store inactive"],
    [404, "not_found", "Invalid QR"],
  ])("shows safe scan state for %s/%s", async (status, code, title) => {
    axios.get.mockRejectedValue({ response: { status, data: { code, detail: "internal database secret" } } });
    render(<StoreQrDelivery />);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByText(/internal database secret/i)).toBeNull();
  });

  test.each([
    [409, "Delivery cannot be submitted"],
    [413, "Photo too large"],
    [415, "Unsupported photo"],
    [422, "Check the form"],
  ])("maps submit status %s safely and permits retry", async (status, title) => {
    axios.post.mockRejectedValueOnce({ response: { status, data: { detail: "stack trace secret" } } }).mockResolvedValueOnce({ data: { submission_id: 9 } });
    render(<StoreQrDelivery />); await screen.findByText("Marina Store");
    fireEvent.click(screen.getByRole("button", { name: "Submit Delivery" }));
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByText(/stack trace secret/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submit Delivery" }));
    expect(await screen.findByText("Delivery submitted successfully")).toBeTruthy();
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test("treats an idempotent replay as successful", async () => {
    axios.post.mockRejectedValue({ response: { status: 409, data: { idempotent_replay: true, submission: { submission_id: 11, status: "recorded" } } } });
    render(<StoreQrDelivery />); await screen.findByText("Marina Store");
    fireEvent.click(screen.getByRole("button", { name: "Submit Delivery" }));
    expect(await screen.findByText("Delivery submitted successfully")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy();
  });
});
