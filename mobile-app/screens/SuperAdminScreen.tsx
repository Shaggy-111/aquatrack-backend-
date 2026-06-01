import React, { useState, FC } from 'react';
import {
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    TextInput,
    SafeAreaView,
    StatusBar,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from '../App';
import { API_BASE_URL } from '../src/config';

// Eye icon component (common for username & password)
interface EyeIconProps {
    isVisible: boolean;
    onPress: () => void;
    isActive?: boolean; // dark black when typing
}

const EyeIcon: FC<EyeIconProps> = ({ isVisible, onPress, isActive }) => (
    <TouchableOpacity onPress={onPress} style={styles.eyeIcon}>
        <Text style={[styles.eyeIconText, { color: isActive ? '#000' : '#777' }]}>
            {isVisible ? '🙈' : '👁️'}
        </Text>
    </TouchableOpacity>
);

const SuperAdminLoginScreen: FC = () => {
    const navigation = useNavigation<NavigationProp<RootStackParamList>>();

    const [loginEmail, setLoginEmail] = useState<string>('');
    const [loginPassword, setLoginPassword] = useState<string>('');
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isEmailVisible, setIsEmailVisible] = useState<boolean>(false);
    const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);

    const handleLogin = async (): Promise<void> => {
        setErrorMessage('');
        setIsLoading(true);

        if (!loginEmail || !loginPassword) {
            setErrorMessage('Please enter both email and password.');
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: loginEmail,
                    password: loginPassword,
                    role: 'superadmin',
                }),
            });

            const data: any = await response.json();

            if (response.ok) {
                await AsyncStorage.setItem('userToken', data.access_token);
                navigation.navigate('SuperAdminDashboard');
            } else {
                const detailMessage: string = data.detail || 'Login failed. Please check your credentials.';
                setErrorMessage(detailMessage);
                Alert.alert('Login Failed', detailMessage);
            }
        } catch (error: any) {
            console.error('Error:', error);
            setErrorMessage('Network error. Please try again later.');
            Alert.alert('Error', 'A network error occurred. Please try again later.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleForgotPassword = (): void => {
        navigation.navigate('ForgotPassword', { userType: 'SuperAdmin' });
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView contentContainerStyle={styles.scrollContent}>
                    <View style={styles.formContainer}>
                        <Text style={styles.header}>Super Admin Login</Text>

                        {/* --- EMAIL FIELD --- */}
                        <Text style={styles.label}>Your Email</Text>
                        <View style={styles.inputContainer}>
                            <TextInput
                                style={styles.inputField}
                                placeholder="superadmin@aqua.com"
                                placeholderTextColor="#999"
                                value={loginEmail}
                                onChangeText={setLoginEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                editable={!isLoading}
                                secureTextEntry={!isEmailVisible}
                            />
                            <EyeIcon
                                isVisible={isEmailVisible}
                                onPress={() => setIsEmailVisible(!isEmailVisible)}
                                isActive={!!loginEmail}
                            />
                        </View>

                        {/* --- PASSWORD FIELD --- */}
                        <Text style={styles.label}>Password</Text>
                        <View style={styles.inputContainer}>
                            <TextInput
                                style={styles.inputField}
                                placeholder="Password"
                                placeholderTextColor="#999"
                                value={loginPassword}
                                onChangeText={setLoginPassword}
                                secureTextEntry={!isPasswordVisible}
                                editable={!isLoading}
                            />
                            <EyeIcon
                                isVisible={isPasswordVisible}
                                onPress={() => setIsPasswordVisible(!isPasswordVisible)}
                                isActive={!!loginPassword}
                            />
                        </View>

                        <View style={styles.forgotPasswordContainer}>
                            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
                            <TouchableOpacity onPress={handleForgotPassword}>
                                <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            style={[styles.continueButton, isLoading && styles.disabledButton]}
                            onPress={handleLogin}
                            disabled={isLoading}
                        >
                            <Text style={styles.continueButtonText}>
                                {isLoading ? 'Logging in...' : 'Continue'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#fff' },
    container: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingHorizontal: 20, justifyContent: 'center' },
    formContainer: {
        backgroundColor: '#f9f9f9',
        padding: 20,
        borderRadius: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 5,
        elevation: 3,
    },
    header: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#333',
        textAlign: 'center',
        marginBottom: 30,
    },
    label: { fontSize: 16, color: '#333', marginBottom: 5 },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E6E6E6',
        borderRadius: 8,
        marginBottom: 20,
        backgroundColor: '#fff',
        paddingHorizontal: 10,
    },
    inputField: {
        flex: 1,
        fontSize: 16,
        color: '#333',
        paddingVertical: 12,
    },
    eyeIcon: { padding: 6 },
    eyeIconText: {
        fontSize: 22,
    },
    forgotPasswordContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
    },
    errorText: { color: '#FF0000', fontSize: 14, flex: 1, marginRight: 10 },
    forgotPasswordText: { color: '#007BFF', textDecorationLine: 'underline' },
    continueButton: {
        backgroundColor: '#007BFF',
        borderRadius: 50,
        paddingVertical: 15,
        alignItems: 'center',
    },
    disabledButton: { backgroundColor: '#a3d1ff' },
    continueButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});

export default SuperAdminLoginScreen;
