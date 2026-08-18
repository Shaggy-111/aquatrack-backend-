import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import axios from "axios";
import usePermissions, { clearPermissionsCache } from "./usePermissions";

jest.mock("axios", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock("../config", () => ({ API_BASE_URL: "https://api.example.test" }));

const BLINKIT_KEYS = [
  "blinkit_reports.view",
  "blinkit_reports.export",
  "blinkit_reports.vendor_rate_export",
];

function PermissionProbe({ keys = ["blinkit_reports.view"] }) {
  const { permissionsLoading, hasPermission } = usePermissions();
  if (permissionsLoading) return <div>loading</div>;
  return (
    <div>
      <span>ready</span>
      {keys.map((key) => (
        <output key={key} data-testid={key}>
          {String(hasPermission(key))}
        </output>
      ))}
    </div>
  );
}

async function renderPermissions(payload, keys) {
  axios.get.mockResolvedValueOnce({ data: payload });
  render(<PermissionProbe keys={keys} />);
  await screen.findByText("ready");
}

describe("usePermissions wildcard compatibility", () => {
  beforeEach(() => {
    cleanup();
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("auth_token", "test-token");
    clearPermissionsCache();
  });

  afterEach(() => cleanup());

  test.each(["*", "*.*"])("%s grants arbitrary permissions", async (wildcard) => {
    await renderPermissions([wildcard], ["anything.read"]);
    expect(screen.getByTestId("anything.read").textContent).toBe("true");
  });

  test("exact permission works without granting unrelated access", async () => {
    await renderPermissions(["blinkit_reports.view"], [
      "blinkit_reports.view",
      "blinkit_reports.export",
    ]);
    expect(screen.getByTestId("blinkit_reports.view").textContent).toBe("true");
    expect(screen.getByTestId("blinkit_reports.export").textContent).toBe("false");
  });

  test.each([[], null, undefined])("empty or absent permission data denies safely", async (payload) => {
    await renderPermissions(payload, ["blinkit_reports.view"]);
    expect(screen.getByTestId("blinkit_reports.view").textContent).toBe("false");
  });

  test("*.* grants Blinkit view, export, and Vendor Rate actions", async () => {
    await renderPermissions(["*.*"], BLINKIT_KEYS);
    BLINKIT_KEYS.forEach((key) => {
      expect(screen.getByTestId(key).textContent).toBe("true");
    });
  });

  test("permission loading and request conventions remain unchanged", async () => {
    await renderPermissions({ permissions: ["*"] }, ["monthly_virtual_cards.view"]);
    expect(screen.getByTestId("monthly_virtual_cards.view").textContent).toBe("true");
    expect(axios.get).toHaveBeenCalledWith(
      "https://api.example.test/employees/me/permissions",
      { headers: { Authorization: "Bearer test-token" } }
    );
  });
});
