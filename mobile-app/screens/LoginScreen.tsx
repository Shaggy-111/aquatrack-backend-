import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  StatusBar,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../src/config';

const { width, height } = Dimensions.get('window');

const LoginScreen = ({ navigation }: any) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password: password }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        Alert.alert('Login Failed', data?.detail || 'Invalid credentials');
        return;
      }
      
      const token = data.access_token || data.token || data.partner_token;
      const role = data.user_role;
      
      await AsyncStorage.multiSet([['auth_token', token], ['user_role', role]]);
      
      if (role === 'delivery_manager' || role === 'delivery_partner' || role === 'store_manager') {
        navigation.replace('DeliveryPartnerDashboard');
      } else if (role === 'partner') {
        navigation.replace('PartnerDashboard');
      } else {
        Alert.alert('Error', 'Unauthorized role');
      }
    } catch (e) {
      Alert.alert('Error', 'Connection failed. Please check your internet.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.mainContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#1E3A8A" />
      
      <KeyboardAwareScrollView
        enableOnAndroid={true}
        extraScrollHeight={20}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Section */}
        <View style={styles.topSection}>
          <View style={styles.headerContent}>
            <Text style={styles.logoText}>
              Aqua<Text style={{ fontWeight: '900' }}>Track</Text>
            </Text>
            <View style={styles.vkBadge}>
              <Text style={styles.vkText}>BY VEE KAY</Text>
            </View>
            <Text style={styles.slogan}>Smart Water, Smarter Living</Text>
          </View>
        </View>

        {/* Form Section */}
        <View style={styles.formSection}>
          <View style={styles.welcomeContainer}>
            <Text style={styles.welcomeTitle}>Welcome Back</Text>
            <Text style={styles.welcomeSub}>Sign in to manage your deliveries</Text>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              placeholder="name@email.com"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passWrapper}>
              <TextInput
                placeholder="••••••••"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showPassword}
                style={styles.passInput}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity 
                onPress={() => setShowPassword(!showPassword)} 
                style={styles.eyeBtn}
              >
                <Text style={styles.eyeText}>{showPassword ? 'HIDE' : 'SHOW'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity 
            style={[styles.signInBtn, loading && { opacity: 0.7 }]} 
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.signInText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.versionText}>v1.1 | AquaTrack Solutions</Text>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  topSection: {
    height: height * 0.3,
    backgroundColor: '#1E3A8A',
    borderBottomRightRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  headerContent: { alignItems: 'center' },
  logoText: { fontSize: 42, color: '#fff', fontWeight: '300', letterSpacing: -1 },
  vkBadge: { 
    backgroundColor: 'rgba(255,255,255,0.2)', 
    paddingHorizontal: 14, 
    paddingVertical: 4, 
    borderRadius: 8, 
    marginTop: 8 
  },
  vkText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  slogan: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 12 },
  
  formSection: { flex: 1, paddingHorizontal: 32, paddingTop: 50 },
  welcomeContainer: { marginBottom: 40 },
  welcomeTitle: { fontSize: 32, fontWeight: 'bold', color: '#1E293B' },
  welcomeSub: { fontSize: 16, color: '#64748B', marginTop: 4 },

  inputContainer: { marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 8 },
  input: { 
    backgroundColor: '#F1F5F9', 
    padding: 18, 
    borderRadius: 12, 
    fontSize: 16,
    color: '#1E293B',
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  passWrapper: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#F1F5F9', 
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  passInput: { flex: 1, padding: 18, fontSize: 16, color: '#1E293B' },
  eyeBtn: { paddingRight: 18 },
  eyeText: { color: '#1E3A8A', fontSize: 12, fontWeight: 'bold' },

  signInBtn: {
    backgroundColor: '#1E3A8A',
    paddingVertical: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: '#1E3A8A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  signInText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  versionText: { 
    textAlign: 'center', 
    color: '#94A3B8', 
    fontSize: 12, 
    marginVertical: 20 
  },
});

export default LoginScreen;