import React from "react";

const AccessDenied = ({ message = "You do not have permission to view this page." }) => (
  <main style={styles.page} role="alert">
    <section style={styles.card}>
      <div style={styles.icon}>🔒</div>
      <h1 style={styles.title}>Access Denied</h1>
      <p style={styles.message}>{message}</p>
    </section>
  </main>
);

const styles = {
  page: {
    minHeight: "60vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "#f8fafc",
  },
  card: {
    width: "min(460px, 100%)",
    padding: 32,
    borderRadius: 12,
    background: "#fff",
    boxShadow: "0 4px 18px rgba(15, 23, 42, 0.08)",
    textAlign: "center",
  },
  icon: { fontSize: 34, marginBottom: 12 },
  title: { margin: 0, color: "#1e293b", fontSize: 26 },
  message: { margin: "10px 0 0", color: "#64748b", lineHeight: 1.5 },
};

export default AccessDenied;
