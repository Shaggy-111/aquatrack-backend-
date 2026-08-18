export const API_TIMEOUT_MS = 15000;

const validationMessage = (detail) => {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(validationMessage).filter(Boolean).join(" ");
  if (!detail || typeof detail !== "object") return "";
  return validationMessage(detail.detail ?? detail.message ?? detail.error ?? detail.errors ?? detail.reason);
};

export const getApiErrorMessage = (error, fallback = "Something went wrong. Please try again.") => {
  if (error?.code === "ECONNABORTED") return "The request timed out. Check your connection and try again.";
  if (!error?.response) return "Unable to reach the server. Check your connection and try again.";

  const status = error.response.status;
  const backendMessage = validationMessage(error.response.data);
  if (backendMessage) return backendMessage;

  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 404) return "The requested attendance information was not found.";
  if (status >= 500) return "The server is temporarily unavailable. Please try again.";
  return fallback;
};
