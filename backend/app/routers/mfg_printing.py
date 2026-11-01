"""Manufacturing Phase B: printing job work (internal department or external vendor).

Issue challan (approved by a second person) moves plain tins source store -> Printing WIP; they stay company stock.
Receipts convert them: accepted printed tins -> Printed Tin Store (brand-specific), rejected -> Rejected store,
damaged -> Scrap + damage register (pending approval). Missing tins are closed only by an approved loss or a return
of unprinted tins; a job cannot close while anything is unexplained: issued = accepted + rejected + damaged + lost + returned.
"""
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.routers.mfg_setup import ADMIN, _audit, _not_own, _rows
from app.services import mfg_stock_service as stk

router = APIRouter(prefix="/manufacturing/printing", tags=["manufacturing printing"])
SOURCE_KINDS = ("PLAIN_TIN", "PACKAGING", "REJECTED")   # rejected printed tins may be sent back for reprinting
PEND = "j.qty_issued - j.accepted_qty - j.rejected_qty - j.damaged_qty - j.lost_qty - j.returned_qty"


class job_in(BaseModel):
    vendor_type: str = "INTERNAL"
    vendor_name: str = Field(min_length=2, max_length=150)
    supplier_id: Optional[int] = None
    spec_id: Optional[int] = None
    brand_id: int
    artwork_id: int
    plain_item_id: int
    printed_item_id: int
    source_store_id: int
    source_batch_no: str = ""
    source_brand_id: int = 0
    sales_order_id: Optional[int] = None
    mfg_order_id: Optional[int] = None
    tin_size: Optional[str] = None
    printing_colour: Optional[str] = None
    cap_colour: Optional[str] = None
    qty: Decimal = Field(gt=0)
    unit: Optional[str] = None
    expected_return: Optional[date] = None
    vehicle_ref: Optional[str] = None
    remarks: Optional[str] = None


async def _job(db, jid, lock=False):
    j = (await db.execute(text(f"SELECT j.*, {PEND} AS pending FROM mfg_print_jobs j WHERE j.id = :i" + (" FOR UPDATE" if lock else "")),
                          {"i": jid})).mappings().first()
    if not j:
        raise HTTPException(404, "Printing job not found")
    return j


async def _jobs(db, where: str, p: dict):
    return await _rows(db, f"""SELECT j.*, {PEND} AS pending, b.name AS brand, c.name AS customer, a.code AS artwork_code, a.revision AS artwork_rev,
        a.file_path AS artwork_file, pl.name AS plain_item, pr.name AS printed_item, pr.item_code AS printed_code, s.name AS source_store,
        so.so_no, mo.order_no, pu.name AS prepared_by_name, au.name AS approved_by_name,
        (j.expected_return < CURRENT_DATE AND j.status IN ('ISSUED','PARTIAL')) AS overdue
        FROM mfg_print_jobs j JOIN mfg_brands b ON b.id = j.brand_id LEFT JOIN customers c ON c.id = b.customer_id
        JOIN mfg_artworks a ON a.id = j.artwork_id JOIN products pl ON pl.id = j.plain_item_id JOIN products pr ON pr.id = j.printed_item_id
        JOIN mfg_stores s ON s.id = j.source_store_id LEFT JOIN mfg_sales_orders so ON so.id = j.sales_order_id
        LEFT JOIN mfg_orders mo ON mo.id = j.mfg_order_id LEFT JOIN users pu ON pu.id = j.prepared_by LEFT JOIN users au ON au.id = j.approved_by
        WHERE {where} ORDER BY j.id DESC LIMIT 500""", p)


@router.get("/jobs")
async def list_jobs(status: Optional[str] = None, brand_id: Optional[int] = None, search: str = "",
                    db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _jobs(db, """(CAST(:s AS TEXT) IS NULL OR j.status = :s) AND (CAST(:b AS INT) IS NULL OR j.brand_id = :b)
          AND (:q = '%%' OR j.job_no ILIKE :q OR j.vendor_name ILIKE :q OR pr.name ILIKE :q OR so.so_no ILIKE :q)""",
                       {"s": status, "b": brand_id, "q": f"%{search.strip()}%"})


@router.get("/jobs/{jid}")
async def get_job(jid: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    rows = await _jobs(db, "j.id = :i", {"i": jid})
    if not rows:
        raise HTTPException(404, "Printing job not found")
    head = rows[0]
    head["receipts"] = await _rows(db, """SELECT r.*, u.name AS received_by_name,
        TO_CHAR(r.received_at + INTERVAL '5 hours 30 minutes', 'DD Mon YYYY HH24:MI') AS received
        FROM mfg_print_receipts r LEFT JOIN users u ON u.id = r.received_by WHERE r.job_id = :i ORDER BY r.id""", {"i": jid})
    head["damages"] = await _rows(db, "SELECT damage_no, qty, reason, status FROM mfg_damages WHERE print_job_id = :i ORDER BY id", {"i": jid})
    head["ledger"] = await _rows(db, """SELECT t.doc_no, t.txn_type, p.name AS item, fs.code AS from_store, ts.code AS to_store, t.qty
        FROM mfg_stock_txns t JOIN products p ON p.id = t.product_id LEFT JOIN mfg_stores fs ON fs.id = t.from_store_id
        LEFT JOIN mfg_stores ts ON ts.id = t.to_store_id WHERE t.ref_type = 'print_job' AND t.ref_id = :i ORDER BY t.id""", {"i": jid})
    return head


@router.post("/jobs")
async def create_job(b: job_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Printing issue challan. Nothing moves until a second person approves it."""
    art = (await db.execute(text("SELECT brand_id, status, applies_to, code, revision FROM mfg_artworks WHERE id = :a"), {"a": b.artwork_id})).mappings().first()
    if not art or art["status"] != "APPROVED":
        raise HTTPException(400, "Choose an APPROVED artwork revision.")
    if art["brand_id"] != b.brand_id:
        raise HTTPException(400, f"Artwork {art['code']} belongs to another brand — another customer's design cannot be printed on this job.")
    if b.spec_id:
        sp = (await db.execute(text("SELECT brand_id, status, printed_tin_item_id FROM mfg_pack_specs WHERE id = :s"), {"s": b.spec_id})).mappings().first()
        if not sp or sp["brand_id"] != b.brand_id or sp["status"] != "APPROVED":
            raise HTTPException(400, "Packaging spec must be APPROVED and belong to the same brand.")
        if sp["printed_tin_item_id"] and sp["printed_tin_item_id"] != b.printed_item_id:
            raise HTTPException(400, "The printed item differs from the one on the packaging spec.")
    if b.plain_item_id == b.printed_item_id and b.source_store_id != await stk.store(db, "REJ"):
        raise HTTPException(400, "Plain and printed item must be different items (printed tins of each customer are their own item).")
    kind = (await db.execute(text("SELECT kind FROM mfg_stores WHERE id = :s"), {"s": b.source_store_id})).scalar()
    if kind not in SOURCE_KINDS:
        raise HTTPException(400, "Issue to printing from the Plain Tin, Packaging or (for reprinting) Rejected store.")
    if b.vendor_type not in ("INTERNAL", "EXTERNAL"):
        raise HTTPException(400, "Vendor type must be INTERNAL or EXTERNAL.")
    base = await stk.to_base(db, b.plain_item_id, b.qty, b.unit)
    have = await stk.balance(db, b.source_store_id, b.plain_item_id, b.source_batch_no, b.source_brand_id)
    if have < base:
        raise HTTPException(400, f"Only {have.normalize():f} available in the source store; challan needs {base.normalize():f}.")
    no = await stk.next_doc(db, "PJ")
    data = b.model_dump(exclude={"qty", "unit"})
    cols = list(data)
    jid = (await db.execute(text(f"""INSERT INTO mfg_print_jobs ({', '.join(cols)}, job_no, job_date, qty_issued, unit_entered, qty_entered, prepared_by)
        VALUES ({', '.join(':' + c for c in cols)}, :no, :day, :q, :u, :qe, :by) RETURNING id"""),
        {**data, "no": no, "day": stk.today(), "q": base, "u": b.unit, "qe": b.qty, "by": user.user_id})).scalar()
    await _audit(db, user, "create_print_job", jid, no, f"Printing job {no}: {base.normalize():f} to {b.vendor_name} (artwork {art['code']} r{art['revision']})")
    await db.commit()
    return {"id": jid, "job_no": no}


@router.post("/jobs/{jid}/approve")
async def approve_job(jid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    j = await _job(db, jid, lock=True)
    if j["status"] != "PENDING_APPROVAL":
        raise HTTPException(400, f"Job {j['job_no']} is {j['status'].lower()}.")
    _not_own(j["prepared_by"], user)
    await stk.post(db, txn_type="PRINT_ISSUE", product_id=j["plain_item_id"], qty_base=j["qty_issued"], from_store=j["source_store_id"],
                   to_store=await stk.store(db, "PWIP"), user_id=user.user_id, batch_no=j["source_batch_no"], brand_id=j["source_brand_id"],
                   unit_entered=j["unit_entered"], qty_entered=j["qty_entered"], ref_type="print_job", ref_id=jid, ref_no=j["job_no"],
                   doc_no=j["job_no"], request_key=f"pj:{jid}:issue", remarks=f"Issued to {j['vendor_name']}")
    await db.execute(text("UPDATE mfg_print_jobs SET status = 'ISSUED', approved_by = :u, approved_at = NOW() WHERE id = :i"), {"u": user.user_id, "i": jid})
    await _audit(db, user, "approve_print_job", jid, j["job_no"], f"Printing job {j['job_no']} approved; {j['qty_issued'].normalize():f} moved to Printing WIP")
    await db.commit()
    return {"success": True}


class reason_in(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/jobs/{jid}/reject")
async def reject_job(jid: int, b: reason_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    j = await _job(db, jid, lock=True)
    if j["status"] != "PENDING_APPROVAL":
        raise HTTPException(400, "Only a job awaiting approval can be rejected.")
    await db.execute(text("UPDATE mfg_print_jobs SET status = 'REJECTED', closed_by = :u, closed_at = NOW(), close_note = :r WHERE id = :i"),
                     {"u": user.user_id, "r": b.reason, "i": jid})
    await _audit(db, user, "reject_print_job", jid, j["job_no"], f"Printing job {j['job_no']} rejected: {b.reason}")
    await db.commit()
    return {"success": True}


class receipt_in(BaseModel):
    accepted_qty: Decimal = Field(Decimal(0), ge=0)
    rejected_qty: Decimal = Field(Decimal(0), ge=0)
    damaged_qty: Decimal = Field(Decimal(0), ge=0)
    damage_reason: str = "Printing Defect"
    artwork_ok: bool
    colour_ok: bool
    quality_status: str = Field(pattern="^(OK|MINOR_DEFECTS|FAILED)$")
    qc_remarks: Optional[str] = None
    request_key: Optional[str] = Field(None, max_length=60)


@router.post("/jobs/{jid}/receive")
async def receive(jid: int, b: receipt_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Printed tins back from printing, inspected in the same step: only accepted tins become usable stock."""
    if not await stk.once(db, b.request_key):
        return {"duplicate": True}
    j = await _job(db, jid, lock=True)
    if j["status"] not in ("ISSUED", "PARTIAL"):
        raise HTTPException(400, f"Job {j['job_no']} is {j['status'].lower()}; nothing to receive.")
    total = b.accepted_qty + b.rejected_qty + b.damaged_qty
    if total <= 0:
        raise HTTPException(400, "Enter the accepted, rejected or damaged quantity.")
    if total > j["pending"]:
        raise HTTPException(400, f"Receipt {total.normalize():f} is more than the {j['pending'].normalize():f} still with the printer.")
    if b.accepted_qty > 0 and not (b.artwork_ok and b.colour_ok):
        raise HTTPException(400, "Artwork and colour must be verified before printed tins are accepted. Mark them rejected instead.")
    no = await stk.next_doc(db, "PRC")
    pwip, prs, rej, scr, qcq = [await stk.store(db, c) for c in ("PWIP", "PRS", "REJ", "SCR", "QCQ")]
    common = dict(user_id=user.user_id, ref_type="print_job", ref_id=jid, ref_no=j["job_no"], doc_no=no)
    # plain tins leave Printing WIP (converted) …
    await stk.post(db, txn_type="PRINT_CONVERT", product_id=j["plain_item_id"], qty_base=total, from_store=pwip, to_store=None,
                   batch_no=j["source_batch_no"], brand_id=j["source_brand_id"], remarks=f"Converted to printed item on receipt {no}", **common)
    # … and come back as the customer's printed item
    for qty, to, typ in ((b.accepted_qty, prs, "PRINT_RECEIPT"), (b.rejected_qty, rej, "PRINT_REJECT")):
        if qty > 0:
            await stk.post(db, txn_type=typ, product_id=j["printed_item_id"], qty_base=qty, from_store=None, to_store=to,
                           batch_no=j["job_no"], brand_id=j["brand_id"], **common)
    dmg = None
    if b.damaged_qty > 0:
        await stk.post(db, txn_type="PRINT_RECEIPT", product_id=j["printed_item_id"], qty_base=b.damaged_qty, from_store=None, to_store=qcq,
                       batch_no=j["job_no"], brand_id=j["brand_id"], remarks="Damaged — moving to scrap pending approval", **common)
        dmg = await stk.record_damage(db, source="PRINTING", product_id=j["printed_item_id"], qty=b.damaged_qty, reason=b.damage_reason,
                                      held_store=scr, back_store=qcq, from_store=qcq, user_id=user.user_id, base_qty=j["qty_issued"],
                                      brand_id=j["brand_id"], batch_no=j["job_no"], print_job_id=jid, stage="Printing",
                                      department="Printing", remarks=b.qc_remarks, ref_no=j["job_no"])
    await db.execute(text("""INSERT INTO mfg_print_receipts (receipt_no, job_id, accepted_qty, rejected_qty, damaged_qty, artwork_ok, colour_ok,
        quality_status, qc_remarks, received_by) VALUES (:no, :j, :a, :r, :d, :ao, :co, :qs, :rm, :u)"""),
        {"no": no, "j": jid, "a": b.accepted_qty, "r": b.rejected_qty, "d": b.damaged_qty, "ao": b.artwork_ok, "co": b.colour_ok,
         "qs": b.quality_status, "rm": b.qc_remarks, "u": user.user_id})
    left = j["pending"] - total
    await db.execute(text("""UPDATE mfg_print_jobs SET accepted_qty = accepted_qty + :a, rejected_qty = rejected_qty + :r,
        damaged_qty = damaged_qty + :d, status = :s WHERE id = :i"""),
        {"a": b.accepted_qty, "r": b.rejected_qty, "d": b.damaged_qty, "s": "RECEIVED" if left == 0 else "PARTIAL", "i": jid})
    await _audit(db, user, "print_receipt", jid, no, f"{j['job_no']}: accepted {b.accepted_qty.normalize():f}, rejected "
                 f"{b.rejected_qty.normalize():f}, damaged {b.damaged_qty.normalize():f}; pending {left.normalize():f}")
    await db.commit()
    return {"receipt_no": no, "pending": float(left), "damage": dmg}


class resolve_in(BaseModel):
    qty: Decimal = Field(gt=0)
    reason: str = Field(min_length=3, max_length=300)


@router.post("/jobs/{jid}/return-unprinted")
async def return_unprinted(jid: int, b: resolve_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Tins the printer sends back unprinted go back to the store they came from."""
    j = await _job(db, jid, lock=True)
    if j["status"] not in ("ISSUED", "PARTIAL") or b.qty > j["pending"]:
        raise HTTPException(400, f"Only the {j['pending'].normalize():f} still with the printer can be returned.")
    await stk.post(db, txn_type="PRINT_RETURN", product_id=j["plain_item_id"], qty_base=b.qty, from_store=await stk.store(db, "PWIP"),
                   to_store=j["source_store_id"], user_id=user.user_id, batch_no=j["source_batch_no"], brand_id=j["source_brand_id"],
                   ref_type="print_job", ref_id=jid, ref_no=j["job_no"], remarks=b.reason)
    left = j["pending"] - b.qty
    await db.execute(text("UPDATE mfg_print_jobs SET returned_qty = returned_qty + :q, status = :s WHERE id = :i"),
                     {"q": b.qty, "s": "RECEIVED" if left == 0 else "PARTIAL", "i": jid})
    await _audit(db, user, "print_return", jid, j["job_no"], f"{j['job_no']}: {b.qty.normalize():f} unprinted returned — {b.reason}")
    await db.commit()
    return {"pending": float(left)}


@router.post("/jobs/{jid}/loss/approve")
async def approve_loss(jid: int, b: resolve_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Approved loss for tins the printer cannot account for (manager / admin, not the person who prepared the job)."""
    if user.role not in ADMIN + ("manager",):
        raise HTTPException(403, "Only a manager or administrator can approve a printing loss.")
    j = await _job(db, jid, lock=True)
    _not_own(j["prepared_by"], user)
    if j["status"] not in ("ISSUED", "PARTIAL") or b.qty > j["pending"]:
        raise HTTPException(400, f"Only the {j['pending'].normalize():f} still unaccounted can be written off.")
    no = await stk.next_doc(db, "DMG")
    await stk.post(db, txn_type="PRINT_LOSS", product_id=j["plain_item_id"], qty_base=b.qty, from_store=await stk.store(db, "PWIP"),
                   to_store=None, user_id=user.user_id, batch_no=j["source_batch_no"], brand_id=j["source_brand_id"], ref_type="print_job",
                   ref_id=jid, ref_no=j["job_no"], doc_no=no, remarks=f"Approved loss: {b.reason}")
    await db.execute(text("""INSERT INTO mfg_damages (damage_no, source, print_job_id, product_id, brand_id, batch_no, qty, base_qty, damage_pct,
        reason, stage, department, remarks, status, decided_by, decided_at, created_by)
        VALUES (:no, 'PRINTING', :j, :p, :br, :b, :q, :bq, ROUND(CAST(:q AS NUMERIC) / CAST(:bq AS NUMERIC) * 100, 3), 'Missing / Loss', 'Printing', 'Printing', :r,
                'APPROVED', :u, NOW(), :u)"""),
        {"no": no, "j": jid, "p": j["plain_item_id"], "br": j["source_brand_id"], "b": j["source_batch_no"], "q": b.qty,
         "bq": j["qty_issued"], "r": b.reason, "u": user.user_id})
    left = j["pending"] - b.qty
    await db.execute(text("UPDATE mfg_print_jobs SET lost_qty = lost_qty + :q, status = :s WHERE id = :i"),
                     {"q": b.qty, "s": "RECEIVED" if left == 0 else "PARTIAL", "i": jid})
    await _audit(db, user, "print_loss", jid, j["job_no"], f"{j['job_no']}: loss of {b.qty.normalize():f} approved — {b.reason}")
    await db.commit()
    return {"pending": float(left)}


@router.post("/jobs/{jid}/finalize")
async def close_job(jid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    j = await _job(db, jid, lock=True)
    if j["status"] != "RECEIVED" or j["pending"] != 0:
        raise HTTPException(400, f"{j['job_no']} still has {j['pending'].normalize():f} unaccounted. Receive it, return it, or approve a loss first.")
    if (await db.execute(text("SELECT 1 FROM mfg_damages WHERE print_job_id = :i AND status = 'PENDING'"), {"i": jid})).first():
        raise HTTPException(400, "Damage entries on this job are still awaiting approval.")
    await db.execute(text("UPDATE mfg_print_jobs SET status = 'CLOSED', closed_by = :u, closed_at = NOW() WHERE id = :i"), {"u": user.user_id, "i": jid})
    await _audit(db, user, "close_print_job", jid, j["job_no"],
                 f"{j['job_no']} closed: {j['qty_issued'].normalize():f} = {j['accepted_qty'].normalize():f} accepted + {j['rejected_qty'].normalize():f} "
                 f"rejected + {j['damaged_qty'].normalize():f} damaged + {j['lost_qty'].normalize():f} lost + {j['returned_qty'].normalize():f} returned")
    await db.commit()
    return {"success": True}


@router.post("/jobs/{jid}/cancel")
async def cancel_job(jid: int, b: reason_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    j = await _job(db, jid, lock=True)
    if j["status"] != "PENDING_APPROVAL":
        raise HTTPException(400, "Only a job not yet issued can be cancelled; return the tins instead.")
    await db.execute(text("UPDATE mfg_print_jobs SET status = 'CANCELLED', closed_by = :u, closed_at = NOW(), close_note = :r WHERE id = :i"),
                     {"u": user.user_id, "r": b.reason, "i": jid})
    await _audit(db, user, "cancel_print_job", jid, j["job_no"], f"{j['job_no']} cancelled: {b.reason}")
    await db.commit()
    return {"success": True}
