import React, { useEffect } from "react";
import useSidebar from "../hooks/useSidebar";

const MATERIAL_ICON_PATHS = {
  dashboard: "M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z",
  home: "m12 3-9 8h3v10h5v-6h2v6h5V11h3l-9-8Z",
  shopping_cart: "M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2ZM1 2v2h2l3.6 7.59-1.35 2.45A2 2 0 0 0 7 17h12v-2H7.42a.25.25 0 0 1-.22-.37L8.1 13h7.45a2 2 0 0 0 1.75-1.03L20.88 5H5.21l-.94-2H1Zm16 16c-1.1 0-1.99.9-1.99 2S15.9 22 17 22s2-.9 2-2-.9-2-2-2Z",
  qr_code: "M3 11h8V3H3v8Zm2-6h4v4H5V5Zm8-2v8h8V3h-8Zm6 6h-4V5h4v4ZM3 21h8v-8H3v8Zm2-6h4v4H5v-4Zm10-2h-2v4h4v-2h-2v-2Zm-2 8h2v-2h-2v2Zm4 0h4v-4h-2v2h-2v2Zm2-8v2h2v-2h-2Z",
  store: "M4 4v2l-1 5v2h1v7h7v-6h2v6h7v-7h1v-2l-1-5V4H4Zm2 2h12l.6 3H5.4L6 6Zm0 7h3v5H6v-5Zm9 0h3v5h-3v-5Z",
  storefront: "M4 4h16l1 5v2a3 3 0 0 1-1 2.24V21H4v-7.76A3 3 0 0 1 3 11V9l1-5Zm2 11v4h12v-4a3.1 3.1 0 0 1-3-1.34A3.1 3.1 0 0 1 12 15a3.1 3.1 0 0 1-3-1.34A3.1 3.1 0 0 1 6 15Z",
  local_shipping: "M3 6h11v9h2.5l-2-3H16V8h3l3 4v5h-2a3 3 0 0 1-6 0H9a3 3 0 0 1-6 0H1v-2h2V6Zm3 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm11 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  delivery_dining: "M19 7h-3V5h3v2Zm-8-4H5v2h6V3Zm10 8.5c0 .8-.7 1.5-1.5 1.5S18 12.3 18 11.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5ZM5 7h8v5h3.1a3.5 3.5 0 1 1-.6 2H9.8a3.5 3.5 0 1 1-1.2-1.5H11V9H5V7Z",
  people: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3ZM8 11c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z",
  groups: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Zm-7-1c1.66 0 3-1.34 3-3S6.66 5 5 5 2 6.34 2 8s1.34 3 3 3Zm14 0c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3ZM5 13c-2.33 0-5 1.17-5 3.5V19h6v-2.5c0-.83.29-1.56.78-2.18A7.4 7.4 0 0 0 5 13Zm14 0c-.62 0-1.23.11-1.78.32.49.62.78 1.35.78 2.18V19h6v-2.5c0-2.33-2.67-3.5-5-3.5Zm-7 0c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4Z",
  person: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z",
  badge: "M17 5h-3.18A3 3 0 0 0 11 3H9a3 3 0 0 0-2.82 2H3v16h18V5h-4Zm-7 0h1a1 1 0 0 1 1 1H9a1 1 0 0 1 1-1Zm0 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm5 8H5v-1c0-1.66 3.33-2.5 5-2.5s5 .84 5 2.5v1Zm3-5h-3v-2h3v2Z",
  assessment: "M3 3v18h18v-2H5V3H3Zm4 14h3V9H7v8Zm5 0h3V5h-3v12Zm5 0h3v-6h-3v6Z",
  analytics: "M3 3v18h18v-2H5V3H3Zm4 14 4-5 3 3 5-7 1.6 1.2-6.4 9-3-3L8.6 18 7 17Z",
  description: "M6 2h9l5 5v15H6V2Zm8 1.5V8h4.5L14 3.5ZM9 12v2h8v-2H9Zm0 4v2h8v-2H9Z",
  assignment: "M9 2h6a2 2 0 0 1 2 2h3v18H4V4h3a2 2 0 0 1 2-2Zm0 4h6V4H9v2Zm-2 5v2h10v-2H7Zm0 4v2h7v-2H7Z",
  fact_check: "M4 3h16v18H4V3Zm3 5 2 2 4-4-1.4-1.4L9 7.2 8.4 6.6 7 8Zm7 1v2h4V9h-4Zm-7 6 2 2 4-4-1.4-1.4L9 14.2l-.6-.6L7 15Zm7 0v2h4v-2h-4Z",
  inventory: "M3 5 5 2h14l2 3v2h-1v15H4V7H3V5Zm3 2v13h12V7H6Zm1-3-.7 1h11.4L17 4H7Zm2 6h6v2H9v-2Z",
  inventory_2: "M3 5 5 2h14l2 3v2h-1v15H4V7H3V5Zm3 2v13h12V7H6Zm1-3-.7 1h11.4L17 4H7Zm2 6h6v2H9v-2Z",
  location_on: "M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z",
  map: "m3 6 5-2 8 2 5-2v14l-5 2-8-2-5 2V6Zm6 .2v9.9l6 1.5V7.7L9 6.2Z",
  security: "m12 2 8 3v6c0 5.05-3.41 9.74-8 11-4.59-1.26-8-5.95-8-11V5l8-3Zm0 2.18L6 6.43V11c0 3.72 2.37 7.48 6 8.76 3.63-1.28 6-5.04 6-8.76V6.43l-6-2.25Z",
  admin_panel_settings: "M17 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3ZM7 12c2.21 0 4-1.79 4-4S9.21 4 7 4 3 5.79 3 8s1.79 4 4 4Zm10 1c-1.5 0-4.5.75-4.5 2.25V18l4.5 3 4.5-3v-2.75C21.5 13.75 18.5 13 17 13ZM7 14c-2.67 0-7 1.34-7 4v2h11v-4.75c0-.43.1-.83.28-1.19A16.5 16.5 0 0 0 7 14Z",
  settings: "M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.08-.98l2.11-1.65-2-3.46-2.49 1a7.2 7.2 0 0 0-1.69-.98L15 3.27h-4l-.4 2.66c-.61.25-1.17.59-1.69.98l-2.49-1-2 3.46 2.11 1.65c-.04.32-.08.66-.08.98s.03.66.08.98l-2.11 1.65 2 3.46 2.49-1c.52.4 1.08.73 1.69.98l.4 2.66h4l.4-2.66c.61-.25 1.17-.59 1.69-.98l2.49 1 2-3.46-2.15-1.65ZM13 15.5A3.5 3.5 0 1 1 13 8a3.5 3.5 0 0 1 0 7.5Z",
  history: "M13 3a9 9 0 1 1-8.49 6H2l3.5-3.5L9 9H6.56A7 7 0 1 0 13 5v4l5 3-1 1.73-6-3.73V3h2Z",
  calendar_month: "M7 2h2v2h6V2h2v2h3v18H4V4h3V2Zm11 8H6v10h12V10ZM6 6v2h12V6H6Z",
  upload_file: "M6 2h9l5 5v15H6V2Zm8 1.5V8h4.5L14 3.5ZM11 18h2v-4h3l-4-4-4 4h3v4Z",
  receipt_long: "M5 2 7 3l2-1 2 1 2-1 2 1 2-1 2 1v19l-2-1-2 1-2-1-2 1-2-1-2 1-2-1-2 1V2Zm3 5v2h8V7H8Zm0 4v2h8v-2H8Zm0 4v2h5v-2H8Z",
  warehouse: "m2 9 10-6 10 6v12h-4v-8H6v8H2V9Zm6 6v2h8v-2H8Zm0 4v2h8v-2H8Z",
  water_drop: "M12 2s7 7.58 7 13a7 7 0 1 1-14 0C5 9.58 12 2 12 2Zm-4 13a4 4 0 0 0 4 4v-2a2 2 0 0 1-2-2H8Z",
  apps: "M4 4h4v4H4V4Zm6 0h4v4h-4V4Zm6 0h4v4h-4V4ZM4 10h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4ZM4 16h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4Z",
};

const ICON_ALIASES = {
  report: "description",
  reports: "description",
  complaint: "assignment",
  complaints: "assignment",
  employees: "badge",
  employee: "badge",
  employee_management: "badge",
  manage_accounts: "badge",
  person_add: "person",
  assignment_ind: "badge",
  supervisor_account: "groups",
  users: "people",
  orders: "shopping_cart",
  stores: "store",
  add_business: "storefront",
  store_mall_directory: "storefront",
  business: "storefront",
  apartment: "warehouse",
  attendance: "fact_check",
  compliance: "fact_check",
  rule: "fact_check",
  checklist: "fact_check",
  truck: "local_shipping",
  delivery: "local_shipping",
  engineering: "badge",
  qr: "qr_code",
  download: "description",
  file_download: "description",
  cloud_download: "description",
  upload: "upload_file",
  cloud_upload: "upload_file",
  verified_user: "security",
  lock: "security",
};

const HIDDEN_SIDEBAR_MODULES = new Set([
  "customer orders",
  "customers",
  "commercial orders",
  "store analytics",
  "store auto order",
  "partner / poc",
  "delivery routes",
  "delivery",
  "collectable bottles",
  "warehouse bottles",
  "leave",
  "holiday",
  "vendor license",
  "store reports",
  "regions",
  "manual delivery upload",
  "uploads",
  "exports",
  "notifications",
  "audit logs",
  "rbac",
  "workflow approvals",
  "data retention",
  "admin operations",
  "google sheet sync",
  "blinkit sync",
  "zepto sync",
  "app version",
  "profile",
  "system settings",
  "delivery manager",
]);

const CHANNEL_ADMIN_ESTABLISHED_MODULES = new Set([
  "dashboard",
  "orders",
  "unassigned orders",
  "stores",
  "partner / poc",
  "complaints",
  "reports",
  "blinkit report",
]);

export const isVisibleSidebarItem = (item, role = "") => {
  const module = String(item?.module || "").trim().toLowerCase();
  const normalizedRole = String(role).trim().toLowerCase();
  if (normalizedRole === "channel_admin" && CHANNEL_ADMIN_ESTABLISHED_MODULES.has(module)) {
    return true;
  }
  return !HIDDEN_SIDEBAR_MODULES.has(module);
};

const SidebarMaterialIcon = ({ name }) => {
  const normalizedName = String(name || "apps").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const iconName = ICON_ALIASES[normalizedName] || normalizedName;
  const path = MATERIAL_ICON_PATHS[iconName] || MATERIAL_ICON_PATHS.apps;
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false" style={{ display: "block" }}>
      <path d={path} />
    </svg>
  );
};

export const sidebarItemTab = (item) => {
  if (item?.tab) return String(item.tab);
  const value = item?.key || item?.name || item?.route ||
    String(item?.permission || "").split(".")[0] || item?.module;
  return String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/[\s_.-]+(.)/g, (_, character) => character.toUpperCase());
};

export default function BackendSidebarItems({ currentTab, onSelectTab, renderItem, renderGroup }) {
  const { items, groups } = useSidebar();
  const currentUserRole = localStorage.getItem("user_role") || "";

  useEffect(() => {
    if (!items.length || items.some((item) => sidebarItemTab(item) === currentTab)) return;
    const firstTab = sidebarItemTab(items[0]);
    if (firstTab) onSelectTab(firstTab);
  }, [currentTab, items, onSelectTab]);

  return groups.map(({ group, items: groupItems }) => {
    const visibleItems = groupItems.filter((item) => isVisibleSidebarItem(item, currentUserRole));
    if (!visibleItems.length) return null;
    return (
    <React.Fragment key={group || "default"}>
      {group && (renderGroup ? renderGroup(group) : null)}
      {visibleItems.map((item, index) => {
        const name = sidebarItemTab(item);
        if (!name) return null;
        return renderItem({
          item,
          name,
          label: item.module,
          icon: <SidebarMaterialIcon name={item.icon} />,
          active: currentTab === name,
          key: item.id || item.permission || item.module || index,
        });
      })}
    </React.Fragment>
    );
  });
}
