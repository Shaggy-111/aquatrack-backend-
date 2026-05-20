import os
import smtplib
from dotenv import load_dotenv
from email.mime.text import MIMEText

# Load environment variables from the .env file in the current directory
load_dotenv()

# Email configuration
# Make sure your .env file has EMAIL_USER and EMAIL_PASS
SENDER_EMAIL = os.getenv("EMAIL_USER")
SENDER_PASSWORD = os.getenv("EMAIL_PASS")
RECEIVER_EMAIL = "your-email@example.com" # Replace with your email for testing

# Check if environment variables were loaded
if not SENDER_EMAIL or not SENDER_PASSWORD:
    print("Error: EMAIL_USER or EMAIL_PASS not found in .env file.")
else:
    # Create the email content
    subject = "Test Email from AquaTrack"
    body = "This is a test email sent from your AquaTrack application."
    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = SENDER_EMAIL
    msg["To"] = RECEIVER_EMAIL

    try:
        # Connect to the SMTP server (Gmail example)
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(SENDER_EMAIL, SENDER_PASSWORD)
            server.sendmail(SENDER_EMAIL, RECEIVER_EMAIL, msg.as_string())
        print("Test email sent successfully!")
    except Exception as e:
        print(f"Failed to send email. Error: {e}")
