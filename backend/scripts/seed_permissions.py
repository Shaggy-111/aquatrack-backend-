from backend.database.db import SessionLocal
from backend.utils.permission_seeder import seed_default_permissions


def main():
    db = SessionLocal()
    try:
        result = seed_default_permissions(db)
        print(result)
        return result
    finally:
        db.close()


if __name__ == "__main__":
    main()
