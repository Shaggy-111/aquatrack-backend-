from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from .database.db import Base, engine
from .scheduler import scheduler
from threading import Thread
# ROUTERS
from .routes.channel_admin import router as channel_admin_router
from .routes import bottle as bottle_route
from .routes import report as reports_route
from .routes import delivery_reports
from .routes import store_reports
from .routes import attendance as attendance_route
from .routes import vendor_license

from .routes.delivery_manager import router as delivery_manager_router
from backend.utils.auto_order_runner import run_auto_order
from backend.utils.google_sheet_auto_sync import run_google_sheet_sync


from .routes import (
    user as user_route,
    admin as admin_route,
    delivery_routes,
    customer as customer_route,
    commercial as commercial_route,
    region as region_route,
    partners as partners_route,
    store as store_route,
    orders as orders_route,
    forgot_password,
    complaints as complaints_route,
)

# ✅ Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="AquaTrack API")

# -----------------------------
# CORS
# -----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://veekayaquatech.com",
        "https://www.veekayaquatech.com",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# Uploads
# -----------------------------
UPLOADS_DIR = "uploads"
if not os.path.exists(UPLOADS_DIR):
    os.makedirs(UPLOADS_DIR)

app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

# -----------------------------
# ROUTES
# -----------------------------
app.include_router(user_route.router, tags=["User"], prefix="/users")
app.include_router(admin_route.router, tags=["Admin"], prefix="/admin")
app.include_router(delivery_routes.router, tags=["Delivery"], prefix="/delivery")
app.include_router(customer_route.router, tags=["Customer"], prefix="/customer")
app.include_router(commercial_route.router, tags=["Commercial"], prefix="/commercial")
app.include_router(region_route.router, tags=["Region"], prefix="/region")
app.include_router(partners_route.router, tags=["Partners"], prefix="/partners")

app.include_router(store_route.router, tags=["Store"])
app.include_router(attendance_route.router, tags=["Attendance"])
app.include_router(orders_route.router, tags=["Orders"])

app.include_router(
    vendor_license.router,
    tags=["Vendor License"],
    prefix="/vendor-license"
)

app.include_router(
    channel_admin_router,
    tags=["Channel Admin"],
    prefix="/channel-admin"
)

app.include_router(forgot_password.router, tags=["Auth & OTP"], prefix="/auth")
app.include_router(bottle_route.router, tags=["Bottle"], prefix="/bottle")
app.include_router(complaints_route.router, tags=["Complaints"], prefix="/complaints")
app.include_router(reports_route.router, tags=["Reports"], prefix="/reports")

app.include_router(delivery_reports.router)
app.include_router(store_reports.router)

# -----------------------------
# ROOT
# -----------------------------
@app.get("/")
def root():
    return {"message": "Welcome to AquaTrack Backend API!"}

# -----------------------------
# STARTUP EVENT
# -----------------------------
@app.on_event("startup")
def start_scheduler():

    if not scheduler.running:
        scheduler.start()

        # Auto Order
        run_auto_order()

        # Google Sheet Sync in separate thread
        print("🚀 Starting Google Sheet Sync...")
        Thread(target=run_google_sheet_sync).start()

    print("✅ Scheduler started")
# -----------------------------
# RUN
# -----------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8080)),
        reload=False,
    )