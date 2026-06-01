import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    TextInput,
    Alert,
    Modal,
    ActivityIndicator,
    FlatList
} from 'react-native';
import { RouteProp } from '@react-navigation/native';
import axiosInstance from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../src/config';
import { launchImageLibrary } from 'react-native-image-picker';
import { Image } from 'react-native';

type StoreComplianceRouteProp = RouteProp<
    {
        StoreCompliance: {
            storeId: string;
            storeName: string;
            monthly: number;
            weekly: number;
            orders: number;
        };
    },
    'StoreCompliance'
>;

interface Props {
    route: StoreComplianceRouteProp;
    navigation: any;
}

const StoreComplianceScreen: React.FC<Props> = ({ route, navigation }) => {
    const {
        storeId,
        storeName,
        monthly,
        weekly,
        orders
    } = route.params;

    const getCurrentMonthYear = () => {
        return new Date().toLocaleString('en-US', {
            month: 'long',
            year: 'numeric'
        });
    };

    const [selectedMonth, setSelectedMonth] = useState(
        getCurrentMonthYear()
    );
    const [searchText, setSearchText] = useState('');
    const [weeklyCards, setWeeklyCards] = useState<any[]>([]);
    const [invoiceData, setInvoiceData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [dropdownVisible, setDropdownVisible] = useState(false);
    const [previewVisible, setPreviewVisible] = useState(false);
    const [previewImage, setPreviewImage] = useState('');
    const [kpiData, setKpiData] = useState({
        monthly: 0,
        orders: 0
    });
    

    const generateHistoricalMonths = () => {
    const months: string[] = [];

    const startDate = new Date(2026, 0, 1); // January 2026
    const currentDate = new Date();

    let tempDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
    );

    while (tempDate >= startDate) {
        months.push(
            tempDate.toLocaleString('en-US', {
                month: 'long',
                year: 'numeric'
            })
        );

        tempDate = new Date(
            tempDate.getFullYear(),
            tempDate.getMonth() - 1,
            1
        );
    }

    return months;
};

const historicalMonthsArray = generateHistoricalMonths();

    const parseSelectedTimeline = (timelineStr: string) => {
        const [monthName, yearStr] = timelineStr.split(' ');
        const monthMapping: { [key: string]: number } = {
            'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
            'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
        };
        return {
            year: parseInt(yearStr, 10) || 2026,
            month: monthMapping[monthName] || 5
        };
    };

    const fetchDocuments = async () => {
        try {
            setLoading(true);
            const token = await AsyncStorage.getItem('auth_token');
            
            const response = await axiosInstance.get(
                `https://aquatrack-prod-final.fly.dev/store-compliance/store/${storeId}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );

            const docs = response.data || [];
            const { year, month } = parseSelectedTimeline(selectedMonth);

            const filteredWeekly = docs.filter(
                (doc: any) =>
                    doc.document_type === 'water_card' &&
                    doc.month === month &&
                    doc.year === year
            );

            const filteredInvoice = docs.find(
                (doc: any) =>
                    doc.document_type === 'invoice' &&
                    doc.month === month &&
                    doc.year === year
            );

            setWeeklyCards(filteredWeekly || []);
            setInvoiceData(filteredInvoice || null);

        } catch (error) {
            console.log("Error inside compliance processing bridge:", error);
            setWeeklyCards([]);
            setInvoiceData(null);
            Alert.alert('Metrics Error', 'Failed to synchronize repository storage maps.');
        } finally {
            setLoading(false);
        }
    };

    const fetchKpiData = async () => {
    try {

        console.log('==================== KPI START ====================');

        console.log('STORE ID =>', storeId);
        console.log('SELECTED MONTH =>', selectedMonth);
        console.log('API BASE URL =>', API_BASE_URL);

        const token =
            await AsyncStorage.getItem('auth_token');

        console.log(
            'TOKEN =>',
            token ? 'FOUND' : 'NOT FOUND'
        );

        const { year, month } =
            parseSelectedTimeline(selectedMonth);

        console.log('MONTH =>', month);
        console.log('YEAR =>', year);

        const url =
            `${API_BASE_URL}/store/store/store/${storeId}/analytics`;

        console.log('FINAL URL =>', url);

        const response =
            await axiosInstance.get(
                url,
                {
                    params: {
                        month,
                        year
                    },
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );

        console.log(
            'KPI RESPONSE =>',
            JSON.stringify(response.data, null, 2)
        );

        setKpiData({
            monthly: response.data.monthly || 0,
            
            orders: response.data.orders || 0
        });

        console.log('KPI STATE UPDATED');

    } catch (error: any) {

        console.log(
            'KPI STATUS =>',
            error?.response?.status
        );

        console.log(
            'KPI DATA =>',
            error?.response?.data
        );

        console.log(
            'FULL ERROR =>',
            error
        );

        setKpiData({
            monthly: 0,
           
            orders: 0
        });
    }
};

    useEffect(() => {

        console.log(
            'KPI USE EFFECT CALLED'
        );

        fetchDocuments();
        fetchKpiData();

    }, [selectedMonth]);

    const executeDirectContextUpload = async (type: 'water_card' | 'invoice', targetedWeek?: number) => {
        try {
            const result = await launchImageLibrary({
                mediaType: 'photo',
                selectionLimit: 1
            });

            if (!result.assets || result.assets.length === 0) {
                return;
            }

            const file = result.assets[0];
            setUploading(true);

            const token = await AsyncStorage.getItem('auth_token');
            const { year, month } = parseSelectedTimeline(selectedMonth);

            const formData = new FormData();
            formData.append('store_id', storeId);
            formData.append('document_type', type);
            formData.append('year', year.toString());
            formData.append('month', month.toString());

            if (type === 'water_card' && targetedWeek !== undefined) {
                formData.append('week_number', targetedWeek.toString());
            }

            formData.append('file', {
                uri: file.uri,
                type: file.type || 'image/jpeg',
                name: file.fileName || `${type}_production_log.jpg`
            } as any);

            await axiosInstance.post(
                `${API_BASE_URL}/store-compliance/upload`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data'
                    }
                }
            );

            Alert.alert(
                'Success', 
                `${type === 'invoice' ? 'Monthly Invoice statement' : `Week ${targetedWeek} Water Card`} committed successfully.`
            );
            
            fetchDocuments();

        } catch (error) {
            console.log("Critical transmission event break:", error);
            Alert.alert('Upload Error', 'Storage transit verification handshake failed.');
        } finally {
            setUploading(false);
        }
    };

    const fetchStatusColorSchema = (isUploaded: boolean) => {
        return isUploaded ? '#10B981' : '#EF4444';
    };

    return (
        <SafeAreaView style={styles.container}>
            
            {/* HEADER DESIGN PIPELINE */}
{/* HEADER DESIGN PIPELINE */}
<View style={styles.header}>
    <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.backButtonTouch}
    >
        <Text style={styles.backButton}>←</Text>
    </TouchableOpacity>

    <View style={{ flex: 1 }}>
        <Text
            numberOfLines={1}
            style={styles.storeName}
        >
            🏪 {storeName}
        </Text>

        <Text style={styles.storeId}>
            ID Reference: {storeId}
        </Text>
    </View>
</View>

{/* MONTH DROPDOWN OUTSIDE HEADER */}
<TouchableOpacity
    activeOpacity={0.8}
    onPress={() => {
        setDropdownVisible(true);
    }}
    style={{
        marginHorizontal: 16,
        marginTop: 12,
        backgroundColor: '#F8FAFC',
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        alignItems: 'center'
    }}
>
    <Text
        style={{
            fontSize: 16,
            fontWeight: '700',
            color: '#1E293B'
        }}
    >
        {selectedMonth} ▾
    </Text>
</TouchableOpacity>

{/* KPI CARD */}
<View
    style={{
        marginHorizontal: 16,
        marginTop: 12,
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB'
    }}
>
    <View
    style={{
        flexDirection: 'row',
        justifyContent: 'space-around'
    }}
>
    <View style={{ alignItems: 'center' }}>
        <Text>📦 Monthly</Text>
        <Text
            style={{
                fontSize: 24,
                fontWeight: '700'
            }}
        >
            {kpiData.monthly}
        </Text>
    </View>

    <View style={{ alignItems: 'center' }}>
        <Text>🧾 Orders</Text>
        <Text
            style={{
                fontSize: 24,
                fontWeight: '700'
            }}
        >
            {kpiData.orders}
        </Text>
    </View>
</View>
</View>

            {/* INTEGRATED FUNCTIONAL SEARCH BAR ROW */}
            <View style={styles.searchBarWrapperRow}>
                <View style={styles.searchContainerBox}>
                    <Text style={styles.searchIconSymbol}>🔍</Text>
                    <TextInput
                        placeholder="Search active month logs..."
                        placeholderTextColor="#9CA3AF"
                        value={searchText}
                        onChangeText={setSearchText}
                        style={styles.searchInputFieldText}
                    />
                </View>
                <View style={styles.kpiControlBadgeBox}>
                    <Text style={styles.kpiControlBadgeCountText}>
                        {weeklyCards.length}/4 Cards
                    </Text>
                </View>
            </View>

            {/* PERFORMANCE ANALYSIS CONTAINER BANNER SECTION */}
            <View style={styles.performanceSummaryBannerCard}>
                <View style={styles.innerPerformanceMetricsMetricItem}>
                    <Text style={styles.metricLabelTitleText}>Monitored Status</Text>
                    <Text style={styles.metricPrimaryValueText}>
                        {invoiceData ? 'Verified Log' : 'Pending Audit'}
                    </Text>
                </View>
                <View style={styles.verticalSplitDividerLine} />
                <View style={styles.innerPerformanceMetricsMetricItem}>
                    <Text style={styles.metricLabelTitleText}>Compliance Tracker</Text>
                    <Text style={[styles.metricPrimaryValueText, { color: '#10B981' }]}>
                        {weeklyCards.length === 4 ? '100%' : `${(weeklyCards.length / 4) * 100}%`}
                    </Text>
                </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                
                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>📅 Periodic Weekly Documentation Matrix</Text>
                </View>

                {loading ? (
                    <ActivityIndicator size="small" color="#2563EB" style={{ marginTop: 32 }} />
                ) : (
                    <View style={{ paddingHorizontal: 16 }}>
                        {[1, 2, 3, 4].map((weekNum) => {
                            const matchedCard = weeklyCards && Array.isArray(weeklyCards) 
                                ? weeklyCards.find(c => c && c.week_number === weekNum) 
                                : undefined;
                            
                            if (searchText) {
                                const searchLower = searchText.toLowerCase();
                                const filenameMatch = matchedCard?.file_url?.toLowerCase().includes(searchLower);
                                const weekTextMatch = `week ${weekNum}`.includes(searchLower);
                                if (!filenameMatch && !weekTextMatch) return null;
                            }

                            return (
                                <View key={weekNum} style={styles.complianceStatePillCard}>
                                    <View style={[
                                        styles.leftStrip, 
                                        { backgroundColor: fetchStatusColorSchema(!!matchedCard) }
                                    ]} />

                                    <View style={styles.weekContent}>
                                        <View style={styles.weekHeader}>
                                            <View style={{ flex: 1, marginRight: 8 }}>
                                                <Text numberOfLines={1} style={styles.weekTitle}>
                                                    Week {weekNum} Audit Log Verification
                                                </Text>
                                                <Text style={styles.weekRange}>
                                                    {matchedCard 
                                                        ? `Sync Confirmed: ${new Date(matchedCard.created_at).toLocaleDateString()}` 
                                                        : 'Missing System Audit Trace'}
                                                </Text>
                                            </View>
                                            <Text style={{ fontSize: 18 }}>
                                                {matchedCard ? '🟢' : '🔴'}
                                            </Text>
                                        </View>
                                        

                                        <View style={styles.actionRow}>
                                            {matchedCard ? (
                                                <TouchableOpacity
                                                    style={styles.viewButton}
                                                    onPress={() => {

                                                        console.log(
                                                            'IMAGE URL =>',
                                                            matchedCard?.file_url
                                                        );

                                                        setPreviewImage(
                                                            matchedCard?.file_url?.startsWith('http')
                                                                ? matchedCard.file_url
                                                                : `https://aquatrack-prod-final.fly.dev/${matchedCard?.file_url}`
                                                        );

                                                        setPreviewVisible(true);
                                                    }}
                                                >
                                                    <Text style={styles.viewButtonText}>👁 View Image</Text>
                                                </TouchableOpacity>
                                            ) : (
                                                <TouchableOpacity 
                                                    style={styles.inlineContextUploadBtn}
                                                    onPress={() => executeDirectContextUpload('water_card', weekNum)}
                                                >
                                                    <Text style={styles.inlineContextUploadBtnText}>+ Inject Week {weekNum} Log</Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )}

                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>🧾 Month End Commercial Statement</Text>
                </View>

                <View style={{ paddingHorizontal: 16, marginBottom: 40 }}>
                    <View style={styles.invoiceCard}>
                        <View style={[
                            styles.leftStrip, 
                            { backgroundColor: fetchStatusColorSchema(!!invoiceData) }
                        ]} />

                        <View style={styles.invoiceContent}>
                            <Text style={styles.invoiceTitle}>
                                {invoiceData ? `${selectedMonth} Consolidated Ledger` : `Pending Statement: ${selectedMonth}`}
                            </Text>
                            
                            <Text style={[
                                styles.statusText, 
                                { color: fetchStatusColorSchema(!!invoiceData) }
                            ]}>
                                {invoiceData ? '✓ File Repositories Synchronized' : '⚠ Action Required: Missing Closing Invoice'}
                            </Text>

                            <View style={[styles.actionRow, { marginTop: 16 }]}>
                                {invoiceData ? (
                                    <TouchableOpacity 
                                        style={styles.viewButton}
                                        onPress={() => {
                                            setPreviewImage(invoiceData.file_url || '');
                                            setPreviewVisible(true);
                                        }}
                                    >
                                        <Text style={styles.viewButtonText}>👁 Open Invoice</Text>
                                    </TouchableOpacity>
                                ) : (
                                    <TouchableOpacity 
                                        style={[styles.inlineContextUploadBtn, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }]}
                                        onPress={() => executeDirectContextUpload('invoice')}
                                    >
                                        <Text style={[styles.inlineContextUploadBtnText, { color: '#EF4444' }]}>
                                            + Dispatch Financial Statement Invoice
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    </View>
                </View>
            </ScrollView>

            <Modal
    visible={dropdownVisible}
    animationType="slide"
    transparent={true}
>
    <View
        style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'center',
            alignItems: 'center'
        }}
    >
        <View
            style={{
                width: '80%',
                backgroundColor: '#fff',
                borderRadius: 16,
                maxHeight: 400,
                paddingVertical: 10
            }}
        >
            <FlatList
                data={historicalMonthsArray}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={{
                            padding: 16,
                            borderBottomWidth: 1,
                            borderBottomColor: '#E5E7EB'
                        }}
                        onPress={() => {
                            setSelectedMonth(item);
                            setDropdownVisible(false);
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 16,
                                fontWeight: '600'
                            }}
                        >
                            {item}
                        </Text>
                    </TouchableOpacity>
                )}
            />

            <TouchableOpacity
                onPress={() => setDropdownVisible(false)}
                style={{
                    padding: 16,
                    alignItems: 'center'
                }}
            >
                <Text
                    style={{
                        color: 'red',
                        fontWeight: '700'
                    }}
                >
                    Close
                </Text>
            </TouchableOpacity>
        </View>
    </View>
</Modal>

            {uploading && (
                <Modal transparent visible={uploading}>
                    <View style={styles.transitScreenModalOverlay}>
                        <View style={styles.transitScreenProgressBox}>
                            <ActivityIndicator size="small" color="#2563EB" />
                            <Text style={styles.transitScreenModalText}>
                                Synchronizing assets with enterprise block storage infrastructure...
                            </Text>
                        </View>
                    </View>
                </Modal>
            )}

            <Modal visible={previewVisible} transparent={false} animationType="fade">
                <View style={styles.fullScreenPreviewImageBlackoutBox}>
                    <TouchableOpacity
                        onPress={() => setPreviewVisible(false)}
                        style={styles.closeFullImagePreviewTouchTrigger}
                    >
                        <Text style={styles.closeFullImagePreviewCrossText}>✕ Close Preview</Text>
                    </TouchableOpacity>
                    <Image
                        source={{ uri: previewImage }}
                        style={styles.fullScreenTargetImageRenderBody}
                        resizeMode="contain"
                    />
                </View>
            </Modal>

        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC'
    },
   header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 18,
    backgroundColor: '#FFFFFF',
},
    backButtonTouch: {
        paddingRight: 12
    },
    backButton: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#0F172A'
    },
    storeName: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
        letterSpacing: -0.3
    },
    storeId: {
        marginTop: 1,
        color: '#64748B',
        fontSize: 11,
        fontWeight: '600'
    },
    dropdownTriggerBtn: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
},
    dropdownTriggerText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#1E293B'
    },
    searchBarWrapperRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginTop: 14,
        gap: 10
    },
    searchContainerBox: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    searchIconSymbol: {
        fontSize: 16
    },
    searchInputFieldText: {
        flex: 1,
        paddingVertical: 10,
        marginLeft: 8,
        color: '#0F172A',
        fontSize: 13,
        fontWeight: '600'
    },
    kpiControlBadgeBox: {
        backgroundColor: '#E0F2FE',
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#BAE6FD'
    },
    kpiControlBadgeCountText: {
        color: '#0369A1',
        fontSize: 12,
        fontWeight: '800'
    },
    performanceSummaryBannerCard: {
        flexDirection: 'row',
        backgroundColor: '#0F172A',
        marginHorizontal: 16,
        marginTop: 12,
        borderRadius: 16,
        padding: 16,
        alignItems: 'center'
    },
    innerPerformanceMetricsMetricItem: {
        flex: 1,
        alignItems: 'center'
    },
    metricLabelTitleText: {
        color: '#94A3B8',
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.4
    },
    metricPrimaryValueText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '900',
        marginTop: 4
    },
    verticalSplitDividerLine: {
        width: 1,
        height: 32,
        backgroundColor: '#334155'
    },
    sectionHeader: {
        paddingHorizontal: 16,
        marginTop: 22,
        marginBottom: 10
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#475569',
        letterSpacing: 0.5
    },
    complianceStatePillCard: {
        flexDirection: 'row',
        backgroundColor: '#ffffff',
        marginBottom: 10,
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    leftStrip: {
        width: 5
    },
    weekContent: {
        flex: 1,
        padding: 14
    },
    weekHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    weekTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A'
    },
    weekRange: {
        marginTop: 3,
        color: '#64748B',
        fontSize: 11,
        fontWeight: '500'
    },
    statusText: {
        marginTop: 4,
        fontWeight: '700',
        fontSize: 12
    },
    weekCardInlinePreviewThumb: {
        width: 120,
        height: 120,
        borderRadius: 10,
        marginTop: 12,
        marginBottom: 4,
        borderWidth: 1,
        borderColor: '#E2E8F0'
    },
    actionRow: {
        flexDirection: 'row',
        marginTop: 12
    },
    viewButton: {
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 8,
        marginRight: 8,
        borderWidth: 1,
        borderColor: '#CBD5E1'
    },
    viewButtonText: {
        color: '#334155',
        fontWeight: '700',
        fontSize: 11
    },
    inlineContextUploadBtn: {
        flex: 1,
        backgroundColor: '#F0F9FF',
        paddingVertical: 9,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#0284C7'
    },
    inlineContextUploadBtnText: {
        color: '#0284C7',
        fontWeight: '800',
        fontSize: 12
    },
    invoiceCard: {
        flexDirection: 'row',
        backgroundColor: '#ffffff',
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    invoiceContent: {
        flex: 1,
        padding: 14
    },
    invoiceTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A'
    },
    modalBlurOverlayCloseTarget: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.3)',
        justifyContent: 'center',
        alignItems: 'center'
    },
    dropdownCentricListModalBox: {
        width: '75%',
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 8,
        maxHeight: '40%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8
    },
    dropdownRowOptionBtn: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 10,
        marginBottom: 2
    },
    selectedDropdownRowOptionBtn: {
        backgroundColor: '#2563EB'
    },
    dropdownRowOptionText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#334155'
    },
    selectedDropdownRowOptionText: {
        color: '#ffffff',
        fontWeight: '700'
    },
    transitScreenModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        justifyContent: 'center',
        alignItems: 'center'
    },
    transitScreenProgressBox: {
        backgroundColor: '#ffffff',
        paddingHorizontal: 20,
        paddingVertical: 18,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        width: '80%'
    },
    transitScreenModalText: {
        marginLeft: 12,
        fontWeight: '600',
        color: '#334155',
        fontSize: 12,
        flex: 1
    },
    
    fullScreenPreviewImageBlackoutBox: {
        flex: 1,
        backgroundColor: '#000000',
        justifyContent: 'center'
    },
    closeFullImagePreviewTouchTrigger: {
        position: 'absolute',
        top: 50,
        right: 20,
        zIndex: 999,
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8
    },
    closeFullImagePreviewCrossText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: 'bold'
    },
    fullScreenTargetImageRenderBody: {
        flex: 1
    }
});

export default StoreComplianceScreen;