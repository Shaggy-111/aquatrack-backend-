from fastapi import APIRouter

router = APIRouter(
    prefix="/app",
    tags=["App Version"]
)

@router.get("/version")
def get_app_version():
    return {
        "latest_version": "1.29",
        "force_update": False,
        "playstore_url": "https://play.google.com/store/apps/details?id=com.myaquatrackapp"
    }