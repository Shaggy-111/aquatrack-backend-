import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from './config'; 

// --- Configuration & Helpers ---
const backendToUiStatus = (s) => {
    if (!s) return 'Unknown';
    const status = s.toLowerCase();
    if (status === 'pending') return 'Pending Super Admin Approval'; 
    if (status === 'accepted') return 'Accepted & Routing'; 
    if (status === 'in_transit') return 'In Transit';
    if (status === 'delivered' || status === 'delivered_confirmed') return 'Delivered/Resolved'; 
    // MODIFIED: 'assigned_to_manager' status now maps to the final assignment status (Assigned to DP)
    if (status === 'assigned_to_manager' || status === 'assigned') return 'Assigned to DP'; 
    if (status === 'cancelled') return 'Cancelled';
    return s;
};

// --- Reusable Components (StatCard, SidebarItem, Sidebar) ---
const StatCard = ({ label, value, icon, bgColor, textColor, onPress }) => (
    <div 
        style={{ ...styles.statCard, backgroundColor: bgColor, color: textColor }} 
        onClick={onPress}
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
    >
        <span style={styles.sidebarIcon}>{icon}</span>
        <span style={styles.sidebarText}>{label}</span>
    </button>
);

const Sidebar = ({ currentTab, onSelectTab, managerArea, managerName }) => (
    <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
            <p style={styles.sidebarHeaderTitle}>DM: {managerName}</p> 
            <p style={styles.sidebarSubHeader}>Area: {managerArea}</p> 
        </div>
        <nav style={styles.sidebarNav}>
            <SidebarItem label="Dashboard" icon="🏠" name="dashboard" active={currentTab === 'dashboard'} onSelect={onSelectTab} />
            <SidebarItem label="Monitoring Orders" icon="🚨" name="unassigned" active={currentTab === 'unassigned'} onSelect={onSelectTab} />
            <SidebarItem label="All Orders" icon="📦" name="allOrders" active={currentTab === 'allOrders'} onSelect={onSelectTab} />
            <SidebarItem label="My Delivery Team" icon="🚚" name="myTeam" active={currentTab === 'myTeam'} onSelect={onSelectTab} />
        </nav>
    </aside>
);

// --- REMOVED: AssignOrderModal Component is removed in this version. ---
// The old AssignOrderModal is replaced by this placeholder comment:
// ❌ Note: The manual AssignOrderModal component has been removed to enforce auto-routing/monitoring flow.

const DeliveryManagerDashboard = () => {
    const [loading, setLoading] = useState(true);
    const [currentTab, setCurrentTab] = useState('dashboard');
    const [managerArea, setManagerArea] = useState(localStorage.getItem('manager_area') || "Your Area"); 
    const [managerName, setManagerName] = useState(localStorage.getItem('manager_name') || "Delivery Manager");
    
    // Data states
    const [allOrders, setAllOrders] = useState([]); 
    const [deliveryPartners, setDeliveryPartners] = useState([]);
    const [dashboardData, setDashboardData] = useState({
        totalOrders: 0,
        unassignedOrders: 0,
        pendingOrders: 0,
        totalPartners: 0,
    });
    const navigate = useNavigate();

    // ❌ REMOVED: Assignment Modal States are deleted
    // const [isAssignModalVisible, setIsAssignModalVisible] = useState(false);
    // const [orderToAssign, setOrderToAssign] = useState(null); 
    // const [selectedPartnerId, setSelectedPartnerId] = useState("");
    // const [assigning, setAssigning] = useState(false);

    // --- Logout Handler ---
    const handleLogout = () => {
        // Clear tokens and DM-specific data
        ['auth_token', 'userToken', 'user_role', 'manager_area', 'manager_name'].forEach(key => localStorage.removeItem(key));
        alert('You have been logged out.');
        navigate('/login'); 
    };

    // ❌ REMOVED: Core Action: handleAssignOrderToDP handler is deleted.
    // The DM is no longer responsible for manual assignment.

    // --- FUNCTION 1: Fetch Manager Name and Area ---
    const fetchManagerDetails = async (token) => {
        try {
            // NOTE: API URL adjusted based on provided backend path
            const response = await axios.get(`${API_BASE_URL}/delivery-manager/me/profile`, { 
                headers: { Authorization: `Bearer ${token}` } 
            });
            
            const { full_name, city } = response.data;

            setManagerName(full_name);
            setManagerArea(city); 
            
            localStorage.setItem('manager_name', full_name);
            localStorage.setItem('manager_area', city);

        } catch (error) {
            console.error("Error fetching manager details:", error.response?.data || error.message);
            if (error.response?.status === 401) handleLogout();
        }
    };


    // --- FUNCTION 2: Data Fetching Function ---
    const fetchData = async (token) => {
        setLoading(true);

        try {
            // NOTE: API URL adjusted based on provided backend path
            const ordersPromise = axios.get(`${API_BASE_URL}/delivery-manager/me/orders`, { headers: { Authorization: `Bearer ${token}` } });
            const partnersPromise = axios.get(`${API_BASE_URL}/delivery-manager/me/delivery-partners`, { headers: { Authorization: `Bearer ${token}` } });
            
            const [ordersRes, partnersRes] = await Promise.all([ordersPromise, partnersPromise]);

            const ordersData = ordersRes?.data || [];
            const mappedOrders = ordersData.map(order => ({
                id: order.id,
                bottles: order.order_details, 
                status: backendToUiStatus(order.status),
                orderDate: new Date(order.created_at),
                deliveryDate: order.updated_at ? new Date(order.updated_at) : null, 
                customerName: order.store?.store_name || 'Customer', 
                deliveryPartnerName: order.delivery_person?.full_name || 'N/A',
            }));
            setAllOrders(mappedOrders);

            // --- KPI Calculations ---
            const todayString = new Date().toISOString().split('T')[0];

            // In the new flow, orders assigned to manager are orders that failed direct assignment 
            const unassignedOrders = mappedOrders.filter(o => o.status === 'Assigned to DP').length;
            
            // Orders actively being handled (Assigned to DP, In Transit)
            const inProgressOrders = mappedOrders.filter(o => 
                 o.status === 'In Transit' || o.status === 'Assigned to DP'
            ).length;
            
            const ordersToday = mappedOrders.filter(o => 
                o.orderDate.toISOString().split('T')[0] === todayString
            ).length;
            
            const deliveredToday = mappedOrders.filter(o => 
                o.status.includes('Delivered') && o.deliveryDate?.toISOString().split('T')[0] === todayString
            ).length;
            
            const partnersData = partnersRes?.data || [];
            
            setDashboardData({
                totalOrders: mappedOrders.length,
                unassignedOrders: unassignedOrders, // Used for 'Assigned to DP' monitoring count
                pendingOrders: inProgressOrders, 
                totalPartners: partnersData.length,
                ordersToday: ordersToday,       
                deliveredToday: deliveredToday, 
            });

            setDeliveryPartners(partnersData);

        } catch (error) {
            console.error(
                `[DM DASHBOARD FETCH FAILED]: Status ${error.response?.status}`,
                error.response?.data || error.message
            );
            if (error.response?.status === 401) handleLogout();
            if (error.response?.status !== 401) alert(`DATA LOADING FAILED! Check console for API error.`);
        } finally {
            setLoading(false);
        }
    };

    // --- Initial Data Fetch Effect ---
    useEffect(() => {
        const token = localStorage.getItem("auth_token");

        if (token) {
            fetchManagerDetails(token).then(() => {
                fetchData(token); 
            });
        } else {
            handleLogout();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate]); 

    const handleSelectTab = (tabName) => {
        setCurrentTab(tabName);
    };

    // --- Render Dashboard ---
    const renderDashboard = () => (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>Logistics Dashboard for {managerArea}</h2>

            <div style={styles.kpiRow}>
                <StatCard 
                    label={`Total Orders in Area`} 
                    value={dashboardData.totalOrders.toString()} 
                    icon="📦" 
                    bgColor="#E3F2FD" 
                    textColor="#1565C0" 
                    onPress={() => setCurrentTab('allOrders')}
                />
                <StatCard 
                    label={`Assigned to DP`} 
                    value={dashboardData.unassignedOrders.toString()} 
                    icon="🚨" 
                    bgColor="#FFEBEE" 
                    textColor="#D32F2F" 
                    onPress={() => setCurrentTab('unassigned')}
                />
                <StatCard 
                    label={`In Transit / Assigned`} 
                    value={dashboardData.pendingOrders.toString()} 
                    icon="⏳" 
                    bgColor="#FFF3E0" 
                    textColor="#EF6C00" 
                    onPress={() => setCurrentTab('allOrders')}
                />
                <StatCard 
                    label={`Active Delivery Partners`} 
                    value={dashboardData.totalPartners.toString()} 
                    icon="🚚" 
                    bgColor="#E8F5E9" 
                    textColor="#388E3C" 
                    onPress={() => setCurrentTab('myTeam')}
                />
                <StatCard 
                    label={`Orders Created Today`} 
                    value={dashboardData.ordersToday.toString() || '0'} 
                    icon="📅" 
                    bgColor="#F0F4C3" 
                    textColor="#9E9D24" 
                    onPress={() => setCurrentTab('allOrders')}
                />
                <StatCard 
                    label={`Orders Delivered Today`} 
                    value={dashboardData.deliveredToday.toString() || '0'} 
                    icon="✅" 
                    bgColor="#D4EDDA" 
                    textColor="#155724" 
                    onPress={() => setCurrentTab('allOrders')}
                />
            </div>
        </div>
    );

    // --- Render Monitoring Orders Tab (UNASSIGNED) ---
    // NOTE: This tab now shows orders that are 'Assigned to DP' for monitoring
    const renderUnassignedOrders = () => {
        const monitoringList = allOrders.filter(o => o.status === 'Assigned to DP');

        return (
            <div style={styles.contentArea}>
                <h2 style={styles.pageTitle}>Orders Assigned to DP ({monitoringList.length})</h2>
                <div style={styles.tableCard}>
                    <h3 style={styles.cardTitle}>Orders currently being handled by the delivery team</h3>
                    <table style={styles.dataTable}>
                        <thead>
                            <tr style={styles.tableHeaderRow}>
                                <th style={styles.tableHeaderCell}>Order ID</th>
                                <th style={styles.tableHeaderCell}>Store/Customer</th>
                                <th style={styles.tableHeaderCell}>Bottles</th>
                                <th style={styles.tableHeaderCell}>Status</th>
                                <th style={styles.tableHeaderCell}>Assigned Partner</th> 
                                {/* ❌ Removed: Actions column header */}
                            </tr>
                        </thead>
                        <tbody>
                            {monitoringList.map(order => (
                                <tr key={order.id} style={styles.tableRow}>
                                    <td style={styles.tableCell}>#{order.id}</td>
                                    <td style={styles.tableCell}>{order.customerName}</td>
                                    <td style={styles.tableCell}>{order.bottles}</td>
                                    <td style={styles.tableCell}>
                                        <span style={{...styles.statusBadge, backgroundColor: '#2196F3'}}>
                                            {order.status}
                                        </span>
                                    </td>
                                    <td style={styles.tableCell}>{order.deliveryPartnerName}</td>
                                    {/* ❌ Removed: Action button TD/logic */}
                                </tr>
                            ))}
                             {monitoringList.length === 0 && (
                                <tr style={styles.tableRow}><td colSpan="5" style={{...styles.tableCell, textAlign: 'center'}}>No orders currently assigned to the delivery team for monitoring.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    // --- Render All Orders Tab (No functional changes) ---
    const renderAllOrders = () => (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>All Orders in {managerArea} ({allOrders.length})</h2>
            <div style={styles.tableCard}>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={styles.tableHeaderRow}>
                            <th style={styles.tableHeaderCell}>Order ID</th>
                            <th style={styles.tableHeaderCell}>Store Name</th>
                            <th style={styles.tableHeaderCell}>Bottles</th>
                            <th style={styles.tableHeaderCell}>Status</th>
                            <th style={styles.tableHeaderCell}>Assigned Partner</th>
                            <th style={styles.tableHeaderCell}>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        {allOrders.sort((a, b) => b.orderDate - a.orderDate).map(order => (
                            <tr key={order.id} style={styles.tableRow}>
                                <td style={styles.tableCell}>#{order.id}</td>
                                <td style={styles.tableCell}>{order.customerName}</td>
                                <td style={styles.tableCell}>{order.bottles}</td>
                                <td style={styles.tableCell}>
                                    <span style={{
                                        ...styles.statusBadge,
                                        backgroundColor: 
                                            order.status.includes('Delivered') ? '#4CAF50' : 
                                            order.status.includes('Pending') ? '#D32F2F' : 
                                            order.status.includes('Assigned') ? '#2196F3' : 
                                            order.status.includes('Transit') ? '#EF6C00' : 
                                            '#6B7280'
                                    }}>
                                        {order.status}
                                    </span>
                                </td>
                                <td style={styles.tableCell}>{order.deliveryPartnerName}</td>
                                <td style={styles.tableCell}>{order.orderDate.toLocaleDateString()}</td>
                            </tr>
                        ))}
                         {allOrders.length === 0 && (
                            <tr style={styles.tableRow}><td colSpan="6" style={{...styles.tableCell, textAlign: 'center'}}>{loading ? 'Loading...' : 'No orders found.'}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    // --- Render My Team Tab (No functional changes) ---
    const renderMyTeam = () => (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>Delivery Team in {managerArea} ({deliveryPartners.length})</h2>
            <p style={styles.modalSubtitle}>
                These Delivery Partners are directly linked to your management area by the Super Admin.
            </p>
            <div style={styles.tableCard}>
                <h3 style={styles.cardTitle}>List of Delivery Partners</h3>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={styles.tableHeaderRow}>
                            <th style={styles.tableHeaderCell}>Full Name</th>
                            <th style={styles.tableHeaderCell}>Email</th>
                            <th style={styles.tableHeaderCell}>Mobile</th>
                            <th style={styles.tableHeaderCell}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {deliveryPartners.map(dp => (
                            <tr key={dp.id} style={styles.tableRow}>
                                <td style={styles.tableCell}>{dp.full_name}</td>
                                <td style={styles.tableCell}>{dp.email}</td>
                                <td style={styles.tableCell}>{dp.mobile_number || 'N/A'}</td>
                                <td style={styles.tableCell}>
                                    <span style={{
                                        ...styles.statusBadge,
                                        backgroundColor: dp.status === 'active' ? '#4CAF50' : '#FF9800'
                                    }}>
                                        {dp.status || 'pending'}
                                    </span>
                                </td>
                            </tr>
                        ))}
                         {deliveryPartners.length === 0 && (
                            <tr style={styles.tableRow}><td colSpan="4" style={{...styles.tableCell, textAlign: 'center'}}>{loading ? 'Loading...' : 'No delivery partners found.'}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderContent = () => {
        if (loading) {
            return <p style={styles.loadingText}>Loading {managerArea} data...</p>;
        }
        switch (currentTab) {
            case 'dashboard':
                return renderDashboard();
            case 'unassigned':
                return renderUnassignedOrders();
            case 'allOrders':
                return renderAllOrders();
            case 'myTeam':
                return renderMyTeam();
            default:
                return renderDashboard();
        }
    };


    return (
        <div style={styles.dashboardLayout}>
            <Sidebar 
                currentTab={currentTab} 
                onSelectTab={setCurrentTab} 
                managerArea={managerArea} 
                managerName={managerName} 
            />
            
            <main style={styles.mainPanel}>
                <header style={styles.topHeader}>
                    <h1 style={styles.headerTitle}>{managerName}'s Delivery Portal ({managerArea})</h1>
                    <button style={styles.logoutButton} onClick={handleLogout}>Logout</button>
                </header>
                <div style={styles.mainContentArea}>
                    {renderContent()}
                </div>
            </main>

            {/* ❌ REMOVED: Global Modal (AssignOrderModal) - This is now deleted */}
        </div>
    );
};

// --- Styles (Unchanged) ---
const styles = {
    dashboardLayout: { display: 'flex', minHeight: '100vh', width: '100vw', backgroundColor: '#F4F6F8', fontFamily: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
    sidebar: { width: '240px', backgroundColor: '#3B2F5B', color: '#ECF0F1', padding: '20px 0', display: 'flex', flexDirection: 'column', boxShadow: '2px 0 10px rgba(0,0,0,0.1)', zIndex: 10, },
    sidebarHeader: { padding: '0 20px 25px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '15px', },
    sidebarHeaderTitle: { fontSize: '20px', fontWeight: '800', color: '#FFFFFF', margin: 0, marginBottom: '5px' },
    sidebarSubHeader: { fontSize: '14px', fontWeight: '600', color: '#F59E0B', margin: 0 },
    sidebarNav: { flexGrow: 1, padding: '0 10px', },
    sidebarItem: { display: 'flex', alignItems: 'center', padding: '12px 15px', borderRadius: '6px', marginBottom: '6px', backgroundColor: 'transparent', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', transition: 'background-color 0.2s ease, color 0.2s ease', fontSize: '15px', color: '#BDC3C7', },
    sidebarItemActive: { backgroundColor: '#F59E0B', color: '#FFFFFF', fontWeight: '700', },
    sidebarIcon: { fontSize: '18px', marginRight: '12px', },
    sidebarText: { color: 'inherit', },
    mainPanel: { flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    topHeader: { backgroundColor: '#FFFFFF', padding: '15px 30px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E0E0E0', flexShrink: 0 },
    headerTitle: { fontSize: '22px', fontWeight: '600', color: '#333', margin: 0 },
    logoutButton: { padding: '8px 16px', backgroundColor: '#E74C3C', color: '#FFFFFF', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' },
    mainContentArea: { flexGrow: 1, padding: '20px 30px', overflowY: 'auto', backgroundColor: '#F4F6F8' },
    loadingText: { textAlign: 'center', fontSize: '18px', marginTop: '50px', color: '#6B7280', },
    contentArea: {},
    pageTitle: { fontSize: '28px', fontWeight: '700', color: '#333', marginBottom: '30px', borderLeft: '5px solid #F59E0B', paddingLeft: '15px' },
    kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '30px' },
    statCard: { borderRadius: '10px', padding: '20px', display: 'flex', alignItems: 'center', gap: '15px', boxShadow: '0 2px 6px rgba(0,0,0,0.08)', cursor: 'pointer', transition: 'transform 0.2s ease', minHeight: '80px' },
    statIcon: { fontSize: '32px' },
    statContent: { flex: 1 },
    statValue: { fontSize: '24px', fontWeight: 'bold', margin: '0' },
    statLabel: { fontSize: '13px', color: 'rgba(0,0,0,0.7)', margin: '0' },
    tableCard: { backgroundColor: '#FFFFFF', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.08)', overflow: 'hidden', marginBottom: '30px', },
    cardTitle: { fontSize: '20px', fontWeight: '600', color: '#333', padding: '20px', borderBottom: '1px solid #EEE', margin: 0 },
    dataTable: { width: '100%', borderCollapse: 'collapse', },
    tableHeaderRow: { backgroundColor: '#3B2F5B', color: '#FFFFFF', textAlign: 'left', },
    tableHeaderCell: { padding: '15px 20px', fontWeight: '600', fontSize: '14px', },
    tableRow: { borderBottom: '1px solid #F0F2F5', },
    tableCell: { padding: '12px 20px', color: '#444', fontSize: '14px', },
    actionButton: { padding: '8px 12px', borderRadius: '4px', border: 'none', backgroundColor: '#F59E0B', color: '#FFFFFF', cursor: 'pointer', fontSize: '13px', fontWeight: '500', transition: 'background-color 0.2s ease', },
    statusBadge: { padding: '4px 10px', borderRadius: '12px', color: '#FFFFFF', fontWeight: 'bold', fontSize: '11px', display: 'inline-block', minWidth: '60px', textAlign: 'center', textTransform: 'uppercase' },
    form: { display: 'flex', flexDirection: 'column', gap: '10px', },
    textInput: { width: '100%', padding: '12px 15px', borderRadius: '6px', border: '1px solid #DCE0E6', fontSize: '16px', color: '#333', outline: 'none', boxSizing: 'border-box', },
    selectStoresTitle: { fontSize: '16px', fontWeight: '600', color: '#333', marginBottom: '10px', display: 'block' },

    // Modal Styles (Kept for consistency, even if not used)
    modalStyles: {
        backdrop: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, },
        modal: { backgroundColor: '#FFFFFF', padding: '30px', borderRadius: '12px', width: '450px', maxWidth: '90%', boxShadow: '0 8px 20px rgba(0, 0, 0, 0.2)', },
        title: { fontSize: '20px', fontWeight: '600', color: '#333', marginBottom: '15px', borderBottom: '2px solid #EEE', paddingBottom: '10px' },
        actions: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' },
        cancelButton: { padding: '10px 18px', borderRadius: '6px', border: '1px solid #CCC', backgroundColor: '#F5F5F5', color: '#333', cursor: 'pointer', fontWeight: '600', },
        submitButton: { padding: '10px 18px', borderRadius: '6px', border: 'none', backgroundColor: '#F59E0B', color: '#FFFFFF', fontWeight: '600', cursor: 'pointer', }
    },
    modalSubtitle: { fontSize: '14px', color: '#6B7280', marginBottom: '8px', textAlign: 'left', },
};


export default DeliveryManagerDashboard;