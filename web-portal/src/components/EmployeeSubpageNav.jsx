import React from "react";
import { Link } from "react-router-dom";

const DASHBOARD_BY_ROLE = {
  superadmin: "/dashboard/superadmin",
  channeladmin: "/dashboard/channel-admin",
  partner: "/dashboard/partner",
  deliverymanager: "/dashboard/delivery-manager",
  employee: "/dashboard/employee",
};

const getDashboardPath = () => {
  const role = String(localStorage.getItem("user_role") || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  return DASHBOARD_BY_ROLE[role] || "/employees";
};

export default function EmployeeSubpageNav() {
  const isEmployee = String(localStorage.getItem("user_role") || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "") === "employee";
  return (
    <nav style={styles.nav} aria-label="Employee page navigation">
      {isEmployee ? <span style={styles.portalLabel}>Employee Portal</span> : <Link to="/employees" style={styles.link}>← Employee Management</Link>}
      <Link to={getDashboardPath()} style={styles.dashboardLink}>Dashboard</Link>
    </nav>
  );
}

const styles = {
  nav: { position: "sticky", top: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", margin: "-12px 0 20px", padding: "11px 14px", background: "rgba(255,255,255,.97)", border: "1px solid #e2e8f0", borderRadius: "9px", boxShadow: "0 2px 8px rgba(15,23,42,.08)" },
  link: { color: "#1565C0", textDecoration: "none", fontWeight: 700, fontSize: "14px" },
  dashboardLink: { color: "#102a43", textDecoration: "none", fontWeight: 700, fontSize: "14px" },
  portalLabel: { color: "#16a085", fontWeight: 800, fontSize: "14px" },
};
