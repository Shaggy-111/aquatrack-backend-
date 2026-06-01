// src/config.js

const ENVIRONMENT = import.meta.env.MODE || "development";

// 🔥 Use env variable if available (BEST PRACTICE)
const PROD_API = import.meta.env.VITE_API_BASE_URL;

export const API_BASE_URL =
  ENVIRONMENT === "production"
    ? PROD_API || "https://aquatrack-prod-final.fly.dev"
    : "http://localhost:8000";

export const APP_ENV = ENVIRONMENT;

// 🔍 Debug
console.log(`🔧 Running in ${ENVIRONMENT} mode`);
console.log(`🌐 API Base URL: ${API_BASE_URL}`);