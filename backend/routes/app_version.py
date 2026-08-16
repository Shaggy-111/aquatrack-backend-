from fastapi import APIRouter

router = APIRouter(
    prefix="/app",
    tags=["App Version"]
)

LATEST_VERSION = "1.31"   # 👈 Current latest app version

@router.get("/version")
def get_app_version():
    return {
        "latest_version": LATEST_VERSION,
        "force_update": False,
        "playstore_url": "https://play.google.com/store/apps/details?id=com.myaquatrackapp"
    }