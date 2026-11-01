import math
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update, case, null as sa_null
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role, current_user_dep
from app.models.product import product as product_model, product_barcode, outlet_pricing
from app.models.outlet import outlet as outlet_model
from app.models.sync import outlet_stock
from app.schemas.product import (
    product_create, product_update, product_out, product_list_out,
    barcode_out, barcode_generate_request,
    outlet_pricing_out, outlet_pricing_update
)
from app.schemas.common import paginated_response, success_response
from app.services.product_service import (
    create_product, update_product, add_barcode, generate_ean13,
)
from app.services.auth_service import write_audit

from app.models.packaging import item_packaging_master
from app.utils.search import word_match
from app.core import access

router = APIRouter(prefix="/products", tags=["products"])


# ── Fast product search (for QuickScan / autocomplete) ───────────────────────
# Must be defined BEFORE /{product_id} to avoid route conflict.
@router.get("/search")
@router.get("/search_ajax")
async def search_products(
    q: str = Query("", min_length=1),
    limit: int = Query(20, ge=1, le=100),
    outlet_id: int | None = Query(None, description="also return stock_qty at this outlet"),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # If outlet_id is provided, try outlet_stock, falling back to product_model.stock_qty; otherwise use product stock
    if outlet_id:
        stock_col = func.coalesce(
            select(outlet_stock.stock_qty)
            .where(outlet_stock.outlet_id == outlet_id, outlet_stock.product_id == product_model.id)
            .limit(1).scalar_subquery(),
            product_model.stock_qty,
            0
        ).label("stock_qty")
    else:
        stock_col = func.coalesce(product_model.stock_qty, 0).label("stock_qty")

    # Search by barcode in product_barcodes table to get matching product IDs
    barcode_sub = (
        select(product_barcode.product_id)
        .where(product_barcode.barcode.ilike(f"%{q}%"))
        .scalar_subquery()
    )

    stmt = (
        select(
            product_model.id,
            product_model.name,
            product_model.item_code,
            product_model.item_type,
            product_model.needs_printing,
            product_model.barcode,
            product_model.barcode_crt,
            product_model.unit,
            product_model.purchase_price,
            product_model.cost_price,
            product_model.basic_cost,
            product_model.selling_price,
            product_model.mrp,
            product_model.gst_percent,
            product_model.hsn_code,
            stock_col,
            product_model.has_batch_tracking,
            product_model.has_expiry_tracking,
            product_model.is_batch_required,
            product_model.shelf_life_days,
        )
        .where(product_model.is_active == True, *access.product_where(product_model))
        .where(
            word_match(q, product_model.name, product_model.item_code, product_model.barcode, product_model.barcode_crt) |
            ((product_model.id == int(q.strip())) if q.strip().isdigit() and len(q.strip()) < 10 else False) |
            product_model.id.in_(barcode_sub)
        )
        .order_by(product_model.name)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "item_code": r.item_code,
            "item_type": r.item_type,
            "needs_printing": bool(r.needs_printing),
            "barcode": r.barcode or r.barcode_crt or "",
            "barcode_crt": r.barcode_crt,
            "unit": r.unit or "PCS",
            "hsn_code": r.hsn_code or "",
            "purchase_price": float(r.purchase_price or 0),
            "cost_price": float(r.cost_price or 0),
            "basic_cost": float(r.basic_cost or r.purchase_price or 0),
            "selling_price": float(r.selling_price or 0),
            "mrp": float(r.mrp or 0),
            "gst_percent": float(r.gst_percent or 0),
            "stock_qty": float(r.stock_qty or 0),
            "has_batch_tracking": bool(r.has_batch_tracking or r.is_batch_required),
            "has_expiry_tracking": bool(r.has_expiry_tracking),
            "is_batch_required": bool(r.is_batch_required),
            "shelf_life_days": int(r.shelf_life_days) if r.shelf_life_days else None,
        }
        for r in rows
    ]



@router.get("", response_model=paginated_response[product_list_out])
async def list_products(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: str = Query(""),
    category_id: int | None = Query(None),
    brand_id: int | None = Query(None),
    classification_id: int | None = Query(None),
    item_type: str | None = Query(None, pattern="^(FG|RM|PM|SFG|CONS|OTH)$"),
    base_uom_id: int | None = Query(None),
    purchase_uom_id: int | None = Query(None),
    storage_type_id: int | None = Query(None),
    is_active: bool | None = Query(None),
    status: str | None = Query(None),
    is_expired: bool | None = Query(None),
    is_hidden_pos: bool | None = Query(None),
    low_stock: bool = Query(False),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Build product-level WHERE conditions (no join needed for count); the user's category / group scope first
    product_conditions = access.product_where(product_model)
    if search:
        match = word_match(search, product_model.name, product_model.item_code,
                           product_model.barcode, product_model.filter_combination_name, product_model.manufacturer_name)
        if search.strip().isdigit() and len(search.strip()) < 10:  # the item ID shown after saving (e.g. 6464) also finds the item
            match = match | (product_model.id == int(search.strip()))
        product_conditions.append(match)
    if category_id:
        product_conditions.append(product_model.category_id == category_id)
    if brand_id:
        product_conditions.append(product_model.brand_id == brand_id)
    if classification_id:
        product_conditions.append(product_model.classification_id == classification_id)
    if item_type:
        product_conditions.append(product_model.item_type == item_type)
    if is_active is not None:
        product_conditions.append(product_model.is_active == is_active)
    if low_stock:
        product_conditions.append(product_model.stock_qty <= product_model.low_stock_threshold)
    if status:
        product_conditions.append(product_model.status == status)
    if is_expired is not None:
        product_conditions.append(product_model.is_expired == is_expired)
    if is_hidden_pos is not None:
        product_conditions.append(product_model.is_hidden_pos == is_hidden_pos)

    # Packaging-level conditions (require join)
    pkg_conditions = []
    if base_uom_id:
        pkg_conditions.append(item_packaging_master.base_uom_id == base_uom_id)
    if purchase_uom_id:
        pkg_conditions.append(item_packaging_master.purchase_uom_id == purchase_uom_id)
    if storage_type_id:
        pkg_conditions.append(item_packaging_master.storage_type_id == storage_type_id)

    # Optimized COUNT — avoid expensive subquery wrapper
    needs_pkg = bool(pkg_conditions)
    count_q = select(func.count(product_model.id)).select_from(product_model)
    if needs_pkg:
        count_q = count_q.join(item_packaging_master, item_packaging_master.product_id == product_model.id)
    for cond in product_conditions + pkg_conditions:
        count_q = count_q.where(cond)
    total = (await db.execute(count_q)).scalar_one()

    # Data query with packaging LEFT JOIN
    # Note: outer_carton_qty column not yet in DB — use inner_packs_per_carton as substitute
    q = select(
        product_model,
        item_packaging_master.inner_pack_qty,
        item_packaging_master.inner_packs_per_carton,
        item_packaging_master.total_units_per_carton,
    ).outerjoin(item_packaging_master, item_packaging_master.product_id == product_model.id)
    for cond in product_conditions + pkg_conditions:
        q = q.where(cond)
    q = q.order_by(product_model.name).offset((page - 1) * per_page).limit(per_page)

    res = await db.execute(q)
    products_data = []
    for p, i_qty, o_qty, t_pcs in res.all():
        p_dict = {c.name: getattr(p, c.name) for c in p.__table__.columns}
        p_dict["inner_pack_qty"] = i_qty
        p_dict["outer_carton_qty"] = o_qty
        p_dict["total_pcs_in_carton"] = t_pcs
        products_data.append(p_dict)

    return {
        "data": products_data,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": math.ceil(total / per_page) if per_page else 1,
    }


@router.post("", response_model=product_out, status_code=status.HTTP_201_CREATED)
async def create_product_endpoint(
    body: product_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    access.check_category(body.category_id, getattr(body, "subcategory_id", None))
    return await create_product(body, db, current_user.user_id, current_user.username)


@router.get("/{product_id}", response_model=product_out)
async def get_product(
    product_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(product_model).where(product_model.id == product_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="product not found")
    await access.check_products(db, [product_id])
    return row


@router.put("/{product_id}", response_model=product_out)
async def update_product_endpoint(
    product_id: int,
    body: product_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    await access.check_products(db, [product_id])
    if access.product_restricted():
        cur = (await db.execute(select(product_model.category_id, product_model.subcategory_id).where(product_model.id == product_id))).one()
        access.check_category(body.category_id if body.category_id is not None else cur[0],
                              getattr(body, "subcategory_id", None) if getattr(body, "subcategory_id", None) is not None else cur[1])
    return await update_product(product_id, body, db, current_user.user_id, current_user.username)


@router.delete("/{product_id}", response_model=success_response)
async def delete_product(
    product_id: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(product_model).where(product_model.id == product_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="product not found")
    await access.check_products(db, [product_id])
    await db.execute(
        update(product_model).where(product_model.id == product_id).values(is_active=False, status=False)
    )
    await write_audit(db=db, module="products", action="deactivate", record_id=product_id,
                      user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "product deactivated", "id": product_id}


# ── Barcodes ──────────────────────────────────────────────────────────────────

@router.get("/{product_id}/barcodes", response_model=list[barcode_out])
async def get_product_barcodes(
    product_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(product_barcode).where(product_barcode.product_id == product_id)
    )).scalars().all()
    return rows


@router.post("/barcode/generate", response_model=barcode_out, status_code=201)
async def generate_barcode(
    body: barcode_generate_request,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    barcode_val = body.barcode or generate_ean13()
    return await add_barcode(
        product_id=body.product_id,
        barcode_val=barcode_val,
        barcode_type=body.barcode_type,
        is_primary=body.is_primary,
        db=db,
        user_id=current_user.user_id,
        username=current_user.username,
    )


@router.delete("/barcode/{barcode_id}", response_model=success_response)
async def delete_barcode(
    barcode_id: int,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(product_barcode).where(product_barcode.id == barcode_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="barcode not found")
    if row.is_primary:
        raise HTTPException(status_code=400, detail="cannot delete primary barcode — set another as primary first")
    await db.delete(row)
    await db.commit()
    return {"message": "barcode deleted", "id": barcode_id}


# ── Lookup by barcode ─────────────────────────────────────────────────────────

@router.get("/lookup/barcode/{code}", response_model=product_out)
async def lookup_by_barcode(
    code: str,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 1. Search in product_barcodes table
    bc = (await db.execute(
        select(product_barcode).where(product_barcode.barcode == code)
    )).scalar_one_or_none()
    
    if bc:
        prod = (await db.execute(select(product_model).where(product_model.id == bc.product_id))).scalar_one_or_none()
        if prod and prod.is_active:
            await access.check_products(db, [prod.id])
            return prod

    # 2. Search in main product table (direct barcode or item_code)
    prod = (await db.execute(
        select(product_model).where(
            (product_model.barcode == code) | 
            (product_model.item_code == code) |
            (product_model.barcode_crt == code)
        ).where(product_model.is_active == True)
    )).scalar_one_or_none()
    
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found by barcode or code")
    await access.check_products(db, [prod.id])
    return prod


# ── Outlet Pricing ────────────────────────────────────────────────────────────

@router.get("/{id}/outlet-pricing", response_model=list[outlet_pricing_out])
async def get_outlet_pricing_route(
    id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 1. Fetch all active outlets
    outlets = (await db.execute(select(outlet_model).where(outlet_model.is_active == True))).scalars().all()
    
    # 2. Fetch existing pricing for this product
    prices = (await db.execute(select(outlet_pricing).where(outlet_pricing.product_id == id))).scalars().all()
    price_map = {p.outlet_id: p for p in prices}
    
    # 3. Combine them
    results = []
    for o in outlets:
        p = price_map.get(o.id)
        results.append({
            "id": p.id if p else 0,
            "outlet_id": o.id,
            "product_id": id,
            "cost_price": p.cost_price if p else None,
            "wsp": p.wsp if p else None,
            "mrp": p.mrp if p else None,
            "selling_price": p.selling_price if p else None,
            "stock_qty": p.stock_qty if p else 0.0,
            "is_active": p.is_active if p else True,
            "unit_code": o.unit_code,
            "outlet_name": o.outlet_name,
            "type": "HO" if o.type == "H" else "Outlet"
        })
    return results


@router.post("/{id}/outlet-pricing", response_model=success_response)
async def update_outlet_pricing_route(
    id: int,
    body: list[outlet_pricing_update],
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for entry in body:
        # Check if pricing exists
        p = (await db.execute(
            select(outlet_pricing)
            .where(outlet_pricing.product_id == id)
            .where(outlet_pricing.outlet_id == entry.outlet_id)
        )).scalar_one_or_none()
        
        if p:
            p.cost_price = entry.cost_price
            p.wsp = entry.wsp
            p.mrp = entry.mrp
            p.selling_price = entry.selling_price
            p.is_active = entry.is_active if entry.is_active is not None else True
        else:
            new_p = outlet_pricing(
                product_id=id,
                outlet_id=entry.outlet_id,
                cost_price=entry.cost_price,
                wsp=entry.wsp,
                mrp=entry.mrp,
                selling_price=entry.selling_price,
                is_active=entry.is_active if entry.is_active is not None else True,
                stock_qty=0.0
            )
            db.add(new_p)
            
    await db.commit()
    return {"message": "Outlet pricing updated successfully"}


@router.get("/{product_id}/activity")
async def get_product_activity(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user)
):
    # Get last 7 days
    today = date.today()
    start_date = today - timedelta(days=6)
    
    # 1. Qty from stock_ledger
    from app.models.invoice import stock_ledger
    q_qty = select(
        func.date(stock_ledger.created_at).label("d"),
        func.sum(case((stock_ledger.qty > 0, stock_ledger.qty), else_=0)).label("in_qty"),
        func.sum(case((stock_ledger.qty < 0, func.abs(stock_ledger.qty)), else_=0)).label("out_qty")
    ).where(
        stock_ledger.product_id == product_id,
        func.date(stock_ledger.created_at) >= start_date
    ).group_by("d")
    
    # 2. Amount from unit_wise_invoice_items (Sales)
    from app.models.invoice import invoice_item, invoice as invoice_model
    q_sales = select(
        func.date(invoice_model.invoice_date).label("d"),
        func.sum(invoice_item.total).label("amount")
    ).join(invoice_model, invoice_item.invoice_id == invoice_model.id).where(
        invoice_item.product_id == product_id,
        invoice_model.invoice_date >= start_date
    ).group_by("d")
    
    # 3. Amount from supplier_challan_items (Purchases)
    from app.models.party import supplier_challan_item, supplier_challan
    q_purch = select(
        func.date(supplier_challan.challan_date).label("d"),
        func.sum(supplier_challan_item.qty * supplier_challan_item.tentative_rate).label("amount")
    ).join(supplier_challan, supplier_challan_item.challan_id == supplier_challan.id).where(
        supplier_challan_item.product_id == product_id,
        supplier_challan.challan_date >= start_date
    ).group_by("d")
    
    # Execute
    res_qty = (await db.execute(q_qty)).all()
    res_sales = (await db.execute(q_sales)).all()
    res_purch = (await db.execute(q_purch)).all()
    
    # Merge into 7 days array
    activity = []
    for i in range(7):
        curr_date = start_date + timedelta(days=i)
        
        in_qty = sum(r.in_qty for r in res_qty if r.d == curr_date)
        out_qty = sum(r.out_qty for r in res_qty if r.d == curr_date)
        out_amt = sum(r.amount for r in res_sales if r.d == curr_date)
        in_amt = sum(r.amount for r in res_purch if r.d == curr_date)
        
        activity.append({
            "date": curr_date.strftime("%Y-%m-%d"),
            "label": curr_date.strftime("%b %d"),
            "in_qty": float(in_qty or 0),
            "out_qty": float(out_qty or 0),
            "in_amount": float(in_amt or 0),
            "out_amount": float(out_amt or 0)
        })
        
    return activity
