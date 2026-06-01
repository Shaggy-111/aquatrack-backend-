import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from './config'; 
import Reports from './pages/Reports';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// --- Configuration ---
const BOTTLE_PRICE = 42; 

// --- Helper Functions ---
const backendToUiStatus = (s) => {
    if (!s) return 'Unknown';
    const status = s.toLowerCase();
    
    if (status === 'pending') return 'Pending';
    
    // Change Accepted or Assigned_to_manager to "Assign to Delivery Partner"
    if (status === 'accepted' || status === 'assigned_to_manager') return 'Assign to Delivery Partner';
    
    if (status === 'in_transit') return 'In Transit';
    
    // Change Resolved or Delivered_Confirmed to "Delivered"
    if (status === 'delivered' || status === 'resolved' || status === 'delivered_confirmed') return 'Delivered';
    
    if (status === 'cancelled') return 'Cancelled';
    
    return s;
};

// --- Export Helper (Simulated XLSX functionality for CSV) ---
const exportOrdersToCSV = (orders, channelName) => {
    if (orders.length === 0) {
        alert("No orders available to export.");
        return;
    }

    const headers = [
        "Order ID",
        "Store Name",
        "Order Bottles",
        "Ordered By",
        "Order Date",
        "Delivery By",
        "Delivered Bottles",
        "Delivery Date",
        "Vehicle",
        "Status",
        "Proof (Photo URL)"
    ];

    const csvData = orders.map(order => {
        const escape = (value) => `"${String(value ?? 'N/A').replace(/"/g, '""')}"`;

        return [
            escape(`#${order.id}`),

            // ✅ FIX (no undefined)
            escape(order.storeName || 'N/A'),

            order.bottles,

            escape(order.partnerName || 'N/A'),

            escape(order.formattedOrderDate || 'N/A'),

            escape(order.deliveryPartnerName || 'Not Assigned'),

            order.deliveredBottles || 0,

            escape(
                order.deliveryDate
                    ? new Date(order.deliveryDate).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })
                    : 'Not Delivered'
            ),

            escape(order.vehicleInfo || 'N/A'),

            escape(order.status || 'N/A'),

            // ✅ Photo link
            escape(
                order.deliveryPhoto
                    ? `${API_BASE_URL}${order.deliveryPhoto}`
                    : 'N/A'
            )
        ].join(',');
    });

    const csvContent = [headers.join(','), ...csvData].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');

    const today = new Date().toISOString().slice(0, 10);
    const filename = `${channelName}_Orders_${today}.csv`;

    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(link.href);

    alert('✅ Export done successfully!');
};


// --- Reusable Components ---
const StatCard = ({ label, value, icon, bgColor, textColor, onPress }) => (
    <div
        style={{ ...styles.statCard, backgroundColor: bgColor, color: textColor }}
        onClick={onPress}
        onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-6px)';
            e.currentTarget.style.boxShadow = '0 10px 25px rgba(0,0,0,0.1)';
        }}
    >
        <div style={styles.statIcon}>{icon}</div>
        <div style={styles.statContent}>
            <p style={styles.statValue}>{value}</p>
            <p style={styles.statLabel}>{label}</p>
            
        </div>
    </div>
);

const SidebarItem = ({ label, icon, name, active, onSelect }) => (
    <button
        key={name}
        style={{ ...styles.sidebarItem, ...(active ? styles.sidebarItemActive : {}) }}
        
        onClick={() => onSelect(name)}

        // 🔥 YAHAN ADD KARNA HAI
        onMouseEnter={(e) => {
            if (!active) e.currentTarget.style.backgroundColor = '#F3F4F6';
        }}
        onMouseLeave={(e) => {
            if (!active) e.currentTarget.style.backgroundColor = 'transparent';
        }}
    >
        <span style={styles.sidebarIcon}>{icon}</span>
        <span style={styles.sidebarText}>{label}</span>
    </button>
);

const Sidebar = ({ currentTab, onSelectTab, channelName }) => (
    <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
            
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '2px'
            }}>

                {/* LOGO + NAME */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <span style={{ fontSize: '18px' }}>💧</span>

                    <span style={{
                        fontSize: '16px',
                        fontWeight: '600',
                        color: '#111827'
                    }}>
                        Veekay AquaTrack
                    </span>
                </div>

                {/* SUBTITLE */}
                <span style={{
                    fontSize: '12px',
                    color: '#6B7280'
                }}>
                    Customer Admin Portal
                </span>

            </div>

        </div>
        <nav style={styles.sidebarNav}>
            <SidebarItem label="Dashboard" icon="🏠" name="dashboard" active={currentTab === 'dashboard'} onSelect={onSelectTab} />
            <SidebarItem label="Orders" icon="📦" name="orders" active={currentTab === 'orders'} onSelect={onSelectTab} />
            <SidebarItem label="Unassigned Orders" icon="🚫" name="unassignedOrders" active={currentTab === 'unassignedOrders'} onSelect={onSelectTab} />
            <SidebarItem label="Stores" icon="🏬" name="stores" active={currentTab === 'stores'} onSelect={onSelectTab} />
            <SidebarItem label="My POC" icon="🤝" name="partners" active={currentTab === 'partners'} onSelect={onSelectTab} />
            <SidebarItem label="Complaints" icon="💬" name="complaints" active={currentTab === 'complaints'} onSelect={onSelectTab} />           
            <SidebarItem label="Reports" icon="📊" name="reports" active={currentTab === 'reports'} onSelect={onSelectTab} />
        </nav>
    </aside>
);

// --- Complaint Resolution Modal Component ---
const ComplaintResolutionModal = ({ isVisible, onClose, onSubmit, complaint, solutionText, setSolutionText, isLoading }) => {
    if (!isVisible || !complaint) return null;

    const handleFormSubmit = (e) => {
        e.preventDefault();
        onSubmit(e);
    };

    return (
        <div style={styles.modalStyles.backdrop}>
            <div style={styles.modalStyles.modal}>
                <h3 style={styles.modalStyles.title}>Resolve Complaint #{complaint.id}</h3>
                <p style={styles.modalSubtitle}>**Subject:** {complaint.subject}</p>
                <p style={styles.modalSubtitle}>**Raised By:** {complaint.created_by?.full_name || 'N/A'}</p>
                <p style={styles.modalSubtitle}>**Description:** {complaint.description}</p>
                <form onSubmit={handleFormSubmit}>
                    <textarea
                        style={styles.modalStyles.textarea}
                        placeholder="Enter your resolution message..."
                        value={solutionText}
                        onChange={(e) => setSolutionText(e.target.value)}
                        required
                        rows={5}
                        disabled={isLoading}
                    />
                    <div style={styles.modalStyles.actions}>
                        <button type="button" onClick={onClose} style={styles.modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={styles.modalStyles.submitButton} disabled={isLoading || !solutionText.trim()}>
                            {isLoading ? 'Resolving...' : 'Submit Resolution'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const OrderCard = ({ order }) => {
    const statusColor = order.status === 'Delivered' ? '#2E7D32' : order.status === 'Pending' ? '#EF6C00' : '#1565C0';

    return (
        <div style={styles.orderCard}>
            <div style={styles.cardHeader}>
                <span style={styles.orderId}>Order #{order.id}</span>
                <span style={{ ...styles.cardStatus, backgroundColor: statusColor }}>
                    {order.status}
                </span>
            </div>
            
            <div style={styles.cardBody}>
                <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Store ID:</span>
                    <span style={styles.infoValue}>{order.storeId}</span>
                </div>
                <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Store Name:</span>
                    <span style={styles.infoValue}>{order.storeName}</span>
                </div>
                <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Store POC:</span>
                    <span style={{...styles.infoValue, color: '#00796B', fontWeight: 'bold'}}>{order.pocName}</span>
                </div>
                <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Delivery Partner:</span>
                    <span style={{...styles.infoValue, color: '#1565C0'}}>{order.deliveryPartnerName}</span>
                </div>
                
                <hr style={styles.divider} />
                
                <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Order Date:</span>
                    <span style={styles.dateValue}>{order.formattedOrderDate}</span>
                </div>
                <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Delivery Date:</span>
                    <span style={order.deliveryDate ? styles.dateValue : styles.notDelivered}>
                        {order.deliveryDate ? order.deliveryDate.toLocaleString() : '❌ Not Delivered Yet'}
                    </span>
                </div>
            </div>
            
            <div style={styles.cardFooter}>
                <span style={styles.bottleBadge}>🧴 {order.bottles} Bottles</span>
            </div>
        </div>
    );
};

const ChannelAdminDashboard = () => {
    const [loading, setLoading] = useState(true);
    const [currentTab, setCurrentTab] = useState('dashboard');
    const [channelName, setChannelName] = useState(localStorage.getItem('channel_name') || "CHANNEL"); 
    const [cityFilter, setCityFilter] = useState("ALL");
    
    // Data states for tabs
    const [storesList, setStoresList] = useState([]);
    const [statusFilter, setStatusFilter] = useState('ALL'); // Default show all
    const [partnersList, setPartnersList] = useState([]);
    const [channelOrders, setChannelOrders] = useState([]); 
    const [channelComplaints, setChannelComplaints] = useState([]);
    const [reports, setReports] = useState([]);
    const [reportsTab, setReportsTab] = useState("monthly");
    const [previewImage, setPreviewImage] = useState(null);
    const [startDate, setStartDate] = useState('');
    const [search, setSearch] = useState('');
    const [endDate, setEndDate] = useState('');
    
    

    const [dashboardData, setDashboardData] = useState({
        totalStores: 0,
        totalPartners: 0,
        totalOrders: 0,
        pendingOrders: 0, 
        pendingComplaints: 0, // NEW KPI
    });
    const navigate = useNavigate();

    const orphanedOrders = useMemo(() => {

    return channelOrders.filter(order => {

        // ✅ find store (IMPORTANT FIX)
        const store = storesList.find(s => s.id === order.storeId);

        if (!store) return false;

        // ✅ city filter apply
        if (cityFilter !== "ALL" && store.city !== cityFilter) {
            return false;
        }

        // ✅ orphan logic
        return (
            !store.assigned_manager_id &&
            order.status !== 'Delivered'
        );
    });

}, [channelOrders, storesList, cityFilter]);

    // Complaint Resolution States
    const [selectedComplaint, setSelectedComplaint] = useState(null);
    const [solutionText, setSolutionText] = useState("");
    const [showResolveModal, setShowResolveModal] = useState(false);
    const [resolvingComplaint, setResolvingComplaint] = useState(false);

    // New Partner Creation State
    const [newPartnerName, setNewPartnerName] = useState("");
    const [newPartnerEmail, setNewPartnerEmail] = useState("");
    const [newPartnerPassword, setNewPartnerPassword] = useState("");
    const [newPartnerMobile, setNewPartnerMobile] = useState("");
    const [dateFilter, setDateFilter] = useState("ALL");


    const getFilteredByDate = (orders) => {
    if (dateFilter === "ALL") return orders;

    const now = new Date();

    return orders.filter(order => {
        if (!order.orderDate) return false;

        const orderDate = new Date(order.orderDate);

        const diffDays = (now - orderDate) / (1000 * 60 * 60 * 24);

        if (dateFilter === "YESTERDAY") return diffDays >= 1 && diffDays < 2;
        if (dateFilter === "7DAYS") return diffDays <= 7;
        if (dateFilter === "15DAYS") return diffDays <= 15;
        if (dateFilter === "30DAYS") return diffDays <= 30;

        return true;
    });
};



    const formatReportMonth = (dateString) => {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch (e) {
        return dateString;
    }
};

    // --- Logout Handler ---
    const handleLogout = () => {
        ['auth_token', 'userToken', 'partner_token', 'user_role', 'channel_name'].forEach(key => localStorage.removeItem(key));
        alert('You have been logged out.');
        navigate('/login'); 
    };

    // --- Core Action: Create Partner for this Channel ---
    const handleCreateChannelPartner = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem("auth_token");
        const channel = channelName; 

        if (!token) {
            alert("Authentication token missing. Please log in again.");
            handleLogout();
            return;
        }

        if (!newPartnerName || !newPartnerEmail || !newPartnerPassword) {
            alert("Please fill in all required partner fields.");
            return;
        }

        setLoading(true);
        try {
            const response = await axios.post(
                `${API_BASE_URL}/partners/channel-admin/create-partner`,
                {
                    full_name: newPartnerName,
                    email: newPartnerEmail,
                    password: newPartnerPassword,
                    mobile_number: newPartnerMobile,
                    channel: channel, 
                    role: 'partner'
                },
                {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                }
            );

            alert(`✅ Partner ${newPartnerName} created successfully under channel ${channel}!`);
            
            // Clear form and refresh data
            setNewPartnerName("");
            setNewPartnerEmail("");
            setNewPartnerPassword("");
            setNewPartnerMobile("");
            const freshToken = localStorage.getItem("auth_token");
            fetchData(freshToken, channel); 
            setCurrentTab('partners');

        } catch (error) {
            console.error("Error creating channel partner:", error.response?.data || error.message);
            alert(error.response?.data?.detail || "Failed to create channel partner. Check if user already exists.");
        } finally {
            setLoading(false);
        }
    };


    const openImageModal = (img) => {
        setPreviewImage(`${API_BASE_URL}${img}`);
    };

    const closeImageModal = () => {
        setPreviewImage(null);
    };

    // --- Core Action: Fetch Complaints for this Channel ---
    const fetchChannelComplaints = async (token) => {
        try {
            const res = await axios.get(
                `${API_BASE_URL}/complaints/complaints/channel-admin/my-channel`,
                { headers: { Authorization: `Bearer ${token}` } }
            );

            setChannelComplaints(res.data);

            setDashboardData((prev) => ({
                ...prev,
                pendingComplaints: res.data.filter((c) => c.status?.toLowerCase() === "pending").length,
            }));
        } catch (err) {
            console.log("Error loading channel complaints", err);
            setChannelComplaints([]);
            setDashboardData((prev) => ({ ...prev, pendingComplaints: 0 }));
        }
    };




    const fetchReports = async (token) => {
        try {
            const res = await axios.get(`${API_BASE_URL}/reports/reports/list`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setReports(res.data);
        } catch (err) {
            console.error("Error fetching reports", err);
        }
    };

    const handleReportDownload = async (reportId) => {
        const token = localStorage.getItem('auth_token');
        try {
            const response = await axios.get(`${API_BASE_URL}/reports/reports/download/${reportId}`, {
                headers: { Authorization: `Bearer ${token}` },
                responseType: 'blob',
            });

            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            window.open(url, '_blank');
        } catch (error) {
            alert("Report file could not be opened. It may have been removed from the server.");
        }
    };
    // --- Complaint Resolution Handlers ---

    const handleResolveClick = (complaint) => {
        setSelectedComplaint(complaint);
        setSolutionText('');
        setShowResolveModal(true);
    };

    const handleCloseModal = () => {
        setShowResolveModal(false);
        setSelectedComplaint(null);
        setSolutionText('');
    };


    const uniqueCities = useMemo(() => {
        const cities = channelOrders.map(o => o.city).filter(Boolean);
        return ["ALL", ...new Set(cities)];
    }, [channelOrders]);

    const handleComplaintResolveSubmit = async (e) => {
        e.preventDefault();

        const token = localStorage.getItem('auth_token');
        const trimmedText = solutionText.trim();

        if (!trimmedText || !selectedComplaint || !token) {
            alert('Missing resolution text or authentication.');
            return;
        }

        setResolvingComplaint(true);
        try {
            const payload = { status: 'resolved', solution: trimmedText };
            const response = await axios.patch(
                `${API_BASE_URL}/complaints/complaints/${selectedComplaint.id}/resolve`,
                payload,
                { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
            );

            if (response.status === 200) {
                alert(`Complaint #${selectedComplaint.id} successfully resolved.`);
                handleCloseModal();
                const freshToken = localStorage.getItem("auth_token");
                // Refresh data after resolution
                fetchData(freshToken, channelName); 
                fetchChannelComplaints(freshToken);
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

    // --- Data Fetching Function ---
   const fetchData = (token, currentChannel) => {
    setLoading(true);

    if (!token) {
        console.error("❌ No token found");
        handleLogout();
        return;
    }

    const headers = {
        Authorization: `Bearer ${token}`
    };

    const dashboardPromise = axios
        .get(`${API_BASE_URL}/channel-admin/channel-admin/me/dashboard`, {
            headers
        })
        .then((response) => {

            const data = response.data || {};

            const fetchedOrders = data.orders || [];
            const fetchedPartners = data.partners || [];
            const fetchedStores = data.stores || [];

            // ✅ KPIs
            const pendingOrders = fetchedOrders.filter(
                o => o.status?.toLowerCase() === 'pending'
            ).length;

            setDashboardData(prev => ({
                ...prev,
                totalStores: data.total_stores || 0,
                totalPartners: data.total_partners || 0,
                totalOrders: fetchedOrders.length,
                pendingOrders
            }));

            setPartnersList(fetchedPartners);

            // 🔥 FIXED MAPPING (IMPORTANT)
            const mappedOrders = fetchedOrders.map(order => {

    // 🔥 ROBUST STORE MATCH (VERY IMPORTANT FIX)
    const store = fetchedStores.find(s =>
        String(s.id) === String(order.store_id) ||
        String(s.store_code) === String(order.store_id) ||
        String(s.store_name)?.toLowerCase() === String(order.store_name)?.toLowerCase()
    );

    // ✅ SAFE CITY
    const city = store?.city || order.city || "N/A";

    // 🔥 SAFE DATE PARSING
    const rawOrderDate = order.order_date ? new Date(order.order_date) : null;
    const rawCreatedAt = order.created_at ? new Date(order.created_at) : null;
    const rawDeliveredAt = order.delivered_at ? new Date(order.delivered_at) : null;

    // 🔥 BACKDATE CHECK
    const isBackdated =
        rawOrderDate &&
        rawCreatedAt &&
        rawOrderDate.toDateString() !== rawCreatedAt.toDateString();

    // 🔥 FINAL ORDER DATE
    let finalOrderDate = null;

    if (rawOrderDate && !isNaN(rawOrderDate)) {
        finalOrderDate = new Date(
            rawOrderDate.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
        );

        if (isBackdated) {
            finalOrderDate.setHours(0, 0, 0, 0);
        }
    }

    // 🔥 FINAL DELIVERY DATE
    let finalDeliveryDate = null;

    if (isBackdated && finalOrderDate) {
        finalDeliveryDate = new Date(finalOrderDate);
    } else if (rawDeliveredAt && !isNaN(rawDeliveredAt)) {
        finalDeliveryDate = new Date(rawDeliveredAt);
    }

    // 🔥 FORMAT FUNCTION (SAFE)
    const formatIST = (date) => {
        if (!date || isNaN(date)) return 'N/A';

        return new Date(date).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    return {
        id: order.id,

        // 🔥 SAFE NUMBERS
        bottles: Number(order.bottles) || 0,
        deliveredBottles: Number(order.bottles_delivered) || 0,

        status: backendToUiStatus(order.status),

        // ✅ DATE
        orderDate: finalOrderDate,
        formattedOrderDate: formatIST(finalOrderDate),

        deliveryDate: finalDeliveryDate,
        formattedDeliveryDate: formatIST(finalDeliveryDate),

        // 🔥 STORE FIX (IMPORTANT)
        storeId: order.store_id || store?.id || 'N/A',
        storeName: store?.store_name || order.store_name || 'Unknown Store',

        // 🔥 CITY FIX
        city: city,

        // 🔥 ORDER TYPE
        orderedBy: order.ordered_by_type || 'POC',

        partnerName:
            order.ordered_by_type === 'ADMIN'
                ? 'Admin'
                : (order.poc_name || 'N/A'),

        // 🔥 DELIVERY FIX
        deliveryPartnerName: order.delivered_by || 'Not Assigned',

        // 🔥 VEHICLE
        vehicleInfo: order.vehicle_info || 'N/A',

        // 🔥 IMAGE
        deliveryPhoto: order.delivery_photo_url || null
    };
});

            setChannelOrders(mappedOrders);

            // ✅ STORES
            const mappedStores = fetchedStores.map(store => {

    // 🔥 FIND PARTNERS LINKED TO THIS STORE (CORRECT LOGIC)
    const assignedPartners = fetchedPartners.filter(partner =>
        partner.stores &&
        partner.stores.some(s => String(s.id) === String(store.id))
    );

    return {
        ...store,

        // ✅ POC NAME FIX (MAIN CHANGE)
        partner_name:
            assignedPartners.length > 0
                ? assignedPartners.map(p => p.full_name).join(', ')
                : "Unassigned",

        // ✅ OPTIONAL (future use)
        partner_ids: assignedPartners.map(p => p.id),

        // 🔥 ORDER COUNT FIX (STRING SAFE)
        order_count: mappedOrders.filter(
            o => String(o.storeId) === String(store.id)
        ).length
    };
});

            setStoresList(mappedStores);
        })
        .catch((error) => {
            console.error("❌ Dashboard API Error:", error);

            if (error.response?.status === 401) {
                console.log("🔐 Token expired → logout");
                handleLogout();
            }
        });

    const complaintsPromise = fetchChannelComplaints(token);

    Promise.all([dashboardPromise, complaintsPromise])
        .catch((error) => {
            console.error("❌ FINAL ERROR:", error);
        })
        .finally(() => {
            setLoading(false);
        });
};

    // --- Export Handler ---
    const handleExportOrdersToCSV = () => {
        exportOrdersToCSV(dateFilteredOrders, channelName.toUpperCase());
    };

    // --- Initial Data Fetch Effect ---
    useEffect(() => {
        const token = localStorage.getItem("auth_token");
        const storedChannel = localStorage.getItem("channel_name");

        if (token && storedChannel) {
            setChannelName(storedChannel.toUpperCase());
            fetchData(token, storedChannel.toUpperCase());
            fetchReports(token);
        } else {
            handleLogout();
        }
    }, [navigate]); 

    const handleSelectTab = (tabName) => {
        setCurrentTab(tabName);
    };


    // --- Render Functions for Tabs ---

    const renderDashboard = () => {

    // ✅ CITY FILTER (same as before)
    let filteredOrders = cityFilter === "ALL"
        ? channelOrders
        : channelOrders.filter(o => o.city === cityFilter);

    // ✅ DATE FILTER (NEW ADD)
    filteredOrders = getFilteredByDate(filteredOrders);

    // ✅ KPIs (same logic, just variable changed)
    const deliveredOrders = filteredOrders.filter(o => o.status === 'Delivered').length;

    const assignedOrders = filteredOrders.filter(o => 
        o.status === 'Assign to Delivery Partner' || o.status === 'In Transit'
    ).length;

    const pendingOrders = filteredOrders.filter(o => 
        o.status?.toLowerCase() === 'pending'
    ).length;

    // 🔥 GRAPH DATA (same, just filteredOrders use)
    const chartData = filteredOrders
        .filter(o => o.deliveryDate)
        .sort((a, b) => new Date(b.deliveryDate) - new Date(a.deliveryDate))
        .slice(0, 7)
        .map((o) => ({
            name: new Date(o.deliveryDate).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short'
            }),
            bottles: o.deliveredBottles || 0
        }));

    return (
        <div style={styles.contentArea}>

            <h2 style={styles.pageTitle}>
                Dashboard Overview {cityFilter !== "ALL" && `(${cityFilter})`}
            </h2>

            {/* 🔥 FILTER BAR (CITY + DATE) */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '15px' }}>

                {/* CITY FILTER */}
                <select
                    value={cityFilter}
                    onChange={(e) => setCityFilter(e.target.value)}
                    style={styles.filterDropdown}
                >
                    {uniqueCities.map(city => (
                        <option key={city} value={city}>{city}</option>
                    ))}
                </select>

                {/* ✅ DATE FILTER (NEW) */}
                <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    style={styles.filterDropdown}
                >
                    <option value="ALL">All Time</option>
                    <option value="YESTERDAY">Yesterday</option>
                    <option value="7DAYS">Last 7 Days</option>
                    <option value="15DAYS">Last 15 Days</option>
                    <option value="30DAYS">Last 30 Days</option>
                </select>

            </div>

            {/* KPI */}
            <div style={styles.kpiRow}>

                <StatCard label="Total Orders" value={filteredOrders.length} icon="📦" bgColor="#E3F2FD" textColor="#1565C0" onPress={() => setCurrentTab('orders')} />

                <StatCard label="Pending Orders" value={pendingOrders} icon="⏰" bgColor="#FFF3E0" textColor="#EF6C00" onPress={() => setCurrentTab('orders')} />

                <StatCard label="Assigned Orders" value={assignedOrders} icon="🚚" bgColor="#E8EAF6" textColor="#3F51B5" onPress={() => setCurrentTab('orders')} />

                <StatCard label="Delivered Orders" value={deliveredOrders} icon="✅" bgColor="#E8F5E9" textColor="#2E7D32" onPress={() => setCurrentTab('orders')} />

                <StatCard label="Pending Complaints" value={dashboardData.pendingComplaints} icon="🚨" bgColor="#FFEBEE" textColor="#D32F2F" onPress={() => setCurrentTab('complaints')} />

                <StatCard label={`Stores (${channelName})`} value={dashboardData.totalStores} icon="🏬" bgColor="#E0F2F1" textColor="#00796B" onPress={() => setCurrentTab('stores')} />

            </div>

            {/* GRAPH + INSIGHTS */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr',
                gap: '20px',
                marginBottom: '25px'
            }}>

                {/* GRAPH */}
                <div style={styles.tableCard}>
                    <h3 style={styles.cardTitle}>📊 Orders Trend</h3>

                    <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={chartData}>
                            <XAxis dataKey="name" />
                            <YAxis />
                            <Tooltip />
                            <Line type="monotone" dataKey="bottles" stroke="#4CAF50" strokeWidth={3} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                {/* QUICK STATS */}
                <div style={styles.tableCard}>
                    <h3 style={styles.cardTitle}>⚡ Quick Insights</h3>

                    <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>📦 Total Orders: <b>{filteredOrders.length}</b></div>
                        <div>✅ Delivered: <b>{deliveredOrders}</b></div>
                        <div>🚚 In Transit: <b>{assignedOrders}</b></div>
                        <div>⏰ Pending: <b>{pendingOrders}</b></div>
                        <div>🚨 Complaints: <b>{dashboardData.pendingComplaints}</b></div>
                    </div>
                </div>

            </div>

            {/* 🔥 RECENT ORDERS (UNCHANGED) */}
            <div style={styles.tableCard}>
                <h3 style={styles.cardTitle}>📦 Recent Orders</h3>

                <div style={{ overflowX: "auto" }}>
                    <table style={styles.dataTable}>

                        <thead>
                            <tr style={styles.tableHeaderRow}>
                                <th style={styles.tableHeaderCell}>Order ID</th>
                                <th style={styles.tableHeaderCell}>Store</th>
                                <th style={styles.tableHeaderCell}>Order Bottles</th>
                                <th style={styles.tableHeaderCell}>Ordered By</th>
                                <th style={styles.tableHeaderCell}>Order Date</th>
                                <th style={styles.tableHeaderCell}>Delivery By</th>
                                <th style={styles.tableHeaderCell}>Delivered Bottles</th>
                                <th style={styles.tableHeaderCell}>Delivery Date</th>
                                <th style={styles.tableHeaderCell}>Vehicle</th>
                                <th style={styles.tableHeaderCell}>Status</th>
                                <th style={styles.tableHeaderCell}>Proof</th>
                            </tr>
                        </thead>

                        <tbody>
                            {filteredOrders
                                .sort((a, b) => b.orderDate - a.orderDate)
                                .slice(0, 5)
                                .map(order => (
                                    <tr key={order.id} style={styles.tableRow}>
                                        <td style={styles.tableCell}>#{order.id}</td>
                                        <td style={styles.tableCell}>{order.storeName}</td>
                                        <td style={styles.tableCell}>{order.bottles}</td>
                                        <td style={styles.tableCell}>{order.partnerName}</td>
                                        <td style={styles.tableCell}>{order.formattedOrderDate}</td>
                                        <td style={styles.tableCell}>{order.deliveryPartnerName}</td>
                                        <td style={styles.tableCell}>{order.deliveredBottles}</td>
                                        <td style={styles.tableCell}>{order.formattedDeliveryDate}</td>
                                        <td style={styles.tableCell}>{order.vehicleInfo}</td>
                                        <td style={styles.tableCell}>{order.status}</td>
                                        <td style={styles.tableCell}>View</td>
                                    </tr>
                                ))}
                        </tbody>

                    </table>
                </div>
            </div>

        </div>
    );
};
    

const dateFilteredOrders = useMemo(() => {
    return channelOrders.filter(order => {

        // ✅ only delivered orders consider karo (report sync)
        if (!order.orderDate) return false;

        if (!startDate && !endDate) return true;

        const orderDate = new Date(order.orderDate);

        // ✅ normalize dates (avoid time issues)
        const start = startDate ? new Date(startDate + "T00:00:00") : null;
        const end = endDate ? new Date(endDate + "T23:59:59") : null;

        if (start && orderDate < start) return false;
        if (end && orderDate > end) return false;

        return true;
    });
}, [channelOrders, startDate, endDate]);
    // RENDER ORDERS TAB
const renderOrders = () => {

    const filteredOrders = dateFilteredOrders
        // ✅ CITY FILTER (ADDED ONLY THIS)
        .filter(o => {
            if (cityFilter === "ALL") return true;
            return o.city === cityFilter;
        })
        // EXISTING CODE (UNCHANGED)
        .filter(o => o.storeName?.toLowerCase().includes(search.toLowerCase()))
        .filter(o => {
            if (statusFilter === 'ALL') return true;

            const s = o.status?.toLowerCase() || '';

            if (statusFilter === 'PENDING') return s === 'pending';
            if (statusFilter === 'TRANSIT') return s.includes('transit') || s.includes('partner');
            if (statusFilter === 'DELIVERED') return s === 'delivered';

            return true;
        });

    return (
        <div style={styles.contentArea}>

            {/* HEADER */}
            <div style={styles.filterHeader}>
                <h2 style={styles.pageTitle}>{channelName.toUpperCase()} Orders</h2>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>

    {/* LEFT SIDE FILTERS */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>

                        {/* ✅ CITY DROPDOWN (ALREADY PRESENT - NO CHANGE) */}
                        <select
                            value={cityFilter}
                            onChange={(e) => setCityFilter(e.target.value)}
                            style={styles.filterDropdown}
                        >
                            {uniqueCities.map(city => (
                                <option key={city} value={city}>
                                    {city}
                                </option>
                            ))}
                        </select>

                        <select
                            style={styles.filterDropdown}
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="ALL">Show All Orders</option>
                            <option value="PENDING">🟡 Pending Only</option>
                            <option value="TRANSIT">🔵 In Transit / Assigned</option>
                            <option value="DELIVERED">🟢 Delivered Only</option>
                        </select>

                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }} />

                        <input
                            placeholder="Search store..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
                        />

                        <button
                            style={{
                                padding: '10px 16px',
                                backgroundColor: '#9E9E9E',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer'
                            }}
                            onClick={() => {
                                setStatusFilter('ALL');
                                setStartDate('');
                                setEndDate('');
                                setCityFilter('ALL'); // ✅ ADD THIS ONLY
                            }}
                        >
                            🔄 Reset
                        </button>
                    </div>

                    {/* 🔥 RIGHT SIDE EXPORT BUTTON */}
                    <button
                        style={{
                            padding: '8px 16px',
                            backgroundColor: '#1565C0',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '13px'
                        }}
                        onClick={handleExportOrdersToCSV}
                    >
                        📥 Export CSV
                    </button>

                </div>
            </div>

            {/* TABLE */}
            <div style={styles.tableCard}>
                <div style={{ overflowX: "auto" }}>

                    <table style={styles.dataTable}>
                        
                        <thead>
                            <tr style={styles.tableHeaderRow}>
                                <th style={styles.tableHeaderCell}>Order ID</th>
                                <th style={styles.tableHeaderCell}>Store</th>
                                <th style={styles.tableHeaderCell}>Order Bottles</th>
                                <th style={styles.tableHeaderCell}>Ordered By</th>
                                <th style={styles.tableHeaderCell}>Order Date</th>
                                <th style={styles.tableHeaderCell}>Delivery By</th>
                                <th style={styles.tableHeaderCell}>Delivered Bottles</th>
                                <th style={styles.tableHeaderCell}>Delivery Date</th>
                                <th style={styles.tableHeaderCell}>Vehicle</th>
                                <th style={styles.tableHeaderCell}>Status</th>
                                <th style={styles.tableHeaderCell}>Proof</th>
                            </tr>
                        </thead>

                        <tbody>
                            {filteredOrders.length > 0 ? (
                                filteredOrders.map(order => (
                                    <tr
                                        key={order.id}
                                        style={{
                                            ...styles.tableRow,
                                            backgroundColor:
                                                order.status === 'Delivered'
                                                    ? '#E8F5E9'
                                                    : 'white'
                                        }}
                                    >

                                        <td style={styles.tableCell}>#{order.id}</td>

                                        <td style={styles.tableCell}>
                                            <div style={{ fontWeight: '600' }}>{order.storeName || 'N/A'}</div>
                                            <div style={{ fontSize: '12px', color: '#888' }}>{order.storeId}</div>
                                        </td>

                                        <td style={styles.tableCell}>{order.bottles}</td>

                                        <td style={styles.tableCell}>{order.partnerName || 'N/A'}</td>

                                        <td style={styles.tableCell}>{order.formattedOrderDate || 'N/A'}</td>

                                        <td style={styles.tableCell}>{order.deliveryPartnerName || 'Not Assigned'}</td>

                                        <td style={styles.tableCell}>{order.deliveredBottles || 0}</td>

                                        <td style={styles.tableCell}>
                                            {order.deliveryDate
                                                ? new Date(order.deliveryDate).toLocaleString('en-IN', {
                                                    timeZone: 'Asia/Kolkata',
                                                    day: '2-digit',
                                                    month: 'short',
                                                    year: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })
                                                : <span style={{ color: '#D32F2F', fontWeight: '600' }}>
                                                    Not Delivered
                                                </span>
                                            }
                                        </td>

                                        <td style={styles.tableCell}>{order.vehicleInfo || 'N/A'}</td>

                                        <td style={styles.tableCell}>
                                            <span style={{
                                                ...styles.statusBadge,
                                                backgroundColor:
                                                    order.status === 'Delivered' ? '#4CAF50' :
                                                    order.status === 'Pending' ? '#FF9800' :
                                                    '#2196F3'
                                            }}>
                                                {order.status}
                                            </span>
                                        </td>

                                        <td style={styles.tableCell}>
                                            {order.deliveryPhoto ? (
                                                <span
                                                    onClick={() => openImageModal(order.deliveryPhoto)}
                                                    style={{
                                                        color: '#1565C0',
                                                        cursor: 'pointer',
                                                        fontSize: '13px',
                                                        textDecoration: 'underline'
                                                    }}
                                                >
                                                    View
                                                </span>
                                            ) : 'N/A'}
                                        </td>

                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="11" style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                                        <div style={{ textAlign: 'center', padding: '40px' }}>
                                            <h3>No Orders Found 😕</h3>
                                            <p style={{ color: '#888' }}>Try changing filters or date</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>

                    </table>
                </div>
            </div>

            {/* IMAGE MODAL */}
            {previewImage && (
                <div
                    onClick={closeImageModal}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.7)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 9999
                    }}
                >
                    <img
                        src={previewImage}
                        alt="Proof"
                        style={{
                            maxWidth: '90%',
                            maxHeight: '90%',
                            borderRadius: '10px'
                        }}
                    />
                </div>
            )}

        </div>
    );
};
    const renderStores = () => (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>{channelName.toUpperCase()} Store Network ({storesList.length})</h2>
            <div style={styles.tableCard}>
                <h3 style={styles.cardTitle}>All Stores</h3>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={styles.tableHeaderRow}>
                            <th style={styles.tableHeaderCell}>ID</th>
                            <th style={styles.tableHeaderCell}>Store Name</th>
                            <th style={styles.tableHeaderCell}>City</th>
                            <th style={styles.tableHeaderCell}>Assigned Partner(s)</th>
                            <th style={styles.tableHeaderCell}>Empty Bottles</th>
                        </tr>
                    </thead>
                    <tbody>
                        {storesList.map(store => (
                            <tr key={store.id} style={styles.tableRow}>
                                <td style={styles.tableCell}>{store.id}</td>
                                <td style={styles.tableCell}>{store.store_name}</td>
                                <td style={styles.tableCell}>{store.city}</td>
                                <td style={styles.tableCell}>{store.partner_name || 'Unassigned'}</td>
                                <td style={styles.tableCell}>{store.empty_bottles_count || 0}</td>
                            </tr>
                        ))}
                         {storesList.length === 0 && (
                            <tr style={styles.tableRow}><td colSpan="5" style={{...styles.tableCell, textAlign: 'center'}}>{loading ? 'Loading...' : 'No stores found.'}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    // RENDER PARTNERS TAB
    const renderPartners = () => {
        return (
            <div style={styles.contentArea}>
                <h2 style={styles.pageTitle}>{channelName.toUpperCase()} Partners ({partnersList.length})</h2>
                
                <div style={styles.tableCard}>
                    <h3 style={styles.cardTitle}>List of Partners</h3>
                    <table style={styles.dataTable}>
                        <thead>
                            <tr style={styles.tableHeaderRow}>
                                <th style={styles.tableHeaderCell}>Full Name</th>
                                <th style={styles.tableHeaderCell}>Email</th>
                                <th style={styles.tableHeaderCell}>Mobile</th>
                                <th style={styles.tableHeaderCell}>Stores Managed</th>
                                <th style={styles.tableHeaderCell}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {partnersList.map(partner => (
                                <tr key={partner.id} style={styles.tableRow}>
                                    <td style={styles.tableCell}>{partner.full_name}</td>
                                    <td style={styles.tableCell}>{partner.email}</td>
                                    <td style={styles.tableCell}>{partner.mobile_number || 'N/A'}</td>
                                    <td style={styles.tableCell}>
                                        <span style={{fontWeight: 'bold'}}>
                                            {partner.stores?.map(s => s.store_name).join(', ') || '0'}
                                        </span>
                                    </td>
                                    <td style={styles.tableCell}>{partner.status || 'Active'}</td>
                                </tr>
                            ))}
                             {partnersList.length === 0 && (
                                <tr style={styles.tableRow}><td colSpan="5" style={{...styles.tableCell, textAlign: 'center'}}>{loading ? 'Loading...' : 'No partners found.'}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    // RENDER CREATE PARTNER TAB
    const renderUnassignedOrders = () => (
        <div style={styles.contentArea}>
            <h2 style={{...styles.pageTitle, borderLeftColor: '#D32F2F'}}>🚨 Orphaned Orders (No DM Assigned)</h2>
            <div style={styles.tableCard}>
                <table style={styles.dataTable}>
                    <thead style={styles.tableHeaderRow}>
                        <tr>
                            <th style={styles.tableHeaderCell}>Order ID</th>
                            <th style={styles.tableHeaderCell}>Store</th>
                            <th style={styles.tableHeaderCell}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orphanedOrders.map(o => (
                            <tr key={o.id} style={styles.tableRow}>
                                <td style={styles.tableCell}>#{o.id}</td>
                                <td style={styles.tableCell}>{o.customerName}</td>
                                <td style={styles.tableCell}>
                                    <button style={{...styles.actionButton, backgroundColor: '#1565C0'}} onClick={() => setCurrentTab('stores')}>
                                        Go to Stores to Assign DM
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    // RENDER COMPLAINTS TAB (WITH RESOLVE BUTTON)
    const renderComplaints = () => (
  <div style={styles.contentArea}>
    <h2 style={styles.pageTitle}>
      {channelName.toUpperCase()} Complaints ({channelComplaints.length})
    </h2>

    <div style={styles.tableCard}>
      <h3 style={styles.cardTitle}>Complaints Assigned to This Channel</h3>

      <table style={styles.dataTable}>
        <thead>
          <tr style={styles.tableHeaderRow}>
            <th style={styles.tableHeaderCell}>ID</th>
            <th style={styles.tableHeaderCell}>Subject</th>
            <th style={styles.tableHeaderCell}>Description</th>
            <th style={styles.tableHeaderCell}>Raised By</th>
            <th style={styles.tableHeaderCell}>Store</th>
            <th style={styles.tableHeaderCell}>Status</th>
            <th style={styles.tableHeaderCell}>Created At</th>
            <th style={styles.tableHeaderCell}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {channelComplaints.length === 0 ? (
            <tr style={styles.tableRow}>
              <td colSpan="8" style={{ ...styles.tableCell, textAlign: "center" }}>
                No complaints for this channel.
              </td>
            </tr>
          ) : (
            channelComplaints.map((c) => (
              <tr key={c.id} style={styles.tableRow}>
                <td style={styles.tableCell}>{c.id}</td>

                <td style={styles.tableCell}>{c.subject}</td>

                <td style={styles.tableCell}>
                  {c.description?.length > 60
                    ? `${c.description.substring(0, 60)}...`
                    : c.description}

                  {c.photo_url && (
                    <div style={{ marginTop: "8px" }}>
                      <a
                        href={`${API_BASE_URL}/${c.photo_url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          ...styles.actionButton,
                          backgroundColor: "#6c757d",
                          textDecoration: "none",
                          display: "inline-block",
                        }}
                      >
                        📷 View Image
                      </a>
                    </div>
                  )}
                </td>

                <td style={styles.tableCell}>
                  {c.created_by?.full_name || "Unknown User"}
                </td>

                <td style={styles.tableCell}>
                  {c.store?.store_name || c.store_id || "N/A"}
                </td>

                <td style={styles.tableCell}>
                  <span
                    style={{
                      ...styles.statusBadge,
                      backgroundColor: c.status === "pending" ? "#EF6C00" : "#4CAF50",
                    }}
                  >
                    {backendToUiStatus(c.status)}
                  </span>
                </td>

                <td style={styles.tableCell}>
                  {c.created_at ? new Date(c.created_at).toLocaleString() : "-"}
                </td>

                <td style={styles.tableCell}>
                  {c.status === "pending" ? (
                    <button
                      style={{ ...styles.actionButton, backgroundColor: "#1565C0" }}
                      onClick={() => handleResolveClick(c)}
                      disabled={resolvingComplaint}
                    >
                      Resolve
                    </button>
                  ) : (
                    <span style={{ fontWeight: "600", color: "#4CAF50" }}>
                      ✅ Resolved
                    </span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);




   const renderContent = () => {
        if (loading) {
            return <p style={styles.loadingText}>Loading {channelName.toUpperCase()} data...</p>;
        }
        switch (currentTab) {
            case 'dashboard':
                return renderDashboard();
            case 'orders':
                return renderOrders();
            case 'stores':
                return renderStores();
            case 'partners':
                return renderPartners();
            case 'createPartner':
                return renderCreatePartner();
            case 'complaints':
                return renderComplaints();
            case 'reports':
                return (
                    <div style={styles.contentArea}>
                        <h2 style={styles.pageTitle}>Reports Management</h2>

                        {/* --- Dual View Tab Switcher --- */}
                        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                            <button
                                style={{
                                    ...styles.button,
                                    width: 'auto',
                                    backgroundColor: reportsTab === "monthly" ? '#4CAF50' : '#ccc'
                                }}
                                onClick={() => setReportsTab("monthly")}
                            >
                                Monthly PDF Reports
                            </button>
                            <button
                                style={{
                                    ...styles.button,
                                    width: 'auto',
                                    backgroundColor: reportsTab === "operational" ? '#4CAF50' : 
                                    '#ccc'
                                }}
                                onClick={() => setReportsTab("operational")}
                            >
                                Delivery Reports
                            </button>
                        </div>

                        {reportsTab === "monthly" ? (
                            <>
                                {/* --- Section 1: Available Monthly Reports (Super Admin Style) --- */}
                                <div style={styles.tableCard}>
                                    <h3 style={{ ...styles.cardTitle, borderBottom: '1px solid #eee' }}>
                                        Available Monthly Reports ({reports.length})
                                    </h3>
                                    <table style={styles.dataTable}>
                                        <thead>
                                            <tr style={{ ...styles.tableHeaderRow, backgroundColor: '#1A2A44' }}>
                                                <th style={styles.tableHeaderCell}>ID</th>
                                                <th style={styles.tableHeaderCell}>Report Name</th>
                                                <th style={styles.tableHeaderCell}>Month</th>
                                                <th style={styles.tableHeaderCell}>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {reports.length === 0 ? (
                                                <tr style={styles.tableRow}>
                                                    <td colSpan="4" style={{ ...styles.tableCell, textAlign: 'center', padding: '30px' }}>
                                                        No PDF reports available for this channel.
                                                    </td>
                                                </tr>
                                            ) : (
                                                reports.map((r) => (
                                                    <tr key={r.id} style={styles.tableRow}>
                                                        <td style={styles.tableCell}>#{r.id}</td>
                                                        <td style={{ ...styles.tableCell, fontWeight: '600' }}>
                                                            {r.report_file ? r.report_file.split('/').pop() : `Analysis_Report_${r.id}.pdf`}
                                                        </td>
                                                        <td style={styles.tableCell}>{formatReportMonth(r.report_date)}</td>
                                                        <td style={styles.tableCell}>
                                                            <button
                                                                style={{
                                                                    ...styles.actionButton,
                                                                    backgroundColor: '#1565C0',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '8px'
                                                                }}
                                                                onClick={() => handleReportDownload(r.id)}
                                                            >
                                                                <span>👁️</span> View PDF
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        ) : (
                            /* --- Section 2: System Operational Reports --- */
                            <div style={styles.tableCard}>
                                <Reports />
                            </div>
                        )}
                    </div>
                );
            case 'unassignedOrders':
                return renderUnassignedOrders();
            default:
                return renderDashboard();
        }
    };

    return (
        <div style={styles.dashboardLayout}>
            <Sidebar currentTab={currentTab} onSelectTab={handleSelectTab} channelName={channelName} />
            
            <main style={styles.mainPanel}>

                {/* 🔥 MODERN HEADER */}
                <header style={styles.topHeader}>

                    {/* LEFT SIDE */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <h1 style={styles.headerTitle}>
                            👋 Welcome, {channelName}
                        </h1>
                        <span style={{ fontSize: '13px', color: '#777' }}>
                            Manage your operations efficiently 🚀
                        </span>
                    </div>

                    {/* RIGHT SIDE */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>

                        {/* USER INFO */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            background: '#F4F6F8',
                            padding: '6px 12px',
                            borderRadius: '20px'
                        }}>
                            <span style={{
                                background: '#4CAF50',
                                color: '#fff',
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '13px',
                                fontWeight: 'bold'
                            }}>
                                {channelName?.charAt(0)}
                            </span>

                            <span style={{ fontWeight: '600', color: '#555', fontSize: '14px' }}>
                                {channelName}
                            </span>
                        </div>

                        {/* LOGOUT BUTTON */}
                        <button
                            style={{
                                ...styles.logoutButton,
                                padding: '8px 18px',
                                borderRadius: '20px',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
                            }}
                            onClick={handleLogout}
                        >
                            🚪 Logout
                        </button>

                    </div>
                </header>

                {/* CONTENT */}
                <div style={styles.mainContentArea}>
                    {renderContent()}
                </div>

            </main>

            {/* Global Complaint Modal */}
            <ComplaintResolutionModal
                isVisible={showResolveModal}
                onClose={handleCloseModal}
                onSubmit={handleComplaintResolveSubmit}
                complaint={selectedComplaint}
                solutionText={solutionText}
                setSolutionText={setSolutionText}
                isLoading={resolvingComplaint}
            />
        </div>
    );
};


// --- Styles (Updated for modern look) ---
const styles = {
    dashboardLayout: { display: 'flex', minHeight: '100vh', width: '100vw', backgroundColor: '#F8FAFC', fontFamily: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
    
    // Sidebar
    sidebar: {
        width: '240px',
        backgroundColor: '#ffffff',
        borderRight: '1px solid #E5E7EB'
    },
    sidebarHeader: { padding: '0 20px 25px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '15px', },
    sidebarHeaderTitle: {
        fontSize: '20px',
        fontWeight: '600',
        color: '#0F172A',
    },
    sidebarNav: { flexGrow: 1, padding: '0 10px', },
    sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 14px',
    borderRadius: '8px',
    marginBottom: '6px',
    backgroundColor: 'transparent',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontSize: '14px',
    fontWeight: '500',
    color: '#6B7280',   // 🔥 softer gray (premium feel)
},
   sidebarItemActive: {
    backgroundColor: '#EEF2FF',
    color: '#4F46E5',
    fontWeight: '600',
},
    sidebarIcon: { fontSize: '18px', marginRight: '12px', },
    sidebarText: { color: 'inherit', },

    // Header and Main Content
    mainPanel: { flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    topHeader: {
    background: '#ffffff',
    padding: '16px 28px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #E5E7EB'
},

    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    headerTitle: { fontSize: '22px', fontWeight: '600', color: '#333', margin: 0 },
    logoutButton: { padding: '8px 16px', backgroundColor: '#E74C3C', color: '#FFFFFF', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' },
    mainContentArea: { flexGrow: 1, padding: '20px 30px', overflowY: 'auto', backgroundColor: '#F4F6F8' },
    loadingText: { textAlign: 'center', fontSize: '18px', marginTop: '50px', color: '#6B7280', },
    contentArea: {},
    pageTitle: { fontSize: '28px', fontWeight: '700', color: '#333', marginBottom: '30px', borderLeft: '5px solid #00A896', paddingLeft: '15px' },
    
    // KPI Cards
    kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '30px' },
    statCard: {
    borderRadius: '14px',
    padding: '18px',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    background: 'linear-gradient(135deg, #ffffff, #f9fafb)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
    border: '1px solid #E5E7EB',
    cursor: 'pointer',
    transition: 'all 0.25s ease'
},
    statIcon: { fontSize: '32px' },
    statContent: { flex: 1 },
    statValue: { fontSize: '24px', fontWeight: 'bold', margin: '0' },
    statLabel: { fontSize: '13px', color: 'rgba(0,0,0,0.7)', margin: '0' },
    
    // Tables and Forms
    tableCard: {
    backgroundColor: '#ffffff',
    borderRadius: '14px',
    boxShadow: '0 6px 18px rgba(0,0,0,0.05)',
    padding: '10px'
},
    cardTitle: { fontSize: '20px', fontWeight: '600', color: '#333', padding: '20px', borderBottom: '1px solid #EEE', margin: 0 },
    dataTable: { width: '100%', borderCollapse: 'collapse', },
    tableHeaderRow: {
    backgroundColor: '#111827',
    color: '#fff'
},
    tableHeaderCell: { padding: '15px 20px', fontWeight: '600', fontSize: '14px', },
   tableRow: {
    borderBottom: '1px solid #F1F5F9',
    transition: 'background 0.2s'
},
    tableCell: { padding: '12px 20px', color: '#444', fontSize: '14px', },
    actionButton: { padding: '8px 12px', borderRadius: '4px', border: 'none', color: '#FFFFFF', cursor: 'pointer', fontSize: '13px', fontWeight: '500', transition: 'background-color 0.2s ease', },
    statusBadge: { 
    padding: '6px 14px', 
    borderRadius: '12px', 
    color: '#FFFFFF', 
    fontWeight: 'bold', 
    fontSize: '10px', 
    display: 'inline-block', 
    minWidth: '120px', 
    textAlign: 'center', 
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)' 
},
    formCard: { backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '30px', boxShadow: '0 2px 6px rgba(0,0,0,0.08)', marginBottom: '30px', },
    form: { display: 'flex', flexDirection: 'column', gap: '10px', },
    textInput: { width: '100%', padding: '12px 15px', borderRadius: '6px', border: '1px solid #DCE0E6', fontSize: '16px', color: '#333', outline: 'none', boxSizing: 'border-box', },
    button: { padding: '12px 20px', borderRadius: '6px', border: 'none', color: '#FFFFFF', fontWeight: '600', cursor: 'pointer', fontSize: '16px', transition: 'background-color 0.2s ease', width: '100%', textTransform: 'uppercase', letterSpacing: '0.5px', },

    // Modal Styles
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
            width: '450px',
            maxWidth: '90%',
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.2)',
        },
        title: {
            fontSize: '20px',
            fontWeight: '600',
            color: '#333',
            marginBottom: '15px',
            borderBottom: '2px solid #EEE',
            paddingBottom: '10px'
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
            boxSizing: 'border-box'
        },


        orderHeaderRow: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '25px',
            backgroundColor: '#fff',
            padding: '15px',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
        },


        filterDropdown: {
            padding: '10px 15px',
            borderRadius: '8px',
            border: '1px solid #DCE0E6',
            fontSize: '14px',
            fontWeight: '600',
            color: '#334E68',
            outline: 'none',
            cursor: 'pointer',
            minWidth: '200px'
        },


        exportBtnSmall: {
            backgroundColor: '#1565C0',
            color: '#fff',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '8px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '14px'
        },


        noDataContainer: {
            gridColumn: '1 / -1',
            textAlign: 'center',
            padding: '50px',
            color: '#9FB3C8',
            fontSize: '16px',
            backgroundColor: '#fff',
            borderRadius: '12px',
            border: '2px dashed #E0E4E8'
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
            fontWeight: '600',
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
        fontSize: '14px',
        color: '#6B7280',
        marginBottom: '8px',
        textAlign: 'left',
    },

    filterHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: '15px 25px',
    borderRadius: '12px',
    marginBottom: '20px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
},
filterDropdown: {
    padding: '10px 15px',
    borderRadius: '8px',
    border: '1px solid #DCE0E6',
    fontWeight: '600',
    color: '#334E68',
    cursor: 'pointer',
    outline: 'none',
    minWidth: '180px'
},


    

    orderGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '20px',
    marginTop: '15px'
},
orderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    padding: '18px',
    boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
    border: '1px solid #E0E4E8',
    display: 'flex',
    flexDirection: 'column',
    transition: 'all 0.3s ease'
},



cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
orderIdText: { fontSize: '16px', fontWeight: '800', color: '#102A43' },
statusBadgeCard: { padding: '4px 10px', borderRadius: '15px', color: '#fff', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' },
cardBody: { display: 'flex', flexDirection: 'column', gap: '8px' },
infoRow: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' },
infoLabel: { color: '#627D98', fontWeight: '500' },
infoValue: { color: '#243B53', fontWeight: '600', textAlign: 'right' },
cardDivider: { border: 'none', borderTop: '1px solid #F0F4F8', margin: '10px 0' },
dateValueText: { color: '#102A43', fontWeight: '500', fontSize: '12px' },
notDeliveredText: { color: '#D32F2F', fontSize: '11px', fontWeight: 'bold' },
cardFooter: { marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed #BCCCDC', display: 'flex', justifyContent: 'flex-end' },
bottleCountBadge: { background: '#F0F4F8', color: '#334E68', padding: '4px 10px', borderRadius: '6px', fontWeight: 'bold', fontSize: '12px' },
noDataSmall: { color: '#9FB3C8', fontStyle: 'italic', fontSize: '14px' }
};

export default ChannelAdminDashboard;