import { useEffect, useSyncExternalStore } from "react";
import axios from "axios";
import { API_BASE_URL } from "../config";

const SIDEBAR_URL = `${API_BASE_URL}/employees/me/sidebar`;

const getToken = () =>
  localStorage.getItem("auth_token") ||
  localStorage.getItem("userToken") ||
  localStorage.getItem("partner_token");

const unwrapItems = (payload) =>
  Array.isArray(payload)
    ? payload
    : payload?.items || payload?.menu || payload?.sidebar || payload?.data || [];

const normalizeItems = (payload) =>
  unwrapItems(payload)
    .filter((item) => item && typeof item === "object")
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0));

const groupItems = (items) => {
  const groups = new Map();
  items.forEach((item) => {
    const group = item.group || "";
    const entries = groups.get(group) || [];
    entries.push(item);
    groups.set(group, entries);
  });
  return [...groups.entries()].map(([group, entries]) => ({ group, items: entries }));
};

let snapshot = { token: null, items: [], groups: [], loading: false, loaded: false, error: null };
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

const loadSidebar = ({ force = false } = {}) => {
  const token = getToken();
  if (!token) {
    emit({ token: null, items: [], groups: [], loading: false, loaded: true, error: null });
    return Promise.resolve([]);
  }

  if (snapshot.token !== token) {
    requestPromise = null;
    emit({ token, items: [], groups: [], loading: false, loaded: false, error: null });
  }

  if (!force && snapshot.loaded) return Promise.resolve(snapshot.items);
  if (!force && requestPromise) return requestPromise;

  emit({ loading: true, error: null });
  requestPromise = axios
    .get(SIDEBAR_URL, { headers: { Authorization: `Bearer ${token}` } })
    .then((response) => {
      const items = normalizeItems(response.data);
      emit({ items, groups: groupItems(items), loaded: true, error: null });
      return items;
    })
    .catch((error) => {
      emit({ items: [], groups: [], loaded: true, error });
      return [];
    })
    .finally(() => {
      requestPromise = null;
      emit({ loading: false });
    });
  return requestPromise;
};

export const refreshSidebar = () => loadSidebar({ force: true });

export const clearSidebarCache = () => {
  requestPromise = null;
  emit({ token: null, items: [], groups: [], loading: false, loaded: false, error: null });
};

export default function useSidebar() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    loadSidebar();
  }, []);
  return {
    items: state.items,
    groups: state.groups,
    loading: state.loading || !state.loaded,
    error: state.error,
    refreshSidebar,
  };
}
