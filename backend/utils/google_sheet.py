import pandas as pd
import gspread

from oauth2client.service_account import ServiceAccountCredentials
from openpyxl.utils import get_column_letter


def upload_report_to_sheet(df):

    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive"
    ]

    creds = ServiceAccountCredentials.from_json_keyfile_name(
        "backend/utils/google_service.json",
        scope
    )

    client = gspread.authorize(creds)

    # PERSONAL GOOGLE SHEET
    spreadsheet = client.open_by_key(
        "1vvh6lPFJ4cMqgKP_E34IyWD_fHtblohwWEs9_nP3z7o"
    )

    # TAB NAME
    worksheet = spreadsheet.worksheet("Vk Aqua Tech")

    print("\n📤 Uploading data to PERSONAL Google Sheet...")
    print(f"📊 Total Rows: {len(df)}")

    # datetime convert
    for col in df.select_dtypes(include=['datetime64']).columns:
        df[col] = df[col].astype(str)

    start_row = 1
    start_col = 1

    end_col_letter = get_column_letter(
        start_col + len(df.columns) - 1
    )

    clear_range = f"A{start_row}:{end_col_letter}{start_row + len(df)}"

    # Clear old data
    worksheet.batch_clear([clear_range])

    # Upload new data
    worksheet.update(
        f"A{start_row}",
        [df.columns.values.tolist()] + df.values.tolist()
    )

    print(f"\n✅ Successfully updated Google Sheet with {len(df)} rows")