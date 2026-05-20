from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload 
from sqlalchemy import func # Add joinedload for relationships
from typing import List, Optional
from datetime import datetime
import uuid
import csv
import io
import zipfile
import qrcode
from PIL import Image, ImageDraw, ImageFont
from fastapi.responses import StreamingResponse
from ..models.order import Order, OrderStatusEnum

from ..database.db import get_db
from ..models.user import User, RoleEnum
from ..models.store import Store  # This might be needed for the new endpoint
from ..models.partner_store import PartnerStore
from ..models.bottle import Bottle
from ..models.transaction import Transaction
# Import the new schema and existing ones
from ..schemas.bottle import BottleAssignRequest, BottleScanRequest, BottleOut, CollectableBottleOut
from ..utils.jwt import get_current_user

router = APIRouter()


# ---------------------------
# Superadmin: Generate New QR
# ---------------------------
@router.post("/superadmin/generate-qr")
def generate_qr(
    count: int = 1,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Generates 1 or multiple new bottle QR codes.
    Usage:
      /bottle/superadmin/generate-qr?count=10
    """
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only superadmins can generate QRs.")

    if count <= 0:
        raise HTTPException(status_code=400, detail="Count must be at least 1.")

    created_items = []

    for _ in range(count):
        new_uuid = str(uuid.uuid4())
        qr_code_string = f"qr-{new_uuid[:8]}"

        bottle = Bottle(
            qr_code=qr_code_string,
            status="CREATED",
            uuid=new_uuid,
            cycle_count=0
        )

        db.add(bottle)
        created_items.append({"qr_code": qr_code_string, "uuid": new_uuid})

    db.commit()

    return {
        "message": f"{len(created_items)} QR codes generated successfully.",
        "items": created_items
    }
# ---------------------------
# Superadmin: Get Unassigned Bottles
# ---------------------------
@router.get("/superadmin/unassigned-bottles", response_model=List[BottleOut])
def get_unassigned_bottles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves a list of all bottles with a status of 'CREATED'
    that are available for assignment.
    """
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only superadmins can view unassigned bottles.")

    unassigned_bottles = db.query(Bottle).filter(
        Bottle.status == "CREATED"
    ).all()

    return unassigned_bottles

# ---------------------------
# Superadmin: Assign Bottles
# ---------------------------
@router.post("/superadmin/assign")
def assign_bottles(
    request: BottleAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SuperAdmin assigns multiple bottles to a delivery partner.
    Works for newly created or reusable bottles.
    """

    # --- Role validation ---
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only superadmins can assign bottles.")

    # --- Delivery partner validation ---
    delivery_partner = (
        db.query(User)
        .filter(
            User.id == request.delivery_boy_id,
            User.role == RoleEnum.delivery,
            User.status == "active"
        )
        .first()
    )
    if not delivery_partner:
        raise HTTPException(status_code=404, detail="Active delivery partner not found.")

    assigned_count = 0
    errors = []

    # --- Process each QR ---
    for qr_code in request.qr_codes:
        bottle = db.query(Bottle).filter(Bottle.qr_code == qr_code).first()
        if not bottle:
            errors.append(f"Bottle '{qr_code}' not found.")
            continue

        # ✅ Allow reassigning reusable or collected bottles too
        if bottle.status not in ["CREATED", "REUSABLE"]:
            errors.append(f"Bottle '{qr_code}' is currently '{bottle.status}', cannot assign.")
            continue

        # --- Perform assignment ---
        bottle.status = "WITH_DELIVERY"
        bottle.assigned_to_delivery_id = request.delivery_boy_id
        bottle.assigned_to_store_id = None
        bottle.current_order_id = None  # ensure clean reuse
        bottle.last_assigned_at = datetime.utcnow()

        transaction = Transaction(
            bottle_uuid=bottle.uuid,
            delivery_boy_id=request.delivery_boy_id,
            transaction_type="Assignment",
            from_location_id=None,  # from warehouse
            to_location_id=request.delivery_boy_id,  # to delivery partner
            timestamp=datetime.utcnow()
        )

        db.add(transaction)
        assigned_count += 1

    # --- Handle errors and commits ---
    if assigned_count == 0:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Assignment failed: {'; '.join(errors)}")

    db.commit()

    # If partial success, return info + warning
    if errors:
        return {
            "message": f"{assigned_count} bottles assigned successfully to {delivery_partner.full_name}, "
                       f"but some errors occurred.",
            "errors": errors
        }

    return {"message": f"{assigned_count} bottles assigned successfully to {delivery_partner.full_name}"}


# ---------------------------
# Delivery Partner: My Bottles (Assigned TO me)
# ---------------------------
@router.get("/my-bottles", response_model=List[BottleOut])
def get_my_bottles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """ Lists bottles currently assigned to the delivery partner (status WITH_DELIVERY) """
    if current_user.role != RoleEnum.delivery:
        raise HTTPException(status_code=403, detail="Only delivery partners can view their bottles.")

    bottles = db.query(Bottle).filter(
        Bottle.assigned_to_delivery_id == current_user.id,
        Bottle.status == "WITH_DELIVERY" # Ensure only bottles they currently possess
        ).all()
    return bottles

# ---------------------------
# Delivery Partner: Get Collectable Bottles (NEW ENDPOINT)
# ---------------------------
@router.get("/collectable/me", response_model=List[CollectableBottleOut])
def get_collectable_bottles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves bottles that are 'AT_STORE' and belong to stores 
    where the delivery partner has active or pending orders.
    """

    if current_user.role != RoleEnum.delivery:
        raise HTTPException(status_code=403, detail="Only delivery partners can view collectable bottles.")

    # 🔹 Step 1: Find all stores this delivery partner has orders from
    # (via Transaction table)
    store_ids = db.query(Transaction.to_location_id).filter(
        Transaction.delivery_boy_id == current_user.id,
        Transaction.transaction_type == "Delivery"
    ).distinct().all()

    store_ids = [s[0] for s in store_ids if s[0] is not None]

    if not store_ids:
        return []

    # 🔹 Step 2: Fetch all bottles that are currently at those stores
    bottles = (
        db.query(Bottle)
        .options(joinedload(Bottle.store))
        .filter(
            Bottle.status == "AT_STORE",
            Bottle.assigned_to_store_id.in_(store_ids)
        )
        .all()
    )

    # 🔹 Step 3: Return formatted result
    return [
        CollectableBottleOut(
            qr_code=b.qr_code,
            status=b.status,
            store_id=b.assigned_to_store_id,
            store_name=b.store.store_name if b.store else "Unknown Store"
        )
        for b in bottles
    ]


    return result

@router.get("/warehouse/me", response_model=List[BottleOut])
def get_bottles_ready_for_warehouse(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Shows all bottles currently WITH_DELIVERY for this delivery partner.
    These are eligible to be submitted to the warehouse.
    """
    if current_user.role != RoleEnum.delivery:
        raise HTTPException(status_code=403, detail="Only delivery partners can access this list.")

    bottles = db.query(Bottle).filter(
        Bottle.status == "WITH_DELIVERY",
        Bottle.assigned_to_delivery_id == current_user.id
    ).all()

    return bottles

# ---------------------------
# Superadmin: Bottle Summary (counts by status)
# ---------------------------
@router.get("/superadmin/summary")
def get_bottle_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns total bottle counts by their lifecycle status:
    CREATED, WITH_DELIVERY, AT_STORE, REUSABLE.
    Only accessible by Super Admins.
    """
    # 🔹 Role validation
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only superadmins can view bottle summary."
        )

    try:
        # 🔹 Fetch counts grouped by status
        status_counts = (
            db.query(Bottle.status, func.count(Bottle.uuid))  # ✅ FIXED func reference
            .group_by(Bottle.status)
            .all()
        )

        # 🔹 Convert result to dictionary
        summary = {status: count for status, count in status_counts}

        # 🔹 Ensure all expected keys exist even if no bottles found
        for key in ["CREATED", "WITH_DELIVERY", "AT_STORE", "REUSABLE"]:
            summary.setdefault(key, 0)

        total = sum(summary.values())

        # ✅ Clean structured response
        return {
            "total_bottles": total,
            "status_breakdown": summary
        }

    except Exception as e:
        print(f"❌ Error in /bottle/superadmin/summary: {e}")
        raise HTTPException(status_code=500, detail="Error fetching bottle summary data.")
# ---------------------------
# Superadmin: Bottle Details (full info table)
# ---------------------------
@router.get("/superadmin/details", response_model=List[BottleOut])
def get_all_bottle_details(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns a detailed list of all bottles, including:
    - QR code
    - Status
    - Assigned delivery partner (if any)
    - Assigned store (if any)
    - Cycle count and last collected date
    """
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only superadmins can view bottle details.")

    bottles = (
        db.query(Bottle)
        .options(joinedload(Bottle.store), joinedload(Bottle.delivery_partner))
        .order_by(Bottle.last_collected_at.desc().nullslast())
        .all()
    )

    detailed_list = []
    for b in bottles:
        detailed_list.append({
            "uuid": b.uuid,
            "qr_code": b.qr_code,
            "status": b.status,
            "cycle_count": b.cycle_count,
            "last_collected_at": b.last_collected_at,
            "store_name": b.store.store_name if b.store else None,
            "delivery_partner_name": b.delivery_partner.full_name if b.delivery_partner else None,
        })

    return detailed_list

@router.get("/superadmin/download-qr-stickers")
def download_qr_stickers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Superadmin: Download a ZIP file of printable QR stickers.

    Each file:
      - PNG, 600x650px
      - QR content: bottle.qr_code (e.g. 'qr-c927f664')
      - Text printed below QR: same qr_code (for reading on sticker)
    Only bottles with status 'CREATED' are included.
    """
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Only superadmins can download QR stickers.")

    bottles = db.query(Bottle).filter(Bottle.status == "CREATED").all()
    if not bottles:
        raise HTTPException(status_code=404, detail="No QR codes found.")

    # Prepare in-memory ZIP
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:

        for bottle in bottles:
            qr_text = bottle.qr_code  # e.g. 'qr-c927f664'

            # 1) Generate QR image from qr_text
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_M,
                box_size=10,
                border=2,
            )
            qr.add_data(qr_text)
            qr.make(fit=True)
            qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

            # 2) Create final sticker canvas (600 x 650)
            sticker_width, sticker_height = 600, 650
            canvas = Image.new("RGB", (sticker_width, sticker_height), "white")
            draw = ImageDraw.Draw(canvas)

            # Resize QR to fit (e.g. 520x520) and center horizontally
            qr_size = 520
            qr_img = qr_img.resize((qr_size, qr_size), Image.LANCZOS)
            qr_x = (sticker_width - qr_size) // 2
            qr_y = 30  # top margin
            canvas.paste(qr_img, (qr_x, qr_y))

            # 3) Draw QR ID text below (using Pillow 10+ textbbox)
            try:
                font = ImageFont.truetype("arial.ttf", 40)
            except Exception:
                font = ImageFont.load_default()

            text = qr_text
            text_y = 580  # below QR

            # Pillow 10+ replacement method
            bbox = draw.textbbox((0, 0), text, font=font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]
            text_x = (sticker_width - text_w) // 2

            draw.text((text_x, text_y), text, fill="black", font=font)

            # 4) Save this sticker to bytes and add to ZIP
            img_bytes = io.BytesIO()
            canvas.save(img_bytes, format="PNG")
            img_bytes.seek(0)

            filename = f"{qr_text}.png"
            zf.writestr(filename, img_bytes.read())

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=qr_stickers.zip"}
    )



# -----------------------------------------------------------
# --- !!! NEWLY ADDED ENDPOINT !!! ---
# -----------------------------------------------------------
@router.get(
    "/collect-list/store/{store_id}", 
    response_model=List[CollectableBottleOut],
    summary="Get list of empty bottles at a specific store"
)
def get_collectable_bottles_at_store(
    store_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves a list of all bottles that are at a specific store 
    (with status 'AT_STORE') and are ready for collection.
    """
    
    # Security check: Only delivery partners can call this
    if current_user.role != RoleEnum.delivery:
        raise HTTPException(
            status_code=403, 
            detail="You are not authorized to perform this action."
        )

    # This is the correct status, confirmed from your file
    collectable_status = "AT_STORE"  

    # This query finds all bottles that:
    # 1. Are at the location (store) specified
    # 2. Have the "AT_STORE" status
    bottles_to_collect = (
        db.query(Bottle)
        .options(joinedload(Bottle.store)) # Eager load store info
        .filter(
            Bottle.assigned_to_store_id == store_id,
            Bottle.status == collectable_status 
        )
        .all()
    )
    
    if not bottles_to_collect:
        return [] # Return empty list, not an error

    # Format the response using your existing CollectableBottleOut schema
    result = [
        CollectableBottleOut(
            qr_code=bottle.qr_code,
            status=bottle.status,
            store_id=bottle.assigned_to_store_id,
            store_name=bottle.store.store_name if bottle.store else "Unknown Store"
        )
        for bottle in bottles_to_collect if bottle.assigned_to_store_id is not None
    ]

    return result
# -----------------------------------------------------------
# --- !!! END OF NEWLY ADDED ENDPOINT !!! ---
# -----------------------------------------------------------


# ---------------------------
# Delivery Partner: Get Bottle Status
# ---------------------------
@router.get("/status/{qr_code}")
def get_bottle_status(
    qr_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) # Assuming any logged-in user might check? Or restrict further?
    # Let's restrict to Delivery for now, consistent with previous code
):
    # Allow Superadmin OR Delivery to check status
    if current_user.role not in [RoleEnum.delivery, RoleEnum.superadmin]:
           raise HTTPException(status_code=403, detail="Permission denied.")


    bottle = db.query(Bottle).options(joinedload(Bottle.store)).filter(Bottle.qr_code == qr_code).first()
    if not bottle:
        raise HTTPException(status_code=404, detail="Bottle not found.")

    # Simplified status return
    return {
        "qr_code": bottle.qr_code,
        "status": bottle.status,
        "assigned_to_delivery_id": bottle.assigned_to_delivery_id,
        "assigned_to_store_id": bottle.assigned_to_store_id,
        "store_name": bottle.store.store_name if bottle.store else None
    }


# ---------------------------
# Delivery Partner: Assign Bottle to Store (Delivery Action)
# ---------------------------
@router.post("/assign/store")
def assign_bottle_to_store(
    request: BottleScanRequest,  # Requires qr_code, to_location_id (store_id), and optional order_id
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delivery partner assigns (delivers) a bottle to a store.
    Optionally links the bottle to a specific order (temporary link).
    """
    if current_user.role != RoleEnum.delivery:
        raise HTTPException(
            status_code=403,
            detail="Only delivery partners can assign bottles to a store."
        )

    # 🔹 1. Fetch bottle
    bottle = db.query(Bottle).filter(Bottle.qr_code == request.qr_code).first()
    if not bottle:
        raise HTTPException(status_code=404, detail="Bottle not found.")

    # 🔹 2. Validate bottle ownership and status
    if bottle.status != "WITH_DELIVERY" or bottle.assigned_to_delivery_id != current_user.id:
        raise HTTPException(
            status_code=400,
            detail=f"Bottle '{request.qr_code}' is not currently with this delivery partner."
        )

    # 🔹 3. Validate store
    if not request.to_location_id:
        raise HTTPException(status_code=400, detail="Store ID ('to_location_id') is required.")
    target_store = db.query(Store).filter(Store.id == request.to_location_id).first()
    if not target_store:
        raise HTTPException(
            status_code=404,
            detail=f"Target store ID '{request.to_location_id}' not found."
        )

    # 🔹 4. Optional: Check if order_id is provided and valid
    current_order_id = getattr(request, "order_id", None)
    if current_order_id:
        order = db.query(Order).filter(Order.id == current_order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail=f"Order ID '{current_order_id}' not found.")
        # ✅ Temporarily link this bottle to this delivery order
        bottle.current_order_id = current_order_id

    try:
        # --- Perform Assignment ---
        from_location_id = bottle.assigned_to_delivery_id  # Current delivery partner

        bottle.status = "AT_STORE"
        bottle.assigned_to_store_id = request.to_location_id
        bottle.assigned_to_delivery_id = None  # Remove delivery assignment

        # Log transaction
        transaction = Transaction(
            bottle_uuid=bottle.uuid,
            delivery_boy_id=current_user.id,  # Who performed the delivery
            transaction_type="Delivery",
            from_location_id=from_location_id,
            to_location_id=request.to_location_id,
            timestamp=datetime.utcnow()
        )
        db.add(transaction)
        db.commit()

        return {
            "message": f"Bottle {bottle.qr_code} successfully delivered to store {target_store.store_name}.",
            "bottle_status": bottle.status,
            "linked_order_id": current_order_id
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"An error occurred: {str(e)}")



# ---------------------------
# Delivery Partner: Collect Bottle from Store (Collection Action)
# ---------------------------
@router.post("/collect/store")
def collect_bottle_from_store(
    request: BottleScanRequest,  # qr_code + store_id
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delivery partner collects a bottle from a store.
    This clears its temporary order link so the QR can be reused.
    """
    if current_user.role != RoleEnum.delivery:
        raise HTTPException(status_code=403, detail="Only delivery partners can collect bottles.")

    bottle = db.query(Bottle).filter(Bottle.qr_code == request.qr_code).first()
    if not bottle:
        raise HTTPException(status_code=404, detail=f"Bottle '{request.qr_code}' not found.")

    if bottle.status != "AT_STORE":
        raise HTTPException(status_code=400, detail=f"Bottle '{request.qr_code}' is not AT_STORE.")

    store_id_bottle_is_at = bottle.assigned_to_store_id
    if not store_id_bottle_is_at:
        raise HTTPException(status_code=400, detail="Bottle has no store assigned.")

    # --- Perform Collection ---
    from_location_id = bottle.assigned_to_store_id

    bottle.status = "WITH_DELIVERY"
    bottle.assigned_to_delivery_id = current_user.id
    bottle.assigned_to_store_id = None
    bottle.current_order_id = None        # ✅ Clear temporary link
    bottle.cycle_count += 1
    bottle.last_collected_at = datetime.utcnow()

    transaction = Transaction(
        bottle_uuid=bottle.uuid,
        delivery_boy_id=current_user.id,
        transaction_type="Collection",
        from_location_id=from_location_id,
        to_location_id=current_user.id,
        timestamp=datetime.utcnow()
    )

    try:
        db.add(transaction)
        db.commit()
        return {
            "message": f"Bottle {bottle.qr_code} collected from store and unlinked from its order.",
            "bottle_status": bottle.status
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error during collection: {str(e)}")

@router.get("/order/{order_id}", response_model=List[BottleOut])
def get_bottles_for_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns all bottles currently linked to a given order_id.
    Works for superadmin, partner, or delivery roles.
    """
    if current_user.role not in [RoleEnum.superadmin, RoleEnum.partner, RoleEnum.delivery]:
        raise HTTPException(status_code=403, detail="Not authorized to view this data.")

    bottles = db.query(Bottle).filter(Bottle.current_order_id == order_id).all()

    if not bottles:
        raise HTTPException(status_code=404, detail=f"No bottles found for order ID {order_id}")

    return bottles



# ---------------------------
# Delivery Partner: Submit Bottle to Warehouse
# ---------------------------
@router.post("/collect/warehouse") # Renaming endpoint might be clearer, e.g., /submit/warehouse
def submit_bottle_to_warehouse(
    request: BottleScanRequest, # Only needs qr_code
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != RoleEnum.delivery:
        raise HTTPException(status_code=403, detail="Only delivery partners can submit bottles to the warehouse.")

    bottle = db.query(Bottle).filter(Bottle.qr_code == request.qr_code).first()
    if not bottle:
        raise HTTPException(status_code=404, detail=f"Bottle '{request.qr_code}' not found.")

    if bottle.status != "WITH_DELIVERY" or bottle.assigned_to_delivery_id != current_user.id:
        raise HTTPException(status_code=400, detail=f"Bottle '{request.qr_code}' is not currently with this delivery partner.")

    # --- Perform Submission ---
    from_location_id = bottle.assigned_to_delivery_id # From Delivery Partner

    bottle.status = "CREATED" # Back to initial state, ready for reassignment
    bottle.assigned_to_delivery_id = None
    bottle.assigned_to_store_id = None

    transaction = Transaction(
        bottle_uuid=bottle.uuid,
        delivery_boy_id=current_user.id, # User performing action
        transaction_type="Return to Warehouse",
        from_location_id=from_location_id, # From Delivery Partner
        to_location_id=None, # To Warehouse (implicitly)
        timestamp=datetime.utcnow()
    )
    db.add(transaction)
    db.commit()

    return {"message": f"Bottle {bottle.qr_code} successfully submitted to warehouse.", "bottle_status": bottle.status}


# --- (Keep existing Partner endpoint if needed, but it's not used by Delivery app) ---
# ---------------------------
# Partner: Get Empty Bottles Count
# ---------------------------


@router.get("/superadmin/store-empty-counts")
def get_all_store_empty_counts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 🔒 Authorization
    if current_user.role != RoleEnum.superadmin:
        raise HTTPException(
            status_code=403,
            detail="Only superadmins allowed"
        )

    # ✅ Single source of truth: Store.pending_empty_bottles
    stores = (
        db.query(
            Store.id,
            Store.store_name,
            Store.city,
            Store.pending_empty_bottles
        )
        .order_by(Store.store_name)
        .all()
    )

    return [
        {
            "id": store.id,
            "store_name": store.store_name,
            "city": store.city,
            "empty_bottles_count": int(store.pending_empty_bottles or 0)
        }
        for store in stores
    ]




@router.get("/partner/me/empty-bottles")
def partner_empty_bottles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 🔒 Role check
    if current_user.role != RoleEnum.partner:
        raise HTTPException(status_code=403, detail="Only partners allowed")

    # 🔹 Get partner store IDs
    store_ids = [
        row[0]
        for row in db.query(PartnerStore.store_id)
        .filter(PartnerStore.user_id == current_user.id)
        .all()
    ]

    if not store_ids:
        return {"pending_empty_bottles": 0}

    # 🔹 Sum running balance from stores table
    pending = (
        db.query(func.coalesce(func.sum(Store.pending_empty_bottles), 0))
        .filter(Store.id.in_(store_ids))
        .scalar()
    )

    return {
        "pending_empty_bottles": int(pending)
    }


