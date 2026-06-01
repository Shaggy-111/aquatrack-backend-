import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { API_BASE_URL } from "../config";


/* ---------------- KPI CARD ---------------- */
const KpiCard = ({ label, value, bg, color, icon }) => (
  <div style={{
    padding: 20,
    borderRadius: 12,
    background: bg,
    color,
    minWidth: 220,
    position: "relative",
    boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
    flex: "1 1 240px",
    border: `1px solid ${color}20`
  }}>
    <div style={{ fontSize: 13, fontWeight: "600", opacity: 0.8, textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: 32, fontWeight: "800", marginTop: 8 }}>{value}</div>
    <div style={{ position: "absolute", top: 15, right: 20, fontSize: 28, opacity: 0.6 }}>{icon}</div>
  </div>
);

const Reports = () => {
  const token = localStorage.getItem("auth_token") || localStorage.getItem("partner_token") || localStorage.getItem("userToken");
  const userRole = localStorage.getItem("user_role") || "";
  const userChannel = localStorage.getItem("channel_name") || localStorage.getItem("channel") || "";
  
  const isSuperadmin = userRole?.toLowerCase() === "superadmin";

  const [rows, setRows] = useState([]);
  const [dynamicDates, setDynamicDates] = useState([]);
  const [totalBottlesKPI, setTotalBottlesKPI] = useState(0);
  const [loading, setLoading] = useState(false);
  
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [channel, setChannel] = useState(isSuperadmin ? "" : userChannel.toUpperCase());
  // Manual Delivery Upload States
  const [manualFile, setManualFile] = useState(null);
  const [uploadingManual, setUploadingManual] = useState(false);

  // Handle Channel lock for non-superadmins
  useEffect(() => {
    if (!isSuperadmin && userChannel) {
      setChannel(userChannel.toUpperCase());
    }
  }, [isSuperadmin, userChannel]);


  const handleManualDeliveryUpload = async () => {
    // Step 1: Check if file is selected
    if (!manualFile) {
      alert("Please select an Excel file.");
      return;
    }

    // Step 2: Confirmation popup
    const confirmed = window.confirm(
      "Are you sure you want to upload this Excel?\n\n" +
      "This action will automatically mark orders as delivered and may create missing orders."
    );

    if (!confirmed) {
      return;
    }

    // Step 3: 4-digit security PIN
    const pin = window.prompt("Enter 4-digit security PIN to continue:");

    if (pin !== "5518") {
      alert("❌ Invalid security PIN. Upload cancelled.");
      return;
    }

    // Step 4: Upload file
    try {
      setUploadingManual(true);

      const formData = new FormData();
      formData.append("file", manualFile);

      const res = await axios.post(
        `${API_BASE_URL}/reports/reports/upload-manual-delivery`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data",
          },
        }
      );

      const data = res.data;

      // Step 5: Success message
      alert(
        `✅ Upload Successful!\n\n` +
        `Stores Processed: ${data.stores_processed}\n` +
        `Orders Updated: ${data.orders_updated}\n` +
        `Orders Created: ${data.orders_created}\n` +
        `Skipped: ${data.skipped}`
      );

      // Step 6: Reset selected file
      setManualFile(null);

      // Optional: Clear file input visually
      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput) {
        fileInput.value = "";
      }

      // Step 7: Refresh reports
      fetchOrderReports();

    } catch (err) {
      console.error("Upload failed:", err);

      alert(
        err?.response?.data?.detail ||
        "Manual delivery upload failed."
      );
    } finally {
      setUploadingManual(false);
    }
  };
  // ✅ IMPROVED FETCH: Logic to show ALL data if no filters are applied
  const fetchOrderReports = async () => {
    setLoading(true);
    try {
      const params = {
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        channel: channel || undefined,
        state: state || undefined,
        city: city || undefined,
      };

      const res = await axios.get(`${API_BASE_URL}/delivery-reports/orders`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      const apiRows = res.data?.rows || [];
      const apiDates = res.data?.dates || [];

      setRows(apiRows);
      setDynamicDates(apiDates);
      setTotalBottlesKPI(apiRows.reduce((sum, r) => sum + (r["Total Count"] || 0), 0));

    } catch (err) {
      console.error("❌ Fetch error:", err);
      setRows([]);
      setDynamicDates([]);
    } finally {
      setLoading(false);
    }
  };

  // ✅ AUTO-FETCH ALL DATA ON LOAD
  useEffect(() => {
    fetchOrderReports();
  }, [channel]);

  // ✅ DYNAMIC STATE DROPDOWN
  const dbStates = useMemo(() => {
    return [...new Set(rows.map(r => r["STATE"] || r["state"]))].filter(Boolean).sort();
  }, [rows]);

  // ✅ DYNAMIC CITY DROPDOWN (Filters cities based on selected state)
  const dbCities = useMemo(() => {
    if (!state) return [];
    return [...new Set(
        rows
        .filter(r => (r["STATE"] || r["state"]) === state)
        .map(r => r["City"] || r["city"])
    )].filter(Boolean).sort();
  }, [state, rows]);

  const downloadPivotExcel = async () => {
    if (!fromDate || !toDate) return alert("Please select a date range first.");
    try {
        const res = await axios.get(`${API_BASE_URL}/reports/reports/monthly-pivot/export`, {
            params: { from_date: fromDate, to_date: toDate, channel: channel || undefined, state: state || undefined, city: city || undefined },
            responseType: "blob",
            headers: { Authorization: `Bearer ${token}` },
        });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement("a");
        link.href = url;
        link.download = `Distribution_Report_${fromDate}_to_${toDate}.xlsx`;
        link.click();
    } catch (err) { alert("Excel Export Failed"); }
  };

  const resetFilters = () => {
      setFromDate("");
      setToDate("");
      setState("");
      setCity("");
      if (isSuperadmin) setChannel("");
      fetchOrderReports(); // Re-fetch all data on reset
  };

  return (
    <div style={{ padding: "20px", background: "#f8fafc", minHeight: "80vh" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
        <h2 style={{ color: "#1e293b", fontWeight: "800", margin: 0 }}>📊 Store-Wise Distribution Analytics</h2>
        <button 
            onClick={downloadPivotExcel}
            style={{ padding: "10px 20px", background: "#15803d", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
        >
          📥 Download Excel
        </button>
      </div>

      <div
      style={{
        background: "#ffffff",
        padding: "20px",
        borderRadius: "12px",
        marginBottom: "25px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <h3 style={{ marginTop: 0 }}>📤 Manual Delivery Upload</h3>

      <p style={{ color: "#64748b", marginBottom: "15px" }}>
        Upload Excel file to automatically mark orders as delivered.
      </p>

      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => setManualFile(e.target.files[0])}
      />

      <button
        onClick={handleManualDeliveryUpload}
        disabled={uploadingManual}
        style={{
          marginLeft: "12px",
          padding: "10px 20px",
          background: "#16a34a",
          color: "#fff",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer",
          fontWeight: "600",
        }}
      >
        {uploadingManual ? "Uploading..." : "Upload Excel"}
      </button>
    </div>


      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "25px", background: "#fff", padding: "15px", borderRadius: "10px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
        <div style={inputGroup}>
            <label style={labelStyle}>From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
        </div>
        <div style={inputGroup}>
            <label style={labelStyle}>To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
        </div>

        <div style={inputGroup}>
            <label style={labelStyle}>Channel / Entity</label>
            {isSuperadmin ? (
                <select value={channel} onChange={(e) => setChannel(e.target.value)} style={inputStyle}>
                    <option value="">All Channels</option>
                    <option value="BLINKIT">Blinkit</option>
                    <option value="ZEPTO">Zepto</option>
                    <option value="IBM">IBM</option>
                    <option value="GENERAL">General</option>
                    <option value="CUSTOM">Custom</option>
                </select>
            ) : (
                <input type="text" value={channel} readOnly style={{ ...inputStyle, background: "#f1f5f9" }} />
            )}
        </div>

        <div style={inputGroup}>
            <label style={labelStyle}>State</label>
            <select value={state} onChange={(e) => { setState(e.target.value); setCity(""); }} style={inputStyle}>
                <option value="">All States</option>
                {dbStates.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
        </div>
        <div style={inputGroup}>
            <label style={labelStyle}>City</label>
            <select value={city} onChange={(e) => setCity(e.target.value)} disabled={!state} style={inputStyle}>
                <option value="">All Cities</option>
                {dbCities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "22px" }}>
            <button onClick={fetchOrderReports} style={{ padding: "0 25px", height: "40px", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer" }}>Apply Filters</button>
            <button onClick={resetFilters} style={{ padding: "0 15px", height: "40px", background: "#64748b", color: "#fff", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer" }}>Reset</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "20px", marginBottom: "30px" }}>
        <KpiCard label="Total Bottles (Confirmed)" value={totalBottlesKPI} bg="#dcfce7" color="#166534" icon="🥤" />
        <KpiCard label="Total Outlets Served" value={rows.length} bg="#dbeafe" color="#1e40af" icon="🏬" />
      </div>

      <div style={{ background: "#fff", borderRadius: "12px", overflow: "hidden", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead style={{ background: "#0f172a", color: "#fff" }}>
              <tr>
                <th style={thStyle}>Entity</th>
                <th style={thStyle}>City</th>
                <th style={thStyle}>Outlet ID</th>
                <th style={thStyle}>Outlet Name</th>
                <th style={thStyle}>POC Name</th>
                <th style={{ ...thStyle, background: "#1e293b", textAlign: "center", position: "sticky", left: 0 }}>TOTAL</th>
                {dynamicDates.map(d => <th key={d} style={{ ...thStyle, textAlign: "center", minWidth: "70px" }}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="100" style={{ padding: "40px", textAlign: "center" }}>Fetching Distribution Data...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan="100" style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>No data found for the current selection.</td></tr>
              ) : (
                    rows.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9", background: idx % 2 ? "#f8fafc" : "#fff" }}>
                        <td style={tdStyle}>{row["Entity"]}</td>
                        <td style={tdStyle}>{row["City"]}</td>
                        <td style={{ ...tdStyle, fontWeight: "bold" }}>{row["Outlet ID"]}</td>
                        <td style={tdStyle}>{row["Outlet Name"]}</td>
                        <td style={tdStyle}>{row["POC Name"]}</td>
                        <td style={{ ...tdStyle, textAlign: "center", fontWeight: "bold", background: "#f0fdf4", color: "#166534" }}>
                          {row["Total Count"]}
                        </td>
                        {dynamicDates.map(date => (
                          <td key={date} style={{ ...tdStyle, textAlign: "center" }}>
                            {row[date] || 0}
                          </td>
                        ))}
                      </tr>
                    ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const inputGroup = { display: "flex", flexDirection: "column", gap: "4px" };
const labelStyle = { fontSize: "11px", fontWeight: "bold", color: "#64748b", textTransform: "uppercase" };
const inputStyle = { padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", minWidth: "140px", outline: "none" };
const thStyle = { padding: "12px 15px", border: "1px solid #334155", whiteSpace: "nowrap", fontSize: "12px" };
const tdStyle = { padding: "10px 15px", border: "1px solid #e2e8f0", whiteSpace: "nowrap" };

export default Reports;