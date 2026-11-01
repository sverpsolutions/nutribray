from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from app.core.dependencies import get_current_user
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func, text

from app.core.database import get_db, get_legacy_db
from app.models.user import user
from app.models.warehouse import rack_master, warehouse_zone, rack_inventory, putaway_batch, putaway_log
from app.models.product import product, product_barcode
from app.schemas.wms import RackInfo, PendingGRN, GRNItem, PutawayRequest, WMSDashboardStats, RackInventorySchema

router = APIRouter(prefix="/wms", tags=["WMS"], dependencies=[Depends(get_current_user)])

# 1. Dashboard Stats
@router.get("/dashboard", response_model=WMSDashboardStats)
async def get_wms_stats(db: AsyncSession = Depends(get_db)):
    # Total Pending GRN
    pending_grns = await db.execute(select(func.count(putaway_batch.id)).where(putaway_batch.status != "COMPLETED"))
    total_pending = pending_grns.scalar() or 0

    # Total Floor Stock (Sum of remaining items in putaway_batches)
    # We'd need to track items better, but for now we'll sum total_items - placed_items
    floor_res = await db.execute(select(func.sum(putaway_batch.total_items - putaway_batch.placed_items)))
    total_floor = floor_res.scalar() or 0

    # Total Rack Stock
    rack_stock_res = await db.execute(select(func.sum(rack_inventory.qty)))
    total_rack = rack_stock_res.scalar() or 0

    # Total Capacity
    capacity_res = await db.execute(select(func.sum(rack_master.capacity)))
    total_capacity = capacity_res.scalar() or 1

    return WMSDashboardStats(
        total_pending_grn=total_pending,
        total_floor_stock=Decimal(str(total_floor)),
        total_rack_stock=total_rack,
        today_putaway_qty=Decimal("0"),
        rack_utilization_pct=round((float(total_rack) / float(total_capacity)) * 100, 2) if total_capacity > 0 else 0
    )

# 2. List Pending GRNs
@router.get("/pending-grns", response_model=List[PendingGRN])
async def get_pending_grns(db: AsyncSession = Depends(get_db), legacy_db: AsyncSession = Depends(get_legacy_db)):
    # Auto-sync before listing
    await sync_grns_from_legacy(db, legacy_db)

    result = await db.execute(
        select(putaway_batch)
        .where(putaway_batch.status != "COMPLETED")
        .order_by(putaway_batch.created_at.desc())
    )
    batches = result.scalars().all()
    
    return [
        PendingGRN(
            id=b.grn_id,
            grn_no=b.grn_no,
            grn_date=b.created_at,
            supplier_name="LEGACY_SUPPLIER", # Placeholder
            total_items=b.total_items,
            status=b.status
        ) for b in batches
    ]

# 3. GRN Details (Items to put away)
@router.get("/grn-details/{grn_id}", response_model=List[GRNItem])
async def get_grn_details(grn_id: int, legacy_db: AsyncSession = Depends(get_legacy_db)):
    # Fetch items from MySQL unit_wise_purchase_items
    query = text("""
        SELECT pi.id, pi.product_id, p.item_code, p.name as item_name, pi.qty as qty_total, p.barcode
        FROM unit_wise_purchase_items pi
        JOIN products p ON p.id = pi.product_id
        WHERE pi.purchase_id = :grn_id
    """)
    result = await legacy_db.execute(query, {"grn_id": grn_id})
    items = result.fetchall()

    # In a real system, we'd check Postgres putaway_logs to see how many were already placed
    return [
        GRNItem(
            id=row.id,
            product_id=row.product_id,
            item_code=row.item_code,
            item_name=row.item_name,
            qty_total=row.qty_total,
            qty_placed=Decimal("0"),
            qty_remaining=row.qty_total,
            barcode=row.barcode
        ) for row in items
    ]

# 4. Rack Info
@router.get("/rack-info/{rack_code}", response_model=RackInfo)
async def get_rack_info(rack_code: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(rack_master).where(rack_master.rack_code == rack_code))
    rack = result.scalar_one_or_none()
    if not rack:
        raise HTTPException(status_code=404, detail="Rack not found")
    
    return RackInfo(
        id=rack.id,
        rack_code=rack.rack_code,
        aisle_code=rack.aisle_code,
        division_code=rack.division_code,
        rack_number=rack.rack_number,
        shelf_level=rack.shelf_level,
        bin_code=rack.bin_code,
        current_qty=rack.current_qty,
        capacity=rack.capacity
    )

# 5. Commit Putaway
@router.post("/putaway")
async def commit_putaway(req: PutawayRequest, db: AsyncSession = Depends(get_db)):
    # 1. Validate Rack
    res_rack = await db.execute(select(rack_master).where(rack_master.rack_code == req.rack_code))
    rack = res_rack.scalar_one_or_none()
    if not rack:
        raise HTTPException(status_code=400, detail="Invalid Rack Barcode")

    # 2. Find Product by barcode
    res_prod = await db.execute(select(product).where((product.barcode == req.barcode) | (product.item_code == req.barcode)))
    prod = res_prod.scalar_one_or_none()
    if not prod:
        raise HTTPException(status_code=400, detail="Product not found for this barcode")

    # 3. Create Putaway Log
    # Find batch
    res_batch = await db.execute(select(putaway_batch).where(putaway_batch.grn_id == req.grn_id))
    batch = res_batch.scalar_one_or_none()
    
    new_log = putaway_log(
        batch_id=batch.id if batch else None,
        grn_id=req.grn_id,
        rack_id=rack.id,
        product_id=prod.id,
        qty=req.qty,
        device_id=req.device_id
    )
    db.add(new_log)

    # 4. Update Rack Inventory
    res_inv = await db.execute(
        select(rack_inventory)
        .where(rack_inventory.rack_id == rack.id, rack_inventory.product_id == prod.id)
    )
    inv = res_inv.scalar_one_or_none()
    if inv:
        inv.qty += req.qty
    else:
        inv = rack_inventory(rack_id=rack.id, product_id=prod.id, qty=req.qty)
        db.add(inv)

    # 5. Update Rack Total Qty
    rack.current_qty += req.qty

    # 6. Update Batch placed count
    if batch:
        batch.placed_items += 1
        # If all items placed logic would go here

    await db.commit()
    return {"status": "success", "message": "Putaway recorded"}

# 6. Sync GRNs from Legacy
@router.post("/sync-grns")
async def sync_grns_from_legacy(db: AsyncSession = Depends(get_db), legacy_db: AsyncSession = Depends(get_legacy_db)):
    # Find "received" purchases in MySQL not in Postgres batches
    query = text("""
        SELECT p.id, p.purchase_no, COUNT(pi.id) as item_count
        FROM unit_wise_purchases p
        JOIN unit_wise_purchase_items pi ON pi.purchase_id = p.id
        WHERE p.status = 'received'
        GROUP BY p.id, p.purchase_no
    """)
    res = await legacy_db.execute(query)
    legacy_purchases = res.fetchall()

    count = 0
    for lp in legacy_purchases:
        # Check if already exists
        check = await db.execute(select(putaway_batch).where(putaway_batch.grn_id == lp.id))
        if not check.scalar_one_or_none():
            new_batch = putaway_batch(
                grn_id=lp.id,
                grn_no=lp.purchase_no,
                total_items=lp.item_count,
                status='PENDING'
            )
            db.add(new_batch)
            count += 1
    
    await db.commit()
    return {"synced": count}
