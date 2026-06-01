import { getOrdersUrl, getProfileUrl } from './utils/apiSelector'; // Adjust path if needed
import React, { useState, useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';



import {
    SafeAreaView,
    ScrollView,
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    StatusBar,
    Dimensions,
    Alert,
    ActivityIndicator,
    Linking,
    Modal,
    TextInput,
    PermissionsAndroid,
    Platform,
    RefreshControl,
    // --- (NEW IMPORT FOR IMAGE) ---
    Image 
} from 'react-native';

// --- (MODIFIED IMPORT) ---
import { createBottomTabNavigator, BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { RouteProp, useIsFocused } from '@react-navigation/native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { launchCamera, launchImageLibrary, ImagePickerResponse, Asset } from 'react-native-image-picker';
import { API_BASE_URL } from '../src/config';
import StoreComplianceScreen from './StoreComplianceScreen';





const SUPERADMIN_ID = 1;





const requestCameraPermission = async () => {
        if (Platform.OS === 'android') {
            try {
                const granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.CAMERA,
                    {
                        title: "AquaTrack Camera Permission",
                        message: "AquaTrack needs access to your camera to attach a photo to your complaint.", 
                        buttonPositive: "OK",
                        buttonNegative: "Cancel",
                    }
                );
                if (granted === PermissionsAndroid.RESULTS.GRANTED) {
                    console.log("You can use the camera");
                    return true;
                } else {
                    console.log("Camera permission denied");
                    return false;
                }
            } catch (err) {
                console.warn(err);
                return false;
            }
        }
        return true;
    };







// --- Define types for the data structures ---
interface PartnerAPIResponse {
    id: number;
    full_name: string;
    email: string;
    stores: StoreAPIResponse[];
}
interface UserProfile {
    id: string;
    name: string;
    role: 'delivery_manager' | 'delivery_partner';
    area: string;
    status: string;
}

interface StoreAPIResponse {
    id: number;
    store_name: string;
}

interface MyStore {

    store_id: string;

    store_name: string;

    city?: string;

    state?: string;

    channel: string;

    month_delivered_bottles: number;

    week_delivered_bottles: number;

    total_orders: number;

    last_delivery_date: string;
}

interface Partner {
    id: string;
    name: string;
    vehicle: string;
    status: string;
}

interface BackendOrder {
  id: number;
  status: string;
  order_details: string; // Used in UI to show item count/details
  total_amount: number;
  created_at: string;
  updated_at: string;
  order_date?: string;
  delivered_at?: string;

    // ⭐ ADD THIS (FRONTEND COMPUTED FIELD)
  display_date?: string;


  partner_name: string;
  store_name: string;
  
  partner: { 
    email: string; 
    full_name: string; 
    mobile_number: string; 
  };

  store: {
    id: number;
    store_name: string;
    address: string;
    city: string;
    state: string;
    zip_code: string;
    latitude?: number;
    longitude?: number;
    // 💡 Addition: Your Admin panel uses 'channel' for grouping
    channel?: string; 
  };

  delivery_person: { 
    email: string; 
    full_name: string; 
    mobile_number: string; 
  };

  empty_bottles_to_collect?: { qr_code: string }[];

  // 🔽 UI/Delivery Specific Fields
  delivery_photo_url?: string;
  bottles_delivered?: number;
  
  // 💡 Addition: Important for tracking lifecycle in Delivered Screen
  empty_bottles_collected?: number; 
  
  store_confirmed?: boolean;
  confirmed_bottles?: number;
  confirmation_remarks?: string;
}

interface AssignedBottle {
    qr_code: string;
    status: string;
}

interface ScannedBottle {
    bottleId: string;
    storeId: string;
    scanDate: string;
}

interface StoreDropdownItem {
    id: number;
    store_name: string;
    owner_id: number;
}

interface MyComplaint {
    id: number;
    subject: string;
    description: string;
    status: string;
    solution: string | null;
    created_at: string;
    assigned_to: {
        full_name: string;
        email: string;
    };
    // Assuming backend will return photo_url if available
    photo_url?: string; 
}

// --- Tab Navigator Params ---
export type DeliveryPartnerTabParamList = {
    Dashboard: undefined;
    MyStores: { accessToken: string | null };
    Pending: { accessToken: string | null };
    Delivered: { accessToken: string | null; filter?: 'all' };
    Scan: { accessToken: string | null };
    Complaints: { accessToken: string | null };

    StoreCompliance: {
        storeId: string;
        storeName: string;
    };
};

const Tab = createBottomTabNavigator<DeliveryPartnerTabParamList>();

// --- Reusable KPI Card Component (NOW CLICKABLE) ---
const KpiCard = ({
  label,
  value,
  icon,
  color,
  onPress,
  isComingSoon = false,
}: {
  label: string;
  value: string;
  icon: string;
  color: string;
  onPress?: () => void;
  isComingSoon?: boolean;
}) => (
  <TouchableOpacity
    style={[
      styles.kpiCard,
      { borderLeftColor: color },
      isComingSoon && styles.kpiCardDisabled,
    ]}
    onPress={onPress}
    disabled={isComingSoon || !onPress}
  >
    <View style={styles.kpiCardHeader}>
      <Text style={styles.kpiIcon}>{icon}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
    </View>
    <Text style={styles.kpiLabel}>{label}</Text>
  </TouchableOpacity>
);
 

// --- (MODIFIED COMPONENT) ---

// --- Prop Types for Navigation (MODIFIED) ---
type DashboardScreenProps = {
  navigation: BottomTabNavigationProp<DeliveryPartnerTabParamList, 'Dashboard'>;
  accessToken: string | null; // <-- ADDED
};

// --- Updated Dashboard Overview Screen ---
const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation, accessToken }) => {
    const [stats, setStats] = useState({
        totalOrders: 0,
        deliveredOrders: 0,
        pendingOrders: 0,
        todayDelivered: 0,
        pendingComplaints: 0,
    });
    const [isLoading, setIsLoading] = useState(true);
    const isFocused = useIsFocused();

    const fetchDashboardData = async () => {
        if (!accessToken) {
            console.log('❌ Dashboard: No token, skipping fetch');
            return;
        }

        setIsLoading(true);

        let fetchedStats = {
            totalOrders: 0,
            deliveredOrders: 0,
            pendingOrders: 0,
            todayDelivered: 0,
            pendingComplaints: 0,
        };

        try {
            // -------- ORDERS --------
            const url = await getOrdersUrl();
            const ordersResponse = await axios.get(url, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            const allOrders = ordersResponse.data || [];

            const delivered = allOrders.filter(
                (o: any) => o.status === 'delivered_confirmed'
            );

            const pending = allOrders.filter(
                (o: any) =>
                    o.status !== 'delivered_confirmed' &&
                    o.status !== 'delivered_pending_confirmation'
            );

            const today = new Date().toISOString().slice(0, 10);
            const todayDeliveredCount = delivered.filter((o: any) =>
                o.updated_at?.slice(0, 10) === today
            ).length;

            fetchedStats.totalOrders = allOrders.length;
            fetchedStats.deliveredOrders = delivered.length;
            fetchedStats.pendingOrders = pending.length;
            fetchedStats.todayDelivered = todayDeliveredCount;

            // -------- COMPLAINTS --------
            try {
                const complaintsResponse = await axios.get(
                    `${API_BASE_URL}/complaints/complaints/me`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );

                fetchedStats.pendingComplaints =
                    complaintsResponse.data.filter(
                        (c: any) => c.status === 'pending'
                    ).length;
            } catch (err: any) {
                if (err?.response?.status === 404) {
                    fetchedStats.pendingComplaints = 0;
                }
            }

            setStats(fetchedStats);
        } catch (err) {
            console.error('❌ Dashboard fetch failed:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isFocused && accessToken) {
            fetchDashboardData();
        }
    }, [isFocused, accessToken]);

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#3b2f5b" />
                <Text style={styles.loadingText}>Syncing Performance...</Text>
            </View>
        );
    }

    return (
        <ScrollView 
            style={styles.scrollViewContent} 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 30 }}
        >
            <View style={styles.mainContentWrapper}>
                
                {/* 1. SS2 Style Heading */}
                <Text style={styles.sectionHeading}>Performance Overview</Text>

                {/* 2. SS2 Style Vertical Grid */}
                <View style={styles.modernGrid}>
                    <KpiCard
                        label="Total Orders"
                        value={stats.totalOrders.toString()}
                        icon="📦"
                        color="#4F46E5"
                        onPress={() => navigation.navigate('Delivered', { accessToken, filter: 'all' })}
                    />
                    <KpiCard
                        label="Pending Orders"
                        value={stats.pendingOrders.toString()}
                        icon="⌛"
                        color="#F59E0B"
                        onPress={() => navigation.navigate('Pending', { accessToken })}
                    />
                    <KpiCard
                        label="Delivered Today"
                        value={stats.todayDelivered.toString()}
                        icon="🚚"
                        color="#10B981"
                        onPress={() => navigation.navigate('Delivered', { accessToken })}
                    />
                    <KpiCard
                        label="Complaints"
                        value={stats.pendingComplaints.toString()}
                        icon="🚨"
                        color="#EF4444"
                        onPress={() => navigation.navigate('Complaints', { accessToken })}
                    />

                    <TouchableOpacity
    style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 18,
        marginTop: 16,
        elevation: 3,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center'
    }}
    onPress={() =>
        navigation.navigate(
            'MyStores',
            { accessToken }
        )
    }
>
    <View>
        <Text
            style={{
                fontSize: 18,
                fontWeight: '700',
                color: '#111827'
            }}
        >
            🏪 My Stores
        </Text>

        <Text
            style={{
                color: '#6B7280',
                marginTop: 4
            }}
        >
            Open Store Compliance Dashboard
        </Text>
    </View>

    <Text
        style={{
            fontSize: 24,
            color: '#9CA3AF'
        }}
    >
        ➜
    </Text>
</TouchableOpacity>
                </View>

                {/* 3. SS2 Style Recent Activity / Quick Action */}
                <Text style={[styles.sectionHeading, { marginTop: 25 }]}>Recent Activity</Text>
                
               
                        

                {/* SS2 style empty spacer if needed */}
                <View style={{ height: 20 }} />
            </View>
        </ScrollView>
    );
};


type MyStoresScreenProps = {
    route: RouteProp<DeliveryPartnerTabParamList, 'MyStores'>;
};

const MyStoresScreen: React.FC<MyStoresScreenProps> = ({ route }) => {

    const { accessToken } = route.params;

    const navigation = useNavigation<any>();

    const [stores, setStores] = useState<MyStore[]>([]);
    const [storeSearch, setStoreSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const isFocused = useIsFocused();

    const fetchMyStores = async () => {

        try {

            setLoading(true);

            const response = await axios.get(
                `${API_BASE_URL}/store/store/store-delivery-summary`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                }
            );

            setStores(response.data);

        } catch (error) {

            console.error(
                "Failed to fetch stores:",
                error
            );

            Alert.alert(
                "Error",
                "Failed to load stores."
            );

        } finally {

            setLoading(false);
        }
    };

    useEffect(() => {
        if (isFocused && accessToken) {
            fetchMyStores();
        }
    }, [isFocused, accessToken]);

    const onRefresh = async () => {

        setRefreshing(true);

        await fetchMyStores();

        setRefreshing(false);
    };

    if (loading) {

        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator
                    size="large"
                    color="#3b2f5b"
                />
            </View>
        );
    }

    return (

        <ScrollView
            style={styles.scrollViewContent}

            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                />
            }

            contentContainerStyle={{
                paddingBottom: 30
            }}
        >

            <View style={styles.mainContentWrapper}>

                {/* HEADER */}

                <View
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 12
                    }}
                >
                    <Text style={styles.sectionHeading}>
                        My Assigned Stores
                    </Text>

                    <View
                        style={{
                            backgroundColor: '#3B82F6',
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 20,
                            minWidth: 40,
                            alignItems: 'center'
                        }}
                    >
                        <Text
                            style={{
                                color: '#fff',
                                fontWeight: '700',
                                fontSize: 14
                            }}
                        >
                            {stores.length}
                        </Text>
                    </View>
                </View>

                {/* SEARCH BAR */}

                

                <View
                    style={{
                        backgroundColor: '#fff',
                        borderRadius: 12,
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 12,
                        marginBottom: 20,
                        borderWidth: 1,
                        borderColor: '#E5E7EB'
                    }}
                >
                    <Text style={{ fontSize: 18 }}>
                        🔍
                    </Text>

                    <TextInput
                        placeholder="Search Store..."
                        placeholderTextColor="#9CA3AF"
                        value={storeSearch}
                        onChangeText={setStoreSearch}
                        style={{
                            flex: 1,
                            paddingVertical: 12,
                            marginLeft: 10,
                            color: '#111827'
                        }}
                    />
                </View>

                {/* EMPTY */}

                {
                    stores.length === 0 ? (

                        <View style={{
                            padding: 30,
                            alignItems: 'center'
                        }}>

                            <Text style={{
                                fontSize: 16,
                                fontWeight: '600',
                                color: '#6B7280'
                            }}>
                                No assigned stores found
                            </Text>

                            <Text style={{
                                marginTop: 6,
                                color: '#9CA3AF'
                            }}>
                                Contact admin for assignment
                            </Text>

                        </View>

                    ) : (

                            stores
                                .filter(store =>
                                    store.store_name
                                        .toLowerCase()
                                        .includes(storeSearch.toLowerCase())
                                )
                                .map((store) => (

                            <TouchableOpacity
                                key={store.store_id}
                                activeOpacity={0.9}
                                onPress={() =>
                                    navigation.navigate(
                                        'StoreCompliance',
                                        {
                                            storeId: store.store_id,
                                            storeName: store.store_name,
                                            monthly: store.month_delivered_bottles,
                                            weekly: store.week_delivered_bottles,
                                            orders: store.total_orders
                                        }
                                    )
                                }
                                style={{
                                    backgroundColor: '#fff',
                                    borderRadius: 16,
                                    padding: 16,
                                    marginBottom: 16,
                                    elevation: 3,
                                    borderWidth: 1,
                                    borderColor: '#E5E7EB'
                                }}
                            >

                                {/* HEADER */}

                                <View
                                    style={{
                                        flexDirection: 'row',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start'
                                    }}
                                >

                                    <View style={{ flex: 1 }}>

                                        <Text style={{
                                            fontSize: 18,
                                            fontWeight: '700',
                                            color: '#111827'
                                        }}>
                                            🏪 {store.store_name}
                                        </Text>

                                        <Text style={{
                                            marginTop: 5,
                                            color: '#6B7280'
                                        }}>
                                            📍 {store.city || 'N/A'}
                                        </Text>

                                    </View>

                                    <Text
                                        style={{
                                            fontSize: 22,
                                            color: '#9CA3AF'
                                        }}
                                    >
                                        ➜
                                    </Text>

                                </View>

                                {/* CHANNEL */}

                                <View style={{
                                    marginTop: 10,
                                    alignSelf: 'flex-start',
                                    backgroundColor: '#DBEAFE',
                                    paddingHorizontal: 10,
                                    paddingVertical: 5,
                                    borderRadius: 20
                                }}>
                                    <Text style={{
                                        fontWeight: '700',
                                        color: '#1E40AF'
                                    }}>
                                        {store.channel}
                                    </Text>
                                </View>

                                

                                {/* STATUS */}

                                <View
                                    style={{
                                        marginTop: 14,
                                        flexDirection: 'row',
                                        alignItems: 'center'
                                    }}
                                >

                                    <View
                                        style={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: 5,
                                            backgroundColor: '#10B981',
                                            marginRight: 8
                                        }}
                                    />

                                    <Text
                                        style={{
                                            color: '#10B981',
                                            fontWeight: '700'
                                        }}
                                    >
                                        Compliance Active
                                    </Text>

                                </View>

                            </TouchableOpacity>
                        ))
                    )
                }

            </View>

        </ScrollView>
    );
};



// --- Pending Orders Screen ---
type PendingOrdersScreenProps = {
    route: RouteProp<DeliveryPartnerTabParamList, 'Pending'>;
};



const PendingOrdersScreen: React.FC<PendingOrdersScreenProps> = ({ route }) => {
    const { accessToken } = route.params;
    const isFocused = useIsFocused();
    const [pendingOrders, setPendingOrders] = useState<BackendOrder[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [verifiedBottle, setVerifiedBottle] = useState<string | null | undefined>(null);
    const [expectedQrList, setExpectedQrList] = useState<string[]>([]);
    const [searchInput, setSearchInput] = useState('');
    const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
    const [historySearchInput, setHistorySearchInput] = useState('');
    const [historySelectedStoreId, setHistorySelectedStoreId] = useState<number | null>(null);
    const [refreshing, setRefreshing] = useState(false);


    
    


    const groupedOrders = Object.values(
    pendingOrders.reduce((acc: any, order) => {
        // Force a numeric ID or fallback to a unique string
        const storeId = order.store?.id || 999; 
        const key = `store_${storeId}`;

        if (!acc[key]) {
            acc[key] = {
                store_id: storeId, // This is what we match against
                store_name: order.store?.store_name || order.store_name || "Unknown Store",
                orders: [],
                total_bottles: 0,
                oldest_date: order.created_at,
            };
        }

        acc[key].orders.push(order);
        const qty = Number(order.bottles_delivered || order.order_details || 0);
        acc[key].total_bottles += qty;

        if (new Date(order.created_at) < new Date(acc[key].oldest_date)) {
            acc[key].oldest_date = order.created_at;
        }

        return acc;
    }, {})
);
    



    const fetchPendingOrders = async () => {
        setIsLoading(true);
        try {
            if (!accessToken) throw new Error("Access token is missing.");

            // 1. Get the role from storage
            

            // 2. Define dynamic URL: DM sees area-wide orders, Partner sees own orders
            const url = await getOrdersUrl();
            const response = await axios.get(url, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            // 3. Filter for truly active/pending orders
            const activeOrders: BackendOrder[] = response.data.filter(
                (order: any) =>
                    order.status !== "delivered_confirmed" &&
                    order.status !== "delivered_pending_confirmation"
            );

            // 4. Fetch empty bottles to collect for each store
            const ordersWithEmpties = await Promise.all(
                activeOrders.map(async (order) => {
                    if (order.store?.id) {
                        try {
                            const emptiesResponse = await axios.get(
                                `${API_BASE_URL}/bottle/collect-list/store/${order.store.id}`,
                                { headers: { Authorization: `Bearer ${accessToken}` } }
                            );
                            return { ...order, empty_bottles_to_collect: emptiesResponse.data };
                        } catch (error) {
                            console.warn(`Failed to fetch empties for store ${order.store.id}:`, error);
                            return { ...order, empty_bottles_to_collect: [] };
                        }
                    }
                    return order;
                })
            );

            setPendingOrders(ordersWithEmpties);

        } catch (error) {
            console.error("Failed to fetch pending orders:", error);
            Alert.alert("Error", "Failed to load area pending orders.");
        } finally {
            setIsLoading(false);
        }
    };
    const handleOpenMap = (order: BackendOrder) => {
        console.log("Store data received in handleOpenMap:", order.store); 
        if (!order.store) {
            Alert.alert("Error", "No store details available for this order.");
            return;
        }

        const { address, city, state, zip_code, latitude, longitude } = order.store;
        let mapUrl = '';

        // --- CHECK FOR COORDINATES FIRST ---
        if (latitude && longitude) {
             // Try different map URL format
             mapUrl = Platform.select({
                 ios: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
                 android: `geo:${latitude},${longitude}?q=${latitude},${longitude}`
             }) || `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`; // Fallback

            console.log(`Opening map with coordinates: ${latitude},${longitude}`);
        } else if (address && city && state) {
            // Fallback to using the address
            const fullAddress = `${address}, ${city}, ${state} ${zip_code || ''}`;
            mapUrl = Platform.select({
                ios: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`,
                android: `geo:0,0?q=${encodeURIComponent(fullAddress)}`
            }) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`; // Fallback
            console.log(`Opening map with address: ${fullAddress}`);
        } else {
            // If neither coordinates nor sufficient address info is available
            Alert.alert("Error", "Insufficient location details to open the map.");
            return;
        }

        Linking.openURL(mapUrl).catch(err => {
            console.error("Failed to open map:", err);
            Alert.alert("Error", "Could not open maps application.");
        });
    };

    const handleVerifyQRBeforeDelivery = (
        expectedQrList: string[],
        order: BackendOrder
    ) => {

        // ✅ Open delivery modal with full order
        setExpectedQrList(expectedQrList);
        setVerifiedBottle(""); // reset QR

        openDeliverPrompt(order); // 🔥 FULL ORDER PASS
    };


    // --- DELIVERY MODAL STATE ---
const [deliverPrompt, setDeliverPrompt] = useState<{
  visible: boolean;
  orderId: number | null;
  bottles: string;
  emptyBottles: string;
  vehicle: string;
  deliveredBy: string;
  channel: string;   // 🔥 ADD THIS
}>({
  visible: false,
  orderId: null,
  bottles: "",
  emptyBottles: "",
  vehicle: "",
  deliveredBy: "",
  channel: ""        // 🔥 ADD THIS
});

const [deliveryPhoto, setDeliveryPhoto] = useState<any>(null);



const openDeliverPrompt = (order: BackendOrder) =>
  setDeliverPrompt({
    visible: true,
    orderId: order.id,
    bottles: "",
    emptyBottles: "",
    vehicle: "",
    deliveredBy: "",
    channel: order.store?.channel || ""   // 🔥 IMPORTANT
  });

    const closeDeliverPrompt = () => {
        setDeliverPrompt({
            visible: false,
            orderId: null,
            bottles: "",
            emptyBottles: "",
            vehicle: "",
            deliveredBy: "",
            channel: ""
        });

        setDeliveryPhoto(null);
        setVerifiedBottle(null);
        setExpectedQrList([]);
    };
    const submitDeliver = async () => {

    // 🔥 STEP 0: PHOTO MANDATORY VALIDATION
    if (!deliveryPhoto || !deliveryPhoto.uri) {
        Alert.alert(
            "Photo Required",
            "Please capture or upload delivery photo before submitting."
        );
        return;
    }

    console.log('Submitting delivery for order:', deliverPrompt.orderId);

    try {
        const accessToken = await AsyncStorage.getItem("auth_token");

        if (!accessToken) {
            console.log('Submit failed: No access token found');
            Alert.alert("Session Expired", "Please log in again.");
            return;
        }

        console.log('Token found, creating form data...');

        const formData = new FormData();

        formData.append("bottles_delivered", Number(deliverPrompt.bottles || 0));
        formData.append("empty_bottles_collected", Number(deliverPrompt.emptyBottles || 0));
        const isZepto = deliverPrompt.channel === "zepto";

        formData.append(
            "status",
            isZepto ? "delivered_confirmed" : "delivered_pending_confirmation"
        );

        formData.append("vehicle_info", deliverPrompt.vehicle || "");
        formData.append("delivered_by", deliverPrompt.deliveredBy || "");

        // 🔥 PHOTO NOW ALWAYS REQUIRED
        formData.append("photo", {
            uri: deliveryPhoto.uri,
            type: deliveryPhoto.type || "image/jpeg",
            name: deliveryPhoto.fileName || `delivery_${Date.now()}.jpg`,
        });

        console.log('Form data created, sending to API...');

        const response = await axios.put(
            `${API_BASE_URL}/partners/partners/delivery-partner/orders/${deliverPrompt.orderId}`,
            formData,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "multipart/form-data",
                },
            }
        );

        console.log('API response:', response.status);

        if (response.status === 200 || response.status === 201) {
            if (isZepto) {
                Alert.alert("✅ Delivered", "Order completed successfully");
            } else {
                Alert.alert("⏳ Success", "Waiting for store confirmation.");
            }
            closeDeliverPrompt();
            fetchPendingOrders();

            // Reset
            setDeliveryPhoto(null);
            setVerifiedBottle(null);
        } else {
            Alert.alert("Error", "Unexpected server response. Try again.");
        }

    } catch (error: any) {
        console.error("❌ Error submitting delivery:", error.response?.data || error.message);
        Alert.alert("Error", "Failed to mark delivery. Please try again.");
    }
};

    const handleCapturePhoto = async () => {
        const hasPermission = await requestCameraPermission(); // This will work now
        if (!hasPermission) {
            Alert.alert("Permission Error", "Camera permission is required to take a photo.");
            return;
        }

        try {
            const result: ImagePickerResponse = await launchCamera({
                mediaType: 'photo',
                quality: 0.7,
                saveToPhotos: false,
            });

            if (result.didCancel) {
                return; // User cancelled
            }

            if (result.errorCode || !result.assets || result.assets.length === 0) {
                Alert.alert("Error", "Could not capture photo. Please try again.");
                console.error("Camera Error: ", result.errorMessage);
                return;
            }

            // 🔽 IMPORTANT: Use setDeliveryPhoto for this screen
            setDeliveryPhoto(result.assets[0]);

        } catch (error: any) {
            console.error("Failed to launch camera:", error.message || error);
            Alert.alert("Camera Error", "Could not open the camera.");
        }
    };


    const handlePickFromGallery = async () => {
    try {
        const result: ImagePickerResponse = await launchImageLibrary({
            mediaType: 'photo',
            quality: 0.7,
        });

        if (result.didCancel) return;

        if (result.errorCode || !result.assets || result.assets.length === 0) {
            Alert.alert("Error", "Could not select image.");
            return;
        }

        setDeliveryPhoto(result.assets[0]);
    } catch (error) {
        console.error("Gallery Error:", error);
        Alert.alert("Error", "Could not open gallery.");
    }
};



    
    // DeliveryPartnerOrdersScreen.js or PendingOrdersScreen.js

const handleMarkAsDelivered = (orderId: number) => {
  Alert.prompt(
    "Confirm Bottles Delivered",
    "Enter the number of bottles delivered to the store:",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Submit",
        onPress: (bottles?: string) => {   // ✅ FIX 1

          if (!bottles) {
            Alert.alert("Error", "Please enter number of bottles");
            return;
          }

          // ✅ FIX 2 (async wrapper)
          (async () => {
            try {
              await axios.put(
                `${API_BASE_URL}/partners/partners/delivery-partner/orders/${orderId}/mark-delivered`,
                { bottles_delivered: Number(bottles) },
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );

              Alert.alert("Success", "Waiting for store confirmation.");
              fetchPendingOrders();

            } catch (error) {
              console.error(error);
              Alert.alert("Error", "Failed to mark delivery. Try again.");
            }
          })();
        },
      },
    ],
    "plain-text"
  );
};



    

    useEffect(() => {
  if (isFocused && accessToken) {
    fetchPendingOrders();
  }
}, [isFocused, accessToken]);

if (isLoading) {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#3b2f5b" />
      <Text style={styles.loadingText}>Loading assigned orders...</Text>
    </View>
  );
}

return (
  <ScrollView style={styles.scrollViewContent} keyboardShouldPersistTaps="handled">
    
    {/* --- 1. DELIVERY CONFIRMATION MODAL --- */}
    <Modal visible={deliverPrompt.visible} transparent animationType="fade" onRequestClose={closeDeliverPrompt}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" }}>
        <ScrollView style={{ width: "85%", backgroundColor: "#fff", borderRadius: 12, maxHeight: "85%" }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 18, fontWeight: "700", color: "#3B2F5B", marginBottom: 5 }}>
            <Text>Confirm Delivery</Text>
          </Text>
          <Text style={{ color: "#6B7280", marginBottom: 15, fontSize: 13 }}>
            <Text>Enter bottle counts and capture proof.</Text>
          </Text>

          <Text style={{ fontSize: 12, color: "#374151", marginBottom: 4, fontWeight: '600' }}>
            <Text>⬇️ Filled Bottles Delivered</Text>
          </Text>
          <TextInput placeholder="e.g. 2" keyboardType="numeric" value={deliverPrompt.bottles} onChangeText={(t) => setDeliverPrompt((p) => ({ ...p, bottles: t }))} style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 10, marginBottom: 12, color: '#000', backgroundColor: '#F9FAFB' }} placeholderTextColor="#999999" />

          <Text style={{ fontSize: 12, color: "#374151", marginBottom: 4, fontWeight: '600' }}>
            <Text>⬆️ Empty Bottles Collected</Text>
          </Text>
          <TextInput placeholder="e.g. 2" keyboardType="numeric" value={deliverPrompt.emptyBottles} onChangeText={(t) => setDeliverPrompt((p) => ({ ...p, emptyBottles: t }))} style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 10, marginBottom: 12, color: '#000', backgroundColor: '#F9FAFB' }} placeholderTextColor="#999999" />

          <Text style={{ fontSize: 12, color: "#374151", marginBottom: 4, fontWeight: '600' }}>
            <Text>🚗 Vehicle Number</Text>
          </Text>
          <TextInput placeholder="Last 4 digit (e.g. 3221)" value={deliverPrompt.vehicle} onChangeText={(t) => setDeliverPrompt((p) => ({ ...p, vehicle: t }))} maxLength={15} style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 10, marginBottom: 12, color: '#000', backgroundColor: '#F9FAFB' }} placeholderTextColor="#999999" />

          <Text style={{ fontSize: 12, color: "#374151", marginBottom: 4, fontWeight: '600' }}>
            <Text>👤 Delivered By</Text>
          </Text>
          <TextInput placeholder="Enter delivery boy name" value={deliverPrompt.deliveredBy} onChangeText={(t) => setDeliverPrompt((p) => ({ ...p, deliveredBy: t }))} style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 10, marginBottom: 15, color: '#000', backgroundColor: '#F9FAFB' }} />

          <TouchableOpacity style={{ backgroundColor: "#e5e7eb", paddingVertical: 12, borderRadius: 8, marginBottom: 10, alignItems: "center", borderStyle: 'dashed', borderWidth: 1, borderColor: '#9CA3AF' }} onPress={handleCapturePhoto}>
            <Text style={{ color: "#374151", fontWeight: "500" }}>
              <Text>{deliveryPhoto ? "🔄 Retake Photo" : "📷 Capture Delivery Photo"}</Text>
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ backgroundColor: "#e5e7eb", paddingVertical: 12, borderRadius: 8, marginBottom: 10, alignItems: "center", borderStyle: 'dashed', borderWidth: 1, borderColor: '#9CA3AF' }} onPress={handlePickFromGallery}>
            <Text style={{ color: "#374151", fontWeight: "500" }}>
              <Text>🖼️ Upload from Gallery</Text>
            </Text>
          </TouchableOpacity>

          {deliveryPhoto && <Image source={{ uri: deliveryPhoto.uri }} style={{ width: "100%", height: 150, borderRadius: 8, marginBottom: 10 }} resizeMode="cover" />}

          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 5 }}>
            <TouchableOpacity onPress={closeDeliverPrompt} style={{ backgroundColor: "#E5E7EB", paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8 }}>
              <Text style={{ color: "#374151", fontWeight: "600" }}><Text>Cancel</Text></Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={submitDeliver} style={{ backgroundColor: "#F59E0B", paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8 }}>
              <Text style={{ color: "#fff", fontWeight: "600" }}><Text>Submit</Text></Text>
            </TouchableOpacity> 
          </View>
        </ScrollView>
      </View>
    </Modal>

    {/* --- 2. SWITCH LOGIC: STORE LIST vs INDIVIDUAL STORE DETAIL --- */}
    {selectedStoreId ? (
      /* 🟢 VIEW: DETAILED ORDERS LIST PAGE */
      <View style={{ padding: 16 }}>
        <TouchableOpacity onPress={() => setSelectedStoreId(null)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, backgroundColor: '#fff', padding: 12, borderRadius: 10, elevation: 2 }}>
          <Text style={{ fontSize: 18, marginRight: 10 }}><Text>⬅️</Text></Text>
          <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#3B2F5B' }}><Text>Back to Area Queue</Text></Text>
        </TouchableOpacity>

        {(() => {
          const storeData: any = groupedOrders.find((s: any) => s.store_id === selectedStoreId);
          if (!storeData) return <Text><Text>Store data not found</Text></Text>;

          return (
            <View>
              <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#1F2937', marginBottom: 15 }}>
                <Text>🏪 </Text><Text>{storeData.store_name}</Text>
              </Text>

              {storeData.orders.map((order: any) => {
                const orderDays = Math.floor((Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60 * 24));
                let color = orderDays >= 3 ? "#EF4444" : orderDays === 2 ? "#F59E0B" : "#10B981";

                return (
                  <View key={order.id} style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 14, elevation: 3, borderLeftWidth: 5, borderLeftColor: color }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View>
                        <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#1F2937' }}>
                          <Text>Order #</Text><Text>{order.id}</Text>
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                           <Text style={{ fontSize: 14, color: '#374151', fontWeight: 'bold' }}>
                              <Text>📅 Date: </Text><Text>{new Date(order.created_at).toLocaleDateString('en-GB')}</Text>
                           </Text>
                        </View>
                      </View>
                      <View style={{ backgroundColor: color + '20', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                        <Text style={{ color: color, fontSize: 11, fontWeight: 'bold' }}>
                           <Text>{orderDays}</Text><Text>d PENDING</Text>
                        </Text>
                      </View>
                    </View>

                    <View style={{ marginTop: 12, backgroundColor: '#F9FAFB', padding: 10, borderRadius: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                         <Text style={{ color: '#4B5563', fontSize: 14 }}><Text>📦 Bottles:</Text></Text>
                         <Text style={{ fontWeight: 'bold', color: '#1F2937', fontSize: 15 }}>
                            <Text>{order.order_details || 0}</Text>
                         </Text>
                      </View>
                    </View>

                    <TouchableOpacity 
                      onPress={() => {
                        const expectedQrList = order.empty_bottles_to_collect?.map((b: any) => b.qr_code) || [];
                        setExpectedQrList(expectedQrList);
                        setVerifiedBottle("");
                        openDeliverPrompt(order);
                      }}
                      style={{ backgroundColor: color, paddingVertical: 12, borderRadius: 8, marginTop: 15, alignItems: 'center', elevation: 2 }}
                    >
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>
                        <Text>Deliver Order #</Text><Text>{order.id}</Text>
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          );
        })()}
      </View>
    ) : (
      /* 🔵 MAIN VIEW: LIST OF STORES */
      <View>
        <View style={{ padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
            <View style={{ flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, alignItems: 'center', paddingHorizontal: 12 }}>
                <Text style={{ fontSize: 16, color: '#9CA3AF' }}><Text>🔍</Text></Text>
                <TextInput placeholder="Search Store..." placeholderTextColor="#9CA3AF" style={{ flex: 1, paddingVertical: 10, marginLeft: 8, color: '#000' }} value={searchInput} onChangeText={(text) => setSearchInput(text)} />
            </View>
        </View>

        <View style={styles.section}>
            {groupedOrders.length > 0 ? (
                groupedOrders
                .filter((s: any) => s.store_name.toLowerCase().includes(searchInput.toLowerCase()))
                .map((store: any, index) => {
                    const days = Math.floor((Date.now() - new Date(store.oldest_date).getTime()) / (1000 * 60 * 60 * 24));
                    let statusColor = days >= 3 ? "#EF4444" : days === 2 ? "#F59E0B" : "#10B981";

                    return (
                        <TouchableOpacity key={index} activeOpacity={0.9} onPress={() => setSelectedStoreId(store.store_id)} style={{ backgroundColor: "#fff", padding: 16, borderRadius: 12, marginBottom: 14, borderLeftWidth: 6, borderLeftColor: statusColor, elevation: 3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 16, fontWeight: "bold", color: "#1F2937" }}>
                                  <Text>🏪 </Text><Text>{store.store_name}</Text>
                                </Text>
                                <View style={{ flexDirection: 'row', marginTop: 6 }}>
                                  <Text style={{ color: "#4B5563", fontSize: 13 }}>
                                    <Text>📦 </Text><Text>{store.total_bottles}</Text><Text> Bottles </Text>
                                  </Text>
                                  <Text style={{ color: "#4B5563", fontSize: 13 }}> 
                                    <Text> • 🧾 </Text><Text>{store.orders.length}</Text><Text> Orders</Text>
                                  </Text>
                                </View>
                                <Text style={{ color: statusColor, fontWeight: "600", marginTop: 4, fontSize: 12 }}>
                                    <Text>{days >= 3 ? "🔴 Critical: " : days === 2 ? "🟡 Warning: " : "🟢 Fresh: "}</Text>
                                    <Text>{days}</Text><Text>d pending</Text>
                                </Text>
                            </View>
                            <View style={{ alignItems: 'center' }}>
                               <Text style={{ fontSize: 20, color: '#9CA3AF' }}><Text>➡️</Text></Text>
                            </View>
                        </TouchableOpacity>
                    );
                })
            ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 40 }}>
                    <Text style={styles.noOrdersText}><Text>No pending orders found. 🎉</Text></Text>
                </View>
            )}
        </View>
      </View>
    )}
  </ScrollView>
);

};

// --- Delivered Orders Screen ---
type DeliveredOrdersScreenProps = {
    route: RouteProp<DeliveryPartnerTabParamList, 'Delivered'>;
};

const DeliveredOrdersScreen: React.FC<DeliveredOrdersScreenProps> = ({ route }) => {
    const { accessToken } = route.params;
    const isFocused = useIsFocused();
    const [deliveredOrders, setDeliveredOrders] = useState<BackendOrder[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [historySearchInput, setHistorySearchInput] = useState('');
    const [historySelectedStoreId, setHistorySelectedStoreId] = useState<number | null>(null);

    // Photo Modal States
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    const fetchDeliveredOrders = async () => {
        setIsLoading(true);
        try {
            const token = accessToken || await AsyncStorage.getItem("auth_token");
            if (!token) throw new Error("No token found");

            const url = await getOrdersUrl();
            const response = await axios.get<BackendOrder[]>(url, {
                headers: { Authorization: `Bearer ${token}` },
            });

            const historyData = response.data
                .map(order => ({
                    ...order,
                    display_date: order.order_date || order.created_at || order.updated_at
                }))
                .filter(o => o.status === "delivered_confirmed" || o.status === "delivered_pending_confirmation");

            setDeliveredOrders(historyData);
        } catch (error: any) {
            console.error("History fetch error:", error.response?.status);
            if (error.response?.status === 401) {
                Alert.alert("Session Expired", "Please login again.");
            } else {
                Alert.alert("Error", "Failed to load history.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isFocused) fetchDeliveredOrders();
    }, [isFocused]);

    const groupedHistory = Object.values(
        deliveredOrders.reduce((acc: any, order) => {
            const storeId = order.store?.id || 999;
            const key = `hist_${storeId}`;
            if (!acc[key]) {
                acc[key] = {
                    store_id: storeId,
                    store_name: order.store?.store_name || order.store_name || "Unknown Store",
                    orders: [],
                    total_delivered: 0,
                };
            }
            acc[key].orders.push(order);
            acc[key].total_delivered += Number(order.bottles_delivered || 0);
            return acc;
        }, {})
    );

    const openImage = (url: string) => {
        const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}/${url}`;
        setSelectedImage(fullUrl);
        setModalVisible(true);
    };

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#10B981" />
                <Text style={styles.loadingText}><Text>Updating History...</Text></Text>
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }}>
            <ScrollView style={styles.scrollViewContent} keyboardShouldPersistTaps="handled">
                {historySelectedStoreId ? (
                    /* 🟢 PAGE 2: INDIVIDUAL STORE HISTORY DETAILS */
                    <View style={{ padding: 16 }}>
                        <TouchableOpacity 
                            onPress={() => setHistorySelectedStoreId(null)} 
                            style={styles.backButton}
                        >
                            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#3B2F5B' }}><Text>⬅️ Back to History</Text></Text>
                        </TouchableOpacity>

                        {(() => {
                            const storeData: any = groupedHistory.find((s: any) => s.store_id === historySelectedStoreId);
                            if (!storeData) return <Text><Text>No data available</Text></Text>;

                            return (
                                <View>
                                    <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#1F2937', marginBottom: 15 }}>
                                        <Text>🏢 </Text><Text>{storeData.store_name}</Text>
                                    </Text>

                                    {storeData.orders.map((order: any) => (
                                        <View key={order.id} style={styles.historyOrderCard}>
                                            <View style={styles.cardHeader}>
                                                <Text style={styles.orderIdText}><Text>Order #{order.id}</Text></Text>
                                                <Text style={styles.dateText}><Text>{new Date(order.display_date).toLocaleDateString('en-GB')}</Text></Text>
                                            </View>

                                            <View style={styles.bottleBadge}>
                                                <Text style={styles.bottleText}><Text>🧴 {order.bottles_delivered || 0} Bottles Delivered</Text></Text>
                                            </View>

                                            <View style={styles.statusRow}>
                                                <Text style={{ 
                                                    color: order.status === 'delivered_confirmed' ? '#10B981' : '#F59E0B', 
                                                    fontWeight: 'bold', 
                                                    fontSize: 12 
                                                }}>
                                                    <Text>{order.status === 'delivered_confirmed' ? "✅ VERIFIED" : "⏳ PENDING"}</Text>
                                                </Text>

                                                {order.delivery_photo_url && (
                                                    <TouchableOpacity 
                                                        onPress={() => openImage(order.delivery_photo_url)}
                                                        style={styles.viewBtn}
                                                    >
                                                        <Text style={styles.viewBtnText}><Text>👁️ View Photo</Text></Text>
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        </View>
                                    ))}
                                </View>
                            );
                        })()}
                    </View>
                ) : (
                    /* 🔵 PAGE 1: STORE LIST SUMMARY */
                    <View>
                        <View style={styles.searchSection}>
                            <Text style={styles.headerTitle}><Text>Delivery History Summary</Text></Text>
                            <View style={styles.searchContainer}>
                                <Text style={{ fontSize: 16, color: '#9CA3AF' }}><Text>🔍</Text></Text>
                                <TextInput 
                                    placeholder="Search Store..." 
                                    placeholderTextColor="#9CA3AF"
                                    style={styles.searchInput}
                                    value={historySearchInput}
                                    onChangeText={setHistorySearchInput}
                                />
                            </View>
                        </View>

                        <View style={{ padding: 12 }}>
                            {groupedHistory
                                .filter((s: any) => s.store_name.toLowerCase().includes(historySearchInput.toLowerCase()))
                                .map((store: any, index) => (
                                    <TouchableOpacity 
                                        key={index} 
                                        onPress={() => setHistorySelectedStoreId(store.store_id)}
                                        style={styles.storeSummaryCard}
                                    >
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.storeName}><Text>🏪 {store.store_name}</Text></Text>
                                            <View style={{ marginTop: 6 }}>
                                                <Text style={{ color: "#4B5563", fontSize: 13 }}>
                                                    <Text>✅ Total: </Text><Text style={{ fontWeight: 'bold', color: '#10B981' }}>{store.total_delivered}</Text><Text> Bottles</Text>
                                                </Text>
                                                <Text style={{ color: "#6B7280", fontSize: 12 }}>
                                                    <Text>🧾 Completed: </Text><Text>{store.orders.length}</Text><Text> Orders</Text>
                                                </Text>
                                            </View>
                                        </View>
                                        <Text style={{ fontSize: 20, color: '#CCC' }}><Text>➡️</Text></Text>
                                    </TouchableOpacity>
                                ))}
                        </View>
                    </View>
                )}
            </ScrollView>

            {/* 🖼️ FULL SCREEN IMAGE MODAL */}
            <Modal visible={modalVisible} transparent={true} animationType="fade" onRequestClose={() => setModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
                            <Text style={styles.closeBtnText}><Text>✕ Close Photo</Text></Text>
                        </TouchableOpacity>
                        {selectedImage && (
                            <Image source={{ uri: selectedImage }} style={styles.fullImage} resizeMode="contain" />
                        )}
                    </View>
                </View>
            </Modal>
        </View>
    );
};
// --- QR Scan Screen ---
type QRScanScreenProps = {
    route: RouteProp<DeliveryPartnerTabParamList, 'Scan'>;
};

// Define Bottle Types
interface CollectableBottle extends AssignedBottle {
    store_id: number;
    store_name?: string;
}

interface WarehouseBottle extends AssignedBottle {
    warehouse_id?: number;
    warehouse_name?: string;
}

const QRScanScreen: React.FC<QRScanScreenProps> = ({ route }) => {
    const { accessToken } = route.params;
    const isFocused = useIsFocused();
    const [scanStatus, setScanStatus] = useState('Select an action');
    const [isLoading, setIsLoading] = useState(false);

    type ScanMode =
        | 'idle'
        | 'delivery_list'
        | 'delivery_confirm_assign'
        | 'delivery_select_store'
        | 'collection_list'
        | 'collection_confirm'
        | 'warehouse_list'
        | 'warehouse_confirm';

    const [scanMode, setScanMode] = useState<ScanMode>('idle');
    const [assignedBottles, setAssignedBottles] = useState<AssignedBottle[]>([]);
    const [collectableBottles, setCollectableBottles] = useState<CollectableBottle[]>([]);
    const [warehouseBottles, setWarehouseBottles] = useState<WarehouseBottle[]>([]);
    const [selectedBottle, setSelectedBottle] = useState<AssignedBottle | CollectableBottle | WarehouseBottle | null>(null);
    const [storesForAssignment, setStoresForAssignment] = useState<{ id: number; store_name: string }[]>([]);
    
    const [searchInput, setSearchInput] = useState('');

    useEffect(() => {
        if (!isFocused || !accessToken) resetToIdle('Select an action');
    }, [isFocused, accessToken]);

    const resetToIdle = (message = 'Select an action') => {
        setIsLoading(false);
        setScanMode('idle');
        setAssignedBottles([]);
        setCollectableBottles([]);
        setWarehouseBottles([]);
        setSelectedBottle(null);
        setSearchInput('');
        setStoresForAssignment([]);
        setScanStatus(message);
    };

    // ========= FETCH FUNCTIONS =========
    const fetchAssignedBottles = async () => {
        if (!accessToken) return resetToIdle('Login required.');
        try {
            setIsLoading(true);
            setScanStatus('Loading assigned bottles...');
            const res = await axios.get(`${API_BASE_URL}/bottle/my-bottles`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (Array.isArray(res.data) && res.data.length > 0) {
                setAssignedBottles(res.data);
                setScanMode('delivery_list');
                setScanStatus('Select bottle to assign.');
            } else {
                Alert.alert('Info', 'No bottles assigned.');
                resetToIdle('No bottles assigned.');
            }
        } catch (err) {
            console.error(err);
            Alert.alert('Error', 'Could not load bottles.');
            resetToIdle('Error loading bottles.');
        } finally {
            setIsLoading(false);
        }
    };

   

    const fetchCollectableBottles = async () => {
        if (!accessToken) return resetToIdle('Login required.');
        try {
            setIsLoading(true);
            setScanStatus('Loading bottles to collect...');
            const res = await axios.get(`${API_BASE_URL}/bottle/collectable/me`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (Array.isArray(res.data) && res.data.length > 0) {
                setCollectableBottles(res.data);
                setScanMode('collection_list');
                setScanStatus('Select bottle to collect.');
            } else {
                Alert.alert('Info', 'No bottles available to collect.');
                resetToIdle('No bottles found.');
            }
        } catch (err) {
            console.error(err);
            Alert.alert('Error', 'Could not load collectable bottles.');
            resetToIdle('Error loading.');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchWarehouseBottles = async () => {
        if (!accessToken) return resetToIdle('Login required.');
        try {
            setIsLoading(true);
            setScanStatus('Loading warehouse bottles...');
            const res = await axios.get(`${API_BASE_URL}/bottle/warehouse/me`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (Array.isArray(res.data) && res.data.length > 0) {
                setWarehouseBottles(res.data);
                setScanMode('warehouse_list');
                setScanStatus('Select bottle to submit.');
            } else {
                Alert.alert('Info', 'No bottles ready for submission.');
                resetToIdle('No bottles to submit.');
            }
        } catch (err) {
            console.error(err);
            Alert.alert('Error', 'Could not load warehouse bottles.');
            resetToIdle('Error loading.');
        } finally {
            setIsLoading(false);
        }
    };

    // ========= ACTION HANDLERS =========
    const handleSelectBottleForDelivery = (b: AssignedBottle) => {
        setSelectedBottle(b);
        setScanMode('delivery_confirm_assign');
        setScanStatus(`Assign ${b.qr_code} to store.`);
    };

    const fetchStoresForAssignment = async () => {
    if (!accessToken) return;

    try {
        setIsLoading(true);

        const url = await getOrdersUrl();

        const res = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const pending = res.data.filter(
            (o: any) =>
                o.status !== 'delivered_confirmed' &&
                o.status !== 'delivered_pending_confirmation' &&
                o.store
        );

        const storesMap = new Map<number, { id: number; store_name: string }>();

        pending.forEach((o: any) => {
            if (o.store?.id) {
                storesMap.set(o.store.id, {
                    id: o.store.id,
                    store_name: o.store.store_name,
                });
            }
        });

        setStoresForAssignment(Array.from(storesMap.values()));
        setScanMode('delivery_select_store');

    } catch (err) {
        console.error(err);
        Alert.alert('Error', 'Could not load stores.');
        setScanMode('delivery_confirm_assign');
    } finally {
        setIsLoading(false);
    }
};


    const handleAssignToStore = async (storeId: number) => {
        if (!selectedBottle || !accessToken) return;
        setIsLoading(true);
        try {
            await handleDeliverToStore(selectedBottle.qr_code, storeId, 0); // if order_id not available, pass 0

            resetToIdle('Assignment complete.');
        } catch (err) {
            console.error(err);
            Alert.alert('Error', 'Assignment failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectBottleForCollection = (b: CollectableBottle) => {
        setSelectedBottle(b);
        setScanMode('collection_confirm');
        setScanStatus(`Confirm collection for ${b.qr_code}`);
    };

    const handleConfirmCollection = async () => {
        if (!selectedBottle || !accessToken) return;
        setIsLoading(true);
        try {
            await handleCollectFromStore(selectedBottle.qr_code, (selectedBottle as CollectableBottle).store_id);

            Alert.alert('Success', `Bottle ${selectedBottle.qr_code} collected.`);
            resetToIdle('Collection complete.');
        } catch (err) {
            Alert.alert('Error', 'Failed to collect.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectBottleForWarehouse = (b: WarehouseBottle) => {
        setSelectedBottle(b);
        setScanMode('warehouse_confirm');
        setScanStatus(`Submit ${b.qr_code} to warehouse.`);
    };

    const handleConfirmWarehouseSubmit = async () => {
        if (!selectedBottle || !accessToken) return;
        setIsLoading(true);
        try {
            await axios.post(`${API_BASE_URL}/bottle/collect/warehouse`, {
                qr_code: selectedBottle.qr_code,
            }, { headers: { Authorization: `Bearer ${accessToken}` } });
            Alert.alert('Success', `Bottle ${selectedBottle.qr_code} submitted.`);
            resetToIdle('Submission complete.');
        } catch (err) {
            Alert.alert('Error', 'Failed to submit.');
        } finally {
            setIsLoading(false);
        }
    };


    // --- Deliver Bottle (assign QR to Store + link Order) ---
const handleDeliverToStore = async (qrCode: string, storeId: number, orderId: number) => {
  try {
    const token = accessToken;
    if (!token) return Alert.alert("Error", "Session expired");

    const response = await axios.post(
      `${API_BASE_URL}/bottle/assign/store`,
      { qr_code: qrCode, to_location_id: storeId, order_id: orderId },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    Alert.alert("✅ Success", response.data.message);
  } catch (error: any) {
    console.error("Deliver Error:", error.response?.data || error.message);
    Alert.alert("Error", error.response?.data?.detail || "Failed to deliver bottle");
  }
};

// --- Collect Bottle from Store (make QR reusable) ---
const handleCollectFromStore = async (qrCode: string, storeId: number) => {
  try {
    const token = accessToken;
    if (!token) return Alert.alert("Error", "Session expired");

    const response = await axios.post(
      `${API_BASE_URL}/bottle/collect/store`,
      { qr_code: qrCode, to_location_id: storeId },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    Alert.alert("♻️ Reused", response.data.message);
  } catch (error: any) {
    console.error("Collect Error:", error.response?.data || error.message);
    Alert.alert("Error", error.response?.data?.detail || "Failed to collect bottle");
  }
};


    // ========= FILTERS =========
    const displayedAssignedBottles = assignedBottles.filter(b => b.qr_code.toLowerCase().includes(searchInput.toLowerCase()));
    const displayedCollectableBottles = collectableBottles.filter(b => b.qr_code.toLowerCase().includes(searchInput.toLowerCase()));
    const displayedWarehouseBottles = warehouseBottles.filter(b => b.qr_code.toLowerCase().includes(searchInput.toLowerCase()));
    

    const handleQRScan = async (code: string) => {
        if (!code) return Alert.alert("Error", "Please scan or enter a QR code.");

        setIsLoading(true); // 🔽 Show loading spinner
        setScanStatus(`Checking status for ${code}...`);

        try {
            const res = await axios.get(`${API_BASE_URL}/bottle/status/${code}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            const bottle = res.data; // e.g., { qr_code: "...", status: "AT_STORE", ... }

            // 🔽 Set this bottle as the one we are working with
            setSelectedBottle(bottle);

            // 🔽 This is the new logic to show options based on status
            switch (bottle.status) {
                case "CREATED":
                case "REUSABLE":
                    // Bottle is new or reusable, ready to be assigned to a store
                    setScanMode('delivery_confirm_assign');
                    setScanStatus(`Assign ${bottle.qr_code} to store.`);
                    break;

                case "AT_STORE":
                    // Bottle is at a store, ready to be collected
                    setScanMode('collection_confirm');
                    setScanStatus(`Confirm collection for ${bottle.qr_code}`);
                       break;

                case "WITH_DELIVERY":
                    // Bottle is with you, ready to submit to warehouse
                    setScanMode('warehouse_confirm');
                    setScanStatus(`Submit ${bottle.qr_code} to warehouse.`);
                    break;

                default:
                    // e.g., "ASSIGNED_TO_STORE", "IN_WAREHOUSE"
                    Alert.alert(
                        "Info",
                        `Bottle is in '${bottle.status}' state and has no available actions.`
                    );
                    resetToIdle(); // Go back to the main scan screen
            }
        } catch (error) {
            Alert.alert("Error", "Invalid or unavailable QR code.");
            resetToIdle(); // Go back to the main scan screen
        } finally {
            setIsLoading(false); // 🔽 Stop loading spinner
        }
    };

const [isCameraOpen, setIsCameraOpen] = useState(false);






    // ========= RENDER =========
    const renderContent = () => {
  

  // 🔹 2. Regular scan flow modes
  switch (scanMode) {
    case "delivery_list":
      return (
        <>
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            value={searchInput}
            onChangeText={setSearchInput}
          />
          <ScrollView style={{ maxHeight: 250 }}>
            {displayedAssignedBottles.map((b) => (
              <TouchableOpacity
                key={b.qr_code}
                style={styles.assignedBottleItem}
                onPress={() => handleSelectBottleForDelivery(b)}
              >
                <Text style={styles.bottleQrText}>{b.qr_code}</Text>
                <Text style={styles.bottleStatusText}>Status: {b.status}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={() => resetToIdle()} style={styles.resetButton}>
            <Text style={styles.resetButtonText}>Back</Text>
          </TouchableOpacity>
        </>
      );

    case "delivery_confirm_assign":
      return (
        <View style={styles.actionButtonsContainer}>
          <Text style={styles.selectedBottleText}>{selectedBottle?.qr_code}</Text>
          <TouchableOpacity
            onPress={fetchStoresForAssignment}
            style={[styles.actionButton, styles.assignButton]}
          >
            <Text style={styles.actionButtonText}>Select Store</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setScanMode("delivery_list")}
            style={styles.resetButton}
          >
            <Text style={styles.resetButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      );

    case "delivery_select_store":
      return (
        <View style={styles.storeListContainer}>
          <Text style={styles.storeListTitle}>Choose Store</Text>
          <ScrollView>
            {storesForAssignment.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={styles.storeListItem}
                onPress={() => handleAssignToStore(s.id)}
              >
                <Text style={styles.storeListItemText}>{s.store_name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            onPress={() => setScanMode("delivery_confirm_assign")}
            style={styles.resetButton}
          >
            <Text style={styles.resetButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      );

    case "collection_list":
      return (
        <>
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            value={searchInput}
            onChangeText={setSearchInput}
          />
          <ScrollView style={{ maxHeight: 250 }}>
            {displayedCollectableBottles.map((b) => (
              <TouchableOpacity
                key={b.qr_code}
                style={styles.assignedBottleItem}
                onPress={() => handleSelectBottleForCollection(b)}
              >
                <Text style={styles.bottleQrText}>{b.qr_code}</Text>
                <Text style={styles.bottleStatusText}>{b.store_name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={() => resetToIdle()} style={styles.resetButton}>
            <Text style={styles.resetButtonText}>Back</Text>
          </TouchableOpacity>
        </>
      );

    case "collection_confirm":
      return (
        <View style={styles.actionButtonsContainer}>
          <Text style={styles.selectedBottleText}>{selectedBottle?.qr_code}</Text>
          <Text style={{ color: "#22C55E", marginVertical: 8, textAlign: "center" }}>
            ♻️ Ready for reuse after warehouse submission
          </Text>
          <TouchableOpacity
            onPress={handleConfirmCollection}
            style={[styles.actionButton, styles.collectButton]}
          >
            <Text style={styles.actionButtonText}>Confirm Collection</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setScanMode("collection_list")}
            style={styles.resetButton}
          >
            <Text style={styles.resetButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      );

    case "warehouse_list":
      return (
        <>
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            value={searchInput}
            onChangeText={setSearchInput}
          />
          <ScrollView style={{ maxHeight: 250 }}>
            {displayedWarehouseBottles.map((b) => (
              <TouchableOpacity
                key={b.qr_code}
                style={styles.assignedBottleItem}
                onPress={() => handleSelectBottleForWarehouse(b)}
              >
                <Text style={styles.bottleQrText}>{b.qr_code}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={() => resetToIdle()} style={styles.resetButton}>
            <Text style={styles.resetButtonText}>Back</Text>
          </TouchableOpacity>
        </>
      );

    case "warehouse_confirm":
      return (
        <View style={styles.actionButtonsContainer}>
          <Text style={styles.selectedBottleText}>{selectedBottle?.qr_code}</Text>
          <Text style={{ color: "#22C55E", marginVertical: 8, textAlign: "center" }}>
            ♻️ Bottle will become reusable after submission
          </Text>
          <TouchableOpacity
            onPress={handleConfirmWarehouseSubmit}
            style={[styles.actionButton, styles.warehouseButton]}
          >
            <Text style={styles.actionButtonText}>Confirm Submit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setScanMode("warehouse_list")}
            style={styles.resetButton}
          >
            <Text style={styles.resetButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      );

    // 🔹 3. Default dashboard screen
    
        // 🔹 3. Default dashboard screen
      // 🔹 3. Default dashboard screen
      default:
          return (
              <View style={styles.scanButtonsContainer}>

                  {/* --- 1. Scan-First Options --- */}
                  <TouchableOpacity
                      style={[styles.scanButton, { backgroundColor: "#2563EB" }]}
                      onPress={async () => {
                          const granted = await requestCameraPermission();
                          if (granted) setIsCameraOpen(true);
                      }}
                  >
                      <Text style={styles.scanButtonText}>📷 Scan with Camera</Text>
                  </TouchableOpacity>

                  {/* --- 2. List-Based Options (Previous Flow) --- */}
                  <Text style={{ color: '#6b7280', marginVertical: 20, fontWeight: 'bold' }}>
                      -- OR SELECT FROM LISTS --
                  </Text>

                  <TouchableOpacity
                      onPress={fetchAssignedBottles}
                      style={[styles.scanButton, styles.scanAssignButton]}
                  >
                      <Text style={styles.scanButtonText}>Deliver Assigned Bottle</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                      onPress={fetchCollectableBottles}
                      style={[styles.scanButton, styles.scanCollectButton]}
                  >
                      <Text style={styles.scanButtonText}>Collect Bottle from Store</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                      onPress={fetchWarehouseBottles}
                      style={[styles.scanButton, styles.warehouseButton]}
                  >
                      <Text style={styles.scanButtonText}>Submit to Warehouse</Text>
                  </TouchableOpacity>

              </View>
          );
  }
};



    // ========= MAIN RETURN =========
    return (
        <ScrollView contentContainerStyle={styles.scrollViewContent}>
            <View style={styles.qrScanView}>
                <Text style={styles.qrScanTitle}>Manage & Scan Bottles</Text>
                {renderContent()}
                {!isLoading && <Text style={styles.scanStatusText}>{scanStatus}</Text>}
            </View>
        </ScrollView>
    );
};


// --- (MODIFIED COMPONENT: ComplaintsScreen) ---
type ComplaintsScreenProps = {
    route: RouteProp<DeliveryPartnerTabParamList, 'Complaints'>;
};

const ComplaintsScreen: React.FC<ComplaintsScreenProps> = ({ route }) => {
    const { accessToken } = route.params;
    const isFocused = useIsFocused();
    const [isLoading, setIsLoading] = useState(true);
    const [myComplaints, setMyComplaints] = useState<MyComplaint[]>([]);
    const [isRaiseComplaintModalVisible, setIsRaiseComplaintModalVisible] = useState(false);
    const [complaintSubject, setComplaintSubject] = useState('');
    const [complaintDescription, setComplaintDescription] = useState('');
    const [availableStores, setAvailableStores] = useState<StoreDropdownItem[]>([]);
    const [selectedStore, setSelectedStore] = useState<StoreDropdownItem | null>(null);
    const [showStoreDropdown, setShowStoreDropdown] = useState(false);
    // --- (NEW STATE) ---
    const [complaintPhoto, setComplaintPhoto] = useState<Asset | null>(null); 
    // --- (END NEW STATE) ---

    const fetchMyComplaints = async () => {
        setIsLoading(true);
        try {
            if (!accessToken) throw new Error('Access token is missing.');

            const response = await axios.get(`${API_BASE_URL}/complaints/complaints/me`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            setMyComplaints(response.data);
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                 setMyComplaints([]); 
                 console.log("No complaints found for user.");
            } else {
                console.error('Failed to fetch my complaints:', error);
                Alert.alert('Error', 'Failed to load your complaints.');
                setMyComplaints([]);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const fetchStores = async () => {
        try {
            if (!accessToken) return;

            const response = await axios.get(`${API_BASE_URL}/partners/partners/list`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            const allStores: StoreDropdownItem[] = [];

            response.data.forEach((partner: PartnerAPIResponse) => {
                if (partner.stores && Array.isArray(partner.stores)) {
                    partner.stores.forEach((store: StoreAPIResponse) => {
                        allStores.push({
                            id: store.id,
                            store_name: store.store_name,
                            owner_id: partner.id,
                        });
                    });
                }
            });

            setAvailableStores(allStores);
        } catch (error) {
            console.error('Failed to fetch stores:', error);
            Alert.alert('Error', 'Failed to load store list.');
        }
    };

    useEffect(() => {
        if (isFocused && accessToken) {
            fetchMyComplaints();
            fetchStores();
        }
    }, [isFocused, accessToken]);

     // --- (NEW FUNCTION: requestCameraPermission) ---
     
    // --- (END NEW FUNCTION) ---

    // --- (NEW FUNCTION: handleCaptureComplaintPhoto) ---
    const handleCaptureComplaintPhoto = async () => {
        const hasPermission = await requestCameraPermission();
        if (!hasPermission) {
            Alert.alert("Permission Error", "Camera permission is required to take a photo.");
            return;
        }

        try {
            const result: ImagePickerResponse = await launchCamera({
                mediaType: 'photo',
                quality: 0.7,
                saveToPhotos: false, 
            });

            if (result.didCancel) {
                return; // User cancelled
            }

            if (result.errorCode || !result.assets || result.assets.length === 0) {
                Alert.alert("Error", "Could not capture photo. Please try again.");
                console.error("Camera Error: ", result.errorMessage);
                return;
            }

            setComplaintPhoto(result.assets[0]); // Store the captured photo asset

        } catch (error) {
            console.error("Failed to launch camera:", error);
            Alert.alert("Camera Error", "Could not open the camera.");
        }
    };
    // --- (END NEW FUNCTION) ---


    // --- (MODIFIED FUNCTION: submitComplaint) ---
    const submitComplaint = async (raiseTo: 'superadmin' | 'store') => {
        if (!complaintSubject || !complaintDescription) {
            Alert.alert('Error', 'Please fill in all complaint details.');
            return;
        }

        let assignedToId;
        if (raiseTo === 'superadmin') {
            assignedToId = SUPERADMIN_ID;
        } else {
            if (!selectedStore || !selectedStore.owner_id) {
                // Modified: Allow raising to admin if store not selected for store complaint
                Alert.alert('Info', 'No store selected. Raising complaint to Admin.');
                raiseTo = 'superadmin'; 
                assignedToId = SUPERADMIN_ID;
            } else {
                 assignedToId = selectedStore.owner_id;
            }
        }


        setIsLoading(true);
        try {
            if (!accessToken) throw new Error('Access token is missing.');

            // --- Use FormData to include photo ---
            const formData = new FormData();
            formData.append('subject', complaintSubject);
            formData.append('description', complaintDescription);
            formData.append('assigned_to_role', raiseTo);
            formData.append('assigned_to_id', String(assignedToId)); 

            // Append photo if it exists
            if (complaintPhoto && complaintPhoto.uri) {
                formData.append('photo', {
                    uri: complaintPhoto.uri,
                    type: complaintPhoto.type || 'image/jpeg', 
                    name: complaintPhoto.fileName || `complaint_${Date.now()}.jpg`,
                });
            }
            // --- End FormData ---

            // --- Axios Call with FormData ---
            const response = await axios.post(
                `${API_BASE_URL}/complaints/complaints/submit`, 
                formData, // Send formData
                { 
                    headers: { 
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'multipart/form-data', // Set correct header
                    } 
                }
            );
            // --- End Axios Call ---

            Alert.alert('Success', 'Complaint submitted successfully!');
            setIsRaiseComplaintModalVisible(false);
            // Reset state including the photo
            setComplaintSubject('');
            setComplaintDescription('');
            setSelectedStore(null);
            setComplaintPhoto(null); // <-- Reset photo state
            fetchMyComplaints(); // Refresh list

        } catch (error) {
            console.error('Complaint submission failed:', error);
            let errorMessage = 'An unknown error occurred.';
            if (axios.isAxiosError(error)) {
                errorMessage = error.response?.data?.detail || error.message;
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }
             Alert.alert('Error', `Failed to submit complaint. ${errorMessage}`);
        } finally {
            setIsLoading(false);
        }
    };
    // --- (END MODIFIED FUNCTION) ---
    
    // --- (NEW FUNCTION: closeModal) ---
    // Also reset photo on modal close
     const closeModal = () => {
         setIsRaiseComplaintModalVisible(false);
         setComplaintSubject('');
         setComplaintDescription('');
         setSelectedStore(null);
         setComplaintPhoto(null); // <-- Reset photo state on close
     };
    // --- (END NEW FUNCTION) ---


    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView style={styles.scrollViewContent}>
                <View style={styles.complaintsContainer}>
                    <View style={styles.complaintsHeader}>
                        <Text style={styles.complaintsTitle}>My Complaints</Text>
                        <TouchableOpacity style={styles.raiseButton} onPress={() => setIsRaiseComplaintModalVisible(true)}>
                            <Text style={styles.raiseButtonIcon}>➕</Text>
                            <Text style={styles.raiseButtonText}>Raise Complaint</Text>
                        </TouchableOpacity>
                    </View>

                    {isLoading ? (
                        <ActivityIndicator size="large" color="#3b2f5b" style={{ marginTop: 20 }} />
                    ) : myComplaints.length > 0 ? (
                        myComplaints.map((complaint) => (
                            <View key={complaint.id} style={styles.complaintCard}>
                                <View style={styles.complaintHeader}>
                                    <Text style={styles.complaintSubject}>{complaint.subject}</Text>
                                    <Text style={[styles.complaintStatus, complaint.status === 'resolved' ? styles.statusResolved : styles.statusPending]}>
                                        {complaint.status}
                                    </Text>
                                </View>
                                <Text style={styles.complaintDescription}>{complaint.description}</Text>
                                <Text style={styles.complaintMeta}>Raised to: {complaint.assigned_to?.full_name}</Text>
                                <Text style={styles.complaintMeta}>Date: {new Date(complaint.created_at).toLocaleDateString()}</Text>
                                {/* --- (NEW: Display Complaint Photo if URL exists) --- */}
                                {complaint.photo_url && (
                                     <Image 
                                         source={{ uri: `${API_BASE_URL}/${complaint.photo_url}` }} 
                                         style={styles.complaintImage}
                                         resizeMode="contain" 
                                     />
                                )}
                                {/* --- (END NEW) --- */}
                                {complaint.solution && (
                                    <View style={styles.solutionContainer}>
                                        <Text style={styles.solutionTitle}>Solution:</Text>
                                        <Text style={styles.solutionText}>{complaint.solution}</Text>
                                    </View>
                                )}
                            </View>
                        ))
                    ) : (
                        <Text style={styles.noComplaintsText}>No complaints raised yet.</Text>
                    )}
                </View>
            </ScrollView>

            {/* Modal for raising a new complaint */}
            {/* --- (MODIFIED: Modal onRequestClose) --- */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={isRaiseComplaintModalVisible}
                onRequestClose={closeModal} // <-- Use closeModal function
            >
                <View style={styles.modalCenteredView}>
                    <ScrollView contentContainerStyle={styles.modalScrollView}> 
                        <View style={styles.modalContent}>
                            <Text style={styles.modalTitle}>Raise a New Complaint</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="Subject"
                                placeholderTextColor="#9ca3af"
                                value={complaintSubject}
                                onChangeText={setComplaintSubject}
                            />
                            <TextInput
                                style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
                                placeholder="Description"
                                placeholderTextColor="#9ca3af"
                                multiline
                                numberOfLines={4}
                                value={complaintDescription}
                                onChangeText={setComplaintDescription}
                            />

                            <TouchableOpacity style={styles.dropdownButton} onPress={() => setShowStoreDropdown(!showStoreDropdown)}>
                                <Text style={styles.dropdownButtonText}>
                                    {selectedStore ? selectedStore.store_name : 'Select Store (Optional)'}
                                </Text>
                                <Text style={styles.dropdownButtonIcon}>{showStoreDropdown ? '🔼' : '🔽'}</Text>
                            </TouchableOpacity>

                            {showStoreDropdown && (
                                <View style={styles.dropdownList}>
                                    <ScrollView style={{ maxHeight: 150 }}>
                                        <TouchableOpacity style={styles.dropdownItem} onPress={() => { setSelectedStore(null); setShowStoreDropdown(false); }}>
                                            <Text style={styles.dropdownItemText}>- None -</Text>
                                        </TouchableOpacity>
                                        {availableStores.map(store => (
                                            <TouchableOpacity
                                                key={store.id}
                                                style={styles.dropdownItem}
                                                onPress={() => {
                                                    setSelectedStore(store);
                                                    setShowStoreDropdown(false);
                                                }}
                                            >
                                                <Text style={styles.dropdownItemText}>{store.store_name}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}

                             {/* --- (NEW: Photo Capture Button & Display) --- */}
                            <TouchableOpacity style={styles.captureButton} onPress={handleCaptureComplaintPhoto}>
                                <Text style={styles.captureButtonText}>📷 Attach Photo</Text>
                            </TouchableOpacity>
                            {complaintPhoto && (
                                <View style={styles.photoPreviewContainer}>
                                     <Image source={{ uri: complaintPhoto.uri }} style={styles.photoPreview} />
                                     <Text style={styles.photoAttachedText}>
                                         {complaintPhoto.fileName || 'photo.jpg'}
                                     </Text>
                                </View>
                            )}
                             {/* --- (END NEW) --- */}


                            {/* Modal Action Buttons */}
                            <View style={styles.modalActionButtons}>
                                {/* --- (MODIFIED: Cancel Button onPress) --- */}
                                <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={closeModal}>
                                    <Text style={styles.modalButtonText}>Cancel</Text>
                                </TouchableOpacity>
                                {/* --- (END MODIFIED) --- */}
                                <TouchableOpacity style={[styles.modalButton, styles.modalButtonSuperAdmin]} onPress={() => submitComplaint('superadmin')}>
                                    <Text style={styles.modalButtonText}>Raise to Admin</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.modalButton, styles.modalButtonStore]} onPress={() => submitComplaint('store')}>
                                    <Text style={styles.modalButtonText}>Raise to Store</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </ScrollView>
                </View>
            </Modal>
        </SafeAreaView>
    );
};
// --- (END MODIFIED COMPONENT) ---


// --- Main Dashboard ---
// --- Main Dashboard Container with Role-Based Profiling ---
const DeliveryPartnerDashboard: React.FC = () => {
    const navigation = useNavigation<any>();

   const handleLogout = () => {
  Alert.alert(
    "Logout",
    "Do you want to logout?",
    [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Yes",
        onPress: async () => {
          try {
            await AsyncStorage.multiRemove(['auth_token', 'user_role']);

            navigation.reset({
              index: 0,
              routes: [{ name: 'Login' }],
            });

          } catch (error) {
            console.log('Logout error:', error);
          }
        },
      },
    ],
    { cancelable: true }
  );
};
    const [partner, setPartner] = useState<UserProfile>({
        id: '',
        name: 'Loading Profile...',
        role: 'delivery_partner',
        area: '',
        status: 'Connecting...',
    });

    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [isLoadingToken, setIsLoadingToken] = useState(true);
    const [isLoadingProfile, setIsLoadingProfile] = useState(true);

    useEffect(() => {
        const fetchAuthData = async () => {
            setIsLoadingToken(true);
            try {
                const token = await AsyncStorage.getItem('auth_token');
                if (token) {
                    setAccessToken(token);
                } else {
                    setIsLoadingProfile(false);
                }
            } catch (e) {
                console.error('Auth fetch error', e);
                setIsLoadingProfile(false);
            } finally {
                setIsLoadingToken(false);
            }
        };
        fetchAuthData();
    }, []);

    useEffect(() => {
        if (!accessToken || isLoadingToken) return;

        const fetchPartnerInfo = async () => {
            setIsLoadingProfile(true);
            try {
                const profileUrl = await getProfileUrl();
                const role = await AsyncStorage.getItem('user_role');

                const response = await axios.get(profileUrl, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    validateStatus: s => (s >= 200 && s < 300) || s === 404
                });

                if (response.status === 404) {
                    setPartner({
                        id: '',
                        name: role === 'delivery_manager' ? 'Area Manager' : 'Delivery Partner',
                        role: (role as any) || 'delivery_partner',
                        area: '',
                        status: 'Active'
                    });
                } else {
                    setPartner({
                        id: response.data.id?.toString() || '',
                        name: response.data.full_name || 'User',
                        role: (role as any) || 'delivery_partner',
                        area: response.data.city || '',
                        status: response.data.status || 'Active'
                    });
                }
            } catch (e) {
                console.error('Profile fetch failed', e);
                setPartner(p => ({ ...p, status: 'Offline' }));
            } finally {
                setIsLoadingProfile(false);
            }
        };

        fetchPartnerInfo();
    }, [accessToken, isLoadingToken]);

    if (isLoadingToken || isLoadingProfile) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#3b2f5b" />
                <Text style={styles.loadingText}>
                    {isLoadingToken ? 'Checking login...' : 'Syncing Area Profile...'}
                </Text>
            </View>
        );
    }

    if (!accessToken) {
        return (
            <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Please log in.</Text>
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="light-content" backgroundColor="#3b2f5b" />

            <View style={styles.container}>
                {/* 🔥 UPDATED MODERN HEADER */}
                <View
                    style={[
                        styles.header,
                        {
                            zIndex: 10, // 1000 ki zaroorat nahi hai, elevation handles it on Android
                            elevation: 8,
                            position: 'relative',
                            paddingBottom: 20, // Neeche thoda gap taaki tab bar se door rahe
                        },
                    ]}
                >
                    <View
                        style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: Platform.OS === 'android' ? 10 : 0,
                        }}
                    >
                        <View style={{ flex: 1, marginRight: 10 }}> {/* flex: 1 ensures name doesn't push the button out */}
                            <Text
                                numberOfLines={1}
                                style={{ fontSize: 18, fontWeight: '700', color: '#1E293B' }}
                            >
                                Hi, {partner.name} 👋
                            </Text>
                            <Text style={{ color: '#6B7280', fontSize: 13 }}>
                                Manager Dashboard
                            </Text>
                        </View>

                        <TouchableOpacity
                            onPress={handleLogout}
                            activeOpacity={0.8}
                            // hitSlop se button ke charo taraf 15px extra touch area mil jayega
                            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                            style={{
                                backgroundColor: '#EF4444',
                                paddingHorizontal: 16,
                                paddingVertical: 10,
                                borderRadius: 12,
                                elevation: 5,
                                shadowColor: '#EF4444',
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: 0.3,
                                shadowRadius: 4,
                                minWidth: 80, // Minimum width for better visibility
                                alignItems: 'center',
                            }}
                        >
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                                Logout
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* 🔥 UPDATED TAB NAVIGATOR */}
                {/* 🔥 UPDATED TAB NAVIGATOR (FULL BLOCK) */}
                <Tab.Navigator
                    screenOptions={({ route }) => ({
                        headerShown: false,

                        // ✅ COLORS
                        tabBarActiveTintColor: '#2563EB',
                        tabBarInactiveTintColor: '#6B7280',

                        // ✅ TAB BAR STYLE
                        tabBarStyle: {
                            backgroundColor: '#ffffff',
                            height: 70,
                            paddingBottom: 10,
                            paddingTop: 6,
                            borderTopWidth: 0,
                            elevation: 10,
                            shadowColor: '#000',
                            shadowOpacity: 0.05,
                            shadowRadius: 10,
                        },

                        // ✅ LABEL
                        tabBarLabelStyle: {
                            fontSize: 12,
                            fontWeight: '600',
                        },

                        // 🔥 EMOJI ICONS (NO LIBRARY)
                        tabBarIcon: ({ focused }) => {
                            let icon = "⬜";

                            if (route.name === "Dashboard") icon = "🏠";
                            else if (route.name === "Pending") icon = "📦";
                            else if (route.name === "Delivered") icon = "🕒";
                            else if (route.name === "Scan") icon = "📷";
                            else if (route.name === "Complaints") icon = "⚠️";

                            return (
                                <View
                                    style={{
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginTop: 4,
                                    }}
                                >
                                    <Text
                                        style={{
                                            fontSize: 18,
                                            opacity: focused ? 1 : 0.5, // 👈 active/inactive effect
                                        }}
                                    >
                                        {icon}
                                    </Text>
                                </View>
                            );
                        },
                    })}
                >
                    <Tab.Screen name="Dashboard">
                        {props => (
                            <DashboardScreen {...props} accessToken={accessToken} />
                        )}
                    </Tab.Screen>

                    <Tab.Screen
                        name="MyStores"
                        component={MyStoresScreen}
                        initialParams={{ accessToken }}
                        options={{
                            tabBarLabel: 'My Stores',
                            tabBarIcon: () => <Text>🏬</Text>,
                        }}
                    />

                    <Tab.Screen
                        name="Pending"
                        component={PendingOrdersScreen}
                        initialParams={{ accessToken }}
                        options={{
                            tabBarLabel:
                                partner.role === 'delivery_manager'
                                    ? 'Area Queue'
                                    : 'My Orders',
                        }}
                    />

                    <Tab.Screen
                        name="Delivered"
                        component={DeliveredOrdersScreen}
                        initialParams={{ accessToken }}
                        options={{ tabBarLabel: 'History' }}
                    />

                    {partner.role === 'delivery_partner' && (
                        <Tab.Screen
                            name="Scan"
                            component={QRScanScreen}
                            initialParams={{ accessToken }}
                        />
                    )}

                    <Tab.Screen
                        name="Complaints"
                        component={ComplaintsScreen}
                        initialParams={{ accessToken }}
                    />
                </Tab.Navigator>
            </View>
        </SafeAreaView>
    );
};


// --- Styles ---
const styles = StyleSheet.create({
    // --- 1. BASE LAYOUT & LOADING ---
    safeArea: {
        flex: 1,
        backgroundColor: '#3b2f5b',
    },
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    scrollViewContent: {
  backgroundColor: '#F3F4F6',
},
    mainContentWrapper: {
        paddingHorizontal: 16,
        paddingTop: 20,
        paddingBottom: 40,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
    },
    loadingText: {
        marginTop: 10,
        color: '#64748B',
        fontSize: 15,
    },

    // --- 2. HEADER STYLES (NO DOUBLE HEADER) ---
    headerPartnerStyle: {
        backgroundColor: '#3b2f5b',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'android' ? 15 : 10,
        paddingBottom: 35,
        borderBottomLeftRadius: 30,
        borderBottomRightRadius: 30,
    },
    headerGreetingText: { color: '#FFFFFF', fontSize: 22, fontWeight: 'bold' },
    headerRoleText: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 14 },
    headerIconBtn: {
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        width: 44, height: 44, borderRadius: 12,
        justifyContent: 'center', alignItems: 'center', marginRight: 10,
    },
    headerProfileCircle: {
        backgroundColor: '#FFFFFF',
        width: 44, height: 44, borderRadius: 22,
        justifyContent: 'center', alignItems: 'center',
    },
    // Fix for legacy header references
   header: {
  backgroundColor: '#ffffff',
  paddingTop: Platform.OS === 'android' ? 20 : 10, // Thoda extra space top se
  paddingBottom: 20, 
  paddingHorizontal: 16,
  borderBottomLeftRadius: 25,
  borderBottomRightRadius: 25,
  elevation: 8,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.1,
  shadowRadius: 10,
  zIndex: 99, // Zyada high zIndex ki zaroorat nahi hai, bas layout se upar rahe
},
    headerGreeting: { color: '#fff', fontSize: 18, fontWeight: '600' },
    headerSub: { color: '#cbd5e1', fontSize: 13 },
    logoutBtn: { padding: 8 },
    logoutTextNew: { color: '#fff' },
    profileCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)' },
    profileText: { fontSize: 18 },

    // --- 3. KPI CARDS ---
    sectionHeading: { fontSize: 18, fontWeight: 'bold', color: '#1E293B', marginBottom: 16 },
    modernGrid: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
},
    kpiCard: {
  backgroundColor: '#ffffff',
  borderRadius: 16,
  padding: 16,
  marginBottom: 12,
  width: '48%',
  elevation: 3,
},
    kpiCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    kpiIcon: { fontSize: 32, marginBottom: 8 },
    kpiValue: { fontSize: 24, fontWeight: '800', color: '#1E293B' },
    kpiLabel: { fontSize: 12, color: '#64748B', fontWeight: '600' },
    kpiCardDisabled: { backgroundColor: '#F1F5F9', opacity: 0.7 },
    kpiValueDisabled: { color: '#94A3B8' },
    kpiLabelDisabled: { color: '#94A3B8' },

    // --- 4. ORDER LISTS ---
    section: { padding: 5 },
    orderCardPending: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 18, marginBottom: 16, borderLeftWidth: 6, borderLeftColor: "#F59E0B", elevation: 3 },
    orderCardDelivered: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, marginBottom: 16, borderLeftWidth: 6, borderLeftColor: '#10B981', elevation: 3 },
    orderCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    orderId: { fontSize: 16, fontWeight: '700', color: '#1E293B' },
    orderText: { fontSize: 14, color: '#475569', marginBottom: 5 },
    orderCardActions: { flexDirection: 'row', marginTop: 10 },
    noOrdersText: { textAlign: 'center', color: '#94A3B8', marginTop: 20 },

    // --- 5. SCAN SYSTEM ---
    qrScanView: { flex: 1, padding: 20, alignItems: 'center' },
    qrScanTitle: { fontSize: 22, fontWeight: 'bold', color: '#3b2f5b', marginBottom: 20 },
    scanButtonsContainer: { width: '100%', marginTop: 10 },
    scanButton: { backgroundColor: '#3b2f5b', padding: 18, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
    scanButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
    scanAssignButton: { backgroundColor: '#4f46e5' },
    scanCollectButton: { backgroundColor: '#10b981' },
    scanStatusText: { marginTop: 15, fontSize: 14, color: '#64748B', textAlign: 'center' },
    actionButtonsContainer: { width: '100%', marginTop: 10 },
    actionButton: { padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
    actionButtonText: { color: '#fff', fontWeight: 'bold' },
    assignButton: { backgroundColor: '#3b82f6' },
    collectButton: { backgroundColor: '#10b981' },
    warehouseButton: { backgroundColor: '#ef4444' },
    selectedBottleText: { fontSize: 18, fontWeight: 'bold', color: '#1E293B' },
    storeListContainer: { marginTop: 10, maxHeight: 300, width: '100%' },
    storeListTitle: { fontSize: 16, fontWeight: 'bold' },
    storeListItem: { padding: 15, backgroundColor: '#fff', borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
    storeListItemText: { fontWeight: '600' },
    searchInput: { backgroundColor: '#fff', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 10 },
    assignedBottleItem: { padding: 15, backgroundColor: '#fff', borderRadius: 10, marginBottom: 10, elevation: 2 },
    bottleQrText: { fontWeight: 'bold' },
    bottleStatusText: { color: '#64748B', fontSize: 12 },
    resetButton: { padding: 12, alignItems: 'center' },
    resetButtonText: { color: '#3b2f5b', fontWeight: 'bold' },
    collectionListContainer: { marginTop: 10, padding: 10, backgroundColor: '#FEF3C7', borderRadius: 10 },
    collectionListTitle: { fontWeight: 'bold', color: '#B45309' },
    collectionListItem: { fontSize: 13 },

    // --- 6. COMPLAINTS SYSTEM (Fixed 44 Errors) ---
    complaintsContainer: { flex: 1, padding: 16 },
    complaintsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    complaintsTitle: { fontSize: 20, fontWeight: 'bold', color: '#1E293B' },
    raiseButton: { backgroundColor: '#3b82f6', padding: 10, borderRadius: 10, flexDirection: 'row' },
    raiseButtonIcon: { fontSize: 18, color: '#fff' },
    raiseButtonText: { color: '#fff', fontWeight: 'bold', marginLeft: 5 },
    complaintCard: { backgroundColor: '#fff', padding: 15, borderRadius: 15, marginBottom: 12, elevation: 3 },
    complaintHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    complaintSubject: { fontSize: 16, fontWeight: 'bold' },
    complaintStatus: { fontSize: 12, fontWeight: 'bold' },
    statusResolved: { color: '#10b981' },
    statusPending: { color: '#f59e0b' },
    complaintDescription: { fontSize: 14, color: '#475569', marginTop: 5 },
    complaintMeta: { fontSize: 12, color: '#64748B', marginTop: 5 },
    complaintImage: { width: '100%', height: 200, borderRadius: 10, marginTop: 10 },
    solutionContainer: { marginTop: 10, padding: 10, backgroundColor: '#F1F5F9', borderRadius: 10 },
    solutionTitle: { fontWeight: 'bold' },
    solutionText: { fontSize: 14 },
    noComplaintsText: { textAlign: 'center', color: '#94A3B8', marginTop: 20 },

    // --- 7. BUTTONS & INPUTS ---
    mapButton: { backgroundColor: '#3b82f6', padding: 10, borderRadius: 10, flexDirection: 'row', alignItems: 'center' },
    mapButtonText: { color: '#fff', fontWeight: 'bold', marginLeft: 5 },
    deliveredButton: { backgroundColor: '#f59e0b', padding: 10, borderRadius: 10 },
    deliveredButtonText: { color: '#fff', fontWeight: 'bold' },
    captureButton: { backgroundColor: '#E2E8F0', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 10 },
    captureButtonText: { fontWeight: '600' },
    photoPreviewContainer: { marginTop: 10, alignItems: 'center' },
    photoPreview: { width: 150, height: 150, borderRadius: 10 },
    photoAttachedText: { fontSize: 12, color: '#64748B' },
    input: { width: '100%', backgroundColor: '#F8FAFC', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12 },
    dropdownButton: { width: '100%', padding: 15, backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', flexDirection: 'row', justifyContent: 'space-between' },
    dropdownButtonText: { color: '#64748B' },
    dropdownButtonIcon: { color: '#64748B' },
    dropdownList: { width: '100%', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', marginTop: 5 },
    dropdownItem: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    dropdownItemText: { color: '#1E293B' },

    // --- 8. MODALS ---
    modalCenteredView: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
    modalScrollView: { width: '100%' },
    modalContent: { width: '90%', backgroundColor: '#fff', borderRadius: 25, padding: 25, alignSelf: 'center' },
    modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
    modalActionButtons: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
    modalButton: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center', marginHorizontal: 5 },
    modalButtonText: { color: '#fff', fontWeight: 'bold' },
    modalButtonCancel: { backgroundColor: '#64748B' },
    modalButtonSuperAdmin: { backgroundColor: '#3b2f5b' },
    modalButtonStore: { backgroundColor: '#10b981' },

    // --- 9. ACTIVITY ---
    recentActivityCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, elevation: 3 },
    activityItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    activityOrderTitle: { fontSize: 16, fontWeight: '700' },
    activitySubText: { fontSize: 13, color: '#64748B' },
    activityBtn: { backgroundColor: '#10B981', padding: 10, borderRadius: 10 },
    activityBtnText: { color: '#fff', fontWeight: 'bold' },
    backButton: { backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 15, elevation: 2, flexDirection: 'row', alignItems: 'center' },
    historyOrderCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 14, elevation: 3, borderLeftWidth: 5, borderLeftColor: '#10B981' },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    orderIdText: { fontWeight: 'bold', color: '#374151', fontSize: 15 },
    dateText: { color: '#000', fontWeight: 'bold', fontSize: 12 },
    bottleBadge: { marginTop: 12, backgroundColor: '#ECFDF5', padding: 10, borderRadius: 8, alignSelf: 'flex-start' },
    bottleText: { color: '#065F46', fontWeight: 'bold', fontSize: 14 },
    statusRow: { marginTop: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
    viewBtn: { backgroundColor: '#3B2F5B', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, elevation: 1 },
    viewBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
    
    closeBtn: { padding: 15, backgroundColor: '#1F2937', alignItems: 'center' },
    closeBtnText: { fontWeight: 'bold', color: '#fff' },
    fullImage: { width: '100%', flex: 1 },
    storeSummaryCard: { backgroundColor: "#fff", padding: 16, borderRadius: 15, marginBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 3, borderLeftWidth: 6, borderLeftColor: '#10B981' },
    storeName: { fontSize: 16, fontWeight: "bold", color: "#1F2937" },
    storeSubText: { color: "#6B7280", fontSize: 12, marginTop: 4 },
    searchSection: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
    headerTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 12, color: '#3B2F5B' },
    searchContainer: { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, alignItems: 'center', paddingHorizontal: 12 },
    
});

export default DeliveryPartnerDashboard;