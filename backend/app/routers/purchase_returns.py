from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core import access
from app.core.dependencies import current_user_dep, get_current_user, require_role
from app.models.outlet import outlet
from app.models.party import supplier
from app.models.product import product
from app.models.purchase import purchase
from app.models.sync import unit_wise_purchase_return as pr, unit_wise_purchase_return_item as pr_item
from app.services import purchase_returns_service as svc
from app.utils.search import word_match

router = APIRouter(prefix="/purchase-returns", tags=["purchase-returns"], dependencies=[Depends(get_current_user)])


class pr_item_in(BaseModel):
    product_id: int
    qty: Decimal = Field(gt=0)
    rate: Optional[Decimal] = Field(default=None, gt=0)  # direct mode only; GRN mode uses GRN rate
    batch_no: Optional[str] = None
    batch_id: Optional[int] = None
    expiry_date: Optional[date] = None


class pr_create(BaseModel):
    purchase_no: Optional[str] = None   # against a GRN
    supplier_id: Optional[int] = None   # direct return
    items: list[pr_item_in]
    reason: str = Field(min_length=3, max_length=255)
    return_date: Optional[date] = None
    notes: Optional[str] = None


def _http(e: Exception):
    code = 404 if isinstance(e, LookupError) else 409 if isinstance(e, OverflowError) else 400
    return HTTPException(code, str(e))


@router.get("/grn-lookup")
async def grn_lookup(purchase_no: str = Query(..., min_length=1), db: AsyncSession = Depends(get_db)):
    try:
        r = await svc.lookup_grn(db, purchase_no.strip())
    except (LookupError, ValueError) as e:
        raise _http(e)
    g, s = r["grn"], r["supplier"]
    return {"purchase_no": g.purchase_no, "invoice_no": g.invoice_no, "invoice_date": g.invoice_date,
            "total_amount": g.total_amount, "due_amount": g.due_amount, "is_interstate": r["is_interstate"],
            "supplier": {"id": s.id, "name": s.name, "state": s.state, "gst_number": s.gst_number} if s else None,
            "lines": r["lines"]}


@router.get("/products")
async def product_search(q: str = Query(..., min_length=2), db: AsyncSession = Depends(get_db)):
    """Direct-return item picker: word search + default purchase rate."""
    rows = (await db.execute(
        select(product).where(product.is_active == True, word_match(q, product.name, product.item_code, product.barcode))
        .order_by(product.name).limit(20)
    )).scalars().all()
    return [{"id": p.id, "name": p.name, "item_code": p.item_code, "hsn_code": p.hsn_code, "unit": p.unit,
             "gst_percent": p.gst_percent, "rate": p.purchase_price or p.cost_price or 0, "ho_stock": p.stock_qty} for p in rows]


@router.get("/supplier-state/{supplier_id}")
async def supplier_state(supplier_id: int, db: AsyncSession = Depends(get_db)):
    s = await db.get(supplier, supplier_id)
    if not s:
        raise HTTPException(404, "Supplier not found")
    return {"is_interstate": svc.is_interstate(await svc._company_state(db), s.state), "state": s.state}


@router.post("", dependencies=[Depends(require_role("admin", "manager"))])
async def create(body: pr_create, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    if not body.purchase_no and not body.supplier_id:
        raise HTTPException(400, "Choose a GRN or a supplier")
    try:
        dn = await svc.create_return(db, body, user.user_id)
    except (LookupError, OverflowError, ValueError) as e:
        raise _http(e)
    return {"id": dn.id, "prn_no": dn.prn_no, "total_amount": dn.total_amount}


@router.get("")
async def list_returns(
    search: str = "", from_date: Optional[date] = None, to_date: Optional[date] = None,
    supplier_id: Optional[int] = None, source: Optional[str] = None,
    page: int = Query(1, ge=1), per_page: int = Query(50, ge=1, le=200), db: AsyncSession = Depends(get_db),
):
    conds = [word_match(search, pr.prn_no, pr.ref_purchase_no, pr.reason)]
    if from_date: conds.append(pr.return_date >= from_date)
    if to_date: conds.append(pr.return_date <= to_date)
    if supplier_id: conds.append(pr.supplier_id == supplier_id)
    conds += access.outlet_where(pr.outlet_id)
    if source == "HO": conds.append(pr.prn_no.like(f"{svc.DN_PREFIX}%"))
    if source == "OUTLET": conds.append(~pr.prn_no.like(f"{svc.DN_PREFIX}%"))
    total = (await db.execute(select(func.count(pr.id)).where(*conds))).scalar_one()
    rows = (await db.execute(
        select(pr, supplier.name, outlet.outlet_name)
        .outerjoin(supplier, supplier.id == pr.supplier_id).outerjoin(outlet, outlet.id == pr.outlet_id)
        .where(*conds).order_by(pr.return_date.desc(), pr.id.desc()).offset((page - 1) * per_page).limit(per_page)
    )).all()
    return {"total": total, "items": [{
        "id": r.id, "prn_no": r.prn_no, "return_date": r.return_date, "supplier_name": sname, "outlet_name": oname,
        "ref_purchase_no": r.ref_purchase_no, "reason": r.reason, "total_qty": r.total_qty,
        "taxable_amount": r.taxable_amount, "total_gst": r.total_gst, "total_amount": r.total_amount,
        "adjusted_amount": r.adjusted_amount, "status": r.status,
        "source": "HO" if r.prn_no.startswith(svc.DN_PREFIX) else "OUTLET",
    } for r, sname, oname in rows]}


@router.get("/{return_id}")
async def get_return(return_id: int, db: AsyncSession = Depends(get_db)):
    dn = await db.get(pr, return_id)
    if not dn:
        raise HTTPException(404, "Debit note not found")
    items = (await db.execute(select(pr_item).where(pr_item.prn_id == dn.id).order_by(pr_item.id))).scalars().all()
    prods = {p.id: p for p in (await db.execute(select(product).where(product.id.in_([i.product_id for i in items if i.product_id])))).scalars()}
    s = await db.get(supplier, dn.supplier_id) if dn.supplier_id else None
    g = await db.get(purchase, dn.purchase_id) if dn.purchase_id else None
    return {
        "id": dn.id, "prn_no": dn.prn_no, "return_date": dn.return_date, "status": dn.status, "reason": dn.reason,
        "notes": dn.notes, "is_interstate": dn.is_interstate, "ref_purchase_no": dn.ref_purchase_no,
        "grn_invoice_no": g.invoice_no if g else None, "grn_invoice_date": g.invoice_date if g else None,
        "taxable_amount": dn.taxable_amount, "cgst_amount": dn.cgst_amount, "sgst_amount": dn.sgst_amount,
        "igst_amount": dn.igst_amount, "total_gst": dn.total_gst, "total_amount": dn.total_amount,
        "adjusted_amount": dn.adjusted_amount, "source": "HO" if dn.prn_no.startswith(svc.DN_PREFIX) else "OUTLET",
        "supplier": {"name": s.name, "address": s.address, "state": s.state, "gst_number": s.gst_number,
                     "phone": s.phone} if s else None,
        "items": [{
            "name": i.name or (prods[i.product_id].name if i.product_id in prods else ""),
            "item_code": i.item_code, "hsn_code": i.hsn_code, "qty": i.qty, "unit": i.unit, "price": i.price,
            "taxable_amt": i.taxable_amt or i.basic_amount, "gst_percent": i.gst_percent,
            "cgst_percent": i.cgst_percent, "sgst_percent": i.sgst_percent, "igst_percent": i.igst_percent,
            "cgst_amount": i.cgst_amount, "sgst_amount": i.sgst_amount, "igst_amount": i.igst_amount, "total": i.total,
            "mrp": prods[i.product_id].mrp if i.product_id in prods else None,
            "selling_price": prods[i.product_id].selling_price if i.product_id in prods else None,
        } for i in items],
    }


class cancel_in(BaseModel):
    reason: str = Field(min_length=5)


@router.post("/{return_id}/cancel", dependencies=[Depends(require_role("admin", "manager"))])
async def cancel(return_id: int, body: cancel_in, db: AsyncSession = Depends(get_db),
                 user: current_user_dep = Depends(get_current_user)):
    try:
        dn = await svc.cancel_return(db, return_id, body.reason, user.user_id)
    except LookupError as e:
        raise _http(e)
    return {"id": dn.id, "status": dn.status}
