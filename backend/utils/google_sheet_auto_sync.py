from datetime import datetime, timedelta
from io import BytesIO
import pandas as pd
import asyncio
import traceback

from backend.database.db import SessionLocal
from backend.routes.report import export_monthly_pivot
from backend.models.user import User, RoleEnum
from backend.utils.google_sheet import upload_report_to_sheet


def run_google_sheet_sync():
    db = SessionLocal()

    try:
        # D-7 Logic
        today = datetime.now().date()

        to_date = today - timedelta(days=7)

        from_date = to_date.replace(day=1)

        print(f"\n📅 Report Range: {from_date} → {to_date}")

        # Dummy Super Admin User
        dummy_user = User(
            id=1,
            role=RoleEnum.superadmin
        )

        # Existing export function call
        response = asyncio.run(
            export_monthly_pivot(
                from_date=from_date.strftime("%Y-%m-%d"),
                to_date=to_date.strftime("%Y-%m-%d"),
                channel="ZEPTO",
                state=None,
                city=None,
                db=db,
                current_user=dummy_user
            )
        )

        # Read Excel bytes from StreamingResponse
        excel_bytes = b""

        async def collect():
            nonlocal excel_bytes

            async for chunk in response.body_iterator:
                excel_bytes += chunk

        asyncio.run(collect())

        # Convert Excel to DataFrame
        df = pd.read_excel(BytesIO(excel_bytes))

        print("\n========== DATAFRAME DEBUG ==========")

        print("\n📌 LAST 20 ROWS:")
        print(df.tail(20))

        print("\n📌 TOTAL ROWS:")
        print(len(df))

        print("\n📌 COLUMNS:")
        print(df.columns)

        # Check if report is empty
        if df.empty:
            print("\n⚠️ No report data found.")
            return

        # Replace NaN values with empty strings
        df = df.fillna("")

        # Upload exact same report to Google Sheet
        upload_report_to_sheet(df)

        print("\n✅ Google Sheet Auto Synced Successfully\n")

    except Exception as e:

        print("\n❌ Google Sheet Sync Failed\n")

        traceback.print_exc()

    finally:
        db.close()


if __name__ == "__main__":
    run_google_sheet_sync()