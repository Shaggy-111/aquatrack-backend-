import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AuthScreen from './pages/AuthScreen';
import SuperAdminDashboard from './SuperAdminDashboard';
import PartnerDashboard from './PartnerDashboard'; 
import Attendance from './attendance';
import VendorInfo from './pages/VendorInfo';

// Import the new ChannelAdminDashboard component (to be created next)
import ChannelAdminDashboard from './ChannelAdminDashboard'; 
import DeliveryManagerDashboard from './DeliveryManagerDashboard';
// NOTE: LoginScreen is now redundant/unused in the new flow, but kept as a placeholder if needed.

const App = () => {
  return (
    <Routes>
      
      {/* 1. UNIFIED LOGIN ENTRY POINT */}
      {/* This component will handle all roles (Super Admin, Partner, Channel Admin) */}
      <Route path="/login" element={<AuthScreen />} />
      
      {/* 2. DASHBOARD ROUTES */}
      <Route path="/dashboard/superadmin" element={<SuperAdminDashboard />} />
      <Route path="/dashboard/partner" element={<PartnerDashboard />} />
      
      {/* ⭐ 3. NEW CHANNEL ADMIN DASHBOARD ROUTE ⭐ */}
      <Route path="/dashboard/channeladmin" element={<ChannelAdminDashboard />} />
      <Route path="/dashboard/deliverymanager" element={<DeliveryManagerDashboard />} />
      <Route path="/attendance" element={<Attendance />} />
      
      {/* 4. DEFAULT ROUTE: Redirects root path to the unified login page */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/vendor-info" element={<VendorInfo />} />

      {/* ❌ The old /login/:role route is removed */}
      {/* ❌ The old /roles route (LoginScreen) is no longer needed/routed */}
      
    </Routes>
  );
};

export default App;