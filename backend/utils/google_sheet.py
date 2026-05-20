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

    spreadsheet = client.open_by_key(
        "15fgbGcK1T3q20wGJT_i63DqvL7dNCH9GrgRHbe84QL4"
    )

    worksheet = spreadsheet.worksheet("Vk Aqua Tech")

    # datetime convert
    for col in df.select_dtypes(include=['datetime64']).columns:
        df[col] = df[col].astype(str)

    start_row = 1
    start_col = 1

    end_col_letter = get_column_letter(
        start_col + len(df.columns) - 1
    )

    clear_range = f"A{start_row}:{end_col_letter}{start_row + len(df)}"

    worksheet.batch_clear([clear_range])

    worksheet.update(
        f"A{start_row}",
        [df.columns.values.tolist()] + df.values.tolist()
    )

    print(f"Successfully updated Google Sheet with {len(df)} rows")