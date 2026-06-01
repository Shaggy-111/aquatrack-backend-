// src/config.ts (or wherever you create it)

// --- Central API Configuration ---

// Toggle between these two lines for local testing vs. production build:

// FOR LOCAL TESTING (Use your computer's IP found via ipconfig)
export const API_BASE_URL = 'https://aquatrack-prod-final.fly.dev';

// FOR PRODUCTION (Comment out the local line and uncomment this one before building/deploying)
// export const API_BASE_URL = 'https://aquatrack-backend.fly.dev';

// You can add other global constants here too if needed
// export const SUPERADMIN_ID = 1;