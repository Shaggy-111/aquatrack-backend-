import fs from "fs";
import path from "path";
import { isVisibleSidebarItem } from "./components/BackendSidebarItems";

jest.mock("./hooks/useSidebar", () => ({
  __esModule: true,
  default: () => ({ items: [], groups: [], loading: false, error: null }),
}));

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");

test("registers the exact backend-provided Blinkit Report tab without a static entry", () => {
  const source = read("src/ChannelAdminDashboard.jsx");
  expect(source).toMatch(/import BlinkitReports from ["']\.\/pages\/BlinkitReports["']/);
  expect(source).toMatch(/case ["']blinkitReports["']/);
  expect(source).toMatch(/hasPermission\(PERMISSIONS\.BLINKIT_REPORTS_VIEW\)/);
  expect(source).toMatch(/<BlinkitReports\s*\/>/);
  expect(source).toMatch(/<AccessDenied\s*\/>/);
  expect(source).not.toMatch(/<SidebarItem[^>]+Blinkit Report/i);
  expect(source).toMatch(/case ["']dashboard["']/);
});

test.each([
  "Dashboard",
  "Orders",
  "Unassigned Orders",
  "Stores",
  "Partner / POC",
  "Complaints",
  "Reports",
  "Blinkit Report",
])("allows a backend-returned established Channel Admin module: %s", (module) => {
  expect(isVisibleSidebarItem({ module }, "channel_admin")).toBe(true);
});

test("retains denylist behavior outside the scoped Channel Admin modules", () => {
  expect(isVisibleSidebarItem({ module: "Partner / POC" }, "superadmin")).toBe(false);
  expect(isVisibleSidebarItem({ module: "System Settings" }, "channel_admin")).toBe(false);
  expect(isVisibleSidebarItem({ module: "Audit Logs" }, "channel_admin")).toBe(false);
});

test("does not modify SuperAdminDashboard", () => {
  const source = read("src/SuperAdminDashboard.jsx");
  expect(source).toMatch(/blinkitReports:\s*\(\)\s*=>\s*<BlinkitReports\s*\/>/);
});
