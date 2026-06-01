import React, { useEffect, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios'; // Axios import zaroori hai

import LoginScreen from './screens/LoginScreen';
import PartnerDashboard from './screens/PartnerDashboard';
import DeliveryPartnerDashboard from './screens/DeliveryPartnerDashboard';
import StoreComplianceScreen from './screens/StoreComplianceScreen';

const Stack = createNativeStackNavigator<any>();
// 1. Navigation Ref banaya taaki axios interceptor bahar se navigate kar sake
const navigationRef = createNavigationContainerRef();

export default function App() {
  const [loading, setLoading] = useState(true);
  const [initialRoute, setInitialRoute] = useState<
    'Login' | 'PartnerDashboard' | 'DeliveryPartnerDashboard'
  >('Login');

  useEffect(() => {
    // 2. Axios Interceptor Setup
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response && error.response.status === 401) {
          // Token expire ho gaya!
          await AsyncStorage.multiRemove(['auth_token', 'user_role']);
          
          Alert.alert("Session Expired", "Your session has timed out. Please login again.");
          
          if (navigationRef.isReady()) {
            // Seedha Login par bhej do
            navigationRef.reset({
              index: 0,
              routes: [{ name: 'Login' }],
            });
          }
        }
        return Promise.reject(error);
      }
    );

    checkLogin();

    // Clean up interceptor on unmount
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  const checkLogin = async () => {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      const role = await AsyncStorage.getItem('user_role');

      if (token && role) {
        if (role === 'partner') {
          setInitialRoute('PartnerDashboard');
        } else if (role === 'delivery_manager' || role === 'delivery_partner' || role === 'store_manager') {
          setInitialRoute('DeliveryPartnerDashboard');
        } else {
          setInitialRoute('Login');
        }
      } else {
        setInitialRoute('Login');
      }
    } catch (e) {
      console.log(e);
      setInitialRoute('Login');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1E3A8A" />
      </View>
    );
  }

  return (
    // 3. NavigationContainer mein ref pass kiya
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName={initialRoute}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="PartnerDashboard" component={PartnerDashboard} />
        <Stack.Screen
          name="DeliveryPartnerDashboard"
          component={DeliveryPartnerDashboard}
        />
        <Stack.Screen
          name="StoreCompliance"
          component={StoreComplianceScreen as any}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}