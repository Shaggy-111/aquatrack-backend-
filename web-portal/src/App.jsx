import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AuthScreen from './pages/AuthScreen';
import SuperAdminDashboard from './SuperAdminDashboard';
import PartnerDashboard from './PartnerDashboard'; 
import VendorInfo from './pages/VendorInfo';
import Employee from './pages/Employee';
import EmployeeStoreAssignment from "./pages/EmployeeStoreAssignment";
import EmployeePermissions from './pages/EmployeePermissions';
import AttendanceDashboard from "./pages/AttendanceDashboard";
import AttendanceHistory from "./pages/AttendanceHistory";
import LeaveManagement from "./pages/LeaveManagement";
import HolidayManagement from "./pages/HolidayManagement";
import StoreQrDelivery from "./pages/StoreQrDelivery";
// Import the new ChannelAdminDashboard component (to be created next)
import ChannelAdminDashboard from './ChannelAdminDashboard'; 
import DeliveryManagerDashboard from './DeliveryManagerDashboard';
import PermissionPage from './components/PermissionPage';
import { PERMISSIONS } from './permissions';
// NOTE: LoginScreen is now redundant/unused in the new flow, but kept as a placeholder if needed.

const App = () => {
  return (
    <Routes>

      {/* 1. UNIFIED LOGIN ENTRY POINT */}
      {/* This component will handle all roles (Super Admin, Partner, Channel Admin) */}
      <Route path="/login" element={<AuthScreen />} />
      <Route path="/qr/:token" element={<StoreQrDelivery />} />
      
      {/* 2. DASHBOARD ROUTES */}
      <Route path="/dashboard/superadmin" element={<SuperAdminDashboard />} />
      <Route path="/dashboard/partner" element={<PartnerDashboard />} />
      
      {/* ⭐ 3. NEW CHANNEL ADMIN DASHBOARD ROUTE ⭐ */}
      <Route path="/dashboard/channeladmin" element={<ChannelAdminDashboard />} />
      <Route path="/dashboard/deliverymanager" element={<DeliveryManagerDashboard />} />
      <Route path="/dashboard/channel-admin" element={<ChannelAdminDashboard />} />
      <Route path="/dashboard/delivery-manager" element={<DeliveryManagerDashboard />} />
      <Route path="/dashboard/employee" element={<SuperAdminDashboard />} />


      {/* 4. DEFAULT ROUTE: Redirects root path to the unified login page */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/vendor-info" element={<VendorInfo />} />
      <Route path="/employees" element={<PermissionPage permission={PERMISSIONS.USERS_VIEW}><Employee /></PermissionPage>} />
      <Route path="/employees/:employeeId/permissions" element={<PermissionPage permission={PERMISSIONS.USERS_VIEW}><EmployeePermissions /></PermissionPage>} />
      <Route
        path="/employees/:employeeId/stores"
        element={<PermissionPage permission={PERMISSIONS.USERS_VIEW}><EmployeeStoreAssignment /></PermissionPage>}
      />
      <Route
        path="/attendance"
        element={<PermissionPage permission={PERMISSIONS.ATTENDANCE_VIEW}><AttendanceDashboard /></PermissionPage>}
      />
      <Route
        path="/attendance/history"
        element={<PermissionPage permission={PERMISSIONS.ATTENDANCE_VIEW}><AttendanceHistory /></PermissionPage>}
      />
      <Route path="/leave" element={<LeaveManagement />} />
      <Route path="/holidays" element={<PermissionPage permission={PERMISSIONS.ATTENDANCE_VIEW}><HolidayManagement /></PermissionPage>} />
      {/* ❌ The old /login/:role route is removed */}
      {/* ❌ The old /roles route (LoginScreen) is no longer needed/routed */}
      
    </Routes>
  );
};

export default App;
