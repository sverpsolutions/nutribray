# Trigger reload
import math
from datetime import datetime, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role, current_user_dep
from app.schemas.warehouse import (
    rack_create, rack_update, rack_out, rack_qr_out,
    item_rack_create, item_rack_out,
    warehouse_tree_node, division_tree_node, rack_tree_node,
    rack_summary_out,
    zone_create, zone_out,
    aisle_create, aisle_update, aisle_out,
    division_create, division_update, division_out,
)
from app.models.warehouse import (
    warehouse_zone as zone_model,
    aisle_master as aisle_model,
    division_master as division_model,
    rack_master as rack_model,
    item_rack_mapping as mapping_model,
)
from app.schemas.common import success_response

router = APIRouter(prefix="/warehouse", tags=["warehouse"], dependencies=[Depends(get_current_user)])


# ── helpers ───────────────────────────────────────────────────────────────────

def _fill_pct(current_qty: Decimal, capacity: int | None) -> float:
    if not capacity or capacity == 0:
        return 0.0
    return round(float(current_qty) / capacity * 100, 2)


def _status_color(fill: float, qty: Decimal) -> str:
    if qty == 0:
        return "green"
    if fill >= 80:
        return "red"
    return "yellow"


async def _next_aisle_code(db: AsyncSession) -> str:
    last = (await db.execute(
        select(aisle_model).order_by(aisle_model.id.desc()).limit(1)
    )).scalar_one_or_none()
    n = (last.id + 1) if last else 1
    return f"A{n:02d}"


async def _next_division_code(db: AsyncSession, aisle_id: int) -> str:
    count = (await db.execute(
        select(func.count()).where(division_model.aisle_id == aisle_id)
    )).scalar_one()
    return f"D{count + 1:02d}"


# ── Zones ─────────────────────────────────────────────────────────────────────

@router.get("/zones", response_model=list[zone_out])
async def list_zones(db: AsyncSession = Depends(get_db)):
    return (await db.execute(select(zone_model))).scalars().all()


@router.post("/zones", response_model=zone_out)
async def create_zone(body: zone_create, db: AsyncSession = Depends(get_db)):
    obj = zone_model(**body.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


# ── Tree ──────────────────────────────────────────────────────────────────────

@router.get("/tree", response_model=list[warehouse_tree_node])
async def get_warehouse_tree(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    aisles = (await db.execute(
        select(aisle_model)
        .options(
            selectinload(aisle_model.divisions).selectinload(division_model.racks)
        )
        .order_by(aisle_model.aisle_code)
    )).scalars().all()

    result = []
    for a in aisles:
        divs = []
        for d in sorted(a.divisions, key=lambda x: x.sequence_no):
            racks = [
                rack_tree_node(
                    id=r.id,
                    rack_code=r.rack_code,
                    rack_number=r.rack_number,
                    shelf_level=r.shelf_level,
                    capacity=r.capacity,
                    current_qty=r.current_qty,
                    status=r.status,
                )
                for r in sorted(d.racks, key=lambda x: x.rack_code)
            ]
            divs.append(division_tree_node(
                id=d.id,
                division_code=d.division_code,
                division_name=d.division_name,
                aisle_code=d.aisle_code,
                sequence_no=d.sequence_no,
                status=d.status,
                racks=racks,
            ))
        result.append(warehouse_tree_node(
            id=a.id,
            aisle_code=a.aisle_code,
            aisle_name=a.aisle_name,
            warehouse_code=a.warehouse_code,
            status=a.status,
            divisions=divs,
        ))
    return result


# ── Aisles ────────────────────────────────────────────────────────────────────

@router.get("/aisles", response_model=list[aisle_out])
async def list_aisles(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(aisle_model).order_by(aisle_model.aisle_code)
    )).scalars().all()
    return rows


@router.post("/aisles", response_model=aisle_out, status_code=status.HTTP_201_CREATED)
async def create_aisle(
    body: aisle_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        code = body.aisle_code or await _next_aisle_code(db)
        existing = (await db.execute(
            select(aisle_model).where(aisle_model.aisle_code == code)
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail=f"aisle code '{code}' already exists")

        obj = aisle_model(
            aisle_code=code,
            aisle_name=body.aisle_name,
            warehouse_code=body.warehouse_code,
            warehouse_zone_id=body.warehouse_zone_id,
            status=body.status,
        )
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
        return obj
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/aisles/{aisle_id}", response_model=aisle_out)
async def update_aisle(
    aisle_id: int,
    body: aisle_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = (await db.execute(
        select(aisle_model).where(aisle_model.id == aisle_id)
    )).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="aisle not found")

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(obj, field, val)

    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/aisles/{aisle_id}", response_model=success_response)
async def delete_aisle(
    aisle_id: int,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    # Check for racks before soft delete
    rack_count = (await db.execute(
        select(func.count()).select_from(rack_model)
        .where(rack_model.aisle_id == aisle_id, rack_model.status == True)
    )).scalar_one()
    if rack_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"cannot deactivate: {rack_count} active rack(s) exist in this aisle"
        )
    await db.execute(
        update(aisle_model).where(aisle_model.id == aisle_id).values(status=False)
    )
    await db.commit()
    return {"message": "aisle deactivated", "id": aisle_id}


# ── Divisions ─────────────────────────────────────────────────────────────────

@router.get("/divisions", response_model=list[division_out])
async def list_divisions(
    aisle_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(division_model).order_by(division_model.aisle_code, division_model.sequence_no)
    if aisle_id:
        q = q.where(division_model.aisle_id == aisle_id)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.post("/divisions", response_model=division_out, status_code=status.HTTP_201_CREATED)
async def create_division(
    body: division_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        code = body.division_code or await _next_division_code(db, body.aisle_id)
        # Check uniqueness within aisle
        existing = (await db.execute(
            select(division_model).where(
                division_model.aisle_code == body.aisle_code,
                division_model.division_code == code,
            )
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail=f"division code '{code}' already exists in this aisle")

        obj = division_model(
            division_code=code,
            division_name=body.division_name,
            aisle_id=body.aisle_id,
            aisle_code=body.aisle_code,
            sequence_no=body.sequence_no,
            status=body.status,
        )
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
        return obj
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/divisions/{division_id}", response_model=division_out)
async def update_division(
    division_id: int,
    body: division_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = (await db.execute(
        select(division_model).where(division_model.id == division_id)
    )).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="division not found")

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(obj, field, val)

    await db.commit()
    await db.refresh(obj)
    return obj


# ── Racks ─────────────────────────────────────────────────────────────────────

@router.get("/racks", response_model=list[rack_out])
async def list_racks(
    aisle_id: int | None = Query(None),
    division_id: int | None = Query(None),
    status_filter: bool | None = Query(None, alias="status"),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(rack_model).order_by(rack_model.rack_code)
    if aisle_id:
        q = q.where(rack_model.aisle_id == aisle_id)
    if division_id:
        q = q.where(rack_model.division_id == division_id)
    if status_filter is not None:
        q = q.where(rack_model.status == status_filter)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.post("/racks", response_model=rack_out, status_code=status.HTTP_201_CREATED)
async def create_rack(
    body: rack_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        # Build rack_code preview (DB trigger will set the actual value)
        preview_code = (
            body.aisle_code
            + "-" + body.division_code
            + "-" + body.rack_number
            + ("-" + body.shelf_level if body.shelf_level else "")
        )
        # Check uniqueness
        existing = (await db.execute(
            select(rack_model).where(rack_model.rack_code == preview_code)
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail=f"rack code '{preview_code}' already exists")

        obj = rack_model(
            rack_code=preview_code,   # trigger will override, but set for safety
            aisle_id=body.aisle_id,
            division_id=body.division_id,
            aisle_code=body.aisle_code,
            division_code=body.division_code,
            rack_number=body.rack_number,
            shelf_level=body.shelf_level,
            bin_code=body.bin_code,
            capacity=body.capacity,
            zone_id=body.zone_id,
            bay_number=body.bay_number,
            max_weight=body.max_weight,
            current_qty=Decimal("0"),
            status=body.status,
        )
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
        return obj
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/racks/{rack_id}", response_model=rack_out)
async def update_rack(
    rack_id: int,
    body: rack_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = (await db.execute(
        select(rack_model).where(rack_model.id == rack_id)
    )).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="rack not found")

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(obj, field, val)

    await db.commit()
    await db.refresh(obj)
    return obj


@router.get("/racks/{rack_id}/qr", response_model=rack_qr_out)
async def get_rack_qr(
    rack_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    obj = (await db.execute(
        select(rack_model).where(rack_model.id == rack_id)
    )).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="rack not found")
    return rack_qr_out(rack_code=obj.rack_code, qr_text=obj.rack_code)


# ── Item Rack Mappings ────────────────────────────────────────────────────────

@router.get("/item-mappings", response_model=list[item_rack_out])
async def list_item_mappings(
    product_id: int | None = Query(None),
    rack_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(mapping_model).order_by(mapping_model.id)
    if product_id:
        q = q.where(mapping_model.product_id == product_id)
    if rack_id:
        q = q.where(mapping_model.rack_id == rack_id)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.post("/item-mappings", response_model=item_rack_out, status_code=status.HTTP_201_CREATED)
async def create_item_mapping(
    body: item_rack_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        existing = (await db.execute(
            select(mapping_model).where(
                mapping_model.product_id == body.product_id,
                mapping_model.rack_id == body.rack_id,
            )
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="this product is already mapped to this rack")

        # Resolve rack_code from rack if not provided
        rack_code = body.rack_code
        if not rack_code:
            r = (await db.execute(
                select(rack_model).where(rack_model.id == body.rack_id)
            )).scalar_one_or_none()
            rack_code = r.rack_code if r else None

        obj = mapping_model(
            product_id=body.product_id,
            rack_id=body.rack_id,
            rack_code=rack_code,
            priority=body.priority,
            min_qty=body.min_qty,
            max_qty=body.max_qty,
        )
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
        return obj
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/item-mappings/{mapping_id}", response_model=success_response)
async def delete_item_mapping(
    mapping_id: int,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        delete(mapping_model).where(mapping_model.id == mapping_id)
    )
    await db.commit()
    return {"message": "mapping deleted", "id": mapping_id}


# ── Reports ───────────────────────────────────────────────────────────────────

@router.get("/reports/summary", response_model=list[rack_summary_out])
async def rack_summary(
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    rows = (await db.execute(
        select(rack_model).where(rack_model.status == True).order_by(rack_model.rack_code)
    )).scalars().all()

    result = []
    for r in rows:
        fill = _fill_pct(r.current_qty, r.capacity)
        result.append(rack_summary_out(
            id=r.id,
            rack_code=r.rack_code,
            capacity=r.capacity,
            current_qty=r.current_qty,
            fill_pct=fill,
            status_color=_status_color(fill, r.current_qty),
            status=r.status,
        ))
    return result


@router.get("/reports/empty", response_model=list[rack_out])
async def empty_racks(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(rack_model)
        .where(rack_model.current_qty == 0, rack_model.status == True)
        .order_by(rack_model.rack_code)
    )).scalars().all()
    return rows


@router.get("/reports/item-locations", response_model=list[item_rack_out])
async def item_locations(
    product_id: int = Query(...),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(mapping_model)
        .where(mapping_model.product_id == product_id)
        .order_by(mapping_model.priority)
    )).scalars().all()
    return rows
