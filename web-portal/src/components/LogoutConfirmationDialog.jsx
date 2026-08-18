import React, { useEffect } from "react";

const LogoutConfirmationDialog = ({ open, onCancel, onConfirm }) => {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div style={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title" aria-describedby="logout-dialog-message">
        <div style={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="m16 17 5-5-5-5M21 12H9" />
          </svg>
        </div>
        <h2 id="logout-dialog-title" style={styles.title}>Logout</h2>
        <p id="logout-dialog-message" style={styles.message}>Are you sure you want to logout?</p>
        <div style={styles.actions}>
          <button type="button" style={styles.cancelButton} onClick={onCancel}>Cancel</button>
          <button type="button" style={styles.logoutButton} onClick={onConfirm} autoFocus>Logout</button>
        </div>
      </section>
    </div>
  );
};

const styles = {
  backdrop: { position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", background: "rgba(15, 23, 42, 0.55)", backdropFilter: "blur(3px)" },
  dialog: { boxSizing: "border-box", width: "100%", maxWidth: "410px", padding: "28px", borderRadius: "16px", background: "#fff", boxShadow: "0 24px 60px rgba(15, 23, 42, 0.28)", textAlign: "center" },
  icon: { width: "48px", height: "48px", margin: "0 auto 16px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626", background: "#fee2e2" },
  title: { margin: "0 0 8px", color: "#102a43", fontSize: "22px" },
  message: { margin: "0", color: "#64748b", fontSize: "15px", lineHeight: 1.5 },
  actions: { display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "26px" },
  cancelButton: { flex: 1, padding: "11px 18px", border: "1px solid #d8dee8", borderRadius: "8px", background: "#fff", color: "#334155", fontSize: "14px", fontWeight: 700, cursor: "pointer" },
  logoutButton: { flex: 1, padding: "11px 18px", border: "none", borderRadius: "8px", background: "#dc2626", color: "#fff", fontSize: "14px", fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 10px rgba(220, 38, 38, 0.24)" },
};

export default LogoutConfirmationDialog;
