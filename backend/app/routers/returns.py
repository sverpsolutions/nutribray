from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from app.core import access
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import current_user_dep, get_current_user, require_role
from app.models.invoice import invoice, invoice_item
from app.models.outlet import outlet
from app.models.party import customer
from app.services import returns_service
from app.utils.search import word_match

router = APIRouter(prefix="/billing/returns", tags=["sales-returns"], dependencies=[Depends(get_current_user)])


class return_item_in(BaseModel):
    product_id: int
    qty: Decimal = Field(gt=0)


class return_create(BaseModel):
    invoice_no: str
    items: list[return_item_in]
    reason: str = Field(min_length=3, max_length=255)
    refund_method: str = "cash"  # cash | adjust
    return_date: Optional[date] = None
    notes: Optional[str] = None



@router.get("/lookup")
async def lookup_bill(invoice_no: str = Query(..., min_length=1), db: AsyncSession = Depends(get_db)):
    """Original bill + per-product returnable quantities."""
    try:
        res = await returns_service.lookup(db, invoice_no.strip())
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    inv = res["invoice"]
    access.check_outlet(inv.outlet_id)
    out_name = (await db.execute(select(outlet.outlet_name).where(outlet.id == inv.outlet_id))).scalar()
    return {
        "invoice_no": inv.invoice_no, "invoice_date": inv.invoice_date, "outlet_name": out_name,
        "total_amount": inv.total_amount, "due_amount": inv.due_amount, "is_interstate": inv.is_interstate,
        "lines": res["lines"],
    }


@router.post("", dependencies=[Depends(require_role("admin", "manager"))])
async def create_return(body: return_create, db: AsyncSession = Depends(get_db),
                        user: current_user_dep = Depends(get_current_user)):
    try:
        cn = await returns_service.create_return(db, body, user.user_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except OverflowError as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": cn.id, "invoice_no": cn.invoice_no, "total_amount": cn.total_amount}


@router.get("")
async def list_returns(
    search: str = "", from_date: Optional[date] = None, to_date: Optional[date] = None,
    outlet_id: Optional[int] = None, source: Optional[str] = None,
    page: int = Query(1, ge=1), per_page: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Credit notes: HO (CN-HO-*) and outlet POS returns (synced)."""
    conds = [invoice.invoice_type == "return", word_match(search, invoice.invoice_no, invoice.ref_invoice_no, invoice.return_reason)]
    if from_date: conds.append(invoice.invoice_date >= from_date)
    if to_date: conds.append(invoice.invoice_date <= to_date)
    if outlet_id: conds.append(invoice.outlet_id == outlet_id)
    conds += access.outlet_where(invoice.outlet_id)
    if source == "HO": conds.append(invoice.invoice_no.like(f"{returns_service.CN_PREFIX}%"))
    if source == "OUTLET": conds.append(~invoice.invoice_no.like(f"{returns_service.CN_PREFIX}%"))

    total = (await db.execute(select(func.count(invoice.id)).where(*conds))).scalar_one()
    rows = (await db.execute(
        select(invoice, outlet.outlet_name).outerjoin(outlet, outlet.id == invoice.outlet_id)
        .where(*conds).order_by(invoice.invoice_date.desc(), invoice.id.desc())
        .offset((page - 1) * per_page).limit(per_page)
    )).all()
    return {
        "total": total, "page": page, "per_page": per_page,
        "items": [{
            "id": r.id, "invoice_no": r.invoice_no, "invoice_date": r.invoice_date, "outlet_name": name,
            "ref_invoice_no": r.ref_invoice_no, "return_reason": r.return_reason, "refund_method": r.refund_method,
            "taxable_amount": r.taxable_amount, "total_gst": r.total_gst, "total_amount": r.total_amount,
            "status": r.status, "source": "HO" if r.invoice_no.startswith(returns_service.CN_PREFIX) else "OUTLET",
        } for r, name in rows],
    }


@router.get("/{return_id}")
async def get_return(return_id: int, db: AsyncSession = Depends(get_db)):
    """Credit note with items, customer and original bill (for print)."""
    cn = (await db.execute(select(invoice).where(invoice.id == return_id, invoice.invoice_type == "return"))).scalar_one_or_none()
    if not cn:
        raise HTTPException(404, "Credit note not found")
    access.check_outlet(cn.outlet_id)
    items = (await db.execute(select(invoice_item).where(invoice_item.invoice_id == cn.id).order_by(invoice_item.id))).scalars().all()
    cust = await db.get(customer, cn.customer_id)
    orig = (await db.execute(select(invoice.invoice_date).where(invoice.invoice_no == cn.ref_invoice_no))).scalar() if cn.ref_invoice_no else None
    out_name = (await db.execute(select(outlet.outlet_name).where(outlet.id == cn.outlet_id))).scalar()
    return {
        "id": cn.id, "invoice_no": cn.invoice_no, "invoice_date": cn.invoice_date, "status": cn.status,
        "outlet_name": out_name, "ref_invoice_no": cn.ref_invoice_no, "ref_invoice_date": orig,
        "return_reason": cn.return_reason, "refund_method": cn.refund_method, "adjusted_amount": cn.adjusted_amount,
        "is_interstate": cn.is_interstate, "notes": cn.notes,
        "subtotal": cn.subtotal, "discount": cn.discount, "taxable_amount": cn.taxable_amount,
        "cgst_amount": cn.cgst_amount, "sgst_amount": cn.sgst_amount, "igst_amount": cn.igst_amount,
        "total_gst": cn.total_gst, "total_amount": cn.total_amount,
        "source": "HO" if cn.invoice_no.startswith(returns_service.CN_PREFIX) else "OUTLET",
        "customer": {"name": cust.name, "address": cust.address, "city": cust.city, "state": cust.state,
                     "phone": cust.phone, "gst_number": cust.gst_number} if cust else None,
        "items": [{
            "product_id": i.product_id, "item_code": i.item_code, "name": i.name, "hsn_code": i.hsn_code,
            "qty": i.qty, "unit": i.unit, "rate": i.rate, "taxable_amt": i.taxable_amt, "gst_percent": i.gst_percent,
            "cgst_percent": i.cgst_percent, "sgst_percent": i.sgst_percent, "igst_percent": i.igst_percent,
            "cgst_amount": i.cgst_amount, "sgst_amount": i.sgst_amount, "igst_amount": i.igst_amount, "total": i.total,
        } for i in items],
    }


class cancel_in(BaseModel):
    reason: str = Field(min_length=5)


@router.post("/{return_id}/cancel", dependencies=[Depends(require_role("admin", "manager"))])
async def cancel_return(return_id: int, body: cancel_in, db: AsyncSession = Depends(get_db),
                        user: current_user_dep = Depends(get_current_user)):
    try:
        cn = await returns_service.cancel_return(db, return_id, body.reason, user.user_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": cn.id, "status": cn.status}
