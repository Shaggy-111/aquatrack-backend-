import { useEffect, useSyncExternalStore } from "react";
import axios from "axios";
import { API_BASE_URL } from "../config";

const CATALOG_URL = `${API_BASE_URL}/permissions/catalog`;

const getToken = () =>
  localStorage.getItem("auth_token") ||
  localStorage.getItem("userToken") ||
  localStorage.getItem("partner_token");

const unwrapCatalog = (payload) =>
  Array.isArray(payload)
    ? payload
    : payload?.permissions || payload?.items || payload?.catalog || payload?.data || [];

const normalizePermission = (permission) => {
  const id = Number(permission?.id ?? permission?.permission_id);
  const key = permission?.key || permission?.code || permission?.name || permission?.permission || "";
  const [keyModule, ...keyAction] = String(key).split(".");
  const module = permission?.module || keyModule;
  const action = permission?.action || keyAction.join(".");
  if (!Number.isInteger(id) || !module || !action) return null;
  return { ...permission, id, key: String(key), module: String(module), action: String(action) };
};

const groupCatalog = (catalog) => {
  const groups = new Map();
  catalog.forEach((permission) => {
    const entries = groups.get(permission.module) || [];
    entries.push(permission);
    groups.set(permission.module, entries);
  });
  return [...groups.entries()].map(([module, permissions]) => ({ module, permissions }));
};

let snapshot = { token: null, catalog: [], groups: [], loading: false, loaded: false, error: null };
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

const loadCatalog = ({ force = false } = {}) => {
  const token = getToken();
  if (!token) {
    emit({ token: null, catalog: [], groups: [], loading: false, loaded: true, error: null });
    return Promise.resolve([]);
  }
  if (snapshot.token !== token) {
    requestPromise = null;
    emit({ token, catalog: [], groups: [], loading: false, loaded: false, error: null });
  }
  if (!force && snapshot.loaded) return Promise.resolve(snapshot.catalog);
  if (!force && requestPromise) return requestPromise;

  emit({ loading: true, error: null });
  requestPromise = axios
    .get(CATALOG_URL, { headers: { Authorization: `Bearer ${token}` } })
    .then((response) => {
      const catalog = unwrapCatalog(response.data).map(normalizePermission).filter(Boolean);
      emit({ catalog, groups: groupCatalog(catalog), loaded: true, error: null });
      return catalog;
    })
    .catch((error) => {
      emit({ catalog: [], groups: [], loaded: true, error });
      return [];
    })
    .finally(() => {
      requestPromise = null;
      emit({ loading: false });
    });
  return requestPromise;
};

export const refreshPermissionCatalog = () => loadCatalog({ force: true });
export const clearPermissionCatalogCache = () => {
  requestPromise = null;
  emit({ token: null, catalog: [], groups: [], loading: false, loaded: false, error: null });
};

export default function usePermissionCatalog() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    loadCatalog();
  }, []);
  return {
    catalog: state.catalog,
    groups: state.groups,
    loading: state.loading || !state.loaded,
    error: state.error,
    refreshPermissionCatalog,
  };
}
