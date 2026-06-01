import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';


// Define the type for the entire navigation stack for type safety.
type RootStackParamList = {
  ForgotPassword: { userType: string };
  PartnerScreen: undefined;
  // Add other screens here as needed.
};

// Define a type for the route props specifically for this screen.
type ForgotPasswordRouteProp = RouteProp<RootStackParamList, 'ForgotPassword'>;

// Define a type for the navigation prop.
type ForgotPasswordNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ForgotPassword'>;

const ForgotPasswordScreen = () => {
  const route = useRoute<ForgotPasswordRouteProp>();
  const navigation = useNavigation<ForgotPasswordNavigationProp>();

  const userType = route.params?.userType || 'User';

  // API Base URL - this should be a constant in your app.
  const BASE_URL = 'https://aquatrack-backend.fly.dev';

  const [currentStep, setCurrentStep] = useState(1);
  const [loginEmail, setLoginEmail] = useState('');
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isErrorModalVisible, setIsErrorModalVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Ref to manage OTP input fields for automatic focus.
  const otpInputRefs = useRef<(TextInput | null)[]>([]);

  /**
   * Displays a modal with a given error message.
   * @param {string} message - The message to display in the modal.
   */
  const showErrorModal = (message: string) => {
    setErrorMessage(message);
    setIsErrorModalVisible(true);
  };

  /**
   * Handles the request to send a password reset OTP.
   * Corrected API endpoint to match the backend.
   */
  const handleRequestPasswordReset = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(loginEmail)) {
      showErrorModal('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    try {
      // CORRECTED: The endpoint is now '/forgot-password' as per your backend.
      const response = await fetch(`${BASE_URL}/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // CORRECTED: The backend's ForgotPasswordRequest model only expects 'email'.
        body: JSON.stringify({ email: loginEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Something went wrong. Please try again.');
      }

      console.log(`Sending reset link for ${userType} to:`, loginEmail);
      setCurrentStep(2);
    } catch (error: any) {
      showErrorModal(error.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handles the OTP verification step.
   * This logic matches your backend's /verify-otp endpoint.
   */
  const handleVerifyCode = async () => {
    const enteredOtp = otp.join('');
    if (enteredOtp.length !== 6) {
      showErrorModal('Please enter the complete 6-digit code.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/verify-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: loginEmail, otp: enteredOtp }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Invalid OTP. Please try again.');
      }

      // Backend verify-otp endpoint doesn't return a token, so we just proceed.
      setCurrentStep(3);
    } catch (error: any) {
      showErrorModal(error.message || 'Invalid OTP. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handles setting the new password.
   * This logic is now CORRECT to match your backend's /reset-password endpoint.
   */
  const handleNewPasswordSet = async () => {
    if (newPassword.length < 8) {
      showErrorModal('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      showErrorModal('Passwords do not match. Please try again.');
      return;
    }

    const enteredOtp = otp.join('');
    setIsLoading(true);
    try {
      // CORRECTED: The backend's /reset-password endpoint requires email, otp, and new_password.
      const response = await fetch(`${BASE_URL}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // CORRECTED: Removed Authorization header as the backend doesn't expect it.
        },
        body: JSON.stringify({
          email: loginEmail,
          otp: enteredOtp,
          new_password: newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to reset password. Please try again.');
      }

      showErrorModal('Password reset successful! You can now log in with your new password.');
      navigation.navigate('PartnerScreen');
    } catch (error: any) {
      showErrorModal(error.message || 'Failed to reset password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handles the resend OTP functionality.
   * This logic matches your backend's resend logic, if you have one.
   */
  const handleResendEmail = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: loginEmail }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to resend code.');
      }

      showErrorModal('New code sent! Please check your email.');
    } catch (error: any) {
      showErrorModal(error.message || 'Failed to resend code.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handles OTP input change and automatically moves focus to the next input.
   * @param {string} text - The digit entered.
   * @param {number} index - The index of the input field.
   */
  const handleOtpChange = (text: string, index: number) => {
    const newOtp = [...otp];
    const char = text.length > 0 ? text[text.length - 1] : '';
    newOtp[index] = char;
    setOtp(newOtp);

    if (char !== '' && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const renderEmailInputStep = () => (
    <View style={styles.formContainer}>
      <Text style={styles.header}>Forgot Password</Text>
      <Text style={styles.subHeader}>Please enter your email to reset the password for your {userType.toLowerCase()} account.</Text>

      <Text style={styles.label}>Your Email</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter your email"
        value={loginEmail}
        onChangeText={setLoginEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TouchableOpacity
        style={styles.continueButton}
        onPress={handleRequestPasswordReset}
        disabled={isLoading}
      >
        {isLoading ? <ActivityIndicator color="#333" /> : <Text style={styles.continueButtonText}>Reset Password</Text>}
      </TouchableOpacity>
    </View>
  );

  const renderOtpVerificationStep = () => (
    <View style={styles.formContainer}>
      <Text style={styles.header}>Check your email</Text>
      <Text style={styles.subHeader}>
        We sent a verification code to <Text style={styles.emailText}>{loginEmail}</Text>.
        Enter the 6-digit code mentioned in the email.
      </Text>

      <View style={styles.otpContainer}>
        {otp.map((digit, index) => (
          <TextInput
            key={index}
            style={styles.otpInput}
            keyboardType="number-pad"
            maxLength={1}
            value={digit}
            onChangeText={(text) => handleOtpChange(text, index)}
            ref={(el) => {
              if (el) otpInputRefs.current[index] = el;
            }}
          />
        ))}
      </View>

      <TouchableOpacity
        style={styles.continueButton}
        onPress={handleVerifyCode}
        disabled={isLoading}
      >
        {isLoading ? <ActivityIndicator color="#333" /> : <Text style={styles.continueButtonText}>Verify Code</Text>}
      </TouchableOpacity>

      <View style={styles.resendContainer}>
        <Text style={styles.resendText}>Haven't received the code yet? </Text>
        <TouchableOpacity onPress={handleResendEmail} disabled={isLoading}>
          <Text style={styles.resendLink}>Resend email</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderNewPasswordStep = () => (
    <View style={styles.formContainer}>
      <Text style={styles.header}>Set a New Password</Text>
      <Text style={styles.subHeader}>Please enter your new password below.</Text>

      <Text style={styles.label}>New Password</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter new password"
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
      />

      <Text style={styles.label}>Confirm New Password</Text>
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        value={confirmNewPassword}
        onChangeText={setConfirmNewPassword}
        secureTextEntry
      />

      <TouchableOpacity
        style={styles.continueButton}
        onPress={handleNewPasswordSet}
        disabled={isLoading}
      >
        {isLoading ? <ActivityIndicator color="#333" /> : <Text style={styles.continueButtonText}>Set Password</Text>}
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          {currentStep === 1
            ? renderEmailInputStep()
            : currentStep === 2
            ? renderOtpVerificationStep()
            : renderNewPasswordStep()}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Error Pop-up Modal */}
      <Modal
        visible={isErrorModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsErrorModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.errorModalContent}>
            <Text style={styles.errorModalTitle}>Error</Text>
            <Text style={styles.errorModalMessage}>{errorMessage}</Text>
            <TouchableOpacity
              style={styles.errorModalButton}
              onPress={() => setIsErrorModalVisible(false)}
            >
              <Text style={styles.errorModalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
    position: 'relative',
  },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 20,
    zIndex: 1,
    padding: 10,
  },
  backButtonText: {
    fontSize: 24,
    color: '#333',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  subHeader: {
    fontSize: 16,
    color: '#777',
    marginBottom: 30,
  },
  emailText: {
    fontWeight: 'bold',
  },
  formContainer: {
    width: '100%',
    padding: 20,
    borderRadius: 10,
    backgroundColor: '#f9f9f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  label: {
    fontSize: 16,
    color: '#333',
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E6E6E6',
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    marginBottom: 20,
  },
  continueButton: {
    backgroundColor: '#C8D9F2',
    borderRadius: 8,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  continueButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: 'bold',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  otpInput: {
    width: '15%',
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: '#E6E6E6',
    borderRadius: 8,
    fontSize: 24,
    textAlign: 'center',
  },
  resendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  resendText: {
    fontSize: 14,
    color: '#777',
  },
  resendLink: {
    fontSize: 14,
    color: '#007BFF',
    textDecorationLine: 'underline',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  errorModalContent: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 20,
    width: '80%',
    alignItems: 'center',
  },
  errorModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  errorModalMessage: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  errorModalButton: {
    backgroundColor: '#007BFF',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  errorModalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default ForgotPasswordScreen;