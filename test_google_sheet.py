import pandas as pd

from backend.utils.google_sheet import upload_report_to_sheet


data = {
    "Store": ["Store A", "Store B"],
    "Orders": [10, 20],
    "Pending": [2, 5]
}

df = pd.DataFrame(data)

upload_report_to_sheet(df)