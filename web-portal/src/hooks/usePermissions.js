import { useCallback, useEffect, useSyncExternalStore } from "react";
import axios from "axios";
import { API_BASE_URL } from "../config";

const PERMISSIONS_URL = `${API_BASE_URL}/employees/me/permissions`;

const getToken = () =>
  localStorage.getItem("auth_token") ||
  localStorage.getItem("userToken") ||
  localStorage.getItem("partner_token");

const permissionName = (permission) => {
  if (typeof permission === "string") return permission;
  if (permission?.permission) return permissionName(permission.permission);
  if (permission?.key || permission?.code || permission?.name) {
    return permission.key || permission.code || permission.name;
  }
  if (permission?.module && permission?.action) {
    return `${permission.module}.${permission.action}`;
  }
  return null;
};

const normalizePermissions = (payload) => {
  const list = Array.isArray(payload)
    ? payload
    : payload?.permissions || payload?.items || payload?.data || [];

  return new Set(
    list
      .map(permissionName)
      .filter(Boolean)
      .map((permission) => String(permission).toLowerCase())
  );
};

let snapshot = {
  token: null,
  permissions: new Set(),
  loading: false,
  loaded: false,
  error: null,
};
let requestPromise = null;
const listeners = new Set();

const emit = (next) => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => snapshot;

const loadPermissions = ({ force = false } = {}) => {
  const token = getToken();

  if (!token) {
    requestPromise = null;
    emit({
      token: null,
      permissions: new Set(),
      loading: false,
      loaded: true,
      error: null,
    });
    return Promise.resolve(new Set());
  }

  if (snapshot.token !== token) {
    requestPromise = null;
    emit({
      token,
      permissions: new Set(),
      loading: false,
      loaded: false,
      error: null,
    });
  }

  if (!force && snapshot.loaded) {
    return Promise.resolve(snapshot.permissions);
  }

  if (!force && requestPromise) return requestPromise;

  emit({ loading: true, error: null });
  requestPromise = axios
    .get(PERMISSIONS_URL, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((response) => {
      const permissions = normalizePermissions(response.data);
      emit({ permissions, loaded: true, error: null });
      return permissions;
    })
    .catch((error) => {
      emit({ permissions: new Set(), loaded: true, error });
      return new Set();
    })
    .finally(() => {
      requestPromise = null;
      emit({ loading: false });
    });

  return requestPromise;
};

export const refreshPermissions = () => loadPermissions({ force: true });

export const clearPermissionsCache = () => {
  requestPromise = null;
  emit({
    token: null,
    permissions: new Set(),
    loading: false,
    loaded: false,
    error: null,
  });
};

export default function usePermissions() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    loadPermissions();
  }, []);

  const hasPermission = useCallback(
    (permissionKey) => {
      if (!permissionKey) return false;
      const key = String(permissionKey).toLowerCase();
      return (
        state.permissions.has("*") ||
        state.permissions.has("*.*") ||
        state.permissions.has(key)
      );
    },
    [state.permissions]
  );

  const hasAnyPermission = useCallback(
    (...keys) => keys.flat().some((key) => hasPermission(key)),
    [hasPermission]
  );

  const hasAllPermissions = useCallback(
    (...keys) => keys.flat().every((key) => hasPermission(key)),
    [hasPermission]
  );

  return {
    loading: state.loading || !state.loaded,
    permissionsLoading: state.loading || !state.loaded,
    permissions: state.permissions,
    error: state.error,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    refreshPermissions,
  };
}
