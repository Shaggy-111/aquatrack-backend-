import React, { useState, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "./config";

const Attendance = () => {
  const [loading, setLoading] = useState(true);
  const [attendance, setAttendance] = useState(null);
  const [location, setLocation] = useState(null);
  const [status, setStatus] = useState("");

  const token = localStorage.getItem("auth_token");

  // 📍 GET LOCATION
  const getLocation = () => {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        },
        (err) => reject(err)
      );
    });
  };

  // 📥 FETCH TODAY ATTENDANCE
  const fetchAttendance = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/attendance/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAttendance(res.data);
    } catch (err) {
      console.log("No attendance yet");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendance();
  }, []);

  // ✅ CHECK-IN
  const handleCheckIn = async () => {
    try {
      setStatus("Getting location...");
      const loc = await getLocation();

      await axios.post(
        `${API_BASE_URL}/attendance/check-in`,
        {
          latitude: loc.latitude,
          longitude: loc.longitude,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      setStatus("✅ Checked In");
      fetchAttendance();
    } catch (err) {
      setStatus("❌ Check-in failed");
    }
  };

  // ✅ CHECK-OUT
  const handleCheckOut = async () => {
    try {
      setStatus("Getting location...");
      const loc = await getLocation();

      await axios.post(
        `${API_BASE_URL}/attendance/check-out`,
        {
          latitude: loc.latitude,
          longitude: loc.longitude,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      setStatus("✅ Checked Out");
      fetchAttendance();
    } catch (err) {
      setStatus("❌ Check-out failed");
    }
  };

  if (loading) return <p style={styles.loading}>Loading...</p>;

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>📅 Attendance</h2>

      {/* STATUS CARD */}
      <div style={styles.card}>
        <p><strong>Status:</strong> {attendance ? attendance.status : "Not Marked"}</p>
        <p><strong>Check-In:</strong> {attendance?.check_in_time || "-"}</p>
        <p><strong>Check-Out:</strong> {attendance?.check_out_time || "-"}</p>
        <p><strong>Working Hours:</strong> {attendance?.working_hours || 0} hrs</p>
      </div>

      {/* ACTION BUTTONS */}
      <div style={styles.buttonContainer}>
        {!attendance?.check_in_time && (
          <button style={styles.checkInBtn} onClick={handleCheckIn}>
            Check In
          </button>
        )}

        {attendance?.check_in_time && !attendance?.check_out_time && (
          <button style={styles.checkOutBtn} onClick={handleCheckOut}>
            Check Out
          </button>
        )}
      </div>

      <p style={styles.status}>{status}</p>
    </div>
  );
};

export default Attendance;

const styles = {
  container: {
    padding: "30px",
    textAlign: "center",
  },
  title: {
    fontSize: "28px",
    marginBottom: "20px",
  },
  card: {
    background: "#f5f7fa",
    padding: "20px",
    borderRadius: "12px",
    width: "300px",
    margin: "auto",
    boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
    lineHeight: "1.8",
  },
  buttonContainer: {
    marginTop: "20px",
  },
  checkInBtn: {
    background: "#4CAF50",
    color: "white",
    padding: "12px 20px",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "16px",
  },
  checkOutBtn: {
    background: "#f44336",
    color: "white",
    padding: "12px 20px",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "16px",
  },
  status: {
    marginTop: "15px",
    fontWeight: "bold",
  },
  loading: {
    textAlign: "center",
    marginTop: "50px",
  },
};