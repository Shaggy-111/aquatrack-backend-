import fs from "fs";
import path from "path";

const source = fs.readFileSync(path.resolve(process.cwd(), "src/config.js"), "utf8");

test("production API bridge uses VITE_API_URL with the production backend fallback", () => {
  expect(source).toMatch(/import\.meta\.env\.VITE_API_URL/);
  expect(source).toContain("https://aquatrack-prod-final.fly.dev");
  expect(source).toMatch(/ENVIRONMENT\s*===\s*["']production["']/);
});

test("config bridge continues to expose VITE_BLINKIT_REPORT_PIN", () => {
  expect(source).toMatch(/export const VITE_BLINKIT_REPORT_PIN\s*=\s*import\.meta\.env\.VITE_BLINKIT_REPORT_PIN/);
});
