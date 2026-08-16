from io import BytesIO
import uuid

import cloudinary.uploader
import qrcode
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..attendance_time import ist_today
from ..database.db import get_db
from ..models.store import Store
from ..models.store_qr_delivery_submission import StoreQrDeliverySubmission
from ..models.user import RoleEnum, User
from ..schemas.store_qr_delivery import (
    StoreQrAdminResponse,
    StoreQrPendingOrderContext,
    StoreQrScanResponse,
    StoreQrStatusUpdate,
    StoreQrStoreContext,
    StoreQrSubmissionResponse,
)
from ..services.store_qr_delivery import (
    get_scan_context,
    submission_response,
    submit_store_qr_delivery,
)
from ..utils.jwt import get_current_user
from ..utils.store_qr_rate_limit import scan_rate_limiter, submit_rate_limiter
from ..utils.store_qr_public_url import build_store_qr_public_url
from ..utils.store_qr_tokens import (
    StoreQrTokenError,
    create_store_qr_token,
    create_submission_token,
    decode_store_qr_token,
    decode_submission_token,
)


router = APIRouter(prefix="/store-qr", tags=["Store QR Delivery"])
ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _super_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can manage Store QR codes.",
        )
    return current_user


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _qr_url(request: Request, token: str) -> str:
    return build_store_qr_public_url(token, settings.STORE_QR_PUBLIC_BASE_URL)


def _admin_qr_response(request: Request, store: Store) -> StoreQrAdminResponse:
    token = create_store_qr_token(store.qr_public_id, store.qr_token_version)
    return StoreQrAdminResponse(
        store_id=store.id,
        qr_token_version=store.qr_token_version,
        qr_enabled=store.qr_enabled,
        qr_url=_qr_url(request, token),
        qr_token=token,
    )


def _decode_permanent_token(token: str) -> dict:
    try:
        return decode_store_qr_token(token)
    except StoreQrTokenError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _decode_short_token(token: str) -> dict:
    try:
        return decode_submission_token(token)
    except StoreQrTokenError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


async def _upload_photo(photo: UploadFile) -> tuple[str, str]:
    content_type = (photo.content_type or "").lower()
    if content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Photo must be JPEG, PNG, or WebP.",
        )

    content = await photo.read(settings.STORE_QR_PHOTO_MAX_BYTES + 1)
    await photo.close()
    if len(content) > settings.STORE_QR_PHOTO_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Photo is too large.")

    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Invalid photo.") from exc

    public_id = f"store_qr_{uuid.uuid4()}"
    try:
        result = await run_in_threadpool(
            cloudinary.uploader.upload,
            BytesIO(content),
            resource_type="image",
            type="upload",
            folder="aquatrack/store-qr-deliveries",
            public_id=public_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Photo upload is temporarily unavailable.",
        ) from exc
    return result["secure_url"], result["public_id"]


async def _delete_uploaded_photo(public_id: str) -> None:
    try:
        await run_in_threadpool(
            cloudinary.uploader.destroy,
            public_id,
            resource_type="image",
        )
    except Exception:
        pass


@router.get(
    "/admin/stores/{store_id}",
    response_model=StoreQrAdminResponse,
)
def get_store_qr(
    store_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(_super_admin),
):
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Store not found.")
    return _admin_qr_response(request, store)


@router.get("/admin/stores/{store_id}/image")
def download_store_qr(
    store_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(_super_admin),
):
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Store not found.")

    token = create_store_qr_token(store.qr_public_id, store.qr_token_version)
    image = qrcode.make(_qr_url(request, token))
    output = BytesIO()
    image.save(output, format="PNG")
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="image/png",
        headers={
            "Content-Disposition": f'attachment; filename="store-{store.id}-qr.png"'
        },
    )


@router.post(
    "/admin/stores/{store_id}/rotate",
    response_model=StoreQrAdminResponse,
)
def rotate_store_qr(
    store_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(_super_admin),
):
    store = (
        db.query(Store)
        .filter(Store.id == store_id)
        .with_for_update()
        .first()
    )
    if not store:
        raise HTTPException(status_code=404, detail="Store not found.")
    store.qr_token_version += 1
    store.qr_enabled = True
    db.commit()
    db.refresh(store)
    return _admin_qr_response(request, store)


@router.patch(
    "/admin/stores/{store_id}/status",
    response_model=StoreQrAdminResponse,
)
def update_store_qr_status(
    store_id: str,
    payload: StoreQrStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(_super_admin),
):
    store = (
        db.query(Store)
        .filter(Store.id == store_id)
        .with_for_update()
        .first()
    )
    if not store:
        raise HTTPException(status_code=404, detail="Store not found.")
    store.qr_enabled = payload.qr_enabled
    db.commit()
    db.refresh(store)
    return _admin_qr_response(request, store)


@router.get("/scan/{qr_token}", response_model=StoreQrScanResponse)
def scan_store_qr(
    qr_token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    client_ip = _client_ip(request)
    if not scan_rate_limiter.allow(client_ip):
        raise HTTPException(status_code=429, detail="Too many QR requests.")

    claims = _decode_permanent_token(qr_token)
    store, eligible_order = get_scan_context(db, claims["qid"])
    if store.qr_token_version != claims["ver"]:
        raise HTTPException(status_code=410, detail="Store QR has been rotated.")

    submission_token, idempotency_key, _ = create_submission_token(
        store.qr_public_id,
        store.qr_token_version,
    )
    expected_quantity = None
    if eligible_order and str(eligible_order.order_details).isdigit():
        expected_quantity = int(eligible_order.order_details)

    return StoreQrScanResponse(
        store=StoreQrStoreContext(
            name=store.store_name,
            city=store.city,
            channel=store.channel,
        ),
        pending_order=StoreQrPendingOrderContext(
            exists=eligible_order is not None,
            expected_quantity=expected_quantity,
        ),
        submission_token=submission_token,
        idempotency_key=idempotency_key,
        expires_in_seconds=settings.STORE_QR_SUBMISSION_TOKEN_MINUTES * 60,
        business_date=ist_today(),
    )


@router.post("/submit", response_model=StoreQrSubmissionResponse)
async def submit_qr_delivery(
    request: Request,
    submission_token: str = Form(...),
    idempotency_key: str = Form(...),
    bottles_delivered: int = Form(...),
    empty_bottles_collected: int = Form(...),
    remarks: str | None = Form(None),
    delivered_by: str | None = Form(None),
    latitude: float | None = Form(None),
    longitude: float | None = Form(None),
    gps_accuracy: float | None = Form(None),
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    client_ip = _client_ip(request)
    if not submit_rate_limiter.allow(client_ip):
        raise HTTPException(status_code=429, detail="Too many QR submissions.")
    if not 1 <= bottles_delivered <= 99:
        raise HTTPException(
            status_code=400,
            detail="Delivered bottles must be between 1 and 99.",
        )
    if empty_bottles_collected < 0:
        raise HTTPException(
            status_code=400,
            detail="Empty bottles collected must be non-negative.",
        )
    if remarks and len(remarks) > 2000:
        raise HTTPException(status_code=400, detail="Remarks are too long.")
    if delivered_by and len(delivered_by) > 255:
        raise HTTPException(status_code=400, detail="Delivered-by name is too long.")
    if latitude is not None and not -90 <= latitude <= 90:
        raise HTTPException(status_code=400, detail="Invalid latitude.")
    if longitude is not None and not -180 <= longitude <= 180:
        raise HTTPException(status_code=400, detail="Invalid longitude.")
    if gps_accuracy is not None and gps_accuracy < 0:
        raise HTTPException(status_code=400, detail="Invalid GPS accuracy.")
    try:
        uuid.UUID(idempotency_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid idempotency key.") from exc

    claims = _decode_short_token(submission_token)
    if claims["idem"] != idempotency_key:
        raise HTTPException(status_code=401, detail="Submission token mismatch.")

    replay = (
        db.query(StoreQrDeliverySubmission)
        .filter(
            StoreQrDeliverySubmission.idempotency_key == idempotency_key,
            StoreQrDeliverySubmission.token_jti == claims["jti"],
        )
        .first()
    )
    if replay:
        return submission_response(replay)

    get_scan_context(db, claims["qid"])
    photo_url = None
    photo_public_id = None
    if photo:
        photo_url, photo_public_id = await _upload_photo(photo)

    try:
        return submit_store_qr_delivery(
            db,
            qr_public_id=claims["qid"],
            qr_token_version=claims["ver"],
            idempotency_key=idempotency_key,
            token_jti=claims["jti"],
            bottles_delivered=bottles_delivered,
            empty_bottles_collected=empty_bottles_collected,
            photo_url=photo_url,
            remarks=remarks,
            delivered_by=delivered_by,
            source_ip=client_ip,
            user_agent=request.headers.get("user-agent"),
            latitude=latitude,
            longitude=longitude,
            gps_accuracy=gps_accuracy,
        )
    except IntegrityError:
        db.rollback()
        replay = (
            db.query(StoreQrDeliverySubmission)
            .filter(
                StoreQrDeliverySubmission.idempotency_key == idempotency_key,
                StoreQrDeliverySubmission.token_jti == claims["jti"],
            )
            .first()
        )
        if replay:
            if photo_public_id:
                await _delete_uploaded_photo(photo_public_id)
            return submission_response(replay)
        if photo_public_id:
            await _delete_uploaded_photo(photo_public_id)
        raise HTTPException(status_code=409, detail="Duplicate QR submission.")
    except Exception:
        db.rollback()
        if photo_public_id:
            await _delete_uploaded_photo(photo_public_id)
        raise
