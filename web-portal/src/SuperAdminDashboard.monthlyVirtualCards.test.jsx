import fs from "fs";
import path from "path";

test("registers the exact monthlyVirtualCards dashboard tab", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/SuperAdminDashboard.jsx"), "utf8");
  expect(source).toMatch(/monthlyVirtualCards:\s*\(\)\s*=>\s*<MonthlyVirtualCards\s*\/>/);
});
