import React, { useEffect, useState } from "react";
import { API_BASE_URL } from "../config";

import logo from "../assets/logo.png";

const VendorInfo = () => {
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          console.log("LAT:", lat, "LNG:", lng);

          const res = await fetch(
            `${API_BASE_URL}/vendor-license/by-location?lat=${lat}&lng=${lng}`
          );

          const data = await res.json();

          console.log("API RESPONSE:", data);

          if (!res.ok) {
            setVendor({
              vendor_name: "N/A",
              license_number: "N/A",
              state: data.detail?.replace("No vendor found for ", "") || "Unknown"
            });
          } else {
            setVendor(data);
          }

        } catch (err) {
          console.error(err);
          setError("Failed to fetch vendor data");
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.error(err);
        setError("Location permission denied");
        setLoading(false);
      }
    );
  }, []);

  // --- START UI ---

  const uiStyles = {
    // --- Overall Container ---
    container: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      backgroundColor: '#f8f9fa', // A clean, light background
      fontFamily: "'Inter', sans-serif", // Modern Font
      color: '#333'
    },
    
    // --- Header Section ---
    header: {
      backgroundColor: '#ffffff',
      padding: '20px',
      borderBottom: '1px solid #e1e1e1',
      textAlign: 'center',
    },
    logo: {
      maxWidth: '120px', // Adjust size as needed
      marginBottom: '15px',
    },
    pageTitle: {
      fontSize: '24px',
      fontWeight: '700',
      color: '#800000', // Maroon from your logo
      marginTop: 0,
      marginBottom: 0
    },

    // --- Content / Card Section ---
    content: {
      flex: 1, // Push the footer down
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '20px'
    },
    card: {
      width: '100%',
      maxWidth: '450px',
      backgroundColor: '#ffffff',
      padding: '30px',
      borderRadius: '16px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.08)', // Soft shadow
      border: '1px solid #eee'
    },
    vendorName: {
      fontSize: '22px',
      fontWeight: '600',
      color: '#333',
      marginTop: 0,
      marginBottom: '15px'
    },
    infoText: {
      fontSize: '16px',
      margin: '8px 0',
      color: '#555',
    },
    stateText: {
      fontSize: '16px',
      margin: '8px 0',
      color: '#555',
      display: 'flex', // If you add an icon
      alignItems: 'center',
      gap: '8px'
    },
    icon: {
      // styles for potential icons like 📍 or 🪪
    },

    // --- Status Section ---
    statusFound: {
      backgroundColor: '#f0fff4',
      borderLeft: '4px solid #38a169',
      padding: '10px 15px',
      borderRadius: '8px',
      marginBottom: '20px'
    },
    statusNotFound: {
      backgroundColor: '#fff5f5',
      borderLeft: '4px solid #e53e3e',
      padding: '10px 15px',
      borderRadius: '8px',
      marginBottom: '20px'
    },
    statusText: {
      margin: 0,
      fontWeight: '600',
      color: '#c53030', // Red-ish for error
    },

    // --- Footer Section ---
    footer: {
      backgroundColor: '#800000', // Maroon background
      color: '#ffffff',
      textAlign: 'center',
      padding: '30px 20px',
      fontSize: '14px',
      lineHeight: '1.6',
    },
    contactLine: {
      maxWidth: '600px',
      margin: '0 auto', // Center the text block
    }
  };

  // Define potential icons (as simple strings for this example)
  const iconState = '📍';
  const iconLicense = '🪪';
  const iconNoVendor = '❌';

  // Handling different screens within the container
  let mainContent;
  if (loading) {
    mainContent = (
      <div style={uiStyles.content}>
        <h2>Loading...</h2>
      </div>
    );
  } else if (error) {
    mainContent = (
      <div style={uiStyles.content}>
        <div style={uiStyles.card}>
          <div style={uiStyles.statusNotFound}>
            <p style={uiStyles.statusText}>
              {iconNoVendor} Location error
            </p>
          </div>
          <p style={uiStyles.infoText}>{error}</p>
        </div>
      </div>
    );
  } else if (!vendor) {
    mainContent = (
      <div style={uiStyles.content}>
        <h2>No vendor data available</h2>
      </div>
    );
  } else {
    // THIS IS THE MAIN VIEW
    mainContent = (
      <div style={uiStyles.content}>
        <div style={uiStyles.card}>
          
          {/* Status Message */}
          {vendor.license_number === "N/A" ? (
            <div style={uiStyles.statusNotFound}>
              <p style={uiStyles.statusText}>
                {iconNoVendor} No Vendor Found in this State
              </p>
            </div>
          ) : (
             <div style={uiStyles.statusFound}>
              <p style={{...uiStyles.statusText, color: '#2f855a'}}>
                ✅ Vendor Found
              </p>
            </div>
          )}

          {/* Vendor Details */}
          <h2 style={uiStyles.vendorName}>
            {vendor.vendor_name === "N/A" ? "Vendor Not Found" : vendor.vendor_name}
          </h2>

          <p style={uiStyles.infoText}>
            {iconLicense} License: {vendor.license_number === "N/A" ? "No record found" : vendor.license_number}
          </p>

          <p style={uiStyles.stateText}>
            {iconState} State: <strong>{vendor.state}</strong>
          </p>
        </div>
      </div>
    );
  }

  // RETURN THE FINAL COMBINED JSX
  return (
    <div style={uiStyles.container}>
      
      {/* Header Section with Logo */}
      <header style={uiStyles.header}>
        <img src={logo} alt="WaTR AquaTech Logo" style={uiStyles.logo} />
        <h1 style={uiStyles.pageTitle}>Vendor Details</h1>
      </header>

      {/* Main Dynamic Content */}
      {mainContent}

      {/* Footer Section */}
      <footer style={uiStyles.footer}>
        <p style={uiStyles.contactLine}>
          If you want to order, please contact email id - sales@veekayaquatech.com , 9313884986
        </p>
      </footer>
    </div>
  );
};

export default VendorInfo;