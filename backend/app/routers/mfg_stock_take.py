"""Manufacturing physical stock take (cycle count / full count) for the department stores.

Process:  count sheet created (system stock frozen per store / item / batch / brand)  ->  counters enter what they physically find
(blind by default: the counter cannot see the system figure)  ->  submit  ->  variances + reasons reviewed (recount any line)  ->
a manager approves  ->  the differences are posted to the stock ledger as COUNT_GAIN / COUNT_LOSS (never edited, reversible).
The posted difference is (counted - frozen system qty), applied to the live balance, so movements made while counting are not lost.
"""
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.routers.mfg_setup import _audit
from app.services import mfg_planning_report as rp
from app.services import mfg_stock_service as stk

router = APIRouter(prefix="/manufacturing/stock-take", tags=["manufacturing stock take"])
D = stk.d
REASONS = ["Damaged", "Spillage / wastage", "Expired", "Pilferage / theft", "Receipt not recorded", "Issue not recorded", "Counting error", "Other"]
APPROVERS = ("admin", "superadmin", "manager")
_ready = False
DDL = ["""CREATE TABLE IF NOT EXISTS mfg_stock_counts (
    id SERIAL PRIMARY KEY, count_no VARCHAR(30) UNIQUE NOT NULL, store_id INTEGER NOT NULL REFERENCES mfg_stores(id), item_type VARCHAR(4),
    blind BOOLEAN NOT NULL DEFAULT TRUE, status VARCHAR(15) NOT NULL DEFAULT 'COUNTING', remarks TEXT,
    created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW(), submitted_by INTEGER, submitted_at TIMESTAMP,
    approved_by INTEGER, approved_at TIMESTAMP, post_doc VARCHAR(30))""",
       """CREATE TABLE IF NOT EXISTS mfg_stock_count_lines (
    id SERIAL PRIMARY KEY, count_id INTEGER NOT NULL REFERENCES mfg_stock_counts(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id),
    batch_no VARCHAR(100) NOT NULL DEFAULT '', brand_id INTEGER NOT NULL DEFAULT 0, system_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    counted_qty NUMERIC(14,4), reason VARCHAR(40), recounts INTEGER NOT NULL DEFAULT 0, counted_by INTEGER, counted_at TIMESTAMP,
    UNIQUE (count_id, product_id, batch_no, brand_id))"""]


async def ensure(db: AsyncSession):
    global _ready
    if not _ready:
        for q in DDL:
            await db.execute(text(q))
        await db.commit()
        _ready = True


def _j(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, dict):
        return {k: _j(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_j(x) for x in v]
    return v


async def _get(db, cid: int) -> dict:
    await ensure(db)
    h = (await db.execute(text("""SELECT c.*, s.name AS store, s.code AS store_code, u.name AS created_name, a.name AS approved_name
        FROM mfg_stock_counts c JOIN mfg_stores s ON s.id = c.store_id LEFT JOIN users u ON u.id = c.created_by LEFT JOIN users a ON a.id = c.approved_by
        WHERE c.id = :i"""), {"i": cid})).mappings().first()
    if not h:
        raise HTTPException(404, "Stock take not found")
    return dict(h)


async def _lines(db, cid: int) -> list[dict]:
    return [dict(r) for r in (await db.execute(text("""SELECT l.*, p.item_code, p.barcode, p.name AS item, p.item_type, p.unit, COALESCE(b.name, '') AS brand
        FROM mfg_stock_count_lines l JOIN products p ON p.id = l.product_id LEFT JOIN mfg_brands b ON b.id = l.brand_id AND l.brand_id > 0
        WHERE l.count_id = :i ORDER BY p.item_type, p.name, l.batch_no, l.id"""), {"i": cid})).mappings().all()]


def _view(h: dict, lines: list[dict]) -> dict:
    """Blind counting: system figures and variances stay hidden until the sheet is submitted."""
    hide = h["blind"] and h["status"] == "COUNTING"
    out = []
    for l in lines:
        v = None if l["counted_qty"] is None else D(l["counted_qty"]) - D(l["system_qty"])
        row = {**l, "variance": None if hide else v}
        if hide:
            row["system_qty"] = None
        out.append(row)
    return {"count": h, "lines": out, "reasons": REASONS,
            "summary": {"lines": len(lines), "counted": sum(1 for l in lines if l["counted_qty"] is not None),
                        "with_variance": 0 if hide else sum(1 for l in lines if l["counted_qty"] is not None and D(l["counted_qty"]) != D(l["system_qty"]))}}


@router.get("")
async def list_counts(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    await ensure(db)
    rows = (await db.execute(text("""SELECT c.id, c.count_no, c.status, c.blind, c.item_type, c.created_at, c.approved_at, s.name AS store,
        (SELECT COUNT(*) FROM mfg_stock_count_lines l WHERE l.count_id = c.id) AS lines,
        (SELECT COUNT(*) FROM mfg_stock_count_lines l WHERE l.count_id = c.id AND l.counted_qty IS NOT NULL) AS counted,
        (SELECT COUNT(*) FROM mfg_stock_count_lines l WHERE l.count_id = c.id AND l.counted_qty IS NOT NULL AND l.counted_qty <> l.system_qty) AS variances
        FROM mfg_stock_counts c JOIN mfg_stores s ON s.id = c.store_id ORDER BY c.id DESC LIMIT 200"""))).mappings().all()
    return _j([dict(r) for r in rows])


class create_in(BaseModel):
    store_id: int
    item_type: Optional[str] = Field(None, pattern="^(FG|RM|PM|SFG|CONS|OTH)$")
    blind: bool = True
    include_zero: bool = False      # also list items of the chosen type that have no stock in the store (found-but-not-in-system check)
    remarks: Optional[str] = None


@router.post("")
async def create(b: create_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Freezes the system stock of one store (optionally one item type) as the count sheet."""
    await ensure(db)
    if not (await db.execute(text("SELECT 1 FROM mfg_stores WHERE id = :s AND is_active"), {"s": b.store_id})).first():
        raise HTTPException(404, "Store not found")
    open_ = (await db.execute(text("SELECT count_no FROM mfg_stock_counts WHERE store_id = :s AND status IN ('COUNTING','SUBMITTED') AND COALESCE(item_type,'') = COALESCE(:t,'')"),
                              {"s": b.store_id, "t": b.item_type})).scalar()
    if open_:
        raise HTTPException(400, f"{open_} is still open for this store - approve or cancel it first.")
    no = await stk.next_doc(db, "CNT")
    cid = (await db.execute(text("""INSERT INTO mfg_stock_counts (count_no, store_id, item_type, blind, remarks, created_by)
        VALUES (:n, :s, :t, :bl, :r, :u) RETURNING id"""), {"n": no, "s": b.store_id, "t": b.item_type, "bl": b.blind, "r": b.remarks, "u": user.user_id})).scalar()
    n = (await db.execute(text("""INSERT INTO mfg_stock_count_lines (count_id, product_id, batch_no, brand_id, system_qty)
        SELECT :c, m.product_id, m.batch_no, m.brand_id, m.qty FROM mfg_stock m JOIN products p ON p.id = m.product_id
        WHERE m.store_id = :s AND m.qty > 0 AND (CAST(:t AS VARCHAR) IS NULL OR p.item_type = :t)"""), {"c": cid, "s": b.store_id, "t": b.item_type})).rowcount
    if b.include_zero:
        if not b.item_type:
            raise HTTPException(400, "Choose an item type to include zero-stock items.")
        n += (await db.execute(text("""INSERT INTO mfg_stock_count_lines (count_id, product_id, batch_no, brand_id, system_qty)
            SELECT :c, p.id, '', 0, 0 FROM products p WHERE p.item_type = :t AND p.is_active
            AND NOT EXISTS (SELECT 1 FROM mfg_stock_count_lines l WHERE l.count_id = :c AND l.product_id = p.id) ON CONFLICT DO NOTHING"""), {"c": cid, "t": b.item_type})).rowcount
    await _audit(db, user, "stock_take_create", cid, no, f"Stock take {no} created: {n} line(s)")
    await db.commit()
    return {"id": cid, "count_no": no, "lines": n}


@router.get("/{cid}")
async def detail(cid: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return _j(_view(await _get(db, cid), await _lines(db, cid)))


class count_line(BaseModel):
    id: int
    counted_qty: Optional[Decimal] = Field(None, ge=0)
    reason: Optional[str] = None


class count_in(BaseModel):
    lines: list[count_line] = Field(min_length=1)


@router.post("/{cid}/count")
async def save_counts(cid: int, b: count_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    h = await _get(db, cid)
    if h["status"] not in ("COUNTING", "SUBMITTED"):
        raise HTTPException(400, f"A {h['status'].lower()} stock take cannot be changed.")
    for ln in b.lines:
        await db.execute(text("""UPDATE mfg_stock_count_lines SET counted_qty = :q, reason = :r, counted_by = :u,
            counted_at = CASE WHEN CAST(:q AS NUMERIC) IS NULL THEN NULL ELSE NOW() END WHERE id = :i AND count_id = :c"""),
                         {"q": ln.counted_qty, "r": ln.reason, "u": user.user_id, "i": ln.id, "c": cid})
    await db.commit()
    return {"saved": len(b.lines)}


class extra_in(BaseModel):
    product_id: int
    batch_no: str = ""
    brand_id: int = 0
    counted_qty: Decimal = Field(ge=0)


@router.post("/{cid}/extra")
async def add_extra(cid: int, b: extra_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """An item physically found in the store that the system does not show there."""
    h = await _get(db, cid)
    if h["status"] != "COUNTING":
        raise HTTPException(400, "Only a stock take that is being counted can take extra lines.")
    await db.execute(text("""INSERT INTO mfg_stock_count_lines (count_id, product_id, batch_no, brand_id, system_qty, counted_qty, counted_by, counted_at)
        VALUES (:c, :p, :b, :br, 0, :q, :u, NOW()) ON CONFLICT (count_id, product_id, batch_no, brand_id) DO UPDATE SET counted_qty = EXCLUDED.counted_qty"""),
                     {"c": cid, "p": b.product_id, "b": b.batch_no or "", "br": b.brand_id or 0, "q": b.counted_qty, "u": user.user_id})
    await db.commit()
    return {"ok": True}


class submit_in(BaseModel):
    zero_uncounted: bool = False


@router.post("/{cid}/submit")
async def submit(cid: int, b: submit_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    h = await _get(db, cid)
    if h["status"] != "COUNTING":
        raise HTTPException(400, "Only a stock take that is being counted can be submitted.")
    unc = (await db.execute(text("SELECT COUNT(*) FROM mfg_stock_count_lines WHERE count_id = :c AND counted_qty IS NULL"), {"c": cid})).scalar()
    if unc and not b.zero_uncounted:
        raise HTTPException(400, f"{unc} line(s) are not counted yet. Count them, or submit with 'treat uncounted as zero'.")
    if unc:
        await db.execute(text("UPDATE mfg_stock_count_lines SET counted_qty = 0, counted_by = :u, counted_at = NOW() WHERE count_id = :c AND counted_qty IS NULL"), {"u": user.user_id, "c": cid})
    await db.execute(text("UPDATE mfg_stock_counts SET status = 'SUBMITTED', submitted_by = :u, submitted_at = NOW() WHERE id = :c"), {"u": user.user_id, "c": cid})
    await _audit(db, user, "stock_take_submit", cid, h["count_no"], f"{h['count_no']} submitted for approval")
    await db.commit()
    return {"status": "SUBMITTED"}


class recount_in(BaseModel):
    line_ids: list[int] = Field(min_length=1)


@router.post("/{cid}/recount")
async def recount(cid: int, b: recount_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Sends variance lines back to be counted again (the figure stays hidden again on a blind count)."""
    h = await _get(db, cid)
    if h["status"] not in ("COUNTING", "SUBMITTED"):
        raise HTTPException(400, "Nothing to recount on this stock take.")
    await db.execute(text("""UPDATE mfg_stock_count_lines SET counted_qty = NULL, reason = NULL, recounts = recounts + 1 WHERE count_id = :c AND id = ANY(:ids)"""),
                     {"c": cid, "ids": b.line_ids})
    await db.execute(text("UPDATE mfg_stock_counts SET status = 'COUNTING', submitted_by = NULL, submitted_at = NULL WHERE id = :c"), {"c": cid})
    await db.commit()
    return {"status": "COUNTING"}


@router.post("/{cid}/approve")
async def approve(cid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    h = await _get(db, cid)
    if user.role not in APPROVERS:
        raise HTTPException(403, "Only a manager / administrator can approve a stock take.")
    if h["status"] != "SUBMITTED":
        raise HTTPException(400, "Only a submitted stock take can be approved.")
    lines = await _lines(db, cid)
    bad = [l for l in lines if D(l["counted_qty"]) != D(l["system_qty"]) and not l["reason"]]
    if bad:
        raise HTTPException(400, f"{len(bad)} line(s) with a difference have no reason - enter a reason for each (e.g. '{bad[0]['item']}').")
    doc = await stk.next_doc(db, "CAD")
    gain = loss = 0
    for l in lines:
        var = D(l["counted_qty"]) - D(l["system_qty"])
        if var == 0:
            continue
        kw = dict(product_id=l["product_id"], qty_base=abs(var), user_id=user.user_id, batch_no=l["batch_no"], brand_id=l["brand_id"],
                  ref_type="stock_take", ref_id=cid, ref_no=h["count_no"], remarks=f"{h['count_no']}: {l['reason']}", request_key=f"COUNT-{cid}-{l['id']}", doc_no=doc)
        if var > 0:
            await stk.post(db, txn_type="COUNT_GAIN", from_store=None, to_store=h["store_id"], **kw)
            gain += 1
        else:
            await stk.post(db, txn_type="COUNT_LOSS", from_store=h["store_id"], to_store=None, **kw)
            loss += 1
    await db.execute(text("UPDATE mfg_stock_counts SET status = 'APPROVED', approved_by = :u, approved_at = NOW(), post_doc = :d WHERE id = :c"),
                     {"u": user.user_id, "d": doc, "c": cid})
    await _audit(db, user, "stock_take_approve", cid, h["count_no"], f"{h['count_no']} approved: {gain} gain(s), {loss} loss(es) posted as {doc}")
    await db.commit()
    return {"status": "APPROVED", "gains": gain, "losses": loss, "doc": doc}


@router.post("/{cid}/cancel")
async def cancel(cid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    h = await _get(db, cid)
    if h["status"] not in ("COUNTING", "SUBMITTED"):
        raise HTTPException(400, "This stock take is already closed.")
    await db.execute(text("UPDATE mfg_stock_counts SET status = 'CANCELLED' WHERE id = :c"), {"c": cid})
    await _audit(db, user, "stock_take_cancel", cid, h["count_no"], f"{h['count_no']} cancelled")
    await db.commit()
    return {"status": "CANCELLED"}


@router.get("/{cid}/sheet")
async def sheet(cid: int, kind: str = Query("count", pattern="^(count|variance)$"), fmt: str = Query("xlsx", pattern="^(xlsx|pdf)$"),
                db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """count = printable sheet to walk the store with (system figure left off on a blind count); variance = counted vs system, with reasons."""
    h = await _get(db, cid)
    lines = await _lines(db, cid)
    meta = [("Stock take", h["count_no"]), ("Store", h["store"]), ("Item type", h["item_type"] or "All"), ("Status", h["status"]),
            ("Created", str(h["created_at"])[:16]), ("Counted by", "____________________"), ("Checked by", "____________________")]
    if kind == "count":
        blind = h["blind"]
        cols = ["Code", "Item", "Type", "Brand", "Batch", "Unit"] + ([] if blind else ["System qty"]) + ["Counted qty", "Remarks"]
        rows = [[l["item_code"], l["item"], l["item_type"], l["brand"], l["batch_no"], l["unit"]] + ([] if blind else [float(l["system_qty"])]) + ["", ""] for l in lines]
        sec = {"name": h["count_no"], "title": f"Physical count sheet - {h['count_no']}", "meta": meta, "cols": cols, "rows": rows}
    else:
        cols = ["Code", "Item", "Brand", "Batch", "Unit", "System qty", "Counted qty", "Difference", "Reason"]
        rows = []
        for l in lines:
            c = None if l["counted_qty"] is None else float(l["counted_qty"])
            rows.append([l["item_code"], l["item"], l["brand"], l["batch_no"], l["unit"], float(l["system_qty"]), "" if c is None else c,
                         "" if c is None else round(c - float(l["system_qty"]), 4), l["reason"] or ""])
        sec = {"name": h["count_no"], "title": f"Stock take variance - {h['count_no']}", "meta": meta, "cols": cols, "rows": rows}
    co = await rp.company(db)
    name = f"{h['count_no']}_{kind}"
    if fmt == "pdf":
        return Response(rp.build_pdf(co, [sec]), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
    return Response(rp.build_xlsx(co, [sec]), media_type=rp.XLSX, headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})
