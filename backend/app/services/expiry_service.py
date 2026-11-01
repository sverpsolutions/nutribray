"""Expiry controls posted through the approval engine: expired-stock removal, wrong-batch correction on a sale,
expiry-date master correction. Stock moves only through the existing batch / outlet stock / stock ledger services."""
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import text

from app.services import batch_service
from app.services.approval_service import handler
from app.services.billing_service import _update_product_stock, _write_stock_ledger

D = lambda v: Decimal(str(v or 0))  # noqa: E731


def today() -> date:
    return (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()


async def batch_at(db, batch_id: int, outlet_id: int) -> dict:
    r = (await db.execute(text("""SELECT b.id, b.product_id, b.batch_no, b.exp_date, b.mfg_date, b.cost_price, p.name, p.item_code,
        COALESCE(s.current_qty, 0) AS qty FROM product_batches b JOIN products p ON p.id = b.product_id
        LEFT JOIN product_batch_stock s ON s.batch_id = b.id AND s.location_id = :o WHERE b.id = :b"""), {"b": batch_id, "o": outlet_id})).mappings().first()
    if not r:
        raise HTTPException(404, f"Batch #{batch_id} not found")
    return dict(r)


async def pending_qty(db, request_type: str, key: str, value, exclude: int = None) -> Decimal:
    return D((await db.execute(text(f"""SELECT SUM((payload->>'qty')::numeric) FROM approval_requests WHERE request_type = :t
        AND status = 'PENDING' AND payload->>'{key}' = :v AND id <> COALESCE(:x, 0)"""), {"t": request_type, "v": str(value), "x": exclude})).scalar())


@handler("EXPIRED_REMOVAL")
class ExpiredRemoval:
    @staticmethod
    async def check(db, p: dict):
        b = await batch_at(db, int(p["batch_id"]), int(p["outlet_id"]))
        if not b["exp_date"] or b["exp_date"] > today():
            raise HTTPException(400, f"Batch {b['batch_no']} of '{b['name']}' is not expired (expiry {b['exp_date'] or 'not set'}).")
        q = D(p["qty"])
        if q <= 0:
            raise HTTPException(400, "Quantity must be more than zero.")
        others = await pending_qty(db, "EXPIRED_REMOVAL", "batch_outlet", f"{p['batch_id']}:{p['outlet_id']}", p.get("_rid"))
        if q + others > D(b["qty"]):
            raise HTTPException(400, f"Only {D(b['qty']) - others:f} of batch {b['batch_no']} can be removed "
                                     f"(stock {D(b['qty']):f}, already requested {others:f}).")

    @staticmethod
    async def post(db, req: dict, approver) -> str:
        p, outlet = req["payload"], int(req["payload"]["outlet_id"])
        b = await batch_at(db, int(p["batch_id"]), outlet)
        q = D(p["qty"])
        await batch_service.record_batch_movement(db=db, batch_id=b["id"], location_id=outlet, qty_delta=-q, movement_type="adjustment",
                                                  product_id=b["product_id"], allow_negative=False)
        await _update_product_stock(db, b["product_id"], -q, outlet)
        await _write_stock_ledger(db=db, product_id=b["product_id"], txn_type="expired_out", qty=-q, ref_id=req["id"], ref_type="approval",
                                  outlet_id=outlet, notes=f"Expired stock removed ({req['request_no']}): {req['reason']}", user_id=approver.user_id,
                                  batch_no=b["batch_no"], batch_id=b["id"], expiry_date=b["exp_date"])
        rid = (await db.execute(text("""INSERT INTO expired_removals (approval_id, outlet_id, product_id, batch_id, batch_no, exp_date, qty, cost_value,
            disposition, reason, photo, requested_by, approved_by) VALUES (:a, :o, :p, :b, :bn, :e, :q, :cv, :d, :r, :ph, :rb, :ab) RETURNING id"""),
            {"a": req["id"], "o": outlet, "p": b["product_id"], "b": b["id"], "bn": b["batch_no"], "e": b["exp_date"], "q": q,
             "cv": q * D(b["cost_price"]), "d": p.get("disposition") or "WRITE_OFF", "r": req["reason"], "ph": p.get("photo"),
             "rb": req["requested_by"], "ab": approver.user_id})).scalar()
        return f"EXP-{rid}"


async def invoice_line(db, item_id: int) -> dict:
    r = (await db.execute(text("""SELECT ii.id, ii.invoice_id, ii.product_id, ii.qty, ii.batch_id, ii.batch_no, ii.expiry_date, i.invoice_no,
        i.outlet_id, i.status, i.invoice_type, p.name FROM unit_wise_invoice_items ii JOIN unit_wise_invoices i ON i.id = ii.invoice_id
        JOIN products p ON p.id = ii.product_id WHERE ii.id = :i"""), {"i": item_id})).mappings().first()
    if not r:
        raise HTTPException(404, "Bill line not found")
    return dict(r)


@handler("BATCH_CORRECTION")
class BatchCorrection:
    @staticmethod
    async def check(db, p: dict):
        ln = await invoice_line(db, int(p["invoice_item_id"]))
        if ln["status"] in ("cancelled", "draft") or ln["invoice_type"] in ("return", "credit_note", "proforma"):
            raise HTTPException(400, "Only a line of an active sale bill can be corrected.")
        if not ln["batch_id"]:
            raise HTTPException(400, "This line has no batch to correct.")
        to = await batch_at(db, int(p["to_batch_id"]), ln["outlet_id"])
        if to["product_id"] != ln["product_id"] or to["id"] == ln["batch_id"]:
            raise HTTPException(400, "Choose a different batch of the same item.")
        if (await db.execute(text("""SELECT 1 FROM approval_requests WHERE request_type = 'BATCH_CORRECTION' AND status = 'PENDING'
                AND payload->>'invoice_item_id' = :i AND id <> COALESCE(:x, 0)"""), {"i": str(p["invoice_item_id"]), "x": p.get("_rid")})).first():
            raise HTTPException(400, "A correction for this bill line is already waiting for approval.")
        if D(to["qty"]) < D(ln["qty"]):
            raise HTTPException(400, f"Batch {to['batch_no']} has only {D(to['qty']):f} in stock at this store; the line sold {D(ln['qty']):f}. "
                                     "Check the physical stock before correcting.")

    @staticmethod
    async def post(db, req: dict, approver) -> str:
        p = req["payload"]
        ln = await invoice_line(db, int(p["invoice_item_id"]))
        frm = await batch_at(db, ln["batch_id"], ln["outlet_id"])
        to = await batch_at(db, int(p["to_batch_id"]), ln["outlet_id"])
        q = D(ln["qty"])
        # compensating batch movements: the wrong batch gets its stock back, the right batch is reduced (item total unchanged)
        await batch_service.record_batch_movement(db=db, batch_id=frm["id"], location_id=ln["outlet_id"], qty_delta=q, movement_type="sale_return",
                                                  product_id=ln["product_id"])
        await batch_service.record_batch_movement(db=db, batch_id=to["id"], location_id=ln["outlet_id"], qty_delta=-q, movement_type="sale",
                                                  product_id=ln["product_id"], allow_negative=False)
        for b, sign in ((frm, 1), (to, -1)):
            await _write_stock_ledger(db=db, product_id=ln["product_id"], txn_type="batch_correction", qty=q * sign, ref_id=ln["invoice_id"],
                                      ref_type="invoice", outlet_id=ln["outlet_id"], notes=f"{req['request_no']}: bill {ln['invoice_no']} batch "
                                      f"{frm['batch_no']} → {to['batch_no']}", user_id=approver.user_id, batch_no=b["batch_no"], batch_id=b["id"],
                                      expiry_date=b["exp_date"])
        await db.execute(text("UPDATE unit_wise_invoice_items SET batch_id = :b, batch_no = :bn, expiry_date = :e WHERE id = :i"),
                         {"b": to["id"], "bn": to["batch_no"], "e": to["exp_date"], "i": ln["id"]})
        cid = (await db.execute(text("""INSERT INTO batch_corrections (approval_id, kind, invoice_id, invoice_item_id, outlet_id, product_id,
            from_batch_id, from_batch_no, from_expiry, to_batch_id, to_batch_no, to_expiry, qty, reason, requested_by, approved_by)
            VALUES (:a, 'SALE_BATCH', :inv, :it, :o, :p, :fb, :fbn, :fe, :tb, :tbn, :te, :q, :r, :rb, :ab) RETURNING id"""),
            {"a": req["id"], "inv": ln["invoice_id"], "it": ln["id"], "o": ln["outlet_id"], "p": ln["product_id"], "fb": frm["id"],
             "fbn": frm["batch_no"], "fe": frm["exp_date"], "tb": to["id"], "tbn": to["batch_no"], "te": to["exp_date"], "q": q,
             "r": req["reason"], "rb": req["requested_by"], "ab": approver.user_id})).scalar()
        return f"BCR-{cid}"


@handler("EXPIRY_CORRECTION")
class ExpiryCorrection:
    @staticmethod
    async def check(db, p: dict):
        b = (await db.execute(text("SELECT exp_date, mfg_date FROM product_batches WHERE id = :b"), {"b": int(p["batch_id"])})).mappings().first()
        if not b:
            raise HTTPException(404, "Batch not found")
        new = date.fromisoformat(str(p["new_exp_date"]))
        if b["exp_date"] == new:
            raise HTTPException(400, "The expiry date is already that.")
        if b["mfg_date"] and new <= b["mfg_date"]:
            raise HTTPException(400, "Expiry must be after the manufacturing date.")

    @staticmethod
    async def post(db, req: dict, approver) -> str:
        p = req["payload"]
        b = (await db.execute(text("SELECT id, product_id, batch_no, exp_date FROM product_batches WHERE id = :b FOR UPDATE"),
                              {"b": int(p["batch_id"])})).mappings().first()
        new = date.fromisoformat(str(p["new_exp_date"]))
        await db.execute(text("UPDATE product_batches SET exp_date = :e, updated_at = NOW() WHERE id = :b"), {"e": new, "b": b["id"]})
        cid = (await db.execute(text("""INSERT INTO batch_corrections (approval_id, kind, product_id, from_batch_id, from_batch_no, from_expiry,
            to_batch_id, to_batch_no, to_expiry, reason, requested_by, approved_by) VALUES (:a, 'EXPIRY', :p, :b, :bn, :fe, :b, :bn, :te, :r, :rb, :ab)
            RETURNING id"""), {"a": req["id"], "p": b["product_id"], "b": b["id"], "bn": b["batch_no"], "fe": b["exp_date"], "te": new,
                               "r": req["reason"], "rb": req["requested_by"], "ab": approver.user_id})).scalar()
        return f"ECR-{cid}"
