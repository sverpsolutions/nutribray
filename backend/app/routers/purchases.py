import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user, current_user_dep
from app.models.purchase import (
    po_header, po_item, po_terms_condition, po_distribution_hdr,
    po_distribution_dtl, po_audit_log, supplier_po_terms,
    purchase, purchase_item,
)
from app.schemas.purchase import (
    po_create, po_update, po_approve_in,
    po_list_out, po_detail_out,
    item_intel_out, doh_outlet_row,
    distribution_save_in, distribution_hdr_out,
    supplier_po_terms_in, supplier_po_terms_out,
    purchase_create, purchase_list_out, purchase_detail_out,
    multi_po_create, vendor_invoice_in,
)
from app.services.auth_service import write_audit
from app.services.billing_service import _write_stock_ledger
from app.services import batch_service
from app.models.product import product as product_model
from app.core import access

router = APIRouter(prefix="/purchases", tags=["purchases"])


# ─── HELPERS ─────────────────────────────────────────────────────────────────
async def _next_purchase_no(db: AsyncSession) -> str:
    prefix = "GRN-" + date.today().strftime("%Y%m%d")
    row = await db.execute(
        text("SELECT MAX(purchase_no) FROM unit_wise_purchases WHERE purchase_no LIKE :p"),
        {"p": prefix + "%"}
    )
    last = row.scalar()
    seq = int(last[-4:]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


async def _next_po_no(db: AsyncSession) -> str:
    prefix = "PO-" + date.today().strftime("%Y%m%d")
    row = await db.execute(
        text("SELECT MAX(po_no) FROM po_headers WHERE po_no LIKE :p"),
        {"p": prefix + "%"}
    )
    last = row.scalar()
    seq = int(last[-4:]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


async def _supplier_details(db: AsyncSession, supplier_id: int) -> dict:
    row = await db.execute(text("SELECT name, address, city, state, pincode, gst_number, email, phone FROM suppliers WHERE id = :id"), {"id": supplier_id})
    r = row.fetchone()
    if not r: return {"name": None}
    return {
        "name": r[0], "address": r[1], "city": r[2], "state": r[3],
        "pincode": r[4], "gst_number": r[5], "email": r[6], "phone": r[7]
    }


async def _outlet_details(db: AsyncSession, outlet_id: int | None) -> dict:
    if not outlet_id:
        return {"name": None}
    row = await db.execute(text("SELECT outlet_name, address, city, state, manager_email, store_phone, gst_number FROM outlets WHERE id = :id"), {"id": outlet_id})
    r = row.fetchone()
    if not r:
        row2 = await db.execute(text("SELECT name, address, city, state, email, phone, gstin FROM outlet_master WHERE id = :id"), {"id": outlet_id})
        r2 = row2.fetchone()
        if not r2: return {"name": None}
        return {
            "name": r2[0], "address": r2[1], "city": r2[2], "state": r2[3],
            "pincode": None, "email": r2[4], "phone": r2[5], "gst_number": r2[6]
        }
    return {
        "name": r[0], "address": r[1], "city": r[2], "state": r[3],
        "pincode": None, "email": r[4], "phone": r[5], "gst_number": r[6]
    }


async def _supplier_name(db: AsyncSession, supplier_id: int) -> str | None:
    d = await _supplier_details(db, supplier_id)
    return d.get("name")


async def _outlet_name(db: AsyncSession, outlet_id: int | None) -> str | None:
    d = await _outlet_details(db, outlet_id)
    return d.get("name")


async def _product_info(db: AsyncSession, product_id: int) -> dict:
    row = await db.execute(
        text("SELECT name, item_code, unit, purchase_price, mrp, gst_percent, hsn_code, cost_price, wsp, barcode, shelf_life_days, has_batch_tracking, is_batch_required, has_expiry_tracking FROM products WHERE id = :id"),
        {"id": product_id}
    )
    r = row.fetchone()
    if not r:
        return {}
    
    # Try purchase_price, then cost_price, then wsp
    pp = r[3] if r[3] is not None else 0
    cp = r[7] if r[7] is not None else 0
    wsp = r[8] if r[8] is not None else 0
    best_cost = float(pp) if float(pp) > 0 else (float(cp) if float(cp) > 0 else float(wsp))

    return {
        "name": r[0],
        "item_code": r[1],
        "unit": r[2],
        "purchase_price": best_cost,
        "mrp": r[4] if r[4] is not None else 0,
        "gst_percent": r[5] if r[5] is not None else 0,
        "hsn_code": r[6],
        "barcode": r[9] if len(r) > 9 and r[9] is not None else "",
        "shelf_life_days": r[10],
        "has_batch_tracking": bool(r[11] or r[12]),
        "has_expiry_tracking": bool(r[13]),
    }


def _po_ordered(pi) -> Decimal:
    return Decimal(str(pi.order_qty or pi.qty or 0))


async def _log_audit(db: AsyncSession, po_id: int, action: str, description: str = "",
                     old_status: str | None = None, new_status: str | None = None,
                     user_id: int | None = None):
    db.add(po_audit_log(
        po_id=po_id, action=action, description=description,
        old_status=old_status, new_status=new_status, created_by=user_id
    ))


# ═══════════════════════════════════════════════════════════════════════════════
# STOCK INTELLIGENCE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/intelligence/next-po-no")
async def get_next_po_no(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return {"po_no": await _next_po_no(db)}


@router.get("/intelligence/item/{product_id}", response_model=item_intel_out)
async def get_item_intelligence(
    product_id: int,
    outlet_id: int | None = Query(default=None),
    lead_days: int = Query(default=7),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    # SOH — total stock across all outlets
    soh_q = await db.execute(
        text("SELECT COALESCE(SUM(stock_qty),0) FROM outlet_stock WHERE product_id = :pid"),
        {"pid": product_id}
    )
    soh = Decimal(str(soh_q.scalar() or 0))

    # Outlet-specific stock
    outlet_stock = Decimal("0")
    if outlet_id:
        os_q = await db.execute(
            text("SELECT COALESCE(SUM(stock_qty),0) FROM outlet_stock WHERE product_id=:pid AND outlet_id=:oid"),
            {"pid": product_id, "oid": outlet_id}
        )
        outlet_stock = Decimal(str(os_q.scalar() or 0))

    # 7-day sales
    d7 = await db.execute(
        text("""SELECT COALESCE(SUM(i.qty),0) FROM unit_wise_invoice_items i
                JOIN unit_wise_invoices inv ON inv.id=i.invoice_id
                WHERE i.product_id=:pid AND inv.invoice_datetime >= :dt"""),
        {"pid": product_id, "dt": datetime.now() - timedelta(days=7)}
    )
    sale_7d = Decimal(str(d7.scalar() or 0))

    # 30-day sales
    d30 = await db.execute(
        text("""SELECT COALESCE(SUM(i.qty),0) FROM unit_wise_invoice_items i
                JOIN unit_wise_invoices inv ON inv.id=i.invoice_id
                WHERE i.product_id=:pid AND inv.invoice_datetime >= :dt"""),
        {"pid": product_id, "dt": datetime.now() - timedelta(days=30)}
    )
    sale_30d = Decimal(str(d30.scalar() or 0))

    avg_daily = sale_30d / 30 if sale_30d > 0 else Decimal("0")
    doh = float(outlet_stock / avg_daily) if avg_daily > 0 and outlet_stock > 0 else None

    # Suggested qty = (avg_daily × lead_days) - soh, min 0
    suggested = max(Decimal("0"), (avg_daily * lead_days) - soh)

    # Last purchase rate
    last_r = await db.execute(
        text("""SELECT price FROM unit_wise_purchase_items
                WHERE product_id=:pid ORDER BY id DESC LIMIT 1"""),
        {"pid": product_id}
    )
    last_row = last_r.fetchone()
    last_rate = Decimal(str(last_row[0])) if last_row and last_row[0] is not None else Decimal("0")

    if not last_rate:
        p = await _product_info(db, product_id)
        last_rate = Decimal(str(p.get("purchase_price") or 0))

    # Last 3 purchase dates + rates
    lp_q = await db.execute(
        text("""SELECT p.created_at, pi.price
                FROM unit_wise_purchase_items pi
                JOIN unit_wise_purchases p ON p.id=pi.purchase_id
                WHERE pi.product_id=:pid ORDER BY pi.id DESC LIMIT 3"""),
        {"pid": product_id}
    )
    last_purchases = [{"date": str(r[0])[:10], "rate": float(r[1])} for r in lp_q.fetchall()]

    return item_intel_out(
        product_id=product_id,
        soh=soh, outlet_stock=outlet_stock, doh=doh,
        sale_7d=sale_7d, sale_30d=sale_30d, avg_daily_sale=avg_daily,
        last_rate=last_rate, suggested_qty=suggested,
        last_purchases=last_purchases,
    )


@router.get("/intelligence/doh-popup/{product_id}")
async def get_doh_popup(product_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    outlets = (await db.execute(
        text("SELECT ID, OUTLET_NAME FROM outlet_master WHERE ISACTIVE=1 ORDER BY OUTLET_NAME")
    )).fetchall()

    # Total 30-day sales for avg
    total_30d_q = await db.execute(
        text("""SELECT COALESCE(SUM(i.qty),0) FROM unit_wise_invoice_items i
                JOIN unit_wise_invoices inv ON inv.id=i.invoice_id
                WHERE i.product_id=:pid AND inv.invoice_datetime >= :dt"""),
        {"pid": product_id, "dt": datetime.now() - timedelta(days=30)}
    )
    global_avg = float(total_30d_q.scalar() or 0) / 30

    rows: list[doh_outlet_row] = []
    for o in outlets:
        stock_q = await db.execute(
            text("SELECT COALESCE(SUM(stock_qty),0) FROM outlet_stock WHERE product_id=:pid AND outlet_id=:oid"),
            {"pid": product_id, "oid": o[0]}
        )
        stock = float(stock_q.scalar() or 0)

        outlet_sale_q = await db.execute(
            text("""SELECT COALESCE(SUM(i.qty),0) FROM unit_wise_invoice_items i
                    JOIN unit_wise_invoices inv ON inv.id=i.invoice_id
                    WHERE i.product_id=:pid AND inv.outlet_id=:oid
                      AND inv.invoice_datetime >= :dt"""),
            {"pid": product_id, "oid": o[0], "dt": datetime.now() - timedelta(days=30)}
        )
        outlet_sale = float(outlet_sale_q.scalar() or 0)
        avg = outlet_sale / 30 if outlet_sale > 0 else global_avg
        doh = round(stock / avg, 1) if avg > 0 and stock > 0 else None

        rows.append(doh_outlet_row(outlet_name=o[1], current_qty=stock, avg_sale=round(avg, 3), doh=doh))

    return {"product_id": product_id, "rows": rows}


@router.get("/intelligence/supplier-terms/{supplier_id}")
async def get_supplier_terms(supplier_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(select(supplier_po_terms).where(supplier_po_terms.supplier_id == supplier_id))
    st = result.scalar_one_or_none()

    # Supplier meta (lead days, markdown)
    sup_q = await db.execute(
        text("SELECT default_lead_days, default_markdown_percent FROM suppliers WHERE id=:id"),
        {"id": supplier_id}
    )
    sup = sup_q.fetchone()

    terms_list = []
    labels = {
        "payment_terms": "💰 Payment Terms",
        "delivery_terms": "🚚 Delivery Terms",
        "transport_terms": "🚛 Transport Terms",
        "tax_terms": "🧾 Tax/GST Terms",
        "replacement_policy": "🔄 Replacement Policy",
        "default_po_terms": "📋 Default PO Terms",
        "remarks": "📝 Remarks",
    }
    if st:
        for field, label in labels.items():
            val = getattr(st, field, None)
            if val:
                terms_list.append({"field": field, "label": label, "text": val})

    return {
        "terms": terms_list,
        "structured": st,
        "default_lead_days": sup[0] if sup and sup[0] else 7,
        "markdown_percent": float(sup[1]) if sup and sup[1] else 0,
    }


@router.post("/intelligence/supplier-terms/{supplier_id}")
async def save_supplier_terms(
    supplier_id: int, body: supplier_po_terms_in,
    db: AsyncSession = Depends(get_db), _=Depends(get_current_user)
):
    result = await db.execute(select(supplier_po_terms).where(supplier_po_terms.supplier_id == supplier_id))
    existing = result.scalar_one_or_none()
    data = body.model_dump()
    if existing:
        for k, v in data.items():
            setattr(existing, k, v)
        existing.updated_at = datetime.now()
    else:
        db.add(supplier_po_terms(supplier_id=supplier_id, **data))
    await db.commit()
    return {"success": True}


@router.get("/intelligence/supplier-brands/{supplier_id}")
async def get_supplier_brands(supplier_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    rows = await db.execute(
        text("SELECT DISTINCT brand_id, brand FROM products WHERE supplier_id=:sid AND brand_id IS NOT NULL AND is_active=TRUE"),
        {"sid": supplier_id}
    )
    return [{"brand_id": r[0], "brand": r[1]} for r in rows.fetchall()]


@router.get("/intelligence/supplier-items/{supplier_id}")
async def get_supplier_items(
    supplier_id: int,
    outlet_id: int | None = Query(default=None),
    brand_ids: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    params: dict[str, Any] = {"sid": supplier_id}
    sql = ("SELECT p.id, p.name, p.item_code, p.unit, p.purchase_price, p.mrp FROM products p WHERE p.supplier_id=:sid AND p.is_active=TRUE"
           + access.product_filter("p", params))

    if brand_ids:
        ids = [int(x) for x in brand_ids.split(",") if x.strip().isdigit()]
        if ids:
            sql += f" AND brand_id = ANY(:bids)"
            params["bids"] = ids

    rows = (await db.execute(text(sql), params)).fetchall()
    return [{"id": r[0], "name": r[1], "item_code": r[2], "unit": r[3], "purchase_price": float(r[4] or 0), "mrp": float(r[5] or 0)} for r in rows]


# ═══════════════════════════════════════════════════════════════════════════════
# PO CRUD
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/po")
async def list_pos(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    status: str | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    is_master: bool | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    q = select(po_header).where(*access.outlet_where(po_header.outlet_id)).order_by(po_header.id.desc())
    if status:
        q = q.where(po_header.approval_status == status)
    if supplier_id:
        q = q.where(po_header.supplier_id == supplier_id)
    if is_master is not None:
        q = q.where(po_header.is_master == is_master)

    total_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(total_q)).scalar_one()

    q = q.offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(q)).scalars().all()

    result = []
    for r in rows:
        sn = await _supplier_name(db, r.supplier_id)
        on = await _outlet_name(db, r.outlet_id)
        cnt_q = await db.execute(
            text("SELECT COUNT(*) FROM po_items WHERE po_id=:pid"), {"pid": r.id}
        )
        result.append({
            "id": r.id, "po_no": r.po_no, "supplier_id": r.supplier_id,
            "supplier_name": sn, "outlet_id": r.outlet_id, "outlet_name": on,
            "po_date": str(r.po_date), "expected_date": str(r.expected_date) if r.expected_date else None,
            "delivery_days": r.delivery_days, "total_amount": float(r.total_amount),
            "status": r.status, "approval_status": r.approval_status,
            "markdown_enabled": r.markdown_enabled, "created_at": str(r.created_at),
            "item_count": cnt_q.scalar(),
        })

    return {"data": result, "total": total, "page": page, "per_page": per_page}


@router.post("/po")
async def create_po(
    body: po_create,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    access.check_outlet(body.outlet_id)
    await access.check_products(db, [it.product_id for it in body.items])
    po_no = body.po_no or await _next_po_no(db)

    # Check duplicate
    exists = await db.execute(select(po_header).where(po_header.po_no == po_no))
    if exists.scalar_one_or_none():
        raise HTTPException(400, f"PO number {po_no} already exists.")

    try:
        h = po_header(
            po_no=po_no, supplier_id=body.supplier_id, outlet_id=body.outlet_id,
            po_date=body.po_date, expected_date=body.expected_date,
            delivery_days=body.delivery_days, total_amount=body.total_amount,
            status=body.status, approval_status="draft" if body.status == "draft" else ("approved" if body.status == "approved" else "pending_approval"),
            markdown_enabled=body.markdown_enabled, terms=body.terms, notes=body.notes,
            created_by=user.user_id,
        )
        db.add(h)
        await db.flush()  # get h.id

        # Items
        for it in body.items:
            amt = it.order_qty * it.rate
            gst_amt = amt * it.gst_percent / 100
            db.add(po_item(
                po_id=h.id, product_id=it.product_id,
                qty=it.order_qty, order_qty=it.order_qty,
                rate=it.rate, gst_percent=it.gst_percent,
                total=amt + gst_amt, amount=amt,
                mrp=it.mrp, markdown_percent=it.markdown_percent,
                warehouse_stock=it.warehouse_stock, outlet_stock=it.outlet_stock,
                doh_value=it.doh_value, sale_7d=it.sale_7d, sale_30d=it.sale_30d,
                avg_daily_sale=it.avg_daily_sale, suggested_qty=it.suggested_qty,
            ))

        # Fixed terms snapshot
        for i, t in enumerate(body.fixed_terms):
            db.add(po_terms_condition(
                po_id=h.id, term_type="FIXED", title=t.title,
                description=t.description, sequence_no=i + 1, created_by=user.user_id
            ))

        # Dynamic terms
        for i, t in enumerate(body.dynamic_terms):
            if t.title.strip():
                db.add(po_terms_condition(
                    po_id=h.id, term_type="DYNAMIC", title=t.title,
                    description=t.description, sequence_no=i + 1, created_by=user.user_id
                ))

        await _log_audit(db, h.id, "PO Created",
                         f"PO created with {len(body.items)} items.",
                         new_status=h.approval_status, user_id=user.user_id)
        await write_audit(db=db, module="purchases", action="create_po",
                          record_id=h.id, record_no=h.po_no,
                          description=f"PO {h.po_no} created for {h.total_amount}",
                          user_id=user.user_id, user_name=user.username)
        await db.commit()
        email = None
        if h.approval_status == "approved":       # Save & Approve
            from app.routers.purchase_controls import on_po_approved
            email = await on_po_approved(db, h.id, user.user_id)
        return {"success": True, "po_id": h.id, "po_no": h.po_no, "email": email}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"BACKEND ERROR: {str(e)}")


@router.post("/multi-po")
async def create_multi_po(
    body: multi_po_create,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await access.check_products(db, [it.product_id for it in body.items])
    for it in body.items:
        for oid in (it.distributions or {}):
            access.check_outlet(int(oid))
    master_po_no = body.po_no or await _next_po_no(db)

    exists = await db.execute(select(po_header).where(po_header.po_no == master_po_no))
    if exists.scalar_one_or_none():
        raise HTTPException(400, f"PO number {master_po_no} already exists.")

    try:
        h = po_header(
            po_no=master_po_no, supplier_id=body.supplier_id, outlet_id=None,
            po_date=body.po_date, expected_date=body.expected_date,
            delivery_days=body.delivery_days, total_amount=body.total_amount,
            status=body.status, approval_status="draft" if body.status == "draft" else ("approved" if body.status == "approved" else "pending_approval"),
            markdown_enabled=body.markdown_enabled, terms=body.terms, notes=body.notes,
            created_by=user.user_id, is_master=True
        )
        db.add(h)
        await db.flush()

        outlet_ids = set()
        for it in body.items:
            for oid, qty in it.distributions.items():
                if Decimal(str(qty)) > 0:
                    outlet_ids.add(int(oid))

        master_item_map = {}
        for it in body.items:
            amt = it.order_qty * it.rate
            gst_amt = amt * it.gst_percent / 100
            mi = po_item(
                po_id=h.id, product_id=it.product_id,
                qty=it.order_qty, order_qty=it.order_qty,
                rate=it.rate, gst_percent=it.gst_percent,
                total=amt + gst_amt, amount=amt,
                mrp=it.mrp, markdown_percent=it.markdown_percent,
                warehouse_stock=it.warehouse_stock, outlet_stock=it.outlet_stock,
                doh_value=it.doh_value, sale_7d=it.sale_7d, sale_30d=it.sale_30d,
                avg_daily_sale=it.avg_daily_sale, suggested_qty=it.suggested_qty,
            )
            db.add(mi)
            await db.flush()
            master_item_map[it.product_id] = mi.id

        for i, t in enumerate(body.fixed_terms):
            db.add(po_terms_condition(po_id=h.id, term_type="FIXED", title=t.title, description=t.description, sequence_no=i+1, created_by=user.user_id))
        for i, t in enumerate(body.dynamic_terms):
            if t.title.strip():
                db.add(po_terms_condition(po_id=h.id, term_type="DYNAMIC", title=t.title, description=t.description, sequence_no=i+1, created_by=user.user_id))

        for idx, oid in enumerate(outlet_ids):
            dist_hdr = po_distribution_hdr(po_id=h.id, outlet_id=oid)
            db.add(dist_hdr)
            await db.flush()

            child_po_no = f"{master_po_no}-{idx+1}"
            child_total_amount = Decimal("0.00")
            
            ch = po_header(
                po_no=child_po_no, supplier_id=body.supplier_id, outlet_id=oid,
                po_date=body.po_date, expected_date=body.expected_date,
                delivery_days=body.delivery_days, total_amount=Decimal("0"),
                status=body.status, approval_status="draft" if body.status == "draft" else ("approved" if body.status == "approved" else "pending_approval"),
                markdown_enabled=body.markdown_enabled, terms=body.terms, notes=body.notes,
                created_by=user.user_id, is_master=False, parent_po_id=h.id
            )
            db.add(ch)
            await db.flush()

            for i, t in enumerate(body.fixed_terms):
                db.add(po_terms_condition(po_id=ch.id, term_type="FIXED", title=t.title, description=t.description, sequence_no=i+1, created_by=user.user_id))
            for i, t in enumerate(body.dynamic_terms):
                if t.title.strip():
                    db.add(po_terms_condition(po_id=ch.id, term_type="DYNAMIC", title=t.title, description=t.description, sequence_no=i+1, created_by=user.user_id))

            for it in body.items:
                qty = it.distributions.get(str(oid)) or it.distributions.get(oid)
                if qty and Decimal(str(qty)) > 0:
                    qty_dec = Decimal(str(qty))
                    db.add(po_distribution_dtl(
                        distribution_id=dist_hdr.id, po_item_id=master_item_map[it.product_id],
                        product_id=it.product_id, allocated_qty=qty_dec, pending_qty=qty_dec
                    ))
                    
                    amt = qty_dec * it.rate
                    gst_amt = amt * it.gst_percent / 100
                    child_total_amount += (amt + gst_amt)

                    db.add(po_item(
                        po_id=ch.id, product_id=it.product_id,
                        qty=qty_dec, order_qty=qty_dec,
                        rate=it.rate, gst_percent=it.gst_percent,
                        total=amt + gst_amt, amount=amt,
                        mrp=it.mrp, markdown_percent=it.markdown_percent,
                        warehouse_stock=0, outlet_stock=0,
                        doh_value=0, sale_7d=0, sale_30d=0,
                        avg_daily_sale=0, suggested_qty=0,
                    ))

            ch.total_amount = child_total_amount

        await _log_audit(db, h.id, "Multi PO Created", f"Master PO distributed to {len(outlet_ids)} outlets.", new_status=h.approval_status, user_id=user.user_id)
        await write_audit(db=db, module="purchases", action="create_multi_po", record_id=h.id, record_no=h.po_no, description=f"Multi PO created", user_id=user.user_id, user_name=user.username)
        await db.commit()
        return {"success": True, "po_id": h.id, "po_no": h.po_no}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"BACKEND ERROR: {str(e)}")


@router.get("/po/guest/{po_id}")
@router.get("/po/{po_id}")
async def get_po(po_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(po_header)
        .options(
            selectinload(po_header.items),
            selectinload(po_header.terms_conditions),
            selectinload(po_header.audit_logs),
            selectinload(po_header.distributions).selectinload(po_distribution_hdr.details),
        )
        .where(po_header.id == po_id)
    )
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(404, "PO not found")
    access.check_outlet(h.outlet_id)

    sd = await _supplier_details(db, h.supplier_id)
    od = await _outlet_details(db, h.outlet_id)

    # Enrich items with product info
    items_out = []
    for it in h.items:
        p = await _product_info(db, it.product_id)
        items_out.append({
            "id": it.id, "product_id": it.product_id,
            "product_name": p.get("name"), "item_code": p.get("item_code"), "base_unit": p.get("unit"),
            "hsn_code": p.get("hsn_code"),
            "order_qty": float(it.order_qty or 0), "qty": float(it.qty or 0), "rate": float(it.rate or 0),
            "gst_percent": float(it.gst_percent or 0), "total": float(it.total or 0), "amount": float(it.amount or 0),
            "received_qty": float(it.received_qty or 0), "warehouse_stock": float(it.warehouse_stock or 0),
            "outlet_stock": float(it.outlet_stock or 0), "doh_value": float(it.doh_value) if it.doh_value is not None else None,
            "sale_7d": float(it.sale_7d or 0), "sale_30d": float(it.sale_30d or 0),
            "avg_daily_sale": float(it.avg_daily_sale or 0), "suggested_qty": float(it.suggested_qty or 0),
            "mrp": float(it.mrp or 0), "markdown_percent": float(it.markdown_percent or 0),
            "shelf_life_days": p.get("shelf_life_days"), "has_batch_tracking": p.get("has_batch_tracking"),
            "has_expiry_tracking": p.get("has_expiry_tracking"),
        })

    # Distributions with outlet names
    dist_out = []
    for d in h.distributions:
        odist = await _outlet_details(db, d.outlet_id)
        child_res = await db.execute(select(po_header.id).where(po_header.parent_po_id == h.id, po_header.outlet_id == d.outlet_id))
        child_po_id = child_res.scalar_one_or_none()
        dist_out.append({
            "id": d.id, "outlet_id": d.outlet_id, "outlet_name": odist.get("name"),
            "status": d.status, "transfer_status": d.transfer_status, "remarks": d.remarks,
            "child_po_id": child_po_id,
            "details": [{"po_item_id": dtl.po_item_id, "product_id": dtl.product_id,
                          "allocated_qty": float(dtl.allocated_qty), "received_qty": float(dtl.received_qty),
                          "pending_qty": float(dtl.pending_qty)} for dtl in d.details]
        })

    return {
        "id": h.id, "po_no": h.po_no, "supplier_id": h.supplier_id, "supplier_name": sd.get("name"),
        "supplier_details": sd, "outlet_id": h.outlet_id, "outlet_name": od.get("name"), "outlet_details": od, "po_date": str(h.po_date),
        "expected_date": str(h.expected_date) if h.expected_date else None,
        "delivery_days": h.delivery_days, "total_amount": float(h.total_amount),
        "status": h.status, "approval_status": h.approval_status,
        "approved_by": h.approved_by, "approved_at": str(h.approved_at) if h.approved_at else None,
        "approval_remarks": h.approval_remarks, "reject_reason": h.reject_reason,
        "markdown_enabled": h.markdown_enabled, "terms": h.terms, "notes": h.notes,
        "is_master": h.is_master,
        "parent_po_id": h.parent_po_id,
        "vendor_invoice_no": h.vendor_invoice_no,
        "vendor_invoice_date": str(h.vendor_invoice_date) if h.vendor_invoice_date else None,
        "vendor_invoice_file": h.vendor_invoice_file,
        "created_by": h.created_by, "created_at": str(h.created_at),
        "items": items_out,
        "terms_conditions": [{"id": t.id, "term_type": t.term_type, "title": t.title,
                               "description": t.description, "sequence_no": t.sequence_no}
                              for t in h.terms_conditions],
        "audit_logs": [{"id": a.id, "action": a.action, "description": a.description,
                         "old_status": a.old_status, "new_status": a.new_status,
                         "created_by": a.created_by, "created_at": str(a.created_at)}
                        for a in h.audit_logs],
        "distributions": dist_out,
    }


@router.post("/po/guest/{po_id}/submit-invoice")
async def submit_guest_invoice(po_id: int, body: vendor_invoice_in, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(po_header).where(po_header.id == po_id))
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(404, "PO not found")
    
    if h.status not in ["approved", "partial"]:
        raise HTTPException(400, "Invoices can only be submitted for approved POs")

    h.vendor_invoice_no = body.vendor_invoice_no
    h.vendor_invoice_date = body.vendor_invoice_date
    if body.vendor_invoice_file:
        h.vendor_invoice_file = body.vendor_invoice_file
    h.status = "vendor_invoiced"
    
    # Audit log
    await _log_audit(db, po_id, "Vendor Invoice Submitted", f"Invoice #{body.vendor_invoice_no} submitted by vendor", old_status=h.status, new_status="vendor_invoiced")
    
    await db.commit()
    return {"message": "Invoice submitted successfully"}

@router.put("/po/{po_id}")
async def update_po(
    po_id: int, body: po_update,
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    result = await db.execute(select(po_header).where(po_header.id == po_id))
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(404, "PO not found")
    if h.approval_status not in ("draft",):
        raise HTTPException(403, "Only draft POs can be edited.")
    access.check_outlet(h.outlet_id)
    access.check_outlet(getattr(body, "outlet_id", None))
    if body.items is not None:
        await access.check_products(db, [it.product_id for it in body.items])

    for field in ("supplier_id", "outlet_id", "expected_date", "delivery_days",
                  "total_amount", "notes", "terms", "markdown_enabled"):
        val = getattr(body, field, None)
        if val is not None:
            setattr(h, field, val)
    h.updated_at = datetime.now()

    if body.items is not None:
        # Delete old items
        await db.execute(text("DELETE FROM po_items WHERE po_id=:pid"), {"pid": po_id})
        await db.flush()
        for it in body.items:
            amt = it.order_qty * it.rate
            gst_amt = amt * it.gst_percent / 100
            db.add(po_item(
                po_id=po_id, product_id=it.product_id,
                qty=it.order_qty, order_qty=it.order_qty,
                rate=it.rate, gst_percent=it.gst_percent,
                total=amt + gst_amt, amount=amt,
                mrp=it.mrp, markdown_percent=it.markdown_percent,
                warehouse_stock=it.warehouse_stock, outlet_stock=it.outlet_stock,
                doh_value=it.doh_value, sale_7d=it.sale_7d, sale_30d=it.sale_30d,
                avg_daily_sale=it.avg_daily_sale, suggested_qty=it.suggested_qty,
            ))

    if body.dynamic_terms is not None:
        await db.execute(
            text("DELETE FROM po_terms_conditions WHERE po_id=:pid AND term_type='DYNAMIC'"),
            {"pid": po_id}
        )
        for i, t in enumerate(body.dynamic_terms):
            if t.title.strip():
                db.add(po_terms_condition(po_id=po_id, term_type="DYNAMIC",
                                          title=t.title, description=t.description,
                                          sequence_no=i + 1, created_by=user.user_id))

    await _log_audit(db, po_id, "PO Updated", f"Items/terms updated.", user_id=user.user_id)
    await write_audit(db=db, module="purchases", action="update_po",
                      record_id=po_id, record_no=h.po_no,
                      description=f"PO {h.po_no} updated",
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"success": True}


@router.post("/po/{po_id}/approve")
async def approve_po(
    po_id: int, body: po_approve_in,
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    result = await db.execute(select(po_header).where(po_header.id == po_id))
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(404, "PO not found")
    access.check_outlet(h.outlet_id)

    old = h.approval_status
    h.approval_status = body.status
    h.updated_at = datetime.now()

    if body.status == "approved":
        h.status = "approved"
        h.approved_by = user.user_id
        h.approved_at = datetime.now()
        h.approval_remarks = body.remarks
    elif body.status == "cancelled":
        h.status = "cancelled"
        h.reject_reason = body.remarks

    await _log_audit(db, po_id, f"Status → {body.status.upper()}", body.remarks or "",
                     old_status=old, new_status=body.status, user_id=user.user_id)
    await write_audit(db=db, module="purchases", action="approve_po",
                      record_id=po_id, record_no=h.po_no,
                      description=f"PO {h.po_no} status changed to {body.status}",
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    email = None
    if body.status == "approved":
        from app.routers.purchase_controls import on_po_approved
        email = await on_po_approved(db, po_id, user.user_id)
    return {"success": True, "new_status": body.status, "email": email}


# ── DISTRIBUTION ─────────────────────────────────────────────────────────────
@router.post("/po/{po_id}/distribution")
async def save_distribution(
    po_id: int, body: distribution_save_in,
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    # Load items to validate
    items_q = await db.execute(
        select(po_item.id, po_item.order_qty).where(po_item.po_id == po_id)
    )
    items_map = {r[0]: float(r[1]) for r in items_q.fetchall()}

    # Validate: total allocation per item ≤ order_qty
    totals: dict[int, float] = {}
    for outlet in body.outlets:
        for it in outlet.items:
            totals[it.po_item_id] = totals.get(it.po_item_id, 0) + float(it.allocated_qty)
    for iid, total in totals.items():
        if iid in items_map and total > items_map[iid] + 0.001:
            raise HTTPException(422, f"Over-allocation on item {iid}: {total} > {items_map[iid]}")

    # Clear existing
    old_hdrs = (await db.execute(select(po_distribution_hdr).where(po_distribution_hdr.po_id == po_id))).scalars().all()
    for dh in old_hdrs:
        await db.execute(text("DELETE FROM po_distribution_dtl WHERE distribution_id=:did"), {"did": dh.id})
    await db.execute(text("DELETE FROM po_distribution_hdr WHERE po_id=:pid"), {"pid": po_id})
    await db.flush()

    for outlet in body.outlets:
        if not any(float(it.allocated_qty) > 0 for it in outlet.items):
            continue
        dh = po_distribution_hdr(po_id=po_id, outlet_id=outlet.outlet_id, remarks=outlet.remarks)
        db.add(dh)
        await db.flush()
        for it in outlet.items:
            if float(it.allocated_qty) <= 0:
                continue
            db.add(po_distribution_dtl(
                distribution_id=dh.id, po_item_id=it.po_item_id,
                product_id=it.product_id, allocated_qty=it.allocated_qty,
                received_qty=Decimal("0"), pending_qty=it.allocated_qty,
            ))

    await _log_audit(db, po_id, "Distribution Saved", "Multi-outlet allocation saved.", user_id=user.user_id)
    await db.commit()
    return {"success": True}


# ═══════════════════════════════════════════════════════════════════════════════
# PURCHASE (GRN) CRUD & DESKTOP PURCHASE ENTRY
# ═══════════════════════════════════════════════════════════════════════════════

async def _get_item_purchase_history(
    db: AsyncSession,
    product_id: int,
    current_purchase_id: int | None = None,
    current_invoice_date: date | None = None,
    outlet_id: int | None = None,
) -> dict:
    """
    Finds the last purchase (GRN) prior to the current purchase/date and
    calculates quantity sold since that last purchase date up to the current date.
    """
    q_prev = (
        select(purchase.id, purchase.invoice_date, purchase_item.qty, purchase_item.free_qty)
        .join(purchase, purchase_item.purchase_id == purchase.id)
        .where(purchase_item.product_id == product_id)
    )
    if current_purchase_id:
        q_prev = q_prev.where(purchase.id != current_purchase_id)
    if current_invoice_date:
        q_prev = q_prev.where(
            or_(
                purchase.invoice_date < current_invoice_date,
                and_(
                    purchase.invoice_date == current_invoice_date,
                    purchase.id < (current_purchase_id or 999999999)
                )
            )
        )

    prev_row = None
    if outlet_id:
        q_outlet = q_prev.where(purchase.outlet_id == outlet_id).order_by(purchase.invoice_date.desc(), purchase.id.desc()).limit(1)
        prev_row = (await db.execute(q_outlet)).fetchone()

    if not prev_row:
        q_any = q_prev.order_by(purchase.invoice_date.desc(), purchase.id.desc()).limit(1)
        prev_row = (await db.execute(q_any)).fetchone()

    # Fallback if no strictly prior purchase was found
    if not prev_row and current_purchase_id:
        q_fallback = (
            select(purchase.id, purchase.invoice_date, purchase_item.qty, purchase_item.free_qty)
            .join(purchase, purchase_item.purchase_id == purchase.id)
            .where(purchase_item.product_id == product_id, purchase.id != current_purchase_id)
            .order_by(purchase.invoice_date.desc(), purchase.id.desc())
            .limit(1)
        )
        prev_row = (await db.execute(q_fallback)).fetchone()

    if prev_row:
        lp_date = prev_row[1]
        lp_qty = float((prev_row[2] or 0) + (prev_row[3] or 0))
        lp_date_str = lp_date.strftime("%d-%b-%y") if lp_date else "-"

        from app.models.invoice import invoice_item, invoice as invoice_model
        q_sales = (
            select(func.coalesce(func.sum(invoice_item.qty), 0))
            .join(invoice_model, invoice_item.invoice_id == invoice_model.id)
            .where(
                invoice_item.product_id == product_id,
                invoice_model.invoice_date >= lp_date
            )
        )
        if current_invoice_date:
            q_sales = q_sales.where(invoice_model.invoice_date <= current_invoice_date)

        if outlet_id:
            sales_val = (await db.execute(q_sales.where(invoice_model.outlet_id == outlet_id))).scalar()
            if not sales_val or sales_val == 0:
                sales_val = (await db.execute(q_sales)).scalar()
        else:
            sales_val = (await db.execute(q_sales)).scalar()

        sales_since_lp = float(sales_val or 0)
    else:
        lp_date_str = "-"
        lp_qty = 0
        sales_since_lp = 0

    return {
        "lp_date": lp_date_str,
        "lp_qty": lp_qty,
        "sales_since_lp": sales_since_lp,
    }


@router.get("/get_product_history_ajax")
@router.get("/product-history")
async def get_product_history(
    product_id: int = Query(...),
    outlet_id: Optional[int] = Query(None),
    exclude_purchase_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    hist = await _get_item_purchase_history(
        db,
        product_id=product_id,
        current_purchase_id=exclude_purchase_id,
        current_invoice_date=date.today(),
        outlet_id=outlet_id,
    )
    return {
        "last_purchase_date": hist["lp_date"],
        "last_purchase_qty": hist["lp_qty"],
        "sales_since_lp": hist["sales_since_lp"],
    }


@router.get("/grn")
async def list_purchases(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    supplier_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=60),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    q = select(purchase).where(*access.outlet_where(purchase.outlet_id)).order_by(purchase.id.desc())
    if supplier_id:
        q = q.where(purchase.supplier_id == supplier_id)
    if status:
        q = q.where(purchase.status == status)
    if from_date:
        q = q.where(purchase.invoice_date >= from_date)
    if to_date:
        q = q.where(purchase.invoice_date <= to_date)
    s = (search or "").strip()
    if s:
        # digits only (e.g. 1258): GRN / invoice number ending with those digits; otherwise GRN, invoice, supplier, PO or item
        if s.isdigit() and len(s) <= 6:
            q = q.where(or_(func.regexp_replace(purchase.purchase_no, r"\D", "", "g").like(f"%{s}"),
                            func.regexp_replace(func.coalesce(purchase.invoice_no, ""), r"\D", "", "g").like(f"%{s}"),
                            purchase.purchase_no == s))
        else:
            like = f"%{s}%"
            q = q.where(or_(purchase.purchase_no.ilike(like), purchase.invoice_no.ilike(like),
                            purchase.supplier_id.in_(text("SELECT id FROM suppliers WHERE name ILIKE :like OR supplier_code ILIKE :like "
                                                          "OR trade_name ILIKE :like").bindparams(like=like)),
                            purchase.po_id.in_(text("SELECT id FROM po_headers WHERE po_no ILIKE :like2").bindparams(like2=like)),
                            purchase.id.in_(text("""SELECT pi.purchase_id FROM unit_wise_purchase_items pi JOIN products p ON p.id = pi.product_id
                                WHERE p.name ILIKE :like3 OR p.item_code ILIKE :like3 OR pi.batch_no ILIKE :like3""").bindparams(like3=like))))

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows  = (await db.execute(q.offset((page - 1) * per_page).limit(per_page))).scalars().all()

    result = []
    for r in rows:
        sn = await _supplier_name(db, r.supplier_id)
        result.append({
            "id": r.id, "purchase_no": r.purchase_no,
            "supplier_id": r.supplier_id, "supplier_name": sn,
            "invoice_no": r.invoice_no, "invoice_date": str(r.invoice_date),
            "subtotal": float(r.subtotal or 0), "total_gst": float(r.total_gst or 0),
            "total_amount": float(r.total_amount or 0), "paid_amount": float(r.paid_amount or 0),
            "due_amount": float(r.due_amount or 0), "payment_mode": r.payment_mode or "credit",
            "status": r.status or "draft", "created_at": str(r.created_at) if r.created_at else "",
            "outlet_id": r.outlet_id, "po_id": r.po_id,
        })

    return {"data": result, "total": total, "page": page, "per_page": per_page}


def _normalize_invoice_no(inv: str | None) -> str:
    if not inv:
        return ""
    return re.sub(r'[\s\-_/\\.]', '', inv).lower()


@router.get("/check-invoice")
async def check_invoice_duplicate(
    supplier_id: int = Query(...),
    invoice_no: str = Query(...),
    exclude_purchase_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    inv_clean = invoice_no.strip()
    if not inv_clean:
        return {
            "is_duplicate": False,
            "is_blank": True,
            "message": "Vendor invoice number is mandatory. Blank invoice is not allowed."
        }

    dup_q = select(purchase.id, purchase.purchase_no, purchase.invoice_no, purchase.invoice_date).where(
        purchase.supplier_id == supplier_id
    )
    if exclude_purchase_id:
        dup_q = dup_q.where(purchase.id != exclude_purchase_id)

    rows = (await db.execute(dup_q)).all()
    norm_input = _normalize_invoice_no(inv_clean)

    for ex_id, ex_pur_no, ex_inv, ex_date in rows:
        if not ex_inv:
            continue
        if ex_inv.strip().lower() == inv_clean.lower() or (norm_input and _normalize_invoice_no(ex_inv) == norm_input):
            return {
                "is_duplicate": True,
                "is_blank": False,
                "existing_purchase_id": ex_id,
                "existing_purchase_no": ex_pur_no,
                "existing_invoice_no": ex_inv,
                "invoice_date": str(ex_date),
                "message": f'Duplicate Invoice Blocked: Invoice "{inv_clean}" already exists for this supplier in GRN #{ex_pur_no} (Recorded as: "{ex_inv}" on {ex_date}). You cannot enter the same invoice twice.'
            }

    return {"is_duplicate": False, "is_blank": False, "message": "Invoice number is available."}


@router.post("/grn")
@router.post("/create")
async def create_purchase(
    body: purchase_create,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    # 0. Data scope: the location and every line must be inside the user's outlets / categories / groups
    access.check_outlet(body.outlet_id)
    await access.check_products(db, [it.product_id for it in body.items])

    # 1. Validation: Block blank invoices and required fields
    if not body.supplier_id:
        raise HTTPException(400, "Supplier is required.")
    if not body.invoice_no or not body.invoice_no.strip():
        raise HTTPException(400, "Vendor invoice number is mandatory. Blank invoices are not allowed.")
    if not body.invoice_date:
        raise HTTPException(400, "Invoice date is required.")
    if not body.items:
        raise HTTPException(400, "Please add at least one item.")

    inv_clean = body.invoice_no.strip()

    # 2. Strict Duplicate Guard (Exact & Normalized check across supplier's invoices)
    dup_q = select(purchase.id, purchase.purchase_no, purchase.invoice_no, purchase.invoice_date).where(
        purchase.supplier_id == body.supplier_id
    )
    rows = (await db.execute(dup_q)).all()
    norm_input = _normalize_invoice_no(inv_clean)
    for ex_id, ex_pur_no, ex_inv, ex_date in rows:
        if not ex_inv:
            continue
        if ex_inv.strip().lower() == inv_clean.lower() or (norm_input and _normalize_invoice_no(ex_inv) == norm_input):
            raise HTTPException(
                status_code=400,
                detail=f'Duplicate Invoice Blocked: Invoice "{inv_clean}" already exists for this supplier in GRN #{ex_pur_no} (Recorded as: "{ex_inv}" on {ex_date}). You cannot enter the same invoice twice.'
            )

    purchase_no = await _next_purchase_no(db)

    try:
        subtotal        = Decimal("0")
        total_taxable   = Decimal("0")
        total_gst       = Decimal("0")
        total_qty       = Decimal("0")
        item_rows       = []

        # Pre-fetch product configurations for validation
        prod_ids = [it.product_id for it in body.items if it.product_id]
        prod_rows = (await db.execute(select(product_model).where(product_model.id.in_(prod_ids)))).scalars().all() if prod_ids else []
        prod_map = {p.id: p for p in prod_rows}

        # GRN against PO: lock the PO, check supplier/status, and never receive more than pending qty
        po_h, po_rows, po_recv = None, [], {}
        if body.po_id:
            po_h = (await db.execute(select(po_header).where(po_header.id == body.po_id).with_for_update())).scalar_one_or_none()
            if not po_h:
                raise HTTPException(404, "Purchase order not found.")
            if po_h.supplier_id != body.supplier_id:
                raise HTTPException(400, f"PO {po_h.po_no} belongs to a different supplier.")
            if po_h.status not in ("approved", "partial"):
                raise HTTPException(400, f"PO {po_h.po_no} is '{po_h.status}'. Only approved or partially received POs can be received.")
            po_rows = (await db.execute(select(po_item).where(po_item.po_id == po_h.id))).scalars().all()
            po_map = {pi.id: pi for pi in po_rows}
            for it in body.items:
                if it.po_item_id is None:
                    continue
                pi = po_map.get(it.po_item_id)
                if not pi or pi.product_id != it.product_id:
                    raise HTTPException(400, f"Item #{it.product_id} is not part of PO {po_h.po_no}.")
                po_recv[pi.id] = po_recv.get(pi.id, Decimal("0")) + Decimal(str(it.qty or 0))
            for pid, q in po_recv.items():
                pi = po_map[pid]
                pending = _po_ordered(pi) - Decimal(str(pi.received_qty or 0))
                if q > pending:
                    p_obj = prod_map.get(pi.product_id)
                    raise HTTPException(400, f"'{p_obj.name if p_obj else pi.product_id}': received qty {q} is more than PO pending qty {pending}.")
        elif any(it.po_item_id for it in body.items):
            raise HTTPException(400, "PO lines sent without a PO.")

        for it in body.items:
            qty_dec = Decimal(str(it.qty or 0))
            free_dec = Decimal(str(it.free_qty or 0))
            if qty_dec <= 0 and free_dec <= 0:
                continue

            price_dec = Decimal(str(it.price or 0))
            disc_val_dec = Decimal(str(it.disc_val or 0))
            gst_pct_dec = Decimal(str(it.gst_percent or 0))

            p_obj = prod_map.get(it.product_id)
            code_label = it.item_code or (p_obj.name if p_obj else f"#{it.product_id}")

            # Batch & Expiry Validations
            batch_str = it.batch_no.strip() if it.batch_no else None
            mfg_val = it.mfg_date
            exp_val = it.expiry_date

            if p_obj:
                # 1. Batch Tracking Required Check
                if (p_obj.has_batch_tracking or p_obj.is_batch_required) and not batch_str:
                    raise HTTPException(400, f"Batch number is mandatory for '{code_label}'.")

                # 2. Manufacturing Date Required Check
                if p_obj.mfg_date_required and not mfg_val:
                    raise HTTPException(400, f"Manufacturing date is required for '{code_label}'.")

                # 3. Expiry Date Required Check / Auto-calc
                if (p_obj.has_expiry_tracking or p_obj.exp_date_required) and not exp_val:
                    if mfg_val and p_obj.shelf_life_days and p_obj.shelf_life_days > 0:
                        exp_val = batch_service.calculate_expiry_date(mfg_val, p_obj.shelf_life_days)
                    if not exp_val:
                        raise HTTPException(400, f"Expiry date is mandatory for '{code_label}'.")

                # 4. Mfg vs Expiry Sequence Check
                if mfg_val and exp_val and exp_val <= mfg_val:
                    raise HTTPException(400, f"Expiry date ({exp_val}) must be after manufacturing date ({mfg_val}) for '{code_label}'.")

                # 5. Already Expired Check
                if exp_val and exp_val < date.today():
                    raise HTTPException(400, f"Cannot receive already expired stock for '{code_label}' (Expired on {exp_val}).")

                # 6. Minimum Remaining Shelf Life at Purchase Check
                if exp_val and p_obj.min_shelf_life_purchase_days and p_obj.min_shelf_life_purchase_days > 0:
                    remaining_days = (exp_val - date.today()).days
                    if remaining_days < p_obj.min_shelf_life_purchase_days:
                        raise HTTPException(
                            400,
                            f"Remaining shelf life ({remaining_days} days) for '{code_label}' is less than required minimum ({p_obj.min_shelf_life_purchase_days} days)."
                        )

            # Per unit discount
            if it.disc_type == "%":
                capped_pct = min(disc_val_dec, Decimal("100"))
                unit_disc = price_dec * capped_pct / Decimal("100")
            else:
                unit_disc = min(disc_val_dec, price_dec)

            cp_base = price_dec - unit_disc
            unit_gst = cp_base * (gst_pct_dec / Decimal("100"))
            
            basic_total = qty_dec * price_dec
            cost_value = qty_dec * cp_base  # taxable
            tax_total = round(qty_dec * unit_gst, 2)
            line_total = cost_value + tax_total

            subtotal += basic_total
            total_taxable += cost_value
            total_gst += tax_total
            total_qty += (qty_dec + free_dec)

            # Register or update in Central Batch Register if batch_no present
            created_batch_id = None
            if batch_str:
                batch_rec = await batch_service.get_or_create_batch(
                    db=db,
                    product_id=it.product_id,
                    batch_no=batch_str,
                    supplier_id=body.supplier_id,
                    supplier_batch_no=getattr(it, "supplier_batch_no", None) or batch_str,
                    mfg_date=mfg_val,
                    exp_date=exp_val,
                    purchase_rate=price_dec,
                    cost_price=cp_base,
                    mrp=Decimal(str(it.mrp or 0)),
                    selling_price=Decimal(str(it.selling_price or 0)),
                    user_id=user.user_id,
                )
                created_batch_id = batch_rec.id

            item_rows.append({
                "product_id": it.product_id,
                "item_code": it.item_code,
                "qty": qty_dec,
                "free_qty": free_dec,
                "pcs": Decimal(str(it.pcs or 0)),
                "unit": it.unit or "PCS",
                "price": price_dec,
                "disc_val": disc_val_dec,
                "disc_type": it.disc_type or "₹",
                "basic_amt": basic_total,
                "basic_amount": basic_total,
                "taxable_amt": cost_value,
                "taxable_amount": cost_value,
                "gst_percent": gst_pct_dec,
                "gst_amount": tax_total,
                "total": line_total,
                "hsn_code": it.hsn_code,
                "mrp": Decimal(str(it.mrp)) if it.mrp is not None else None,
                "selling_price": Decimal(str(it.selling_price)) if it.selling_price is not None else None,
                "batch_no": batch_str,
                "batch_id": created_batch_id,
                "mfg_date": mfg_val,
                "expiry_date": exp_val,
                "po_item_id": it.po_item_id if po_h else None,
            })

        if not item_rows:
            raise HTTPException(400, "Please add at least one valid item with qty > 0.")

        # Bill-level totals
        bill_disc = Decimal(str(body.discount or 0))
        net = (total_taxable + total_gst) - bill_disc

        # Round Off
        round_off_in = Decimal(str(body.round_off or 0))
        if round_off_in == Decimal("0"):
            # Auto round off
            grand_total = Decimal(str(round(float(net))))
            round_off = grand_total - net
        else:
            round_off = round_off_in
            grand_total = net + round_off

        paid_amt = Decimal(str(body.paid_amount or 0))
        due_amt = grand_total - paid_amt

        is_draft = body.action == "draft"
        if is_draft:
            status_str = "draft"
        elif due_amt <= 0:
            status_str = "paid"
        else:
            status_str = "partial"

        pm = (body.payment_mode or "credit").strip().lower()
        if pm in ("bank transfer", "bank_transfer", "netbanking"):
            pm = "neft"
        if pm not in ("cash", "cheque", "neft", "upi", "credit"):
            pm = "credit"

        h = purchase(
            purchase_no=purchase_no,
            outlet_id=body.outlet_id,
            supplier_id=body.supplier_id,
            invoice_no=body.invoice_no,
            invoice_date=body.invoice_date,
            total_qty=total_qty,
            subtotal=subtotal,
            discount=bill_disc,
            taxable_amount=total_taxable,
            total_gst=total_gst,
            round_off=round_off,
            total_amount=grand_total,
            paid_amount=paid_amt,
            due_amount=due_amt,
            payment_mode=pm,
            notes=body.notes,
            status=status_str,
            po_id=po_h.id if po_h else None,
            created_by=user.user_id,
        )
        db.add(h)
        await db.flush()

        for it in item_rows:
            db.add(purchase_item(
                purchase_id=h.id,
                product_id=it["product_id"],
                item_code=it["item_code"],
                qty=it["qty"],
                free_qty=it["free_qty"],
                pcs=it["pcs"],
                unit=it["unit"],
                price=it["price"],
                disc_val=it["disc_val"],
                disc_type=it["disc_type"],
                basic_amt=it["basic_amt"],
                taxable_amt=it["taxable_amt"],
                gst_percent=it["gst_percent"],
                gst_amount=it["gst_amount"],
                total=it["total"],
                hsn_code=it["hsn_code"],
                batch_no=it.get("batch_no"),
                batch_id=it.get("batch_id"),
                mfg_date=it.get("mfg_date"),
                expiry_date=it.get("expiry_date"),
                po_item_id=it.get("po_item_id"),
            ))

        # Update PO received qty + status (drafts do not move stock, so they do not count as received)
        if po_h and not is_draft:
            for pi in po_rows:
                if pi.id in po_recv:
                    pi.received_qty = Decimal(str(pi.received_qty or 0)) + po_recv[pi.id]
            old_status = po_h.status
            po_h.status = "completed" if all(Decimal(str(pi.received_qty or 0)) >= _po_ordered(pi) for pi in po_rows) else "partial"
            po_h.updated_at = datetime.now()
            await _log_audit(db, po_h.id, f"GRN {purchase_no}", f"Received against invoice {inv_clean}",
                             old_status=old_status, new_status=po_h.status, user_id=user.user_id)

        # Update product stock, landed cost, and location stock if not draft
        if not is_draft:
            for it in item_rows:
                in_qty = it["qty"] + it["free_qty"]
                line_tot = it["total"]
                new_cp = (line_tot / in_qty) if in_qty > 0 else it["price"]
                basic_cost = (it["price"] * it["qty"] / in_qty) if in_qty > 0 and it["free_qty"] > 0 else it["price"]

                # Update master product
                prod_updates = {
                    "stock_qty": float(in_qty),
                    "cost_price": float(new_cp),
                    "basic_cost": float(basic_cost),
                    "pid": it["product_id"]
                }
                update_sql = "UPDATE products SET stock_qty = stock_qty + :stock_qty, cost_price = :cost_price, basic_cost = :basic_cost"
                if it.get("mrp") is not None and it["mrp"] > 0:
                    update_sql += ", mrp = :mrp"
                    prod_updates["mrp"] = float(it["mrp"])
                if it.get("selling_price") is not None and it["selling_price"] > 0:
                    update_sql += ", selling_price = :sp"
                    prod_updates["sp"] = float(it["selling_price"])
                update_sql += " WHERE id = :pid"
                await db.execute(text(update_sql), prod_updates)

                loc_id = body.outlet_id or 1

                # Update location stock if outlet specified
                if body.outlet_id:
                    await db.execute(
                        text("""
                            INSERT INTO outlet_stock (outlet_id, product_id, stock_qty, updated_at)
                            VALUES (:oid, :pid, :qty, NOW())
                            ON CONFLICT (outlet_id, product_id)
                            DO UPDATE SET stock_qty = outlet_stock.stock_qty + EXCLUDED.stock_qty, updated_at = NOW()
                        """),
                        {"oid": body.outlet_id, "pid": it["product_id"], "qty": float(in_qty)}
                    )

                # Update Location-wise Batch Stock Balances
                if it.get("batch_id"):
                    await batch_service.record_batch_movement(
                        db=db,
                        batch_id=it["batch_id"],
                        location_id=loc_id,
                        qty_delta=in_qty,
                        movement_type="purchase",
                        product_id=it["product_id"],
                        allow_negative=False,
                    )

                # Ledger record
                await _write_stock_ledger(
                    db, it["product_id"], "purchase", in_qty, h.id, "grn", body.outlet_id,
                    f"Purchase Inward {purchase_no}" + (f" (Batch: {it['batch_no']})" if it.get("batch_no") else ""),
                    user.user_id,
                    batch_no=it.get("batch_no"),
                    batch_id=it.get("batch_id"),
                    expiry_date=it.get("expiry_date"),
                )

        await write_audit(
            db=db, module="purchases", action="create_purchase",
            record_id=h.id, record_no=h.purchase_no,
            description=f"Purchase {h.purchase_no} ({status_str}) created for invoice {h.invoice_no}",
            user_id=user.user_id, user_name=user.username
        )
        await db.commit()
        return {"success": True, "purchase_id": h.id, "purchase_no": h.purchase_no, "status": status_str}
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"Database error while saving purchase: {str(e)}")


@router.get("/grn/{purchase_id}")
async def get_purchase(purchase_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(
        select(purchase).options(selectinload(purchase.items)).where(purchase.id == purchase_id)
    )
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(404, "Purchase not found")
    access.check_outlet(h.outlet_id)

    sn = await _supplier_name(db, h.supplier_id)
    sd = await _supplier_details(db, h.supplier_id)
    od = await _outlet_details(db, h.outlet_id)

    items_out = []
    for it in h.items:
        p = await _product_info(db, it.product_id)
        hist = await _get_item_purchase_history(
            db,
            product_id=it.product_id,
            current_purchase_id=h.id,
            current_invoice_date=h.invoice_date,
            outlet_id=h.outlet_id,
        )
        items_out.append({
            "id": it.id,
            "product_id": it.product_id,
            "product_name": p.get("name"),
            "product_code": p.get("item_code") or it.item_code,
            "barcode": p.get("barcode") or "",
            "qty": float(it.qty or 0),
            "free_qty": float(it.free_qty or 0),
            "pcs": float(it.pcs or 0),
            "unit": it.unit or "PCS",
            "price": float(it.price or 0),
            "disc_val": float(it.disc_val or 0),
            "disc_type": it.disc_type or "₹",
            "basic_amt": float(it.basic_amt or it.basic_amount or 0),
            "taxable_amt": float(it.taxable_amt or it.taxable_amount or 0),
            "gst_percent": float(it.gst_percent or 0),
            "gst_amount": float(it.gst_amount or 0),
            "total": float(it.total or 0),
            "hsn_code": it.hsn_code or p.get("hsn_code"),
            "mrp": float(p.get("mrp") or 0),
            "cost_price": float(p.get("cost_price") or 0),
            "batch_no": it.batch_no,
            "batch_id": it.batch_id,
            "mfg_date": str(it.mfg_date) if it.mfg_date else None,
            "expiry_date": str(it.expiry_date) if it.expiry_date else None,
            "lp_date": hist["lp_date"],
            "lp_qty": hist["lp_qty"],
            "sales_since_lp": hist["sales_since_lp"],
            "sales_lp": hist["sales_since_lp"],
        })

    return {
        "id": h.id,
        "purchase_no": h.purchase_no,
        "outlet_id": h.outlet_id,
        "outlet_name": od.get("name"),
        "outlet_details": od,
        "supplier_id": h.supplier_id,
        "supplier_name": sn,
        "supplier_details": sd,
        "invoice_no": h.invoice_no,
        "invoice_date": str(h.invoice_date) if h.invoice_date else None,
        "total_qty": float(h.total_qty or 0),
        "subtotal": float(h.subtotal or 0),
        "discount": float(h.discount or 0),
        "taxable_amount": float(h.taxable_amount or 0),
        "total_gst": float(h.total_gst or 0),
        "round_off": float(h.round_off or 0),
        "total_amount": float(h.total_amount or 0),
        "paid_amount": float(h.paid_amount or 0),
        "due_amount": float(h.due_amount or 0),
        "payment_mode": h.payment_mode or "credit",
        "notes": h.notes,
        "status": h.status or "draft",
        "created_at": str(h.created_at) if h.created_at else None,
        "items": items_out,
    }

