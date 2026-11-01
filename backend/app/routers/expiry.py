"""Batch expiry visibility (bands, store / HO), expired-stock removal requests, wrong-batch correction on a sale,
expiry master correction. Requests go through the approval engine; nothing here moves stock directly."""
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.services import approval_service as aps
from app.services import expiry_service as exs
from app.services.auth_service import write_audit

router = APIRouter(prefix="/expiry", tags=["expiry"])


async def _rows(db, sql, p=None):
    return [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()} for r in (await db.execute(text(sql), p or {})).mappings().all()]


def _outlets(p: dict, col: str, outlet_id: Optional[int]) -> str:
    sql = ""
    if outlet_id:
        access.check_outlet(outlet_id)
        sql += f" AND {col} = :oid"
        p["oid"] = outlet_id
    return sql + access.outlet_filter(col, p)


@router.get("/bands")
async def bands(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _rows(db, "SELECT days, label FROM expiry_bands ORDER BY days")


class band_in(BaseModel):
    days: int = Field(ge=0, le=3650)
    label: str = Field(min_length=2, max_length=40)


@router.put("/bands")
async def save_bands(rows: list[band_in], db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if not any(r.days == 0 for r in rows):
        raise HTTPException(400, "Keep the 'Already expired' band (0 days).")
    if len({r.days for r in rows}) != len(rows):
        raise HTTPException(400, "Each band needs a different number of days.")
    old = await _rows(db, "SELECT days, label FROM expiry_bands ORDER BY days")
    await db.execute(text("DELETE FROM expiry_bands"))
    for r in rows:
        await db.execute(text("INSERT INTO expiry_bands (days, label) VALUES (:d, :l)"), r.model_dump())
    await write_audit(db=db, module="expiry", action="bands", record_id=0, record_no="expiry_bands", old_data=str(old),
                      new_data=str([r.model_dump() for r in rows]), description="Expiry warning bands changed", user_id=user.user_id,
                      user_name=user.username)
    await db.commit()
    return {"success": True}



@router.get("/batches")
async def batches(outlet_id: Optional[int] = None, within_days: Optional[int] = None, expired_only: bool = False, category_id: Optional[int] = None,
                  search: str = "", include_zero: bool = False, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Batch-wise stock with expiry, GRN, status band — per store or consolidated across the caller's stores."""
    p = {"today": exs.today(), "q": f"%{search.strip()}%", "cat": category_id, "lim": exs.today() + timedelta(days=within_days or 0)}
    where = _outlets(p, "s.location_id", outlet_id) + access.product_filter("p", p)
    rows = await _rows(db, f"""SELECT s.location_id AS outlet_id, o.outlet_name AS store, p.id AS product_id, p.item_code, p.name AS item,
        c.name AS category, b.id AS batch_id, b.batch_no, b.mfg_date, b.exp_date, s.current_qty AS qty, b.cost_price,
        s.current_qty * COALESCE(NULLIF(b.cost_price, 0), p.cost_price, 0) AS stock_value, b.exp_date - :today AS days_left,
        CASE WHEN b.exp_date IS NULL THEN 'No expiry' WHEN b.exp_date <= :today THEN 'Already expired' ELSE
          COALESCE((SELECT eb.label FROM expiry_bands eb WHERE eb.days > 0 AND b.exp_date - :today <= eb.days ORDER BY eb.days LIMIT 1), 'OK') END AS status,
        g.purchase_no AS grn_no, g.grn_date,
        (SELECT COALESCE(SUM((a.payload->>'qty')::numeric), 0) FROM approval_requests a WHERE a.request_type = 'EXPIRED_REMOVAL'
           AND a.status = 'PENDING' AND a.payload->>'batch_outlet' = b.id || ':' || s.location_id) AS removal_pending
        FROM product_batch_stock s JOIN product_batches b ON b.id = s.batch_id JOIN products p ON p.id = s.product_id
        LEFT JOIN item_categories c ON c.id = p.category_id LEFT JOIN outlets o ON o.id = s.location_id
        LEFT JOIN LATERAL (SELECT u.purchase_no, u.invoice_date AS grn_date FROM unit_wise_purchase_items pi JOIN unit_wise_purchases u ON u.id = pi.purchase_id
            WHERE pi.batch_id = b.id ORDER BY u.id LIMIT 1) g ON TRUE
        WHERE (:inc OR s.current_qty > 0) AND b.exp_date IS NOT NULL
          AND (NOT :exp OR b.exp_date <= :today) AND (CAST(:wd AS INT) IS NULL OR b.exp_date <= :lim)
          AND (CAST(:cat AS INT) IS NULL OR p.category_id = :cat)
          AND (:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q OR b.batch_no ILIKE :q OR g.purchase_no ILIKE :q) {where}
        ORDER BY b.exp_date, o.outlet_name, p.name LIMIT 5000""", {**p, "inc": include_zero, "exp": expired_only, "wd": within_days})
    return rows


@router.get("/summary")
async def summary(outlet_id: Optional[int] = None, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Count / qty / value per expiry band and store (Head Office sees every store it is allowed to)."""
    rows = await batches(outlet_id, None, False, None, "", False, db, None)
    out: dict = {}
    for r in rows:
        k = (r["store"], r["status"])
        o = out.setdefault(k, {"store": r["store"], "status": r["status"], "batches": 0, "qty": 0.0, "value": 0.0})
        o["batches"] += 1
        o["qty"] += r["qty"] or 0
        o["value"] += r["stock_value"] or 0
    return list(out.values())


@router.get("/suggest")
async def suggest(product_id: int, outlet_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Earliest-expiring saleable batch first (expired batches are never suggested)."""
    access.check_outlet(outlet_id)
    return await _rows(db, """SELECT b.id AS batch_id, b.batch_no, b.exp_date, s.current_qty AS qty FROM product_batch_stock s
        JOIN product_batches b ON b.id = s.batch_id WHERE s.product_id = :p AND s.location_id = :o AND s.current_qty > 0
          AND (b.exp_date IS NULL OR b.exp_date > :t) AND COALESCE(b.status, 'Active') NOT IN ('Quarantined', 'Recalled', 'Blocked')
        ORDER BY b.exp_date NULLS LAST, b.id""", {"p": product_id, "o": outlet_id, "t": exs.today()})


# ── expired removal ───────────────────────────────────────────────────────────
class removal_line(BaseModel):
    batch_id: int
    qty: Decimal = Field(gt=0)


class removal_in(BaseModel):
    outlet_id: int
    lines: list[removal_line] = Field(min_length=1)
    reason: str = Field(min_length=3, max_length=500)
    disposition: str = Field("WRITE_OFF", pattern="^(WRITE_OFF|RETURN_TO_VENDOR|DESTROY|QUARANTINE)$")
    photo: Optional[str] = None
    request_key: Optional[str] = Field(None, max_length=50)


@router.post("/removals")
async def request_removal(b: removal_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    out = []
    for n, ln in enumerate(b.lines):
        bt = await exs.batch_at(db, ln.batch_id, b.outlet_id)
        out.append(await aps.submit(db, request_type="EXPIRED_REMOVAL", user=user, reason=b.reason, outlet_id=b.outlet_id,
                                    payload={"outlet_id": b.outlet_id, "batch_id": ln.batch_id, "qty": str(ln.qty), "disposition": b.disposition,
                                             "photo": b.photo, "batch_outlet": f"{ln.batch_id}:{b.outlet_id}"},
                                    summary=f"Remove {ln.qty.normalize():f} expired '{bt['name']}' batch {bt['batch_no']} (exp {bt['exp_date']})",
                                    ref_type="batch", ref_id=ln.batch_id, ref_no=bt["batch_no"], attachment=b.photo,
                                    old_value={"qty": float(bt["qty"])}, new_value={"qty": float(bt["qty"] - ln.qty)},
                                    request_key=f"{b.request_key}:{n}" if b.request_key else None))
    await db.commit()
    return out


@router.get("/removals")
async def removals(outlet_id: Optional[int] = None, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    p: dict = {}
    return await _rows(db, f"""SELECT r.*, a.request_no, o.outlet_name AS store, pr.name AS item, pr.item_code, ru.name AS requested_by_name,
        au.name AS approved_by_name FROM expired_removals r JOIN approval_requests a ON a.id = r.approval_id JOIN products pr ON pr.id = r.product_id
        LEFT JOIN outlets o ON o.id = r.outlet_id LEFT JOIN users ru ON ru.id = r.requested_by LEFT JOIN users au ON au.id = r.approved_by
        WHERE TRUE {_outlets(p, 'r.outlet_id', outlet_id)} ORDER BY r.id DESC LIMIT 1000""", p)


# ── wrong batch on a sale ─────────────────────────────────────────────────────
@router.get("/invoice-lines")
async def invoice_lines(invoice_no: str, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    inv = (await db.execute(text("SELECT id, invoice_no, outlet_id, invoice_date, status FROM unit_wise_invoices WHERE invoice_no = :n"),
                            {"n": invoice_no.strip()})).mappings().first()
    if not inv:
        raise HTTPException(404, "Bill not found")
    access.check_outlet(inv["outlet_id"])
    lines = await _rows(db, """SELECT ii.id, ii.product_id, p.name AS item, p.item_code, ii.qty, ii.batch_id, ii.batch_no, ii.expiry_date,
        (SELECT a.request_no || ' ' || a.status FROM approval_requests a WHERE a.request_type = 'BATCH_CORRECTION'
           AND a.payload->>'invoice_item_id' = ii.id::text ORDER BY a.id DESC LIMIT 1) AS last_request
        FROM unit_wise_invoice_items ii JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = :i ORDER BY ii.id""", {"i": inv["id"]})
    for ln in lines:
        ln["batches"] = await _rows(db, """SELECT b.id AS batch_id, b.batch_no, b.exp_date, COALESCE(s.current_qty, 0) AS qty FROM product_batches b
            LEFT JOIN product_batch_stock s ON s.batch_id = b.id AND s.location_id = :o WHERE b.product_id = :p AND b.id <> COALESCE(:cur, 0)
            ORDER BY b.exp_date NULLS LAST""", {"o": inv["outlet_id"], "p": ln["product_id"], "cur": ln["batch_id"]})
    return {**dict(inv), "lines": lines}


class batch_fix_in(BaseModel):
    invoice_item_id: int
    to_batch_id: int
    reason: str = Field(min_length=3, max_length=500)


@router.post("/batch-correction")
async def batch_correction(b: batch_fix_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    ln = await exs.invoice_line(db, b.invoice_item_id)
    to = await exs.batch_at(db, b.to_batch_id, ln["outlet_id"])
    r = await aps.submit(db, request_type="BATCH_CORRECTION", user=user, reason=b.reason, outlet_id=ln["outlet_id"],
                         payload={"invoice_item_id": b.invoice_item_id, "to_batch_id": b.to_batch_id, "qty": str(ln["qty"])},
                         summary=f"Bill {ln['invoice_no']} '{ln['name']}': batch {ln['batch_no']} → {to['batch_no']}",
                         ref_type="invoice", ref_id=ln["invoice_id"], ref_no=ln["invoice_no"],
                         old_value={"batch": ln["batch_no"], "expiry": ln["expiry_date"]}, new_value={"batch": to["batch_no"], "expiry": to["exp_date"]},
                         request_key=f"bcr:{b.invoice_item_id}:{b.to_batch_id}:{uuid.uuid4().hex[:6]}")
    await db.commit()
    return r


class exp_fix_in(BaseModel):
    batch_id: int
    new_exp_date: date
    reason: str = Field(min_length=10, max_length=500)
    attachment: Optional[str] = None


@router.post("/expiry-correction")
async def expiry_correction(b: exp_fix_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Correct a wrongly keyed expiry date on the batch master (always needs approval; document the source)."""
    bt = (await db.execute(text("SELECT b.batch_no, b.exp_date, p.name FROM product_batches b JOIN products p ON p.id = b.product_id WHERE b.id = :b"),
                           {"b": b.batch_id})).mappings().first()
    if not bt:
        raise HTTPException(404, "Batch not found")
    r = await aps.submit(db, request_type="EXPIRY_CORRECTION", user=user, reason=b.reason, payload={"batch_id": b.batch_id, "new_exp_date": str(b.new_exp_date)},
                         summary=f"'{bt['name']}' batch {bt['batch_no']}: expiry {bt['exp_date']} → {b.new_exp_date}", ref_type="batch",
                         ref_id=b.batch_id, ref_no=bt["batch_no"], old_value={"exp_date": bt["exp_date"]}, new_value={"exp_date": b.new_exp_date},
                         attachment=b.attachment, force_approval=True)
    await db.commit()
    return r


@router.get("/corrections")
async def corrections(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    p = {"outs": access.allowed_outlets()}
    return await _rows(db, f"""SELECT c.*, a.request_no, p.name AS item, i.invoice_no, ru.name AS requested_by_name, au.name AS approved_by_name
        FROM batch_corrections c JOIN products p ON p.id = c.product_id LEFT JOIN approval_requests a ON a.id = c.approval_id
        LEFT JOIN unit_wise_invoices i ON i.id = c.invoice_id LEFT JOIN users ru ON ru.id = c.requested_by LEFT JOIN users au ON au.id = c.approved_by
        WHERE (CAST(:outs AS INT[]) IS NULL OR c.outlet_id IS NULL OR c.outlet_id = ANY(:outs)) ORDER BY c.id DESC LIMIT 1000""", p)
