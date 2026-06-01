import { TextEncoder, TextDecoder } from 'text-encoding';

if (typeof global.TextEncoder === 'undefined') {
    global.TextEncoder = TextEncoder as any;
}
if (typeof global.TextDecoder === 'undefined') {
    global.TextDecoder = TextDecoder as any;
}
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
    Animated,
    Easing,
    Platform,
    Clipboard,
    Linking,
    FlatList,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import CheckBox from '@react-native-community/checkbox';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import axios from 'axios';
import RNFS from 'react-native-blob-util';
import { API_BASE_URL } from '../src/config';

// Assuming these utility files exist and are correct
import { pickPDF } from './utils/filePicker';
import { exportToExcel } from './utils/excelExport';

// --- Configuration ---

const BOTTLE_PRICE = 100;

// --- Interfaces ---
type RootStackParamList = {
    SuperAdminDashboard: undefined;
    Login: undefined;
};

interface Store {
    id: number;
    store_name: string;
    address: string | null;
    city: string;
    state: string;
    zip_code: string | null;
    created_at: string | null;
}

interface Partner {
    id: number;
    full_name: string;
    email: string;
    stores: Store[];
}

interface DeliveryPartner {
    id: number;
    full_name: string;
    email: string;
    status: 'pending' | 'approved' | 'active';
}

interface ComplaintOut {
    id: number;
    subject: string;
    description: string;
    status: 'pending' | 'resolved' | 'in_progress';
    solution: string | null;
    created_at: string;
    updated_at: string | null;
    created_by: {
        full_name: string;
        role: 'partner' | 'delivery' | 'superadmin';
        email: string;
        mobile_number: string;
        stores: { id: number; store_name: string }[];
    };
    assigned_to: {
        full_name: string;
        role: string;
        email: string;
        mobile_number: string;
    };
}

interface Complaint {
    id: string;
    subject: string;
    description: string;
    customerName: string;
    role: string;
    date: Date;
    status: 'New' | 'In Progress' | 'Resolved';
}

interface Order {
    id: string;
    bottles: number;
    status: 'Pending' | 'In Transit' | 'Delivered' | 'Cancelled' | 'Accepted';
    orderDate: Date;
    customerName: string;
    isPartnerOrder: boolean;
    partner_id?: number;
    partnerName?: string;
    deliveryPartnerId?: string;
    deliveryPartnerName?: string;
}

interface ReportOut {
    id: number;
    report_date: string;
    file_path: string;
}

interface GeneratedQR {
    message: string;
    qr_code: string;
    uuid: string;
}

interface BottleToAssign {
    UUID: string;
    qr_code: string;
}

// --- Reusable Components ---
const Card = ({
    label,
    value,
    icon,
    isBlinking = false,
    onPress, // NEW PROP
}: {
    label: string;
    value: string;
    icon: string;
    isBlinking?: boolean;
    onPress?: () => void; // Define the new prop type
}) => {
    const blinkAnim = useState(new Animated.Value(0))[0];

    useEffect(() => {
        if (isBlinking) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(blinkAnim, {
                        toValue: 1,
                        duration: 1000,
                        easing: Easing.linear,
                        useNativeDriver: true,
                    }),
                    Animated.timing(blinkAnim, {
                        toValue: 0,
                        duration: 1000,
                        easing: Easing.linear,
                        useNativeDriver: true,
                    }),
                ]),
            ).start();
        }
    }, [isBlinking, blinkAnim]);

    const opacity = blinkAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.7, 1],
    });

    const cardStyle = isBlinking ? { ...styles.card, opacity, transform: [{ scale: opacity }] } : styles.card;

    const CardContent = (
        <Animated.View style={cardStyle}>
            <Text style={styles.cardIcon}>{icon}</Text>
            <Text style={styles.cardValue}>{value}</Text>
            <Text style={styles.cardLabel}>{label}</Text>
        </Animated.View>
    );

    return onPress ? (
        <TouchableOpacity onPress={onPress} style={{ width: '48%' }}>
            {CardContent}
        </TouchableOpacity>
    ) : (
        <View style={{ width: '48%' }}>
            {CardContent}
        </View>
    );
};

const backendToUiStatus = (s: ComplaintOut['status']): Complaint['status'] => {
    if (s === 'pending') return 'New';
    if (s === 'in_progress') return 'In Progress';
    return 'Resolved';
};

const mapComplaint = (c: ComplaintOut): Complaint => {
    const storeNames = c.created_by?.stores?.map(s => s.store_name).join(', ') || 'N/A';
    return {
        id: String(c.id),
        subject: c.subject,
        description: c.description,
        customerName: c.created_by?.full_name || '—',
        role: `Partner at ${storeNames}` || '—',
        date: new Date(c.created_at),
        status: backendToUiStatus(c.status),
    };
};

const OrderCard = ({
    order,
    onApprove,
    onAssign,
    approvedDeliveryPartners,
}: {
    order: Order;
    onApprove: (id: string) => void;
    onAssign: (orderId: string, deliveryPartnerId: string) => void;
    approvedDeliveryPartners: DeliveryPartner[];
}) => {
    const [isAssigning, setIsAssigning] = useState(false);
    const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);

    const orderStatus = order.status.toLowerCase();

    const isApprovedAndUnassigned = orderStatus === 'accepted' && !order.deliveryPartnerId;

    const handleAssignPress = () => {
        if (order.deliveryPartnerId) {
            Alert.alert('Info', 'This order is already assigned.');
            return;
        }
        setIsAssigning(true);
    };

    const handleAssign = () => {
        if (selectedPartnerId) {
            onAssign(order.id, selectedPartnerId);
            setIsAssigning(false);
            setSelectedPartnerId(null);
        } else {
            Alert.alert('Error', 'Please select a delivery partner.');
        }
    };

    return (
        <View key={order.id} style={styles.orderCardItem}>
            <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>Order ID: {order.id}</Text>
                <Text
                    style={[
                        styles.statusBadge,
                        orderStatus === 'delivered'
                            ? styles.statusDelivered
                            : orderStatus === 'in transit' || orderStatus === 'accepted'
                                ? styles.statusInTransit
                                : styles.statusPending,
                    ]}>
                    {order.status}
                </Text>
            </View>
            <Text style={styles.itemDetails}>Customer: {order.customerName}</Text>
            {order.partner_id && <Text style={styles.itemDetails}>Partner: {order.partnerName}</Text>}
            <Text style={styles.itemDetails}>Bottles: {order.bottles}</Text>
            {order.deliveryPartnerName && (
                <Text style={styles.itemDetails}>Assigned to: {order.deliveryPartnerName}</Text>
            )}

            {orderStatus === 'pending' && (
                <View style={styles.actionButtons}>
                    <TouchableOpacity
                        onPress={() => onApprove(order.id)}
                        style={[styles.button, styles.approveButton]}>
                        <Text style={styles.buttonText}>Approve</Text>
                    </TouchableOpacity>
                </View>
            )}

            {isApprovedAndUnassigned && (
                <View style={styles.actionButtons}>
                    <TouchableOpacity
                        onPress={handleAssignPress}
                        style={[styles.button, styles.assignButton]}>
                        <Text style={styles.buttonText}>Assign Delivery Partner</Text>
                    </TouchableOpacity>
                </View>
            )}

            <Modal visible={isAssigning} animationType="slide" transparent={true} onRequestClose={() => setIsAssigning(false)}>
                <View style={styles.centeredView}>
                    <View style={styles.modalView}>
                        <Text style={styles.modalTitle}>Assign Delivery Partner</Text>
                        <ScrollView style={styles.dropdownScrollView}>
                            {approvedDeliveryPartners.length > 0 ? (
                                approvedDeliveryPartners.map(dp => (
                                    <TouchableOpacity
                                        key={dp.id}
                                        style={[
                                            styles.dropdownItem,
                                            selectedPartnerId === String(dp.id) && styles.dropdownItemActive,
                                        ]}
                                        onPress={() => setSelectedPartnerId(String(dp.id))}>
                                        <Text
                                            style={[
                                                styles.dropdownItemText,
                                                selectedPartnerId === String(dp.id) && styles.dropdownItemTextActive,
                                            ]}>
                                            {dp.full_name}
                                        </Text>
                                    </TouchableOpacity>
                                ))
                            ) : (
                                <Text style={styles.noDataText}>No active delivery partners found.</Text>
                            )}
                        </ScrollView>
                        <View style={styles.modalActionButtons}>
                            <TouchableOpacity
                                style={[styles.button, styles.modalAssignButton]}
                                onPress={handleAssign}>
                                <Text style={styles.buttonText}>Assign</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.button, styles.modalCancelButton]}
                                onPress={() => setIsAssigning(false)}>
                                <Text style={styles.buttonText}>Cancel</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
};

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
        key={name}
        style={[styles.sidebarItem, active && styles.sidebarItemActive]}
        onPress={() => onSelect(name)}>
        <Text style={styles.sidebarIcon}>{icon}</Text>
        <Text style={[styles.sidebarText, active && styles.sidebarTextActive]}>{label}</Text>
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
    <View style={styles.sidebarContent}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarHeaderTitle}>Admin Menu</Text>
        </View>
        <ScrollView>
            <SidebarItem label="Dashboard" icon="📊" name="dashboard" active={currentTab === 'dashboard'} onSelect={onSelectTab} />
            <SidebarItem label="Orders" icon="📋" name="orders" active={currentTab === 'orders'} onSelect={onSelectTab} />
            <SidebarItem label="Create Partner" icon="🤝" name="createPartner" active={currentTab === 'createPartner'} onSelect={onSelectTab} />
            <SidebarItem label="My Partners" icon="👥" name="myPartners" active={currentTab === 'myPartners'} onSelect={onSelectTab} />
            <SidebarItem label="Delivery" icon="🚚" name="deliveryPartners" active={currentTab === 'deliveryPartners'} onSelect={onSelectTab} />
            <SidebarItem label="Complaints" icon="⚠️" name="complaints" active={currentTab === 'complaints'} onSelect={onSelectTab} />
            <SidebarItem label="Reports" icon="📝" name="reports" active={currentTab === 'reports'} onSelect={onSelectTab} />
            <SidebarItem label="QR" icon="📱" name="qrManagement" active={currentTab === 'qrManagement'} onSelect={onSelectTab} />
        </ScrollView>
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>
    </View>
);

// --- Main Component ---
const SuperAdminDashboard = () => {
    const [currentTab, setCurrentTab] = useState('dashboard');
    const [loading, setLoading] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [sidebarAnim] = useState(new Animated.Value(0));
    const navigation = useNavigation<NavigationProp<RootStackParamList>>();

    // --- Dashboard Data States ---
    const [totalOrders, setTotalOrders] = useState(0);
    const [customerOrdersCount, setCustomerOrdersCount] = useState(0);
    const [partnerOrdersCount, setPartnerOrdersCount] = useState(0);
    const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
    const [totalActiveStores, setTotalActiveStores] = useState(0);
    const [totalVendors, setTotalVendors] = useState(0);
    const [totalDeliveryPartners, setTotalDeliveryPartners] = useState(0);
    const [dailyOrders, setDailyOrders] = useState(0);
    const [pendingDeliveryPartnersCount, setPendingDeliveryPartnersCount] = useState(0);
    const [newComplaints, setNewComplaints] = useState(0);
    const [totalRevenue, setTotalRevenue] = useState(0);
    const [monthlyRevenue, setMonthlyRevenue] = useState(0);
    const [monthlyOrdersCount, setMonthlyOrdersCount] = useState(0);
    const [generatedQrData, setGeneratedQrData] = useState<GeneratedQR | null>(null);
    const [qrAssigning, setQrAssigning] = useState(false);
    const [selectedBottlesToAssign, setSelectedBottlesToAssign] = useState<string[]>([]);

    // New state for unassigned bottles
    const [unassignedBottles, setUnassignedBottles] = useState<BottleToAssign[]>([]);

    // --- Core Data States ---
    const [partners, setPartners] = useState<Partner[]>([]);
    const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
    const [allOrders, setAllOrders] = useState<Order[]>([]);
    const [allDeliveryPartners, setAllDeliveryPartners] = useState<DeliveryPartner[]>([]);
    const [approvedDeliveryPartners, setApprovedDeliveryPartners] = useState<DeliveryPartner[]>([]);
    const [complaints, setComplaints] = useState<Complaint[]>([]);
    const [loadingComplaints, setLoadingComplaints] = useState(false);
    const [isSolutionModalVisible, setIsSolutionModalVisible] = useState(false);
    const [currentComplaintId, setCurrentComplaintId] = useState<string | null>(null);
    const [solutionText, setSolutionText] = useState('');
    
    // --- Report Management States ---
    const [reports, setReports] = useState<ReportOut[]>([]);
    const [reportsLoading, setReportsLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<{ uri: string; name: string; type: string; } | null>(null);
    const [newReportDate, setNewReportDate] = useState<Date>(new Date());
    const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
    
    // New states for date filtering
    const [isStartDatePickerVisible, setStartDatePickerVisibility] = useState(false);
    const [isEndDatePickerVisible, setEndDatePickerVisibility] = useState(false);
    const [startDate, setStartDate] = useState<Date | null>(null);
    const [endDate, setEndDate] = useState<Date | null>(null);
    const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);

    // --- New Partner Creation Form States ---
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [mobileNumber, setMobileNumber] = useState('');
    const [stores, setStores] = useState<Store[]>([]);
    const [selectedStoreIds, setSelectedStoreIds] = useState<number[]>([]);
    const [loadingStores, setLoadingStores] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const [accessToken, setAccessToken] = useState<string | null>(null);

    // --- API Fetching Functions ---
    const fetchAllData = async () => {
        setLoading(true);
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                Alert.alert('Authentication Required', 'Please log in to access the dashboard.');
                navigation.navigate('Login');
                return;
            }
            setAccessToken(token);

            const authHeaders = { headers: { 'Authorization': `Bearer ${token}` } };

            const [
                allOrdersResponse,
                pendingOrdersResponse,
                storesResponse,
                partnersResponse,
                allDeliveryPartnersResponse,
                unassignedBottlesResponse,
            ] = await Promise.all([
                fetch(`${API_BASE_URL}/superadmin/orders/all`, authHeaders),
                fetch(`${API_BASE_URL}/superadmin/orders/pending`, authHeaders),
                fetch(`${API_BASE_URL}/store/list`, authHeaders),
                fetch(`${API_BASE_URL}/partners/partners/list`, authHeaders),
                fetch(`${API_BASE_URL}/partners/partners/superadmin/delivery-partners`, authHeaders),
                fetch(`${API_BASE_URL}/bottle/superadmin/unassigned-bottles`, authHeaders),
            ]);

            const handleAuthError = (response: Response): boolean => {
                if (response.status === 401) {
                    Alert.alert('Authentication Error', 'Your session has expired. Please log in again.');
                    navigation.navigate('Login');
                    return true;
                }
                return false;
            };

            if (
                handleAuthError(allOrdersResponse) ||
                handleAuthError(pendingOrdersResponse) ||
                handleAuthError(storesResponse) ||
                handleAuthError(partnersResponse) ||
                handleAuthError(allDeliveryPartnersResponse) ||
                handleAuthError(unassignedBottlesResponse)
            ) {
                setLoading(false);
                return;
            }

            const mapOrderData = (apiData: any[]): Order[] => {
                if (!apiData) return [];
                return apiData.map(item => ({
                    id: String(item.id),
                    bottles: parseInt(item.order_details, 10),
                    status: item.status as Order['status'],
                    orderDate: new Date(item.created_at),
                    isPartnerOrder: !!item.partner_id,
                    partner_id: item.partner_id,
                    partnerName: item.partner ? item.partner.full_name : 'N/A',
                    customerName: item.store ? item.store.store_name : 'Customer',
                    deliveryPartnerId: item.delivery_person_id,
                    deliveryPartnerName: item.delivery_person ? item.delivery_person.full_name : 'N/A',
                }));
            };

            if (allOrdersResponse.ok) {
                const allOrdersData: any[] = await allOrdersResponse.json();
                const mappedOrders = mapOrderData(allOrdersData);
                setAllOrders(mappedOrders);
                setTotalOrders(mappedOrders.length);
                setPartnerOrdersCount(mappedOrders.filter(order => order.isPartnerOrder).length);
                setCustomerOrdersCount(mappedOrders.filter(order => !order.isPartnerOrder).length);

                const today = new Date();
                const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

                const todayOrders = mappedOrders.filter(order => order.orderDate.getTime() >= startOfToday);
                setDailyOrders(todayOrders.length);

                const currentMonth = today.getMonth();
                const currentYear = today.getFullYear();

                const monthlyOrders = mappedOrders.filter(order => {
                    const orderDate = new Date(order.orderDate);
                    return orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear;
                });
                setMonthlyOrdersCount(monthlyOrders.length);

                const deliveredOrders = mappedOrders.filter(order => order.status.toLowerCase() === 'delivered');
                const monthlyDeliveredOrders = monthlyOrders.filter(order => order.status.toLowerCase() === 'delivered');

                const totalRevenue = deliveredOrders.reduce((sum, order) => sum + (order.bottles * BOTTLE_PRICE), 0);
                const monthlyRevenue = monthlyDeliveredOrders.reduce((sum, order) => sum + (order.bottles * BOTTLE_PRICE), 0);

                setTotalRevenue(totalRevenue);
                setMonthlyRevenue(monthlyRevenue);
            } else {
                console.error('Failed to fetch all orders:', await allOrdersResponse.text());
                setAllOrders([]);
            }

            if (pendingOrdersResponse.ok) {
                const pendingOrdersData: any[] = await pendingOrdersResponse.json();
                const mappedPendingOrders = mapOrderData(pendingOrdersData);
                setPendingOrders(mappedPendingOrders);
                setPendingOrdersCount(mappedPendingOrders.length);
            } else {
                console.error('Failed to fetch pending orders:', await pendingOrdersResponse.text());
                setPendingOrders([]);
            }

            if (storesResponse.ok) {
                const storesData: Store[] = await storesResponse.json();
                setStores(storesData || []);
                setTotalActiveStores(storesData.length);
            } else {
                console.error('Failed to fetch stores:', await storesResponse.text());
                setStores([]);
            }

            if (partnersResponse.ok) {
                const partnersData: Partner[] = await partnersResponse.json();
                setPartners(partnersData || []);
                setTotalVendors(partnersData.length);
            } else {
                console.error('Failed to fetch partners:', await partnersResponse.text());
                setPartners([]);
            }
            
            if (allDeliveryPartnersResponse.ok) {
                const allDeliveryPartnersData: DeliveryPartner[] = await allDeliveryPartnersResponse.json();
                setAllDeliveryPartners(allDeliveryPartnersData || []);
                setPendingDeliveryPartnersCount(allDeliveryPartnersData.filter(dp => dp.status === 'pending').length);
                setTotalDeliveryPartners(allDeliveryPartnersData.length);
                setApprovedDeliveryPartners(allDeliveryPartnersData.filter(dp => dp.status === 'active' || dp.status === 'approved'));
            } else {
                console.error('Failed to fetch all delivery partners:', await allDeliveryPartnersResponse.text());
                setAllDeliveryPartners([]);
                setApprovedDeliveryPartners([]);
            }
            
            if (unassignedBottlesResponse.ok) {
                const unassignedBottlesData = await unassignedBottlesResponse.json();
                const mappedBottles = unassignedBottlesData.map((bottle: any) => ({
                    UUID: bottle.uuid,
                    qr_code: bottle.qr_code,
                }));
                setUnassignedBottles(mappedBottles);
            } else {
                console.error('Failed to fetch unassigned bottles:', await unassignedBottlesResponse.text());
                setUnassignedBottles([]);
            }
        } catch (error) {
            console.error('Failed to fetch initial data:', error);
            Alert.alert('Error', 'Failed to load dashboard data. Please check your network connection.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAllData();
    }, [navigation]);

    useEffect(() => {
        if (startDate && endDate) {
            const filtered = allOrders.filter(order => {
                const orderDate = new Date(order.orderDate);
                return orderDate >= startDate && orderDate <= endDate;
            });
            setFilteredOrders(filtered);
        } else {
            setFilteredOrders(allOrders);
        }
    }, [startDate, endDate, allOrders]);

    const openSidebar = () => {
        setIsSidebarOpen(true);
        Animated.timing(sidebarAnim, {
            toValue: 1,
            duration: 250,
            easing: Easing.ease,
            useNativeDriver: true,
        }).start();
    };

    const closeSidebar = () => {
        Animated.timing(sidebarAnim, {
            toValue: 0,
            duration: 250,
            easing: Easing.ease,
            useNativeDriver: true,
        }).start(() => setIsSidebarOpen(false));
    };

    const handleLogout = async () => {
        await AsyncStorage.removeItem('userToken');
        Alert.alert('Logged Out', 'You have been successfully logged out.');
        navigation.navigate('Login');
    };

    const showDatePicker = () => {
        setDatePickerVisibility(true);
    };
    const hideDatePicker = () => {
        setDatePickerVisibility(false);
    };
    const handleConfirmDate = (date: Date) => {
        setNewReportDate(date);
        hideDatePicker();
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

    const handleSelectTab = (tab: string) => {
        setCurrentTab(tab);
        closeSidebar();
        if (tab === 'complaints') {
            fetchAssignedComplaints();
        } else if (tab === 'reports') {
            fetchReports();
        }
    };
    
    const handleApproveOrder = async (orderId: string) => {
        if (!accessToken) {
            Alert.alert('Error', 'Authentication token not found.');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/superadmin/orders/${orderId}/approve`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (!response.ok) {
                const errorData: { detail?: string } = await response.json().catch(() => ({ detail: 'Failed to approve order.' }));
                throw new Error(errorData.detail || 'Failed to approve order.');
            }

            Alert.alert('Success', `Order ${orderId} has been approved. You can now assign a delivery partner.`);

            setPendingOrders(prevOrders => prevOrders.filter(o => o.id !== orderId));
            const approvedOrder = allOrders.find(o => o.id === orderId);
            if (approvedOrder) {
                const updatedOrder = { ...approvedOrder, status: 'Accepted' as Order['status'] };
                setAllOrders(prevOrders => prevOrders.map(o => o.id === orderId ? updatedOrder : o));
            }
        } catch (error: any) {
            console.error('Failed to approve order:', error);
            Alert.alert('Error', error.message || 'Failed to approve order.');
        } finally {
            setLoading(false);
        }
    };

    const handleAssignDeliveryPartner = async (orderId: string, deliveryPartnerId: string) => {
        if (!accessToken) {
            Alert.alert('Error', 'Authentication token not found.');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(
                `${API_BASE_URL}/partners/partners/superadmin/orders/${orderId}/assign/${deliveryPartnerId}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                    },
                }
            );

            if (!response.ok) {
                const errorData: { detail?: string } = await response.json().catch(() => ({
                    detail: 'Failed to assign delivery partner.',
                }));
                throw new Error(errorData.detail || 'Failed to assign delivery partner.');
            }

            const result = await response.json();

            const assignedPartner = approvedDeliveryPartners.find(dp => String(dp.id) === deliveryPartnerId);
            const assignedPartnerName = assignedPartner ? assignedPartner.full_name : 'Unknown';

            setAllOrders(prevOrders =>
                prevOrders.map(order =>
                    order.id === orderId
                        ? {
                            ...order,
                            deliveryPartnerId,
                            deliveryPartnerName: assignedPartnerName,
                        }
                        : order
                )
            );

            Alert.alert(
                'Success',
                `Order ${result.order_id} has been assigned to partner ${assignedPartnerName}.`
            );
        } catch (error: any) {
            console.error('Failed to assign delivery partner:', error);
            Alert.alert('Error', error.message || 'Failed to assign delivery partner.');
        } finally {
            setLoading(false);
        }
    };

    const handleCreatePartner = async () => {
        if (!accessToken) {
            Alert.alert('Error', 'Authentication token not found.');
            return;
        }
        if (fullName.trim() === '' || email.trim() === '' || password.trim() === '' || mobileNumber.trim() === '' || selectedStoreIds.length === 0) {
            Alert.alert('Error', 'Please fill in all details and select at least one store.');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/partners/partners/superadmin/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    full_name: fullName,
                    email: email,
                    password: password,
                    mobile_number: mobileNumber,
                    stores: selectedStoreIds,
                }),
            });

            if (response.ok) {
                try {
                    const result = await response.json();
                    if (result && result.message) {
                        Alert.alert('Success', `New partner has been created successfully.`);
                        setFullName('');
                        setEmail('');
                        setPassword('');
                        setMobileNumber('');
                        setSelectedStoreIds([]);
                        await fetchAllData();
                    } else {
                        console.error('API response format error:', result);
                        Alert.alert('Success (but format issue)', 'Partner created, but the app could not read the full details. Please refresh.');
                    }
                } catch (jsonError) {
                    console.error('Failed to parse JSON response:', jsonError);
                    Alert.alert('Success (but parse issue)', 'Partner created successfully, but the server response was unreadable. Please refresh.');
                }
            } else {
                let errorMessage = 'Failed to create partner. Please check your details.';
                try {
                    const errorData = await response.json();
                    if (typeof errorData.detail === 'string') {
                        errorMessage = errorData.detail;
                    } else if (typeof errorData.detail === 'object') {
                        errorMessage = JSON.stringify(errorData.detail, null, 2);
                    } else if (errorData.message) {
                        errorMessage = errorData.message;
                    } else if (errorData.error) {
                        errorMessage = errorData.error;
                    } else {
                        errorMessage = `An unknown error occurred with status code: ${response.status}.`;
                    }
                } catch (jsonError) {
                    errorMessage = `Error: ${response.status} ${response.statusText}`;
                }
                Alert.alert('Error', errorMessage);
            }
        } catch (error) {
            console.error('API call failed:', error);
            Alert.alert('Error', 'Failed to connect to the server. Please try again later.');
        } finally {
            setLoading(false);
        }
    };

    const handleApproveDeliveryPartner = async (dpId: number) => {
        if (!accessToken) {
            Alert.alert('Error', 'Authentication token not found.');
            return;
        }
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/partners/partners/superadmin/delivery-partners/${dpId}/approve`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (!response.ok) {
                const errorData: { detail?: string } = await response.json().catch(() => ({ detail: 'Failed to approve delivery partner.' }));
                throw new Error(errorData.detail || 'Failed to approve delivery partner.');
            }

            setAllDeliveryPartners(prevDps =>
                prevDps.map(dp =>
                    dp.id === dpId ? { ...dp, status: 'active' } : dp
                )
            );
            Alert.alert('Success', 'Delivery partner has been approved.');
        } catch (error: any) {
            console.error('Failed to approve delivery partner:', error);
            Alert.alert('Error', error.message || 'Failed to approve delivery partner.');
        } finally {
            setLoading(false);
        }
    };

    const handleResolveComplaint = async () => {
        try {
            if (!currentComplaintId || !accessToken) {
                Alert.alert('Error', 'Authentication token or complaint ID missing.');
                return;
            }

            await axios.patch(
                `${API_BASE_URL}/complaints/complaints/${currentComplaintId}/resolve`,
                {
                    "solution": solutionText,
                    "status": "resolved"
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            setComplaints((prev) =>
                prev.map((c) => (c.id === currentComplaintId ? { ...c, status: 'Resolved' } : c))
            );
            setNewComplaints((prev) => Math.max(prev - 1, 0));
            Alert.alert('Success', 'Complaint marked as resolved.');

        } catch (err: any) {
            console.error('Resolve failed:', err?.response?.data || err?.message);
            Alert.alert('Error', 'Failed to mark as resolved.');
        } finally {
            setIsSolutionModalVisible(false);
            setSolutionText('');
            setCurrentComplaintId(null);
        }
    };
    
    const openSolutionInput = (complaintId: string) => {
        setCurrentComplaintId(complaintId);
        setIsSolutionModalVisible(true);
    };


    const fetchAssignedComplaints = async () => {
        setLoadingComplaints(true);
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                Alert.alert('Error', 'Authentication token not found.');
                return;
            }

            const res = await axios.get(`${API_BASE_URL}/complaints/complaints/assigned`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            const items: ComplaintOut[] = res.data || [];
            setComplaints(items.map(mapComplaint));
            setNewComplaints(items.filter((c) => c.status === 'pending').length);
        } catch (err: any) {
            console.error('Failed to fetch complaints:', err?.response?.data || err?.message);
            setComplaints([]);
            setNewComplaints(0);
        } finally {
            setLoadingComplaints(false);
        }
    };

    const fetchReports = async () => {
        setReportsLoading(true);
        try {
            if (!accessToken) {
                Alert.alert('Error', 'Authentication token not found.');
                return;
            }

            const response = await axios.get(`${API_BASE_URL}/reports/reports/list`, {
                headers: { Authorization: `Bearer ${accessToken}` },
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

    const handleFilePick = async () => {
      try {
        const file = await pickPDF();
        if (file) {
          setSelectedFile(file);
          Alert.alert('Success', `File selected: ${file.name}`);
        }
      } catch (error) {
        console.error('File pick error in component:', error);
      }
    };

    const handleUploadReport = async () => {
        if (!selectedFile) {
            Alert.alert('Error', 'Please select a PDF file first.');
            return;
        }

        setLoading(true);
        const formattedDate = newReportDate.toISOString().split('T')[0];

        try {
            const response = await RNFS.fetch('POST', `${API_BASE_URL}/reports/reports/upload`, {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'multipart/form-data',
            }, [
                {
                    name: 'report_date',
                    data: formattedDate,
                },
                {
                    name: 'report_file',
                    filename: selectedFile.name,
                    type: selectedFile.type,
                    data: RNFS.wrap(selectedFile.uri),
                },
            ]);

            if (response.respInfo.status === 201) {
                Alert.alert('Success', 'Report uploaded successfully!');
                setSelectedFile(null);
                fetchReports();
            } else {
                Alert.alert('Error', `Failed to upload report. Status: ${response.respInfo.status}`);
            }
        } catch (error: any) {
            console.error('Report upload failed:', error);
            Alert.alert('Error', `Failed to upload report. ${error.message}`);
        } finally {
            setLoading(false);
        }
    };
    
    const handleGenerateQR = async () => {
        if (!accessToken) {
            Alert.alert('Error', 'Authentication token not found.');
            return;
        }
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/bottle/superadmin/generate-qr`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Failed to generate QR code.');
            }

            const result: GeneratedQR = await response.json();
            setGeneratedQrData(result);
            Alert.alert('Success', 'A new QR code has been generated and stored.');

        } catch (error: any) {
            console.error('Failed to generate QR:', error);
            Alert.alert('Error', error.message || 'Failed to generate QR code.');
        } finally {
            setLoading(false);
        }
    };

    const handleAssignBottlesToPartner = async (deliveryPartnerId: string) => {
        if (!accessToken) {
            Alert.alert('Error', 'Authentication token not found.');
            return;
        }
        if (selectedBottlesToAssign.length === 0) {
            Alert.alert('Error', 'Please select at least one bottle to assign.');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/bottle/superadmin/assign`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    qr_codes: selectedBottlesToAssign,
                    delivery_boy_id: parseInt(deliveryPartnerId, 10),
                }),
            });

            if (!response.ok) {
                let errorMessage = `Server error: ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    if (errorData.detail && Array.isArray(errorData.detail) && errorData.detail.length > 0) {
                        errorMessage = errorData.detail.map((err: any) => err.msg).join('; ');
                    } else if (typeof errorData.detail === 'string') {
                        errorMessage = errorData.detail;
                    } else {
                        errorMessage = `Server error: ${response.status} ${response.statusText}`;
                    }
                } catch (jsonError) {
                    console.error('Failed to parse error response:', jsonError);
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();
            Alert.alert('Success', result.message);

            setSelectedBottlesToAssign([]);
            setQrAssigning(false);
            fetchAllData();

        } catch (error: any) {
            console.error('Failed to assign bottles:', error);
            const displayMessage = error.message || 'An unexpected error occurred.';
            Alert.alert('Error', displayMessage);
        } finally {
            setLoading(false);
        }
    };
    
    const handleExportAllOrders = async () => {
    setLoading(true);
    try {
        const token = await AsyncStorage.getItem('userToken');
        if (!token) {
            Alert.alert('Authentication failed', 'Please log in again.');
            navigation.navigate('Login');
            return;
        }

        const response = await axios.get(`${API_BASE_URL}/partners/partners/superadmin/orders/export-all`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });

        if (response.data.length === 0) {
            Alert.alert('No Data', 'There are no orders to export.');
            return;
        }

        const ordersForExport = response.data.map((order: any) => ({
            'Order ID': order.id,
            'Order Date': new Date(order.created_at).toLocaleDateString(),
            'Bottles': order.order_details,
            'Status': order.status,
            'Store Name': order.store?.store_name || 'N/A',
            'Partner Name': order.partner?.full_name || 'N/A',
            'Delivery Partner': order.delivery_person?.full_name || 'N/A',
        }));
        
        const fileName = `All_Orders_${new Date().toISOString().slice(0, 10)}`;
        
        await exportToExcel(ordersForExport, fileName);

        Alert.alert('Success', `Orders exported successfully! You can find the file at: Internal Storage/Documents/${fileName}.xlsx`);
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
    const renderStoresList = () => (
        <View style={styles.contentWrapper}>
            <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back to Dashboard</Text>
            </TouchableOpacity>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.cardContainer}>
                    <Text style={styles.sectionTitle}>Active Stores ({totalActiveStores})</Text>
                    {stores.length > 0 ? (
                        stores.map((store: Store) => (
                            <View key={store.id} style={styles.listItem}>
                                <View>
                                    <Text style={styles.itemTitle}>{store.store_name}</Text>
                                    <Text style={styles.itemDetails}>City: {store.city}</Text>
                                    <Text style={styles.itemDetails}>Address: {store.address || 'N/A'}</Text>
                                </View>
                            </View>
                        ))
                    ) : (
                        <Text style={styles.noDataText}>No active stores found.</Text>
                    )}
                </View>
            </ScrollView>
        </View>
    );

    const renderDashboard = () => (
        <View style={styles.contentWrapper}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.cardContainer}>
                    <Text style={styles.sectionTitle}>Dashboard Overview</Text>
                    <View style={styles.kpiRow}>
                        <Card label="Total Orders" value={totalOrders.toString()} icon="📦" onPress={() => setCurrentTab('orders')} />
                        <Card label="Customer Orders" value={customerOrdersCount.toString()} icon="🛍️" onPress={() => setCurrentTab('orders')} />
                    </View>
                    <View style={styles.kpiRow}>
                        <Card label="Partner Orders" value={partnerOrdersCount.toString()} icon="🏪" onPress={() => setCurrentTab('orders')} />
                        <Card label="Pending Orders" value={pendingOrders.length.toString()} icon="⏰" isBlinking={pendingOrders.length > 0} onPress={() => setCurrentTab('orders')} />
                    </View>
                    <View style={styles.kpiRow}>
                        <Card label="Today's Orders" value={dailyOrders.toString()} icon="🗓️" onPress={() => setCurrentTab('orders')} />
                        <Card label="Monthly Orders" value={monthlyOrdersCount.toString()} icon="📈" onPress={() => setCurrentTab('orders')} />
                    </View>
                    <View style={styles.kpiRow}>
                        <Card label="Total Revenue" value={`₹${totalRevenue.toLocaleString('en-IN')}`} icon="💰" />
                        <Card label="Monthly Revenue" value={`₹${monthlyRevenue.toLocaleString('en-IN')}`} icon="📊" />
                    </View>
                    <View style={styles.kpiRow}>
                        <Card label="Total Vendors" value={totalVendors.toString()} icon="🤝" onPress={() => setCurrentTab('myPartners')} />
                        <Card label="New Complaints" value={newComplaints.toString()} icon="🚨" isBlinking={newComplaints > 0} onPress={() => {
                            setCurrentTab('complaints');
                            fetchAssignedComplaints();
                        }} />
                    </View>
                    <View style={styles.kpiRow}>
                        <Card label="Delivery Partners" value={totalDeliveryPartners.toString()} icon="🚚" onPress={() => setCurrentTab('deliveryPartners')} />
                        <Card label="Total Active Stores" value={totalActiveStores.toString()} icon="🏬" onPress={() => setCurrentTab('activeStoresList')} />
                    </View>
                </View>
            </ScrollView>
        </View>
    );

    const renderOrders = () => {
        const listHeader = (
            <View>
                <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                    <Text style={styles.backButtonText}>← Back to Dashboard</Text>
                </TouchableOpacity>
                <View style={styles.formCard}>
                    <Text style={styles.formTitle}>Search Orders by Date</Text>
                    <View style={styles.datePickerRow}>
                        <TouchableOpacity style={[styles.datePickerInput, { flex: 0.45 }]} onPress={showStartDatePicker}>
                            <Text style={styles.datePickerText}>{startDate ? startDate.toLocaleDateString() : 'Start Date'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.datePickerInput, { flex: 0.45 }]} onPress={showEndDatePicker}>
                            <Text style={styles.datePickerText}>{endDate ? endDate.toLocaleDateString() : 'End Date'}</Text>
                        </TouchableOpacity>
                        {(startDate || endDate) && (
                            <TouchableOpacity style={styles.clearButton} onPress={handleClearDates}>
                                <Text style={styles.clearButtonText}>✕</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.button, styles.exportButton]}
                    onPress={handleExportAllOrders}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.buttonText}>Export All Orders</Text>
                    )}
                </TouchableOpacity>

                <View style={[styles.itemCard, { marginBottom: 0 }]}>
                    <Text style={styles.itemTitle}>Orders ({filteredOrders.length})</Text>
                </View>
            </View>
        );

        if (loading) {
            return <ActivityIndicator size="large" color="#4F46E5" style={styles.loadingSpinner} />;
        }

        if (filteredOrders.length === 0) {
            return (
                <View>
                    {listHeader}
                    <Text style={[styles.noDataText, { marginTop: 0 }]}>No orders found for the selected dates.</Text>
                </View>
            );
        }

        return (
            <FlatList
                data={filteredOrders}
                keyExtractor={item => item.id}
                renderItem={({ item: order }: { item: Order }) => (
                    <OrderCard
                        key={order.id}
                        order={order}
                        onApprove={handleApproveOrder}
                        onAssign={handleAssignDeliveryPartner}
                        approvedDeliveryPartners={approvedDeliveryPartners}
                    />
                )}
                ListHeaderComponent={listHeader}
                contentContainerStyle={styles.flatListContent}
            />
        );
    };

    const renderCreatePartner = () => {
        const assignedStoreIds = new Set<number>();
        partners.forEach(partner => {
            if (partner.stores && Array.isArray(partner.stores)) {
                partner.stores.forEach(store => {
                    assignedStoreIds.add(store.id);
                });
            }
        });

        const unassignedStores = stores.filter(store => !assignedStoreIds.has(store.id));
        const selectedStores = stores.filter(store => selectedStoreIds.includes(store.id));

        return (
            <View style={styles.contentWrapper}>
                <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                    <Text style={styles.backButtonText}>← Back to Dashboard</Text>
                </TouchableOpacity>
                <ScrollView contentContainerStyle={styles.scrollContent}>
                    <View style={styles.cardContainer}>
                        <Text style={styles.sectionTitle}>Create New Partner</Text>
                        <View style={styles.formCard}>
                            <TextInput
                                style={styles.textInput}
                                placeholder="Full Name"
                                placeholderTextColor="#9CA3AF"
                                value={fullName}
                                onChangeText={setFullName}
                            />
                            <TextInput
                                style={styles.textInput}
                                placeholder="Email"
                                placeholderTextColor="#9CA3AF"
                                value={email}
                                onChangeText={setEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                            />
                            <TextInput
                                style={styles.textInput}
                                placeholder="Password"
                                placeholderTextColor="#9CA3AF"
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                            />
                            <TextInput
                                style={styles.textInput}
                                placeholder="Mobile Number"
                                placeholderTextColor="#9CA3AF"
                                value={mobileNumber}
                                onChangeText={setMobileNumber}
                                keyboardType="phone-pad"
                            />
                            <Text style={styles.selectStoresTitle}>Select Store(s):</Text>
                            {loadingStores ? (
                                <ActivityIndicator size="small" color="#4F46E5" style={styles.loadingSpinner} />
                            ) : (
                                <>
                                    <TouchableOpacity onPress={() => setIsDropdownOpen(true)} style={styles.dropdownButton}>
                                        <Text style={styles.dropdownButtonText}>
                                            {selectedStoreIds.length > 0
                                                ? `Selected: ${selectedStores.map(s => s.store_name).join(', ')}`
                                                : "Select one or more stores..."}
                                        </Text>
                                    </TouchableOpacity>
                                    <Modal
                                        animationType="slide"
                                        transparent={true}
                                        visible={isDropdownOpen}
                                        onRequestClose={() => setIsDropdownOpen(false)}
                                    >
                                        <View style={styles.centeredView}>
                                            <View style={styles.modalView}>
                                                <Text style={styles.modalTitle}>Select Stores</Text>
                                                <ScrollView style={styles.storeList}>
                                                    {unassignedStores.length > 0 ? (
                                                        unassignedStores.map((store: Store) => (
                                                            <View key={store.id} style={styles.checkboxContainer}>
                                                                <CheckBox
                                                                    value={selectedStoreIds.includes(store.id)}
                                                                    onValueChange={(checked) => {
                                                                        setSelectedStoreIds(prev => checked
                                                                            ? [...prev, store.id]
                                                                            : prev.filter(id => id !== store.id)
                                                                        );
                                                                    }}
                                                                />
                                                                <Text style={styles.checkboxLabel}>{store.store_name} ({store.city})</Text>
                                                            </View>
                                                        ))
                                                    ) : (
                                                        <Text style={styles.noDataText}>All stores are currently assigned to partners.</Text>
                                                    )}
                                                </ScrollView>
                                                <TouchableOpacity
                                                    style={[styles.button, styles.modalCloseButton]}
                                                    onPress={() => setIsDropdownOpen(false)}
                                                >
                                                    <Text style={styles.buttonText}>Done</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    </Modal>
                                </>
                            )}
                            <TouchableOpacity
                                style={[styles.button, styles.primaryButton]}
                                onPress={handleCreatePartner}
                                disabled={loading}
                            >
                                <Text style={styles.buttonText}>Create Partner</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>
            </View>
        );
    };

    const renderMyPartners = () => (
        <View style={styles.contentWrapper}>
            <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back to Dashboard</Text>
            </TouchableOpacity>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.cardContainer}>
                    <Text style={styles.sectionTitle}>My Partners</Text>
                    <View style={styles.itemCard}>
                        <Text style={styles.itemTitle}>All Partners ({partners.length})</Text>
                        {partners.length > 0 ? (
                            partners.map((partner: Partner) => (
                                <View key={partner.id} style={styles.listItem}>
                                    <View>
                                        <Text style={styles.itemTitle}>{partner.full_name}</Text>
                                        <Text style={styles.itemDetails}>{partner.email}</Text>
                                        <Text style={styles.itemDetails}>
                                            Stores: {partner.stores.map(s => s.store_name).join(', ')}
                                        </Text>
                                    </View>
                                </View>
                            ))
                        ) : (
                            <Text style={styles.noDataText}>No partners found.</Text>
                        )}
                    </View>
                </View>
            </ScrollView>
        </View>
    );

    const renderDeliveryPartners = () => {
        const pendingPartners = allDeliveryPartners.filter(dp => dp.status === 'pending');
        const activePartners = allDeliveryPartners.filter(dp => dp.status === 'active' || dp.status === 'approved');
    
        return (
            <View style={styles.contentWrapper}>
                <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                    <Text style={styles.backButtonText}>← Back to Dashboard</Text>
                </TouchableOpacity>
                <ScrollView contentContainerStyle={styles.scrollContent}>
                    <View style={styles.cardContainer}>
                        <Text style={styles.sectionTitle}>Delivery Partners</Text>
                        
                        <View style={styles.itemCard}>
                            <Text style={styles.itemTitle}>Pending Delivery Partners ({pendingPartners.length})</Text>
                            {pendingPartners.length > 0 ? (
                                pendingPartners.map((dp: DeliveryPartner) => (
                                    <View key={dp.id} style={styles.listItem}>
                                        <View>
                                            <Text style={styles.itemDetails}>{dp.full_name}</Text>
                                            <Text style={styles.itemDetails}>{dp.email}</Text>
                                        </View>
                                        <TouchableOpacity
                                            style={[styles.button, styles.approveButtonSmall]}
                                            onPress={() => handleApproveDeliveryPartner(dp.id)}>
                                            <Text style={styles.buttonText}>Approve</Text>
                                        </TouchableOpacity>
                                    </View>
                                ))
                            ) : (
                                <Text style={styles.noDataText}>No pending delivery partners.</Text>
                            )}
                        </View>
        
                        <View style={styles.itemCard}>
                            <Text style={styles.itemTitle}>All Delivery Partners ({activePartners.length})</Text>
                            {activePartners.length > 0 ? (
                                activePartners.map((dp: DeliveryPartner) => (
                                    <View key={dp.id} style={styles.listItem}>
                                        <View>
                                            <Text style={styles.itemDetails}>{dp.full_name}</Text>
                                            <Text style={styles.itemDetails}>{dp.email}</Text>
                                        </View>
                                        <Text style={[styles.statusBadgeSmall, styles.statusApproved]}>
                                            {dp.status}
                                        </Text>
                                    </View>
                                ))
                            ) : (
                                <Text style={styles.noDataText}>No active delivery partners found.</Text>
                            )}
                        </View>
                    </View>
                </ScrollView>
            </View>
        );
    };

    const renderComplaints = () => (
        <View style={styles.contentWrapper}>
            <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back to Dashboard</Text>
            </TouchableOpacity>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.cardContainer}>
                    <Text style={styles.sectionTitle}>Complaints</Text>
                    {loadingComplaints ? (
                        <ActivityIndicator size="large" color="#4F46E5" style={styles.loadingSpinner} />
                    ) : complaints.length === 0 ? (
                        <Text style={styles.noDataText}>No complaints found.</Text>
                    ) : (
                        <View>
                            {complaints.map((complaint: Complaint) => (
                                <View key={complaint.id} style={styles.complaintsCard}>
                                    <View style={styles.complaintsCardHeader}>
                                        <Text style={styles.complaintsCardTitle}>{complaint.subject}</Text>
                                        <Text
                                            style={[
                                                styles.complaintsStatusBadge,
                                                complaint.status === 'New' ? styles.statusNew :
                                                    complaint.status === 'In Progress' ? styles.statusInProgress :
                                                        styles.statusResolved,
                                            ]}
                                        >
                                            {complaint.status}
                                        </Text>
                                    </View>
                                    <Text style={styles.complaintsCardText}>{complaint.description}</Text>
                                    <Text style={styles.complaintsCardSub}>By: {complaint.customerName}</Text>
                                    <Text style={styles.complaintsCardSub}>Date: {complaint.date.toLocaleDateString()}</Text>
                                    {complaint.status !== 'Resolved' && (
                                        <TouchableOpacity
                                            style={styles.complaintsResolveButton}
                                            onPress={() => openSolutionInput(complaint.id)}
                                        >
                                            <Text style={styles.complaintsResolveButtonText}>Resolve</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            </ScrollView>
        </View>
    );

    const renderReports = () => (
        <View style={styles.contentWrapper}>
            <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back to Dashboard</Text>
            </TouchableOpacity>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.cardContainer}>
                    <Text style={styles.sectionTitle}>Quality & Test Reports</Text>
                    <View style={styles.formCard}>
                        <Text style={styles.itemTitle}>Upload New Report</Text>
                        <Text style={[styles.noDataText, { fontStyle: 'normal', color: '#4F46E5', fontSize: 16 }]}>
                            Coming Soon 🚀
                        </Text>
                        <Text style={[styles.noDataText, { marginTop: 5 }]}>
                            This feature is under development.
                        </Text>
                    </View>
                    
                    <View style={styles.itemCard}>
                        <Text style={styles.itemTitle}>Recent Reports</Text>
                        {reportsLoading ? (
                            <ActivityIndicator size="small" color="#4F46E5" style={styles.loadingSpinner} />
                        ) : reports.length > 0 ? (
                            reports.map((report: ReportOut) => (
                                <View key={report.id} style={styles.listItem}>
                                    <Text style={styles.itemDetails}>
                                        {new Date(report.report_date).toLocaleDateString()}
                                    </Text>
                                    <TouchableOpacity
                                        onPress={() => Linking.openURL(report.file_path)}
                                        style={[styles.button, styles.downloadButton]}
                                    >
                                        <Text style={styles.buttonText}>View PDF</Text>
                                    </TouchableOpacity>
                                </View>
                            ))
                        ) : (
                            <Text style={styles.noDataText}>No reports found.</Text>
                        )}
                    </View>
                </View>
            </ScrollView>
        </View>
    );


    const renderQRManagement = () => (
        <View style={styles.contentWrapper}>
            <TouchableOpacity onPress={() => setCurrentTab('dashboard')} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back to Dashboard</Text>
            </TouchableOpacity>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.cardContainer}>
                    <Text style={styles.sectionTitle}>QR Code Management</Text>

                    <View style={styles.formCard}>
                        <Text style={styles.itemTitle}>Generate a new bottle</Text>
                        <TouchableOpacity
                            style={[styles.button, styles.primaryButton]}
                            onPress={handleGenerateQR}
                            disabled={loading}
                        >
                            <Text style={styles.buttonText}>Generate New QR Code</Text>
                        </TouchableOpacity>
                        {generatedQrData && (
                            <View key={generatedQrData.uuid} style={styles.generatedQrContainer}>
                                <Text style={styles.generatedQrText}>New QR Generated:</Text>
                                <View key={generatedQrData.uuid} style={styles.qrCodeWrapper}>
                                    <QRCode value={generatedQrData.qr_code} size={150} />
                                </View>
                                <Text style={styles.generatedQrCode}>{generatedQrData.qr_code}</Text>
                                <TouchableOpacity
                                    style={styles.copyButton}
                                    onPress={() => Clipboard.setString(generatedQrData.qr_code)}
                                >
                                    <Text style={styles.copyButtonText}>Copy QR Code</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>

                    <View style={styles.formCard}>
                        <Text style={styles.itemTitle}>Assign Bottles to Delivery Partners</Text>
                        <Text style={styles.label}>Select Bottles to Assign:</Text>

                        <ScrollView style={styles.bottleList}>
                            {unassignedBottles.length > 0 ? (
                                unassignedBottles.map((bottle: BottleToAssign) => (
                                    <View key={bottle.UUID} style={styles.checkboxContainer}>
                                        <CheckBox
                                            value={selectedBottlesToAssign.includes(bottle.qr_code)}
                                            onValueChange={(checked) => {
                                                setSelectedBottlesToAssign(prev =>
                                                    checked ? [...prev, bottle.qr_code] : prev.filter(qr => qr !== bottle.qr_code)
                                                );
                                            }}
                                        />
                                        <Text style={styles.checkboxLabel}>Bottle: {bottle.qr_code}</Text>
                                    </View>
                                ))
                            ) : (
                                <Text style={styles.noDataText}>No unassigned bottles available.</Text>
                            )}
                        </ScrollView>

                        <TouchableOpacity
                            style={[styles.button, styles.assignButton]}
                            onPress={() => setQrAssigning(true)}
                            disabled={loading || selectedBottlesToAssign.length === 0}
                        >
                            <Text style={styles.buttonText}>Assign Selected Bottles</Text>
                        </TouchableOpacity>
                    </View>

                    <Modal visible={qrAssigning} animationType="slide" transparent={true} onRequestClose={() => setQrAssigning(false)}>
                        <View style={styles.centeredView}>
                            <View style={styles.modalView}>
                                <Text style={styles.modalTitle}>Assign Bottles to Partner</Text>
                                {selectedBottlesToAssign.length > 0 && (
                                    <Text style={styles.modalSubtitle}>Assigning {selectedBottlesToAssign.length} bottle(s)</Text>
                                )}
                                <ScrollView style={styles.dropdownScrollView}>
                                    {approvedDeliveryPartners.length > 0 ? (
                                        approvedDeliveryPartners.map((dp: DeliveryPartner) => (
                                            <TouchableOpacity
                                                key={dp.id}
                                                style={[styles.dropdownItem]}
                                                onPress={() => {
                                                    setQrAssigning(false);
                                                    handleAssignBottlesToPartner(String(dp.id));
                                                }}
                                            >
                                                <Text style={styles.dropdownItemText}>
                                                    {dp.full_name}
                                                </Text>
                                            </TouchableOpacity>
                                        ))
                                    ) : (
                                        <Text style={styles.noDataText}>No active delivery partners.</Text>
                                    )}
                                </ScrollView>
                                <TouchableOpacity
                                    style={[styles.button, styles.modalCancelButton]}
                                    onPress={() => setQrAssigning(false)}
                                >
                                    <Text style={styles.buttonText}>Cancel</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </Modal>
                </View>
            </ScrollView>
        </View>
    );


    const renderContent = () => {
        switch (currentTab) {
            case 'dashboard':
                return renderDashboard();
            case 'orders':
                return renderOrders();
            case 'createPartner':
                return renderCreatePartner();
            case 'myPartners':
                return renderMyPartners();
            case 'deliveryPartners':
                return renderDeliveryPartners();
            case 'complaints':
                return renderComplaints();
            case 'reports':
                return renderReports();
            case 'qrManagement':
                return renderQRManagement();
            case 'activeStoresList':
                return renderStoresList();
            default:
                return renderDashboard();
        }
    };

    const sidebarTranslateX = sidebarAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-300, 0],
    });

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.menuButton} onPress={openSidebar}>
                    <Text style={styles.menuButtonText}>☰</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Super Admin Dashboard</Text>
            </View>

            {/* This is the key change: a single View for the top-level content. 
                Each child component (like renderOrders) now handles its own scrolling. */}
            <View style={styles.mainContent}>
                {renderContent()}
            </View>

            <Modal
                transparent={true}
                visible={isSidebarOpen}
                onRequestClose={closeSidebar}
                animationType="none"
            >
                <View style={styles.overlay}>
                    <Animated.View style={[styles.sidebar, { transform: [{ translateX: sidebarTranslateX }] }]}>
                        <Sidebar
                            currentTab={currentTab}
                            onSelectTab={handleSelectTab}
                            onClose={closeSidebar}
                            onLogout={handleLogout}
                        />
                    </Animated.View>
                </View>
            </Modal>

            <Modal
                transparent={true}
                visible={isSolutionModalVisible}
                onRequestClose={() => setIsSolutionModalVisible(false)}
                animationType="slide"
            >
                <View style={styles.centeredView}>
                    <View style={styles.modalView}>
                        <Text style={styles.modalTitle}>Enter Solution</Text>
                        <TextInput
                            style={[styles.textInput, styles.solutionInput]}
                            multiline
                            placeholder="Type your solution here..."
                            placeholderTextColor="#9CA3AF"
                            value={solutionText}
                            onChangeText={setSolutionText}
                        />
                        <View style={styles.modalActionButtons}>
                            <TouchableOpacity style={[styles.button, styles.modalCancelButton]} onPress={() => setIsSolutionModalVisible(false)}>
                                <Text style={styles.buttonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.button, styles.modalAssignButton]} onPress={handleResolveComplaint}>
                                <Text style={styles.buttonText}>Resolve</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
};

// --- Styles ---
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F3F4F6',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        elevation: 2,
    },
    menuButton: {
        padding: 8,
    },
    menuButtonText: {
        fontSize: 24,
        color: '#4F46E5',
    },
    headerTitle: {
        flex: 1,
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1F2937',
        textAlign: 'center',
        marginLeft: -40,
    },
    mainContent: {
        flex: 1,
        padding: 16, // This padding will apply to all content inside this container
    },
    loadingSpinner: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 50,
    },
    cardContainer: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#1F2937',
        marginBottom: 16,
        borderLeftColor: '#4F46E5',
        borderLeftWidth: 4,
        paddingLeft: 8,
    },
    kpiRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    cardIcon: {
        fontSize: 32,
        marginBottom: 8,
    },
    cardValue: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#4F46E5',
    },
    cardLabel: {
        fontSize: 14,
        color: '#6B7280',
        marginTop: 4,
        textAlign: 'center',
    },
    itemCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
    },
    orderCardItem: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginVertical: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
    },
    itemHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    itemTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1F2937',
    },
    itemDetails: {
        fontSize: 14,
        color: '#6B7280',
        marginBottom: 4,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 16,
        fontWeight: 'bold',
        textTransform: 'capitalize',
        color: '#FFFFFF',
        fontSize: 12,
    },
    statusBadgeSmall: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 12,
        fontWeight: 'bold',
        textTransform: 'capitalize',
        color: '#FFFFFF',
        fontSize: 10,
    },
    statusPending: {
        backgroundColor: '#F59E0B',
    },
    statusDelivered: {
        backgroundColor: '#10B981',
    },
    statusInTransit: {
        backgroundColor: '#3B82F6',
    },
    statusApproved: {
        backgroundColor: '#10B981',
    },
    statusGood: {
        backgroundColor: '#10B981',
    },
    actionButtons: {
        marginTop: 10,
    },
    button: {
        paddingVertical: 10,
        paddingHorizontal: 15,
        borderRadius: 8,
        alignItems: 'center',
    },
    approveButton: {
        backgroundColor: '#4F46E5',
    },
    assignButton: {
        backgroundColor: '#3B82F6',
    },
    approveButtonSmall: {
        backgroundColor: '#4F46E5',
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    resolveButton: {
        backgroundColor: '#10B981',
    },
    secondaryButton: {
        backgroundColor: '#6B7280',
        marginTop: 10,
    },
    primaryButton: {
        backgroundColor: '#4F46E5',
        marginTop: 15,
    },
    buttonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    noDataText: {
        textAlign: 'center',
        color: '#9CA3AF',
        marginTop: 20,
        fontStyle: 'italic',
    },
    formCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    formTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1F2937',
        marginBottom: 15,
    },
    textInput: {
        backgroundColor: '#F9FAFB',
        padding: 12,
        borderRadius: 8,
        marginBottom: 10,
        borderColor: '#E5E7EB',
        borderWidth: 1,
        color: '#1F2937',
    },
    selectStoresTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#4F46E5',
        marginBottom: 8,
    },
    dropdownButton: {
        padding: 12,
        backgroundColor: '#F9FAFB',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        marginBottom: 10,
    },
    dropdownButtonText: {
        color: '#6B7280',
    },
    centeredView: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalView: {
        backgroundColor: 'white',
        borderRadius: 20,
        padding: 25,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
        width: '90%',
        maxHeight: '70%',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 15,
        textAlign: 'center',
    },
    storeList: {
        width: '100%',
    },
    checkboxContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    checkboxLabel: {
        fontSize: 16,
        marginLeft: 8,
        color: '#1F2937',
    },
    modalCloseButton: {
        marginTop: 20,
        backgroundColor: '#4F46E5',
    },
    listItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    datePickerButton: {
        backgroundColor: '#F9FAFB',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        marginBottom: 10,
    },
    datePickerButtonText: {
        color: '#1F2937',
        fontSize: 16,
    },
    sidebar: {
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        width: 280,
        backgroundColor: '#1F2937',
        zIndex: 10,
    },
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    sidebarContent: {
        flex: 1,
        paddingTop: 50,
        paddingHorizontal: 20,
    },
    closeButton: {
        position: 'absolute',
        top: 20,
        right: 20,
        padding: 10,
        zIndex: 1,
    },
    closeButtonText: {
        fontSize: 24,
        color: '#E5E7EB',
    },
    sidebarHeader: {
        marginBottom: 30,
    },
    sidebarHeaderTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#E5E7EB',
    },
    sidebarItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderRadius: 8,
        marginBottom: 8,
    },
    sidebarItemActive: {
        backgroundColor: '#4F46E5',
    },
    sidebarIcon: {
        fontSize: 20,
        marginRight: 15,
    },
    sidebarText: {
        fontSize: 16,
        color: '#E5E7EB',
    },
    sidebarTextActive: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    logoutButton: {
        paddingVertical: 12,
        paddingHorizontal: 20,
        backgroundColor: '#EF4444',
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 'auto',
        marginBottom: 20,
    },
    logoutButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
        fontSize: 16,
    },
    dropdownScrollView: {
        width: '100%',
        maxHeight: 200,
    },
    dropdownItem: {
        padding: 15,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    dropdownItemActive: {
        backgroundColor: '#4F46E5',
    },
    dropdownItemText: {
        fontSize: 16,
        color: '#1F2937',
    },
    dropdownItemTextActive: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    modalActionButtons: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        width: '100%',
        marginTop: 20,
    },
    modalAssignButton: {
        backgroundColor: '#3B82F6',
        paddingHorizontal: 20,
    },
    modalCancelButton: {
        backgroundColor: '#6B7280',
        paddingHorizontal: 20,
    },
    generatedQrContainer: {
        marginTop: 20,
        alignItems: 'center',
        padding: 10,
        backgroundColor: '#F9FAFB',
        borderRadius: 8,
    },
    qrCodeWrapper: {
        backgroundColor: '#FFFFFF',
        padding: 10,
        borderRadius: 8,
        marginBottom: 10,
    },
    generatedQrText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#4F46E5',
        marginBottom: 5,
    },
    generatedQrCode: {
        fontSize: 14,
        color: '#1F2937',
        fontWeight: 'bold',
        marginBottom: 10,
    },
    copyButton: {
        backgroundColor: '#6B7280',
        padding: 10,
        borderRadius: 5,
    },
    copyButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    label: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1F2937',
        marginBottom: 8,
    },
    bottleList: {
        maxHeight: 200, // Or a suitable height for your layout
        marginBottom: 10,
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#6B7280',
        marginBottom: 10,
        textAlign: 'center',
    },
    complaintsCardContainer: {
        marginVertical: 10,
        paddingHorizontal: 10,
    },

    complaintsCard: {
        backgroundColor: "#fff",
        padding: 14,
        marginVertical: 8,
        borderRadius: 12,
        shadowColor: "#000",
        shadowOpacity: 0.1,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 4,
        elevation: 3,
    },

    complaintsCardHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 6,
    },

    complaintsCardTitle: {
        fontSize: 16,
        fontWeight: "600",
        color: "#333",
    },

    complaintsCardText: {
        fontSize: 14,
        color: "#555",
        marginBottom: 4,
    },

    complaintsCardSub: {
        fontSize: 12,
        color: "#777",
        marginBottom: 2,
    },

    complaintsStatusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8,
        fontSize: 12,
        fontWeight: "600",
        color: "#fff",
    },

    statusNew: {
        backgroundColor: "#f39c12",
    },
    statusInProgress: {
        backgroundColor: "#3498db",
    },
    statusResolved: {
        backgroundColor: "#2ecc71",
    },

    complaintsResolveButton: {
        marginTop: 10,
        backgroundColor: "#2ecc71",
        paddingVertical: 8,
        borderRadius: 8,
        alignItems: "center",
    },

    complaintsResolveButtonText: {
        color: "#fff",
        fontWeight: "600",
        fontSize: 14,
    },

    solutionInput: {
        height: 100, // Or a preferred height
        textAlignVertical: 'top',
        paddingTop: 10,
    },
    downloadButton: {
        backgroundColor: '#4F46E5',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
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
    scrollContent: {
        flexGrow: 1,
        padding: 16,
    },
    flatListContent: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    exportButton: {
        backgroundColor: '#10B981', // A nice green color for export
        marginTop: 10,
        marginBottom: 20,
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
    contentWrapper: {
        flex: 1,
    }
});

export default SuperAdminDashboard;

