import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, Alert, Dimensions, StatusBar, ActivityIndicator } from 'react-native';

// --- Mock Data Interfaces ---
interface Order {
  id: string;
  bottles: number;
  status: 'Pending' | 'In Transit' | 'Delivered' | 'Cancelled';
  orderDate: Date;
  deliveryDate?: Date;
  location: string;
  customerName: string;
}

interface TestReport {
  id: string;
  reportDate: Date;
  qualityStatus: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  phLevel: number;
  tds: number; // Total Dissolved Solids
}

// --- Main App Component ---
const CustomerDashboard = () => {
  // State management for navigation and data
  const [currentTab, setCurrentTab] = useState('home');
  const [bottleCount, setBottleCount] = useState(1);
  const [emptyBottleCount, setEmptyBottleCount] = useState(2); // New state for tracking empty bottles
  const [walletBalance, setWalletBalance] = useState(500); // New state for wallet balance
  const [orders, setOrders] = useState<Order[]>([]);
  const [reports, setReports] = useState<TestReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [complaintSubject, setComplaintSubject] = useState('');
  const [complaintDescription, setComplaintDescription] = useState('');

  // Simulating fetching data from a backend API on component load
  useEffect(() => {
    setLoading(true);
    // Simulate API calls with a delay
    setTimeout(() => {
      const mockOrders: Order[] = [
        {
          id: 'ORD-1234',
          bottles: 3,
          status: 'In Transit',
          orderDate: new Date('2025-08-10T10:00:00Z'),
          location: '123 Main St, Anytown',
          customerName: 'Jane Doe',
        },
        {
          id: 'ORD-1233',
          bottles: 5,
          status: 'Delivered',
          orderDate: new Date('2025-08-09T09:00:00Z'),
          deliveryDate: new Date('2025-08-09T14:30:00Z'),
          location: '123 Main St, Anytown',
          customerName: 'Jane Doe',
        },
      ];
      const mockReports: TestReport[] = [
        {
          id: 'REP-001',
          reportDate: new Date('2025-08-11T00:00:00Z'),
          qualityStatus: 'Excellent',
          phLevel: 7.2,
          tds: 150,
        },
        {
          id: 'REP-002',
          reportDate: new Date('2025-08-01T00:00:00Z'),
          qualityStatus: 'Good',
          phLevel: 7.5,
          tds: 200,
        },
      ];
      setOrders(mockOrders);
      setReports(mockReports);
      setLoading(false);
    }, 1000);
  }, []);

  // Function to handle placing a new order
  const handlePlaceOrder = () => {
    if (bottleCount <= 0) {
      Alert.alert('Error', 'Please select at least one bottle.');
      return;
    }

    setLoading(true);
    setTimeout(() => {
      const newOrder: Order = {
        id: `ORD-${Math.floor(Math.random() * 10000)}`,
        bottles: bottleCount,
        status: 'Pending',
        orderDate: new Date(),
        location: 'Your address here',
        customerName: 'Current User',
      };
      setOrders([newOrder, ...orders]);
      setLoading(false);
      Alert.alert('Success', `Order for ${bottleCount} bottles placed successfully!`);
      setBottleCount(1);
    }, 1000);
  };

  // Function to handle editing an order
  const handleEditOrder = (orderId: string, newBottleCount: number) => {
    const orderToEdit = orders.find(o => o.id === orderId);
    if (!orderToEdit) return;

    const currentTime = new Date();
    const orderTime = new Date(orderToEdit.orderDate);
    const timeElapsed = (currentTime.getTime() - orderTime.getTime()) / (1000 * 60);

    if (timeElapsed > 30) {
      Alert.alert('Error', 'Cannot edit order: more than 30 minutes have passed.');
      return;
    }

    // Simulate sending update to backend
    setOrders(orders.map(o => o.id === orderId ? { ...o, bottles: newBottleCount } : o));
    Alert.alert('Success', `Order ${orderId} updated successfully to ${newBottleCount} bottles.`);
  };
  
  // Function to handle complaint submission
  const handleSubmitComplaint = () => {
    // Simulate sending complaint to backend
    Alert.alert('Complaint Submitted', `Thank you for your feedback. We have received your complaint about "${complaintSubject}".`);
    setComplaintSubject('');
    setComplaintDescription('');
  };
  
  // Function to handle mock subscription payment
  const handleSubscribe = () => {
    // This is where you would call your backend API for a subscription
    Alert.alert('Subscribe', 'Subscription logic would be handled here.');
  };

  // Function to handle mock PDF download
  const handleDownloadReport = (reportId: string) => {
      Alert.alert('Download Report', `Downloading report ${reportId} as a PDF.`);
      // In a real app, this would trigger an API call to download the PDF.
  };

  // --- Render Functions for each Tab ---
  const renderHome = () => (
    <ScrollView style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Place New Order</Text>

      {/* Product Card */}
      <View style={[styles.card, styles.productCard]}>
        <View style={styles.productInfoRow}>
          <View style={styles.imagePlaceholder} />
          <View style={styles.productDetails}>
            <Text style={styles.productTitle}>20L Packaged Drinking Water</Text>
            <Text style={styles.productDescription}>Pure, clean drinking water for your home or office.</Text>
            <Text style={styles.productPrice}>₹100.00</Text>
          </View>
        </View>

        {/* Quantity and Order Button */}
        <View style={styles.orderControls}>
          <View style={styles.quantityControls}>
            <TouchableOpacity 
              style={styles.quantityButton}
              onPress={() => setBottleCount(Math.max(1, bottleCount - 1))}
            >
              <Text style={styles.quantityButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.quantityText}>{bottleCount}</Text>
            <TouchableOpacity 
              style={styles.quantityButton}
              onPress={() => setBottleCount(bottleCount + 1)}
            >
              <Text style={styles.quantityButtonText}>+</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity 
            style={styles.orderButton}
            onPress={handlePlaceOrder}
          >
            <Text style={styles.orderButtonText}>Order Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );

  const renderMyOrders = () => (
    <ScrollView style={styles.tabContent}>
      <Text style={styles.sectionTitle}>My Orders</Text>

      {/* Empty Bottles Section - MOVED HERE */}
      <View style={[styles.card, styles.emptyBottleCard]}>
        <View style={styles.bottleCountRow}>
          <Text style={styles.bottleCountTitle}>Empty Bottles in your possession:</Text>
          <Text style={styles.bottleCountText}>{emptyBottleCount}</Text>
        </View>
      </View>

      {orders.length === 0 ? (
        <Text style={styles.emptyMessage}>You have no orders yet.</Text>
      ) : (
        orders.map(order => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderId}>Order ID: {order.id}</Text>
              <View style={[
                styles.statusPill,
                order.status === 'Delivered' && styles.statusDelivered,
                order.status === 'In Transit' && styles.statusInTransit,
                order.status === 'Pending' && styles.statusPending,
              ]}>
                <Text style={styles.statusText}>{order.status}</Text>
              </View>
            </View>
            <View style={styles.orderDetails}>
              <Text style={styles.orderDetailText}>Bottles: {order.bottles}</Text>
              <Text style={styles.orderDetailText}>Date: {order.orderDate.toLocaleDateString()}</Text>
            </View>
            {/* Conditional Edit Button */}
            {order.status === 'Pending' && (
              <TouchableOpacity 
                style={styles.editButton} 
                onPress={() => handleEditOrder(order.id, order.bottles + 1)}
              >
                <Text style={styles.editButtonText}>Edit Order</Text>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );

  const renderReports = () => (
    <ScrollView style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Water Quality Reports</Text>
      {reports.length === 0 ? (
        <Text style={styles.emptyMessage}>No reports available at the moment.</Text>
      ) : (
        reports.map(report => (
          <View key={report.id} style={styles.reportCard}>
            <Text style={styles.reportDate}>Report Date: {report.reportDate.toLocaleDateString()}</Text>
            <Text style={styles.reportDetail}>Status:
              <Text style={[
                styles.reportStatus,
                report.qualityStatus === 'Excellent' && styles.statusExcellent,
                report.qualityStatus === 'Good' && styles.statusGood,
                report.qualityStatus === 'Fair' && styles.statusFair,
              ]}> {report.qualityStatus}</Text>
            </Text>
            <Text style={styles.reportDetail}>pH Level: {report.phLevel}</Text>
            <Text style={styles.reportDetail}>TDS: {report.tds} ppm</Text>
            {/* Download PDF Button - NEW */}
            <TouchableOpacity 
              style={styles.downloadButton}
              onPress={() => handleDownloadReport(report.id)}
            >
              <Text style={styles.downloadButtonText}>Download PDF</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );

  const renderWallet = () => (
    <ScrollView style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Wallet & Subscriptions</Text>
      <View style={styles.card}>
        <Text style={styles.walletBalanceTitle}>Current Balance:</Text>
        <Text style={styles.walletBalanceText}>₹{walletBalance.toFixed(2)}</Text>
        <TouchableOpacity style={styles.addMoneyButton}>
          <Text style={styles.addMoneyButtonText}>Add Money</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.card, { marginTop: 20 }]}>
        <Text style={styles.sectionSubtitle}>Subscription Plans</Text>
        <Text style={styles.subscriptionText}>
          A subscription model can be implemented here. For example, a customer could subscribe to receive 10 bottles per month, and their wallet balance would be automatically deducted.
        </Text>
        <TouchableOpacity style={styles.subscribeButton} onPress={handleSubscribe}>
          <Text style={styles.subscribeButtonText}>View Plans</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderComplaint = () => (
    <ScrollView style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Submit a Complaint</Text>
      <View style={styles.complaintCard}>
        <Text style={styles.label}>Subject</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Damaged bottle, late delivery"
          value={complaintSubject}
          onChangeText={setComplaintSubject}
        />
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Please provide details of your complaint."
          multiline
          numberOfLines={4}
          value={complaintDescription}
          onChangeText={setComplaintDescription}
        />
        <TouchableOpacity style={styles.submitButton} onPress={handleSubmitComplaint}>
          <Text style={styles.submitButtonText}>Submit Complaint</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // --- Main Render Logic ---
  const renderMainContent = () => {
    if (loading) {
      return (
        <View style={styles.centeredContent}>
          <ActivityIndicator size="large" color="#2176c1" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      );
    }
    switch (currentTab) {
      case 'home':
        return renderHome();
      case 'myOrders':
        return renderMyOrders();
      case 'reports':
        return renderReports();
      case 'complaint':
        return renderComplaint();
      case 'wallet':
        return renderWallet();
      default:
        return <Text>Something went wrong!</Text>;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      {/* Header - SEARCH BOX REMOVED */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AquaTrack</Text>
      </View>
      
      {/* Main Content Area */}
      <View style={styles.mainContent}>
        {renderMainContent()}
      </View>

      {/* Bottom Navigation Bar */}
      <View style={styles.navBar}>
        <NavBarItem icon="🏠" label="Order" isActive={currentTab === 'home'} onPress={() => setCurrentTab('home')} />
        <NavBarItem icon="📋" label="My Orders" isActive={currentTab === 'myOrders'} onPress={() => setCurrentTab('myOrders')} />
        <NavBarItem icon="📃" label="Reports" isActive={currentTab === 'reports'} onPress={() => setCurrentTab('reports')} />
        <NavBarItem icon="💳" label="Wallet" isActive={currentTab === 'wallet'} onPress={() => setCurrentTab('wallet')} />
        <NavBarItem icon="💬" label="Complaint" isActive={currentTab === 'complaint'} onPress={() => setCurrentTab('complaint')} />
      </View>
    </View>
  );
};

// --- Navigation Bar Item Component ---
const NavBarItem = ({ icon, label, isActive, onPress }: any) => {
  return (
    <TouchableOpacity style={styles.navBarItem} onPress={onPress}>
      <Text style={[styles.navBarIcon, { color: isActive ? '#2176c1' : '#888' }]}>{icon}</Text>
      <Text style={[styles.navBarText, { color: isActive ? '#2176c1' : '#888' }]}>{label}</Text>
    </TouchableOpacity>
  );
};

// --- Stylesheet ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: StatusBar.currentHeight,
  },
  header: {
    backgroundColor: '#2176c1',
    padding: 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  mainContent: {
    flex: 1,
  },
  tabContent: {
    padding: 16,
  },
  centeredContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#2176c1',
    fontSize: 18,
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  sectionSubtitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 3,
  },
  // New styles for the Home tab cards
  productCard: {
    marginBottom: 20,
  },
  emptyBottleCard: {
    marginBottom: 20,
    paddingVertical: 15,
  },
  productInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  imagePlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: '#e0f2fe',
    borderRadius: 10,
    marginRight: 15,
  },
  productDetails: {
    flex: 1,
  },
  productTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  productDescription: {
    fontSize: 14,
    color: '#888',
  },
  productPrice: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2176c1',
    marginTop: 8,
  },
  orderControls: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quantityButton: {
    backgroundColor: '#e0f2fe',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityButtonText: {
    color: '#2176c1',
    fontSize: 20,
    fontWeight: 'bold',
  },
  quantityText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    width: 40,
    textAlign: 'center',
  },
  orderButton: {
    backgroundColor: '#2176c1',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  orderButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  bottleCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottleCountTitle: {
    fontSize: 16,
    color: '#555',
  },
  bottleCountText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2176c1',
  },
  // Order Card
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 3,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderId: {
    color: '#888',
    fontSize: 12,
  },
  statusPill: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  statusDelivered: {
    backgroundColor: '#dcfce7',
  },
  statusInTransit: {
    backgroundColor: '#fef3c7',
  },
  statusPending: {
    backgroundColor: '#dbeafe',
  },
  statusTextDelivered: {
    color: '#16a34a',
  },
  statusTextInTransit: {
    color: '#ca8a04',
  },
  statusTextPending: {
    color: '#2563eb',
  },
  orderDetails: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 10,
  },
  orderDetailText: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  editButton: {
    marginTop: 10,
    alignSelf: 'flex-end',
  },
  editButtonText: {
    color: '#2176c1',
    fontWeight: 'bold',
  },
  emptyMessage: {
    textAlign: 'center',
    color: '#888',
    marginTop: 50,
  },
  // Reports Tab
  reportCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 3,
  },
  reportDate: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  reportDetail: {
    fontSize: 14,
    color: '#555',
  },
  reportStatus: {
    fontWeight: 'bold',
  },
  statusExcellent: {
    color: '#22c55e',
  },
  statusGood: {
    color: '#84cc16',
  },
  statusFair: {
    color: '#f97316',
  },
  downloadButton: {
    marginTop: 15,
    backgroundColor: '#2176c1',
    padding: 10,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  downloadButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Wallet Tab
  walletBalanceTitle: {
    fontSize: 16,
    color: '#555',
  },
  walletBalanceText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2176c1',
    marginTop: 5,
  },
  addMoneyButton: {
    backgroundColor: '#e0f2fe',
    borderRadius: 20,
    paddingVertical: 10,
    marginTop: 15,
  },
  addMoneyButtonText: {
    color: '#2176c1',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  subscriptionText: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    marginBottom: 10,
  },
  subscribeButton: {
    backgroundColor: '#2176c1',
    borderRadius: 25,
    paddingVertical: 12,
  },
  subscribeButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
  // Complaint Tab
  complaintCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 3,
  },
  label: {
    fontSize: 14,
    color: '#555',
    marginBottom: 5,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#f9f9f9',
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 16,
    color: '#333',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#2176c1',
    borderRadius: 25,
    paddingVertical: 12,
    marginTop: 20,
  },
  submitButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
  // Navigation
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#fff',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  navBarItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  navBarIcon: {
    fontSize: 24,
  },
  navBarText: {
    fontSize: 12,
    marginTop: 4,
  },
});

export default CustomerDashboard;