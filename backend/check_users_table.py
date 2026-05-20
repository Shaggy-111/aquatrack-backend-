import sqlite3

conn = sqlite3.connect("backend/aqua_track.db")
cursor = conn.cursor()

cursor.execute("PRAGMA table_info(users)")
columns = cursor.fetchall()

print("Users Table Columns:")
for column in columns:
    print(column[1])  # column[1] = column name
