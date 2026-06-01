import React, { useState, useEffect } from 'react';
import {
    SafeAreaView,
    ScrollView,
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    TextInput,
    Alert,
    ActivityIndicator,
    Modal,
    FlatList,
    Linking,
    Animated,
    Easing,
} from 'react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { exportToExcel } from './utils/excelExport';
import { API_BASE_URL } from '../src/config'; // Adjust path if needed

const backendToUiStatus = (status: string) => {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'accepted':
    case 'in_progress':
      return 'In Transit';
    case 'delivered_pending_confirmation':
      return 'Awaiting Confirmation';
    case 'delivered':
    case 'delivered_confirmed':
      return 'Delivered';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
};


// --- Interfaces ---
interface PartnerComplaint {
    id: string;
    subject: string;
    description: string;
    date: Date;
    status: 'New' | 'In Progress' | 'Resolved';
    raisedBy: 'Partner' | 'Delivery Partner';
}


interface Order {
  id: string;
  bottles: number;
  status: 'Pending' | 'In Transit' | 'Awaiting Confirmation' | 'Delivered' | 'Cancelled';
  orderDate: Date;
  customerName: string;
  isPartnerOrder: boolean;
  partnerName?: string;

  // ✅ DRIVER REPORTED (FROM DELIVERY PARTNER)
  bottlesDelivered?: number | null;
  emptyBottlesCollected?: number | null;

  // ✅ TEMP CONFIRMATION (PARTNER SIDE)
  _bottlesConfirmed?: string;
  _emptyConfirmed?: string;
  _remarks?: string;
}


interface ReportOut {
    id: number;
    report_date: string;
    file_path: string;
}

interface ComplaintOut {
    id: number;
    subject: string;
    description: string;
    status: 'pending' | 'resolved';
    solution?: string | null;
    created_at: string;
    created_by: {
        full_name: string;
    };
    assigned_to: {
        full_name: string;
    };
}


const Card = ({ label, value, icon, onPress }: { label: string; value: string; icon: string; onPress?: () => void }) => (
    <TouchableOpacity onPress={onPress} style={{ width: '48%' }}>
        <View style={styles.card}>
            <Text style={styles.cardIcon}>{icon}</Text>
            <Text style={styles.cardValue}>{value}</Text>
            <Text style={styles.cardLabel}>{label}</Text>
        </View>
    </TouchableOpacity>
);

const Sidebar = ({
    currentTab,
    onSelectTab,
    onClose,
    onLogout,
}: {
    currentTab: string;
    onSelectTab: (tab: string) => void;
    onClose: () => void;
    onLogout: () => void;
}) => (
    <View style={styles.sidebarContainer}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarHeaderTitle}>Partner Menu</Text>
        </View>
        <ScrollView>
            <SidebarItem label="Dashboard" icon="📊" name="dashboard" active={currentTab === 'dashboard'} onSelect={onSelectTab} />
            <SidebarItem label="My Orders" icon="📋" name="myOrders" active={currentTab === 'myOrders'} onSelect={onSelectTab} />
            <SidebarItem label="Place Order" icon="🛒" name="placeOrder" active={currentTab === 'placeOrder'} onSelect={onSelectTab} />
            <SidebarItem label="Complaints" icon="⚠️" name="complaints" active={currentTab === 'complaints'} onSelect={onSelectTab} />
            <SidebarItem label="Empty Bottles" icon="♻️" name="emptyBottles" active={currentTab === 'emptyBottles'} onSelect={onSelectTab} />
            <SidebarItem label="Test Reports" icon="🔬" name="testReports" active={currentTab === 'testReports'} onSelect={onSelectTab} />
        </ScrollView>
        <TouchableOpacity style={styles.logoutButtonSidebar} onPress={onLogout}>
            <Text style={styles.logoutButtonTextSidebar}>Log Out</Text>
        </TouchableOpacity>
    </View>
);

const SidebarItem = ({
    label,
    icon,
    name,
    active,
    onSelect,
}: {
    label: string;
    icon: string;
    name: string;
    active: boolean;
    onSelect: (name: string) => void;
}) => (
    <TouchableOpacity
        style={[styles.sidebarItem, active && styles.sidebarItemActive]}
        onPress={() => onSelect(name)}>
        <Text style={styles.sidebarIcon}>{icon}</Text>
        <Text style={[styles.sidebarText, active && styles.sidebarTextActive]}>{label}</Text>
    </TouchableOpacity>
);

const PartnerDashboard = ({ navigation }: any) => {
    const [currentTab, setCurrentTab] = useState('dashboard');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [bottlesToOrder, setBottlesToOrder] = useState('');
    const [orderAmount, setOrderAmount] = useState(0);
    const [partnerStoreId, setPartnerStoreId] = useState<number | null>(null);

    const [myOrders, setMyOrders] = useState<Order[]>([]);
    const [totalOrders, setTotalOrders] = useState(0);
    const [pendingOrders, setPendingOrders] = useState(0);
    const [deliveredOrders, setDeliveredOrders] = useState(0);
    const [emptyBottleCount, setEmptyBottleCount] = useState(0);
    
    const [reports, setReports] = useState<ReportOut[]>([]);
    const [reportsLoading, setReportsLoading] = useState(true);

    const [cancelledOrders, setCancelledOrders] = useState(0);
    const [newComplaints, setNewComplaints] = useState(0);
    const [pendingDeliveryComplaints, setPendingDeliveryComplaints] = useState(0);
    const [pendingYourComplaints, setPendingYourComplaints] = useState(0);

    const [isStartDatePickerVisible, setStartDatePickerVisibility] = useState(false);
    const [isEndDatePickerVisible, setEndDatePickerVisibility] = useState(false);
    const [startDate, setStartDate] = useState<Date | null>(null);
    const [endDate, setEndDate] = useState<Date | null>(null);
    
    const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
    
    const [newComplaintSubject, setNewComplaintSubject] = useState('');
    const [newComplaintDescription, setNewComplaintDescription] = useState('');
    const [complaintsRaised, setComplaintsRaised] = useState<ComplaintOut[]>([]);
    const [complaintsAssigned, setComplaintsAssigned] = useState<ComplaintOut[]>([]);

    const [todayOrders, setTodayOrders] = useState(0);
    const [deliveredToday, setDeliveredToday] = useState(0);
    const [deliveredThisMonth, setDeliveredThisMonth] = useState(0);


    const [confirmModalVisible, setConfirmModalVisible] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [confirmedBottles, setConfirmedBottles] = useState('');
    const [confirmedEmptyBottles, setConfirmedEmptyBottles] = useState('');
    const [confirmationRemarks, setConfirmationRemarks] = useState('');


    const [orderedByChannel, setOrderedByChannel] = useState('POC'); 
    const [pocNameInput, setPocNameInput] = useState(''); 
    const [isBackDateMode, setIsBackDateMode] = useState(false);
    const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
    const [unlockPassword, setUnlockPassword] = useState("");
    const [storeHeaderInfo, setStoreHeaderInfo] = useState({ name: '', id: '' });


    const hasPendingConfirmation = myOrders.some(
        (o) => o.status === 'Awaiting Confirmation'
    );

    

    // ================= EMPTY BOTTLES (FIXED) =================
const fetchEmptyBottles = async (token: string) => {
    try {
        const response = await axios.get(
            `${API_BASE_URL}/bottle/partner/me/empty-bottles`,
            {
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        /**
         * Backend may return:
         * 1️⃣ number → 12
         * 2️⃣ object → { pending_empty_bottles: 12 }
         */
        const emptyCount =
            typeof response.data === 'number'
                ? response.data
                : Number(response.data?.pending_empty_bottles ?? 0);

        setEmptyBottleCount(emptyCount);
    } catch (error) {
        console.error('Failed to fetch empty bottles:', error);
        setEmptyBottleCount(0);
    }
};

// ================= INITIAL LOAD =================
useEffect(() => {
    const checkTokenAndFetchData = async () => {
        setLoading(true);

        const token = await AsyncStorage.getItem('auth_token');
        if (!token) {
            Alert.alert('Session Expired', 'Please log in again.');
            navigation.navigate('LoginScreen');
            setLoading(false);
            return;
        }

        await Promise.all([
            fetchData(token),
            fetchComplaints(token),
            fetchReports(token),
            fetchEmptyBottles(token),
        ]);

        setLoading(false);
    };

    checkTokenAndFetchData();
}, []);

// ================= DASHBOARD DATA =================
    const fetchData = async (token: string) => {
    try {
        // 1️⃣ -------- STORE INFO (Header Fix) --------
        const storesResponse = await axios.get(
            `${API_BASE_URL}/partners/partners/me/stores`,
            {
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        if (storesResponse.status === 401) {
            Alert.alert('Session Expired', 'Please log in again.');
            handleLogout();
            return;
        }

        const storesData = storesResponse.data;
        if (storesData?.length > 0) {
            const currentStore = storesData[0];
            setPartnerStoreId(currentStore.id);
            
            // 🔥 Yahan se data dashboard header mein jayega
            setStoreHeaderInfo({
                name: currentStore.store_name || "Partner Store",
                id: currentStore.id.toString()
            });
        } else {
            Alert.alert('Store Not Found', 'No store linked to your account.');
        }

        // 2️⃣ -------- ORDERS (Web Portal Sync) --------
        const ordersResponse = await axios.get(
            `${API_BASE_URL}/partner/orders/me`,
            {
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        const formattedOrders: Order[] = (ordersResponse.data || []).map(
            (order: any): Order => ({
                id: String(order.id),
                bottles: Number(order.order_details) || 0,
                status: order.status === "delivered_pending_confirmation" 
                        ? "Awaiting Confirmation" 
                        : backendToUiStatus(order.status),
                // 🔥 Web portal date logic
                orderDate: new Date(order.order_date || order.created_at),
                customerName: order.store?.store_name || 'Store',
                isPartnerOrder: true,
                partnerName: order.partner?.full_name || '',

                // Driver Reporting Data
                bottlesDelivered: order.bottles_delivered ?? 0,
                emptyBottlesCollected: order.empty_bottles_collected ?? 0,
            })
        );

        // Sorting: Newest first (jaisa web portal activity mein hota hai)
        const sortedOrders = [...formattedOrders].sort((a, b) => 
            b.orderDate.getTime() - a.orderDate.getTime()
        );

        setMyOrders(sortedOrders);
        setFilteredOrders(sortedOrders);

        // 3️⃣ -------- KPIs (Performance Sync) --------
        const today = new Date();
        const month = today.getMonth();
        const year = today.getFullYear();

        setTotalOrders(formattedOrders.length);

        setPendingOrders(
            formattedOrders.filter((o: Order) =>
                ['Pending', 'In Transit', 'Awaiting Confirmation'].includes(o.status)
            ).length
        );

        setDeliveredOrders(
            formattedOrders.filter((o: Order) => o.status === 'Delivered').length
        );

        setTodayOrders(
            formattedOrders.filter((o: Order) =>
                o.orderDate.toDateString() === today.toDateString()
            ).length
        );

        setDeliveredToday(
            formattedOrders.filter((o: Order) =>
                o.status === 'Delivered' &&
                o.orderDate.toDateString() === today.toDateString()
            ).length
        );

        setDeliveredThisMonth(
            formattedOrders.filter((o: Order) =>
                o.status === 'Delivered' &&
                o.orderDate.getMonth() === month &&
                o.orderDate.getFullYear() === year
            ).length
        );

    } catch (error) {
        console.error('API call failed:', error);
        Alert.alert(
            'Data Fetch Error',
            'Failed to load dashboard data. Please try again.'
        );
    }
};



    const fetchComplaints = async (token: string) => {
        try {
            const myComplaintsResponse = await axios.get(
                `${API_BASE_URL}/complaints/complaints/me`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            setComplaintsRaised(myComplaintsResponse.data);

            setPendingYourComplaints(
                myComplaintsResponse.data.filter(
                    (c: ComplaintOut) => c.status === "pending"
                ).length
            );
        } catch (error: any) {
            console.error(
                "Failed to fetch raised complaints:",
                error.response?.data || error.message
            );
            setComplaintsRaised([]);
            setPendingYourComplaints(0);
        }

        try {
            const assignedComplaintsResponse = await axios.get(
                `${API_BASE_URL}/complaints/complaints/assigned`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            setComplaintsAssigned(assignedComplaintsResponse.data);

            setNewComplaints(
                assignedComplaintsResponse.data.filter(
                    (c: ComplaintOut) => c.status === "pending"
                ).length
            );
            setPendingDeliveryComplaints(
                assignedComplaintsResponse.data.filter(
                    (c: ComplaintOut) => c.status === "pending"
                ).length
            );
        } catch (error: any) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                console.log("No complaints assigned.");
                setComplaintsAssigned([]);
                setNewComplaints(0);
                setPendingDeliveryComplaints(0);
            } else {
                console.error(
                    "Failed to fetch assigned complaints:",
                    error.response?.data || error.message
                );
                setComplaintsAssigned([]);
                setNewComplaints(0);
                setPendingDeliveryComplaints(0);
            }
        }
    };
    
    const fetchReports = async (token: string) => {
        setReportsLoading(true);
        try {
            const response = await axios.get(`${API_BASE_URL}/reports/reports/list`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setReports(response.data);
        } catch (error) {
            console.error('Failed to fetch reports:', error);
            Alert.alert('Error', 'Failed to load reports.');
            setReports([]);
        } finally {
            setReportsLoading(false);
        }
    };


    const handleConfirmDelivery = async () => {
        if (!selectedOrder) return;

        if (!confirmedBottles || !confirmedEmptyBottles) {
            Alert.alert('Validation Error', 'Please fill all required fields.');
            return;
        }

        const token = await AsyncStorage.getItem('auth_token');
        if (!token) {
            Alert.alert('Session Expired', 'Please login again.');
            navigation.navigate('LoginScreen');
            return;
        }

        try {
            await axios.put(
                `${API_BASE_URL}/partners/partners/partner/orders/${selectedOrder.id}/confirm-delivery`,
                {
                    confirmed_bottles: Number(confirmedBottles),
                    confirmed_empty_bottles: Number(confirmedEmptyBottles),
                    confirmation_remarks: confirmationRemarks || '',
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            Alert.alert('Success', 'Delivery confirmed successfully');

            setConfirmModalVisible(false);
            setSelectedOrder(null);
            setConfirmedBottles('');
            setConfirmedEmptyBottles('');
            setConfirmationRemarks('');

            await fetchData(token); // 🔄 refresh orders
        } catch (error: any) {
            Alert.alert(
                'Error',
                error?.response?.data?.detail || 'Failed to confirm delivery'
            );
        }
    };

    
    const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        {
            text: 'Yes',
            onPress: async () => {
                await AsyncStorage.multiRemove(['auth_token', 'user_role']);
                // 🔥 Ye line stack clear karke login pe bhej degi
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Login' }], 
                });
            },
        },
    ]);
};
    const handleSelectTab = async (tab: string) => {
        setCurrentTab(tab);
        setIsSidebarOpen(false);
        const token = await AsyncStorage.getItem('auth_token');
        if (!token) {
            Alert.alert('Session Expired', 'Please log in again.');
            navigation.navigate('Login');
            return;
        }

        if (tab === 'complaints') {
            fetchComplaints(token);
        } else if (tab === 'testReports') {
            fetchReports(token);
        } else if (tab === 'emptyBottles') {
            fetchEmptyBottles(token);
        }
    };

    const showStartDatePicker = () => setStartDatePickerVisibility(true);
    const hideStartDatePicker = () => setStartDatePickerVisibility(false);
    const handleConfirmStartDate = (date: Date) => {
        setStartDate(date);
        hideStartDatePicker();
    };

    const showEndDatePicker = () => setEndDatePickerVisibility(true);
    const hideEndDatePicker = () => setEndDatePickerVisibility(false);
    const handleConfirmEndDate = (date: Date) => {
        setEndDate(date);
        hideEndDatePicker();
    };
    
    const handleClearDates = () => {
        setStartDate(null);
        setEndDate(null);
    };

    useEffect(() => {
        if (startDate && endDate) {
            const filtered = myOrders.filter(order => {
                const orderDate = new Date(order.orderDate);
                return orderDate >= startDate && orderDate <= endDate;
            });
            setFilteredOrders(filtered);
        } else {
            setFilteredOrders(myOrders);
        }
    }, [startDate, endDate, myOrders]);

    const handleExportOrders = async () => {
        setLoading(true);
        try {
            const token = await AsyncStorage.getItem('auth_token');
            if (!token) {
                Alert.alert('Authentication failed', 'Please log in again.');
                navigation.navigate('LoginScreen');
                return;
            }

            const response = await axios.get(`${API_BASE_URL}/partners/partners/me/orders/export-all`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (response.data.length === 0) {
                Alert.alert('No Data', 'There are no orders to export.');
                return;
            }

            const ordersForExport = response.data.map((order: any) => ({
                'Order ID': order.id,
                'Bottles': order.order_details,
                'Status': order.status,
                'Date': new Date(order.created_at).toLocaleDateString(),
                'Customer Name': order.store?.store_name || 'N/A',
            }));

            const fileName = `My_Orders_${new Date().toISOString().slice(0, 10)}`;
            
            await exportToExcel(ordersForExport, fileName);

            Alert.alert('Success', `Orders exported successfully! You can find the file in your phone's file manager at: Internal Storage/Android/data/[your-package-name]/files/`);
            
        } 
        catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('API Error:', error.response?.data || error.message);
                Alert.alert('Export Error', error.response?.data.detail || 'Failed to fetch orders for export. Please check your network and try again.');
            } else if (error instanceof Error) {
                console.error('General Error:', error.message);
                Alert.alert('Export Error', error.message);
            } else {
                console.error('Unknown Error:', error);
                Alert.alert('Export Error', 'An unexpected error occurred.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleRaiseComplaint = async () => {
        if (newComplaintSubject.trim() === '' || newComplaintDescription.trim() === '') {
            Alert.alert('Error', 'Please fill in all complaint details.');
            return;
        }

        const token = await AsyncStorage.getItem('auth_token');
        if (!token) {
            Alert.alert('Authentication failed', 'Please log in again.');
            navigation.navigate('LoginScreen');
            return;
        }

        const superAdminId = 1;
        const url = `${API_BASE_URL}/complaints/complaints/submit`;
        console.log(`Attempting to post to URL: ${url}`);

        try {
            const response = await axios.post(url, {
                subject: newComplaintSubject,
                description: newComplaintDescription,
                assigned_to_id: superAdminId,
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (response.status === 201 || response.status === 200) {
                Alert.alert('Success', 'Complaint raised successfully!');
                setNewComplaintSubject('');
                setNewComplaintDescription('');
                fetchComplaints(token);
            }

        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('API Error:', error.response?.data || error.message);
                Alert.alert('Error', error.response?.data.detail || 'Failed to raise complaint.');
            } else if (error instanceof Error) {
                console.error('General Error:', error.message);
                Alert.alert('Error', 'An unexpected error occurred while raising the complaint.');
            }
        }
    };

    const handlePlaceOrder = async () => {
    const bottles = parseInt(bottlesToOrder, 10);
    const PRICE_PER_BOTTLE = 42;
    const totalAmount = bottles * PRICE_PER_BOTTLE;

    // ---------------- VALIDATIONS ----------------
    if (!partnerStoreId) {
        Alert.alert(
            'Store Missing',
            'Store information not found. Please log in again.'
        );
        return;
    }

    if (isNaN(bottles) || bottles <= 0) {
        Alert.alert(
            'Invalid Input',
            'Please enter a valid number of bottles.'
        );
        return;
    }

    // 🔒 BLOCK IF PREVIOUS ORDER AWAITING CONFIRMATION
    const hasPendingConfirmation = myOrders.some(
        (order) => order.status === 'Awaiting Confirmation'
    );

    if (hasPendingConfirmation) {
        Alert.alert(
            'Action Blocked',
            'Please confirm the previous delivery before placing a new order.'
        );
        return;
    }

    // ---------------- CONFIRMATION ----------------
    Alert.alert(
        'Confirm Order',
        `Place order for ${bottles} bottle(s)?\nTotal Amount: ₹${totalAmount}`,
        [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Confirm',
                onPress: async () => {
                    setLoading(true);
                    try {
                        const token = await AsyncStorage.getItem('auth_token');
                        if (!token) {
                            Alert.alert(
                                'Session Expired',
                                'Please log in again.'
                            );
                            navigation.navigate('LoginScreen');
                            return;
                        }

                        const response = await axios.post(
                            `${API_BASE_URL}/partner/orders`,
                            {
                                store_id: partnerStoreId,
                                order_details: bottles.toString(),
                                total_amount: totalAmount,
                            },
                            {
                                headers: {
                                    Authorization: `Bearer ${token}`,
                                    'Content-Type': 'application/json',
                                },
                            }
                        );

                        if (![200, 201].includes(response.status)) {
                            throw new Error(
                                response.data?.detail ||
                                    'Failed to place order'
                            );
                        }

                        // 🔄 Refresh data instead of pushing raw response
                        await fetchData(token);

                        Alert.alert(
                            'Success',
                            `Order for ${bottles} bottles placed successfully!`
                        );

                        setBottlesToOrder('');
                        setOrderAmount(0);
                        setCurrentTab('myOrders');
                    } catch (error: any) {
                        console.error('Order Error:', error);

                        Alert.alert(
                            'Order Failed',
                            error?.response?.data?.detail ||
                                error.message ||
                                'Something went wrong while placing order.'
                        );
                    } finally {
                        setLoading(false);
                    }
                },
            },
        ]
    );
};


    const renderDashboard = () => (
  <ScrollView contentContainerStyle={styles.scrollContent}>
    <View style={styles.cardContainer}>
      
      {/* 🔥 Web Style Store Header Section */}
      <View style={styles.storeHeaderCard}>
        <Text style={styles.storeNameText}>{storeHeaderInfo.name || 'Loading Store...'}</Text>
        <View style={styles.storeIdBadge}>
          <Text style={styles.storeIdText}>📍 Store ID: {storeHeaderInfo.id || 'N/A'}</Text>
        </View>
      </View>
      
      <Text style={[styles.sectionTitle, { textAlign: 'left', marginLeft: 10, marginBottom: 15 }]}>
        Performance Overview
      </Text>

      {/* KPI Rows */}
      <View style={styles.kpiRow}>
        <Card label="Total Orders" value={totalOrders.toString()} icon="📦" onPress={() => handleSelectTab('myOrders')} />
        <Card label="Pending Orders" value={pendingOrders.toString()} icon="⏳" onPress={() => handleSelectTab('myOrders')} />
      </View>

      <View style={styles.kpiRow}>
        <Card label="Delivered Today" value={deliveredToday.toString()} icon="🚚" onPress={() => handleSelectTab('myOrders')} />
        <Card label="Empty Bottles" value={emptyBottleCount.toString()} icon="♻️" onPress={() => handleSelectTab('emptyBottles')} />
      </View>

      {/* Recent Activity Section */}
      <View style={[styles.itemCard, { marginTop: 10 }]}>
        <Text style={[styles.sectionTitle, { borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 10 }]}>
          Recent Activity
        </Text>
        {myOrders.slice(0, 5).length > 0 ? (
          myOrders.slice(0, 5).map((order) => (
            <View key={order.id} style={styles.orderListItem}>
              <View>
                <Text style={styles.orderIdText}>Order #{order.id}</Text>
                <Text style={styles.itemDetails}>{order.bottles} Bottles</Text>
              </View>
              <Text style={[styles.statusBadge, order.status === 'Delivered' ? styles.statusDelivered : styles.statusInTransit]}>
                {order.status}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.noDataText}>No recent activity found.</Text>
        )}
      </View>
    </View>
  </ScrollView>
);


 



    const renderMyOrders = () => {
  const awaitingOrders = filteredOrders.filter(o => o.status === 'Awaiting Confirmation');
  const pendingOrders = filteredOrders.filter(o => o.status === 'Pending' || o.status === 'In Transit');
  const deliveredOrders = filteredOrders.filter(o => o.status === 'Delivered');

  // Reusable Detail Row Component for cleaner UI
  const DetailRow = ({ label, value, color = '#333' }: any) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: 3 }}>
      <Text style={{ fontSize: 13, color: '#6B7280', fontWeight: '600' }}>{label}:</Text>
      <Text style={{ fontSize: 13, color: color, fontWeight: '700', textAlign: 'right' }}>{value}</Text>
    </View>
  );

  const renderOrderCard = (order: any, isAwaiting = false) => (
    <View key={order.id} style={[styles.itemCard, isAwaiting && { backgroundColor: '#FFFBEB', borderColor: '#F59E0B', borderWidth: 1 }]}>
      {/* Header: Order ID & Status */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 10, marginBottom: 10 }}>
        <Text style={{ fontSize: 16, fontWeight: '800', color: '#1A2A44' }}>Order #{order.id}</Text>
        <Text style={[styles.statusBadge, 
          order.status === 'Delivered' ? styles.statusDelivered : 
          order.status === 'Awaiting Confirmation' ? styles.statusInTransit : styles.statusPending]}>
          {order.status}
        </Text>
      </View>

      {/* Primary Details */}
      <DetailRow label="Order Date" value={new Date(order.orderDate).toLocaleDateString("en-GB")} />
      <DetailRow label="Bottles Ordered" value={`${order.bottles} Units`} />
      
      <View style={{ height: 1, backgroundColor: '#F3F4F6', marginVertical: 8 }} />

      {/* Advanced Details (From Super Admin Logic) */}
      <DetailRow label="Assigned Manager" value={order.assignedManager || "Not Assigned"} color="#4F46E5" />
      <DetailRow label="Delivery Partner" value={order.deliveryPartnerName || "Unassigned"} color="#1565C0" />
      
      {/* Reported Count (Driver Side) */}
      {(order.bottlesDelivered !== null || order.emptyBottlesCollected !== null) && (
        <View style={{ marginTop: 10, padding: 10, backgroundColor: 'rgba(79, 70, 229, 0.05)', borderRadius: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#4F46E5', marginBottom: 5 }}>🚚 DRIVER REPORTED:</Text>
          <DetailRow label="Delivered" value={order.bottlesDelivered || 0} color="#10B981" />
          <DetailRow label="Empty Picked" value={order.emptyBottlesCollected || 0} color="#F59E0B" />
        </View>
      )}

      {/* Proof Section (Image View) */}
      {order.deliveryPhoto && (
        <TouchableOpacity 
          onPress={() => Linking.openURL(order.deliveryPhoto.startsWith('http') ? order.deliveryPhoto : `${API_BASE_URL}${order.deliveryPhoto}`)}
          style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 8, borderWidth: 1, borderColor: '#1565C0', borderRadius: 8, borderStyle: 'dashed' }}
        >
          <Text style={{ color: '#1565C0', fontWeight: 'bold', fontSize: 13 }}>👁️ View Delivery Proof</Text>
        </TouchableOpacity>
      )}

      {/* Confirmation Button for Partner */}
      {isAwaiting && (
        <TouchableOpacity
          style={[styles.button, styles.createButton, { marginTop: 15 }]}
          onPress={() => {
            setSelectedOrder(order);
            setConfirmedBottles(String(order.bottlesDelivered ?? order.bottles));
            setConfirmedEmptyBottles(String(order.emptyBottlesCollected ?? 0));
            setConfirmModalVisible(true);
          }}
        >
          <Text style={styles.buttonText}>✅ CONFIRM DELIVERY</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.listContainer} contentContainerStyle={{ paddingBottom: 30 }}>
      <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back to Dashboard</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Order Management</Text>

      {/* 📅 Date Filter Card */}
      <View style={styles.formCard}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#374151', marginBottom: 12 }}>Filter by Date Range</Text>
        <View style={styles.datePickerRow}>
          <TouchableOpacity style={styles.datePickerInput} onPress={showStartDatePicker}>
            <Text style={styles.datePickerText}>{startDate ? startDate.toLocaleDateString() : 'Start Date'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.datePickerInput} onPress={showEndDatePicker}>
            <Text style={styles.datePickerText}>{endDate ? endDate.toLocaleDateString() : 'End Date'}</Text>
          </TouchableOpacity>
          {(startDate || endDate) && (
            <TouchableOpacity style={styles.clearButton} onPress={handleClearDates}>
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <TouchableOpacity style={[styles.button, styles.exportButton]} onPress={handleExportOrders}>
        <Text style={styles.buttonText}>📥 EXPORT ALL ORDERS (EXCEL)</Text>
      </TouchableOpacity>

      {/* 🟠 Group 1: Awaiting Confirmation */}
      {awaitingOrders.length > 0 && (
        <View>
          <Text style={{ color: '#B45309', fontWeight: 'bold', marginLeft: 10, marginBottom: 10 }}>⏳ NEEDS YOUR CONFIRMATION</Text>
          {awaitingOrders.map(o => renderOrderCard(o, true))}
        </View>
      )}

      {/* 🔵 Group 2: Active Orders */}
      {pendingOrders.length > 0 && (
        <View style={{ marginTop: 15 }}>
          <Text style={{ color: '#1E40AF', fontWeight: 'bold', marginLeft: 10, marginBottom: 10 }}>📦 ACTIVE ORDERS</Text>
          {pendingOrders.map(o => renderOrderCard(o))}
        </View>
      )}

      {/* 🟢 Group 3: History */}
      {deliveredOrders.length > 0 && (
        <View style={{ marginTop: 15 }}>
          <Text style={{ color: '#065F46', fontWeight: 'bold', marginLeft: 10, marginBottom: 10 }}>✅ COMPLETED ORDERS</Text>
          {deliveredOrders.map(o => renderOrderCard(o))}
        </View>
      )}

      {filteredOrders.length === 0 && <Text style={styles.noDataText}>No orders found for selected criteria.</Text>}
    </ScrollView>
  );
};



    const renderPlaceOrder = () => (
  <ScrollView contentContainerStyle={styles.scrollContent}>
    <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
      <Text style={styles.backButtonText}>← Back to Dashboard</Text>
    </TouchableOpacity>

    <View style={styles.formCard}>
      <Text style={styles.sectionTitle}>🛒 Place a New Order</Text>

      {/* Block Banner */}
      {hasPendingConfirmation && (
        <View style={{ backgroundColor: '#FEF3C7', padding: 12, borderRadius: 10, marginBottom: 15, borderLeftWidth: 5, borderLeftColor: '#F59E0B' }}>
          <Text style={{ color: '#92400E', fontWeight: 'bold' }}>⚠️ Action Blocked: Confirm previous delivery first.</Text>
        </View>
      )}

      {/* PIN Unlock for Admin Back-date (Web Feature) */}
      {orderedByChannel === 'ADMIN' && !isBackDateMode && (
        <View style={{ marginBottom: 15 }}>
          <Text style={styles.formLabel}>Admin PIN to Unlock Back-date:</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Enter 4-digit PIN"
            keyboardType="numeric"
            secureTextEntry
            maxLength={4}
            onChangeText={(val) => {
              setUnlockPassword(val);
              if (val === "9075") {
                setIsBackDateMode(true);
                Alert.alert("Success", "Back-date mode unlocked!");
              }
            }}
          />
        </View>
      )}

      <Text style={styles.formLabel}>Ordered By:</Text>
      <View style={{ flexDirection: 'row', gap: 20, marginBottom: 20 }}>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }} onPress={() => { setOrderedByChannel('POC'); setIsBackDateMode(false); }}>
          <Text style={{ fontSize: 18 }}>{orderedByChannel === 'POC' ? '🔘' : '⚪'}</Text>
          <Text style={{ marginLeft: 8, fontWeight: 'bold' }}>POC Staff</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }} onPress={() => setOrderedByChannel('ADMIN')}>
          <Text style={{ fontSize: 18 }}>{orderedByChannel === 'ADMIN' ? '🔘' : '⚪'}</Text>
          <Text style={{ marginLeft: 8, fontWeight: 'bold' }}>Admin</Text>
        </TouchableOpacity>
      </View>

      {orderedByChannel === 'POC' && (
        <View style={{ marginBottom: 15 }}>
          <Text style={styles.formLabel}>Staff / POC Name:</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Enter name"
            value={pocNameInput}
            onChangeText={setPocNameInput}
            cursorColor="#4F46E5"
          />
        </View>
      )}

      {isBackDateMode && (
        <View style={{ marginBottom: 15, padding: 10, backgroundColor: '#E9F5FF', borderRadius: 8 }}>
          <Text style={styles.formLabel}>📅 Select Past Date:</Text>
          <TextInput
            style={styles.textInput}
            value={orderDate}
            placeholder="YYYY-MM-DD"
            onChangeText={setOrderDate}
          />
        </View>
      )}

      <Text style={styles.formLabel}>Number of Bottles:</Text>
      <TextInput
        style={styles.textInput}
        placeholder="0"
        keyboardType="numeric"
        editable={!hasPendingConfirmation}
        value={bottlesToOrder}
        onChangeText={setBottlesToOrder}
        cursorColor="#4F46E5"
      />

      <TouchableOpacity
        onPress={handlePlaceOrder}
        style={[styles.button, styles.createButton, hasPendingConfirmation && { backgroundColor: '#9CA3AF' }]}
        disabled={loading || hasPendingConfirmation}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {hasPendingConfirmation ? 'CONFIRM PREVIOUS ORDER' : `Submit Order for ${isBackDateMode ? orderDate : 'Today'}`}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  </ScrollView>
);


    const renderComplaints = () => (
        <ScrollView contentContainerStyle={styles.scrollContent}>
            <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back to Dashboard</Text>
            </TouchableOpacity>
            <View style={styles.cardContainer}>
                <Text style={styles.sectionTitle}>Complaints</Text>

                <View style={styles.formCard}>
                    <Text style={styles.formTitle}>Raise a New Complaint</Text>
                    <TextInput
                        style={styles.textInput}
                        placeholder="Complaint Subject"
                        placeholderTextColor="#9CA3AF"
                        value={newComplaintSubject}
                        onChangeText={setNewComplaintSubject}
                    />
                    <TextInput
                        style={styles.textInputArea}
                        placeholder="Complaint Description"
                        placeholderTextColor="#9CA3AF"
                        multiline
                        numberOfLines={4}
                        value={newComplaintDescription}
                        onChangeText={setNewComplaintDescription}
                    />
                    <TouchableOpacity
                        onPress={handleRaiseComplaint}
                        style={[styles.button, styles.createButton]}
                    >
                        <Text style={styles.buttonText}>Raise Complaint</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.complaintSection}>
                    <Text style={styles.itemTitle}>Complaints Raised by You</Text>
                    {complaintsRaised.length === 0 ? (
                        <Text style={styles.noDataText}>No complaints raised by you.</Text>
                    ) : (
                        complaintsRaised.map((c: ComplaintOut) => (
                            <View
                                key={c.id}
                                style={[
                                    styles.itemCard,
                                    c.status === "resolved" && styles.resolvedCard,
                                ]}
                            >
                                <View style={styles.itemHeader}>
                                    <Text style={styles.itemTitle}>
                                        {c.subject}{" "}
                                        <Text style={{ fontSize: 12, color: "#6B7280" }}>
                                            (ID: {c.id})
                                        </Text>
                                    </Text>
                                    <Text
                                        style={[
                                            styles.statusBadge,
                                            c.status === "pending"
                                                ? styles.statusPending
                                                : styles.statusDelivered,
                                        ]}
                                    >
                                        {c.status}
                                    </Text>
                                </View>
                                <Text style={styles.itemDetails}>{c.description}</Text>
                                <Text style={styles.itemDetails}>
                                    Raised to: {c.assigned_to.full_name}
                                </Text>
                                {c.solution && (
                                    <Text
                                        style={[
                                            styles.itemDetails,
                                            {
                                                marginTop: 10,
                                                fontStyle: "italic",
                                                color: "#10B981",
                                            },
                                        ]}
                                    >
                                        Solution: {c.solution}
                                    </Text>
                                )}
                            </View>
                        ))
                    )}
                </View>

                <View style={styles.complaintSection}>
                    <Text style={styles.itemTitle}>Complaints Assigned to You</Text>
                    {complaintsAssigned.length === 0 ? (
                        <Text style={styles.noDataText}>
                            No complaints from delivery partners.
                        </Text>
                    ) : (
                        complaintsAssigned.map((c: ComplaintOut) => (
                            <View
                                key={c.id}
                                style={[
                                    styles.itemCard,
                                    c.status === "resolved" && styles.resolvedCard,
                                ]}
                            >
                                <View style={styles.itemHeader}>
                                    <Text style={styles.itemTitle}>
                                        {c.subject}{" "}
                                        <Text style={{ fontSize: 12, color: "#6B7280" }}>
                                            (ID: {c.id})
                                        </Text>
                                    </Text>
                                    <Text
                                        style={[
                                            styles.statusBadge,
                                            c.status === "pending"
                                                ? styles.statusPending
                                                : styles.statusDelivered,
                                        ]}
                                    >
                                        {c.status}
                                    </Text>
                                </View>
                                <Text style={styles.itemDetails}>{c.description}</Text>
                                <Text style={styles.itemDetails}>
                                    Raised by: {c.created_by.full_name}
                                </Text>
                                {c.solution && (
                                    <Text
                                        style={[
                                            styles.itemDetails,
                                            {
                                                marginTop: 10,
                                                fontStyle: "italic",
                                                color: "#10B981",
                                            },
                                        ]}
                                    >
                                        Solution: {c.solution}
                                    </Text>
                                )}
                            </View>
                        ))
                    )}
                </View>
            </View>
        </ScrollView>
    );


    const renderEmptyBottles = () => (
        <ScrollView contentContainerStyle={styles.scrollContent}>
            <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back to Dashboard</Text>
            </TouchableOpacity>
            <View style={styles.cardContainer}>
                <Text style={styles.sectionTitle}>Empty Bottle Management</Text>
                <View style={styles.formCard}>
                    <Text style={styles.formTitle}>Current Empty Bottles</Text>
                    <Text style={styles.emptyBottleCountText}>{emptyBottleCount}</Text>
                    <Text style={styles.itemDetails}>
                        This is the current count of empty bottles you have in your inventory. This count is used to manage pickups.
                    </Text>
                </View>
            </View>
        </ScrollView>
    );


    const renderTestReports = () => (
        <View style={styles.listContainer}>
            <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back to Dashboard</Text>
            </TouchableOpacity>
            <Text style={styles.sectionTitle}>Test Reports</Text>
            {reportsLoading ? (
                <ActivityIndicator size="large" color="#4F46E5" style={styles.loadingContainer} />
            ) : reports.length === 0 ? (
                <Text style={styles.noDataText}>No reports available at this time.</Text>
            ) : (
                <FlatList
                    data={reports}
                    keyExtractor={item => item.id.toString()}
                    renderItem={({ item: report }: { item: ReportOut }) => (
                        <View style={styles.itemCard}>
                            <View style={styles.itemHeader}>
                                <Text style={styles.itemTitle}>Report ID: {report.id}</Text>
                            </View>
                            <Text style={styles.itemDetails}>
                                Date: {new Date(report.report_date).toLocaleDateString()}
                            </Text>
                            <TouchableOpacity
                                onPress={() => Linking.openURL(report.file_path)}
                                style={[styles.button, styles.createButton]}
                            >
                                <Text style={styles.buttonText}>View PDF</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                />
            )}
        </View>
    );

    const renderMainContent = () => {
        if (loading) {
            return (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#4F46E5" />
                    <Text style={styles.loadingText}>Loading...</Text>
                </View>
            );
        }
        switch (currentTab) {
            case 'dashboard':
                return renderDashboard();
            case 'myOrders':
                return renderMyOrders();
            case 'placeOrder':
                return renderPlaceOrder();
            case 'complaints':
                return renderComplaints();
            case 'emptyBottles':
                return renderEmptyBottles();
            case 'testReports':
                return renderTestReports();
            default:
                return <Text style={styles.errorText}>Something went wrong!</Text>;
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            {/* 🔥 NEW: Modern Clean Header (Centered Title) */}
            <View style={styles.modernHeader}>
                <TouchableOpacity 
                    onPress={() => setIsSidebarOpen(true)} 
                    style={styles.modernHamburger}
                    activeOpacity={0.7}
                >
                    <Text style={styles.modernHamburgerIcon}>☰</Text>
                </TouchableOpacity>
                
                <View style={styles.modernHeaderCenter}>
                    <Text style={styles.modernHeaderSub}>AQUATRACK PARTNER</Text>
                </View>

                {/* Balance View taaki title center mein rahe */}
                <View style={{ width: 45 }} /> 
            </View>

            {renderMainContent()}

            {/* ================= CONFIRM DELIVERY MODAL ================= */}
            <Modal
                visible={confirmModalVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setConfirmModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.confirmModal}>
                        <Text style={styles.sectionTitle}>Confirm Delivery</Text>
                        <Text style={styles.itemDetails}>Order #{selectedOrder?.id}</Text>

                        <TextInput
                            style={styles.textInput}
                            placeholder="Delivered Bottles"
                            keyboardType="numeric"
                            value={confirmedBottles}
                            onChangeText={setConfirmedBottles}
                            cursorColor="#4F46E5"
                        />

                        <TextInput
                            style={styles.textInput}
                            placeholder="Empty Bottles Collected"
                            keyboardType="numeric"
                            value={confirmedEmptyBottles}
                            onChangeText={setConfirmedEmptyBottles}
                            cursorColor="#4F46E5"
                        />

                        <TextInput
                            style={styles.textInputArea}
                            placeholder="Remarks (optional)"
                            value={confirmationRemarks}
                            onChangeText={setConfirmationRemarks}
                            cursorColor="#4F46E5"
                        />

                        <View style={{ flexDirection: 'row', marginTop: 10 }}>
                            <TouchableOpacity
                                style={[styles.button, { backgroundColor: '#9CA3AF', flex: 1, marginRight: 8 }]}
                                onPress={() => setConfirmModalVisible(false)}
                            >
                                <Text style={styles.buttonText}>Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.button, styles.createButton, { flex: 1 }]}
                                onPress={handleConfirmDelivery}
                            >
                                <Text style={styles.buttonText}>Confirm</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ================= SIDEBAR MODAL ================= */}
            <Modal visible={isSidebarOpen} transparent={true} animationType="fade" onRequestClose={() => setIsSidebarOpen(false)}>
                <View style={styles.modalOverlay}>
                    <Sidebar 
                        currentTab={currentTab} 
                        onSelectTab={handleSelectTab} 
                        onClose={() => setIsSidebarOpen(false)} 
                        onLogout={handleLogout} 
                    />
                </View>
            </Modal>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F3F4F6',
    },
    // 🔥 Modern Header Style
    modernHeader: {
    flexDirection: 'row',
    alignItems: 'center', // Vertically centers the items
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingTop: 10, // Added padding to push it down from the very top
    height: 75, // Increased height slightly for better vertical breathing room
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    elevation: 3,
    zIndex: 1000,
},
modernHamburger: {
    padding: 15, // Increased padding for a larger touch target
    minWidth: 50, // Ensures a consistent clickable width
    justifyContent: 'center',
    alignItems: 'center',
},
modernHamburgerIcon: {
    fontSize: 28, // Slightly larger icon for better visibility
    color: '#1A2A44',
    lineHeight: 30, // Ensures the icon doesn't get clipped
},
modernHeaderCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
},
    modernHeaderSub: {
        fontSize: 15,
        fontWeight: '900',
        color: '#1A2A44',
        letterSpacing: 1.2,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    sidebarContainer: {
        width: '75%',
        height: '100%',
        backgroundColor: '#fff',
        paddingTop: 50,
        borderTopRightRadius: 20,
        borderBottomRightRadius: 20,
        justifyContent: 'space-between',
    },
    closeButton: {
        alignSelf: 'flex-end',
        paddingHorizontal: 20,
        paddingBottom: 10,
    },
    closeButtonText: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#6B7280',
    },
    sidebarHeader: {
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    sidebarHeaderTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1F2937',
    },
    sidebarItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 18,
        paddingHorizontal: 20,
    },
    sidebarItemActive: {
        backgroundColor: '#F3F4F6',
        borderLeftWidth: 4,
        borderLeftColor: '#4F46E5',
    },
    sidebarIcon: {
        fontSize: 22,
        marginRight: 15,
    },
    sidebarText: {
        fontSize: 18,
        fontWeight: '500',
        color: '#6B7280',
    },
    sidebarTextActive: {
        fontWeight: 'bold',
        color: '#4F46E5',
    },
    scrollContent: {
        flexGrow: 1,
        padding: 10,
    },
    listContainer: {
        flex: 1,
        padding: 10,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 300,
    },
    loadingText: {
        fontSize: 18,
        color: '#4F46E5',
        fontWeight: 'bold',
        marginTop: 10,
    },
    cardContainer: {
        padding: 10,
    },
    sectionTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#1F2937',
        marginBottom: 20,
        textAlign: 'center',
    },
    kpiRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 15,
    },
    card: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 15,
        padding: 20,
        marginHorizontal: 5,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 5,
        elevation: 5,
    },
    cardIcon: {
        fontSize: 28,
        marginBottom: 8,
    },
    cardLabel: {
        fontSize: 14,
        color: '#6B7280',
        fontWeight: '600',
        textAlign: 'center',
    },
    cardValue: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#1F2937',
        marginTop: 5,
    },
    itemCard: {
        backgroundColor: '#fff',
        borderRadius: 15,
        padding: 20,
        marginBottom: 15,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 5,
        elevation: 5,
    },
    formCard: {
        backgroundColor: '#fff',
        borderRadius: 15,
        padding: 20,
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 3,
    },
    formTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1F2937',
        marginBottom: 15,
    },
    textInput: {
        height: 50,
        borderColor: '#D1D5DB',
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 15,
        marginBottom: 10,
        backgroundColor: '#F9FAFB',
        color: '#1F2937',
    },
    textInputArea: {
        height: 100,
        borderColor: '#D1D5DB',
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 15,
        marginBottom: 10,
        backgroundColor: '#F9FAFB',
        color: '#1F2937',
        textAlignVertical: 'top',
    },
    button: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 30,
        width: '100%',
        alignSelf: 'center',
    },
    createButton: {
        backgroundColor: '#4F46E5',
        alignItems: 'center',
        marginTop: 15,
    },
    buttonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
        textAlign: 'center',
    },
    noDataText: {
        textAlign: 'center',
        color: '#6B7280',
        fontStyle: 'italic',
        padding: 20,
    },
    datePickerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    datePickerInput: {
        height: 50,
        borderColor: '#D1D5DB',
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 15,
        backgroundColor: '#F9FAFB',
        justifyContent: 'center',
        marginHorizontal: 5,
        flex: 0.45,
    },
    datePickerText: {
        color: '#1F2937',
    },
    clearButton: {
        height: 50,
        width: 50,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 25,
        backgroundColor: '#EF4444',
        marginLeft: 5,
    },
    clearButtonText: {
        color: '#fff',
        fontSize: 20,
        fontWeight: 'bold',
    },
    // 🔥 Missing Styles Added Back
    itemHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    itemTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1F2937',
    },
    resolvedCard: {
        backgroundColor: '#D1FAE5',
        borderColor: '#10B981',
        borderWidth: 1,
    },
    complaintSection: {
        marginTop: 20,
    },
    orderIdText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1F2937',
    },
    statusBadge: {
        fontSize: 10,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
        color: '#fff',
        fontWeight: 'bold',
    },
    statusDelivered: {
        backgroundColor: '#10B981',
    },
    statusInTransit: {
        backgroundColor: '#F59E0B',
    },
    statusPending: {
        backgroundColor: '#EF4444',
    },
    itemDetails: {
        fontSize: 14,
        color: '#4B5563',
        lineHeight: 22,
    },
    emptyBottleCountText: {
        fontSize: 48,
        fontWeight: 'bold',
        color: '#4F46E5',
        textAlign: 'center',
        paddingVertical: 2
    },
    logoutButtonSidebar: {
        paddingVertical: 15,
        backgroundColor: '#EF4444',
        alignItems: 'center',
        marginHorizontal: 20,
        borderRadius: 12,
        marginBottom: 25,
        elevation: 5,
        shadowColor: '#EF4444',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 5,
    },
    logoutButtonTextSidebar: {
        color: '#fff',
        fontWeight: '900',
        fontSize: 16,
        letterSpacing: 0.5,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
        padding: 8,
    },
    backButtonText: {
        color: '#4F46E5',
        fontSize: 16,
        fontWeight: 'bold',
        marginLeft: 5,
    },
    confirmModal: {
        backgroundColor: '#fff',
        marginHorizontal: 20,
        marginTop: '30%',
        borderRadius: 20,
        padding: 20,
        elevation: 10,
    },
    storeHeaderCard: {
        backgroundColor: '#FFFFFF',
        padding: 20,
        borderRadius: 15,
        marginHorizontal: 10,
        marginBottom: 20,
        elevation: 4,
        borderLeftWidth: 6,
        borderLeftColor: '#4F46E5',
    },
    storeNameText: {
        fontSize: 20,
        fontWeight: '800',
        color: '#1A2A44',
        marginBottom: 5,
    },
    storeIdBadge: {
        backgroundColor: '#E6F4F1',
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
    },
    storeIdText: {
        fontSize: 13,
        color: '#00A896',
        fontWeight: 'bold',
    },
    orderListItem: {
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    formLabel: { 
        fontWeight: '600', 
        marginBottom: 8, 
        color: '#4B5563',
        fontSize: 14
    },
    welcomeText: { 
        fontSize: 22, 
        fontWeight: 'bold', 
        color: '#1A2A44', 
        marginBottom: 20,
        textAlign: 'left',
        paddingHorizontal: 10
    },
    errorText: {
        fontSize: 16,
        color: 'red',
        textAlign: 'center',
        marginTop: 20,
        fontWeight: 'bold',
    },
    exportButton: {
        backgroundColor: '#10B981',
        marginTop: 10,
        marginBottom: 20,
        borderRadius: 30,
        paddingVertical: 12,
    },
});





export default PartnerDashboard;