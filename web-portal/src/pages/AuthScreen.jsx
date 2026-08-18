import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config'; 
import { refreshPermissions } from '../hooks/usePermissions';

// NOTE: Using your provided background image URL
const LOGIN_BACKGROUND_IMAGE_URL =
  'https://user-gen-media-assets.s3.amazonaws.com/seedream_images/0f5b0114-24a6-420f-9d7b-27fa48a799f5.png';

const AuthScreen = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // File: AuthScreen.jsx

  const handleLogin = async (e) => {
  e.preventDefault();
  setLoading(true);
  setError('');

  try {
    // 1. Unified Payload
    const payload = {
      username: email,
      password: password,
    };

    // 2. Unified API Call
    const response = await axios.post(`${API_BASE_URL}/auth/login`, payload);


    // 3. Extract Role, Tokens, and Channel Info
    // ⭐ IMPORTANT: backend sends `channel_name` not `channel`
    const {
      access_token,
      token,
      user_role,
      partner_token,
      channel,        // sometimes backend sends this
      channel_name, 
      city,  // real key your backend is sending
    } = response.data;

    const finalToken = access_token || token || partner_token;
    if (!finalToken) throw new Error("Token not found in response.");

    // 4. Store Tokens & Role
    localStorage.setItem("auth_token", finalToken);
    localStorage.setItem("userToken", finalToken);
    localStorage.setItem("partner_token", finalToken);
    const normalizedRole = String(user_role || "").toLowerCase();
    localStorage.setItem("user_role", normalizedRole);
    refreshPermissions();

    // 5. STORE CHANNEL NAME PROPERLY
    const resolvedChannel =
      (channel_name && channel_name.toString()) ||
      (channel && channel.toString()) ||
      "";

    if (normalizedRole === "channel_admin" && resolvedChannel) {
      console.log("Saving Channel Name:", resolvedChannel);
      localStorage.setItem("channel_name", resolvedChannel.toUpperCase());
    }

    if (normalizedRole === "delivery_manager" && city) {
      console.log("Saving Manager Area:", city);
      localStorage.setItem("manager_area", city);
    }

    console.log("User Role:", user_role);

    // 6. Role Based Navigation
    if (normalizedRole === "superadmin") {
      navigate("/dashboard/superadmin");
    } else if (normalizedRole === "partner") {
      navigate("/dashboard/partner");
    } else if (normalizedRole === "channel_admin") {
      navigate("/dashboard/channeladmin");
    } else if (normalizedRole === "delivery_manager") {
      navigate("/dashboard/deliverymanager");
    } else if (normalizedRole === "employee") {
      navigate("/dashboard/employee");
    } else {
      alert(`Unknown role: ${user_role}. Please contact admin.`);
      localStorage.clear();
    }

  } catch (err) {
    console.error("Login failed:", err.response?.data || err.message);

    let msg = "Login failed. Please try again.";
    if (err.response?.status === 401) msg = "Invalid email or password.";
    if (err.message.includes("Network Error"))
      msg = "Network error. Check your internet connection.";

    setError(msg);
  } finally {
    setLoading(false);
  }
};

  
  // ❌ Removed handleSwitchRole as there are no tabs to switch

  return (
    <div style={authStyles.container}>
      <div style={authStyles.formSection}>
        <form onSubmit={handleLogin} style={authStyles.formBox}>
          
          <h1 style={authStyles.appTitle}>AquaTrack Login</h1>
          <h2 style={authStyles.formTitle}>
            Welcome back! Please enter your credentials.
          </h2>

          {/* ❌ Removed role selection tabs */}
          {error && <p style={authStyles.errorText}>{error}</p>}

          <div style={authStyles.form}>
            <input
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={authStyles.input}
              required
              disabled={loading}
            />
            <div style={authStyles.passwordField}>
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...authStyles.input, paddingRight: '50px' }}
                required
                disabled={loading}
              />
              <button
                type="button"
                style={authStyles.passwordToggle}
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={loading}
              >
                <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {showPassword ? <><path d="m3 3 18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c5.5 0 9 8 9 8a16 16 0 0 1-2.1 3.2M6.6 6.6C4.4 8.1 3 12 3 12s3.5 8 9 8a9.8 9.8 0 0 0 4.1-.9" /></> : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
                </svg>
              </button>
            </div>
            <div style={authStyles.optionsRow}>
              <label style={authStyles.checkboxLabel}>
                <input type="checkbox" style={authStyles.checkbox} /> Remember me
              </label>
              <a href="#" style={authStyles.forgotPassword}>
                Forgot password?
              </a>
            </div>
            <button
              type="submit"
              style={authStyles.loginButton}
              disabled={loading}
            >
              {loading ? 'Authenticating...' : 'Login'}
            </button>
          </div>
          <p style={authStyles.unifiedNote}>
            *Used by Super Admin, Partner, and Channel Admin.
          </p>
        </form>
      </div>
    </div>
  );
};

// --- Updated Professional Styles (Green/Teal Theme) ---
const authStyles = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: 'Roboto, Arial, sans-serif',
    backgroundImage: `url(${LOGIN_BACKGROUND_IMAGE_URL})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  formSection: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    boxSizing: 'border-box',
    width: '100%',
  },
  formBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.98)', 
    border: '1px solid #E0E0E0',
    borderRadius: '12px',
    padding: '40px',
    width: '100%',
    maxWidth: '420px',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: '#333',
  },
  appTitle: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#1A2A44', 
    marginBottom: '5px',
    textShadow: '1px 1px 2px rgba(0, 0, 0, 0.05)',
  },
  formTitle: {
    fontSize: '18px',
    fontWeight: '400',
    color: '#6B7280', 
    marginBottom: '30px',
    textAlign: 'center',
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  input: {
    width: '100%',
    padding: '14px 18px',
    margin: '10px 0',
    border: '1px solid #DCE0E6',
    borderRadius: '8px',
    backgroundColor: '#F8F9FA', 
    color: '#333',
    fontSize: '1rem',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  },
  passwordField: { position: 'relative', width: '100%' },
  passwordToggle: { position: 'absolute', top: '50%', right: '14px', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px', border: 'none', background: 'transparent', color: '#64748B', cursor: 'pointer' },
  optionsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginTop: '10px',
    marginBottom: '20px',
    fontSize: '0.9rem',
  },
  checkboxLabel: {
    color: '#6B7280',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  checkbox: { 
    marginRight: '5px', 
    transform: 'scale(1.1)' 
  },
  forgotPassword: {
    color: '#00A896', // Teal Link
    textDecoration: 'none',
    fontWeight: '600',
    transition: 'color 0.3s ease',
  },
  loginButton: {
    width: '100%',
    padding: '16px',
    marginTop: '15px',
    border: 'none',
    borderRadius: '8px',
    backgroundColor: '#00A896', // Teal Button
    color: 'white',
    fontSize: '1.1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0, 168, 150, 0.4)',
    transition: 'background-color 0.3s ease, transform 0.1s',
  },
  errorText: {
    color: '#E74C3C',
    fontSize: '0.9rem',
    fontWeight: '500',
    marginBottom: '10px',
    textAlign: 'center',
    padding: '8px',
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    borderRadius: '6px',
  },
  unifiedNote: {
      fontSize: '12px',
      color: '#95A5A6',
      marginTop: '15px',
      textAlign: 'center',
      borderTop: '1px solid #EEE',
      paddingTop: '10px',
  }
};

export default AuthScreen;
