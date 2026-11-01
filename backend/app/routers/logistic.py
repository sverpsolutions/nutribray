from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from app.core.database import get_db
from app.core import access
from app.models.logistic import (
    logistic_transfer, logistic_transfer_item, logistic_box, 
    logistic_box_item, logistic_dispatch_detail, logistic_timeline
)
from app.schemas.logistic import (
    logistic_transfer_create, logistic_transfer_out, logistic_transfer_update,
    logistic_transfer_item_create,
    logistic_box_create, logistic_box_out, logistic_dispatch_detail_update
)
from datetime import datetime
from typing import List

from app.models.sync import unit_wise_stock_transfer, unit_wise_stock_transfer_item
from app.models.product import product
from app.core.dependencies import get_current_user

router = APIRouter(prefix="/logistics", tags=["logistics"], dependencies=[Depends(get_current_user)])

async def generate_transfer_number(db: AsyncSession):
    # Format: TRF-LOG-YYYYMMDD-XXXX
    today_str = datetime.now().strftime("%Y%m%d")
    prefix = f"TRF-LOG-{today_str}-"
    
    # Count transfers today
    result = await db.execute(
        select(func.count(logistic_transfer.id)).where(logistic_transfer.transfer_number.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    new_id = f"{prefix}{str(count + 1).zfill(4)}"
    return new_id

async def add_timeline_event(db: AsyncSession, transfer_id: int, event: str, description: str = None, user_id: int = None):
    new_event = logistic_timeline(
        transfer_id=transfer_id,
        event=event,
        description=description,
        user_id=user_id
    )
    db.add(new_event)
    await db.commit()

@router.post("/transfers", response_model=logistic_transfer_out)
async def create_transfer(transfer_in: logistic_transfer_create, db: AsyncSession = Depends(get_db)):
    access.check_outlet(transfer_in.source_location_id)
    transfer_number = await generate_transfer_number(db)
    
    new_transfer = logistic_transfer(
        transfer_number=transfer_number,
        source_location_id=transfer_in.source_location_id,
        destination_location_id=transfer_in.destination_location_id,
        priority=transfer_in.priority,
        notes=transfer_in.notes,
        source_transfer_id=transfer_in.source_transfer_id,
        status="DRAFT"
    )
    db.add(new_transfer)
    await db.flush() # Get ID
    
    # Add items if any
    for item in transfer_in.items:
        db.add(logistic_transfer_item(
            transfer_id=new_transfer.id,
            product_id=item.product_id,
            quantity=item.quantity
        ))
    
    # Add initial timeline
    await add_timeline_event(db, new_transfer.id, "CREATED", f"Transfer {transfer_number} initialized.")
    
    await db.commit()
    await db.refresh(new_transfer)
    
    # Attach source number for response if exists
    if new_transfer.source_transfer_id:
        st = await db.get(unit_wise_stock_transfer, new_transfer.source_transfer_id)
        new_transfer.source_transfer_no = st.transfer_no if st else None
        
    return new_transfer

@router.get("/transfers/lookup-source")
async def lookup_stock_transfers(q: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Search for pending stock transfers by number."""
    result = await db.execute(
        select(unit_wise_stock_transfer)
        .where(unit_wise_stock_transfer.transfer_no.like(f"%{q}%"))
        .limit(10)
    )
    return result.scalars().all()

@router.get("/transfers/source-details/{id}")
async def get_source_transfer_details(id: int, db: AsyncSession = Depends(get_db)):
    """Fetch details of a stock transfer including its items for logistics."""
    trf_result = await db.execute(select(unit_wise_stock_transfer).where(unit_wise_stock_transfer.id == id))
    trf = trf_result.scalar_one_or_none()
    if not trf: raise HTTPException(404, "Transfer not found")
    
    items_result = await db.execute(
        select(unit_wise_stock_transfer_item, product.name, product.item_code, product.barcode)
        .join(product, unit_wise_stock_transfer_item.product_id == product.id)
        .where(unit_wise_stock_transfer_item.transfer_id == id)
    )
    
    items = []
    for row, p_name, p_code, p_barcode in items_result:
        items.append({
            "product_id": row.product_id,
            "name": p_name,
            "item_code": p_code,
            "barcode": p_barcode,
            "quantity": row.qty,
            "unit": row.unit,
            "batch_id": row.batch_id,
            "batch_no": row.batch_no,
            "expiry_date": str(row.expiry_date) if row.expiry_date else None,
            "mfg_date": str(row.mfg_date) if row.mfg_date else None,
        })
        
    return {
        "id": trf.id,
        "transfer_no": trf.transfer_no,
        "from_outlet_id": trf.from_outlet_id,
        "to_outlet_id": trf.to_outlet_id,
        "remarks": trf.remarks,
        "items": items
    }

@router.get("/transfers", response_model=List[logistic_transfer_out])
async def list_transfers(db: AsyncSession = Depends(get_db)):
    q = select(logistic_transfer).order_by(logistic_transfer.created_at.desc())
    if access.allowed_outlets() is not None:
        mine = access.allowed_outlets() or [0]
        q = q.where(logistic_transfer.source_location_id.in_(mine) | logistic_transfer.destination_location_id.in_(mine))
    result = await db.execute(q)
    return result.scalars().all()

@router.get("/transfers/{id}", response_model=logistic_transfer_out)
async def get_transfer(id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(logistic_transfer).where(logistic_transfer.id == id))
    transfer = result.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    if access.allowed_outlets() is not None and not {transfer.source_location_id, transfer.destination_location_id} & set(access.allowed_outlets()):
        raise HTTPException(status_code=403, detail="Access denied: this transfer is between locations not assigned to you.")
    
    # Attach source number
    if transfer.source_transfer_id:
        st = await db.get(unit_wise_stock_transfer, transfer.source_transfer_id)
        transfer.source_transfer_no = st.transfer_no if st else None
        
    return transfer

@router.put("/transfers/{id}/items")
async def update_transfer_items(id: int, items: List[logistic_transfer_item_create], db: AsyncSession = Depends(get_db)):
    # Remove existing items and add new ones
    await db.execute(delete(logistic_transfer_item).where(logistic_transfer_item.transfer_id == id))
    
    for item in items:
        db.add(logistic_transfer_item(
            transfer_id=id,
            product_id=item.product_id,
            quantity=item.quantity
        ))
    
    await add_timeline_event(db, id, "ITEMS_UPDATED", "Transfer items updated.")
    await db.commit()
    return {"message": "Items updated successfully"}

@router.post("/transfers/{id}/boxes", response_model=logistic_box_out)
async def create_box(id: int, box_in: logistic_box_create, db: AsyncSession = Depends(get_db)):
    new_box = logistic_box(
        transfer_id=id,
        box_number=box_in.box_number,
        weight_kg=box_in.weight_kg,
        length_cm=box_in.length_cm,
        width_cm=box_in.width_cm,
        height_cm=box_in.height_cm,
        seal_number=box_in.seal_number,
        box_type=box_in.box_type
    )
    db.add(new_box)
    await db.flush()
    
    for item in box_in.items:
        db.add(logistic_box_item(
            box_id=new_box.id,
            product_id=item.product_id,
            quantity=item.quantity
        ))
    
    # Update transfer status to PACKING
    await db.execute(
        logistic_transfer.__table__.update().where(logistic_transfer.id == id).values(status="PACKING")
    )
    
    await add_timeline_event(db, id, "BOX_CREATED", f"Box {box_in.box_number} created.")
    await db.commit()
    await db.refresh(new_box)
    return new_box

@router.put("/transfers/{id}/dispatch")
async def update_dispatch_details(id: int, dispatch_in: logistic_dispatch_detail_update, db: AsyncSession = Depends(get_db)):
    # Check if exists
    result = await db.execute(select(logistic_dispatch_detail).where(logistic_dispatch_detail.transfer_id == id))
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        dispatch = logistic_dispatch_detail(transfer_id=id)
        db.add(dispatch)
    
    for field, value in dispatch_in.model_dump(exclude_unset=True).items():
        setattr(dispatch, field, value)
    
    await add_timeline_event(db, id, "DISPATCH_INFO_UPDATED", "Vehicle and driver details updated.")
    await db.commit()
    return {"message": "Dispatch details updated"}

@router.post("/transfers/{id}/dispatch-confirm")
async def confirm_dispatch(id: int, db: AsyncSession = Depends(get_db)):
    # Update status to DISPATCHED
    await db.execute(
        logistic_transfer.__table__.update().where(logistic_transfer.id == id).values(
            status="DISPATCHED",
            updated_at=func.now()
        )
    )
    
    # Update dispatch timestamp
    await db.execute(
        logistic_dispatch_detail.__table__.update().where(logistic_dispatch_detail.transfer_id == id).values(
            dispatched_at=func.now()
        )
    )
    
    await add_timeline_event(db, id, "DISPATCHED", "Transfer has been dispatched.")
    await db.commit()
    return {"message": "Transfer dispatched successfully"}

@router.post("/boxes/{box_id}/mark-printed")
async def mark_box_printed(box_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(
        logistic_box.__table__.update().where(logistic_box.id == box_id).values(is_printed=True)
    )
    await db.commit()
    return {"message": "Box marked as printed"}
