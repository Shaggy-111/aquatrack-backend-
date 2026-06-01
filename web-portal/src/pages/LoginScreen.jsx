import React from 'react';
import { useNavigate } from 'react-router-dom';
// Removed: Importing the image file directly from the filesystem.
// Instead, we will reference the uploaded image's accessible URL directly.

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    width: '100%',
    // 🎨 Updated: Use the direct URL to the uploaded image as the background
    backgroundImage: `url(uploaded:image_2f0953.jpg)`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    color: 'white',
    textAlign: 'center',
    padding: '2rem',
  },
  title: {
    fontSize: '3rem',
    fontWeight: 'bold',
    marginBottom: '1rem',
    textShadow: '2px 2px 4px rgba(0, 0, 0, 0.38)',
  },
  question: {
    fontSize: '1.5rem',
    fontWeight: 'normal',
    marginBottom: '2rem',
    textShadow: '1px 1px 2px rgba(0, 0, 0, 0.5)',
  },
  buttonContainer: {
    display: 'flex',
    gap: '20px',
    // 🎨 New: Adding a blue background to the button container to make the text more readable
    backgroundColor: 'rgba(0, 191, 255, 0.2)',
    padding: '20px',
    borderRadius: '10px',
    backdropFilter: 'blur(5px)',
  },
  roleButton: {
    padding: '1rem 2rem',
    backgroundColor: 'rgba(0, 191, 255, 0.8)',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '1.2rem',
    fontWeight: 'bold',
    color: 'white',
    transition: 'background-color 0.3s ease',
  },
  roleButtonHover: {
    backgroundColor: '#007ACC',
  },
};

const LoginScreen = () => {
  const navigate = useNavigate();

  const handleRoleSelect = (role) => {
    navigate(`/login/${role}`);
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Welcome to AquaTrack</h1>
      <h2 style={styles.question}>Login as:</h2>
      <div style={styles.buttonContainer}>
        <button
          style={styles.roleButton}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = styles.roleButtonHover.backgroundColor)}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = styles.roleButton.backgroundColor)}
          onClick={() => handleRoleSelect('superadmin')}
        >
          Super Admin
        </button>
        <button
          style={styles.roleButton}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = styles.roleButtonHover.backgroundColor)}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = styles.roleButton.backgroundColor)}
          onClick={() => handleRoleSelect('partner')}
        >
          Partner
        </button>
      </div>
    </div>
  );
};

export default LoginScreen;
