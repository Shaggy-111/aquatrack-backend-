import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../../src/config';

export const getOrdersUrl = async (): Promise<string> => {
  const role = await AsyncStorage.getItem('user_role');
  console.log('🔎 getOrdersUrl role:', role);

  if (role === 'delivery_manager') {
    return `${API_BASE_URL}/partners/partners/delivery-manager/me/orders`;
  }

  return `${API_BASE_URL}/partners/partners/delivery-partner/me/orders`;
};

export const getProfileUrl = async (): Promise<string> => {
  const role = await AsyncStorage.getItem('user_role');
  console.log('🔎 getProfileUrl role:', role);

  if (role === 'delivery_manager') {
    return `${API_BASE_URL}/partners/partners/delivery-manager/me/profile`;
  }

  return `${API_BASE_URL}/partners/partners/delivery-partner/me`;
};
