from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role, current_user_dep
from app.models.packaging import item_packaging_master, storage_type_master, temperature_category_master
from app.models.product import product as product_model
from app.schemas.packaging import packaging_create, packaging_update, packaging_out, storage_type_out, temperature_category_out
from app.schemas.common import success_response
from app.services.auth_service import write_audit

router = APIRouter(prefix="/packaging", tags=["packaging"])


# ── helpers ────────────────────────────────────────────────────────────────────

def _calc_total_units(inner_qty: int, inner_packs: int) -> int:
    return inner_qty * inner_packs


def _calc_volume(l: Decimal | None, w: Decimal | None, h: Decimal | None) -> Decimal | None:
    if l and w and h and l > 0 and w > 0 and h > 0:
        return round(Decimal(str(l)) * Decimal(str(w)) * Decimal(str(h)) / Decimal("1000000"), 8)
    return None


# ── endpoints ──────────────────────────────────────────────────────────────────

@router.get("/product/{product_id}", response_model=packaging_out | None)
async def get_packaging(
    product_id: int,
    current_user: current_user_dep = Depends(require_role("admin", "manager", "cashier")),
    db: AsyncSession = Depends(get_db),
):
    """Get packaging config for a product (returns null if not configured yet)."""
    result = await db.execute(
        select(item_packaging_master)
        .where(item_packaging_master.product_id == product_id, item_packaging_master.is_active == True)
        .order_by(item_packaging_master.id.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    return row


@router.get("/storage-types", response_model=list[storage_type_out])
async def list_storage_types(
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(require_role("admin", "manager", "cashier", "clerk")),
):
    res = await db.execute(select(storage_type_master).where(storage_type_master.is_active == True))
    return res.scalars().all()


@router.get("/temperature-categories", response_model=list[temperature_category_out])
async def list_temperature_categories(
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(require_role("admin", "manager", "cashier", "clerk")),
):
    res = await db.execute(select(temperature_category_master).where(temperature_category_master.is_active == True))
    return res.scalars().all()


@router.post("", response_model=packaging_out, status_code=201)
async def create_packaging(
    body: packaging_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    # Verify product exists
    prod = await db.get(product_model, body.product_id)
    if not prod:
        raise HTTPException(404, "Product not found")

    # Deactivate any existing config for this product
    existing = await db.execute(
        select(item_packaging_master).where(
            item_packaging_master.product_id == body.product_id,
            item_packaging_master.is_active == True,
        )
    )
    for old in existing.scalars().all():
        old.is_active = False

    total_units = _calc_total_units(body.inner_pack_qty, body.inner_packs_per_carton)
    volume = _calc_volume(body.carton_length_cm, body.carton_width_cm, body.carton_height_cm)

    pkg = item_packaging_master(
        product_id=body.product_id,
        item_code=body.item_code or prod.item_code,
        packaging_type=body.packaging_type,
        
        base_uom_id=body.base_uom_id,
        purchase_uom_id=body.purchase_uom_id,
        sales_uom_id=body.sales_uom_id,
        inner_pack_uom_id=body.inner_pack_uom_id,
        outer_carton_uom_id=body.outer_carton_uom_id,

        inner_pack_qty=body.inner_pack_qty,
        inner_packs_per_carton=body.inner_packs_per_carton,
        total_units_per_carton=total_units,
        outer_carton_qty=body.outer_carton_qty,

        carton_length_cm=body.carton_length_cm,
        carton_width_cm=body.carton_width_cm,
        carton_height_cm=body.carton_height_cm,
        carton_volume_cbm=volume,
        gross_weight_kg=body.gross_weight_kg,
        net_weight_kg=body.net_weight_kg,
        unit_barcode=body.unit_barcode,
        inner_barcode=body.inner_barcode,
        carton_barcode=body.carton_barcode,

        shelf_life_days=body.shelf_life_days,
        storage_type_id=body.storage_type_id,
        temperature_category_id=body.temperature_category_id,

        rack_location=body.rack_location,
        notes=body.notes,
        is_active=True,
        created_by=current_user.user_id,
        updated_by=current_user.user_id,
    )
    db.add(pkg)
    await db.flush()

    await write_audit(
        db=db, module="packaging", action="create", record_id=pkg.id,
        record_no=pkg.item_code,
        description=f"Packaging configured for product {body.product_id} — type={body.packaging_type}",
        user_id=current_user.user_id, user_name=current_user.username,
    )
    await db.commit()
    await db.refresh(pkg)
    return pkg


@router.put("/{pkg_id}", response_model=packaging_out)
async def update_packaging(
    pkg_id: int,
    body: packaging_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    pkg = await db.get(item_packaging_master, pkg_id)
    if not pkg:
        raise HTTPException(404, "Packaging record not found")

    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(pkg, k, v)

    # Re-calculate totals
    pkg.total_units_per_carton = _calc_total_units(pkg.inner_pack_qty, pkg.inner_packs_per_carton)
    pkg.carton_volume_cbm = _calc_volume(pkg.carton_length_cm, pkg.carton_width_cm, pkg.carton_height_cm)
    pkg.updated_by = current_user.user_id

    await write_audit(
        db=db, module="packaging", action="update", record_id=pkg.id,
        record_no=pkg.item_code,
        description=f"Packaging updated — product {pkg.product_id}",
        user_id=current_user.user_id, user_name=current_user.username,
    )
    await db.commit()
    await db.refresh(pkg)
    return pkg


@router.delete("/{pkg_id}", response_model=success_response)
async def delete_packaging(
    pkg_id: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    pkg = await db.get(item_packaging_master, pkg_id)
    if not pkg:
        raise HTTPException(404, "Packaging record not found")
    pkg.is_active = False
    pkg.updated_by = current_user.user_id
    await db.commit()
    return {"message": "Packaging config deactivated", "id": pkg_id}


# ── Reports ────────────────────────────────────────────────────────────────────

@router.get("/reports/summary", response_model=list[dict])
async def packaging_summary(
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    """Returns all active packaging configs with product info."""
    result = await db.execute(
        select(
            item_packaging_master,
            product_model.name.label("product_name"),
            product_model.category.label("category"),
        )
        .join(product_model, item_packaging_master.product_id == product_model.id)
        .where(item_packaging_master.is_active == True)
        .order_by(item_packaging_master.item_code)
    )
    rows = result.all()
    out = []
    for pkg, pname, cat in rows:
        out.append({
            "id": pkg.id,
            "product_id": pkg.product_id,
            "item_code": pkg.item_code,
            "product_name": pname,
            "category": cat,
            "packaging_type": pkg.packaging_type,
            "inner_pack_qty": pkg.inner_pack_qty,
            "inner_packs_per_carton": pkg.inner_packs_per_carton,
            "total_units_per_carton": pkg.total_units_per_carton,
            "outer_carton_qty": pkg.outer_carton_qty,
            "carton_length_cm": str(pkg.carton_length_cm) if pkg.carton_length_cm else None,
            "carton_width_cm": str(pkg.carton_width_cm) if pkg.carton_width_cm else None,
            "carton_height_cm": str(pkg.carton_height_cm) if pkg.carton_height_cm else None,
            "carton_volume_cbm": str(pkg.carton_volume_cbm) if pkg.carton_volume_cbm else None,
            "gross_weight_kg": str(pkg.gross_weight_kg) if pkg.gross_weight_kg else None,
            "net_weight_kg": str(pkg.net_weight_kg) if pkg.net_weight_kg else None,
            "base_uom_id": pkg.base_uom_id,
            "purchase_uom_id": pkg.purchase_uom_id,
            "sales_uom_id": pkg.sales_uom_id,
            "inner_pack_uom_id": pkg.inner_pack_uom_id,
            "outer_carton_uom_id": pkg.outer_carton_uom_id,
            "shelf_life_days": pkg.shelf_life_days,
            "storage_type_id": pkg.storage_type_id,
            "temperature_category_id": pkg.temperature_category_id,
        })
    return out


@router.get("/reports/missing", response_model=list[dict])
async def missing_packaging_report(
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    """Products that have no packaging config yet."""
    configured_ids_result = await db.execute(
        select(item_packaging_master.product_id).where(item_packaging_master.is_active == True)
    )
    configured_ids = set(configured_ids_result.scalars().all())

    all_products = await db.execute(
        select(product_model.id, product_model.item_code, product_model.name, product_model.category)
        .where(product_model.is_active == True)
        .order_by(product_model.item_code)
    )
    missing = []
    for pid, icode, pname, cat in all_products.all():
        if pid not in configured_ids:
            missing.append({"product_id": pid, "item_code": icode, "name": pname, "category": cat})
    return missing
