import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "./config";
import { QRCodeCanvas } from "qrcode.react";
import Reports from "./pages/Reports";
import * as XLSX from "xlsx";
import Employee from "./pages/Employee";
import AttendanceDashboard from "./pages/AttendanceDashboard";
import AttendanceHistory from "./pages/AttendanceHistory";
import LeaveManagement from "./pages/LeaveManagement";
import HolidayManagement from "./pages/HolidayManagement";
import usePermissions, { clearPermissionsCache } from "./hooks/usePermissions";
import StoreComplianceDashboard from "./StoreComplianceDashboard";
import { PERMISSIONS } from "./permissions";
import AccessDenied from "./components/AccessDenied";
import useSidebar, { clearSidebarCache } from "./hooks/useSidebar";
import { clearPermissionCatalogCache } from "./hooks/usePermissionCatalog";
import BackendSidebarItems, { sidebarItemTab } from "./components/BackendSidebarItems";
import { INDIA_STATES, getCitiesForState } from "./constants/indiaLocations";
import LogoutConfirmationDialog from "./components/LogoutConfirmationDialog";
import MonthlyVirtualCards from "./pages/MonthlyVirtualCards";
import BlinkitReports from "./pages/BlinkitReports";

const VENDOR_QR_URL = "https://veekayaquatech.com/vendor-info";

// --- Configuration ---

const BOTTLE_PRICE = 100; // Use BOTTLE_PRICE from this SuperAdmin file
// ⭐ FIX 1: Added 'CUSTOM' to the channel list
const ALL_CHANNELS = ["BLINKIT", "ZEPTO", "IBM", "GENERAL", "CUSTOM"]; 
const BLINKIT_ENTITIES = [
  "BCPL",
  "BISTRO",
  "ZHPL",
  "AMB",
];
const STORE_REGIONS = ["North", "South", "East", "West", "Central", "North East"];

// --- Helper Functions ---
const backendToUiStatus = (s) => {
  if (s === 'pending') return 'New';
  if (s === 'in_progress') return 'In Progress';
  if (s === 'delivered') return 'Delivered';
  return 'Resolved';
};

const normalizeOrderStatus = (status) => {
  if (!status) return "pending";

  return String(status)
    .replace("OrderStatusEnum.", "")
    .replace("orderstatusenum.", "")
    .toLowerCase()
    .trim();
};


const ACTIVE_ORDER_STATUSES = [
  "Pending",
  "Accepted",
  "Assigned",
  "In Progress"
];

const statusColors = {
  Pending: "#FF9800",
  Accepted: "#1976D2",
  Assigned: "#6A1B9A",
  Delivered: "#2E7D32",
};


const isDelivered = (o) => {
  const s = o.status?.toLowerCase();
  return (
    s === "delivered" ||
    s === "delivered_confirmed"
  );
};

const isActiveOrder = (o) =>
  ["pending", "accepted", "assigned", "in transit"].includes(
    o.status?.toLowerCase()
  );



// --- Reusable Collapsible Component for Segregation ---
const CollapsibleChannelSection = ({ title, children, defaultOpen = false, totalCount, headerAction = null }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div style={styles.collapsibleContainer}>
            <button 
                onClick={() => setIsOpen(!isOpen)} 
                style={styles.collapsibleHeader}
            >
                <h3 style={styles.collapsibleTitle}>
                    {title} ({totalCount})
                </h3>
                <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {headerAction && (
                        <span onClick={(event) => event.stopPropagation()}>
                            {headerAction}
                        </span>
                    )}
                    <span style={styles.collapsibleIcon}>{isOpen ? '▼' : '►'}</span>
                </span>
            </button>
            {isOpen && <div style={styles.collapsibleContent}>{children}</div>}
        </div>
    );
};
// --- Order Assignment Modal Component ---
const OrderAssignmentModal = ({ isVisible, onClose, order, approvedDeliveryPartners, onSubmit, selectedPartnerId, setSelectedPartnerId, modalStyles, styles, isLoading }) => {
    if (!isVisible || !order) return null;

    const handleAssign = (e) => {
        e.preventDefault();
        if (selectedPartnerId) {
            onSubmit(order.id, selectedPartnerId);
        } else {
            alert('Please select a delivery partner.');
        }
    };

    return (
        <div style={modalStyles.backdrop}>
            <div style={{ ...modalStyles.modal, maxHeight: '80vh', overflowY: 'auto' }}>
                <h3 style={modalStyles.title}>Assign Delivery Partner to Order #{order.id}</h3>
                <p style={styles.modalSubtitle}>Order Details: {order.bottles} bottles for {order.customerName}</p>

                <form onSubmit={handleAssign} style={styles.form}>
                    <label style={styles.reportLabel}>Select Delivery Partner:</label>
                    <select
                        style={styles.textInput}
                        value={selectedPartnerId}
                        onChange={(e) => setSelectedPartnerId(e.target.value)}
                        required
                        disabled={isLoading}
                    >
                        <option value="">-- Select Partner --</option>
                        {approvedDeliveryPartners.map(dp => (
                            <option key={dp.id} value={dp.id}>
                                {dp.full_name} ({dp.email})
                            </option>
                        ))}
                    </select>

                    <div style={modalStyles.actions}>
                        <button type="button" onClick={onClose} style={modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={modalStyles.submitButton} disabled={isLoading || !selectedPartnerId}>
                            {isLoading ? 'Assigning...' : 'Assign Order'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};



const mapComplaint = (c) => {
  const storeNames = c.created_by?.stores?.map(s => s.store_name).join(', ') || 'N/A';
  
  // ⭐ CHANGE 1: Extract channel from the new 'store' object returned by the backend
  const complaintChannel = (
    c.store?.channel || 
    "GENERAL" 
  ).toUpperCase();
  // ⭐ END CHANGE 1

  return {
    id: String(c.id),
    subject: c.subject,
    description: c.description,
    customerName: c.created_by?.full_name || '—',
    role: `Partner at ${storeNames}` || '—',
    date: new Date(c.created_at),
    status: backendToUiStatus(c.status),
    photoUrl: c.photo_url || null, 
    // ⭐ CHANGE 2: Add the channel to the mapped complaint object
    channel: complaintChannel,
  };
};
const mapOrderData = (apiData) => {
  if (!apiData) return [];

  const normalizeStatus = (status) => {
    if (!status) return "Pending";
    const s = status.toLowerCase().replace("-", "_");

    if (s === "pending") return "Pending";
    if (s === "accepted") return "Accepted";
    if (s === "assigned_to_manager") return "Assigned";
    if (s === "assigned") return "Assigned";
    if (s === "in_transit") return "In Transit";
    if (s === "delivered" || s === "delivered_confirmed") return "Delivered";
    if (s === "cancelled") return "Cancelled";

    return status;
  };

  return apiData.map(item => {
    const store = item.store || null;
    const manager = store?.assigned_manager || null;

    return {
      // 🆔 Order
      id: String(item.id),
      bottles: parseInt(item.order_details, 10) || 0,
      status: normalizeStatus(item.status),
      orderDate: new Date(item.order_date || item.created_at),

      // 🏪 Store info
      storeId: store?.id || null,
      customerName: store?.store_name || "Unknown Store",
      city: store?.city || "N/A",

      // ⭐ DELIVERY MANAGER (FIXED)
      managerId: manager?.id || null,
      managerName: manager?.full_name || null,
      isManagerAssigned: !!manager,

      // 🚚 Delivery Partner
      deliveryPartnerId: item.delivery_person_id || null,
      deliveryPartnerName: item.delivery_person
        ? item.delivery_person.full_name
        : null,

      // 🤝 Partner order
      isPartnerOrder: !!item.partner_id,
      partnerId: item.partner_id || null,
      partnerName: item.partner
        ? item.partner.full_name
        : null,

      // 🏷 Channel
      channel: (store?.channel || item.channel || "GENERAL").toUpperCase(),
    };
  });
};




const formatReportMonth = (dateString) => {
    if (!dateString) return 'N/A';
    
    const parts = dateString.split('-'); 
    if (parts.length < 2) return dateString;

    try {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; 
        const date = new Date(year, month, 1); 
        
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch (e) {
        return 'Invalid Date Format';
    }
};

// --- Reusable Components ---
const StatCard = ({ label, value, icon, bgColor, textColor, onPress }) => (
  <div style={{ ...styles.statCard, backgroundColor: bgColor, color: textColor }} onClick={onPress}>
    <div style={styles.statIcon}>{icon}</div>
    <div style={styles.statContent}>
      <p style={styles.statValue}>{value}</p>
      <p style={styles.statLabel}>{label}</p>
    </div>
  </div>
);

const isStoreActive = (store) => {
  if (typeof store?.is_active === "boolean") return store.is_active;
  if (String(store?.is_active).toLowerCase() === "false") return false;
  return String(store?.status || "active").toLowerCase() !== "inactive";
};

const toSafeDisplayMessage = (value, fallback) => {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error && value.message) return value.message;
  if (Array.isArray(value)) {
    const messages = value
      .map((item) => toSafeDisplayMessage(item, ""))
      .filter(Boolean);
    return messages.length ? messages.join(", ") : fallback;
  }
  if (value && typeof value === "object") {
    if (value.detail !== undefined) return toSafeDisplayMessage(value.detail, fallback);
    if (value.message !== undefined) return toSafeDisplayMessage(value.message, fallback);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return fallback;
};

const StoreStatusBadge = ({ store }) => {
  const active = isStoreActive(store);
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "5px 10px",
      borderRadius: "999px",
      backgroundColor: active ? "#DCFCE7" : "#FEE2E2",
      color: active ? "#166534" : "#991B1B",
      fontSize: "12px",
      fontWeight: "800",
      whiteSpace: "nowrap",
    }}>
      {active ? "🟢 Active" : "🔴 Inactive"}
    </span>
  );
};

const StoreStatusToggle = ({ store, loading, onToggle }) => {
  const active = isStoreActive(store);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={`${active ? "Deactivate" : "Activate"} ${store.store_name || "store"}`}
      disabled={loading}
      onClick={() => onToggle(store)}
      style={{
        width: "48px",
        height: "26px",
        padding: "3px",
        border: "none",
        borderRadius: "999px",
        backgroundColor: active ? "#16A34A" : "#CBD5E1",
        cursor: loading ? "wait" : "pointer",
        opacity: loading ? 0.65 : 1,
        transition: "background-color 0.2s ease",
      }}
    >
      <span style={{
        display: "block",
        width: "20px",
        height: "20px",
        borderRadius: "50%",
        backgroundColor: "#FFFFFF",
        transform: active ? "translateX(22px)" : "translateX(0)",
        transition: "transform 0.2s ease",
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.35)",
      }} />
    </button>
  );
};

const SearchableSelection = ({
  value,
  onChange,
  options,
  placeholder,
  required = false,
  disabled = false,
  showOptionsOnFocus = false,
}) => {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      String(option).toLowerCase().includes(normalizedQuery)
    );
  }, [options, normalizedQuery]);
  const shouldShowOptions =
    open && !disabled && (showOptionsOnFocus || normalizedQuery.length > 0);

  const selectOption = (option) => {
    onChange(option);
    setQuery(option);
    setOpen(false);
    setActiveIndex(0);
  };

  const handleKeyDown = (event) => {
    if (!shouldShowOptions || filteredOptions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filteredOptions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectOption(filteredOptions[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shouldShowOptions}
        value={query}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        style={styles.textInput}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
            setQuery(value || "");
          }, 120);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange("");
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      {shouldShowOptions && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 1200,
            maxHeight: "180px",
            overflowY: "auto",
            backgroundColor: "#FFFFFF",
            border: "1px solid #CBD5E1",
            borderRadius: "8px",
            boxShadow: "0 8px 20px rgba(15, 23, 42, 0.12)",
          }}
        >
          {filteredOptions.length > 0 ? filteredOptions.map((option, index) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
              style={{
                display: "block",
                width: "100%",
                padding: "9px 12px",
                border: "none",
                borderBottom: "1px solid #F1F5F9",
                backgroundColor: index === activeIndex ? "#EFF6FF" : "#FFFFFF",
                color: "#334155",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {option}
            </button>
          )) : (
            <div style={{ padding: "10px 12px", color: "#94A3B8", fontSize: "13px" }}>
              No matching options
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SidebarItem = ({ label, icon, name, active, onSelect, isUrgent }) => {
  return (
  <button
    style={{ 
      ...styles.sidebarItem, 
      ...(active ? styles.sidebarItemActive : {}),
      // Apply Red alert styling if isUrgent is true
      ...(isUrgent ? { borderLeft: '5px solid #ff4d4f', backgroundColor: '#fff1f0' } : {}) 
    }}
    onClick={() => onSelect(name)}
    onMouseEnter={(event) => { if (!active && !isUrgent) event.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; }}
    onMouseLeave={(event) => { if (!active && !isUrgent) event.currentTarget.style.backgroundColor = "transparent"; }}
    title={label}
  >
    <span style={styles.sidebarIcon}>{icon}</span>
    <span style={{ 
      ...styles.sidebarText, 
      ...(active ? styles.sidebarTextActive : {}),
      ...(isUrgent ? { color: '#cf1322', fontWeight: 'bold' } : {}) 
    }}>
      {label}
    </span>
    {isUrgent && <span style={{ marginLeft: 'auto', fontSize: '14px' }}>🚨</span>}
  </button>
  );
};

/* -----------------------------------------------------------
   SIDEBAR: Corrected to pass orphanedOrders logic
----------------------------------------------------------- */
const Sidebar = ({ currentTab, onSelectTab, orphanedOrdersCount = 0 }) => (
  <aside style={styles.sidebar}>
    <div style={styles.sidebarHeader}>
      <p style={styles.sidebarHeaderTitle}>AquaTrack</p>
    </div>

    <nav style={styles.sidebarNav}>
      <BackendSidebarItems
        currentTab={currentTab}
        onSelectTab={onSelectTab}
        renderGroup={(group) => <p key={group} style={styles.sidebarGroup}>{group}</p>}
        renderItem={({ key, name, ...item }) => (
          <SidebarItem
            key={key}
            {...item}
            name={name}
            onSelect={onSelectTab}
            isUrgent={name === "unassignedOrders" && orphanedOrdersCount > 0}
          />
        )}
      />
    </nav>
  </aside>
);



// --- SolutionModal Component ---
const SolutionModal = ({ isVisible, onClose, onSubmit, complaintId, solutionText, setSolutionText, isLoading, modalStyles }) => {
    if (!isVisible) return null;
    return (
        <div style={modalStyles.backdrop}>
            <div style={modalStyles.modal}>
                <h3 style={modalStyles.title}>Resolve Complaint #{complaintId}</h3>
                <form onSubmit={onSubmit}>
                    <textarea
                        style={modalStyles.textarea}
                        placeholder="Enter your resolution message..."
                        value={solutionText}
                        onChange={(e) => setSolutionText(e.target.value)}
                        required
                        rows={5}
                        disabled={isLoading}
                    />
                    <div style={modalStyles.actions}>
                        <button type="button" onClick={onClose} style={modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={modalStyles.submitButton} disabled={isLoading || !solutionText.trim()}>
                            {isLoading ? 'Resolving...' : 'Submit Resolution'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- QR Assigning Modal Component ---
const AssignBottleModal = ({ isVisible, onClose, selectedBottlesToAssign, approvedDeliveryPartners, onAssign, modalStyles }) => {
    const [selectedPartnerId, setSelectedPartnerId] = useState('');

    if (!isVisible) return null;

    const handleAssign = (e) => {
        e.preventDefault();
        if (selectedPartnerId) {
            onAssign(selectedPartnerId);
        } else {
            alert('Please select a delivery partner.');
        }
    };

    return (
        <div style={modalStyles.backdrop}>
            <div style={{ ...modalStyles.modal, maxHeight: '80vh', overflowY: 'auto' }}>
                <h3 style={modalStyles.title}>Assign Bottles to Partner</h3>
                <p style={styles.modalSubtitle}>Assigning {selectedBottlesToAssign.length} bottle(s)</p>

                <form onSubmit={handleAssign} style={styles.form}>
                    <label style={styles.reportLabel}>Select Delivery Partner:</label>
                    <select
                        style={styles.textInput}
                        value={selectedPartnerId}
                        onChange={(e) => setSelectedPartnerId(e.target.value)}
                        required
                    >
                        <option value="">-- Select Partner --</option>
                        {approvedDeliveryPartners.map(dp => (
                            <option key={dp.id} value={dp.id}>
                                {dp.full_name} ({dp.email})
                            </option>
                        ))}
                    </select>

                    <div style={modalStyles.actions}>
                        <button type="button" onClick={onClose} style={modalStyles.cancelButton}>
                            Cancel
                        </button>
                        <button type="submit" style={modalStyles.submitButton} disabled={!selectedPartnerId}>
                            Assign
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- DP Reassignment Modal Component (NEW) ---
// --- DP Reassignment Modal Component (NEW) ---
const ReassignDPModal = ({ isVisible, onClose, dp, managers, onMoveSubmit, styles, isLoading }) => {
    // Local state to track the selected new manager
    const [selectedManagerId, setSelectedManagerId] = useState('');

    useEffect(() => {
        // ⭐ FIX 1: Initialize selectedManagerId when the modal opens with the DP's current manager ID
        if (dp) {
            setSelectedManagerId(dp.assigned_manager_id ? String(dp.assigned_manager_id) : '0');
        } else {
            setSelectedManagerId('');
        }
    }, [dp]); // Recalculate whenever the DP object changes

    if (!isVisible || !dp) return null;

    const handleMove = (e) => {
        e.preventDefault();
        // Use the selectedManagerId from the dropdown state
        const managerId = selectedManagerId === '0' ? 0 : parseInt(selectedManagerId, 10);
        onMoveSubmit(dp.id, managerId);
    };

    const managersAndUnassign = [
        // Using '0' as string for consistency in <option value>
        { id: '0', full_name: "-- UNASSIGN (Remove Manager) --", assigned_area: "N/A" }, 
        // Ensure manager IDs are strings for <option value>
        ...managers.map(m => ({...m, id: String(m.id)})) 
    ];

    return (
        <div style={styles.modalStyles.backdrop}>
            <div style={{ ...styles.modalStyles.modal, maxHeight: '80vh', width: '450px', overflowY: 'auto' }}>
                <h3 style={styles.modalStyles.title}>Reassign Delivery Partner</h3>
                <p style={styles.modalSubtitle}>DP: {dp.full_name} (Current Manager ID: {dp.assigned_manager_id || 'None'})</p>

                <form onSubmit={handleMove} style={styles.form}>
                    <label style={styles.reportLabel}>Select New Manager:</label>
                    <select
                        style={styles.textInput}
                        value={selectedManagerId}
                        onChange={(e) => setSelectedManagerId(e.target.value)}
                        required
                        disabled={isLoading}
                    >
                        <option value="">-- Select Option --</option>
                        {managersAndUnassign.map(manager => (
                            <option key={manager.id} value={manager.id}>
                                {manager.full_name} {manager.id === '0' ? "(UNASSIGN)" : `(Area: ${manager.assigned_area})`}
                            </option>
                        ))}
                    </select>

                    <div style={styles.modalStyles.actions}>
                        <button type="button" onClick={onClose} style={styles.modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={styles.modalStyles.submitButton} disabled={isLoading || selectedManagerId === ''}>
                            {isLoading ? 'Moving...' : 'Move/Unassign DP'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Manager Team List Component (NEW) ---
const ManagerTeamList = ({ manager, allDeliveryPartners, onReassignClick, styles, canReassign = true }) => {
    const managerDps = allDeliveryPartners.filter(dp => 
        parseInt(dp.assigned_manager_id) === parseInt(manager.id)
    );

    if (managerDps.length === 0) {
        return (
            <div style={{ padding: '15px', background: '#fcfcfc', border: '1px dashed #DDD', borderRadius: 8, marginTop: 10 }}>
                <p style={{ margin: 0, color: '#DC3545', fontWeight: 'bold' }}>
                    No Delivery Partners currently assigned to {manager.full_name}.
                </p>
            </div>
        );
    }

    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ ...styles.dataTable, width: '100%', border: '1px solid #CCC' }}>
                <thead>
                    <tr style={{ backgroundColor: '#333', color: '#fff' }}>
                        <th style={{ ...styles.tableHeaderCell, padding: '8px 12px', fontSize: '13px' }}>DP Name</th>
                        <th style={{ ...styles.tableHeaderCell, padding: '8px 12px', fontSize: '13px' }}>Mobile</th>
                        <th style={{ ...styles.tableHeaderCell, padding: '8px 12px', fontSize: '13px' }}>City</th>
                        <th style={{ ...styles.tableHeaderCell, padding: '8px 12px', fontSize: '13px' }}>Status</th>
                        <th style={{ ...styles.tableHeaderCell, padding: '8px 12px', fontSize: '13px' }}>Action</th>
                    </tr>
                </thead>
                <tbody>
                    {managerDps.map(dp => (
                        <tr key={dp.id} style={styles.tableRow}>
                            <td style={{ ...styles.tableCell, padding: '8px 12px' }}>{dp.full_name}</td>
                            <td style={{ ...styles.tableCell, padding: '8px 12px' }}>{dp.mobile_number || 'N/A'}</td>
                            <td style={{ ...styles.tableCell, padding: '8px 12px' }}>{dp.city || 'N/A'}</td>
                            <td style={{ ...styles.tableCell, padding: '8px 12px' }}>
                                <span style={{ ...styles.activityStatusBadge, backgroundColor: dp.status === 'active' ? '#4CAF50' : '#FF9800' }}>
                                    {dp.status}
                                </span>
                            </td>
                            <td style={{ ...styles.tableCell, padding: '8px 12px' }}>
                                <button
                                    onClick={() => onReassignClick(dp)}
                                    style={{ ...styles.actionButton, backgroundColor: '#1565C0', padding: '6px 10px' }}
                                    disabled={!canReassign || dp.status !== 'active'}
                                >
                                    Move/Reassign
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};


// --- Edit Store Modal Component ---
const EditStoreModal = ({ isVisible, onClose, onSubmit, name, setName, address, setAddress, city, setCity, isLoading, styles }) => {
    if (!isVisible) return null;
    return (
        <div style={styles.modalStyles.backdrop}>
            <div style={{ ...styles.modalStyles.modal, width: '400px' }}>
                <h3 style={styles.modalStyles.title}>✏️ Edit Store Information</h3>
                <form onSubmit={onSubmit} style={styles.form}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={styles.reportLabel}>Store Name:</label>
                        <input
                            style={styles.textInput}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={styles.reportLabel}>City:</label>
                        <input
                            style={styles.textInput}
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            required
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={styles.reportLabel}>Address:</label>
                        <textarea
                            style={{ ...styles.textInput, height: '80px', resize: 'vertical' }}
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            rows={3}
                        />
                    </div>
                    <div style={styles.modalStyles.actions}>
                        <button type="button" onClick={onClose} style={styles.modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={styles.modalStyles.submitButton} disabled={isLoading}>
                            {isLoading ? 'Saving...' : 'Update Store'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
const EditManagerModal = ({ isVisible, onClose, onSubmit, manager, email, setEmail, password, setPassword, isLoading, styles }) => {
    if (!isVisible || !manager) return null;

    return (
        <div style={styles.modalStyles.backdrop}>
            <div style={{ ...styles.modalStyles.modal, width: '400px' }}>
                <h3 style={styles.modalStyles.title}>Update Credentials</h3>
                
                {/* ⭐ Read-only reference of the Store being edited */}
                <div style={{ marginBottom: '15px', padding: '10px', background: '#f8f9fa', borderRadius: '6px', border: '1px solid #eee' }}>
                    <p style={{ margin: '0 0 5px 0', fontSize: '14px', color: '#333' }}>
                        Editing: <strong>{manager.full_name}</strong>
                    </p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>
                        Store IDs: {manager.stores?.map(s => s.id).join(', ') || 'N/A'}
                    </p>
                </div>
                
                <form onSubmit={onSubmit} style={styles.form}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={styles.reportLabel}>Login Email:</label>
                        <input
                            style={styles.textInput}
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={styles.reportLabel}>New Password:</label>
                        <input
                            style={styles.textInput}
                            type="password"
                            placeholder="Leave blank to keep current"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                        <small style={{ color: '#888' }}>Min. 6 characters if changing.</small>
                    </div>

                    <div style={styles.modalStyles.actions}>
                        <button type="button" onClick={onClose} style={styles.modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={styles.modalStyles.submitButton} disabled={isLoading}>
                            {isLoading ? 'Saving...' : 'Update Credentials'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
// --- Main Component ---
const SuperAdminDashboard = () => {
  const currentUserRole = String(localStorage.getItem("user_role") || "").toLowerCase().replace(/[\s_-]/g, "");
  const isEmployeeRole = currentUserRole === "employee";
  const isSuperAdminRole = currentUserRole === "superadmin";
  const { hasPermission, permissionsLoading } = usePermissions();
  const canUpdateStoreStatus =
    isSuperAdminRole ||
    (!permissionsLoading && hasPermission(PERMISSIONS.STORES_STATUS_UPDATE));
  const { items: sidebarItems } = useSidebar();
  const [currentTab, setCurrentTab] = useState("dashboard");
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [dmName, setDmName] = useState("");
  const [dmEmail, setDmEmail] = useState("");
  const [dmPassword, setDmPassword] = useState("");
  const [dmMobile, setDmMobilenumber] = useState("");
  
  
  const [selectedStoreIdsDM, setSelectedStoreIdsDM] = useState([]);
  const [reports, setReports] = useState([]);


  // 📊 Reports tab selector
  const [reportsTab, setReportsTab] = useState("monthly");
  const [previewUrl, setPreviewUrl] = useState(null);
  const [validUpto, setValidUpto] = useState("");

  // 📄 Monthly Report States (REQUIRED)
  const [reportMonth, setReportMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadingReport, setUploadingReport] = useState(false);
  
  // --- Edit Manager States ---
  const [isEditManagerModalVisible, setIsEditManagerModalVisible] = useState(false);
  const [editingManager, setEditingManager] = useState(null);
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [updatingManager, setUpdatingManager] = useState(false);
  const [expandedPartnerId, setExpandedPartnerId] = useState(null);
  // Add these new states
const [selectedPartnerStoreIdsToAdd, setSelectedPartnerStoreIdsToAdd] = useState([]);
const [selectedPartnerStoreIdsToRemove, setSelectedPartnerStoreIdsToRemove] = useState([]);
const [partnerStoreAddSearch, setPartnerStoreAddSearch] = useState("");
const [partnerStoreRemoveSearch, setPartnerStoreRemoveSearch] = useState("");

const [previewImage, setPreviewImage] = useState(null);
const [statusFilter, setStatusFilter] = useState("ALL");
const [startDate, setStartDate] = useState("");
const [endDate, setEndDate] = useState("");
const [search, setSearch] = useState("");
const [orders, setOrders] = useState([]);
const [qrTab, setQrTab] = useState("qr"); // "qr" | "vendor"
const [vendorList, setVendorList] = useState([]);
const [statesList, setStatesList] = useState([]);

const [storeSearch, setStoreSearch] = useState("");
const [selectedStoreResult, setSelectedStoreResult] = useState(null);
const [storeAssignmentSearch, setStoreAssignmentSearch] = useState("");
const [currentInventorySearch, setCurrentInventorySearch] = useState("");
const [supplierChannelFilter, setSupplierChannelFilter] = useState("ALL");
const [supplierFilter, setSupplierFilter] = useState("ALL");


  const openImageModal = (imageUrl) => {
    setPreviewImage(imageUrl);
  };

  const closeImageModal = () => {
    setPreviewImage(null);
  };
  // 📄 Monthly report state (REQUIRED)


// DP Linking modal states


// Store selected DP id
const [selectedDPId, setSelectedDPId] = useState("");

  // --- Dashboard Data States ---
  const [totalOrders, setTotalOrders] = useState(0);
  const [customerOrdersCount, setCustomerOrdersCount] = useState(0);
  const [partnerOrdersCount, setPartnerOrdersCount] = useState(0);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [manualAssignmentOrders, setManualAssignmentOrders] = useState([]);
  const [totalActiveStores, setTotalActiveStores] = useState(0);
  const [totalVendors, setTotalVendors] = useState(0);
  const [totalDeliveryPartners, setTotalDeliveryPartners] = useState(0);
  const [dailyOrders, setDailyOrders] = useState(0);
  const [newComplaints, setNewComplaints] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);
  const [monthlyOrdersCount, setMonthlyOrdersCount] = useState(0);
  const [pendingDeliveryPartnersCount, setPendingDeliveryPartnersCount] =
    useState(0);
  const [channelAdminsList, setChannelAdminsList] = useState([]);
  const [deliveryManagers, setDeliveryManagers] = useState([]);
  const [freeManagerStores, setFreeManagerStores] = useState([]);
  const [freeManagerStoresLoaded, setFreeManagerStoresLoaded] = useState(false);
  const [isDPLinkingModalVisible, setIsDPLinkingModalVisible] = useState(false);
  const [managerToLink, setManagerToLink] = useState(null);
  const [isReassignModalVisible, setIsReassignModalVisible] = useState(false);
  const [dpToReassign, setDpToReassign] = useState(null);
  const [expandedManagerId, setExpandedManagerId] = useState(null);
 
  // 🌟 NEW KPIs 🌟
  const [dailyDeliveredOrders, setDailyDeliveredOrders] = useState(0);
  const [monthlyDeliveredOrders, setMonthlyDeliveredOrders] = useState(0);

  // --- BOTTLE KPIs STATES (Needed for Dashboard) ---
  const [freshBottlesWarehouse, setFreshBottlesWarehouse] = useState(0);
  const [emptyBottlesStores, setEmptyBottlesStores] = useState(0);

  // --- QR Management States ---
  const [generatedQrData, setGeneratedQrData] = useState(null);
  const [qrAssigning, setQrAssigning] = useState(false);
  const [selectedBottlesToAssign, setSelectedBottlesToAssign] = useState([]);
  const [unassignedBottles, setUnassignedBottles] = useState([]);
  

  const [isStoreDetailsModalVisible, setIsStoreDetailsModalVisible] = useState(false);
  const [selectedStoreForDetails, setSelectedStoreForDetails] = useState(null);
  const [storeManagementSearch, setStoreManagementSearch] = useState("");
  const [storeStatusFilter, setStoreStatusFilter] = useState("ALL");
  const [storeStatusUpdatingId, setStoreStatusUpdatingId] = useState(null);
  const [pendingStoreStatusChange, setPendingStoreStatusChange] = useState(null);
  const [storeStatusNotice, setStoreStatusNotice] = useState(null);
  const [storeQrById, setStoreQrById] = useState({});
  const [storeQrLoadingIds, setStoreQrLoadingIds] = useState({});
  const [storeQrModal, setStoreQrModal] = useState(null);
  const [pendingStoreQrRotation, setPendingStoreQrRotation] = useState(null);
  const [storeQrNotice, setStoreQrNotice] = useState(null);


  const [isManageStoresModalOpen, setIsManageStoresModalOpen] = useState(false);
  const [selectedManagerForStores, setSelectedManagerForStores] = useState(null);

  const [selectedStoreIdsToAdd, setSelectedStoreIdsToAdd] = useState([]);
  const [selectedStoreIdsToRemove, setSelectedStoreIdsToRemove] = useState([]);

  

  
  const [loadingQR, setLoadingQR] = useState(false);


  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreRegion, setNewStoreRegion] = useState("");
  const [newStoreEntity, setNewStoreEntity] = useState("");
  const [newStoreState, setNewStoreState] = useState("");
  const [newStoreCity, setNewStoreCity] = useState("");
  const [newStoreAddress, setNewStoreAddress] = useState("");
  const [newStoreLat, setNewStoreLat] = useState("");
  const [newStoreLong, setNewStoreLong] = useState("");
  const citySelectionOptions = useMemo(
    () => getCitiesForState(newStoreState),
    [newStoreState]
  );
  const [dmNameSearch, setDmNameSearch] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [vendorState, setVendorState] = useState("");
  
  // ⭐ Store Creation Channel State
  const [newStoreChannel, setNewStoreChannel] = useState(ALL_CHANNELS[0]);
  const [newStoreCustomChannelName, setNewStoreCustomChannelName] = useState("");
  const [storeFilterCity, setStoreFilterCity] = useState("ALL");
  const [storeFilterChannel, setStoreFilterChannel] = useState("ALL");
  const [isEditPartnerModalVisible, setIsEditPartnerModalVisible] = useState(false);
  const [editingPartner, setEditingPartner] = useState(null);
  const [editPartnerStores, setEditPartnerStores] = useState([]);



  const [qrSummary, setQrSummary] = useState({});

  // ⭐ Channel Admin Form States
const [channelAdminName, setChannelAdminName] = useState("");
const [channelAdminEmail, setChannelAdminEmail] = useState("");
const [channelAdminPassword, setChannelAdminPassword] = useState("");
const [channelAdminChannel, setChannelAdminChannel] = useState("BLINKIT");
const [isEditStoreModalVisible, setIsEditStoreModalVisible] = useState(false);
const [editingStore, setEditingStore] = useState(null);
const [editStoreName, setEditStoreName] = useState("");
const [editStoreAddress, setEditStoreAddress] = useState("");
const [editStoreCity, setEditStoreCity] = useState("");


const [isSupplierDeliveryModalVisible, setIsSupplierDeliveryModalVisible] = useState(false);
const [selectedSupplierOrder, setSelectedSupplierOrder] = useState(null);

const [deliveryDate, setDeliveryDate] = useState(
  new Date().toISOString().split("T")[0]
);
const [modalBottlesDelivered, setModalBottlesDelivered] = useState("");
const [modalEmptyBottles, setModalEmptyBottles] = useState("");
const [modalVehicleInfo, setModalVehicleInfo] = useState("");
const [modalDeliveredBy, setModalDeliveredBy] = useState("");
const [modalPhoto, setModalPhoto] = useState(null);

const [markingDelivered, setMarkingDelivered] = useState(false);


const openSupplierDeliveryModal = (order) => {
  setSelectedSupplierOrder(order);
  setDeliveryDate(new Date().toISOString().split("T")[0]);
  setModalBottlesDelivered(order.bottles || "");
  setModalEmptyBottles("");
  setModalVehicleInfo("");
  setModalDeliveredBy("");
  setModalPhoto(null);
  setIsSupplierDeliveryModalVisible(true);
};

const closeSupplierDeliveryModal = () => {
  setIsSupplierDeliveryModalVisible(false);
  setSelectedSupplierOrder(null);
  setDeliveryDate(new Date().toISOString().split("T")[0]);
  setModalBottlesDelivered("");
  setModalEmptyBottles("");
  setModalVehicleInfo("");
  setModalDeliveredBy("");
  setModalPhoto(null);
};

const handleMarkSupplierOrderDelivered = async () => {
  if (!selectedSupplierOrder) return;

  try {
    setMarkingDelivered(true);

    const token =
      accessToken ||
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");

    if (!token) {
      alert("Authentication token missing. Please login again.");
      navigate("/login/superadmin");
      return;
    }

    const formData = new FormData();

    // Backend expects this status for non-ZEPTO orders.
    // For ZEPTO orders, backend automatically converts to delivered_confirmed.
    formData.append(
      "status",
      "delivered_pending_confirmation"
    );

    // Delivery details
    formData.append(
      "bottles_delivered",
      String(modalBottlesDelivered || 0)
    );

    formData.append(
      "empty_bottles_collected",
      String(modalEmptyBottles || 0)
    );

    formData.append(
      "vehicle_info",
      modalVehicleInfo || ""
    );

    formData.append(
      "delivered_by",
      modalDeliveredBy || ""
    );

    // Backdated delivery support
    formData.append(
      "delivery_date",
      deliveryDate
    );

    // Optional photo upload
    if (modalPhoto) {
      formData.append("photo", modalPhoto);
    }

    await axios.put(
      `${API_BASE_URL}/partners/partners/delivery-partner/orders/${selectedSupplierOrder.id}`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      }
    );

    alert(
      `Order #${selectedSupplierOrder.id} marked as delivered successfully.`
    );

    // Close modal and reset fields
    closeSupplierDeliveryModal();

    // Refresh only the currently open manager page in Orders tab
    if (selectedOrdersManagerId) {
      if (selectedOrdersStoreId) {
        const storeKey = String(selectedOrdersStoreId);
        const page = ordersStorePageById[storeKey] || 1;
        await fetchOrdersByStore(selectedOrdersStoreId, page);
      } else {
        const managerKey = String(selectedOrdersManagerId);
        const page = ordersManagerPageById[managerKey] || 1;
        await fetchOrdersByManager(selectedOrdersManagerId, page);
      }
    }

  } catch (error) {
    console.error(
      "Error marking supplier order delivered:",
      error
    );

    const message =
      error?.response?.data?.detail ||
      error?.message ||
      "Failed to mark order as delivered.";

    alert(message);
  } finally {
    setMarkingDelivered(false);
  }
};


const handleDownloadDMStoresExcel = () => {
  if (!deliveryManagers || deliveryManagers.length === 0) {
    alert("No data available");
    return;
  }

  let rows = [];

  deliveryManagers.forEach(dm => {
    if (dm.stores && dm.stores.length > 0) {
      dm.stores.forEach(store => {
        rows.push([
          dm.full_name,
          dm.email,
          dm.assigned_area,
          store.store_name,
          store.city,
          store.channel
        ]);
      });
    } else {
      rows.push([
        dm.full_name,
        dm.email,
        dm.assigned_area,
        "No Store",
        "-",
        "-"
      ]);
    }
  });

  const headers = [
    "Delivery Manager",
    "Email",
    "Area",
    "Store Name",
    "Store City",
    "Channel"
  ];

  const csvContent = [
    headers.join(","),
    ...rows.map(r => r.map(val => `"${val}"`).join(","))
  ].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;"
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "DM_Store_Mapping.csv";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};







const cityOptions = [
    // --- NCR REGIONS (CRITICAL for Routing Fix) ---
    "HR-NCR",   // Haryana NCR Region (e.g., Gurgaon, Faridabad, Sonepat)
    "UP-NCR",   // Uttar Pradesh NCR Region (e.g., Noida, Ghaziabad, Meerut)
    "DL-NCR",   // Delhi National Capital Territory (if needed, or use "New Delhi")

    // --- Tier 1 Cities (Metros) ---
    "Mumbai",
    "Bengaluru",
    "Chennai",
    "Kolkata",
    "Hyderabad",
    
    // --- Tier 2 Cities (Expanded List) ---
    "Ahmedabad",
    "Pune",
    "Surat",
    "Jaipur", // Existing
    "Lucknow", // Existing
    "Kanpur", // Existing
    "Nagpur",
    "Visakhapatnam",
    "Bhopal",
    "Patna",
    "Ludhiana", // Existing
    "Amritsar", // Existing
    "Varanasi", // Existing
    "Agra", // Existing
    
    // --- Existing Cities (Retained for Individual City Assignment) ---
    "Delhi",
    "New Delhi",
    "Gurgaon",
    "Faridabad",
    "Noida",
    "Ghaziabad",
    "Sonipat",
    "Panipat",
    "Karnal",
    "Ambala",
    "Chandigarh",
    "Mohali",
    "Panchkula",
    "Aligarh",
    "Patiala",
];


const fetchStates = async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/vendor-license/states`);
    const data = await res.json();

    console.log("States API:", data);

    if (data.available_states) {
      setStatesList(data.available_states);
    }
  } catch (err) {
    console.error("State fetch error:", err);
  }
};

useEffect(() => {
  if (qrTab === "vendor") {
    fetchStates();
  }
}, [qrTab]);



  const AutocompleteCitySelect = ({ value, onChange, options }) => {
    const [search, setSearch] = useState("");

    const filtered = options.filter(city =>
        city.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div style={{ position: "relative", width: "100%" }}>
            <input
                style={styles.textInput}
                placeholder="Type to search city..."
                value={search || value}
                onChange={(e) => {
                    setSearch(e.target.value);
                    onChange(""); // reset selected city
                }}
            />

            {search && (
                <div
                    style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        maxHeight: "160px",
                        overflowY: "auto",
                        background: "white",
                        border: "1px solid #ddd",
                        zIndex: 999,
                        borderRadius: "4px"
                    }}
                >
                    {filtered.length === 0 && (
                        <div style={{ padding: 8, color: "#999" }}>
                            No results found
                        </div>
                    )}

                    {filtered.map((city) => (
                        <div
                            key={city}
                            style={{
                                padding: 8,
                                cursor: "pointer",
                                borderBottom: "1px solid #eee"
                            }}
                            onClick={() => {
                                onChange(city);
                                setSearch(city);
                            }}
                        >
                            {city}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};


const fetchVendors = async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/vendor-license/all`);
    const data = await res.json();
    if (Array.isArray(data)) {
      setVendorList(data);
    } else {
      console.error("Invalid vendor data:", data);
      setVendorList([]);
    }
  } catch (err) {
    console.error(err);
  }
};

useEffect(() => {
  if (qrTab === "vendor") {
    fetchVendors();
  }
}, [qrTab]);

const handlePartnerRowClick = (partnerId) => {
    if (expandedPartnerId !== partnerId) {
        setSelectedPartnerStoreIdsToAdd([]);
        setSelectedPartnerStoreIdsToRemove([]);
        setPartnerStoreAddSearch("");
        setPartnerStoreRemoveSearch("");
    }
    setExpandedPartnerId(expandedPartnerId === partnerId ? null : partnerId);
};


const handleAddLicense = async () => {
  try {
    const token =
      accessToken ||
      localStorage.getItem("auth_token");

    if (!token) {
      alert("Login required");
      return;
    }

    const res = await fetch(`${API_BASE_URL}/vendor-license/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        vendor_name: vendorName,
        license_number: licenseNumber,
        state: vendorState,
      }),
    });

    const data = await res.json();

    if (res.ok) {
      alert("✅ License Added");
      setVendorName("");
      setLicenseNumber("");
      setVendorState("");
    } else {
      alert(data.detail || "Error");
    }
  } catch (err) {
    console.error(err);
    alert("Something went wrong");
  }
};



  

const handleCreateChannelAdmin = async (e) => {
  e.preventDefault();

  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  if (!token) {
    alert("Authentication token missing. Please login again.");
    navigate("/login/superadmin");
    return;
  }

  // ✅ Resolve final channel value
  const finalChannel =
    channelAdminChannel === "CUSTOM"
      ? customChannelName.trim().toUpperCase()
      : channelAdminChannel;

  if (!finalChannel) {
    alert("Please select or enter a valid channel.");
    return;
  }

  try {
    const body = {
      full_name: channelAdminName,
      email: channelAdminEmail,
      password: channelAdminPassword,
      channel: finalChannel,
      status: "active",
    };

    const response = await axios.post(
      `${API_BASE_URL}/partners/partners/superadmin/create-channel-admin`,
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    alert("Channel Admin created successfully!");

    // ✅ Add custom channel back into dropdown
    if (
      channelAdminChannel === "CUSTOM" &&
      customChannelName &&
      !allChannels.includes(finalChannel)
    ) {
      setAllChannels((prev) => [
        ...prev.filter((c) => c !== "CUSTOM"),
        finalChannel,
        "CUSTOM",
      ]);
    }

    // Reset form fields
    setChannelAdminName("");
    setChannelAdminEmail("");
    setChannelAdminPassword("");
    setCustomChannelName("");
    setChannelAdminChannel("GENERAL");

  } catch (error) {
    console.error("Error creating Channel Admin:", error);
    alert(
      error.response?.data?.detail ||
      "Failed to create Channel Admin"
    );
  }
};



  // --- QR Management Handlers ---
  const handleGenerateQR = async () => {
    try {
      setLoading(true);

      const token =
        accessToken ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('userToken') ||
        localStorage.getItem('partner_token');

      if (!token) {
        alert('Authentication Required. Please log in to access the dashboard.');
        navigate('/login/superadmin');
        return;
      }

      const res = await fetch(`${API_BASE_URL}/bottle/superadmin/generate-qr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        // mirror the TSX error parsing
        let message = `Server error: ${res.status} ${res.statusText}`;
        try {
          const err = await res.json();
          if (Array.isArray(err.detail)) message = err.detail.map(d => d.msg).join('; ');
          else if (typeof err.detail === 'string') message = err.detail;
        } catch { }
        throw new Error(message);
      }

      const data = await res.json();
      setGeneratedQrData(data);
      alert('A new QR code has been generated and stored.');
      await fetchAllData();
    } catch (e) {
      console.error('Failed to generate QR:', e);
      alert(e.message || 'Failed to generate QR code.');
    } finally {
      setLoading(false);
    }
  };


  // --- Core Data States ---
  const [partners, setPartners] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ordersSummaryManagers, setOrdersSummaryManagers] = useState([]);
  const [ordersStoresByManagerId, setOrdersStoresByManagerId] = useState({});
  const [ordersByStoreId, setOrdersByStoreId] = useState({});
  const [selectedOrdersManagerId, setSelectedOrdersManagerId] = useState(null);
  const [selectedOrdersStoreId, setSelectedOrdersStoreId] = useState(null);
  const [ordersManagerPageById, setOrdersManagerPageById] = useState({});
  const [ordersManagerTotalPagesById, setOrdersManagerTotalPagesById] = useState({});
  const [ordersStorePageById, setOrdersStorePageById] = useState({});
  const [ordersStoreTotalPagesById, setOrdersStoreTotalPagesById] = useState({});
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [allDeliveryPartners, setAllDeliveryPartners] = useState([]);
  const [approvedDeliveryPartners, setApprovedDeliveryPartners] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [isSolutionModalVisible, setIsSolutionModalVisible] = useState(false);
  const [currentComplaintId, setCurrentComplaintId] = useState(null);
  const [solutionText, setSolutionText] = useState("");
  const [resolvingComplaint, setResolvingComplaint] = useState(false);
  const [bulkCount, setBulkCount] = useState(1);
  const [loadingBulk, setLoadingBulk] = useState(false);

  // --- Partner Details Modal ---
  const [isPartnerDetailsModalVisible, setIsPartnerDetailsModalVisible] =
    useState(false);
  const [selectedPartnerForDetails, setSelectedPartnerForDetails] =
    useState(null);


  // ⭐ NEW STATE: Holds ALL stores, irrespective of channel
  const [allStores, setAllStores] = useState([]);

    // ⭐ UNIQUE CITIES FROM STORES (DB-driven)
  const availableCities = useMemo(() => {
    const cities = allStores
      .map(store => store.city)
      .filter(Boolean); // remove null / undefined

    return [...new Set(cities)].sort();
  }, [allStores]);


  const storeSearchResults = useMemo(() => {
    if (!storeSearch) return [];

    let results = [];

    deliveryManagers.forEach(dm => {
      (dm.stores || []).forEach(store => {
        if (
          store.store_name
            .toLowerCase()
            .includes(storeSearch.toLowerCase())
        ) {
          results.push({
            storeName: store.store_name,
            managerName: dm.full_name,
            city: store.city
          });
        }
      });
    });

    return results;
  }, [storeSearch, deliveryManagers]);



  // --- Report Management States ---
  
  
// "monthly" | "delivery"

  
  // --- New Partner Creation Form States ---
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [stores, setStores] = useState([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState([]);
  // ⭐ NEW STATE: Channel for the new Partner
  const [partnerChannel, setPartnerChannel] = useState(ALL_CHANNELS[0]); 
  // ⭐ NEW STATE: Custom Channel Input
  const [customChannelName, setCustomChannelName] = useState("");
  const [allChannels, setAllChannels] = useState(ALL_CHANNELS);
  const [newStoreId, setNewStoreId] = useState("");


  const [accessToken, setAccessToken] = useState(null);

  useEffect(() => {
    const storeTabs = ["stores", "activeStores", "activeStoresList", "storeManagement"];
    if (!isSuperAdminRole || !storeTabs.includes(currentTab) || allStores.length === 0) return;

    let cancelled = false;
    const token =
      accessToken ||
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");
    const missingStores = allStores.filter((store) =>
      !Object.prototype.hasOwnProperty.call(storeQrById, String(store.id))
    );
    if (missingStores.length === 0) return;

    setStoreQrLoadingIds((current) => ({
      ...current,
      ...Object.fromEntries(missingStores.map((store) => [String(store.id), true])),
    }));

    Promise.allSettled(
      missingStores.map((store) =>
        axios.get(`${API_BASE_URL}/store-qr/admin/stores/${store.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((response) => ({ id: String(store.id), data: response.data }))
      )
    ).then((results) => {
      if (cancelled) return;
      setStoreQrById((current) => {
        const next = { ...current };
        results.forEach((result) => {
          if (result.status === "fulfilled") next[result.value.id] = result.value.data;
          else {
            const failedIndex = results.indexOf(result);
            next[String(missingStores[failedIndex].id)] = null;
          }
        });
        return next;
      });
      setStoreQrLoadingIds((current) => {
        const next = { ...current };
        missingStores.forEach((store) => delete next[String(store.id)]);
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [accessToken, allStores, currentTab, isSuperAdminRole, storeQrById]);

  useEffect(() => () => {
    if (storeQrModal?.imageUrl) URL.revokeObjectURL(storeQrModal.imageUrl);
  }, [storeQrModal?.imageUrl]);

  const [isOrderAssigningModalVisible, setIsOrderAssigningModalVisible] =
    useState(false);
  const [isAssignDMModalVisible, setIsAssignDMModalVisible] = useState(false);
  const [orderToAssignDM, setOrderToAssignDM] = useState(null);
  const [selectedDMId, setSelectedDMId] = useState("");
  const [orderToAssign, setOrderToAssign] = useState(null); 
  const [orderSubTab, setOrderSubTab] = useState("all");
  
  const [quickFilter, setQuickFilter] = useState("ALL");
  const [selectedDeliveryPartnerId, setSelectedDeliveryPartnerId] =
    useState("");

  const [expandedManager, setExpandedManager] = useState(null);
  const [expandedStore, setExpandedStore] = useState(null);
  const [expandedOrderType, setExpandedOrderType] = useState(null);
  const [dashboard, setDashboard] = useState({
  orders: {},
  stores: {},
  users: {},
  complaints: {},
  bottles: {},
  reports: {},
  revenue: {},
});


  const supplierChannelOptions = useMemo(() => {
  const channelsSet = new Set();

  ordersSummaryManagers.forEach((manager) => {
    if (manager?.channel) {
      channelsSet.add(String(manager.channel).toUpperCase());
    }
  });

  Object.values(ordersStoresByManagerId).forEach((storesList) => {
    (storesList || []).forEach((store) => {
      if (store?.channel) {
        channelsSet.add(String(store.channel).toUpperCase());
      }
    });
  });

  Object.values(ordersByStoreId).forEach((ordersList) => {
    (ordersList || []).forEach((order) => {
      if (order?.channel) {
        channelsSet.add(String(order.channel).toUpperCase());
      }
    });
  });

  const channels = [...channelsSet];

  return channels.sort();
}, [ordersSummaryManagers, ordersStoresByManagerId, ordersByStoreId]);




const supplierOptions = useMemo(() => {
  const suppliers = [
    ...new Set(
      ordersSummaryManagers
        .map(manager => manager.managerName)
        .filter(Boolean)
    )
  ];

  return suppliers.sort();
}, [ordersSummaryManagers]);


const orphanedOrders = useMemo(() => {
  return manualAssignmentOrders || [];
}, [manualAssignmentOrders]);

 const fetchChannelAdmins = async () => {
  try {
    const token =
      accessToken ||
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");

    if (!token) {
      console.warn("No authentication token found.");
      return;
    }

    const response = await axios.get(
      `${API_BASE_URL}/partners/partners/superadmin/list-channel-admins`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    setChannelAdminsList(response.data || []);
  } catch (error) {
    console.error("Error loading channel admins", error);
  }
};

    // 🟢 NEW DATA AGGREGATION FOR CHART 🟢
   

    const getMonthlyOrderData = useMemo(() => {
        const monthlyData = {};
        
        // Use allOrders data available in component state
        allOrders.forEach(order => {
            // Only count delivered orders for sales/revenue charts
            if (order.status?.toLowerCase() !== 'delivered') return;

            const monthKey = order.orderDate.toISOString().slice(0, 7); // YYYY-MM
            const revenue = order.bottles * BOTTLE_PRICE;
            
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = {
                    month: order.orderDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                    totalRevenue: 0,
                    totalBottles: 0,
                };
            }
            monthlyData[monthKey].totalRevenue += revenue;
            monthlyData[monthKey].totalBottles += order.bottles;
        });

        // Convert object into a sorted array and limit to last 6 months
        return Object.keys(monthlyData)
            .sort()
            .slice(-6) 
            .map(key => monthlyData[key]);
    }, [allOrders]);
    
    // 🟢 CHART COMPONENT PLACEHOLDER 🟢
    const MonthlyPerformanceChart = ({ data }) => {
        if (data.length === 0) {
            return (
                <div style={styles.chartPlaceholder}>
                    <p>No delivered orders data available for charting.</p>
                </div>
            );
        }
        
        // This simulates the chart area with the calculated data points
        return (
            <div style={{ height: '350px', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                <div style={styles.chartPlaceholder}>
                    <h4 style={{ color: '#1A2A44', margin: '5px 0' }}>Monthly Revenue Trend (Last {data.length} Months)</h4>
                    <p style={{marginBottom: 10, color: '#00796B', fontWeight: 'bold'}}>TOTAL REVENUE VS. VOLUME</p>
                    {data.map((d, index) => (
                        <p key={index} style={{ margin: '3px 0', fontSize: '14px', color: '#333' }}>
                            **{d.month}**: **₹{d.totalRevenue.toLocaleString('en-IN')}** ({d.totalBottles} bottles)
                        </p>
                    ))}
                    <p style={{ marginTop: 20, fontSize: 12, color: '#888' }}>
                        (Placeholder for Sales Chart)
                    </p>
                </div>
            </div>
        );
    };

const fetchDashboardSummary = async () => {
  if (isEmployeeRole) return;
  try {
    const token =
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");

    if (!token) return;

    const res = await axios.get(
      `${API_BASE_URL}/dashboard/summary`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    setDashboard(res.data);

  } catch (err) {
    console.error("Dashboard Summary Error", err);
  }
};

const mapOrdersForUi = (orders = []) => {
  return orders.map(order => ({
    id: order.id,
    bottles: order.bottles || 0,
    deliveredBottles: order.bottles_delivered || 0,
    status: normalizeOrderStatus(order.status),
    orderDate: order.order_date ? new Date(order.order_date) : null,
    storeName: order.store_name || order.store?.store_name || "N/A",
    storeId: order.store_id || order.store?.id || null,
    partnerName: order.poc_name || order.partner?.full_name || "N/A",
    deliveryPartnerName: order.delivered_by || order.delivery_person?.full_name || "Not Assigned",
    assignedManager: order.assigned_manager || order.manager_name || "Not Assigned",
    managerName: order.assigned_manager || order.manager_name || "Not Assigned",
    deliveryDate: order.delivered_at ? new Date(order.delivered_at) : null,
    vehicleInfo: order.vehicle_info || "N/A",
    deliveryPhoto: order.delivery_photo_url || null,
    channel: order.channel || order.store?.channel || "GENERAL"
  }));
};

const fetchOrdersByManager = async (managerId, page = 1) => {
  try {
    const token =
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");

    if (!token) {
      alert("Authentication Required. Please log in.");
      navigate("/login");
      return;
    }

    setAccessToken(token);
    setOrdersLoading(true);

    const params = {
      page,
      page_size: 50,
    };

    if (search?.trim()) params.search = search.trim();
    if (statusFilter !== "ALL") params.status = String(statusFilter).toLowerCase();
    if (supplierChannelFilter !== "ALL") params.channel = supplierChannelFilter;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (quickFilter !== "ALL") params.quick_filter = quickFilter;

    const res = await axios.get(
      `${API_BASE_URL}/superadmin/orders/manager/${managerId}/stores`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params,
      }
    );

    const payload = res.data || {};
    const rawStores =
      payload.stores ||
      payload.results ||
      payload.items ||
      (Array.isArray(payload) ? payload : []);

    const mappedStores = (Array.isArray(rawStores) ? rawStores : []).map(store => ({
      storeId: store.store_id ?? store.id ?? store.store?.id ?? null,
      storeName: store.store_name || store.store?.store_name || store.name || "Unknown Store",
      channel: (store.channel || store.store?.channel || "GENERAL").toUpperCase(),
      pendingCount: store.pending_orders ?? store.pending ?? 0,
      deliveredCount: store.delivered_orders ?? store.delivered ?? 0,
      orders: mapOrdersForUi(
        store.orders ||
        store.order_list ||
        store.store_orders ||
        []
      ),
      totalOrders:
        store.total_orders ??
        ((store.pending_orders ?? store.pending ?? 0) + (store.delivered_orders ?? store.delivered ?? 0)),
    }));

    const totalCount =
      payload.total_count ||
      payload.count ||
      payload.pagination?.total_count ||
      mappedStores.length;

    const totalPages =
      payload.total_pages ||
      payload.pagination?.total_pages ||
      Math.max(1, Math.ceil(totalCount / 50));

    const currentPage =
      payload.page ||
      payload.pagination?.page ||
      page;

    setSelectedOrdersManagerId(managerId);
    const managerKey = String(managerId);
    setOrdersManagerPageById(prev => ({
      ...prev,
      [managerKey]: currentPage,
    }));
    setOrdersManagerTotalPagesById(prev => ({
      ...prev,
      [managerKey]: totalPages,
    }));
    setOrdersStoresByManagerId(prev => ({
      ...prev,
      [String(managerId)]: mappedStores,
    }));

    if (selectedOrdersStoreId && !mappedStores.some(s => String(s.storeId) === String(selectedOrdersStoreId))) {
      setSelectedOrdersStoreId(null);
    }

    setTotalOrders(totalCount);
  } catch (error) {
    console.error("Manager orders fetch failed:", error);
    if (error?.response?.status === 401) {
      alert("Session expired. Please login again.");
      localStorage.clear();
      navigate("/login");
    }
  } finally {
    setOrdersLoading(false);
  }
};

const fetchOrdersByStore = async (storeId, page = 1) => {
  try {
    const token =
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");

    if (!token) {
      alert("Authentication Required. Please log in.");
      navigate("/login");
      return;
    }

    setAccessToken(token);
    setOrdersLoading(true);

    const params = {
      page,
      page_size: 50,
    };

    if (search?.trim()) params.search = search.trim();
    if (statusFilter !== "ALL") params.status = String(statusFilter).toLowerCase();
    if (supplierChannelFilter !== "ALL") params.channel = supplierChannelFilter;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (quickFilter !== "ALL") params.quick_filter = quickFilter;

    const res = await axios.get(
      `${API_BASE_URL}/superadmin/orders/store/${storeId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params,
      }
    );

    const payload = res.data || {};
    const rawOrders = payload.orders || payload.results || payload.items || (Array.isArray(payload) ? payload : []);
    const mappedOrders = mapOrdersForUi(rawOrders);

    const totalCount =
      payload.total_count ||
      payload.count ||
      payload.pagination?.total_count ||
      mappedOrders.length;

    const totalPages =
      payload.total_pages ||
      payload.pagination?.total_pages ||
      Math.max(1, Math.ceil(totalCount / 50));

    const currentPage =
      payload.page ||
      payload.pagination?.page ||
      page;

    setSelectedOrdersStoreId(storeId);
    const storeKey = String(storeId);
    setOrdersStorePageById(prev => ({
      ...prev,
      [storeKey]: currentPage,
    }));
    setOrdersStoreTotalPagesById(prev => ({
      ...prev,
      [storeKey]: totalPages,
    }));
    setAllOrders(mappedOrders);
    setOrdersByStoreId(prev => ({
      ...prev,
      [storeKey]: mappedOrders,
    }));
    setTotalOrders(totalCount);
  } catch (error) {
    console.error("Store orders fetch failed:", error);
    if (error?.response?.status === 401) {
      alert("Session expired. Please login again.");
      localStorage.clear();
      navigate("/login");
    }
  } finally {
    setOrdersLoading(false);
  }
};

const fetchOrders = async () => {
  try {
    const token =
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");

    if (!token) {
      alert("Authentication Required. Please log in.");
      navigate("/login");
      return;
    }

    setAccessToken(token);

    const params = {};
    if (search?.trim()) params.search = search.trim();
    if (supplierChannelFilter !== "ALL") params.channel = supplierChannelFilter;

    const response = await axios.get(
      `${API_BASE_URL}/superadmin/orders/summary`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params,
      }
    );

    const managers = Array.isArray(response.data)
      ? response.data
      : (
        response.data?.managers ||
        response.data?.summary ||
        response.data?.data ||
        []
      );

    const mappedManagers = (Array.isArray(managers) ? managers : []).map(m => ({
      managerId: m.manager_id ?? m.id ?? m.delivery_manager_id ?? "unassigned",
      managerName: m.manager_name || m.full_name || m.assigned_manager || "Unassigned Manager",
      totalOrders: m.total_orders ?? m.total ?? 0,
      totalPending: m.pending_orders ?? m.pending ?? 0,
      totalDelivered: m.delivered_orders ?? m.delivered ?? 0,
      storesCount: m.total_stores ?? m.stores_count ?? m.store_count ?? 0,
      channel: (m.channel || "GENERAL").toUpperCase(),
    }));

    setOrdersSummaryManagers(mappedManagers);

    setOrdersStoresByManagerId({});
    setOrdersByStoreId({});
    setOrdersManagerPageById({});
    setOrdersManagerTotalPagesById({});
    setOrdersStorePageById({});
    setOrdersStoreTotalPagesById({});
    setSelectedOrdersManagerId(null);
    setSelectedOrdersStoreId(null);
    setExpandedManager(null);
    setExpandedOrderType(null);
  } catch (error) {
    console.error("Orders summary fetch failed:", error);
    if (error?.response?.status === 401) {
      alert("Session expired. Please login again.");
      localStorage.clear();
      navigate("/login");
    }
  }
};

const fetchAllOrders = async (page = 1) => {
  try {
    const token =
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");

    if (!token) {
      alert("Authentication Required. Please log in.");
      navigate("/login");
      return;
    }

    setAccessToken(token);
    setOrdersLoading(true);

    const params = {
      page,
      page_size: 50,
    };

    if (search?.trim()) params.search = search.trim();
    if (statusFilter !== "ALL") params.status = String(statusFilter).toLowerCase();
    if (supplierChannelFilter !== "ALL") params.channel = supplierChannelFilter;
    if (supplierFilter !== "ALL") params.supplier = supplierFilter;
    if (startDate) params.from_date = startDate;
    if (endDate) params.to_date = endDate;

    const response = await axios.get(
      `${API_BASE_URL}/superadmin/orders/all`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params,
      }
    );

    const payload = response.data || {};
    const rawOrders = Array.isArray(payload.orders) ? payload.orders : [];

    setAllOrders(mapOrdersForUi(rawOrders));
    setCurrentPage(payload.page || page);
    setTotalPages(payload.total_pages || 1);
    setTotalOrders(payload.total_orders || rawOrders.length);
  } catch (error) {
    console.error("All orders fetch failed:", error);
    if (error?.response?.status === 401) {
      alert("Session expired. Please login again.");
      localStorage.clear();
      navigate("/login");
    }
  } finally {
    setOrdersLoading(false);
  }
};

    // --- API Fetching Functions (Resilient Logic) ---
const fetchAllData = async () => {
  setLoading(true);

  try {
    const token =
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");

    if (!token) {
      alert("Authentication Required. Please log in.");
      navigate("/login");
      return;
    }

    setAccessToken(token);

    const authHeaders = {
      headers: { Authorization: `Bearer ${token}` },
    };

    if (isEmployeeRole) {
      const [dashboardResponse, storesResponse, storeManagersResponse, deliveryManagersResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/employees/me/dashboard`, authHeaders),
        axios.get(`${API_BASE_URL}/employees/me/stores`, authHeaders),
        axios.get(`${API_BASE_URL}/employees/me/store-managers`, authHeaders),
        axios.get(`${API_BASE_URL}/employees/me/delivery-managers`, authHeaders),
      ]);
      const employeePayload = dashboardResponse.data || {};
      const employeeDashboard = employeePayload.dashboard || {};
      const recentOrders = Array.isArray(employeePayload.recent_orders) ? employeePayload.recent_orders : [];
      const pendingOrders = Array.isArray(employeePayload.pending_orders) ? employeePayload.pending_orders : [];
      const scopedStoresPayload = storesResponse.data;
      const scopedStores = Array.isArray(scopedStoresPayload)
        ? scopedStoresPayload
        : (scopedStoresPayload?.stores || []);
      const scopedStoreManagersPayload = storeManagersResponse.data;
      const scopedStoreManagers = Array.isArray(scopedStoreManagersPayload)
        ? scopedStoreManagersPayload
        : (scopedStoreManagersPayload?.store_managers || scopedStoreManagersPayload?.managers || []);
      const mappedEmployeeStoreManagers = scopedStoreManagers.map((manager) => ({
        id: manager.id,
        full_name: manager.name,
        email: manager.email,
        mobile_number: manager.mobile,
        assigned_store_count: manager.assigned_store_count,
        stores: Array.isArray(manager.assigned_stores) ? manager.assigned_stores : [],
      }));
      const scopedDeliveryManagersPayload = deliveryManagersResponse.data;
      const scopedDeliveryManagers = Array.isArray(scopedDeliveryManagersPayload)
        ? scopedDeliveryManagersPayload
        : (scopedDeliveryManagersPayload?.delivery_managers || scopedDeliveryManagersPayload?.managers || []);
      const mappedEmployeeDeliveryManagers = scopedDeliveryManagers.map((manager) => ({
        id: manager.id,
        full_name: manager.name,
        email: manager.email,
        mobile_number: manager.mobile,
        assigned_store_count: manager.assigned_store_count,
        stores: Array.isArray(manager.assigned_stores) ? manager.assigned_stores : [],
      }));

      setDashboard({ employee: employeeDashboard, assigned_store_count: employeePayload.assigned_store_count ?? scopedStores.length });
      setAllStores(scopedStores);
      setPartners(mappedEmployeeStoreManagers);
      setDeliveryManagers(mappedEmployeeDeliveryManagers);
      setTotalActiveStores(employeeDashboard.total_stores ?? scopedStores.length);
      setAllOrders(mapOrdersForUi(recentOrders));
      setManualAssignmentOrders(mapOrderData(pendingOrders));
      setOrders(mapOrdersForUi(pendingOrders));
      setOrdersLoaded(true);
      return;
    }

    const userRole = localStorage.getItem("user_role") || "superadmin";

    // ----------------------------------
    // 🔗 API CALLS
    // ----------------------------------
    const promises = [
      Promise.resolve({ data: null }), // [0] Orders moved to fetchOrders
      Promise.resolve({ data: null }), // [1] Pending orders moved to fetchOrders
      axios.get(`${API_BASE_URL}/partners/partners/list`, authHeaders), // [2]
      axios.get(`${API_BASE_URL}/partners/partners/superadmin/delivery-partners`, authHeaders), // [3]
      axios.get(`${API_BASE_URL}/bottle/superadmin/unassigned-bottles`, authHeaders), // [4]
      axios.get(`${API_BASE_URL}/complaints/complaints/assigned`, authHeaders), // [5]
      axios.get(`${API_BASE_URL}/bottle/superadmin/store-empty-counts`, authHeaders), // [6]
      axios.get(`${API_BASE_URL}/reports/reports/list`, authHeaders), // [7]

      userRole === "partner"
        ? axios.get(`${API_BASE_URL}/bottle/partner/me/empty-bottles`, authHeaders)
        : Promise.resolve({ data: { pending_empty_bottles: 0 } }), // [8]

      axios.get(`${API_BASE_URL}/store/store/list/all`, authHeaders), // [9]

      axios.get(`${API_BASE_URL}/partners/partners/superadmin/list-channel-admins`, authHeaders), // [10]
      axios.get(`${API_BASE_URL}/partners/partners/superadmin/list-delivery-managers`, authHeaders), // [11]
      axios.get(`${API_BASE_URL}/partners/partners/superadmin/orders/needs-manual-assignment`, authHeaders), // [12]
    ];

    const results = await Promise.allSettled(promises);

    const getData = (index) => {
      const res = results[index];
      if (res.status === "fulfilled") return res.value.data;

      console.warn(`API ${index} failed`, res.reason?.response?.data || res.reason);
      if (res.reason?.response?.status === 401) {
        throw new Error("Authentication Error");
      }
      return null;
    };

    // ----------------------------------
    // 📊 REPORTS
    // ----------------------------------
    const rawReports = getData(7);
    if (rawReports) {
      setReports(
        rawReports.map(r => ({
          id: r.id,
          filename: r.report_file ? r.report_file.split("/").pop() : `Report_${r.id}.pdf`,
          rawMonthYear: r.report_date || r.created_at,
          ...r,
        }))
      );
    }

    // ----------------------------------
    // 🧮 EMPTY BOTTLES (SUPERADMIN FIX)
    // ----------------------------------
    const storesDataWithCounts = getData(6) || [];

    // Map store_id → empty_bottles_count
    const emptyBottleMap = {};
    storesDataWithCounts.forEach(store => {
      emptyBottleMap[store.id] = store.empty_bottles_count || 0;
    });

    // ----------------------------------
    // 🏪 ALL STORES (MERGED DATA)
    // ----------------------------------
    const allStoresData = getData(9) || [];

    const mergedStores = allStoresData.map(store => ({
      ...store,
      empty_bottles_count: emptyBottleMap[store.id] ?? 0,
    }));

    setAllStores(mergedStores);
    setTotalActiveStores(mergedStores.length);

    // 🌍 Global Empty Bottles KPI
    const globalEmptyCount = mergedStores.reduce(
      (sum, s) => sum + (s.empty_bottles_count || 0),
      0
    );
    setEmptyBottlesStores(globalEmptyCount);

    if (mergedStores.length > 0) {
      setPartnerChannel(mergedStores[0].channel?.toUpperCase() || "");
    }

    // ----------------------------------
    // 👥 PARTNERS
    // ----------------------------------
    const partnersData = getData(2) || [];
    setPartners(partnersData);
    setTotalVendors(partnersData.length);

    const allDeliveryPartnersData = getData(3) || [];
    setAllDeliveryPartners(allDeliveryPartnersData);

    const deliveryManagersData = getData(11) || [];
    setDeliveryManagers(deliveryManagersData);

    // ----------------------------------
    // 🧑‍💼 CHANNEL ADMINS
    // ----------------------------------
    const channelAdminsData = getData(10) || [];
    setChannelAdminsList(channelAdminsData);

    // ----------------------------------
    // 🚚 MANUAL ASSIGNMENT
    // ----------------------------------
    const manualAssignmentData = getData(12);
    if (manualAssignmentData) {
      setManualAssignmentOrders(mapOrderData(manualAssignmentData));
    }

    // ----------------------------------
    // ♻️ UNASSIGNED BOTTLES
    // ----------------------------------
    const unassignedBottlesData = getData(4) || [];
    setUnassignedBottles(
      unassignedBottlesData.map(b => ({
        UUID: b.uuid,
        qr_code: b.qr_code,
      }))
    );

    // ----------------------------------
    // ⚠️ COMPLAINTS
    // ----------------------------------
    const complaintsData = getData(5) || [];
    setComplaints(complaintsData.map(mapComplaint));
    setNewComplaints(complaintsData.filter(c => c.status === "pending").length);

  } catch (error) {
    console.error("CRITICAL ERROR:", error);

    if (error.message.includes("Authentication")) {
      alert("Session expired. Please login again.");
      localStorage.clear();
      navigate("/login");
    } else {
      alert("Dashboard failed to load.");
    }
  } finally {
    setLoading(false);
  }
};

// 🔁 Run on load
useEffect(() => {
  fetchDashboardSummary();
  fetchAllData();
}, []);

useEffect(() => {
  const firstTab = sidebarItems.length ? sidebarItemTab(sidebarItems[0]) : null;
  const currentTabIsVisible = sidebarItems.some((item) => sidebarItemTab(item) === currentTab);
  if (firstTab && !currentTabIsVisible) setCurrentTab(firstTab);
}, [currentTab, sidebarItems]);







const fetchQrData = async () => {
  try {
    // ✅ FIX: Use the correct token keys from your login
    const token =
      localStorage.getItem('auth_token') ||
      localStorage.getItem('userToken') ||
      localStorage.getItem('partner_token') ||
      accessToken;

    if (!token) {
      console.error("QR data fetch skipped: No token found.");
      return; 
    }

    const headers = { Authorization: `Bearer ${token}` };

    // Fetch both summary and unassigned bottles at the same time
    const [summaryRes, unassignedRes] = await Promise.allSettled([
      axios.get(`${API_BASE_URL}/bottle/superadmin/summary`, { headers }),
      axios.get(`${API_BASE_URL}/bottle/superadmin/unassigned-bottles`, { headers }),
    ]);

    // Process summary
    if (summaryRes.status === 'fulfilled') {
        setQrSummary(summaryRes.value.data || {});
    } else {
        console.error("Failed to fetch QR summary:", summaryRes.reason);
    }
    
    // Process unassigned bottles
    if (unassignedRes.status === 'fulfilled') {
        const mappedBottles = (unassignedRes.value.data || []).map((bottle) => ({
                UUID: bottle.uuid,
                qr_code: bottle.qr_code,
            }));
            setUnassignedBottles(mappedBottles);
    } else {
        console.warn("Failed to fetch unassigned bottles:", unassignedRes.reason);
    }

  } catch (error) {
    console.error("Error in fetchQrData:", error);
  }
};


const mapSuperAdminOrdersForExport = (orders) => {
  return orders.map(order => {

    const parsedDate = order.order_date ? new Date(order.order_date) : null;

    return {
      id: order.id,

      storeName: order.store_name || 'N/A',

      bottles: order.bottles || 0,

      partnerName:
        order.ordered_by_type === 'ADMIN'
          ? 'Admin'
          : (order.poc_name || 'N/A'),

      formattedOrderDate: parsedDate
        ? parsedDate.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : 'N/A',

      deliveryPartnerName: order.delivered_by || 'Not Assigned',

      deliveredBottles: order.bottles_delivered || 0,

      deliveryDate: order.delivered_at || null,

      vehicleInfo: order.vehicle_info || 'N/A',

      status: order.status || 'N/A',

      deliveryPhoto: order.delivery_photo_url || null
    };
  });
};

const handleExportOrdersToExcel = () => {
  const exportOrders = selectedOrdersStoreId
    ? (ordersByStoreId[String(selectedOrdersStoreId)] || [])
    : [];

  if (exportOrders.length === 0) {
    alert("No orders available to export.");
    return;
  }

  const headers = [
    "Order ID",
    "Store Name",
    "Ordered By",          // ✅ NEW
    "Bottles Ordered",
    "Delivered Bottles",
    "Status",
    "Order Date & Time",
    "Delivery Date",
    "Delivery Partner",
    "Vehicle",
    "Proof (Photo URL)"
  ];

  const csvData = exportOrders.map(order => {

    const bottlesOrdered = order.bottles ?? 0;
    const deliveredBottles = order.deliveredBottles ?? 0;

    // ✅ Ordered By Logic
    const orderedBy =
      order.partnerName
        ? order.partnerName        // partner name
        : (order.pocName || "Admin"); // fallback

    // ✅ Order Date
    let orderDateTime = "N/A";
    if (order.orderDate) {
      try {
        const d = new Date(order.orderDate);
        orderDateTime = d.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch {}
    }

    // ✅ Delivery Date
    let deliveryDate = "N/A";
    if (order.deliveryDate) {
      try {
        const d = new Date(order.deliveryDate);
        deliveryDate = d.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch {}
    }

    const escape = (val) =>
      `"${String(val ?? 'N/A').replace(/"/g, '""')}"`;

    return [
      escape(`#${order.id}`),

      escape(order.storeName || 'N/A'),

      // ✅ NEW FIELD
      escape(orderedBy),

      bottlesOrdered,
      deliveredBottles,

      escape(order.status || 'N/A'),

      escape(orderDateTime),

      escape(deliveryDate),

      escape(order.deliveryPartnerName || 'Not Assigned'),

      escape(order.vehicleInfo || 'N/A'),

      escape(
        order.deliveryPhoto
          ? `${API_BASE_URL}${order.deliveryPhoto}`
          : 'N/A'
      )
    ].join(",");
  });

  const csvContent = [headers.join(","), ...csvData].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;"
  });

  const link = document.createElement("a");

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Aquatrack_Orders_${today}.csv`;

  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", filename);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(link.href);

  alert("✅ Export successful!");
};


const handleExportSupplierHierarchyToExcel = () => {
  if (!ordersSummaryManagers || ordersSummaryManagers.length === 0) {
    alert("No supplier data available to export.");
    return;
  }

  const headers = [
    "Supplier Name",
    "Channel",
    "Store Name",
    "Pending Orders",
    "Delivered Orders",
    "Total Orders",
    "Order ID",
    "Status",
    "Bottles",
    "Order Date",
    "Delivery Date",
    "Delivery Partner",
    "Vehicle Info",
    "Delivered By"
  ];

  const rows = [];

  const formatDate = (dateValue) => {
    if (!dateValue) return "";
    try {
      const d = new Date(dateValue);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return "";
    }
  };

  ordersSummaryManagers.forEach((supplier) => {
    const stores = ordersStoresByManagerId[String(supplier.managerId)] || [];

    stores.forEach((store) => {
      const loadedStoreOrders = ordersByStoreId[String(store.storeId)] || [];
      const pendingOrders = loadedStoreOrders.filter(o => !String(o.status || "").toLowerCase().includes("delivered"));
      const deliveredOrders = loadedStoreOrders.filter(o => String(o.status || "").toLowerCase().includes("delivered"));
      const allStoreOrders = [...pendingOrders, ...deliveredOrders];

      const storePendingCount = store.pendingCount ?? pendingOrders.length;
      const storeDeliveredCount = store.deliveredCount ?? deliveredOrders.length;

      // If no order exists, still create one summary row
      if (allStoreOrders.length === 0) {
        rows.push([
          supplier.managerName || "",
          supplier.channel || "",
          store.storeName || "",
          storePendingCount,
          storeDeliveredCount,
          storePendingCount + storeDeliveredCount,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          ""
        ]);
        return;
      }

      // Add one row per order
      allStoreOrders.forEach((order) => {
        rows.push([
          supplier.managerName || "",
          order.channel || store.channel || supplier.channel || "",
          store.storeName || "",
          storePendingCount,
          storeDeliveredCount,
          storePendingCount + storeDeliveredCount,

          order.id || "",
          order.status || "",
          order.bottles || 0,
          formatDate(order.orderDate),
          formatDate(order.deliveryDate),
          order.deliveryPartnerName || "",
          order.vehicleInfo || "",
          order.deliveryPartnerName || ""
        ]);
      });
    });
  });

  const escapeCSV = (value) => {
    const str = String(value ?? "");
    return `"${str.replace(/"/g, '""')}"`;
  };

  const csvContent = [
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => row.map(escapeCSV).join(","))
  ].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;"
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);

  const today = new Date().toISOString().split("T")[0];
  link.download = `Supplier_Hierarchy_Report_${today}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};


  // ------------------------------------------
  // --- REPORT MANAGEMENT HANDLERS ---
  // ------------------------------------------

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file);
    } else {
      alert('Please select a PDF file.');
      setSelectedFile(null);
    }
  };

  const handleApproveDeliveryPartner = async (partnerId) => {
    // Step 1: Get valid token (handles all key names)
    const token =
      accessToken ||
      localStorage.getItem('auth_token') ||
      localStorage.getItem('userToken') ||
      localStorage.getItem('partner_token');

    if (!token) {
      alert('Authentication token missing. Please login again.');
      navigate('/login/superadmin');
      return;
    }

    // Step 2: Confirm approval
    if (!window.confirm(`Are you sure you want to approve this Delivery Partner (ID: ${partnerId})?`))
      return;

    setLoading(true);
    try {
      // ⭐ FIX: Correct the API URL to match the documented backend endpoint structure.
      const response = await axios.patch(
        `${API_BASE_URL}/partners/partners/superadmin/delivery-partners/${partnerId}/approve`,
        { status: 'active' }, // Send the new status explicitly to ensure the DB update occurs
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      if (response.status === 200 || response.status === 204) {
        alert('✅ Delivery Partner approved successfully!');
        await fetchAllData(); // refresh
      } else {
        console.error('Unexpected response:', response.status, response.data);
        alert(`Unexpected server response: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Partner approval failed:', error.response?.data || error.message);
      if (error.message.includes('Network Error')) {
        alert('Network error: possible CORS issue.');
      } else if (error.response?.status === 401) {
        alert('Session expired. Please log in again.');
        navigate('/login/superadmin');
      } else {
        alert(`Failed to approve: ${error.response?.data?.detail || error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };
const handleApproveOrder = async (orderId) => {
  const token =
    accessToken ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('userToken') ||
    localStorage.getItem('partner_token');

  if (!token) {
    alert('Authentication token missing. Please log in again.');
    navigate('/login/superadmin');
    return;
  }

  if (!window.confirm(`Are you sure you want to approve Order #${orderId}?`)) {
    return;
  }

  setLoading(true);
  try {
    const response = await axios.patch(
      `${API_BASE_URL}/superadmin/orders/${orderId}/approve`, // ✅ fixed endpoint
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 200 || response.status === 204) {
      alert(`✅ Order #${orderId} approved successfully!`);
      await fetchAllData(); // refresh the table
    } else {
      throw new Error(`Server responded with ${response.status}`);
    }
  } catch (error) {
    console.error('Order approval failed:', error.response?.data || error.message);
    alert(
      error.response?.data?.detail ||
        `Failed to approve order: ${error.message}`
    );
  } finally {
    setLoading(false);
  }
};


// ------------------------------------------
// --- ORDER ASSIGNMENT HANDLERS ---
const handleRouteOrderClick = (order) => {
  // 🛑 Safety check: order already has DM
  if (order.assigned_to_manager_id) {
    alert(`Order #${order.id} is already assigned to a Delivery Manager.`);
    return;
  }

  const token =
    accessToken ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('userToken') ||
    localStorage.getItem('partner_token');

  if (!token) {
    alert('Authentication token missing. Please log in.');
    navigate('/login/superadmin');
    return;
  }

  // ✅ Open Assign DM modal
  setOrderToAssignDM(order);
  setSelectedDMId('');
  setIsAssignDMModalVisible(true);
};


const handleAssignDMConfirm = async () => {
  if (!orderToAssignDM || !selectedDMId) {
    alert("Please select a Delivery Manager");
    return;
  }

  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  if (!token) {
    alert("Authentication missing. Please login again.");
    return;
  }

  try {
    setLoading(true);

    await axios.patch(
      `${API_BASE_URL}/partners/partners/superadmin/orders/${orderToAssignDM.id}/assign-manager/${selectedDMId}`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );

    alert("✅ Delivery Manager assigned successfully");

    setIsAssignDMModalVisible(false);
    setOrderToAssignDM(null);
    setSelectedDMId("");

    fetchAllData(); // refresh unassigned + orders
  } catch (err) {
    console.error("Assign DM failed:", err.response?.data || err.message);
    alert(err.response?.data?.detail || "Failed to assign Delivery Manager");
  } finally {
    setLoading(false);
  }
};



const handleAddStore = async (e) => {
  e.preventDefault();

  const token = accessToken || localStorage.getItem("auth_token");

  if (!token) {
    alert("Authentication token missing.");
    navigate("/login/superadmin");
    return;
  }

  const finalChannel = (newStoreChannel || "GENERAL").toUpperCase().trim();

  if (!newStoreId || !newStoreName || !newStoreCity) {
    alert("Store ID, Store Name and City are required.");
    return;
  }

  try {
    setLoading(true);

    const body = {
      id: String(newStoreId).trim(),     // ✅ FIXED
      store_name: String(newStoreName).trim(),
      region: String(newStoreRegion || "").trim(),
      entity: String(newStoreEntity || "").trim(),
      state: String(newStoreState || "").trim(),
      city: String(newStoreCity).trim(),
      address: String(newStoreAddress || "").trim(),
      latitude: newStoreLat ? parseFloat(newStoreLat) : null,
      longitude: newStoreLong ? parseFloat(newStoreLong) : null,
      channel: finalChannel,
    };

    console.log("✅ Sending Store Payload:", body);

    const res = await axios.post(`${API_BASE_URL}/store/store/create`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    alert("✅ Store Created Successfully!");

    setNewStoreId("");
    setNewStoreName("");
    setNewStoreRegion("");
    setNewStoreEntity(newStoreChannel === "ZEPTO" ? "ZEPTO" : "");
    setNewStoreState("");
    setNewStoreCity("");
    setNewStoreAddress("");
    setNewStoreLat("");
    setNewStoreLong("");

    await fetchAllData();
  } catch (err) {
    console.log("❌ Error adding store:", err?.response?.data || err.message);

    const msg =
      err?.response?.data?.detail?.[0]?.msg ||
      err?.response?.data?.detail ||
      "Failed to add store.";

    alert(msg);
  } finally {
    setLoading(false);
  }
};


const handleDeleteStore = async (storeId) => {
  const token = accessToken || localStorage.getItem("auth_token");
  if (!token) {
    alert("Authentication token missing.");
    navigate("/login/superadmin");
    return;
  }

  if (!window.confirm("Are you sure you want to delete this store?")) return;

  try {
    setLoading(true);
    const res = await axios.delete(`${API_BASE_URL}/store/store/${storeId}/delete`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 200 || res.status === 204) {
      alert("Store deleted successfully!");
      await fetchAllData();
    }
  } catch (err) {
    console.error("Delete failed:", err.response?.data || err.message);
    alert(err.response?.data?.detail || "Failed to delete store.");
  } finally {
    setLoading(false);
  }
};


// ✅ Automation Toggle aur Settings update karne ke liye
const handleUpdateStoreAutomation = async (storeId, payload) => {
    try {
        const token = localStorage.getItem("auth_token") || accessToken;
        await axios.patch(`${API_BASE_URL}/store/store/${storeId}/auto-order`, payload, {
            headers: { Authorization: `Bearer ${token}` },
        });
        alert("✅ Store settings updated!");
        await fetchAllData(); 
    } catch (err) {
        alert(err.response?.data?.detail || "Failed to update settings");
    }
};

const requestStoreStatusChange = (store) => {
  if (!canUpdateStoreStatus) return;
  setStoreStatusNotice(null);
  setPendingStoreStatusChange({
    store,
    nextActive: !isStoreActive(store),
  });
};

const confirmStoreStatusChange = async () => {
  if (!pendingStoreStatusChange || !canUpdateStoreStatus) {
    setPendingStoreStatusChange(null);
    return;
  }

  const { store, nextActive } = pendingStoreStatusChange;
  const storeId = store.id;
  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  setStoreStatusUpdatingId(storeId);
  setStoreStatusNotice(null);

  try {
    await axios.patch(
      `${API_BASE_URL}/stores/${storeId}/status`,
      { is_active: nextActive },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    setAllStores((current) =>
      current.map((item) =>
        String(item.id) === String(storeId) ? { ...item, is_active: nextActive } : item
      )
    );
    setSelectedStoreForDetails((current) =>
      current && String(current.id) === String(storeId)
        ? { ...current, is_active: nextActive }
        : current
    );
    setPendingStoreStatusChange(null);
    setStoreStatusNotice({
      type: "success",
      message: `Store ${nextActive ? "activated" : "deactivated"} successfully.`,
    });
  } catch (error) {
    setPendingStoreStatusChange(null);
    setStoreStatusNotice({
      type: "error",
      message: error.response?.status === 403
        ? "You do not have permission to change store status."
        : toSafeDisplayMessage(
            error.response?.data?.detail ??
              error.response?.data?.message ??
              error.message,
            "Unable to update store status."
          ),
    });
  } finally {
    setStoreStatusUpdatingId(null);
  }
};

const storeQrAuthConfig = (extra = {}) => {
  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");
  return {
    ...extra,
    headers: {
      ...(extra.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  };
};

const setStoreQrLoading = (storeId, value) => {
  setStoreQrLoadingIds((current) => {
    const next = { ...current };
    if (value) next[String(storeId)] = true;
    else delete next[String(storeId)];
    return next;
  });
};

const loadStoreQrRow = async (storeId) => {
  const response = await axios.get(
    `${API_BASE_URL}/store-qr/admin/stores/${storeId}`,
    storeQrAuthConfig()
  );
  setStoreQrById((current) => ({ ...current, [String(storeId)]: response.data }));
  return response.data;
};

const getStoreQrImage = async (storeId) => {
  const response = await axios.get(
    `${API_BASE_URL}/store-qr/admin/stores/${storeId}/image`,
    storeQrAuthConfig({ responseType: "blob" })
  );
  return {
    blob: response.data,
    filename: `store-${storeId}-qr.png`,
  };
};

const openStoreQrModal = async (store) => {
  setStoreQrNotice(null);
  setStoreQrLoading(store.id, true);
  try {
    const [qr, image] = await Promise.all([
      loadStoreQrRow(store.id),
      getStoreQrImage(store.id),
    ]);
    const imageUrl = URL.createObjectURL(image.blob);
    setStoreQrModal({ store, qr, imageUrl, filename: image.filename });
  } catch (error) {
    setStoreQrNotice({
      type: "error",
      message: toSafeDisplayMessage(
        error.response?.data?.detail ?? error.message,
        "Unable to load Store QR."
      ),
    });
  } finally {
    setStoreQrLoading(store.id, false);
  }
};

const downloadStoreQr = async (store) => {
  setStoreQrNotice(null);
  setStoreQrLoading(store.id, true);
  try {
    const { blob, filename } = await getStoreQrImage(store.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    setStoreQrNotice({
      type: "error",
      message: toSafeDisplayMessage(
        error.response?.data?.detail ?? error.message,
        "Unable to download Store QR."
      ),
    });
  } finally {
    setStoreQrLoading(store.id, false);
  }
};

const confirmStoreQrRotation = async () => {
  const store = pendingStoreQrRotation;
  if (!store) return;
  setStoreQrNotice(null);
  setStoreQrLoading(store.id, true);
  try {
    const response = await axios.post(
      `${API_BASE_URL}/store-qr/admin/stores/${store.id}/rotate`,
      null,
      storeQrAuthConfig()
    );
    setStoreQrById((current) => ({ ...current, [String(store.id)]: response.data }));

    if (String(storeQrModal?.store?.id) === String(store.id)) {
      const image = await getStoreQrImage(store.id);
      const imageUrl = URL.createObjectURL(image.blob);
      setStoreQrModal((current) => current ? {
        ...current,
        qr: response.data,
        imageUrl,
        filename: image.filename,
      } : current);
    }

    setPendingStoreQrRotation(null);
    setStoreQrNotice({ type: "success", message: "Store QR rotated successfully." });
  } catch (error) {
    setPendingStoreQrRotation(null);
    setStoreQrNotice({
      type: "error",
      message: toSafeDisplayMessage(
        error.response?.data?.detail ?? error.message,
        "Unable to rotate Store QR."
      ),
    });
  } finally {
    setStoreQrLoading(store.id, false);
  }
};

const updateStoreQrStatus = async (store) => {
  const storeId = String(store.id);
  const previous = storeQrById[storeId];
  if (!previous) return;
  const nextEnabled = !previous.qr_enabled;

  setStoreQrNotice(null);
  setStoreQrLoading(store.id, true);
  setStoreQrById((current) => ({
    ...current,
    [storeId]: { ...previous, qr_enabled: nextEnabled },
  }));
  try {
    const response = await axios.patch(
      `${API_BASE_URL}/store-qr/admin/stores/${store.id}/status`,
      { qr_enabled: nextEnabled },
      storeQrAuthConfig()
    );
    setStoreQrById((current) => ({ ...current, [storeId]: response.data }));
    setStoreQrModal((current) =>
      current && String(current.store.id) === storeId
        ? { ...current, qr: response.data }
        : current
    );
    setStoreQrNotice({
      type: "success",
      message: `Store QR ${nextEnabled ? "enabled" : "disabled"} successfully.`,
    });
  } catch (error) {
    setStoreQrById((current) => ({ ...current, [storeId]: previous }));
    setStoreQrNotice({
      type: "error",
      message: toSafeDisplayMessage(
        error.response?.data?.detail ?? error.message,
        "Unable to update Store QR status."
      ),
    });
  } finally {
    setStoreQrLoading(store.id, false);
  }
};

// ✅ Store Info (Name/Address) edit karne ke liye
const handleEditStoreSubmit = async (e) => {
    e.preventDefault();
    try {
        setLoading(true);
        const token = localStorage.getItem("auth_token") || accessToken;
        await axios.patch(`${API_BASE_URL}/store/store/update/${editingStore.id}`, {
            store_name: editStoreName,
            address: editStoreAddress,
            city: editStoreCity
        }, { headers: { Authorization: `Bearer ${token}` } });

        alert("✅ Store updated successfully!");
        setIsEditStoreModalVisible(false);
        await fetchAllData();
    } catch (err) {
        alert(err.response?.data?.detail || "Update failed");
    } finally {
        setLoading(false);
    }
};

// ------------------------------------------
// --- BOTTLE ASSIGNMENT HANDLER (Fix) ---
const handleAssignBottlesToPartner = async (deliveryPartnerId) => {
    const token =
      accessToken ||
      localStorage.getItem('auth_token') ||
      localStorage.getItem('userToken') ||
      localStorage.getItem('partner_token');

    if (!token) {
      alert('Authentication token not found. Please log in again.');
      navigate('/login/superadmin');
      return;
    }
    if (!selectedBottlesToAssign || selectedBottlesToAssign.length === 0) {
      alert('Please select at least one bottle to assign.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/bottle/superadmin/assign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          qr_codes: selectedBottlesToAssign,
          delivery_boy_id: parseInt(deliveryPartnerId, 10),
        }),
      });

      if (!res.ok) {
        let message = `Server error: ${res.status} ${res.statusText}`;
        try {
          const err = await res.json();
          if (Array.isArray(err.detail)) message = err.detail.map(d => d.msg).join('; ');
          else if (typeof err.detail === 'string') message = err.detail;
        } catch { }
        throw new Error(message);
      }

      const result = await res.json();
      alert(result.message || 'Assigned successfully!');
      setQrAssigning(false);
      setSelectedBottlesToAssign([]);
      await fetchAllData();
    } catch (e) {
      console.error('Failed to assign bottles:', e);
      alert(e.message || 'Failed to assign bottles.');
    } finally {
      setLoading(false);
    }
  };


  const downloadStickersZip = async () => {
    // FIX: Need to get token inside the handler
    const token =
      accessToken ||
      localStorage.getItem('auth_token') ||
      localStorage.getItem('userToken') ||
      localStorage.getItem('partner_token');

    if (!token) {
      alert('Authentication token not found. Please log in again.');
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE_URL}/bottle/superadmin/download-qr-stickers`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Unable to download stickers ZIP.");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "qr_stickers.zip";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Stickers ZIP Download Error:", err);
      alert("Download failed, check console for details.");
    }
  };

  const handleUpdateManager = async (e) => {
    e.preventDefault();
    const token = accessToken || localStorage.getItem("auth_token");

    if (!editEmail) {
        alert("Email is required.");
        return;
    }

    try {
        setUpdatingManager(true);
        const body = { email: editEmail };
        if (editPassword) body.password = editPassword;

        await axios.patch(
            `${API_BASE_URL}/partners/partners/superadmin/update-manager/${editingManager.id}`,
            body,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        alert("Manager credentials updated successfully!");
        setIsEditManagerModalVisible(false);
        setEditPassword(""); // Clear sensitive data
        await fetchAllData(); // Refresh the list
    } catch (err) {
        console.error("Update failed:", err);
        alert(err.response?.data?.detail || "Failed to update manager credentials.");
    } finally {
        setUpdatingManager(false);
    }
};


const handleUpdatePartnerStores = async (partnerId, newStoreIds) => {
    const token = localStorage.getItem("auth_token") || accessToken;
    setLoading(true);
    try {
        await axios.put(
            `${API_BASE_URL}/partners/partners/superadmin/update/${partnerId}`,
            { stores: newStoreIds },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        alert("✅ Store assignments updated successfully!");
        await fetchAllData(); // Refresh the list to show new store counts
    } catch (err) {
        console.error(err);
        alert(err.response?.data?.detail || "Failed to update stores");
    } finally {
        setLoading(false);
    }
};

  const handleCreateDeliveryManager = async (e) => {
  e.preventDefault();

  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  if (!token) {
    alert("Authentication token missing.");
    return;
  }

  if (!dmName || !dmEmail || !dmPassword) {
    alert("Name, Email, and Password are required.");
    return;
  }

  if (!selectedStoreIdsDM.length) {
    alert("Please select at least one store.");
    return;
  }

  try {
    setLoading(true);

    // ✅ Create DM
    const createRes = await axios.post(
      `${API_BASE_URL}/partners/partners/superadmin/create-delivery-manager`,
      {
        full_name: dmName,
        email: dmEmail,
        password: dmPassword,
        mobile_number: dmMobile || null,
        area_city: storeFilterCity !== "ALL" ? storeFilterCity : null,
        assigned_stores: selectedStoreIdsDM, // ✅ important
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    alert(`✅ Delivery Manager "${dmName}" created successfully!`);

    // ✅ Reset fields
    setDmName("");
    setDmEmail("");
    setDmPassword("");
    setDmMobilenumber("");
    setSelectedStoreIdsDM([]);

    await fetchAllData();
  } catch (err) {
    console.error("Create DM error:", err?.response?.data || err.message);
    alert(err?.response?.data?.detail || "Failed to create Delivery Manager");
  } finally {
    setLoading(false);
  }
};




  // ✅ Corrected: Add stores to existing manager
  const handleAddStoresToExistingManager = async (managerId, storeIds) => {
  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken");

  if (!token) {
    alert("Authentication token missing. Please login again.");
    return;
  }

  if (!storeIds?.length) {
    alert("Please select at least one store to assign.");
    return;
  }

  try {
    setLoading(true);

    const payload = {
      manager_id: Number(managerId), // ✅ REQUIRED by backend
      store_ids: storeIds.map(String) // ✅ STRING list (as per schema)
    };

    await axios.post(
      `${API_BASE_URL}/partners/partners/superadmin/managers/${managerId}/stores/add`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    alert("✅ Stores assigned successfully!");
    if (isEmployeeRole) {
      const assignedIds = new Set(storeIds.map(String));
      setFreeManagerStores((current) => current.filter((store) => !assignedIds.has(String(store.id))));
    }
    setSelectedStoreIdsToAdd([]);
    await fetchAllData();

  } catch (err) {
    console.error("Add stores error:", err?.response?.data || err);

    const msg =
      err?.response?.data?.detail?.[0]?.msg ||
      "Failed to assign stores";

    alert(msg);
  } finally {
    setLoading(false);
  }
};



  // ✅ Corrected: Remove stores from existing manager
  const handleRemoveStoresFromExistingManager = async (managerId, storeIds) => {
  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  if (!token) {
    alert("Authentication token missing. Please login again.");
    navigate("/login/superadmin");
    return;
  }

  if (!storeIds?.length) {
    alert("Please select at least one store to remove.");
    return;
  }

  try {
    setLoading(true);

    await axios.post(
      `${API_BASE_URL}/partners/partners/superadmin/managers/${managerId}/stores/remove`,
      { store_ids: storeIds }, // ✅ string list
      { headers: { Authorization: `Bearer ${token}` } }
    );

    alert("✅ Stores removed successfully!");
    if (isEmployeeRole) {
      const removedIds = new Set(storeIds.map(String));
      const removedStores = allStores.filter((store) => removedIds.has(String(store.id)));
      setFreeManagerStores((current) => {
        const currentIds = new Set(current.map((store) => String(store.id)));
        return [...current, ...removedStores.filter((store) => !currentIds.has(String(store.id)))];
      });
    }
    await fetchAllData();
  } catch (err) {
    console.error("Remove stores error:", err?.response?.data || err.message);
    alert(err?.response?.data?.detail || "Failed to remove stores");
  } finally {
    setLoading(false);
  }
};

const handleUpdatePartnerCredentials = async (e) => {
    e.preventDefault();
    const token = accessToken || localStorage.getItem("auth_token");

    if (!editEmail) {
        alert("Email is required.");
        return;
    }

    try {
        setUpdatingManager(true);
        const body = { email: editEmail };
        if (editPassword) body.password = editPassword;

        // Using the existing update endpoint for partners
        await axios.patch(
            `${API_BASE_URL}/partners/partners/superadmin/update-manager/${editingManager.id}`,
            body,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        alert("Partner credentials updated successfully!");
        setIsEditManagerModalVisible(false);
        setEditPassword(""); 
        await fetchAllData(); 
    } catch (err) {
        console.error("Update failed:", err);
        alert(err.response?.data?.detail || "Failed to update credentials.");
    } finally {
        setUpdatingManager(false);
    }
};




  // ------------------------------------------
// --- PARTNER APPROVAL HANDLER ---
const handleApprovePartner = async (partnerId) => {
    try {
      setLoading(true);

      const token =
        accessToken ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('userToken') ||
        localStorage.getItem('partner_token');

      if (!token) {
        alert('Authentication token is missing. Please login again.');
        navigate('/login/superadmin');
        return;
      }

      // Confirm approval
      if (!window.confirm(`Are you sure you want to approve this partner (ID: ${partnerId})?`))
        return;

      // ⭐ FIX: Correct the URL path to use the 'delivery-partners/{id}/approve' structure.
      const response = await axios.patch(
        // The correct path based on the confirmed working structure:
        `${API_BASE_URL}/partners/partners/superadmin/delivery-partners/${partnerId}/approve`,
        // Sending status 'active' is the essential payload for approval on the backend
        { status: 'active' }, 
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      if (response.status === 200 || response.status === 204) {
        alert('✅ Partner approved successfully!');
        setIsPartnerDetailsModalVisible(false);
        setSelectedPartnerForDetails(null);
        await fetchAllData();
      } else {
        console.error('Unexpected response:', response.status, response.data);
        alert(`Unexpected response from server: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Partner approval failed:', error.response?.data || error.message);

      if (error.response?.status === 401) {
        alert('Session expired. Please log in again.');
        navigate('/login/superadmin');
      } else {
        // This is the error seen in the console for 404/Not Found:
        alert(`Failed to approve partner: ${error.response?.data?.detail || error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const PartnerDetailsModal = ({
    isVisible,
    onClose,
    onApprove,
    partner,
    isLoading,
    modalStyles
  }) => {
    if (!isVisible || !partner) return null;

    return (
      <div style={modalStyles.backdrop}>
        <div
          style={{
            ...modalStyles.modal,
            width: '600px',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}
        >
          <h3 style={modalStyles.title}>Partner Approval Details</h3>
          <p style={{ fontWeight: 500, color: '#444' }}>
            Reviewing: <b>{partner.full_name}</b> ({partner.email})
          </p>

          {/* The partner detail grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
            <div>
              <p><b>Full Name:</b> {partner.full_name}</p>
              <p><b>Email:</b> {partner.email}</p>
              <p><b>Mobile:</b> {partner.mobile_number}</p>
              <p><b>Address:</b> {partner.current_address}</p>
              <p><b>Vehicle No:</b> {partner.vehicle_number}</p>
              <p><b>License No:</b> {partner.driving_license_number}</p>
              <p><b>ID Type:</b> {partner.id_type}</p>
              <p><b>ID Number:</b> {partner.govt_id}</p>
            </div>
            <div>
              {partner.govt_id_photo_url && (
                <div>
                  <p><b>Government ID Photo:</b></p>
                  <a
                    href={`${API_BASE_URL}/${partner.govt_id_photo_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src={`${API_BASE_URL}/${partner.govt_id_photo_url}`}
                      alt="Govt ID"
                      style={{ width: '100%', borderRadius: 8 }}
                    />
                  </a>
                </div>
              )}
              {partner.delivery_photo_url && (
                <div style={{ marginTop: 10 }}>
                  <p><b>Partner Photo:</b></p>
                  <a
                    href={`${API_BASE_URL}/${partner.delivery_photo_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src={`${API_BASE_URL}/${partner.delivery_photo_url}`}
                      alt="Partner"
                      style={{ width: '100%', borderRadius: 8 }}
                    />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Buttons */}
          <div style={modalStyles.actions}>
            <button onClick={onClose} style={modalStyles.cancelButton} disabled={isLoading}>
              Cancel
            </button>
            <button
              onClick={() => onApprove(partner.id)}
              style={modalStyles.submitButton}
              disabled={isLoading}
            >
              {isLoading ? 'Approving...' : 'Approve Partner'}
            </button>
          </div>
        </div>
      </div>
    );
  };


  const StoreDetailsModal = ({ isVisible, onClose, store, partners, modalStyles, statusLoading, onStatusToggle, canUpdateStatus }) => {
  if (!isVisible || !store) return null;

  // Find assigned partners
  const assignedPartners = partners.filter(p =>
    p.stores.some(s => s.id === store.id)
  );
  const partnerNames = assignedPartners.map(p => p.full_name).join(', ') || 'N/A';

  return (
    <div style={modalStyles.backdrop}>
      <div style={{ ...modalStyles.modal, width: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={modalStyles.title}>Store Details</h3>
        <div style={styles.detailsGrid}>
          <div style={styles.detailsColumn}>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Store Name:</p>
              <p style={styles.detailValue}>{store.store_name}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>City:</p>
              <p style={styles.detailValue}>{store.city}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Address:</p>
              <p style={styles.detailValue}>{store.address || 'N/A'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Latitude:</p>
              <p style={styles.detailValue}>{store.latitude || 'N/A'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Longitude:</p>
              <p style={styles.detailValue}>{store.longitude || 'N/A'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Channel:</p>
              <p style={styles.detailValue}>{store.channel || 'N/A'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Partner(s):</p>
              <p style={styles.detailValue}>{partnerNames}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Status:</p>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "4px" }}>
                <StoreStatusBadge store={store} />
                {canUpdateStatus && (
                  <StoreStatusToggle store={store} loading={statusLoading} onToggle={onStatusToggle} />
                )}
                {canUpdateStatus && statusLoading && <span style={{ color: "#64748B", fontSize: "12px" }}>Updating…</span>}
              </div>
            </div>
          </div>
        </div>

        <div style={modalStyles.actions}>
          <button onClick={onClose} style={modalStyles.cancelButton}>Close</button>
        </div>
      </div>
    </div>
  );
};



// ------------------------------------------
// --- REPORT UPLOAD / DOWNLOAD HANDLERS ---
const handleUploadReport = async (e) => {
  e.preventDefault();

  const token = accessToken || localStorage.getItem('auth_token') || 
                localStorage.getItem('userToken') || localStorage.getItem('partner_token');

  if (!selectedFile || !reportMonth) {
    alert('Please select a PDF file and choose the month.');
    return;
  }

  setUploadingReport(true);
  const formData = new FormData();
  // Ensure date is formatted as YYYY-MM-DD for backend consistency
  const isoDateString = `${reportMonth}-01`;
  formData.append('report_file', selectedFile);
  formData.append('report_date', isoDateString);
  formData.append('valid_upto', validUpto);

  try {
    const response = await axios.post(`${API_BASE_URL}/reports/reports/upload`, formData, {
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'multipart/form-data' 
      },
    });

    if (response.status >= 200 && response.status < 300) {
      alert('Monthly report uploaded successfully!');
      setSelectedFile(null);
      setReportMonth(new Date().toISOString().slice(0, 7)); // Reset to current month
      
      // Clear the file input manually
      const fileInput = e.target.querySelector('input[type="file"]');
      if (fileInput) fileInput.value = "";

      // Refresh data to show the new report in the list
      await fetchAllData(); 
    }
  } catch (error) {
    console.error('Report upload failed:', error);
    alert(error.response?.data?.detail || 'Upload failed');
  } finally {
    setUploadingReport(false);
  }
};
const handleReportDownload = async (reportId) => {
  const token =
    accessToken ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('userToken') ||
    localStorage.getItem('partner_token');

  if (!token) {
    alert('Authentication required to download file.');
    navigate('/login/superadmin');
    return;
  }

  try {
    const response = await axios.get(`${API_BASE_URL}/reports/reports/download/${reportId}`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'blob',
    });

    if (response.status === 200) {
      const blob = new Blob([response.data], { type: response.headers['content-type'] });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `Report_${reportId}_${new Date().toISOString().slice(0, 10)}.pdf`;

      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } else {
      alert(`Download failed: ${response.status}`);
    }
  } catch (error) {
    console.error('Download failed:', error.response?.data || error.message);
    alert('File download failed. Check API endpoint or authorization.');
  }
};

const handleBulkGenerateQR = async () => {
  if (!bulkCount || bulkCount < 1) {
    alert("Enter a valid number of QR codes.");
    return;
  }

  setLoadingBulk(true);

  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  try {
    const res = await axios.post(
      `${API_BASE_URL}/bottle/superadmin/generate-qr?count=${bulkCount}`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );

    alert(res.data.message);
    fetchQrData(); // Refresh summary after generation
  } catch (error) {
    console.error(error);
    alert("Bulk QR generation failed");
  } finally {
    setLoadingBulk(false);
  }
};

// --- [FIX 1] ADDED FUNCTION TO HANDLE CHECKBOX CLICKS ---
const handleSelectBottle = (qr_code, isChecked) => {
  setSelectedBottlesToAssign(prev => {
    if (isChecked) {
      // Add to array if not already present
      return [...prev, qr_code];
    } else {
      // Remove from array
      return prev.filter(code => code !== qr_code);
    }
  });
};

// --- [FIX 2] ADDED FUNCTION TO HANDLE SINGLE QR DOWNLOAD ---
const downloadSingleQr = (uuid, qr_code) => {
  try {
    const canvas = document.getElementById(`qr-${uuid}`);
    if (canvas) {
      const pngUrl = canvas
        .toDataURL("image/png")
        .replace("image/png", "image/octet-stream");
      let downloadLink = document.createElement("a");
      downloadLink.href = pngUrl;
      downloadLink.download = `${qr_code}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } else {
      throw new Error("Could not find QR code canvas element.");
    }
  } catch (e) {
    console.error("Failed to download QR:", e);
    alert("Failed to download QR code.");
  }
};


// ------------------------------------------
// --- COMPLAINT RESOLUTION HANDLERS ---
const handleResolveClick = (complaintId) => {
  setCurrentComplaintId(complaintId);
  setSolutionText('');
  setIsSolutionModalVisible(true);
};

const handleCloseModal = () => {
  setIsSolutionModalVisible(false);
  setCurrentComplaintId(null);
  setSolutionText('');
};

const handleSolutionSubmit = async (e) => {
  e.preventDefault();

  const token =
    accessToken ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('userToken') ||
    localStorage.getItem('partner_token');

  const trimmedText = solutionText.trim();

  if (!trimmedText) {
    alert('Please enter a resolution message.');
    return;
  }
  if (!currentComplaintId || !token) {
    alert('Authentication missing or invalid.');
    navigate('/login/superadmin');
    return;
  }

  setResolvingComplaint(true);
  try {
    const payload = { status: 'resolved', solution: trimmedText };
    const response = await axios.patch(
      `${API_BASE_URL}/complaints/complaints/${currentComplaintId}/resolve`,
      payload,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    if (response.status === 200) {
      alert(`Complaint #${currentComplaintId} successfully resolved.`);
      handleCloseModal();
      await fetchAllData();
    } else {
      throw new Error(`Server responded with ${response.status}`);
    }
  } catch (error) {
    console.error('Complaint resolution failed:', error.response?.data || error.message);
    alert(`Failed: ${error.response?.data?.detail || error.message}`);
  } finally {
    setResolvingComplaint(false);
  }
};

// ------------------------------------------
// --- PARTNER CREATION, EDIT, DELETE HANDLERS ---
const handleCreatePartner = async (e) => {
  e.preventDefault();
  const trimmedFullName = fullName.trim();
  const trimmedEmail = email.trim();
  const trimmedMobile = mobileNumber.trim();
  
  // ⭐ FIX 2: Determine final channel name
  const finalChannel = partnerChannel === "CUSTOM" 
    ? customChannelName.toUpperCase().trim() 
    : partnerChannel.toUpperCase().trim();

  const token =
    accessToken ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('userToken') ||
    localStorage.getItem('partner_token');

  if (!trimmedFullName || !trimmedEmail || !password || !trimmedMobile) {
    alert('All fields are required.');
    return;
  }
  if (selectedStoreIds.length === 0) {
    alert('Please select at least one store.');
    return;
  }
  if (!token) {
    alert('Authentication token missing.');
    navigate('/login/superadmin');
    return;
  }
  // ⭐ NEW VALIDATION: If custom is selected, check custom field
  if (partnerChannel === "CUSTOM" && !finalChannel) {
      alert('Please enter a name for the custom channel.');
      return;
  }

  setLoading(true);
  const partnerData = {
    full_name: trimmedFullName,
    email: trimmedEmail,
    password,
    mobile_number: trimmedMobile,
    stores: selectedStoreIds,
    role: 'partner',
    // ⭐ FIX 3: Use the dynamically selected/entered channel
    channel: finalChannel, 
  };

  try {
    const response = await axios.post(
      `${API_BASE_URL}/partners/partners/superadmin/create`,
      partnerData,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }
    );

    if (response.status === 201) {
      alert(`Partner ${trimmedFullName} created successfully for channel ${finalChannel}!`);
      setFullName('');
      setEmail('');
      setPassword('');
      setMobileNumber('');
      setSelectedStoreIds([]);
      setCustomChannelName(''); // Reset custom name field
      await fetchAllData();
      await handleTabChange('myPartners');
    }
  } catch (error) {
    console.error('Partner creation failed:', error.response?.data || error.message);
    alert(`Error: ${error.response?.data?.detail || error.message}`);
  } finally {
    setLoading(false);
  }
};

const handleDeleteChannelAdmin = async (adminId, adminName) => {
    if (!window.confirm(`Are you sure you want to delete channel admin "${adminName}"?`)) {
        return;
    }

    const token =
        accessToken ||
        localStorage.getItem("auth_token") ||
        localStorage.getItem("userToken") ||
        localStorage.getItem("partner_token");

    if (!token) {
        alert("Authentication required.");
        navigate("/login");
        return;
    }

    try {
        await axios.delete(
            `${API_BASE_URL}/partners/partners/superadmin/delete-channel-admin/${adminId}`,
            {
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        alert("Channel Admin deleted successfully!");

        // Refresh list
        fetchChannelAdmins(); // If you made this function
        fetchAllData();       // Or use this if allData includes admins
        
    } catch (error) {
        console.error(error);
        alert(error?.response?.data?.detail || "Failed to delete channel admin");
    }
};



// --- [NEW ADDITION] Handler to delete a partner ---
const handleDeletePartner = async (partnerId, partnerName) => {
    if (!window.confirm(`Are you sure you want to delete the partner "${partnerName}"? This action cannot be undone.`)) {
        return;
    }

    const token =
        accessToken ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('userToken') ||
        localStorage.getItem('partner_token');

    if (!token) {
        alert('Authentication token missing.');
        navigate('/login/superadmin');
        return;
    }

    setLoading(true);
    try {
        const response = await axios.delete(
            `${API_BASE_URL}/partners/partners/superadmin/delete/${partnerId}`,
            {
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        if (response.status === 200 || response.status === 204) {
            alert('Partner deleted successfully!');
            await fetchAllData(); // Refresh the partner list
        }
    } catch (error) {
        console.error('Partner deletion failed:', error.response?.data || error.message);
        alert(`Error deleting partner: ${error.response?.data?.detail || error.message}`);
    } finally {
        setLoading(false);
    }
};


// ------------------------------------------
// --- LOGOUT HANDLER ---
const handleLogout = () => {
  ['auth_token', 'userToken', 'partner_token', 'user_role', 'store_id', 'store_name'].forEach((k) =>
    localStorage.removeItem(k)
  );
  clearPermissionsCache();
  clearSidebarCache();
  clearPermissionCatalogCache();
  alert('You have been successfully logged out.');
  navigate('/login');
};

const handleDeleteVendorLicense = async (vendorId) => {
  const confirmDelete = window.confirm("Are you sure?");
  if (!confirmDelete) return;

  try {
    // ✅ FIXED TOKEN (same as rest of app)
    const token =
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");

    if (!token) {
      alert("Login required");
      return;
    }

    const res = await fetch(
      `${API_BASE_URL}/vendor-license/delete/${vendorId}`,
      {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`,
        }
      }
    );

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Delete failed");
    }

    alert(data.message || "Deleted successfully");

    // ✅ UI update
    setVendorList(prev => prev.filter(v => v.id !== vendorId));

  } catch (err) {
    console.error(err);
    alert("Delete failed");
  }
};


// --- DELETE DELIVERY MANAGER HANDLER (Uses the new API) ---
const handleDeleteManager = async (managerId, managerName) => {
    if (!window.confirm(`Are you sure you want to delete Delivery Manager ${managerName}? This will fail if they still have linked DPs or routed orders.`)) return;

    const token = accessToken || localStorage.getItem('auth_token');
    setLoading(true);
    try {
        await axios.delete(
            `${API_BASE_URL}/partners/partners/superadmin/delete-manager/${managerId}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        alert(`✅ Manager ${managerName} deleted successfully!`);
        await fetchAllData();
    } catch (error) {
        console.error("Delete failed:", error.response?.data || error.message);
        alert(error.response?.data?.detail || "Failed to delete manager. Reassign linked DPs/Orders first.");
    } finally {
        setLoading(false);
    }
};

// --- MOVE DELIVERY PARTNER HANDLER (Uses the new API) ---
// --- MOVE DELIVERY PARTNER HANDLER (FIXED URL) ---
const handleMoveDPSubmit = async (dpId, newManagerId) => {
    const token = accessToken || localStorage.getItem("auth_token");
    setLoading(true);

    try {
        // ⭐ CRITICAL FIX: Removed the redundant "/partners" segment.
        // The path now correctly starts with the router prefix: /partners/superadmin/...
        await axios.patch(
            `${API_BASE_URL}/partners/partners/superadmin/move-dp/${dpId}/to-manager/${newManagerId}`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
        );

        const action = newManagerId === 0 ? "unassigned" : "reassigned";
        alert(`✅ Delivery Partner successfully ${action}!`);

        setIsReassignModalVisible(false);
        setDpToReassign(null);
        await fetchAllData(); // Refresh data to update lists and team sizes
    } catch (error) {
        console.error("Move failed:", error.response?.data || error.message);
        alert(error.response?.data?.detail || "Failed to move DP.");
    } finally {
        setLoading(false);
    }
};

const handleLinkSubmit = async (dpId, managerId) => {
        const token = accessToken || localStorage.getItem("auth_token");
        setLoading(true);
        try {
            // NOTE: Verified endpoint uses partners/partners/superadmin/delivery-partners/
            await axios.patch(
                `${API_BASE_URL}/partners/partners/superadmin/delivery-partners/${dpId}/assign-manager/${managerId}`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            alert("✅ Delivery Partner linked successfully!");

            // Close modal + reset
            setIsDPLinkingModalVisible(false);
            setManagerToLink(null);
            setSelectedDPId("");

            // This correctly fetches the new assignments for both DMs and DPs:
            await fetchAllData();
        } catch (error) {
            console.error("Linking failed:", error.response?.data || error.message);
            alert(error.response?.data?.detail || "Failed to link partner.");
        } finally {
            setLoading(false);
        }
    };

  const handleManagerCardClick = async (manager) => {
    const managerKey = String(manager.managerId);

    if (expandedManager === managerKey) {
      setExpandedManager(null);
      setExpandedOrderType(null);
      return;
    }

    setExpandedManager(managerKey);
    setExpandedOrderType(null);
    await fetchOrdersByManager(manager.managerId, 1);
  };

  const loadFreeManagerStores = async () => {
    if (freeManagerStoresLoaded) return;
    const token = accessToken || localStorage.getItem("auth_token") || localStorage.getItem("userToken") || localStorage.getItem("partner_token");
    if (!token) return;
    const response = await axios.get(`${API_BASE_URL}/store/store/list/all`, { headers: { Authorization: `Bearer ${token}` } });
    const payload = response.data;
    const stores = Array.isArray(payload) ? payload : (payload?.stores || payload?.items || payload?.data || []);
    setFreeManagerStores(stores.filter((store) => store.assigned_manager_id === null));
    setFreeManagerStoresLoaded(true);
  };


  const handleTabChange = async (tab) => {
    if (isEmployeeRole && ["deliveryManager", "deliveryManagers", "deliveryAreaManager"].includes(tab) && (hasPermission("delivery_manager.assign_store") || hasPermission("delivery_manager.edit"))) {
      await loadFreeManagerStores();
    }
    if (!isEmployeeRole && tab === "orders" && !ordersLoaded) {
      await fetchAllOrders(1);
      await fetchOrders();
      setOrdersLoaded(true);
    }

    setCurrentTab(tab);
  };

  const handleSelectTab = async (tabName) => {
    await handleTabChange(tabName);

    // 🚀 Auto-fetch data when QR tab opens
    if (!isEmployeeRole && ["qr", "qrManagement", "bottles"].includes(tabName)) {
      fetchQrData(); // ✅ Call the main QR fetch function
    }
  };

  // Add this function outside of renderDashboard/renderOrders
const renderManualAssignmentOrders = () => {
  const manualList = manualAssignmentOrders;

  if (manualList.length === 0) {
    return null;
  }

  return (
    <div style={{ ...styles.tableCard, marginBottom: 30 }}>
      <h3
        style={{
          ...styles.cardTitle,
          background: "#E3F2FD",
          borderLeft: "5px solid #1565C0",
          paddingLeft: "15px",
        }}
      >
        🚛 Orders Needing Delivery Manager Assignment ({manualList.length})
      </h3>

      <table style={styles.dataTable}>
        <thead>
          <tr style={{ ...styles.tableHeaderRow, backgroundColor: "#1565C0" }}>
            <th style={styles.tableHeaderCell}>Order ID</th>
            <th style={styles.tableHeaderCell}>Store/City</th>
            <th style={styles.tableHeaderCell}>Bottles</th>
            <th style={styles.tableHeaderCell}>Date</th>
            <th style={styles.tableHeaderCell}>Action</th>
          </tr>
        </thead>

        <tbody>
          {manualList.map((order) => (
            <tr key={order.id} style={styles.tableRow}>
              <td style={styles.tableCell}>#{order.id}</td>
              <td style={styles.tableCell}>
                {order.customerName} ({order.channel})
              </td>
              <td style={styles.tableCell}>{order.bottles}</td>
              <td style={styles.tableCell}>
                {order.orderDate?.toLocaleDateString?.() || "-"}
              </td>

              <td style={styles.tableCell}>
                {/* ✅ UPDATED: Disabled Assign DM Button */}
                {hasPermission(PERMISSIONS.ORDERS_ASSIGN) && <button 
                  style={{
                    ...styles.actionButton,
                    backgroundColor: "#9E9E9E",
                    cursor: "not-allowed",
                    opacity: 0.7,
                  }}
                  disabled={true}
                  onClick={() => {}}
                  title="Manual routing disabled for now"
                >
                  Assign Delivery Manager
                </button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ✅ Extra note below table */}
      <p style={{ marginTop: 12, color: "#777", fontSize: "13px" }}>
        ⚠️ Delivery Manager assignment feature will be enabled soon.
      </p>
    </div>
  );
};

  const renderEmployeeDashboard = () => {
    const employeeDashboard = dashboard.employee || {};
    if (Number(dashboard.assigned_store_count || 0) === 0) {
      return <div style={styles.contentArea}><div style={styles.chartCard}><p style={styles.noDataText}>No stores assigned.</p></div></div>;
    }
    return (
      <div style={styles.contentArea}>
        <div style={styles.kpiRow}>
          <StatCard label="Total Orders" value={(employeeDashboard.total_orders ?? 0).toString()} icon="📦" bgColor="#E0F2F1" textColor="#00796B" onPress={() => handleSelectTab("orders")} />
          <StatCard label="Pending Orders" value={(employeeDashboard.pending_orders ?? 0).toString()} icon="⏰" bgColor="#FFF3E0" textColor="#EF6C00" onPress={() => handleSelectTab("orders")} />
          <StatCard label="Completed Orders" value={(employeeDashboard.completed_orders ?? 0).toString()} icon="✅" bgColor="#D4EDDA" textColor="#155724" onPress={() => handleSelectTab("orders")} />
        </div>
        <div style={styles.kpiRow}>
          <StatCard label="Cancelled Orders" value={(employeeDashboard.cancelled_orders ?? 0).toString()} icon="✖" bgColor="#FFEBEE" textColor="#D32F2F" onPress={() => handleSelectTab("orders")} />
          <StatCard label="Total Stores" value={(employeeDashboard.total_stores ?? 0).toString()} icon="🏬" bgColor="#E8F5E9" textColor="#388E3C" onPress={() => handleSelectTab("activeStoresList")} />
          <StatCard label="Complaints" value={(employeeDashboard.complaints ?? 0).toString()} icon="🚨" bgColor="#FFEBEE" textColor="#D32F2F" onPress={() => handleSelectTab("complaints")} />
          <StatCard label="Bottles" value={(employeeDashboard.bottles ?? 0).toLocaleString("en-IN")} icon="💧" bgColor="#E3F2FD" textColor="#1565C0" onPress={() => handleSelectTab("qrManagement")} />
        </div>
        <div style={styles.mainContentGrid}>
          <div style={styles.chartCard}><h3 style={styles.cardTitle}>Sales Performance</h3><MonthlyPerformanceChart data={[]} /></div>
          <div style={styles.activityCard}><h3 style={styles.cardTitle}>Recent Activity</h3><div style={styles.activityList}>
            {allOrders.length ? allOrders.slice(0, 5).map((order) => <div key={order.id} style={styles.activityItem}><div style={styles.activityText}>Order <span style={styles.activityOrderId}>#{order.id}</span> by <span style={styles.activityCustomerName}>{order.customerName}</span></div><span style={{ ...styles.activityStatusBadge, backgroundColor: order.status === "Delivered" ? "#4CAF50" : order.status === "Accepted" ? "#2196F3" : "#FF9800" }}>{order.status}</span></div>) : <p style={styles.noDataText}>No recent activity.</p>}
          </div></div>
        </div>
      </div>
    );
  };

  const renderDashboard = () => isEmployeeRole ? renderEmployeeDashboard() : (
    <div style={styles.contentArea}>
      <div style={styles.kpiRow}>
        <StatCard 
          label="Total Orders" 
          value={(dashboard.orders?.total ?? 0).toString()}
          icon="📦" 
          bgColor="#E0F2F1" 
          textColor="#00796B" 
          onPress={() => handleSelectTab('orders')} 
        />
        {/* ⭐ NEW KPI CARD FOR MANUAL ASSIGNMENT (Routing Failures) ⭐ */}
        <StatCard 
          label="Manual Assignment Required" 
          value={(dashboard.orders?.manual_assignment ?? 0).toString()}
          icon="⚠️" 
          bgColor="#FFEBEE" 
          textColor="#D32F2F" 
          onPress={() => handleSelectTab('orders')} 
        />
        
        {/* Updated label for clarity: These are pending approval, not routing failures */}
        <StatCard 
          label="Pending Orders (Approval)" 
          value={(dashboard.orders?.pending ?? 0).toString()}
          icon="⏰" 
          bgColor="#FFF3E0" 
          textColor="#EF6C00" 
          onPress={() => handleSelectTab('orders')} 
        />
        
        <StatCard 
          label="New Complaints" 
          value={(dashboard.complaints?.pending ?? 0).toString()}
          icon="🚨" 
          bgColor="#FFEBEE" 
          textColor="#D32F2F" 
          onPress={() => handleSelectTab('complaints')} 
        />
        </div>

      <div style={styles.kpiRow}>
        <StatCard 
          label="Fresh Bottles in Warehouse" 
          value={(dashboard.bottles?.warehouse ?? 0).toLocaleString()} 
          icon="💧" 
          bgColor="#E3F2FD" 
          textColor="#1565C0" 
          onPress={() => handleSelectTab('qrManagement')} 
        />
        <StatCard 
          label="Empty Bottles at Stores" 
          value={(dashboard.bottles?.at_store ?? 0).toLocaleString()} 
          icon="♻️" 
          bgColor="#FBEFF3" 
          textColor="#AD1457" 
          onPress={() => handleSelectTab('activeStoresList')} 
        />
        <StatCard 
          label="Total Store Managers" 
          value={(dashboard.users?.partners ?? 0).toString()} 
          icon="🤝" 
          bgColor="#E8F5E9" 
          textColor="#388E3C" 
          onPress={() => handleSelectTab('myPartners')} 
        />
        <StatCard 
          label="Total Delivery Partners" 
          value={(dashboard.users?.delivery_partners ?? 0).toString()} 
          icon="🚚" 
          bgColor="#EDE7F6" 
          textColor="#512DA8" 
          onPress={() => handleSelectTab('deliveryPartners')} 
        />
        </div>

      <div style={styles.mainContentGrid}>
        <div style={styles.chartCard}>
          <h3 style={styles.cardTitle}>Sales Performance</h3>
          {/* 🟢 CHART INTEGRATION 🟢 */}
            <MonthlyPerformanceChart data={getMonthlyOrderData} />
        </div>

        <div style={styles.activityCard}>
          <h3 style={styles.cardTitle}>Recent Activity</h3>
          <div style={styles.activityList}>
            {allOrders.slice(0, 5).map((order) => (
              <div key={order.id} style={styles.activityItem}>
                <div style={styles.activityText}>
                  Order <span style={styles.activityOrderId}>#{order.id}</span> by <span style={styles.activityCustomerName}>{order.customerName}</span>
                </div>
                <span style={{
                  ...styles.activityStatusBadge, 
                  backgroundColor: order.status === 'Delivered' ? '#4CAF50' : 
                                   order.status === 'Accepted' ? '#2196F3' : '#FF9800'
                }}>
                  {order.status}
                </span>
              </div>
            ))}
            </div>
        </div>
      </div>

      <div style={styles.kpiRow}>
        <StatCard 
          label="Active Stores" 
          value={(dashboard.stores?.total ?? 0).toString()} 
          icon="🏬" 
          bgColor="#E8F5E9" 
          textColor="#388E3C" 
          onPress={() => handleSelectTab('activeStoresList')} 
        />
        <StatCard 
          label="Total Orders Today" 
          value={(dashboard.orders?.today ?? 0).toString()} 
          icon="📅" 
          bgColor="#F0F4C3" 
          textColor="#9E9D24" 
          onPress={() => handleSelectTab('orders')} 
        />
        <StatCard 
          label="Total Orders This Month" 
          value={monthlyOrdersCount.toString()} 
          icon="📈" 
          bgColor="#E1F5FE" 
          textColor="#0277BD" 
          onPress={() => handleSelectTab('orders')} 
        />
        <StatCard 
          label="Delivered Orders Today" 
          value={(dashboard.orders?.delivered_today ?? 0).toString()} 
          icon="✅" 
          bgColor="#D4EDDA" 
          textColor="#155724" 
          onPress={() => handleSelectTab('orders')} 
        />
        <StatCard 
          label="Delivered Orders This Month" 
          value={monthlyDeliveredOrders.toString()} 
          icon="✔️" 
          bgColor="#CBE3F9" 
          textColor="#1E40AF" 
          onPress={() => handleSelectTab('orders')} 
        />
        </div>
    </div>
);


  // In SuperAdminDashboard.jsx (around line 820)

// ... Assuming the renderManualAssignmentOrders function is defined elsewhere in the file ...

const renderOrders = () => {
    if (loading) {
        return <p style={styles.loadingText}>Loading orders...</p>;
    }

  const managersForCurrentFilters = ordersSummaryManagers.filter((manager) => {
    const supplierMatch =
      supplierFilter === "ALL" ||
      String(manager.managerName || "").toLowerCase() === String(supplierFilter || "").toLowerCase();

    const channelMatch =
      supplierChannelFilter === "ALL" ||
      String(manager.channel || "").toUpperCase() === String(supplierChannelFilter || "").toUpperCase();

    return supplierMatch && channelMatch;
  });

  const managerScopedOrders = managersForCurrentFilters.flatMap((manager) => {
    const managerKey = String(manager.managerId);
    const stores = ordersStoresByManagerId[managerKey] || [];

    return stores.flatMap((store) => {
      const storeIdKey = String(store.storeId);
      const storeOrdersFromCache = ordersByStoreId[storeIdKey] || [];
      const storeOrdersFromManagerPayload = store.orders || [];

      return storeOrdersFromCache.length > 0
        ? storeOrdersFromCache
        : storeOrdersFromManagerPayload;
    });
  });

  const normalizedOrderSearch = String(search || "").trim().toLowerCase();

  const filteredAndSearchedOrders = managerScopedOrders.filter((order) => {
    if (!normalizedOrderSearch) return true;
    return String(order.storeName || "").toLowerCase().includes(normalizedOrderSearch);
  });

  const normalOrdersBadgeCount = Number(totalOrders) || 0;

    // --- ⭐ Escalation Logic (Orders > 2 days and NOT Delivered) ---
  const escalationOrders = filteredAndSearchedOrders.filter(o => {

    if (o.status?.toLowerCase() === 'delivered')
      return false;

    const daysDiff =
      Math.floor(
        (new Date() - new Date(o.orderDate))
        /
        (1000 * 60 * 60 * 24)
      );

    return daysDiff >= 2 && daysDiff <= 20;
  });

    // Grouping by Store for Escalation View
    

    // 2. Grouping by Channel (for normal view)
    const ordersByChannel = allOrders.reduce((acc, order) => {
        const ch = order?.channel ? order.channel.toUpperCase() : "GENERAL";
        if (!acc[ch]) acc[ch] = [];
        acc[ch].push(order);
        return acc;
    }, {});

    const channels = Object.keys(ordersByChannel).sort();

    const orderGridStyles = {
        gridContainer: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "20px",
            width: "100%",
            padding: "10px",
        },
        card: {
            background: "#fff",
            border: "1px solid #E0E0E0",
            borderRadius: "12px",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 4px 6px rgba(0,0,0,0.05)",
            transition: "transform 0.2s ease",
        },
        title: { fontSize: "17px", fontWeight: "700", marginBottom: "10px", color: "#1565C0", borderBottom: "1px solid #eee", paddingBottom: "5px" },
        sub: { fontSize: "13px", margin: "4px 0", color: "#333", display: "flex", justifyContent: "space-between" },
        label: { fontWeight: "600", color: "#666" },
        value: { fontWeight: "500", textAlign: "right" },
        statusBadge: {
            padding: "4px 10px",
            borderRadius: "15px",
            color: "#fff",
            fontSize: "11px",
            fontWeight: "700",
            textTransform: "uppercase"
        }
    };

    const renderOrderCard = (o) => (
        <div key={o.id} style={orderGridStyles.card} onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-3px)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
            <div style={orderGridStyles.title}>Order #{o.id}</div>
            <div style={orderGridStyles.sub}>
                <span style={orderGridStyles.label}>Store:</span>
                <span style={orderGridStyles.value}>{o.storeName || o.customerName || 'N/A'}</span>
            </div>
            <div style={orderGridStyles.sub}>
                <span style={orderGridStyles.label}>Ordered By:</span>
                <span style={orderGridStyles.value}>{o.partnerName || 'N/A'}</span>
            </div>
            <div style={orderGridStyles.sub}>
                <span style={orderGridStyles.label}>Order Date:</span>
                <span style={orderGridStyles.value}>{o.formattedOrderDate || (o.orderDate && new Date(o.orderDate).toLocaleDateString()) || 'N/A'}</span>
            </div>
            <hr style={{ border: "0.5px solid #f0f0f0", margin: "10px 0" }} />
            <div style={orderGridStyles.sub}>
                <span style={orderGridStyles.label}>Bottles (Req/Del):</span>
                <span style={orderGridStyles.value}>
                    <b>{o.bottles}</b> / <b style={{color: '#2E7D32'}}>{o.deliveredBottles || 0}</b>
                </span>
            </div>
            <div style={orderGridStyles.sub}>
                <span style={orderGridStyles.label}>Status:</span>
                <span style={{ 
                    ...orderGridStyles.statusBadge, 
                    backgroundColor: o.status === 'Delivered' ? '#4CAF50' : (o.status === 'Pending' ? '#FF9800' : '#2196F3') 
                }}>
                    {o.status}
                </span>
            </div>
            <div style={orderGridStyles.sub}>
                <span style={orderGridStyles.label}>Delivery By:</span>
                <span style={{ ...orderGridStyles.value, color: "#1565C0" }}>
                    {o.deliveryPartnerName || "Unassigned"}
                </span>
            </div>
            <div style={orderGridStyles.sub}>
                <span style={orderGridStyles.label}>Manager:</span>
                <span style={{ ...orderGridStyles.value, color: "#2E7D32" }}>
                    {o.assignedManager || "Not Assigned"}
                </span>
            </div>
            {o.deliveryPhoto && (
                <div style={{...orderGridStyles.sub, marginTop: "8px", paddingTop: "8px", borderTop: "1px dashed #eee"}}>
                     <span style={orderGridStyles.label}>Proof:</span>
                     <span 
                        onClick={() => openImageModal(o.deliveryPhoto)}
                        style={{ color: '#1565C0', cursor: 'pointer', textDecoration: 'underline', fontSize: '12px' }}
                     >
                        👁️ View Proof
                     </span>
                </div>
            )}
        </div>
    );

    return (
        <div style={styles.contentArea}>
            {/* 🔝 TOP SUB-TAB SWITCHER */}
            <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
                <button 
                    onClick={() => {
                      setOrderSubTab("all");
                      fetchAllOrders(1);
                    }}
                    style={{ flex: 1, padding: '12px', cursor: 'pointer', borderRadius: '10px', border: 'none', fontWeight: '800', backgroundColor: orderSubTab === 'all' ? '#1565C0' : '#FFF', color: orderSubTab === 'all' ? '#FFF' : '#666', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                >
                  📋 Normal Orders ({normalOrdersBadgeCount})
                </button>
                <button 
                    onClick={() => setOrderSubTab("escalation")}
                    style={{ flex: 1, padding: '12px', cursor: 'pointer', borderRadius: '10px', border: 'none', fontWeight: '800', backgroundColor: orderSubTab === 'escalation' ? '#D32F2F' : '#FFF', color: orderSubTab === 'escalation' ? '#FFF' : '#666', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                >
                    🏢 Supplier Order Details ({escalationOrders.length})
                </button>
            </div>

            {/* 🔍 FILTER & SEARCH HEADER */}
            <div style={{ 
                display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '25px', backgroundColor: '#fff', padding: '15px 20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}>
                <select 
                    value={quickFilter} 
                  onChange={(e) => { setQuickFilter(e.target.value); setStartDate(''); setEndDate(''); setCurrentPage(1); }}
                    style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '14px', fontWeight: '600', color: '#1565C0' }}
                >
                    <option value="ALL">All Time</option>
                    <option value="YESTERDAY">Yesterday</option>
                    <option value="LAST_7">Last 7 Days</option>
                    <option value="LAST_15">Last 15 Days</option>
                    <option value="CURRENT_MONTH">Current Month</option>
                </select>

                <input type="date" value={startDate} onChange={(e) => {setStartDate(e.target.value); setQuickFilter("ALL"); setCurrentPage(1);}} style={{ padding: '7px', borderRadius: '6px', border: '1px solid #ccc' }} />
                <input type="date" value={endDate} onChange={(e) => {setEndDate(e.target.value); setQuickFilter("ALL"); setCurrentPage(1);}} style={{ padding: '7px', borderRadius: '6px', border: '1px solid #ccc' }} />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #ccc'
            }}
          >
            <option value="ALL">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="DELIVERED">Delivered</option>
          </select>
                <input
                    placeholder="Search store name..."
                    value={search}
                  onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                    style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc', width: '200px', flex: 1 }}
                />

          <button
            onClick={() => {
              // Existing filters
              setStatusFilter("ALL");
              setSearch("");
              setStartDate("");
              setEndDate("");
              setQuickFilter("ALL");
              setCurrentPage(1);

              // New supplier filters
              setSupplierChannelFilter("ALL");
              setSupplierFilter("ALL");
            }}
            style={styles.secondaryButton}
          >
            Reset
          </button>
          <select
            value={supplierChannelFilter}
            onChange={(e) => { setSupplierChannelFilter(e.target.value); setCurrentPage(1); }}
            style={styles.filterSelect}
          >
            <option value="ALL">All Channels</option>
            {supplierChannelOptions.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>

          <select
            value={supplierFilter}
            onChange={(e) => { setSupplierFilter(e.target.value); setCurrentPage(1); }}
            style={styles.filterSelect}
          >
            <option value="ALL">All Suppliers</option>
            {supplierOptions.map((supplier) => (
              <option key={supplier} value={supplier}>
                {supplier}
              </option>
            ))}
          </select>

                {/* ⭐ SEPARATED APPLY & EXPORT BUTTONS */}
                <button 
                    onClick={() => {
                      if (orderSubTab === "all") {
                        fetchAllOrders(1);
                        return;
                      }

                      const managerFromFilter = supplierFilter !== "ALL"
                        ? ordersSummaryManagers.find(
                            m => String(m.managerName || "").toLowerCase() === String(supplierFilter).toLowerCase()
                          )
                        : null;

                      if (managerFromFilter?.managerId) {
                        const managerKey = String(managerFromFilter.managerId);
                        setSelectedOrdersManagerId(managerFromFilter.managerId);
                        setSelectedOrdersStoreId(null);
                        setExpandedManager(managerKey);
                        setExpandedOrderType(null);
                        fetchOrdersByManager(managerFromFilter.managerId, 1);
                        return;
                      }

                      if (selectedOrdersManagerId) {
                        setSelectedOrdersStoreId(null);
                        setExpandedManager(String(selectedOrdersManagerId));
                        setExpandedOrderType(null);
                        fetchOrdersByManager(selectedOrdersManagerId, 1);
                        return;
                      }

                      fetchOrders();
                    }}
                    style={{ padding: '8px 20px', backgroundColor: '#2196F3', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                    Apply Filter
                </button>

                <button 
                    style={{ ...styles.button, backgroundColor: '#1565C0', padding: '8px 15px', width: 'auto', margin: 0, fontSize: '14px' }} 
                    onClick={handleExportOrdersToExcel}
                >
                    📥 EXPORT CSV
                </button>
            </div>

        {hasPermission(PERMISSIONS.REPORTS_EXPORT) && <button
          onClick={handleExportSupplierHierarchyToExcel}
          style={{
            ...styles.filterButton,
            backgroundColor: "#16a34a",
            marginLeft: "10px"
          }}
        >
          📥 Export Supplier Report
        </button>}

            {/* 📊 CONTENT VIEW */}
          {orderSubTab === 'all' ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "25px" }}>
                    {channels.length > 0 ? (
                        channels.map(ch => (
                            <CollapsibleChannelSection key={ch} title={`Channel: ${ch}`} totalCount={ordersByChannel[ch].length} defaultOpen={true}>
                                <div style={orderGridStyles.gridContainer}>
                                    {ordersByChannel[ch].map(o => renderOrderCard(o))}
                                </div>
                            </CollapsibleChannelSection>
                        ))
                    ) : (
                        <div style={{ textAlign: 'center', padding: '50px', background: '#fff', borderRadius: '12px' }}>
                            <p style={{ color: '#888' }}>No orders found matching your filters.</p>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                      <button
                        onClick={() => fetchAllOrders(Math.max(1, currentPage - 1))}
                        disabled={currentPage <= 1 || ordersLoading}
                        style={{ ...styles.secondaryButton, opacity: (currentPage <= 1 || ordersLoading) ? 0.6 : 1 }}
                      >
                        Previous
                      </button>

                      <span style={{ fontWeight: '700', color: '#334155' }}>
                        Page {currentPage} of {totalPages}
                      </span>

                      <button
                        onClick={() => fetchAllOrders(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage >= totalPages || ordersLoading}
                        style={{ ...styles.secondaryButton, opacity: (currentPage >= totalPages || ordersLoading) ? 0.6 : 1 }}
                      >
                        Next
                      </button>
                    </div>
                </div>
            ) : (
                /* ⭐ ESCALATION VIEW (Collapsible Store Rows) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

    {managersForCurrentFilters.length > 0 ? (

      managersForCurrentFilters.map((manager) => {

            const managerKey = String(manager.managerId);
            const managerOpen =
              expandedManager === managerKey;
            const managerCurrentPage =
              ordersManagerPageById[managerKey] || 1;
            const managerTotalPages =
              ordersManagerTotalPagesById[managerKey] || 1;
            const managerStores =
              (ordersStoresByManagerId[managerKey] || [])
                .filter(store => {
                  if (supplierChannelFilter === "ALL") return true;
                  return String(store.channel || "").toUpperCase() === String(supplierChannelFilter).toUpperCase();
                })
                .map(store => {
                  const cachedOrders = ordersByStoreId[String(store.storeId)] || [];
                  const sourceOrders = cachedOrders.length > 0 ? cachedOrders : (store.orders || []);
                  const pendingOrders = sourceOrders.filter(o => !String(o.status || "").toLowerCase().includes("delivered"));
                  const deliveredOrders = sourceOrders.filter(o => String(o.status || "").toLowerCase().includes("delivered"));

                  return {
                    ...store,
                    pendingOrders,
                    deliveredOrders,
                  };
                })
                .sort((a, b) => (b.pendingCount ?? b.pendingOrders.length) - (a.pendingCount ?? a.pendingOrders.length));

            return (

                <div
                    key={managerKey}
                    style={{
                        background: '#fff',
                        borderRadius: '14px',
                        overflow: 'hidden',
                        border: '1px solid #eee',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                    }}
                >

                    {/* MANAGER HEADER */}

                    <div
    onClick={() => handleManagerCardClick(manager)}
    style={{
        padding: '18px 22px',
        cursor: 'pointer',
        background: '#f8fafc',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    }}
>

                  {/* LEFT SECTION */}
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: '18px'
                      }}
                    >
                      👨‍💼 {manager.managerName}
                    </h3>

                    {/* FILTERED STATS */}
                    <div
                      style={{
                        display: 'flex',
                        gap: '10px',
                        marginTop: '10px',
                        flexWrap: 'wrap'
                      }}
                    >
                      <div
                        style={{
                          background: '#eff6ff',
                          color: '#2563eb',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontWeight: '700',
                          fontSize: '12px'
                        }}
                      >
                        Total Orders:{' '}
                        {manager.totalOrders ||
                          ((manager.totalPending || 0) +
                            (manager.totalDelivered || 0))}
                      </div>

                      <div
                        style={{
                          background: '#fee2e2',
                          color: '#dc2626',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontWeight: '700',
                          fontSize: '12px'
                        }}
                      >
                        Pending:{' '}
                        {manager.totalPending || 0}
                      </div>

                      <div
                        style={{
                          background: '#dcfce7',
                          color: '#16a34a',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontWeight: '700',
                          fontSize: '12px'
                        }}
                      >
                        Delivered:{' '}
                        {manager.totalDelivered || 0}
                      </div>
                    </div>

                    {/* STORE COUNT */}
                    <div
                      style={{
                        marginTop: '8px',
                        fontSize: '13px',
                        color: '#666'
                      }}
                    >
                      Stores:{' '}
                      {manager.storesCount || 0}
                    </div>
                  </div>

                  {/* RIGHT SECTION */}
                  <div
                    style={{
                      display: 'flex',
                      gap: '10px'
                    }}
                  >
                    <div
                      style={{
                        background: '#fee2e2',
                        color: '#dc2626',
                        padding: '8px 14px',
                        borderRadius: '10px',
                        fontWeight: '700'
                      }}
                    >
                      Pending:{' '}
                      {manager.totalPending || 0}
                    </div>

                    <div
                      style={{
                        background: '#dcfce7',
                        color: '#16a34a',
                        padding: '8px 14px',
                        borderRadius: '10px',
                        fontWeight: '700'
                      }}
                    >
                      Delivered:{' '}
                      {manager.totalDelivered || 0}
                    </div>
                  </div>

                </div>

                    {/* STORES */}

                    {managerOpen && (

                        <div style={{
                            padding: '16px',
                            background: '#fafafa'
                        }}>

                            {managerStores
                              .map((store) => {

                                    const storeKey =
                                  `${managerKey}-${store.storeName}`;

                                  const pendingOpen =
                                    expandedOrderType === `${storeKey}-pending`;

                                  const deliveredOpen =
                                    expandedOrderType === `${storeKey}-delivered`;

                                    return (

                                        <div
                                            key={storeKey}
                                            style={{
                                                background: '#fff',
                                                borderRadius: '12px',
                                                marginBottom: '14px',
                                                border: '1px solid #eee',
                                                overflow: 'hidden'
                                            }}
                                        >

                                            {/* STORE HEADER */}

                                            <div
                                                
                                                style={{
                                                    padding: '16px 18px',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center'
                                                }}
                                            >

                                                <h4 style={{
                                                    margin: 0
                                                }}>
                                                    🏪 {store.storeName}
                                                </h4>

                                                <div style={{
                                                    display: 'flex',
                                                    gap: '10px'
                                                }}>

                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();

                                                            const nextTab =
                                                              expandedOrderType === `${storeKey}-pending`
                                                                ? null
                                                                : `${storeKey}-pending`;

                                                            setExpandedOrderType(nextTab);

                                                            if (nextTab && store.storeId) {
                                                              fetchOrdersByStore(store.storeId, 1);
                                                            }
                                                        }}
                                                        style={{
                                                            border: 'none',
                                                            background: '#fee2e2',
                                                            color: '#dc2626',
                                                            padding: '8px 12px',
                                                            borderRadius: '8px',
                                                            fontWeight: '700',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Pending:
                                                        {' '}
                                                      {store.pendingCount ?? store.pendingOrders.length}
                                                    </button>

                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();

                                                            const nextTab =
                                                              expandedOrderType === `${storeKey}-delivered`
                                                                ? null
                                                                : `${storeKey}-delivered`;

                                                            setExpandedOrderType(nextTab);

                                                            if (nextTab && store.storeId) {
                                                              fetchOrdersByStore(store.storeId, 1);
                                                            }
                                                        }}
                                                        style={{
                                                            border: 'none',
                                                            background: '#dcfce7',
                                                            color: '#16a34a',
                                                            padding: '8px 12px',
                                                            borderRadius: '8px',
                                                            fontWeight: '700',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Delivered:
                                                        {' '}
                                                      {store.deliveredCount ?? store.deliveredOrders.length}
                                                    </button>

                                                </div>

                                            </div>

                                            {/* ORDERS */}

                                            {(pendingOpen || deliveredOpen) && (

                                                <div style={{
                                                    padding: '16px',
                                                    background: '#fafafa'
                                                }}>

                                                    {pendingOpen
                                                        && (

                                                            <div style={{
                                                                display: 'grid',
                                                                gridTemplateColumns:
                                                                    'repeat(auto-fill,minmax(240px,1fr))',
                                                                gap: '14px'
                                                            }}>

                                                                {store.pendingOrders.map(order => {

                                                                    const delay =
                                                                        Math.floor(
                                                                            (new Date() -
                                                                                new Date(order.orderDate))
                                                                            /
                                                                            (1000 * 60 * 60 * 24)
                                                                        );

                                                                    return (

                                                                      <div
                                                                        key={order.id}
                                                                        onClick={() => openSupplierDeliveryModal(order)}
                                                                        style={{
                                                                          background: '#fff7ed',
                                                                          border: '1px solid #fdba74',
                                                                          borderRadius: '12px',
                                                                          padding: '14px',
                                                                          cursor: 'pointer',
                                                                          transition: 'all 0.2s ease',
                                                                          boxShadow: '0 2px 6px rgba(0,0,0,0.05)'
                                                                        }}
                                                                        onMouseEnter={(e) => {
                                                                          e.currentTarget.style.transform = 'translateY(-2px)';
                                                                          e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.10)';
                                                                        }}
                                                                        onMouseLeave={(e) => {
                                                                          e.currentTarget.style.transform = 'translateY(0)';
                                                                          e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.05)';
                                                                        }}
                                                                      >
                                                                        <div
                                                                          style={{
                                                                            fontWeight: '800',
                                                                            color: '#ea580c'
                                                                          }}
                                                                        >
                                                                          ORDER #{order.id}
                                                                        </div>

                                                                        <div
                                                                          style={{
                                                                            marginTop: '10px',
                                                                            fontWeight: '700'
                                                                          }}
                                                                        >
                                                                          ⚠ Delay: {delay} Days
                                                                        </div>

                                                                        <div
                                                                          style={{
                                                                            marginTop: '8px',
                                                                            fontSize: '12px',
                                                                            color: '#666'
                                                                          }}
                                                                        >
                                                                          Placed: {new Date(order.orderDate).toLocaleDateString()}
                                                                        </div>

                                                                        <div
                                                                          style={{
                                                                            marginTop: '10px',
                                                                            fontSize: '11px',
                                                                            color: '#2563eb',
                                                                            fontWeight: '700'
                                                                          }}
                                                                        >
                                                                          👆 Click to View Details & Mark Delivered
                                                                        </div>
                                                                      </div>
                                                                    );
                                                                })}

                                                            </div>
                                                        )}

                                                    {deliveredOpen 
                                                        && (

                                                            <div style={{
                                                                display: 'grid',
                                                                gridTemplateColumns:
                                                                    'repeat(auto-fill,minmax(240px,1fr))',
                                                                gap: '14px'
                                                            }}>

                                                                {store.deliveredOrders.map(order => (

                                                                    <div
                                                                        key={order.id}
                                                                        style={{
                                                                            background: '#f0fdf4',
                                                                            border: '1px solid #86efac',
                                                                            borderRadius: '12px',
                                                                            padding: '14px'
                                                                        }}
                                                                    >

                                                                        <div style={{
                                                                            fontWeight: '800',
                                                                            color: '#16a34a'
                                                                        }}>
                                                                            ORDER #{order.id}
                                                                        </div>

                                                                        <div style={{
                                                                            marginTop: '10px',
                                                                            fontWeight: '700'
                                                                        }}>
                                                                            ✅ Delivered
                                                                        </div>

                                                                        <div style={{
                                                                            marginTop: '8px',
                                                                            fontSize: '12px',
                                                                            color: '#666'
                                                                        }}>
                                                                            Date:
                                                                            {' '}
                                                                            {new Date(order.orderDate).toLocaleDateString()}
                                                                        </div>

                                                                    </div>
                                                                ))}

                                                            </div>
                                                        )}

                                                </div>
                                            )}

                                        </div>
                                    );
                                })}

                                {managerStores.length === 0 && (
                                  <div style={{ textAlign: 'center', padding: '20px', background: '#fff', borderRadius: '10px' }}>
                                    <p style={{ margin: 0, color: '#777' }}>No orders found for this manager.</p>
                                  </div>
                                )}

                                {(() => {
                                  const managerStoreIds = managerStores.map(s => String(s.storeId));
                                  const hasSelectedStoreInManager =
                                    selectedOrdersStoreId &&
                                    managerStoreIds.includes(String(selectedOrdersStoreId));
                                  const storeKey = hasSelectedStoreInManager
                                    ? String(selectedOrdersStoreId)
                                    : null;
                                  const currentPage = storeKey
                                    ? (ordersStorePageById[storeKey] || 1)
                                    : managerCurrentPage;
                                  const totalPages = storeKey
                                    ? (ordersStoreTotalPagesById[storeKey] || 1)
                                    : managerTotalPages;

                                  return (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                                  <button
                                    onClick={() => {
                                      if (storeKey) {
                                        fetchOrdersByStore(storeKey, Math.max(1, currentPage - 1));
                                      } else {
                                        fetchOrdersByManager(manager.managerId, Math.max(1, currentPage - 1));
                                      }
                                    }}
                                    disabled={currentPage <= 1 || ordersLoading}
                                    style={{ ...styles.secondaryButton, opacity: (currentPage <= 1 || ordersLoading) ? 0.6 : 1 }}
                                  >
                                    Previous
                                  </button>

                                  <span style={{ fontWeight: '700', color: '#334155' }}>
                                    Page {currentPage} of {totalPages}
                                  </span>

                                  <button
                                    onClick={() => {
                                      if (storeKey) {
                                        fetchOrdersByStore(storeKey, Math.min(totalPages, currentPage + 1));
                                      } else {
                                        fetchOrdersByManager(manager.managerId, Math.min(totalPages, currentPage + 1));
                                      }
                                    }}
                                    disabled={currentPage >= totalPages || ordersLoading}
                                    style={{ ...styles.secondaryButton, opacity: (currentPage >= totalPages || ordersLoading) ? 0.6 : 1 }}
                                  >
                                    Next
                                  </button>
                                </div>
                                  );
                                })()}

                        </div>
                    )}

                </div>
            );
        })

    ) : (

        <div style={{
            textAlign: 'center',
            padding: '40px',
            background: '#fff',
            borderRadius: '12px'
        }}>
            <p>No escalation orders found.</p>
        </div>
    )}

</div>
            )}


        {/* =====================================================
   SUPPLIER DELIVERY MODAL
   Paste this block inside renderOrders() return,
   just ABOVE or BELOW the preview image modal.
===================================================== */}
        {isSupplierDeliveryModalVisible && selectedSupplierOrder && (
          <div
            onClick={closeSupplierDeliveryModal}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              backgroundColor: "rgba(0,0,0,0.6)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              zIndex: 10000,
              padding: "20px"
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                borderRadius: "16px",
                width: "100%",
                maxWidth: "700px",
                maxHeight: "90vh",
                overflowY: "auto",
                boxShadow: "0 20px 60px rgba(0,0,0,0.25)"
              }}
            >
              {/* HEADER */}
              <div
                style={{
                  padding: "20px 24px",
                  borderBottom: "1px solid #eee",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  position: "sticky",
                  top: 0,
                  background: "#fff",
                  zIndex: 2
                }}
              >
                <div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: "22px",
                      fontWeight: "800",
                      color: "#1565C0"
                    }}
                  >
                    🚚 Mark Order Delivered
                  </h2>
                  <p
                    style={{
                      margin: "6px 0 0 0",
                      color: "#666",
                      fontSize: "14px"
                    }}
                  >
                    Order #{selectedSupplierOrder.id}
                  </p>
                </div>

                <button
                  onClick={closeSupplierDeliveryModal}
                  style={{
                    border: "none",
                    background: "#ef4444",
                    color: "#fff",
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    cursor: "pointer",
                    fontSize: "18px",
                    fontWeight: "700"
                  }}
                >
                  ✕
                </button>
              </div>

              {/* BODY */}
              <div style={{ padding: "24px" }}>
                {/* ORDER SUMMARY */}
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e5e7eb",
                    borderRadius: "12px",
                    padding: "16px",
                    marginBottom: "24px"
                  }}
                >
                  <div style={{ marginBottom: "8px" }}>
                    <strong>🏪 Store:</strong>{" "}
                    {selectedSupplierOrder.storeName ||
                      selectedSupplierOrder.customerName ||
                      "N/A"}
                  </div>

                  <div style={{ marginBottom: "8px" }}>
                    <strong>📦 Bottles Ordered:</strong>{" "}
                    {selectedSupplierOrder.bottles || 0}
                  </div>

                  <div style={{ marginBottom: "8px" }}>
                    <strong>📅 Order Date:</strong>{" "}
                    {selectedSupplierOrder.orderDate
                      ? new Date(
                        selectedSupplierOrder.orderDate
                      ).toLocaleDateString()
                      : "N/A"}
                  </div>

                  <div>
                    <strong>👤 Delivery Partner:</strong>{" "}
                    {selectedSupplierOrder.deliveryPartnerName ||
                      "Unassigned"}
                  </div>
                </div>

                {/* FORM GRID */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "16px"
                  }}
                >
                  {/* Delivery Date */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "6px",
                        fontWeight: "700"
                      }}
                    >
                      📅 Delivery Date
                    </label>
                    <input
                      type="date"
                      value={deliveryDate}
                      onChange={(e) =>
                        setDeliveryDate(e.target.value)
                      }
                      min={
                        selectedSupplierOrder.orderDate
                          ? new Date(
                            selectedSupplierOrder.orderDate
                          )
                            .toISOString()
                            .split("T")[0]
                          : undefined
                      }
                      max={
                        new Date()
                          .toISOString()
                          .split("T")[0]
                      }
                      style={{
                        width: "100%",
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid #d1d5db"
                      }}
                    />
                  </div>

                  {/* Bottles Delivered */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "6px",
                        fontWeight: "700"
                      }}
                    >
                      🧴 Bottles Delivered
                    </label>
                    <input
                      type="number"
                      value={modalBottlesDelivered}
                      onChange={(e) =>
                        setModalBottlesDelivered(
                          e.target.value
                        )
                      }
                      style={{
                        width: "100%",
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid #d1d5db"
                      }}
                    />
                  </div>

                  {/* Empty Bottles */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "6px",
                        fontWeight: "700"
                      }}
                    >
                      ♻️ Empty Bottles Collected
                    </label>
                    <input
                      type="number"
                      value={modalEmptyBottles}
                      onChange={(e) =>
                        setModalEmptyBottles(
                          e.target.value
                        )
                      }
                      style={{
                        width: "100%",
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid #d1d5db"
                      }}
                    />
                  </div>

                  {/* Vehicle Info */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "6px",
                        fontWeight: "700"
                      }}
                    >
                      🚚 Vehicle Info
                    </label>
                    <input
                      type="text"
                      value={modalVehicleInfo}
                      onChange={(e) =>
                        setModalVehicleInfo(
                          e.target.value
                        )
                      }
                      placeholder="e.g. HR26AB1234"
                      style={{
                        width: "100%",
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid #d1d5db"
                      }}
                    />
                  </div>

                  {/* Delivered By */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "6px",
                        fontWeight: "700"
                      }}
                    >
                      👤 Delivered By
                    </label>
                    <input
                      type="text"
                      value={modalDeliveredBy}
                      onChange={(e) =>
                        setModalDeliveredBy(
                          e.target.value
                        )
                      }
                      placeholder="Person name"
                      style={{
                        width: "100%",
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid #d1d5db"
                      }}
                    />
                  </div>

                  {/* Photo Upload */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "6px",
                        fontWeight: "700"
                      }}
                    >
                      📷 Delivery Proof
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) =>
                        setModalPhoto(
                          e.target.files?.[0] || null
                        )
                      }
                      style={{
                        width: "100%",
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid #d1d5db"
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* FOOTER */}
              <div
                style={{
                  padding: "20px 24px",
                  borderTop: "1px solid #eee",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "12px",
                  position: "sticky",
                  bottom: 0,
                  background: "#fff"
                }}
              >
                <button
                  onClick={closeSupplierDeliveryModal}
                  disabled={markingDelivered}
                  style={{
                    padding: "12px 20px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    cursor: "pointer",
                    fontWeight: "700"
                  }}
                >
                  Cancel
                </button>

                <button
                  onClick={handleMarkSupplierOrderDelivered}
                  disabled={markingDelivered}
                  style={{
                    padding: "12px 24px",
                    borderRadius: "8px",
                    border: "none",
                    background: markingDelivered
                      ? "#93c5fd"
                      : "#16a34a",
                    color: "#fff",
                    cursor: markingDelivered
                      ? "not-allowed"
                      : "pointer",
                    fontWeight: "800"
                  }}
                >
                  {markingDelivered
                    ? "Processing..."
                    : "✅ Mark Delivered"}
                </button>
              </div>
            </div>
          </div>
        )}

            {/* PREVIEW IMAGE MODAL (UNCHANGED) */}
            {previewImage && (
                <div onClick={closeImageModal} style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", backgroundColor: "rgba(0,0,0,0.8)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999 }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", maxWidth: "90%", maxHeight: "90%" }}>
                        <button onClick={closeImageModal} style={{ position: "absolute", top: "-40px", right: "0", background: "red", color: "white", border: "none", borderRadius: "50%", width: "35px", height: "35px", fontSize: "18px", cursor: "pointer" }}>✕</button>
                        <img src={previewImage?.startsWith("http") ? previewImage : `${API_BASE_URL}${previewImage}`} alt="Proof" style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: "10px", objectFit: "contain", boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }} />
                    </div>
                </div>
            )}
        </div>
    );
};
  const renderCreatePartner = () => {

  // 1️⃣ Stores filtered by selected channel
  const storesForSelectedChannel = allStores.filter(store =>
    store.channel &&
    store.channel.toUpperCase() === partnerChannel.toUpperCase()
  );

  // 2️⃣ Collect already assigned store IDs
  const assignedStoreIds = new Set();
  partners.forEach(partner => {
    if (partner.stores && Array.isArray(partner.stores)) {
      partner.stores.forEach(store => {
        assignedStoreIds.add(store.id);
      });
    }
  });

  // 3️⃣ FINAL FILTER: channel + unassigned + city
  const unassignedStores = storesForSelectedChannel.filter(store => {
    if (assignedStoreIds.has(store.id)) return false;
    if (storeFilterCity && store.city !== storeFilterCity) return false;
    return true;
  });

  return (
    <div style={styles.contentArea}>
      <h2 style={styles.pageTitle}>Create New Partner</h2>

      <div style={styles.formCard}>
        <form style={styles.form} onSubmit={handleCreatePartner}>

          <input
            style={styles.textInput}
            type="text"
            placeholder="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="tel"
            placeholder="Mobile Number"
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            required
          />

          {/* CHANNEL SELECT */}
          <p style={styles.selectStoresTitle}>Select Channel:</p>
          <select
            style={styles.textInput}
            value={partnerChannel}
            onChange={(e) => {
              setPartnerChannel(e.target.value);
              setSelectedStoreIds([]);
              setStoreFilterCity(""); // reset city when channel changes
            }}
          >
            {ALL_CHANNELS.map(channel => (
              <option key={channel} value={channel}>
                {channel.toUpperCase()}
              </option>
            ))}
          </select>

          {/* CUSTOM CHANNEL INPUT */}
          {partnerChannel === "CUSTOM" && (
            <input
              style={styles.textInput}
              type="text"
              placeholder="Enter Custom Channel Name (e.g., RELIANCE FRESH)"
              value={customChannelName}
              onChange={(e) => setCustomChannelName(e.target.value)}
              required
            />
          )}

          {/* ⭐ CITY FILTER */}
          <p style={styles.selectStoresTitle}>Filter Stores by City:</p>
          <select
            style={styles.textInput}
            value={storeFilterCity}
            onChange={(e) => setStoreFilterCity(e.target.value)}
          >
            <option value="">All Cities</option>
            {availableCities.map(city => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>

          {/* STORE LIST */}
          <p style={styles.selectStoresTitle}>
            Select UNASSIGNED Store(s) for{" "}
            {partnerChannel === "CUSTOM"
              ? (customChannelName.toUpperCase() || "New Channel")
              : partnerChannel}
            :
          </p>

          <div style={styles.storeList}>
            {unassignedStores.length > 0 ? (
              unassignedStores.map(store => (
                <label key={store.id} style={styles.checkboxContainer}>
                  <input
                    type="checkbox"
                    checked={selectedStoreIds.includes(store.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedStoreIds(prev => [...prev, store.id]);
                      } else {
                        setSelectedStoreIds(prev =>
                          prev.filter(id => id !== store.id)
                        );
                      }
                    }}
                  />
                  <span style={styles.checkboxLabel}>
                    {store.store_name} ({store.city})
                  </span>
                </label>
              ))
            ) : (
              <p style={styles.noDataText}>
                {storeFilterCity
                  ? `No unassigned stores found in ${storeFilterCity} for ${partnerChannel}.`
                  : `All stores for ${partnerChannel} are already assigned.`}
              </p>
            )}
          </div>

          <button
            style={{ ...styles.button, ...styles.primaryButton }}
            type="submit"
            disabled={loading || selectedStoreIds.length === 0}
          >
            {loading
              ? "Creating..."
              : `Create Store Manager for ${partnerChannel}`}
          </button>

        </form>
      </div>
    </div>
  );
};

const renderMyPartners = () => {
    // 1. Group partners by channel
    const partnersByChannel = isEmployeeRole ? { employeeStoreManagers: partners } : partners.reduce((acc, partner) => {
        const storeChannel = partner.stores && partner.stores.length > 0
            ? partner.stores[0].channel
            : null;

        const channel = (
            partner.channel ||
            storeChannel ||
            "UNASSIGNED"
        ).toUpperCase();

        if (!acc[channel]) acc[channel] = [];
        acc[channel].push(partner);
        return acc;
    }, {});

    const channels = Object.keys(partnersByChannel).sort();

    // 2. Render each channel section
    const renderPartnerChannel = (partnerList, channelName) => (
        <CollapsibleChannelSection
            key={channelName}
            title={isEmployeeRole ? "Store Managers" : `Channel: ${channelName}`}
            totalCount={partnerList.length}
            defaultOpen={channelName === channels[0]}
        >
            <div style={styles.tableCard}>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={styles.tableHeaderRow}>
                            <th style={styles.tableHeaderCell}>{isEmployeeRole ? "Manager Name" : "Full Name"}</th>
                            <th style={styles.tableHeaderCell}>Email</th>
                            {isEmployeeRole && <th style={styles.tableHeaderCell}>Mobile</th>}
                            {isEmployeeRole && <th style={styles.tableHeaderCell}>Store Count</th>}
                            <th style={styles.tableHeaderCell}>{isEmployeeRole ? "Assigned Stores" : "Stores & IDs"}</th>
                            {!isEmployeeRole && <th style={styles.tableHeaderCell}>Actions</th>}
                        </tr>
                    </thead>

                    <tbody>
                        {partnerList.length > 0 ? (
                            partnerList.map((partner) => {
                                // ⭐ FIX: Using expandedPartnerId to drive the expansion logic
                                const isExpanded = expandedPartnerId === partner.id;
                                
                                return (
                                    <React.Fragment key={partner.id}>
                                        <tr 
                                            style={{ 
                                                ...styles.tableRow, 
                                                cursor: 'pointer',
                                                backgroundColor: isExpanded ? "#F0F7FF" : "#fff",
                                                borderLeft: isExpanded ? "5px solid #00796B" : "5px solid transparent"
                                            }}
                                            onClick={() => handlePartnerRowClick(partner.id)}
                                        >
                                            <td style={styles.tableCell}>{partner.full_name}</td>
                                            <td style={styles.tableCell}>{partner.email}</td>
                                            {isEmployeeRole && <td style={styles.tableCell}>{partner.mobile_number}</td>}
                                            {isEmployeeRole && <td style={styles.tableCell}>{partner.assigned_store_count}</td>}
                                            <td style={styles.tableCell}>
                                                {isEmployeeRole ? (
                                                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                                        {partner.stores.map((store) => (
                                                            <div key={store.id} style={{ padding: "6px 8px", background: "#e3f2fd", borderRadius: "4px", border: "1px solid #bbdefb" }}>
                                                                <strong>{store.store_name}</strong>
                                                                {(store.city || store.channel) && <div style={{ marginTop: "2px", fontSize: "12px", color: "#555" }}>
                                                                    {[store.city, store.channel].filter(Boolean).join(" · ")}
                                                                </div>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : <>
                                                <div style={{ fontWeight: 'bold', color: '#1565C0', marginBottom: '4px' }}>
                                                    {partner.stores?.length || 0} Stores
                                                </div>
                                                {/* ⭐ Added Store ID Display */}
                                                {partner.stores && partner.stores.length > 0 && (
                                                    <div style={{ fontSize: '11px', color: '#555', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                        {partner.stores.map((s) => (
                                                            <span key={s.id} style={{ background: '#e3f2fd', padding: '1px 5px', borderRadius: '3px', border: '1px solid #bbdefb' }}>
                                                                ID: {s.id}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                </>}
                                            </td>

                                            {!isEmployeeRole && <td style={{ ...styles.tableCell, display: "flex", gap: "10px" }}>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handlePartnerRowClick(partner.id);
                                                    }}
                                                    style={{ ...styles.actionButton, backgroundColor: isExpanded ? "#666" : "#00796B" }}
                                                >
                                                    {isExpanded ? "Close" : "Edit Stores"}
                                                </button>
                                                
                                                {/* ⭐ Added Login Edit Button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingManager(partner);
                                                        setEditEmail(partner.email);
                                                        setIsEditManagerModalVisible(true);
                                                    }}
                                                    style={{ ...styles.actionButton, backgroundColor: "#1565C0" }}
                                                >
                                                    Edit Login
                                                </button>

                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeletePartner(partner.id, partner.full_name);
                                                    }}
                                                    style={{ ...styles.actionButton, backgroundColor: "#DC3545" }}
                                                    disabled={loading}
                                                >
                                                    Delete
                                                </button>
                                            </td>}
                                        </tr>

                                        {/* ⭐ EXPANDED SECTION (ASSIGN / REMOVE) ⭐ */}
                                        {!isEmployeeRole && isExpanded && (
                                            <tr style={{ backgroundColor: "#f9f9f9" }}>
                                                <td colSpan="4" style={{ padding: "20px" }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                        
                                                        {/* LEFT: ASSIGN NEW STORES */}
                                                        <div style={{ padding: '15px', background: '#fff', borderRadius: '8px', border: '1px solid #E0E0E0' }}>
                                                            <h4 style={{ marginBottom: '10px', color: '#2E7D32' }}>➕ Assign New Stores</h4>
                                                            <input
                                                                type="text"
                                                                placeholder="🔍 Search available stores..."
                                                                value={partnerStoreAddSearch}
                                                                onChange={(e) => setPartnerStoreAddSearch(e.target.value)}
                                                                style={{ ...styles.textInput, width: '100%', marginBottom: '8px', fontSize: '13px', padding: '8px 10px', boxSizing: 'border-box' }}
                                                            />
                                                            <select
                                                                multiple
                                                                value={selectedPartnerStoreIdsToAdd}
                                                                onChange={(e) => setSelectedPartnerStoreIdsToAdd(Array.from(e.target.selectedOptions).map(opt => String(opt.value)))}
                                                                style={{ ...styles.textInput, height: "120px", width: '100%', marginBottom: '10px' }}
                                                            >
                                                                {allStores
                                                                    .filter(s => !partner.stores.some(ps => ps.id === s.id))
                                                                    .filter(s => {
                                                                        if (!partnerStoreAddSearch) return true;
                                                                        const term = partnerStoreAddSearch.toLowerCase();
                                                                        return (
                                                                            (s.store_name || '').toLowerCase().includes(term) ||
                                                                            (s.city || '').toLowerCase().includes(term) ||
                                                                            String(s.id || '').toLowerCase().includes(term)
                                                                        );
                                                                    })
                                                                    .map((store) => (
                                                                        <option key={store.id} value={String(store.id)}>{store.store_name} ({store.city})</option>
                                                                    ))
                                                                }
                                                            </select>
                                                            <button
                                                                style={{ ...styles.actionButton, backgroundColor: "#16a34a", width: '100%' }}
                                                                disabled={selectedPartnerStoreIdsToAdd.length === 0}
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    const newIds = [...partner.stores.map(s => s.id), ...selectedPartnerStoreIdsToAdd];
                                                                    await handleUpdatePartnerStores(partner.id, newIds);
                                                                    setSelectedPartnerStoreIdsToAdd([]);
                                                                }}
                                                            >Add Selected Stores</button>
                                                        </div>

                                                        {/* RIGHT: REMOVE ASSIGNED STORES */}
                                                        <div style={{ padding: '15px', background: '#fff', borderRadius: '8px', border: '1px solid #E0E0E0' }}>
                                                            <h4 style={{ marginBottom: '10px', color: '#D32F2F' }}>➖ Remove Assigned Stores</h4>
                                                            <input
                                                                type="text"
                                                                placeholder="🔍 Search assigned stores..."
                                                                value={partnerStoreRemoveSearch}
                                                                onChange={(e) => setPartnerStoreRemoveSearch(e.target.value)}
                                                                style={{ ...styles.textInput, width: '100%', marginBottom: '8px', fontSize: '13px', padding: '8px 10px', boxSizing: 'border-box' }}
                                                            />
                                                            <select
                                                                multiple
                                                                value={selectedPartnerStoreIdsToRemove}
                                                                onChange={(e) => setSelectedPartnerStoreIdsToRemove(Array.from(e.target.selectedOptions).map(opt => String(opt.value)))}
                                                                style={{ ...styles.textInput, height: "120px", width: '100%', marginBottom: '10px' }}
                                                            >
                                                                {partner.stores
                                                                    ?.filter(store => {
                                                                        if (!partnerStoreRemoveSearch) return true;
                                                                        const term = partnerStoreRemoveSearch.toLowerCase();
                                                                        return (
                                                                            (store.store_name || '').toLowerCase().includes(term) ||
                                                                            (store.city || '').toLowerCase().includes(term) ||
                                                                            String(store.id || '').toLowerCase().includes(term)
                                                                        );
                                                                    })
                                                                    .map((store) => (
                                                                        <option key={store.id} value={String(store.id)}>{store.store_name} ({store.city || ''})</option>
                                                                    ))
                                                                }
                                                            </select>
                                                            <button
                                                                style={{ ...styles.actionButton, backgroundColor: "#dc2626", width: '100%' }}
                                                                disabled={selectedPartnerStoreIdsToRemove.length === 0}
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    const remainingIds = partner.stores
                                                                        .map(s => s.id)
                                                                        .filter(id => !selectedPartnerStoreIdsToRemove.includes(String(id)));
                                                                    await handleUpdatePartnerStores(partner.id, remainingIds);
                                                                    setSelectedPartnerStoreIdsToRemove([]);
                                                                }}
                                                            >Remove Selected Stores</button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })
                        ) : (
                            <tr style={styles.tableRow}>
                                <td colSpan="4" style={{ ...styles.tableCell, textAlign: "center" }}>
                                    No partners found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </CollapsibleChannelSection>
    );

    return (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>
                Store POC Management ({partners.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "20px" }}>
                {channels.map((channel) => renderPartnerChannel(partnersByChannel[channel], channel))}
            </div>
        </div>
    );
};


const handleOpenDPLinkModal = (manager) => {
    setManagerToLink(manager);
    setSelectedDPId(''); // Clear selection
    setIsDPLinkingModalVisible(true);
};


const renderDeliveryPartners = () => {
    // Separate DPs by status for clear visibility
    const pendingDPs = allDeliveryPartners.filter(dp => dp.status === 'pending');
    const activeDPs = allDeliveryPartners.filter(dp => dp.status === 'active');
    
    // Helper to open the Reassign Modal
    const handleReassignClick = (dp) => {
        setDpToReassign(dp);
        setIsReassignModalVisible(true);
    };

    return (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>Delivery Partner Approvals & Management ({allDeliveryPartners.length})</h2>

            {/* Section for PENDING DPs */}
            {pendingDPs.length > 0 && (
                <div style={styles.tableCard}>
                    <h3 style={{...styles.cardTitle, borderLeft: '5px solid #FF9800', paddingLeft: '15px'}}>
                        Pending Approval ({pendingDPs.length})
                    </h3>
                    <table style={styles.dataTable}>
                        <thead>
                            <tr style={styles.tableHeaderRow}>
                                <th style={styles.tableHeaderCell}>Full Name</th>
                                <th style={styles.tableHeaderCell}>Email</th>
                                <th style={styles.tableHeaderCell}>Mobile</th>
                                <th style={styles.tableHeaderCell}>Status</th>
                                <th style={styles.tableHeaderCell}>Actions (Review)</th> {/* Updated Header */}
                            </tr>
                        </thead>
                        <tbody>
                            {pendingDPs.map(dp => (
                                <tr key={dp.id} style={styles.tableRow}>
                                    <td style={styles.tableCell}>{dp.full_name}</td>
                                    <td style={styles.tableCell}>{dp.email}</td>
                                    <td style={styles.tableCell}>{dp.mobile_number || 'N/A'}</td>
                                    <td style={styles.tableCell}>
                                        <span style={{...styles.activityStatusBadge, backgroundColor: '#FF9800'}}>
                                            {dp.status}
                                        </span>
                                    </td>
                                    <td style={styles.tableCell}>
                                        <button
                                            onClick={() => {
                                                setSelectedPartnerForDetails(dp);
                                                setIsPartnerDetailsModalVisible(true);
                                            }}
                                            style={styles.actionButton}
                                        >
                                            Review & Approve
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Section for ACTIVE DPs (Manager Actions Added Here) */}
             <div style={styles.tableCard}>
                <h3 style={{...styles.cardTitle, borderLeft: '5px solid #4CAF50', paddingLeft: '15px'}}>
                    Active Partners ({activeDPs.length})
                </h3>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={styles.tableHeaderRow}>
                            <th style={styles.tableHeaderCell}>Full Name</th>
                            <th style={styles.tableHeaderCell}>Email</th>
                            <th style={styles.tableHeaderCell}>Mobile</th>
                            <th style={styles.tableHeaderCell}>Manager ID</th>
                            <th style={styles.tableHeaderCell}>Status</th>
                            <th style={styles.tableHeaderCell}>Manager Actions</th> {/* <-- IMPORTANT: Action Header */}
                        </tr>
                    </thead>
                    <tbody>
                        {activeDPs.map(dp => (
                            <tr key={dp.id} style={styles.tableRow}>
                                <td style={styles.tableCell}>{dp.full_name}</td>
                                <td style={styles.tableCell}>{dp.email}</td>
                                <td style={styles.tableCell}>{dp.mobile_number || 'N/A'}</td>
                                <td style={styles.tableCell}>{dp.assigned_manager_id || 'None'}</td>
                                <td style={styles.tableCell}>
                                    <span style={{...styles.activityStatusBadge, backgroundColor: '#4CAF50'}}>
                                        {dp.status}
                                    </span>
                                </td>
                                <td style={styles.tableCell}>
                                    {/* ADDED: Reassign Manager Button (Fix for Issue 1) */}
                                    <button
                                        onClick={() => handleReassignClick(dp)}
                                        style={{ ...styles.actionButton, backgroundColor: '#1565C0' }}
                                        disabled={loading}
                                    >
                                        Reassign Manager
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {(pendingDPs.length === 0 && activeDPs.length === 0) && (
                <p style={styles.loadingText}>No delivery partners found in the database.</p>
            )}
        </div>
    );
};
// ==========================
// 🔹 QR MANAGEMENT SECTION
const renderQrManagement = () => {
  // Enhanced Styles
  const cardStyle = {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    padding: "24px",
    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
    marginBottom: "24px",
    border: "1px solid #e2e8f0" // Subtle border to define shape
  };

  const inputStyle = {
    padding: "12px 16px",
    borderRadius: "10px",
    border: "2px solid #edf2f7",
    fontSize: "14px",
    outline: "none",
    flex: 1,
    backgroundColor: "#fcfcfd", // Slightly off-white for inputs
    transition: "border-color 0.2s"
  };

  const btnBase = {
    padding: "12px 24px",
    borderRadius: "10px",
    border: "none",
    cursor: "pointer",
    fontWeight: "600",
    transition: "all 0.3s ease",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
  };

  return (
    // Background color changed to a more professional slate tint
    <div style={{ padding: "30px", backgroundColor: "#f1f5f9", minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "35px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "28px", color: "#1e293b", fontWeight: "800" }}>QR & Vendor Hub</h2>
          <p style={{ color: "#64748b", marginTop: "5px" }}>Manage your assets and partners from one place.</p>
        </div>
        
        {/* 🔥 PREMIUM TAB SWITCHER */}
        <div style={{ display: "flex", backgroundColor: "#e2e8f0", padding: "6px", borderRadius: "14px" }}>
          <button
            onClick={() => setQrTab("qr")}
            style={{
              ...btnBase,
              backgroundColor: qrTab === "qr" ? "#1e293b" : "transparent",
              color: qrTab === "qr" ? "#fff" : "#475569",
              boxShadow: qrTab === "qr" ? "0 4px 12px rgba(0,0,0,0.2)" : "none",
            }}
          >
            QR Management
          </button>
          <button
            onClick={() => setQrTab("vendor")}
            style={{
              ...btnBase,
              backgroundColor: qrTab === "vendor" ? "#1e293b" : "transparent",
              color: qrTab === "vendor" ? "#fff" : "#475569",
              boxShadow: qrTab === "vendor" ? "0 4px 12px rgba(0,0,0,0.2)" : "none",
            }}
          >
            Vendor License
          </button>
        </div>
      </div>

      {qrTab === "qr" && (
        <>
          {/* Summary Cards with better colors */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "25px", marginBottom: "30px" }}>
            <StatCard label="Live Warehouse Stock" value={freshBottlesWarehouse} color="#3b82f6" />
            <StatCard label="Pending Assignment" value={unassignedBottles.length} color="#f59e0b" />
            <StatCard label="Active Delivery Squad" value={approvedDeliveryPartners.length} color="#10b981" />
          </div>

          {/* Bulk QR Generator - Compact Design */}
          <div style={{...cardStyle, background: "linear-gradient(to right, #ffffff, #f8fafc)"}}>
            <h3 style={{ marginTop: 0, marginBottom: "20px", fontSize: "18px", color: "#334155" }}>Bulk QR Actions</h3>
            <div style={{ display: "flex", gap: "15px", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: "0 1 200px" }}>
                <input
                  type="number"
                  placeholder="Qty"
                  value={bulkCount}
                  onChange={(e) => setBulkCount(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <button onClick={handleBulkGenerateQR} style={{ ...btnBase, backgroundColor: "#3b82f6", color: "#fff" }}>
                Generate Codes
              </button>
              <button onClick={downloadStickersZip} style={{ ...btnBase, backgroundColor: "#64748b", color: "#fff" }}>
                Download ZIP
              </button>
              <button onClick={() => setQrAssigning(true)} style={{ ...btnBase, backgroundColor: "#10b981", color: "#fff" }}>
                Assign Now
              </button>
            </div>
          </div>

          

          {/* QR TABLE with Zebra Striping */}
          <div style={cardStyle}>
            <h3 style={{ margin: "0 0 20px 0", color: "#1e293b" }}>Unassigned Inventory</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f8fafc", textAlign: "left" }}>
                    <th style={{ padding: "16px", color: "#64748b", borderRadius: "10px 0 0 10px" }}>UUID</th>
                    <th style={{ padding: "16px", color: "#64748b" }}>QR Preview</th>
                    <th style={{ padding: "16px", color: "#64748b" }}>Quick Actions</th>
                    <th style={{ padding: "16px", color: "#64748b", borderRadius: "0 10px 10px 0" }}>Batch Select</th>
                  </tr>
                </thead>
                <tbody>
                  {unassignedBottles.map((bottle, index) => (
                    <tr key={bottle.UUID} style={{ borderBottom: "1px solid #f1f5f9", backgroundColor: index % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "16px", fontSize: "13px", color: "#475569", fontWeight: "500" }}>{bottle.UUID}</td>
                      <td style={{ padding: "16px" }}>
                        <div style={{ padding: "4px", backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", display: "inline-block" }}>
                          <QRCodeCanvas value={bottle.qr_code} size={45} />
                        </div>
                      </td>
                      <td style={{ padding: "16px" }}>
                        <button onClick={() => navigator.clipboard.writeText(bottle.qr_code)} style={{ marginRight: "10px", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", border: "1px solid #e2e8f0", background: "#fff" }}>Copy</button>
                        <button onClick={() => downloadSingleQr(bottle.UUID, bottle.qr_code)} style={{ padding: "6px 12px", borderRadius: "6px", cursor: "pointer", border: "1px solid #e2e8f0", background: "#fff" }}>Save</button>
                      </td>
                      <td style={{ padding: "16px" }}>
                        <input
                          type="checkbox"
                          style={{ width: "18px", height: "18px", cursor: "pointer" }}
                          checked={selectedBottlesToAssign.includes(bottle.qr_code)}
                          onChange={(e) => handleSelectBottle(bottle.qr_code, e.target.checked)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {qrTab === "vendor" && (
        <>
          {/* 🔹 REGISTER VENDOR */}
          <div style={{ ...cardStyle, borderLeft: "6px solid #10b981" }}>
            <h3 style={{ marginTop: 0, marginBottom: "20px", color: "#1e293b" }}>
              Register New Vendor
            </h3>

            <div style={{ display: "flex", gap: "15px", flexWrap: "wrap" }}>
              <input
                placeholder="Vendor Name"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                style={inputStyle}
              />

              <input
                placeholder="License Number"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                style={inputStyle}
              />

              <select
                value={vendorState}
                onChange={(e) => setVendorState(e.target.value)}
                style={inputStyle}
              >
                <option value="">Select State</option>

                {Array.isArray(statesList) && statesList.length > 0 ? (
                  statesList.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))
                ) : (
                  <option disabled>Loading...</option>
                )}
              </select>

              <button
                onClick={handleAddLicense}
                style={{
                  ...btnBase,
                  backgroundColor: "#10b981",
                  color: "#fff",
                  padding: "12px 40px",
                }}
              >
                Add Vendor
              </button>
            </div>
          </div>

          {/* 🔥 VENDOR QR SECTION */}
          <div style={{ ...cardStyle, marginTop: "20px" }}>
            <h3 style={{ marginBottom: "15px", color: "#1e293b" }}>
              Vendor QR (Use for all locations)
            </h3>

            <div style={{ textAlign: "center" }}>
              <QRCodeCanvas
                id="vendorQR"
                value="https://veekayaquatech.com/vendor-info"
                size={200}
              />

              <p style={{ marginTop: "10px", color: "#64748b" }}>
                Scan this QR to fetch vendor based on GPS location
              </p>

              {/* 🔥 DOWNLOAD BUTTON */}
              <button
                onClick={() => {
                  const canvas = document.getElementById("vendorQR");
                  const url = canvas.toDataURL("image/png");

                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "vendor-qr.png";
                  link.click();
                }}
                style={{
                  ...btnBase,
                  marginTop: "15px",
                  backgroundColor: "#2563eb",
                  color: "#fff",
                }}
              >
                Download QR
              </button>
            </div>
          </div>

          {/* 🔹 VENDOR DIRECTORY */}
          <div style={{ ...cardStyle, marginTop: "20px" }}>
            <h3 style={{ marginTop: 0, marginBottom: "20px", color: "#1e293b" }}>
              Vendor Directory
            </h3>

            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ backgroundColor: "#f8fafc" }}>
                <tr>
                  <th style={{ padding: "18px", textAlign: "left", color: "#64748b" }}>
                    Vendor Identity
                  </th>
                  <th style={{ padding: "18px", textAlign: "left", color: "#64748b" }}>
                    License ID
                  </th>
                  <th style={{ padding: "18px", textAlign: "left", color: "#64748b" }}>
                    Region
                  </th>
                  <th style={{ padding: "18px", textAlign: "left", color: "#64748b" }}>
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {Array.isArray(vendorList) && vendorList.length > 0 ? (
                  vendorList.map((v) => (
                    <tr key={v.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "18px", fontWeight: "600", color: "#334155" }}>
                        {v.vendor_name}
                      </td>

                      <td style={{ padding: "18px", color: "#64748b", fontFamily: "monospace" }}>
                        {v.license_number}
                      </td>

                      <td style={{ padding: "18px" }}>
                        <span
                          style={{
                            padding: "5px 12px",
                            backgroundColor: "#dcfce7",
                            color: "#166534",
                            borderRadius: "20px",
                            fontSize: "12px",
                            fontWeight: "700",
                            textTransform: "uppercase",
                          }}
                        >


                        
                          {v.state}
                        </span>
                      </td>

                      {/* ✅ ACTION (SEPARATE TD) */}
                      <td style={{ padding: "18px" }}>
                        <button
                          onClick={() => handleDeleteVendorLicense(v.id)}
                          style={{
                            backgroundColor: "#ef4444",
                            color: "#fff",
                            border: "none",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: "600"
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3" style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
                      No active vendors registered yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};






 // In SuperAdminDashboard.jsx

const renderComplaints = () => {
  const complaintsByChannel = complaints.reduce((acc, complaint) => {
    const channel = complaint.store?.channel?.toUpperCase() || "GENERAL";
    if (!acc[channel]) acc[channel] = [];
    acc[channel].push(complaint);
    return acc;
  }, {});

  const channels = Object.keys(complaintsByChannel).sort();

  const renderComplaintTable = (complaintList) => (
    <div style={{ ...styles.tableCard, margin: 0, boxShadow: "none" }}>
      <table style={styles.dataTable}>
        <thead>
          <tr style={styles.tableHeaderRow}>
            <th style={styles.tableHeaderCell}>ID</th>
            <th style={styles.tableHeaderCell}>Subject</th>
            <th style={styles.tableHeaderCell}>Description</th>
            <th style={styles.tableHeaderCell}>Raised By (Store/Partner)</th>
            <th style={styles.tableHeaderCell}>Date</th>
            <th style={styles.tableHeaderCell}>Status</th>
            <th style={styles.tableHeaderCell}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {complaintList.map((complaint) => (
            <tr key={complaint.id} style={styles.tableRow}>
              <td style={styles.tableCell}>{complaint.id}</td>
              <td style={styles.tableCell}>{complaint.subject}</td>

              <td style={styles.tableCell}>
                {complaint.description}

                {complaint.photoUrl && (
                  <div style={{ marginTop: "10px" }}>
                    <a
                      href={`${API_BASE_URL}/${complaint.photoUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        ...styles.actionButton,
                        backgroundColor: "#6c757d",
                        textDecoration: "none",
                      }}
                    >
                      📷 View Image
                    </a>
                  </div>
                )}
              </td>

              <td style={styles.tableCell}>
                {complaint.customerName} ({complaint.role?.split(" at ")[0]})
              </td>

              <td style={styles.tableCell}>
                {complaint.date?.toLocaleDateString()}
              </td>

              <td style={styles.tableCell}>
                <span
                  style={{
                    ...styles.activityStatusBadge,
                    backgroundColor:
                      complaint.status?.toLowerCase() === "resolved"
                        ? "#4CAF50"
                        : "#FF9800",
                  }}
                >
                  {complaint.status}
                </span>
              </td>

              <td style={styles.tableCell}>
                {hasPermission(PERMISSIONS.COMPLAINTS_RESOLVE) && complaint.status?.toLowerCase() === "pending" && (
                  <button
                    style={styles.actionButton}
                    onClick={() => handleResolveClick(complaint.id)}
                  >
                    Resolve
                  </button>
                )}
              </td>
            </tr>
          ))}

          {complaintList.length === 0 && (
            <tr style={styles.tableRow}>
              <td colSpan="7" style={{ ...styles.tableCell, textAlign: "center" }}>
                No complaints found in this channel.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={styles.contentArea}>
      <h2 style={styles.pageTitle}>Complaints Management ({complaints.length})</h2>

      {channels.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "20px" }}>
          {channels.map((channel) => (
            <CollapsibleChannelSection
              key={channel}
              title={`Channel: ${channel}`}
              totalCount={complaintsByChannel[channel].length}
              defaultOpen={channel === "BLINKIT" || channel === "ZEPTO"}
            >
              {renderComplaintTable(complaintsByChannel[channel])}
            </CollapsibleChannelSection>
          ))}
        </div>
      ) : (
        <div style={styles.tableCard}>
          <p style={styles.noDataText}>No complaints found in the database.</p>
        </div>
      )}
    </div>
  );
};

const renderReports = () => {
  return (
    <div style={styles.contentArea}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
        <h2 style={{ ...styles.pageTitle, marginBottom: 0 }}>Reports Management</h2>
        
        <div style={{ 
          display: "flex", 
          backgroundColor: "#e0e4e8", 
          padding: "4px", 
          borderRadius: "10px",
          gap: "4px" 
        }}>
          <button
            style={{
              ...styles.button,
              width: "auto",
              padding: "8px 20px",
              margin: 0,
              fontSize: "14px",
              borderRadius: "8px",
              backgroundColor: reportsTab === "monthly" ? "#FFF" : "transparent",
              color: reportsTab === "monthly" ? "#1A2A44" : "#555",
              boxShadow: reportsTab === "monthly" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
            }}
            onClick={() => setReportsTab("monthly")}
          >
            📊 Test Reports
          </button>
          <button
            style={{
              ...styles.button,
              width: "auto",
              padding: "8px 20px",
              margin: 0,
              fontSize: "14px",
              borderRadius: "8px",
              backgroundColor: reportsTab === "delivery" ? "#FFF" : "transparent",
              color: reportsTab === "delivery" ? "#1A2A44" : "#555",
              boxShadow: reportsTab === "delivery" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
            }}
            onClick={() => setReportsTab("delivery")}
          >
            🚚 Delivery Reports
          </button>
        </div>
      </div>

      {reportsTab === "monthly" ? (
        <>
          {hasPermission(PERMISSIONS.REPORTS_UPLOAD) && <div style={{ ...styles.formCard, borderTop: "4px solid #4CAF50" }}>
            <h3 style={{ ...styles.cardTitle, borderBottom: "none", marginBottom: "15px" }}>Upload New Quality Report</h3>
            
            <form
              onSubmit={handleUploadReport}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "20px",
                alignItems: "flex-end",
              }}
            >
              {/* ✅ Month field changed to 'date' for consistent calendar UI */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#666' }}>Reporting Date/Month</label>
                <input
                  type="date" 
                  style={{ ...styles.textInput, width: '100%' }}
                  value={reportMonth.includes('-') && reportMonth.split('-').length === 2 ? `${reportMonth}-01` : reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#666' }}>Validity Period</label>
                <input
                  type="date"
                  style={{ ...styles.textInput, width: '100%' }}
                  value={validUpto}
                  onChange={(e) => setValidUpto(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#666' }}>Select PDF Document</label>
                <input
                  type="file"
                  accept=".pdf"
                  style={{ 
                    ...styles.textInput, 
                    width: '100%', 
                    padding: '8px',
                    fontSize: '12px',
                    backgroundColor: '#f9f9f9' 
                  }}
                  onChange={handleFileChange}
                  required
                />
              </div>

              <button
                type="submit"
                style={{
                  ...styles.button,
                  backgroundColor: "#4CAF50",
                  height: "46px",
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
                disabled={uploadingReport || !selectedFile}
              >
                {uploadingReport ? "⌛ Processing..." : "📤 Upload Report"}
              </button>
            </form>
          </div>}

          <div style={styles.tableCard}>
            <div style={{ padding: '20px', background: '#f8fafc', borderBottom: '1px solid #eef2f6' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#1A2A44' }}>
                Stored Test Reports ({reports.length})
              </h3>
            </div>

            <table style={styles.dataTable}>
              <thead>
                <tr style={{ backgroundColor: "#1A2A44", color: "#fff" }}>
                  <th style={{ ...styles.tableHeaderCell, width: '80px' }}>ID</th>
                  <th style={styles.tableHeaderCell}>Report Name</th>
                  <th style={styles.tableHeaderCell}>Target Date</th>
                  <th style={styles.tableHeaderCell}>Valid Until</th>
                  <th style={{ ...styles.tableHeaderCell, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>

              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} style={styles.tableRow}>
                    <td style={{ ...styles.tableCell, fontWeight: 'bold', color: '#666' }}>#{r.id}</td>
                    <td style={{ ...styles.tableCell, color: '#1565C0', fontWeight: '500' }}>
                      📄 {r.file_path?.split("/").pop() || "Report.pdf"}
                    </td>
                    {/* ✅ Target Date and Valid Until now show same format */}
                    <td style={styles.tableCell}>
                       <span style={{ padding: "4px 12px", borderRadius: "6px", backgroundColor: "#E3F2FD", color: "#1565C0", fontSize: "12px", fontWeight: '600' }}>
                        📅 {r.report_date || r.rawMonthYear}
                       </span>
                    </td>
                    <td>
                      <span
                        style={{
                          padding: "4px 12px",
                          borderRadius: "6px",
                          fontWeight: '600',
                          backgroundColor: r.valid_upto ? "#E8F5E9" : "#F5F5F5",
                          color: r.valid_upto ? "#2E7D32" : "#9E9E9E",
                          fontSize: "12px",
                        }}
                      >
                        {r.valid_upto ? `📅 ${r.valid_upto}` : "♾ No Expiry"}
                      </span>
                    </td>
                    <td style={{ ...styles.tableCell, textAlign: 'center' }}>
                      <button
                        style={{
                          ...styles.actionButton,
                          backgroundColor: "#1A2A44",
                          padding: '6px 16px',
                          borderRadius: '6px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                        onClick={() => setPreviewUrl(r.file_path)}
                      >
                        👁️ View PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Reports />
      )}

      {previewUrl && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
          background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", flexDirection: "column"
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "15px 25px", background: "#1A2A44", color: "#fff"
          }}>
            <h3 style={{ margin: 0 }}>Document Preview</h3>
            <button
              onClick={() => setPreviewUrl(null)}
              style={{
                background: "#ff4d4f", color: "#fff", border: "none",
                padding: "8px 20px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold"
              }}
            >
              Close
            </button>
          </div>
          <iframe
            src={`${API_BASE_URL}/${previewUrl}`}
            style={{ flex: 1, border: "none", backgroundColor: '#fff' }}
            title="PDF Preview"
          />
        </div>
      )}
    </div>
  );
};

  
// 🟢 RENDER QR MANAGEMENT FUNCTION 🟢



// 🟢 RENDER ACTIVE STORES LIST FUNCTION 🟢
const renderActiveStoresList = () => {
  if (loading) {
    return <p style={styles.loadingText}>Loading active stores...</p>;
  }

  const normalizedStoreSearch = storeManagementSearch.trim().toLowerCase();
  const entityOptions = newStoreChannel === "ZEPTO"
    ? ["ZEPTO"]
    : newStoreChannel === "BLINKIT"
      ? BLINKIT_ENTITIES
      : [];
  const filteredStoreManagementList = allStores.filter((store) => {
    const active = isStoreActive(store);
    if (storeStatusFilter === "ACTIVE" && !active) return false;
    if (storeStatusFilter === "INACTIVE" && active) return false;
    if (!normalizedStoreSearch) return true;
    return [
      store.id,
      store.store_name,
      store.city,
      store.state,
      store.address,
      store.channel,
      store.assigned_manager,
    ].some((value) => String(value || "").toLowerCase().includes(normalizedStoreSearch));
  });

  // Group stores by channel
  const storesByChannel = filteredStoreManagementList.reduce((acc, store) => {
    const channel = store.channel ? store.channel.toUpperCase() : "UNASSIGNED";
    if (!acc[channel]) acc[channel] = [];
    acc[channel].push(store);
    return acc;
  }, {});

  const channels = Object.keys(storesByChannel).sort();

  // Partner → Store mapping logic
  const partnerStoreMap = partners.reduce((map, partner) => {
    partner.stores.forEach((store) => {
      if (!map[store.id]) map[store.id] = [];
      map[store.id].push(partner.full_name);
    });
    return map;
  }, {});

  const getStoreAssignmentStatus = (store) => {
    const managerId = store.delivery_manager_id ?? store.assigned_manager_id ?? store.manager_id;
    const managerName = store.delivery_manager_name ?? store.delivery_manager ?? store.assigned_manager ?? store.manager_name;
    const mappedPocs = partnerStoreMap[store.id] || [];
    const directPoc = store.poc ?? store.poc_name;

    const hasManagerId = managerId !== null && managerId !== undefined && managerId !== 0 && managerId !== "0" && managerId !== "";
    const hasManagerName = typeof managerName === "string" && managerName.trim() !== "";
    const hasDirectPoc = typeof directPoc === "string" && directPoc.trim() !== "";

    return {
      missingManager: !hasManagerId || !hasManagerName,
      missingPoc: mappedPocs.length === 0 && !hasDirectPoc,
      managerName: hasManagerName ? managerName.trim() : "Not Assigned",
      pocName: mappedPocs.length > 0 ? mappedPocs.join(", ") : (hasDirectPoc ? directPoc.trim() : "Not Assigned"),
    };
  };

  const storesRequiringAssignment = allStores.filter((store) => {
    const { missingManager, missingPoc } = getStoreAssignmentStatus(store);
    return missingManager || missingPoc;
  });

  const handleExportStoresRequiringAssignment = () => {
    const exportRows = storesRequiringAssignment.map((store) => {
      const assignment = getStoreAssignmentStatus(store);
      const status = assignment.missingManager && assignment.missingPoc
        ? "Missing Manager & Missing POC"
        : assignment.missingManager
          ? "Missing Manager"
          : "Missing POC";

      return {
        "Store ID": store.id,
        "Store Name": store.store_name || "",
        "Channel": store.channel || "",
        "Region": store.region || "",
        "Entity": store.entity || "",
        "State": store.state || "",
        "City": store.city || "",
        "Address": store.address || "",
        "Delivery Manager": assignment.missingManager ? "Not Assigned" : assignment.managerName,
        "POC": assignment.missingPoc ? "Not Assigned" : assignment.pocName,
        "Status": status,
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stores Requiring Assignment");

    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(workbook, `Stores_Requiring_Assignment_${date}.xlsx`);
  };

  // Grid styles
  const stylesGrid = {
    gridContainer: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
      gap: "20px",
      width: "100%",
      marginTop: "16px",
    },
    storeCard: {
      border: "1px solid #e1e1e1",
      padding: "20px",
      borderRadius: "12px",
      background: "#fff",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 4px 6px rgba(0,0,0,0.05)",
    },
    storeTitle: {
      fontSize: "17px",
      fontWeight: "700",
      marginBottom: "6px",
      color: "#1e293b",
    },
    storeSub: {
      margin: "2px 0",
      color: "#64748b",
      fontSize: "13px",
    },
    storeChannel: {
      fontSize: "12px",
      fontWeight: "800",
      color: "#0052CC",
      marginTop: "8px",
      textTransform: "uppercase",
    },
    automationPanel: {
      marginTop: "15px",
      padding: "15px",
      background: "#f8fafc",
      borderRadius: "10px",
      border: "1px solid #e2e8f0",
    },
    actionRow: {
      marginTop: "15px",
      display: "flex",
      gap: "10px",
    },
    actionBtn: {
      flex: 1,
      padding: "8px 10px",
      borderRadius: "8px",
      border: "none",
      cursor: "pointer",
      fontSize: "13px",
      fontWeight: "600",
      color: "#fff",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      gap: "5px",
    },
  };

  const renderChannelSection = (stores, channelName) => (
    <CollapsibleChannelSection
      key={channelName}
      title={`Channel: ${channelName}`}
      totalCount={stores.length}
      defaultOpen={true}
    >
      <div style={stylesGrid.gridContainer}>
        {stores.map((store) => {
          // Check for partner list directly from mapping
          const mappedPartners = partnerStoreMap[store.id] || [];
          const partnerNames = mappedPartners.length > 0 ? mappedPartners.join(", ") : "N/A";
          const storeQr = storeQrById[String(store.id)];
          const storeQrLoading = Boolean(storeQrLoadingIds[String(store.id)]);
          
          // 🔥 1. RE-DEFINED VALIDATION:
          // Agar database column available nahi hai, toh hum check karenge 
          // ki kya store object ke andar assigned_manager exist karta hai.
          const hasManager = store.assigned_manager_id || store.assigned_manager || store.manager_id;
          const hasPartner = mappedPartners.length > 0;
          
          const canEnableAutomation = hasManager && hasPartner;

          return (
            <div
              key={store.id}
              style={{
                ...stylesGrid.storeCard,
                ...(isStoreActive(store) ? {} : { background: "#F8FAFC", opacity: 0.72 }),
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                <div style={stylesGrid.storeTitle}>{store.store_name}</div>
                <StoreStatusBadge store={store} />
              </div>
              <div style={stylesGrid.storeSub}><strong>Store ID:</strong> {store.id}</div>
              <div style={stylesGrid.storeSub}>
                📍 {store.city}
              </div>

              <div style={stylesGrid.storeSub}>
                👨‍💼 Delivery Manager:{" "}
                <strong>
                  {store.assigned_manager || "Not Assigned"}
                </strong>
              </div>

              <div style={stylesGrid.storeSub}>
                🆔 Manager ID:{" "}
                {store.assigned_manager_id || "N/A"}
              </div>

              <div style={stylesGrid.storeSub}>
                👤 POC: {partnerNames}
              </div>
              <div style={stylesGrid.storeChannel}>{store.channel || "GENERAL"}</div>
              {isSuperAdminRole && (
                <div style={stylesGrid.automationPanel}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                    <span style={{ color: "#334155", fontSize: "13px", fontWeight: "800" }}>QR Status</span>
                    <span style={{
                      padding: "4px 9px",
                      borderRadius: "999px",
                      backgroundColor: storeQr?.qr_enabled ? "#DCFCE7" : "#F1F5F9",
                      color: storeQr?.qr_enabled ? "#166534" : "#475569",
                      fontSize: "11px",
                      fontWeight: "800",
                    }}>
                      {storeQrLoading ? "Loading…" : storeQr?.qr_enabled ? "Active" : "Disabled"}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", marginTop: "12px" }}>
                    <button
                      type="button"
                      style={{ ...stylesGrid.actionBtn, backgroundColor: "#0F766E" }}
                      disabled={storeQrLoading}
                      onClick={() => openStoreQrModal(store)}
                    >
                      View QR
                    </button>
                    <button
                      type="button"
                      style={{ ...stylesGrid.actionBtn, backgroundColor: "#2563EB" }}
                      disabled={storeQrLoading}
                      onClick={() => downloadStoreQr(store)}
                    >
                      Download QR
                    </button>
                    <button
                      type="button"
                      style={{ ...stylesGrid.actionBtn, backgroundColor: "#D97706" }}
                      disabled={storeQrLoading}
                      onClick={() => setPendingStoreQrRotation(store)}
                    >
                      Rotate QR
                    </button>
                    <button
                      type="button"
                      style={{ ...stylesGrid.actionBtn, backgroundColor: storeQr?.qr_enabled ? "#64748B" : "#16A34A" }}
                      disabled={storeQrLoading || !storeQr}
                      onClick={() => updateStoreQrStatus(store)}
                    >
                      {storeQr?.qr_enabled ? "Disable QR" : "Enable QR"}
                    </button>
                  </div>
                </div>
              )}
              {canUpdateStoreStatus && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
                <span style={{ color: "#475569", fontSize: "13px", fontWeight: "700" }}>
                  {isStoreActive(store) ? "Active" : "Inactive"}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {String(storeStatusUpdatingId) === String(store.id) && (
                    <span style={{ color: "#64748B", fontSize: "12px" }}>Updating…</span>
                  )}
                  <StoreStatusToggle
                    store={store}
                    loading={String(storeStatusUpdatingId) === String(store.id)}
                    onToggle={requestStoreStatusChange}
                  />
                </div>
              </div>}

              {/* --- ⚙️ AUTOMATION & CAPPING CONTROL --- */}
              <div style={stylesGrid.automationPanel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#334155' }}>🤖 Automation</span>
                  
                  {/* Toggle Switch */}
                  <div 
                    onClick={() => {
                      if (!canEnableAutomation) {
                        alert(`🚨 Setup Required: \nManager: ${hasManager ? '✅' : '❌'}\nPartner: ${hasPartner ? '✅' : '❌'}\n\nPlease complete registration first.`);
                        return;
                      }
                      handleUpdateStoreAutomation(store.id, { auto_order_enabled: !store.auto_order_enabled });
                    }}
                    style={{
                      width: '44px', height: '22px', borderRadius: '11px', cursor: 'pointer', position: 'relative',
                      backgroundColor: store.auto_order_enabled && canEnableAutomation ? '#10B981' : '#CBD5E1', transition: '0.3s'
                    }}
                  >
                    <div style={{
                      width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '2px',
                      left: store.auto_order_enabled && canEnableAutomation ? '24px' : '2px', transition: '0.3s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '10px', color: '#64748B', fontWeight: '700' }}>FREQ (DAYS)</label>
                    <input 
                      type="number" 
                      defaultValue={store.order_frequency_days || 1} 
                      style={{ ...styles.textInput, width: '100%', padding: '5px', fontSize: '12px', marginTop: '4px' }}
                      onBlur={(e) => handleUpdateStoreAutomation(store.id, { order_frequency_days: parseInt(e.target.value) || 1 })} 
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: '#64748B', fontWeight: '700' }}>MONTHLY CAP</label>
                    <input 
                      type="number" 
                      // Fallback to 1000 if cap is missing
                      defaultValue={store.monthly_cap || 1000} 
                      style={{ ...styles.textInput, width: '100%', padding: '5px', fontSize: '12px', marginTop: '4px' }}
                      onBlur={(e) => handleUpdateStoreAutomation(store.id, { monthly_cap: parseInt(e.target.value) || 1000 })} 
                    />
                  </div>
                </div>

                {/* ℹ️ Visual Feedback for Super Admin */}
                <div style={{ marginTop: '10px', borderTop: '1px dashed #e2e8f0', paddingTop: '8px' }}>
                  {!canEnableAutomation ? (
                    <p style={{ color: '#ef4444', fontSize: '10px', margin: 0, fontWeight: '800' }}>
                      ❌ SETUP PENDING: {!hasManager ? 'Create DM' : 'Link Partner'}
                    </p>
                  ) : (
                    <p style={{ color: '#10B981', fontSize: '10px', margin: 0, fontWeight: '800' }}>
                      ✅ SETUP COMPLETE
                    </p>
                  )}
                </div>
              </div>

              {/* --- 🛠 ACTIONS --- */}
              <div style={stylesGrid.actionRow}>
                <button
                  style={{ ...stylesGrid.actionBtn, backgroundColor: "#0F766E" }}
                  onClick={() => {
                    setSelectedStoreForDetails(store);
                    setIsStoreDetailsModalVisible(true);
                  }}
                >
                  View Details
                </button>
                <button
                  style={{ ...stylesGrid.actionBtn, backgroundColor: "#6366F1" }}
                  onClick={() => {
                    setEditingStore(store);
                    setEditStoreName(store.store_name);
                    setEditStoreAddress(store.address || "");
                    setEditStoreCity(store.city || "");
                    setIsEditStoreModalVisible(true);
                  }}
                >
                  ✏️ Edit Info
                </button>
                <button
                  style={{ ...stylesGrid.actionBtn, backgroundColor: "#E74C3C" }}
                  onClick={() => handleDeleteStore(store.id)}
                >
                  🗑️ Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleChannelSection>
  );

  return (
    <div style={styles.contentArea}>
      <h2 style={styles.pageTitle}>
        Store Management ({allStores.length} Total Stores)
      </h2>

      {/* ADD STORE FORM */}
      <div style={styles.formCard}>
        <h3 style={styles.cardTitle}>Add New Store</h3>
        <form onSubmit={handleAddStore} style={styles.form}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
            <input style={styles.textInput} type="text" placeholder="Store ID (Outlet ID)" value={newStoreId} onChange={(e) => setNewStoreId(e.target.value)} required />
            <input style={styles.textInput} type="text" placeholder="Store Name" value={newStoreName} onChange={(e) => setNewStoreName(e.target.value)} required />
            <select
              style={styles.textInput}
              value={newStoreRegion}
              onChange={(e) => setNewStoreRegion(e.target.value)}
            >
              <option value="">Select Region</option>
              {STORE_REGIONS.map((region) => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>
            <SearchableSelection
              value={newStoreEntity}
              onChange={setNewStoreEntity}
              options={entityOptions}
              placeholder={entityOptions.length ? "Search entity..." : "No entities available"}
              disabled={newStoreChannel === "ZEPTO" || entityOptions.length === 0}
              showOptionsOnFocus
            />
            <SearchableSelection
              value={newStoreState}
              onChange={(state) => {
                setNewStoreState(state);
                setNewStoreCity("");
              }}
              options={INDIA_STATES}
              placeholder="Type to search state..."
              showOptionsOnFocus
            />
            <SearchableSelection
              value={newStoreCity}
              onChange={setNewStoreCity}
              options={citySelectionOptions}
              placeholder={newStoreState ? "Type to search city..." : "Select State First"}
              disabled={!newStoreState}
              required={Boolean(newStoreState)}
              showOptionsOnFocus
            />
            <input style={styles.textInput} type="text" placeholder="Address" value={newStoreAddress} onChange={(e) => setNewStoreAddress(e.target.value)} />
            <select
              style={styles.textInput}
              value={newStoreChannel}
              onChange={(e) => {
                const channel = e.target.value;
                setNewStoreChannel(channel);
                setNewStoreEntity(channel === "ZEPTO" ? "ZEPTO" : "");
              }}
            >
              {ALL_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button style={{ ...styles.button, ...styles.primaryButton, marginTop: '15px' }} type="submit">
            Add Store
          </button>
        </form>
      </div>

      {storeStatusNotice && (
        <div
          role={storeStatusNotice.type === "error" ? "alert" : "status"}
          style={{
            position: "fixed",
            top: "20px",
            right: "20px",
            zIndex: 2100,
            maxWidth: "420px",
            padding: "12px 16px",
            borderRadius: "10px",
            backgroundColor: storeStatusNotice.type === "error" ? "#FEE2E2" : "#DCFCE7",
            color: storeStatusNotice.type === "error" ? "#991B1B" : "#166534",
            fontWeight: "700",
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.18)",
          }}
        >
          {String(storeStatusNotice.message ?? "")}
        </div>
      )}

      {storeQrNotice && (
        <div
          role={storeQrNotice.type === "error" ? "alert" : "status"}
          style={{
            position: "fixed",
            top: "76px",
            right: "20px",
            zIndex: 2100,
            maxWidth: "420px",
            padding: "12px 16px",
            borderRadius: "10px",
            backgroundColor: storeQrNotice.type === "error" ? "#FEE2E2" : "#DCFCE7",
            color: storeQrNotice.type === "error" ? "#991B1B" : "#166534",
            fontWeight: "700",
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.18)",
          }}
        >
          {String(storeQrNotice.message ?? "")}
        </div>
      )}

      <div style={{ ...styles.formCard, display: "flex", gap: "16px", alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 320px", color: "#334155", fontSize: "13px", fontWeight: "700" }}>
          Search Stores
          <input
            type="search"
            value={storeManagementSearch}
            onChange={(event) => setStoreManagementSearch(event.target.value)}
            placeholder="Search by store, ID, city, state, address, channel, or manager"
            style={{ ...styles.textInput, width: "100%", marginTop: "6px" }}
          />
        </label>
        <label style={{ flex: "0 1 220px", color: "#334155", fontSize: "13px", fontWeight: "700" }}>
          Status
          <select
            value={storeStatusFilter}
            onChange={(event) => setStoreStatusFilter(event.target.value)}
            style={{ ...styles.textInput, width: "100%", marginTop: "6px" }}
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
        <span style={{ color: "#64748B", fontSize: "13px", paddingBottom: "12px" }}>
          {filteredStoreManagementList.length} stores
        </span>
      </div>

      <CollapsibleChannelSection
        title="⚠️ Stores Requiring Assignment"
        totalCount={storesRequiringAssignment.length}
        defaultOpen={false}
        headerAction={(
          <button
            type="button"
            onClick={handleExportStoresRequiringAssignment}
            style={{
              ...styles.button,
              margin: 0,
              width: "auto",
              padding: "8px 12px",
              backgroundColor: "#217346",
              color: "#fff",
              fontSize: "12px",
            }}
          >
            📥 Export Excel
          </button>
        )}
      >
        <div style={stylesGrid.gridContainer}>
          {storesRequiringAssignment.map((store) => {
            const assignment = getStoreAssignmentStatus(store);
            const missingLabel = assignment.missingManager && assignment.missingPoc
              ? "Missing Manager & Missing POC"
              : assignment.missingManager
                ? "Missing Manager"
                : "Missing POC";

            return (
              <div key={`assignment-${store.id}`} style={stylesGrid.storeCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                  <div style={stylesGrid.storeTitle}>{store.store_name}</div>
                  <span style={{
                    padding: "4px 8px",
                    borderRadius: "999px",
                    background: "#FEE2E2",
                    color: "#B91C1C",
                    fontSize: "11px",
                    fontWeight: "800",
                    whiteSpace: "nowrap",
                  }}>
                    {missingLabel}
                  </span>
                </div>
                <div style={stylesGrid.storeSub}><strong>Store ID:</strong> {store.id}</div>
                <div style={stylesGrid.storeSub}><strong>City:</strong> {store.city || "N/A"}</div>
                <div style={stylesGrid.storeSub}><strong>Channel:</strong> {store.channel || "GENERAL"}</div>
                <div style={stylesGrid.storeSub}>
                  <strong>Delivery Manager:</strong>{" "}
                  <span style={assignment.missingManager ? { color: "#DC2626", fontWeight: "700" } : undefined}>
                    {assignment.managerName}
                  </span>
                </div>
                <div style={stylesGrid.storeSub}>
                  <strong>POC:</strong>{" "}
                  <span style={assignment.missingPoc ? { color: "#DC2626", fontWeight: "700" } : undefined}>
                    {assignment.pocName}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleChannelSection>

      {/* CHANNEL SECTIONS */}
      {channels.map(channel => renderChannelSection(storesByChannel[channel], channel))}
      {channels.length === 0 && (
        <div style={{ ...styles.formCard, textAlign: "center", color: "#64748B" }}>
          No stores match the current search and status filter.
        </div>
      )}

      <StoreDetailsModal
        isVisible={isStoreDetailsModalVisible}
        onClose={() => setIsStoreDetailsModalVisible(false)}
        store={selectedStoreForDetails}
        partners={partners}
        modalStyles={styles.modalStyles}
        statusLoading={String(storeStatusUpdatingId) === String(selectedStoreForDetails?.id)}
        onStatusToggle={requestStoreStatusChange}
        canUpdateStatus={canUpdateStoreStatus}
      />

      {storeQrModal && (
        <div style={styles.modalStyles.backdrop} role="dialog" aria-modal="true" aria-labelledby="store-qr-modal-title">
          <div style={{ ...styles.modalStyles.modal, width: "520px", maxWidth: "calc(100vw - 32px)" }}>
            <h3 id="store-qr-modal-title" style={styles.modalStyles.title}>Store QR</h3>
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "4px 0", color: "#334155" }}>
                <strong>Store Name:</strong> {String(storeQrModal.store.store_name || "N/A")}
              </p>
              <p style={{ margin: "4px 0", color: "#334155" }}>
                <strong>Outlet ID:</strong> {String(storeQrModal.store.id)}
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "center", padding: "20px", backgroundColor: "#F8FAFC", borderRadius: "12px" }}>
              <img
                src={storeQrModal.imageUrl}
                alt={`QR code for ${storeQrModal.store.store_name}`}
                style={{ width: "100%", maxWidth: "300px", height: "auto", display: "block" }}
              />
            </div>
            <div style={{ ...styles.modalStyles.actions, flexWrap: "wrap" }}>
              <button
                type="button"
                style={{ ...styles.modalStyles.submitButton, backgroundColor: "#2563EB" }}
                onClick={() => {
                  const link = document.createElement("a");
                  link.href = storeQrModal.imageUrl;
                  link.download = storeQrModal.filename;
                  document.body.appendChild(link);
                  link.click();
                  link.remove();
                }}
              >
                Download PNG
              </button>
              <button
                type="button"
                style={{ ...styles.modalStyles.submitButton, backgroundColor: "#D97706" }}
                disabled={Boolean(storeQrLoadingIds[String(storeQrModal.store.id)])}
                onClick={() => setPendingStoreQrRotation(storeQrModal.store)}
              >
                Rotate QR
              </button>
              <button
                type="button"
                style={styles.modalStyles.cancelButton}
                onClick={() => setStoreQrModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingStoreQrRotation && (
        <div style={{ ...styles.modalStyles.backdrop, zIndex: 2200 }} role="dialog" aria-modal="true" aria-labelledby="rotate-store-qr-title">
          <div style={{ ...styles.modalStyles.modal, width: "480px", maxWidth: "calc(100vw - 32px)" }}>
            <h3 id="rotate-store-qr-title" style={styles.modalStyles.title}>Rotate QR?</h3>
            <p style={{ color: "#475569", lineHeight: 1.6 }}>
              Previously printed QR codes will stop working.
            </p>
            <div style={styles.modalStyles.actions}>
              <button
                type="button"
                style={styles.modalStyles.cancelButton}
                disabled={Boolean(storeQrLoadingIds[String(pendingStoreQrRotation.id)])}
                onClick={() => setPendingStoreQrRotation(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{ ...styles.modalStyles.submitButton, backgroundColor: "#D97706" }}
                disabled={Boolean(storeQrLoadingIds[String(pendingStoreQrRotation.id)])}
                onClick={confirmStoreQrRotation}
              >
                {storeQrLoadingIds[String(pendingStoreQrRotation.id)] ? "Rotating…" : "Rotate QR"}
              </button>
            </div>
          </div>
        </div>
      )}

      {canUpdateStoreStatus && pendingStoreStatusChange && (
        <div style={styles.modalStyles.backdrop} role="dialog" aria-modal="true" aria-labelledby="store-status-dialog-title">
          <div style={{ ...styles.modalStyles.modal, width: "520px", maxWidth: "calc(100vw - 32px)" }}>
            <h3 id="store-status-dialog-title" style={styles.modalStyles.title}>
              {pendingStoreStatusChange.nextActive ? "Activate Store?" : "Deactivate Store?"}
            </h3>
            {pendingStoreStatusChange.nextActive ? (
              <>
                <p>This store will again participate in:</p>
                <ul style={{ lineHeight: 1.8 }}>
                  <li>Auto Orders</li>
                  <li>Manual Orders</li>
                  <li>Reports</li>
                </ul>
              </>
            ) : (
              <>
                <p>This store will:</p>
                <ul style={{ lineHeight: 1.8 }}>
                  <li>Stop automatic orders</li>
                  <li>Reject manual orders</li>
                  <li>Be excluded from automatic reports</li>
                </ul>
                <p>Historical orders will remain available.</p>
              </>
            )}
            <div style={styles.modalStyles.actions}>
              <button
                type="button"
                onClick={() => setPendingStoreStatusChange(null)}
                style={styles.modalStyles.cancelButton}
                disabled={storeStatusUpdatingId !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmStoreStatusChange}
                style={{
                  ...styles.modalStyles.submitButton,
                  backgroundColor: pendingStoreStatusChange.nextActive ? "#16A34A" : "#DC2626",
                }}
                disabled={storeStatusUpdatingId !== null}
              >
                {storeStatusUpdatingId !== null
                  ? "Updating…"
                  : pendingStoreStatusChange.nextActive ? "Activate" : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
// ------------------------------------------
// ⭐ NEW: RENDER CHANNEL ADMINS SECTION
// ------------------------------------------
const renderChannelAdmin = () => {
    // Filter out partners and delivery partners, leaving only Channel Admins
    const channelAdmins = channelAdminsList || [];

    const renderAdminTable = () => (
    <div style={styles.tableCard}>
        <table style={styles.dataTable}>
            <thead>
                <tr style={styles.tableHeaderRow}>
                    <th style={styles.tableHeaderCell}>Full Name</th>
                    <th style={styles.tableHeaderCell}>Email</th>
                    <th style={styles.tableHeaderCell}>Channel</th>
                    <th style={styles.tableHeaderCell}>Status</th>
                    <th style={styles.tableHeaderCell}>Actions</th>
                </tr>
            </thead>

            <tbody>
                {channelAdmins.length > 0 ? (
                    channelAdmins.map((admin) => (
                        <tr key={admin.id} style={styles.tableRow}>
                            <td style={styles.tableCell}>{admin.full_name}</td>
                            <td style={styles.tableCell}>{admin.email}</td>
                            <td style={styles.tableCell}>{admin.channel || "N/A"}</td>

                            <td style={styles.tableCell}>
                                <span style={{
                                    ...styles.activityStatusBadge,
                                    backgroundColor: admin.status === "active" ? "#10B981" : "#D97706"
                                }}>
                                    {admin.status || "active"}
                                </span>
                            </td>

                            {/* ⭐ DELETE BUTTON HERE */}
                            <td style={styles.tableCell}>
                                <button
                                    onClick={() =>
                                        handleDeleteChannelAdmin(admin.id, admin.full_name)
                                    }
                                    style={{
                                        padding: "6px 14px",
                                        backgroundColor: "#D32F2F",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: "5px",
                                        cursor: "pointer",
                                        fontSize: "13px",
                                    }}
                                >
                                    Delete
                                </button>
                            </td>
                        </tr>
                    ))
                ) : (
                    <tr style={styles.tableRow}>
                        <td colSpan="5" style={{ ...styles.tableCell, textAlign: "center" }}>
                            No Channel Admins found.
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    </div>
);

    return (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>Channel Admin Management ({channelAdmins.length})</h2>

            {/* Existing Admins List */}
            <h3 style={{...styles.cardTitle, borderLeft: '5px solid #1565C0', paddingLeft: '15px'}}>Existing Channel Admins</h3>
            {renderAdminTable()}

            {/* Create Admin Form */}
            <div style={styles.formCard}>
                <h3 style={styles.cardTitle}>Create New Channel Admin</h3>
                <form style={styles.form} onSubmit={handleCreateChannelAdmin}>

                    {/* Full Name */}
                    <input
                      style={styles.textInput}
                      type="text"
                      placeholder="Full Name"
                      value={channelAdminName}
                      onChange={(e) => setChannelAdminName(e.target.value)}
                      required
                    />

                    {/* Email */}
                    <input
                      style={styles.textInput}
                      type="email"
                      placeholder="Email Address"
                      value={channelAdminEmail}
                      onChange={(e) => setChannelAdminEmail(e.target.value)}
                      required
                    />

                    {/* Password */}
                    <input
                      style={styles.textInput}
                      type="password"
                      placeholder="Password"
                      value={channelAdminPassword}
                      onChange={(e) => setChannelAdminPassword(e.target.value)}
                      required
                    />

                    {/* Channel Dropdown */}
            <label style={styles.selectStoresTitle}>Assign Channel</label>

            <select
              style={styles.textInput}
              value={channelAdminChannel}
              onChange={(e) => setChannelAdminChannel(e.target.value)}
            >
              <option value="BLINKIT">Blinkit</option>
              <option value="ZEPTO">Zepto</option>
              <option value="IBM">IBM</option>
              <option value="GENERAL">General</option>
              <option value="CUSTOM">Custom</option>
            </select>

            {/* 🔹 Show only when Custom is selected */}
            {channelAdminChannel === "CUSTOM" && (
              <input
                type="text"
                style={styles.textInput}
                placeholder="Enter Custom Channel Name"
                value={customChannelName}
                onChange={(e) => setCustomChannelName(e.target.value)}
                required
              />
            )}

            {/* Submit Button */}
            <button
              style={{ ...styles.button, backgroundColor: '#1565C0' }}
              type="submit"
            >
              Create Channel Admin
            </button>

                  </form>
            </div>
        </div>
    );
};

  const DPLinkingModal = ({ isVisible, onClose, manager, deliveryPartners, onLinkSubmit, styles, isLoading }) => {
    const [selectedDPId, setSelectedDPId] = useState('');

    if (!isVisible || !manager) return null;

    // --- FIX: Remove Restrictive City Filter ---
    // This filter now includes all active DPs that are currently UNASSIGNED (assigned_manager_id is null or 0).
    const unassignedDPs = deliveryPartners.filter(dp =>
        dp.role === "delivery" 
        && (!dp.assigned_manager_id || dp.assigned_manager_id === 0 || dp.assigned_manager_id === null)
        && (dp.status === 'active')
        // The previous restrictive city filter has been removed.
    );

    // Optional: Sort DPs by city for easier selection by the Super Admin
    unassignedDPs.sort((a, b) => (a.city || "").localeCompare(b.city || ""));

    // --- Handle form submission ---
    const handleLink = (e) => {
        e.preventDefault();
        if (selectedDPId) {
            // Call the handler to link the DP to the current manager
            onLinkSubmit(selectedDPId, manager.id);
        } else {
            alert('Please select a delivery partner to link.');
        }
    };

    return (
        <div style={styles.modalStyles.backdrop}>
            <div style={{ ...styles.modalStyles.modal, maxHeight: '80vh', width: '450px', overflowY: 'auto' }}>
                <h3 style={styles.modalStyles.title}>Link DP to Manager: {manager.full_name}</h3>
                <p style={styles.modalSubtitle}>DM Area: {manager.assigned_area || 'N/A'}</p>

                <form onSubmit={handleLink} style={styles.form}>
                    <label style={styles.reportLabel}>Select Unassigned Delivery Partner:</label>
                    <select
                        style={styles.textInput}
                        value={selectedDPId}
                        onChange={(e) => setSelectedDPId(e.target.value)}
                        required
                        disabled={isLoading || unassignedDPs.length === 0} // Disable if no DPs are available
                    >
                        <option value="">-- Select Partner --</option>
                        {unassignedDPs.map(dp => (
                            <option key={dp.id} value={dp.id}>
                                {dp.full_name} (City: {dp.city || 'N/A'})
                            </option>
                        ))}
                    </select>

                    {unassignedDPs.length === 0 && (
                        <p style={{ color: '#E74C3C', textAlign: 'center', marginTop: '10px' }}>
                            No active, unassigned DPs available to link in any city.
                        </p>
                    )}

                    <div style={styles.modalStyles.actions}>
                        <button type="button" onClick={onClose} style={styles.modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={styles.modalStyles.submitButton} disabled={isLoading || !selectedDPId}>
                            {isLoading ? 'Linking...' : 'Link Partner'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const uniqueCities = useMemo(() => {
  return [
    ...new Set(
      allStores
        .map(store => store.city)
        .filter(Boolean)
    )
  ];
}, [allStores]);

const uniqueChannels = useMemo(() => {
  return [
    "ALL",
    ...new Set(
      allStores
        .map(store => store.channel)
        .filter(Boolean)
        .map(ch => ch.toUpperCase())
    )
  ];
}, [allStores]);


const renderDeliveryManagers = () => {
  const canEditEmployeeManager = hasPermission("delivery_manager.edit");
  const canAssignManagerStores = !isEmployeeRole || hasPermission("delivery_manager.assign_store") || canEditEmployeeManager;
  const canRemoveManagerStores = !isEmployeeRole || canEditEmployeeManager;
  const canLinkDeliveryPartner = !isEmployeeRole || canEditEmployeeManager;
  const managerStorePool = isEmployeeRole ? freeManagerStores : allStores;
  // --------------------------------------------------
  // 1. DATA PREPARATION & FILTER LOGIC
  // --------------------------------------------------

  // Filter for the Main List (Existing Managers)
  const filteredManagers = (deliveryManagers || []).filter((dm) => {
    const searchTerm = (dmNameSearch || "").toLowerCase();
    const matchesSearch =
      !searchTerm ||
      (dm.full_name && dm.full_name.toLowerCase().includes(searchTerm)) ||
      (dm.email && dm.email.toLowerCase().includes(searchTerm));

    const cityMatch =
      storeFilterCity === "ALL" ||
      !storeFilterCity ||
      (isEmployeeRole
        ? dm.stores?.some((store) => store.city?.toLowerCase() === storeFilterCity.toLowerCase())
        : dm.assigned_area && dm.assigned_area.toLowerCase() === storeFilterCity.toLowerCase());

    // ⭐ CHANNEL FILTER LOGIC
    const channelMatch =
      storeFilterChannel === "ALL" ||
      !storeFilterChannel ||
      (dm.stores &&
        dm.stores.some(
          (s) =>
            s.channel?.toUpperCase() === storeFilterChannel.toUpperCase()
        ));

    return matchesSearch && cityMatch && channelMatch;
  });

  const managersWithTeamCount = filteredManagers.map((dm) => {
    if (isEmployeeRole) return dm;
    const dmId = Number(dm.id);
    const teamSize = (allDeliveryPartners || []).filter(
      (dp) => Number(dp.assigned_manager_id) === dmId
    ).length;

    let displayArea = dm.assigned_area;
    if (!displayArea || displayArea.toLowerCase() === "unassigned") {
      if (dm.stores && dm.stores.length > 0) {
        const cities = [...new Set(dm.stores.map((s) => s.city))].filter(Boolean);
        displayArea = cities.join(", ");
      } else {
        displayArea = "Unassigned";
      }
    }
    return { ...dm, teamSize, displayArea };
  });

  // Filter for Available Stores (For Registration Form)
  const filteredAvailableStores = (managerStorePool || []).filter((store) => {
    if (store.assigned_manager_id !== null) return false;
    
    // Applying Global Filters
    if (storeFilterCity !== "ALL" && storeFilterCity && store.city?.toLowerCase() !== storeFilterCity.toLowerCase()) return false;
    if (storeFilterChannel !== "ALL" && storeFilterChannel && store.channel?.toUpperCase() !== storeFilterChannel.toUpperCase()) return false;
    
    // ⭐ Search logic for Registration form assignment grid
    if (storeAssignmentSearch && !store.store_name.toLowerCase().includes(storeAssignmentSearch.toLowerCase())) {
        return false;
    }
    return true;
  });

  const normalizedCurrentInventorySearch =
    currentInventorySearch.toLowerCase().trim();

  // --------------------------------------------------
  // 2. UI HANDLERS & HELPERS (FIXED EXPANSION)
  // --------------------------------------------------
  const handleManagerRowClick = (managerId) => {
    // If clicking same row, close it. Else, open new and reset sub-search.
    if (expandedManagerId === managerId) {
        setExpandedManagerId(null);
    } else {
        setExpandedManagerId(managerId);
        setSelectedStoreIdsToAdd([]);
        setSelectedStoreIdsToRemove([]);
      setStoreAssignmentSearch("");
      setCurrentInventorySearch("");
    }
    if (isEmployeeRole && canAssignManagerStores) loadFreeManagerStores();
  };

  const handleReassignClick = (dp) => {
    setDpToReassign(dp);
    setIsReassignModalVisible(true);
  };

  return (
    <div style={{ ...styles.contentArea, padding: '25px', backgroundColor: '#F8FAFC' }}>
      
      {/* --- TOP BRANDED HEADER --- */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '30px',
        padding: '20px',
        backgroundColor: '#FFFFFF',
        borderRadius: '16px',
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: '#1E293B' }}>
            Store Management Hub
          </h2>
          <p style={{ margin: '4px 0 0 0', color: '#64748B', fontSize: '14px' }}>
            Managing {deliveryManagers.length} active Area Managers.
          </p>
        </div>
        <button
          onClick={handleDownloadDMStoresExcel}
          style={{
            backgroundColor: '#10B981',
            color: '#FFFFFF',
            border: 'none',
            padding: '12px 24px',
            borderRadius: '12px',
            cursor: 'pointer',
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 10px 15px -3px rgba(16, 185, 129, 0.2)'
          }}
        >
          <span>📊</span> Export Excel
        </button>
      </div>

      {/* --- QUICK STORE SEARCH (RESULT VIEW) --- */}
      <div style={{ marginBottom: '30px' }}>
          <div style={{ position: 'relative', maxWidth: '600px' }}>
            <input
              style={{ ...styles.textInput, width: '100%', height: '50px', paddingLeft: '50px', borderRadius: '12px', border: '2px solid #E2E8F0' }}
              placeholder="🔍 Search any store name to check its current manager..."
              value={storeSearch}
              onChange={(e) => { setStoreSearch(e.target.value); setSelectedStoreResult(null); }}
            />
            {storeSearch && storeSearchResults.length > 0 && !selectedStoreResult && (
              <div style={{ position: 'absolute', top: '55px', left: 0, right: 0, background: '#FFF', border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', zIndex: 1000, overflowY: 'auto', maxHeight: '250px' }}>
                {storeSearchResults.map((item, index) => (
                  <div key={index} style={{ padding: '12px 15px', cursor: 'pointer', borderBottom: '1px solid #F1F5F9' }} onClick={() => { setSelectedStoreResult(item); setStoreSearch(item.storeName); }}>
                    <div style={{ fontWeight: '700', color: '#334155' }}>🏪 {item.storeName}</div>
                    <div style={{ fontSize: '12px', color: '#64748B' }}>Managed by: <span style={{ color: '#2563EB', fontWeight: 'bold' }}>{item.managerName}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {selectedStoreResult && (
            <div style={{ marginTop: '15px', padding: '15px 20px', background: '#DBEAFE', borderRadius: '12px', border: '1px solid #BFDBFE', color: '#1E40AF', display: 'flex', alignItems: 'center' }}>
               <span>✅ <strong>{selectedStoreResult.storeName}</strong> is handled by <strong>{selectedStoreResult.managerName}</strong> ({selectedStoreResult.city})</span>
               <button onClick={() => {setSelectedStoreResult(null); setStoreSearch("");}} style={{ marginLeft: 'auto', background: '#FFFFFF', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
            </div>
          )}
      </div>

      {/* --- MASTER FILTER BAR (WITH CHANNEL & CITY) --- */}
      <div style={{ 
        display: 'flex', 
        gap: '12px', 
        padding: '15px', 
        backgroundColor: '#FFFFFF', 
        borderRadius: '12px', 
        marginBottom: '30px',
        border: '1px solid #E2E8F0'
      }}>
        <input 
          style={{ ...styles.textInput, flex: 2, marginBottom: 0, height: '45px', borderRadius: '10px' }} 
          placeholder="Filter by manager name..." 
          value={dmNameSearch || ""} 
          onChange={(e) => setDmNameSearch(e.target.value)} 
        />
        <select
          style={{ ...styles.textInput, flex: 1, marginBottom: 0, height: '45px', borderRadius: '10px' }}
          value={storeFilterCity}
          onChange={(e) => setStoreFilterCity(e.target.value)}
        >
          <option value="ALL">📍 All Regions</option>
          {uniqueCities.map((city) => <option key={city} value={city}>{city}</option>)}
        </select>
        
        {/* ⭐ CHANNEL FILTER UI */}
        <select
          style={{ ...styles.textInput, flex: 1, marginBottom: 0, height: '45px', borderRadius: '10px' }}
          value={storeFilterChannel}
          onChange={(e) => setStoreFilterChannel(e.target.value)}
        >
          {uniqueChannels.map((ch) => <option key={ch} value={ch}>{ch === "ALL" ? "🏷️ All Channels" : ch}</option>)}
        </select>

        <button 
          onClick={() => { setStoreFilterCity("ALL"); setStoreFilterChannel("ALL"); setDmNameSearch(""); }}
          style={{ padding: '0 20px', backgroundColor: '#64748B', color: '#FFF', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}
        >Reset</button>
      </div>

      {/* --- REGISTRATION FORM --- */}
      {!isEmployeeRole && <div style={{ backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '30px', marginBottom: '40px', border: '1px solid #E2E8F0' }}>
        <div style={{ borderLeft: '4px solid #3B82F6', paddingLeft: '15px', marginBottom: '25px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>Register New Area Manager</h3>
        </div>

        <form style={styles.form} onSubmit={handleCreateDeliveryManager}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <input style={{...styles.textInput, borderRadius: '10px'}} type="text" placeholder="Full Name" value={dmName} onChange={(e) => setDmName(e.target.value)} required />
            <input style={{...styles.textInput, borderRadius: '10px'}} type="email" placeholder="Login Email" value={dmEmail} onChange={(e) => setDmEmail(e.target.value)} required />
            <input style={{...styles.textInput, borderRadius: '10px'}} type="password" placeholder="Password" value={dmPassword} onChange={(e) => setDmPassword(e.target.value)} required />
            <input style={{...styles.textInput, borderRadius: '10px'}} type="tel" placeholder="Mobile" value={dmMobile} onChange={(e) => setDmMobilenumber(e.target.value)} />
          </div>

          <div style={{ marginTop: '25px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <p style={{ fontWeight: '700', fontSize: '14px', color: '#1E293B', margin: 0 }}>
                    Assign Primary Stores ({filteredAvailableStores.length} available):
                </p>
                <input 
                    type="text"
                    placeholder="🔍 Search stores to assign..."
                    value={storeAssignmentSearch}
                    onChange={(e) => setStoreAssignmentSearch(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '13px', width: '300px' }}
                />
            </div>
            
            <div style={{ 
              maxHeight: '220px', 
              overflowY: 'auto', 
              padding: '15px', 
              backgroundColor: '#F8FAFC', 
              borderRadius: '12px',
              border: '2px solid #E2E8F0',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '12px'
            }}>
              {filteredAvailableStores.length > 0 ? (
                filteredAvailableStores.map((store) => (
                  <label key={store.id} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    padding: '12px', 
                    backgroundColor: selectedStoreIdsDM.includes(store.id) ? '#DBEAFE' : '#FFFFFF',
                    borderRadius: '10px',
                    border: selectedStoreIdsDM.includes(store.id) ? '1px solid #3B82F6' : '1px solid #E2E8F0',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="checkbox"
                      style={{ marginRight: '12px' }}
                      checked={selectedStoreIdsDM.includes(store.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedStoreIdsDM((prev) => [...prev, store.id]);
                        else setSelectedStoreIdsDM((prev) => prev.filter((id) => id !== store.id));
                      }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: '#334155' }}>{store.store_name}</span>
                        <span style={{ fontSize: '11px', color: '#64748B' }}>{store.city}</span>
                    </div>
                  </label>
                ))
              ) : <p style={{ gridColumn: '1/-1', textAlign: 'center', color: '#94A3B8', padding: '20px' }}>No stores found.</p>}
            </div>
          </div>

          <button 
            style={{ 
              marginTop: '25px', padding: '16px', backgroundColor: '#2563EB', color: '#FFF', borderRadius: '12px', border: 'none', fontWeight: '800',
              cursor: (loading || selectedStoreIdsDM.length === 0) ? 'not-allowed' : 'pointer'
            }} 
            type="submit" 
            disabled={loading || selectedStoreIdsDM.length === 0}
          >
            {loading ? "⚙️ Saving..." : "✅ Register Manager & Assign Stores"}
          </button>
        </form>
      </div>}

      {/* --- MANAGER LIST TABLE --- */}
      <div style={{ backgroundColor: '#FFFFFF', borderRadius: '16px', overflow: 'hidden', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#1E293B', color: '#FFFFFF', textAlign: 'left' }}>
              <th style={{ padding: '18px 20px', fontSize: '13px' }}>MANAGER IDENTITY</th>
              {isEmployeeRole ? <>
                <th style={{ padding: '18px 20px', fontSize: '13px' }}>STORE COUNT</th>
                <th style={{ padding: '18px 20px', fontSize: '13px' }}>ASSIGNED STORES</th>
                <th style={{ padding: '18px 20px', fontSize: '13px', textAlign: 'center' }}>ACTIONS</th>
              </> : <>
                <th style={{ padding: '18px 20px', fontSize: '13px' }}>AREA</th>
                <th style={{ padding: '18px 20px', fontSize: '13px' }}>TEAM / STORES</th>
                <th style={{ padding: '18px 20px', fontSize: '13px', textAlign: 'center' }}>ACTIONS</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {managersWithTeamCount.map((dm) => {
              const isExpanded = expandedManagerId === dm.id;
              return (
                <React.Fragment key={dm.id}>
                  <tr 
                    style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer', backgroundColor: isExpanded ? '#F8FAFC' : 'transparent' }}
                    onClick={() => handleManagerRowClick(dm.id)}
                  >
                    <td style={{ padding: '20px' }}>
                      <div style={{ fontWeight: '800', color: '#1E293B' }}>{dm.full_name}</div>
                      <div style={{ fontSize: '12px', color: '#64748B' }}>{dm.email}</div>
                      {isEmployeeRole && dm.mobile_number && <div style={{ fontSize: '12px', color: '#64748B' }}>{dm.mobile_number}</div>}
                    </td>
                    {isEmployeeRole ? <>
                    <td style={{ padding: '20px', fontWeight: '700', color: '#2563EB' }}>{dm.assigned_store_count}</td>
                    <td style={{ padding: '20px' }}><div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {dm.stores.map((store) => <div key={store.id} style={{ padding: '6px 8px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '6px' }}>
                        <strong>{store.store_name}</strong>
                        {(store.city || store.channel) && <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>{[store.city, store.channel].filter(Boolean).join(' · ')}</div>}
                      </div>)}
                    </div></td>
                    <td style={{ padding: '20px', textAlign: 'center' }}><button style={miniBtn} onClick={(event) => { event.stopPropagation(); handleManagerRowClick(dm.id); }}>{isExpanded ? 'Close' : 'Edit'}</button></td>
                    </> : <><td style={{ padding: '20px' }}>
                      <span style={{ padding: '4px 12px', backgroundColor: '#F1F5F9', color: '#475569', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>{dm.displayArea}</span>
                    </td>
                    <td style={{ padding: '20px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#059669' }}>👥 {dm.teamSize} DPs</span>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#2563EB' }}>🏪 {dm.store_count} Stores</span>
                      </div>
                    </td>
                    </>}
                    {!isEmployeeRole && <td style={{ padding: '20px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button style={miniBtn} onClick={(e) => { e.stopPropagation(); setEditingManager(dm); setEditEmail(dm.email); setIsEditManagerModalVisible(true); }}>Edit</button>
                        <button style={{...miniBtn, backgroundColor: '#DBEAFE', color: '#2563EB'}} onClick={(e) => { e.stopPropagation(); handleOpenDPLinkModal(dm); }}>Link DP</button>
                        <button style={{...miniBtn, backgroundColor: '#FEE2E2', color: '#EF4444'}} onClick={(e) => { e.stopPropagation(); handleDeleteManager(dm.id, dm.full_name); }}>Delete</button>
                      </div>
                    </td>}
                  </tr>
                  
                  {/* ⭐ EXPANDED ROW LOGIC ⭐ */}
                  {isExpanded && (
                      <tr>
                        <td colSpan="4" style={{ padding: '0', backgroundColor: '#F8FAFC' }}>
                          <div style={{ padding: '30px', borderBottom: '1px solid #E2E8F0' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                              
                              {/* ASIGN NEW STORES */}
                              <div style={{ backgroundColor: '#FFF', padding: '20px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                                    <h4 style={{ margin: 0, fontSize: '14px', color: '#059669' }}>Assign Additional Stores</h4>
                                    <input 
                                        type="text" 
                                        placeholder="🔍 Search stores..." 
                                        value={storeAssignmentSearch}
                                        onChange={(e) => setStoreAssignmentSearch(e.target.value)}
                                        style={{padding:'4px 10px', borderRadius:'6px', border:'1px solid #DDD', fontSize:'12px'}}
                                    />
                                </div>
                                <select
                                  multiple
                                  disabled={!canAssignManagerStores}
                                  value={selectedStoreIdsToAdd}
                                  onChange={(e) => setSelectedStoreIdsToAdd(Array.from(e.target.selectedOptions).map(opt => String(opt.value)))}
                                  style={{ width: '100%', height: '120px', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '10px' }}
                                >
                                  {filteredAvailableStores.map((store) => (
                                    <option key={store.id} value={String(store.id)}>{store.store_name} ({store.city})</option>
                                  ))}
                                </select>
                                <button
                                  style={{ width: '100%', marginTop: '10px', padding: '10px', background: '#059669', color: '#FFF', border: 'none', borderRadius: '8px', fontWeight: '700' }}
                                  disabled={!canAssignManagerStores || selectedStoreIdsToAdd.length === 0}
                                  onClick={async () => { await handleAddStoresToExistingManager(dm.id, selectedStoreIdsToAdd); setSelectedStoreIdsToAdd([]); }}
                                >Assign Selected</button>
                              </div>

                              {/* REMOVE STORES */}
                              <div style={{ backgroundColor: '#FFF', padding: '20px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                                  <h4 style={{ margin: 0, fontSize: '14px', color: '#EF4444' }}>Current Store Inventory</h4>
                                  <input
                                    type="text"
                                    placeholder="🔍 Search Current Stores"
                                    value={currentInventorySearch}
                                    onChange={(e) => setCurrentInventorySearch(e.target.value)}
                                    style={{padding:'4px 10px', borderRadius:'6px', border:'1px solid #DDD', fontSize:'12px'}}
                                  />
                                </div>
                                <select
                                  multiple
                                  disabled={!canRemoveManagerStores}
                                  value={selectedStoreIdsToRemove}
                                  onChange={(e) => setSelectedStoreIdsToRemove(Array.from(e.target.selectedOptions).map(opt => String(opt.value)))}
                                  style={{ width: '100%', height: '120px', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '10px' }}
                                >
                                  {(dm.stores || [])
                                    .filter((store) => {
                                      if (!normalizedCurrentInventorySearch) return true;
                                      const term = normalizedCurrentInventorySearch;
                                      return (
                                        (store.store_name || '').toLowerCase().includes(term) ||
                                        (store.city || '').toLowerCase().includes(term) ||
                                        String(store.store_id || '').toLowerCase().includes(term) ||
                                        String(store.store_code || '').toLowerCase().includes(term) ||
                                        String(store.id || '').toLowerCase().includes(term) ||
                                        (store.channel || '').toLowerCase().includes(term)
                                      );
                                    })
                                    .map((store) => <option key={store.id} value={String(store.id)}>{store.store_name}</option>)}
                                </select>
                                <button
                                  style={{ width: '100%', marginTop: '10px', padding: '10px', background: '#EF4444', color: '#FFF', border: 'none', borderRadius: '8px', fontWeight: '700' }}
                                  disabled={!canRemoveManagerStores || selectedStoreIdsToRemove.length === 0}
                                  onClick={async () => { await handleRemoveStoresFromExistingManager(dm.id, selectedStoreIdsToRemove); setSelectedStoreIdsToRemove([]); }}
                                >Remove Selected</button>
                              </div>

                            </div>
                            <div style={{ marginTop: '30px' }}>
                              <ManagerTeamList manager={dm} allDeliveryPartners={allDeliveryPartners} onReassignClick={handleReassignClick} styles={styles} canReassign={canLinkDeliveryPartner} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
// Helper constant for buttons inside the table
const miniBtn = {
  padding: '6px 12px',
  borderRadius: '8px',
  border: 'none',
  fontSize: '12px',
  fontWeight: '700',
  cursor: 'pointer',
  transition: 'opacity 0.2s'
};





const renderUnassignedOrders = () => (
    <div style={styles.contentArea}>
        {/* Professional Alert Header */}
        <h2 style={{ ...styles.pageTitle, borderLeftColor: '#D32F2F', color: '#B71C1C' }}>
            🚨 Missing Distribution Managers ({orphanedOrders.length})
        </h2>
        <p style={{ marginBottom: '20px', color: '#666', fontSize: '14px' }}>
            The stores below have placed orders but are <strong>not linked to an Area Manager</strong>. 
            Assign a Delivery Manager immediately to route these orders.
        </p>

        {orphanedOrders.length === 0 ? (
            <div style={{ ...styles.tableCard, padding: '40px', textAlign: 'center', color: '#4CAF50' }}>
                <span style={{ fontSize: '40px' }}>✅</span>
                <p style={{ fontWeight: '600', marginTop: '10px' }}>All active orders are correctly covered by Delivery Managers.</p>
            </div>
        ) : (
            <div style={styles.tableCard}>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={{ ...styles.tableHeaderRow, backgroundColor: '#D32F2F' }}>
                            <th style={styles.tableHeaderCell}>Order ID</th>
                            <th style={styles.tableHeaderCell}>Store (POC)</th>
                            <th style={styles.tableHeaderCell}>Channel</th>
                            <th style={styles.tableHeaderCell}>Status</th>
                            <th style={styles.tableHeaderCell}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orphanedOrders.map((order) => (
                            <tr key={order.id} style={styles.tableRow}>
                                <td style={{ ...styles.tableCell, fontWeight: 'bold' }}>#{order.id}</td>
                                <td style={styles.tableCell}>
                                    <div style={{ fontWeight: '600' }}>{order.customerName}</div>
                                    <div style={{ fontSize: '11px', color: '#888' }}>ID: {order.outlet_code}</div>
                                </td>
                                <td style={styles.tableCell}>
                                    <span style={{ fontSize: '12px', color: '#1565C0', fontWeight: 'bold' }}>
                                        {order.channel}
                                    </span>
                                </td>
                                <td style={styles.tableCell}>
                                    <span style={{ ...styles.activityStatusBadge, backgroundColor: '#FFF3E0', color: '#E65100', border: '1px solid #FFE0B2' }}>
                                        Unrouted
                                    </span>
                                </td>
                                <td style={styles.tableCell}>
                                    {hasPermission(PERMISSIONS.ORDERS_ASSIGN) && <button 
                                        onClick={() => handleRouteOrderClick(order)}
                                        style={{
                                            ...styles.actionButton,
                                            backgroundColor: '#D32F2F',
                                            fontWeight: 'bold',
                                            boxShadow: '0 2px 4px rgba(211, 47, 47, 0.3)'
                                        }}
                                    >
                                        Assign DM
                                    </button>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
    </div>
);




  // ==========================
// 🔹 RENDER CONTENT HANDLER
const renderContent = () => {
  const activeSidebarItem = sidebarItems.find(
    (item) => sidebarItemTab(item) === currentTab
  );
  if (activeSidebarItem?.permission && !hasPermission(activeSidebarItem.permission)) {
    return <AccessDenied />;
  }

  const TAB_CONTENT = {
    dashboard: renderDashboard,
    orders: renderOrders,
    customerOrders: renderOrders,
    commercialOrders: renderOrders,
    orderManagement: renderOrders,
    unassignedOrders: renderUnassignedOrders,

    stores: renderActiveStoresList,
    activeStores: renderActiveStoresList,
    activeStoresList: renderActiveStoresList,
    storeManagement: renderActiveStoresList,

    createStoreManager: renderCreatePartner,
    createPartner: renderCreatePartner,
    storeManagers: renderMyPartners,
    storeManagersList: renderMyPartners,
    myPartners: renderMyPartners,

    deliveryPartner: renderDeliveryPartners,
    deliveryPartners: renderDeliveryPartners,
    deliveryManager: renderDeliveryManagers,
    deliveryManagers: renderDeliveryManagers,
    deliveryAreaManager: renderDeliveryManagers,

    qr: renderQrManagement,
    qrManagement: renderQrManagement,
    bottles: renderQrManagement,

    complaints: renderComplaints,
    complaintManagement: renderComplaints,
    reports: renderReports,
    testReports: renderReports,
    deliveryReports: renderReports,
    storeReports: renderReports,
    channelAdmin: renderChannelAdmin,

    storeCompliance: () => <StoreComplianceDashboard />,
    monthlyVirtualCards: () => <MonthlyVirtualCards />,
    blinkitReports: () => <BlinkitReports />,
    employees: () => <Employee />,
    employeeManagement: () => <Employee />,
    attendance: () => <AttendanceDashboard />,
    attendanceHistory: () => <AttendanceHistory />,
    leaveManagement: () => <LeaveManagement />,
    holidayManagement: () => <HolidayManagement />,
    holidays: () => <HolidayManagement />,
  };

  const renderTab = TAB_CONTENT[currentTab];
  if (renderTab) return renderTab();

  return (
    <div style={styles.contentArea}>
      <p style={styles.noDataText}>This module is not implemented yet.</p>
    </div>
  );
};

// ==========================
// 🔹 MAIN RETURN LAYOUT
return (
  <>
    {/* --- MAIN DASHBOARD LAYOUT --- */}
    <div
      className="dashboard-container"
      style={{ display: "flex", height: "100vh", overflow: "hidden" }}
    >
      {/* --- SIDEBAR --- */}
      <Sidebar
        className="sidebar"
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        orphanedOrdersCount={manualAssignmentOrders.length}
      />

      {/* --- MAIN CONTENT --- */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          overflow: "hidden",
        }}
      >
        {/* --- HEADER --- */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "#fff",
            padding: "15px 25px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
            flexShrink: 0,
            zIndex: 100,
          }}
        >
          <h1 style={{ margin: 0, color: "#102a43", fontSize: "22px" }}>
            AquaTrack Dashboard
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ color: "#102a43", fontWeight: 500 }}>Dashboard User</span>
            <button
              style={{
                backgroundColor: "#ff4d4f",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 16px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
              onClick={() => setLogoutDialogOpen(true)}
            >
              Logout
            </button>
          </div>
        </header>
        <LogoutConfirmationDialog open={logoutDialogOpen} onCancel={() => setLogoutDialogOpen(false)} onConfirm={handleLogout} />

        {/* --- MAIN BODY SECTION --- */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            backgroundColor: "#f4f6f8",
            padding: "20px 25px",
          }}
        >
          {loading && currentTab === "dashboard" ? (
            <p style={{ textAlign: "center", color: "#888" }}>
              Loading dashboard data...
            </p>
          ) : (
            renderContent()
          )}
        </div>
      </div>
    </div>

    {/* --- GLOBAL MODALS SECTION --- */}

{/* 🔴 ASSIGN DELIVERY MANAGER MODAL */}
{hasPermission(PERMISSIONS.ORDERS_ASSIGN) && isAssignDMModalVisible && (
  <div style={styles.modalStyles.backdrop}>
    <div style={{ ...styles.modalStyles.modal, width: "420px" }}>
      <h3 style={styles.modalStyles.title}>
        Assign Delivery Manager
      </h3>

      <p style={styles.modalSubtitle}>
        Order #{orderToAssignDM?.id} – {orderToAssignDM?.customerName}
      </p>

      <select
        style={styles.textInput}
        value={selectedDMId}
        onChange={(e) => setSelectedDMId(e.target.value)}
      >
        {/* 🔑 IMPORTANT: empty value, NOT "ALL" */}
        <option value="">-- Select Delivery Manager --</option>

        {deliveryManagers.map((dm) => (
          <option key={dm.id} value={String(dm.id)}>
            {dm.full_name} ({dm.assigned_area || dm.city || "N/A"})
          </option>
        ))}
      </select>

      <div style={styles.modalStyles.actions}>
        <button
          onClick={() => {
            setIsAssignDMModalVisible(false);
            setSelectedDMId(""); // reset on cancel
          }}
          style={styles.modalStyles.cancelButton}
        >
          Cancel
        </button>

        <button
          onClick={handleAssignDMConfirm}
          style={styles.modalStyles.submitButton}
          disabled={!selectedDMId} // 🔐 safe now
        >
          Assign DM
        </button>
      </div>
    </div>
  </div>
)}


    {/* --- EXISTING MODALS (UNCHANGED) --- */}
    {hasPermission(PERMISSIONS.COMPLAINTS_RESOLVE) && <SolutionModal
      isVisible={isSolutionModalVisible}
      onClose={handleCloseModal}
      onSubmit={handleSolutionSubmit}
      complaintId={currentComplaintId}
      solutionText={solutionText}
      setSolutionText={setSolutionText}
      isLoading={resolvingComplaint}
      modalStyles={styles.modalStyles}
    />}

    <AssignBottleModal
      isVisible={qrAssigning}
      onClose={() => setQrAssigning(false)}
      selectedBottlesToAssign={selectedBottlesToAssign}
      approvedDeliveryPartners={approvedDeliveryPartners}
      onAssign={handleAssignBottlesToPartner}
      modalStyles={styles.modalStyles}
    />

    <PartnerDetailsModal
      isVisible={isPartnerDetailsModalVisible}
      onClose={() => setIsPartnerDetailsModalVisible(false)}
      onApprove={handleApprovePartner}
      partner={selectedPartnerForDetails}
      isLoading={loading}
      modalStyles={styles.modalStyles}
    />

    <DPLinkingModal
      isVisible={isDPLinkingModalVisible}
      onClose={() => setIsDPLinkingModalVisible(false)}
      manager={managerToLink}
      deliveryPartners={allDeliveryPartners}
      selectedDPId={selectedDPId}
      setSelectedDPId={setSelectedDPId}
      onLinkSubmit={handleLinkSubmit}
      styles={styles}
      isLoading={loading}
    />

    <ReassignDPModal
      isVisible={isReassignModalVisible}
      onClose={() => setIsReassignModalVisible(false)}
      dp={dpToReassign}
      managers={deliveryManagers}
      onMoveSubmit={handleMoveDPSubmit}
      styles={styles}
      isLoading={loading}
    />

    <EditManagerModal
      isVisible={isEditManagerModalVisible}
      onClose={() => {
        setIsEditManagerModalVisible(false);
        setEditPassword(""); // Reset password field for safety
      }}
      onSubmit={handleUpdateManager}
      manager={editingManager}
      email={editEmail}
      setEmail={setEditEmail}
      password={editPassword}
      setPassword={setEditPassword}
      isLoading={updatingManager}
      styles={styles}
    />


    <EditStoreModal
      isVisible={isEditStoreModalVisible}
      onClose={() => setIsEditStoreModalVisible(false)}
      onSubmit={handleEditStoreSubmit}
      name={editStoreName} setName={setEditStoreName}
      address={editStoreAddress} setAddress={setEditStoreAddress}
      city={editStoreCity} setCity={setEditStoreCity}
      isLoading={loading} styles={styles}
    />
  </>
);
};

const styles = {
  dashboardLayout: {
    display: 'flex',
    minHeight: '100vh',
    height: '100vh', // full screen height
    width: '100vw',
    backgroundColor: '#F0F2F5', 
    fontFamily: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  sidebar: {
    width: '260px',
    backgroundColor: '#2C3E50', 
    color: '#ECF0F1', 
    padding: '25px 0',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '4px 0 10px rgba(0,0,0,0.15)',
  },
  sidebarHeader: {
    padding: '0 25px 30px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    marginBottom: '20px',
  },
  sidebarHeaderTitle: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#4CAF50', 
  },
  sidebarNav: {
    flexGrow: 1,
    padding: '0 15px',
    overflowY: 'auto',
  },
  sidebarGroup: {
    margin: '16px 20px 8px',
    color: '#64748b',
    fontSize: '11px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 15px',
    borderRadius: '8px',
    marginBottom: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease, color 0.2s ease',
    fontSize: '16px',
    color: '#ECF0F1',
  },
  sidebarItemActive: {
    backgroundColor: '#4CAF50', 
    color: '#FFFFFF',
    fontWeight: '600',
  },
  sidebarIcon: {
    fontSize: '20px',
    marginRight: '15px',
  },
  sidebarText: {
    // Inherits color from sidebarItem
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sidebarTextActive: {
    // Inherits color from sidebarItemActive
  },
  mainPanel: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  topHeader: {
    backgroundColor: '#FFFFFF',
    padding: '15px 25px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #E0E0E0',
  },
  headerTitle: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#333',
    margin: 0,
  },
  userProfile: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  userName: {
    fontSize: '16px',
    fontWeight: '500',
    color: '#555',
  },
  logoutButton: {
    padding: '8px 16px',
    backgroundColor: '#E74C3C', 
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
  },
  mainContentArea: {
    flexGrow: 1,
    padding: '20px 25px',
    overflowY: 'auto',
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    textAlign: 'center',
    fontSize: '18px',
    marginTop: '50px',
    color: '#6B7280',
  },
  contentArea: {
    // This wrapper is for the actual content of each tab
  },
  // --- Dashboard specific styles ---
  kpiRow: {
    display: 'grid',
    // Adjust grid template to accommodate 6 cards (2 rows of 3, or 2 rows of 4 + 2 rows of 2, etc.)
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  statCard: {
    borderRadius: '12px',
    padding: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
    cursor: 'pointer',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  },
  statIcon: {
    fontSize: '36px',
    // color inherited from statCard
  },
  statContent: {
    flex: 1,
  },
  statValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    margin: '0',
  },
  statLabel: {
    fontSize: '14px',
    color: 'rgba(0,0,0,0.7)',
    margin: '0',
  },
  mainContentGrid: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr', 
    gap: '30px',
    marginBottom: '30px',
  },
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    padding: '25px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
  },
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    padding: '25px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
  },
  cardTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '20px',
    borderBottom: '1px solid #EEE',
    paddingBottom: '10px',
  },
  chartPlaceholder: {
    height: '250px',
    backgroundColor: '#F8F9FA',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    color: '#888',
    fontSize: '16px',
    border: '1px dashed #DDD',
    flexDirection: 'column', // Allow content to stack vertically
  },
  activityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  activityItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '10px',
    borderBottom: '1px solid #F5F5F5',
  },
  activityText: {
    fontSize: '15px',
    color: '#555',
  },
  activityOrderId: {
    fontWeight: '600',
    color: '#4CAF50',
  },
  activityCustomerName: {
    fontWeight: '500',
    color: '#2C3E50',
  },

  // --- General Table and Form styles ---
  dataTable: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeaderRow: {
    backgroundColor: '#4CAF50', 
    color: '#FFFFFF',
    textAlign: 'left',
  },
  tableHeaderCell: {
    padding: '15px 20px',
    fontWeight: '600',
    fontSize: '14px',
  },
  tableRow: {
    borderBottom: '1px solid #ECEFF1',
    transition: 'background-color 0.2s ease',
  },
  tableCell: {
    padding: '12px 20px',
    color: '#444',
    fontSize: '14px',
  },
  actionButton: {
    padding: '8px 15px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2196F3', 
    color: '#FFFFFF',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    textDecoration: 'none',
    transition: 'background-color 0.2s ease',
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    padding: '30px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
    marginBottom: '30px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  // 🌟 NEW STYLES FOR DATE PICKER IN ORDERS TAB 🌟
  datePickerRow: { 
    display: 'flex', 
    gap: '15px', 
    alignItems: 'center', 
    marginBottom: '15px', 
  },
  dateInputContainer: {
    position: 'relative',
    flex: 1,
  },
  dateInput: {
    width: '100%',
    padding: '12px 15px',
    borderRadius: '8px',
    border: '1px solid #DCE0E6',
    fontSize: '16px',
    color: '#333',
    outline: 'none',
    boxSizing: 'border-box',
    background: '#fff',
  },
  clearButton: { 
    background: '#F5F5F5', 
    border: '1px solid #E74C3C', 
    color: '#E74C3C', 
    fontWeight: '600', 
    borderRadius: '8px', 
    padding: '10px 15px', 
    cursor: 'pointer', 
    fontSize: '14px', 
    height: '44px', 
    flexShrink: 0,
  },

  // --- New Report Specific Styles ---
  reportsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 30px 10px',
    borderBottom: '1px solid #E0E0E0',
    marginBottom: '10px',
  },
  reportUploadForm: {
    display: 'flex',
    gap: '20px',
    alignItems: 'flex-end',
    padding: '0 0 10px 0',
  },
  reportFormGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flex: 1,
  },
  reportLabel: {
    fontWeight: '500',
    color: '#555',
    fontSize: '14px',
  },
  fileInput: {
    border: '1px solid #DCE0E6',
    borderRadius: '8px',
    padding: '10px',
    backgroundColor: '#F8F9FA',
  },
  secondaryButton: {
    backgroundColor: '#1565C0', // Blue for export
    color: '#FFFFFF',
    padding: '10px 20px',
    borderRadius: '6px',
    border: 'none',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '16px',
    transition: 'background-color 0.2s ease',
  },
  // --- Existing form styles adjusted for reports
  textInput: {
    padding: '12px 15px',
    borderRadius: '8px',
    border: '1px solid #DCE0E6',
    fontSize: '16px',
    color: '#333',
    outline: 'none',
    transition: 'border-color 0.2s ease',
  },
  button: {
    padding: '14px 25px',
    borderRadius: '8px',
    border: 'none',
    color: '#FFFFFF',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '16px',
    transition: 'background-color 0.2s ease',
  },
  primaryButton: {
    backgroundColor: '#4CAF50', // Green primary button
  },
  // --- Partner Creation Store Dropdown Styles (FIXED FOR REACT) ---
    selectStoresTitle: { fontSize: '16px', fontWeight: '600', color: '#333', marginBottom: '10px', display: 'block' },
    storeList: {
        maxHeight: '300px',
        overflowY: 'auto',
        border: '1px solid #DCE0E6',
        borderRadius: '8px',
        padding: '10px',
        backgroundColor: '#F8F9FA',
    },
    checkboxContainer: {
        display: 'flex',
        alignItems: 'center',
        padding: '8px 5px',
        cursor: 'pointer',
        borderBottom: '1px dashed #EEE',
    },
    checkboxLabel: {
        marginLeft: '10px',
        fontSize: '14px',
        color: '#333',
    },
  // --- QR Management Styles (PORTED AND CLEANED) ---
    generatedQrContainer: {
        marginTop: '25px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px',
        backgroundColor: '#F9FAFB',
        borderRadius: '10px',
        border: '1px solid #E0E0E0',
    },
    qrCodeWrapper: {
        backgroundColor: '#FFFFFF',
        padding: '10px',
        borderRadius: '8px',
        marginBottom: '15px',
        border: '1px solid #DDD',
    },
    qrPlaceholder: {
        width: '150px',
        height: '150px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#ECEFF1',
        color: '#888',
        fontSize: '12px',
        margin: 0,
    },
    generatedQrText: {
        fontSize: '18px',
        fontWeight: '600',
        color: '#333',
        marginBottom: '10px',
    },
    qrCodeLabel: {
        fontSize: '16px',
        color: '#4CAF50',
        fontWeight: 'bold',
        marginBottom: '15px',
        wordBreak: 'break-all',
        textAlign: 'center',
    },
    copyButton: {
        padding: '10px 15px',
        backgroundColor: '#6B7280',
        color: '#FFFFFF',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: '600',
    },
    bottleList: {
        maxHeight: '300px', 
        overflowY: 'auto',
        border: '1px solid #E0E0E0',
        borderRadius: '8px',
        padding: '10px',
        backgroundColor: '#FFFFFF',
        marginBottom: '10px',
    },
  // --- QR Table Button Styles ---
  qrCopyBtn: {
    background: 'none',
    border: '1px solid #007bff',
    color: '#007bff',
    padding: '3px 6px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '10px',
    fontWeight: '600',
  },
  qrCodeLabel: {
    fontSize: '12px',
    color: '#555',
    marginTop: '5px',
    fontFamily: 'monospace',
  },

  // --- Modal Styles ---
  modalStyles: {
    backdrop: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
    },
    modal: {
        backgroundColor: '#FFFFFF',
        padding: '30px',
        borderRadius: '12px',
        width: '400px',
        maxWidth: '90%',
        boxShadow: '0 8px 20px rgba(0, 0, 0, 0.2)',
    },
    title: {
        fontSize: '20px',
        fontWeight: '600',
        color: '#333',
        marginBottom: '20px',
    },
    textarea: {
        width: '100%',
        padding: '10px',
        borderRadius: '6px',
        border: '1px solid #DCE0E6',
        fontSize: '15px',
        resize: 'vertical',
        marginBottom: '20px',
        outline: 'none',
    },
    actions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '10px',
    },
    cancelButton: {
        padding: '10px 18px',
        borderRadius: '6px',
        border: '1px solid #CCC',
        backgroundColor: '#F5F5F5',
        color: '#333',
        cursor: 'pointer',
    },
    submitButton: {
        padding: '10px 18px',
        borderRadius: '6px',
        border: 'none',
        backgroundColor: '#4CAF50',
        color: '#FFFFFF',
        fontWeight: '600',
        cursor: 'pointer',
    }
  },
modalSubtitle: {
        fontSize: '16px',
        color: '#6B7280',
        marginBottom: '20px',
        textAlign: 'left',
        borderBottom: '1px solid #EEE',
        paddingBottom: '15px'
  },
  detailsColumn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  detailItem: {
    display: 'flex',
    flexDirection: 'column',
  },
  detailLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#555',
    margin: '0 0 4px 0',
  },
  detailValue: {
    fontSize: '15px',
    color: '#333',
    margin: '0',
    wordBreak: 'break-word',
  },


   input: {
    padding: "8px",
    borderRadius: "8px",
    border: "1px solid #ccc"
  },

  exportButton: {
    background: "#222",
    color: "#fff",
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer"
  },

  assignBtn: {
    background: "#2196F3",
    color: "#fff",
    border: "none",
    padding: "6px 10px",
    borderRadius: "6px",
    cursor: "pointer"
  },

  viewBtn: {
    background: "#4CAF50",
    color: "#fff",
    border: "none",
    padding: "6px 10px",
    borderRadius: "6px",
    cursor: "pointer"
  }, 

  imageItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  detailImage: {
    width: '100%',
    maxWidth: '250px',
    height: 'auto',
    borderRadius: '8px',
    border: '1px solid #DDD',
    backgroundColor: '#F8F8F8',
  },
  
  button: {
  marginTop: "20px",
  width: "100%",
  padding: "12px",
  backgroundColor: "#28a745",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  fontSize: "16px",
  cursor: "pointer",
  fontWeight: "600",
  textAlign: "center",
},

sidebar: {
    width: '260px',
    minWidth: '260px',
    maxWidth: '260px',
    flex: '0 0 260px',
    height: '100vh',
    backgroundColor: '#1a2a44',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 20px',
    backgroundColor: 'transparent',
    color: '#a0aec0',
    border: 'none',
    width: '100%',
    boxSizing: 'border-box',
    cursor: 'pointer',
    textAlign: 'left',
    minHeight: '44px',
    lineHeight: 1.25,
    transition: 'background-color 0.2s ease, color 0.2s ease'
  },
  sidebarItemActive: {
    backgroundColor: '#2d3748',
    color: '#fff',
    borderLeft: '4px solid #4CAF50'
  },
  sidebarIcon: { width: '22px', minWidth: '22px', marginRight: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '20px' },
  pageTitle: {
        fontSize: '24px',
        fontWeight: '700',
        color: '#102A43',
        marginBottom: '20px',
        borderLeft: '6px solid #4CAF50',
        paddingLeft: '15px',
        display: 'flex',
        alignItems: 'center',
    },

    // Refined table card to match your active tabs
    tableCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        overflow: 'hidden',
        border: '1px solid #E0E4E8',
        marginBottom: '30px',
    },

    // Status badge for a clean pill look
    activityStatusBadge: {
        padding: '4px 12px',
        borderRadius: '20px',
        fontSize: '11px',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
    },

    // Grid details for better spacing
    detailsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '20px',
        marginTop: '15px'
    }

  

  
};

  
export default SuperAdminDashboard;
