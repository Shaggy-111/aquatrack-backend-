import os
import random
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

# Load environment variables from the .env file
load_dotenv()

# Use consistent variable names from your .env file
EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASS = os.getenv("EMAIL_PASS")

# --- DEBUGGING LOGS ---
# This will show you what the application is loading
print(f"DEBUG: Loaded EMAIL_USER: {EMAIL_USER}")
# For security, do not print the full password.
# We'll just check if it's loaded.
print(f"DEBUG: EMAIL_PASS is loaded: {bool(EMAIL_PASS)}")
# --- END DEBUGGING LOGS ---


def generate_otp():
    """Generates a 6-digit OTP code."""
    return str(random.randint(100000, 999999))


def send_otp_email(recipient_email, otp):
    """
    Sends an OTP email using Gmail SMTP.
    Checks for required environment variables before attempting to send.
    """
    if not EMAIL_USER or not EMAIL_PASS:
        print("Error: EMAIL_USER or EMAIL_PASS not found in .env file.")
        return False

    try:
        subject = "Your AquaTrack OTP Code"
        body = f"Your OTP code is {otp}. It is valid for 5 minutes."
        msg = MIMEMultipart()
        msg['From'] = EMAIL_USER
        msg['To'] = recipient_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        print("Attempting to connect to SMTP server...")
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            print("TLS connection established. Attempting to log in...")
            server.login(EMAIL_USER, EMAIL_PASS)
            print("Login successful! Attempting to send email...")
            server.sendmail(EMAIL_USER, recipient_email, msg.as_string())
            print(f"OTP sent successfully to {recipient_email}")

        return True

    except smtplib.SMTPAuthenticationError as auth_e:
        print(f"Authentication Error: {auth_e}")
        print("This often means your email or App Password is incorrect.")
        return False
    except Exception as e:
        print(f"General Error sending OTP email: {e}")
        return False
