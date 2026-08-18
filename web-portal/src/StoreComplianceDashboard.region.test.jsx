import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import StoreComplianceDashboard from "./StoreComplianceDashboard";

jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }), { virtual: true });
jest.mock("./config", () => ({ API_BASE_URL: "https://api.example.test" }));
jest.mock("./hooks/usePermissions", () => ({ __esModule: true, default: () => ({ loading: false, hasPermission: () => true }) }));
jest.mock("react-pdf", () => ({
  Document: ({ children }) => <div>{children}</div>,
  Page: () => <div />,
  pdfjs: { version: "test", GlobalWorkerOptions: {} }
}));

const master = [
  { region: " North ", city: "Gurugram" },
  { Region: "north", City: " Noida " },
  { region: "South", city: "Chennai" },
  { region: " south ", city: "Madurai" },
  { region: null, city: "Unknown" },
  { region: "   ", city: "Blank" }
];
const row = (id, name, city, manager = "Manager A", compliance = 20) => ({
  store_id: id,
  store_name: name,
  city,
  channel: "BLINKIT",
  delivery_manager: manager,
  compliance_percentage: compliance,
  week1_documents: [], week2_documents: [], week3_documents: [], week4_documents: [], invoice_documents: []
});
const allRows = [row(1, "North Store", "Gurugram"), row(2, "South Store", "Chennai", "Manager B", 100)];
const repositoryCalls = () => axios.get.mock.calls.filter(([url]) => url.endsWith("/store-compliance/repository"));

describe("Store Compliance Region filter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.setItem("auth_token", "token");
    axios.get.mockImplementation((url, options = {}) => {
      if (url.endsWith("/store/store/list/all")) return Promise.resolve({ data: { stores: master } });
      if (url.endsWith("/store-compliance/filters")) return Promise.resolve({ data: { cities: ["Legacy City"], channels: ["BLINKIT", "ZEPTO"], delivery_managers: ["Manager A", "Manager B"] } });
      if (url.endsWith("/store-compliance/repository")) return Promise.resolve({ data: options.params?.region === "North" ? [allRows[0]] : allRows });
      return Promise.resolve({ data: {} });
    });
  });

  test("derives canonical Region options once and restricts City while composing requests", async () => {
    render(<StoreComplianceDashboard />);
    await screen.findByText("North Store");
    const region = screen.getByLabelText("Region");
    await waitFor(() => expect(within(region).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Regions", "North", "South"]));
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/store/store/list/all"))).toHaveLength(1);
    expect(repositoryCalls()[0][1].params.region).toBeUndefined();

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Gurugram" } });
    fireEvent.change(region, { target: { value: "North" } });
    expect(screen.getByLabelText("City").value).toBe("");
    expect(within(screen.getByLabelText("City")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Cities", "Gurugram", "Noida"]);
    await waitFor(() => expect(repositoryCalls().at(-1)[1].params).toEqual(expect.objectContaining({ region: "North" })));
    expect(repositoryCalls().at(-1)[1].params.city).toBeUndefined();

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Noida" } });
    await waitFor(() => expect(repositoryCalls().at(-1)[1].params).toEqual(expect.objectContaining({ region: "North", city: "Noida" })));
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "BLINKIT" } });
    await waitFor(() => expect(repositoryCalls().at(-1)[1].params).toEqual(expect.objectContaining({ region: "North", city: "Noida", channel: "BLINKIT" })));

    fireEvent.change(screen.getByLabelText("Delivery Manager"), { target: { value: "Manager A" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "partial" } });
    expect(region.value).toBe("North");
    expect(screen.getByLabelText("Delivery Manager").value).toBe("Manager A");
    expect(screen.getByLabelText("Status").value).toBe("partial");
  });

  test("uses backend Region population for KPIs and Reset restores Region and City defaults", async () => {
    render(<StoreComplianceDashboard />);
    await screen.findByText("South Store");
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "North" } });
    await waitFor(() => expect(screen.getByText("Total Stores").parentElement.querySelector("h3").textContent).toBe("1"));
    expect(screen.queryByText("South Store")).toBeNull();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Gurugram" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Region").value).toBe("");
    expect(screen.getByLabelText("City").value).toBe("");
    await waitFor(() => expect(repositoryCalls().at(-1)[1].params.region).toBeUndefined());
    expect(screen.getByRole("button", { name: /Generate PO PDF/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bulk Upload/ })).toBeTruthy();
  });

  test("Store master failure leaves repository and fallback City options usable", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/store/store/list/all")) return Promise.reject(new Error("master unavailable"));
      if (url.endsWith("/store-compliance/filters")) return Promise.resolve({ data: { cities: ["Fallback City"], channels: [], delivery_managers: [] } });
      if (url.endsWith("/store-compliance/repository")) return Promise.resolve({ data: allRows });
      return Promise.resolve({ data: {} });
    });
    render(<StoreComplianceDashboard />);
    await screen.findByText("North Store");
    expect(within(screen.getByLabelText("Region")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Regions"]);
    expect(within(screen.getByLabelText("City")).getByRole("option", { name: "Fallback City" })).toBeTruthy();
  });
});
