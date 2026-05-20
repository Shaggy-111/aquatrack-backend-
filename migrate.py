import sqlite3
import psycopg2
import re

# -----------------------------
# CONNECTIONS
# -----------------------------
sqlite_conn = sqlite3.connect('aqua_track_LATEST_APRIL.db')
sqlite_cur = sqlite_conn.cursor()

pg_conn = psycopg2.connect(
    "postgres://aquatrack_prod_final:Ov0yWjhmMG2AIHK@localhost:5432/aquatrack_prod_final"
)
pg_cur = pg_conn.cursor()

# -----------------------------
# CLEAN SQL (FIXED)
# -----------------------------
def clean_sql(sql):
    sql = sql.replace('DATETIME', 'TIMESTAMP')
    sql = sql.replace('AUTOINCREMENT', '')
    sql = sql.replace('INTEGER PRIMARY KEY', 'SERIAL PRIMARY KEY')

    # ❌ REMOVE WRONG CONVERSIONS
    # NO INTEGER → TEXT
    # NO BOOLEAN → TEXT

    # Optional cleanup
    sql = re.sub(r'VARCHAR\(\d+\)', 'TEXT', sql, flags=re.IGNORECASE)

    return sql

# -----------------------------
# MIGRATION FUNCTION
# -----------------------------
def migrate():
    print("🚀 Starting Migration...")

    # Disable FK checks
    pg_cur.execute("SET session_replication_role = 'replica';")

    ordered_tables = [
        'regions', 'users', 'stores',
        'otps', 'bottles', 'reports', 'transactions',
        'complaints', 'partner_stores', 'orders',
        'attendance', 'leaves', 'holidays',
        'vendor_licenses', 'vendor_mapping'
    ]

    sqlite_cur.execute("""
        SELECT name, sql 
        FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%';
    """)
    sqlite_table_map = {name: sql for name, sql in sqlite_cur.fetchall()}

    for table_name in ordered_tables:
        if table_name not in sqlite_table_map:
            continue

        print(f"\n🔄 Processing: {table_name}")

        try:
            create_sql = sqlite_table_map[table_name]

            # -----------------------------
            # CREATE TABLE IF NOT EXISTS
            # -----------------------------
            pg_cur.execute(f"""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = '{table_name.lower()}'
                );
            """)

            if not pg_cur.fetchone()[0]:
                print(f"   🏗 Creating table: {table_name}")
                pg_cur.execute(clean_sql(create_sql))
                pg_conn.commit()

            # -----------------------------
            # FETCH DATA
            # -----------------------------
            sqlite_cur.execute(f"SELECT * FROM {table_name}")
            rows = sqlite_cur.fetchall()

            if not rows:
                print(f"   ⚠️ No data")
                continue

            # -----------------------------
            # INSERT DATA (NO STRING FORCE)
            # -----------------------------
            placeholders = ', '.join(['%s'] * len(rows[0]))

            insert_query = f"""
                INSERT INTO {table_name}
                VALUES ({placeholders})
                ON CONFLICT DO NOTHING
            """

            pg_cur.executemany(insert_query, rows)
            pg_conn.commit()

            print(f"   ✅ Inserted {len(rows)} rows")

        except Exception as e:
            pg_conn.rollback()
            print(f"   ❌ Error in {table_name}: {e}")

    # Enable FK checks
    pg_cur.execute("SET session_replication_role = 'origin';")
    pg_conn.commit()

    print("\n🎉 MIGRATION COMPLETED SUCCESSFULLY!")

# -----------------------------
# RUN
# -----------------------------
if __name__ == "__main__":
    migrate()