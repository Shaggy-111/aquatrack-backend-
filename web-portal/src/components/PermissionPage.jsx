import React from "react";
import usePermissions from "../hooks/usePermissions";
import AccessDenied from "./AccessDenied";

const PermissionPage = ({ permission, children }) => {
  const { loading, hasPermission } = usePermissions();

  if (loading) return <div style={{ padding: 24 }}>Loading permissions...</div>;
  if (!hasPermission(permission)) return <AccessDenied />;
  return children;
};

export default PermissionPage;
