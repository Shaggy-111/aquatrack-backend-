from backend.database.db import SessionLocal, engine, Base
from backend.models.store import Store
from sqlalchemy import text
from datetime import datetime

# ------------------------------
# 1. Reset the stores table
# ------------------------------
def reset_table():
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS stores"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    print("✅ Stores table recreated successfully!")


# ------------------------------
# 2. Insert all stores
# ------------------------------
def restore_stores():
    db = SessionLocal()

    stores = [
        {"store_name": "Ss Gurgaon Sector 49 Es3", "address": "ss gurgaon sector 49 ES3 ground floor,vatika city market ,block w ,sector 49,guugram haryana 122018", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.402599, "longitude": 77.045208},
        {"store_name": "Ss Gurgaon Sector 31 Es97", "address": "ground floor plot no 1302 sector 31 gurugram haryana 122001", "city": "HR-NCR", "state": None, "zip_code": None, "latitude": 28.450576, "longitude": 77.04828},
        {"store_name": "Ss Gurgaon Sector 10 Es91", "address": "22/6/2 Pataudi Road Village Kadipur , Sec 10 A", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.449795, "longitude": 77.001047},
        {"store_name": "Ss Gurgaon Nirvana Country Es44", "address": None, "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.413366, "longitude": 77.072777},
        {"store_name": "Super Store Gurgaon Sector 82 Es52", "address": "Blinkit store sector82 agarwal furniture building near rampura chowk opposite flyover jaipur delhi expressway", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.380702, "longitude": 76.963774},
        {"store_name": "SS Gurgaon Sohna ES123", "address": "Khewat Khatta No 199/222 Mustakil No-39, Killa no- 24(6-8) ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.2806638, "longitude": 77.0670999},
        {"store_name": "Ss Gurgaon Sector 64 Es105", "address": "khatana palace khevat no : 462...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.391852, "longitude": None},
        {"store_name": "Ss Gurgaon Sector 33 Es104", "address": "Khasra No -435, Blinkit store near Gogaji Mandir", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.433495, "longitude": 77.033045},
        {"store_name": "Ss Gurgaon Sector 95 Es93", "address": "GF , Khewat/Khata no. 9/20 ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.424332, "longitude": 76.931625},
        {"store_name": "Ss Gurgaon Sector 62 Es94", "address": None, "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": None, "longitude": None},

        {"store_name": "Ss Gurgaon Sector 37 Es115", "address": "Khewat no. 374,454 ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.452567, "longitude": 76.980006},
        {"store_name": "Ss Gurgaon Sector 45 Es116", "address": "B-1 , Greenwood City sec 45", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.446747, "longitude": 77.061295},
        {"store_name": "Ss Gurgaon Sector 90 Es101", "address": None, "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.391008, "longitude": 76.939453},
        {"store_name": "Ss Gurgaon Sector 7 Es110", "address": "P13 shiv Puri", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.468658, "longitude": 77.015045},
        {"store_name": "Ss Gurgaon New Gwal Pahari Es114", "address": "Mustil No - 7 ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.424721, "longitude": 77.146546},

        {"store_name": "Ss Gurgaon Sector 27 Es118", "address": "557, Oyo town house ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.4630908, "longitude": 77.0936687},
        {"store_name": "Ss Gurgaon Dlf Phase 3 Es119", "address": None, "city": "HR-NCR", "state": None, "zip_code": None, "latitude": 28.490036, "longitude": 77.103805},
        {"store_name": "SS Gurgaon Sector 79 ES121", "address": "89D Ultracon Infrachem ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.353449, "longitude": 76.971335},
        {"store_name": "SS Gurgaon Sector 51 ES129", "address": "Khata no 37/37 ...", "city": "HR-NCR", "state": None, "zip_code": None, "latitude": 28.425922, "longitude": 77.065439},
        {"store_name": "SS Gurgaon Sector 59 ES136", "address": "Khewat No.353, Plot no-129...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.404616, "longitude": 77.106052},

        {"store_name": "SS Gurgaon Sohna 2 ES141", "address": "Near Damdama Road ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.251008, "longitude": 77.07012},
        {"store_name": "SS Gurgaon Sector 39 ES143", "address": "Ground floor,plot no-1302 ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.450576, "longitude": 77.04828},
        {"store_name": "SS Gurgaon Sector 56 ES144", "address": "Sector 56 metro mall basement", "city": "HR-NCR", "state": None, "zip_code": None, "latitude": 28.42873, "longitude": 77.099427},
        {"store_name": "Gurgaon Sector 70 ES145", "address": "Khatuni No-196 ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.386057, "longitude": 77.022119},
        {"store_name": "SS Hisar Sector 13 ES1", "address": "CO No 40 - 41 Sector 13P ...", "city": "Hisar", "state": "Haryana", "zip_code": None, "latitude": 29.1353, "longitude": 75.738431},

        {"store_name": "SS Gurgaon Sector 49 ES147", "address": "sector 49 ES 147 Omaxe ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.413104, "longitude": 77.042585},
        {"store_name": "SS Gurgaon Sushant Lok B Block ES152", "address": None, "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.462812, "longitude": 77.080314},
        {"store_name": "SS Gurgaon Sushant Lok 3 ES149", "address": "Plot No 3545C, Sector 57...", "city": "HR-NCR", "state": None, "zip_code": None, "latitude": 28.422929, "longitude": 77.075508},
        {"store_name": "KS Gurgaon Sector 81 KS49", "address": None, "city": "HR-NCR", "state": None, "zip_code": None, "latitude": None, "longitude": None},
        {"store_name": "SS Gurgaon Sector 29 ES162", "address": "Plot No - 409-410 , Sec - 29...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.473266, "longitude": 77.071147},

        {"store_name": "ES Gurgaon Sector 66 ES168", "address": "Sec- 66 hub badalpur ...", "city": "HR-NCR", "state": "Haryana", "zip_code": None, "latitude": 28.391043, "longitude": 77.056907},
        {"store_name": "SS Karnal Model Town ES6", "address": "Partap Colony ...", "city": "KARNAL", "state": "Haryana", "zip_code": None, "latitude": 29.707897, "longitude": 77.004086},
        {"store_name": "SS Karnal Friends Colony ES7", "address": None, "city": "KARNAL", "state": "Haryana", "zip_code": None, "latitude": None, "longitude": None},
        {"store_name": "SS Hisar Old Sabzi Mandi ES3", "address": None, "city": "Hisar", "state": "Haryana", "zip_code": None, "latitude": None, "longitude": None},
    ]

    for s in stores:
        store = Store(**s)
        db.add(store)

    db.commit()
    db.close()
    print("✅ All 34 stores restored successfully!")


# ------------------------------
# Run everything
# ------------------------------
if __name__ == "__main__":
    reset_table()
    restore_stores()
