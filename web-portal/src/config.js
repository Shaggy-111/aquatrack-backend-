const ENVIRONMENT = import.meta.env.MODE || "development";
const DEFAULT_API_BASE_URL = ENVIRONMENT === "production"
  ? "https://aquatrack-prod-final.fly.dev"
  : "http://localhost:8000";

export const API_BASE_URL = String(import.meta.env.VITE_API_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
export const VITE_BLINKIT_REPORT_PIN = import.meta.env.VITE_BLINKIT_REPORT_PIN || "";
export const APP_ENV = ENVIRONMENT;
