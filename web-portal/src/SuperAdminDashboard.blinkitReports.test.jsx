import fs from "fs";
import path from "path";

test("registers only the exact backend-driven blinkitReports dashboard tab", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/SuperAdminDashboard.jsx"), "utf8");
  expect(source).toMatch(/import BlinkitReports from ["']\.\/pages\/BlinkitReports["']/);
  expect(source).toMatch(/blinkitReports:\s*\(\)\s*=>\s*<BlinkitReports\s*\/>/);
  expect((source.match(/blinkitReports:\s*\(\)/g) || [])).toHaveLength(1);
  expect(source).not.toMatch(/sidebar[^\n]*Blinkit Report/i);
});
