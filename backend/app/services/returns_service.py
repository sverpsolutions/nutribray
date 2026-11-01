"""Sales returns / credit notes raised at HO against any bill (outlet or HO).

Rules (see CHANGELOG v1.2.0-beta.1):
- A credit note is a row in unit_wise_invoices with invoice_type='return' and
  invoice_no 'CN-HO-YYYY-NNNN', linked to the original by ref_invoice_no
  (bill numbers are unique and survive re-sync; row ids do not).
- Refund is what the customer actually paid: the bill total is spread over its
  lines by value, then taxable + GST are extracted backwards from that
  GST-inclusive amount (same convention as NCG / outlet POS rates).
- Returned goods come back into HO stock: stock_ledger 'sale_return' +
  products.stock_qty. outlet_stock is sync-owned and never touched.
- Settlement 'adjust' reduces the original bill's due first; the rest is cash.
"""
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invoice import invoice, invoice_item, stock_ledger
from app.models.product import product
from app.services.billing_service import _write_stock_ledger, _update_product_stock
from app.core import access
from app.services import shift_service, batch_service

CN_PREFIX = "CN-HO-"
ZERO = Decimal("0")


def _two(v: Decimal) -> Decimal:
    return Decimal(v).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ─── Pure calculations (no DB) ────────────────────────────────────────────────

def line_value(invoice_no: str, item) -> Decimal:
    """GST-inclusive value of an original line, used only as a weight.
    HO bills (INV-*) store a reliable `total`; outlet POS bills store a
    GST-inclusive rate and a line-total discount in disc_val."""
    if invoice_no.startswith("INV-"):
        return Decimal(item.total or 0)
    return Decimal(item.qty or 0) * Decimal(item.rate or 0) - Decimal(item.disc_val or 0)


def split_gst(amount: Decimal, gst_pct: Decimal, interstate: bool) -> dict:
    """Extract taxable + GST from a GST-inclusive amount."""
    amount = _two(amount)
    taxable = _two(amount / (1 + gst_pct / 100))
    gst = amount - taxable
    if interstate:
        return {"taxable_amt": taxable, "cgst_amount": ZERO, "sgst_amount": ZERO, "igst_amount": gst,
                "cgst_percent": ZERO, "sgst_percent": ZERO, "igst_percent": gst_pct, "total": amount}
    cgst = _two(gst / 2)
    half = _two(gst_pct / 2)
    return {"taxable_amt": taxable, "cgst_amount": cgst, "sgst_amount": gst - cgst, "igst_amount": ZERO,
            "cgst_percent": half, "sgst_percent": half, "igst_percent": ZERO, "total": amount}


def bill_status(due: Decimal, total: Decimal) -> str:
    return "paid" if due <= 0 else ("unpaid" if due >= total else "partial")


def refund_for(paid: Decimal, sold_qty: Decimal, returned_qty: Decimal, refunded: Decimal, qty: Decimal) -> Decimal:
    """Refund for returning `qty` of a product line. Returning the last units
    pays out exactly what is left, so refunds never exceed what was paid."""
    if qty >= sold_qty - returned_qty:
        return _two(paid) - refunded
    return _two(paid * qty / sold_qty)


# ─── Returnable lines ─────────────────────────────────────────────────────────

async def _original(db: AsyncSession, invoice_no: str, lock: bool = False) -> invoice:
    stmt = select(invoice).where(invoice.invoice_no == invoice_no)
    if lock:
        stmt = stmt.with_for_update()
    inv = (await db.execute(stmt)).scalar_one_or_none()
    if not inv:
        raise LookupError(f"Bill {invoice_no} not found")
    if inv.invoice_type == "return":
        raise ValueError(f"{invoice_no} is itself a return")
    if inv.status == "cancelled":
        raise ValueError(f"Bill {invoice_no} is cancelled")
    return inv


async def returnable_lines(db: AsyncSession, inv: invoice) -> list[dict]:
    """One row per product/batch: sold, already returned (non-cancelled HO credit
    notes), returnable qty, and the GST-inclusive amount paid for that product/batch."""
    items = (await db.execute(select(invoice_item).where(invoice_item.invoice_id == inv.id))).scalars().all()
    weights = [max(line_value(inv.invoice_no, it), ZERO) for it in items]
    total_w = sum(weights) or Decimal(1)
    bill_total = Decimal(inv.total_amount or 0)

    lines: dict[tuple, dict] = {}
    for it, w in zip(items, weights):
        k = (it.product_id, (it.batch_no or "").strip())
        row = lines.setdefault(k, {
            "product_id": it.product_id, "item_code": it.item_code, "name": it.name,
            "unit": it.unit, "hsn_code": it.hsn_code, "gst_percent": Decimal(it.gst_percent or 0),
            "batch_no": it.batch_no, "batch_id": it.batch_id,
            "expiry_date": it.expiry_date,
            "sold_qty": ZERO, "paid": ZERO,
        })
        row["sold_qty"] += Decimal(it.qty or 0)
        row["paid"] += bill_total * w / total_w

    done = (await db.execute(
        select(invoice_item.product_id, func.coalesce(invoice_item.batch_no, ''), func.sum(invoice_item.qty), func.sum(invoice_item.total))
        .join(invoice, invoice.id == invoice_item.invoice_id)
        .where(invoice.ref_invoice_no == inv.invoice_no, invoice.status != "cancelled")
        .group_by(invoice_item.product_id, invoice_item.batch_no)
    )).all()
    returned = {(pid, (b or '').strip()): (Decimal(q or 0), Decimal(t or 0)) for pid, b, q, t in done}

    codes = {r["item_code"] for r in lines.values() if r["item_code"]}
    by_code = dict((await db.execute(select(product.item_code, product.id).where(product.item_code.in_(codes)))).all()) if codes else {}
    ho_bill = inv.invoice_no.startswith("INV-")

    out = []
    for (pid, b_no), row in lines.items():
        rq, rt = returned.get((pid, b_no), (ZERO, ZERO))
        out.append({
            **row,
            "expiry_date": str(row["expiry_date"]) if row["expiry_date"] else None,
            "paid": _two(row["paid"]),
            "unit_price": _two(row["paid"] / row["sold_qty"]) if row["sold_qty"] else ZERO,
            "returned_qty": rq,
            "refunded": rt,
            "returnable_qty": max(row["sold_qty"] - rq, ZERO),
            "ho_product_id": pid if ho_bill else by_code.get(row["item_code"]),
        })
    return out


async def lookup(db: AsyncSession, invoice_no: str) -> dict:
    inv = await _original(db, invoice_no)
    return {"invoice": inv, "lines": await returnable_lines(db, inv)}


# ─── Create / cancel ──────────────────────────────────────────────────────────

async def _next_cn_no(db: AsyncSession) -> str:
    prefix = f"{CN_PREFIX}{date.today().year}-"
    last = (await db.execute(
        select(func.max(invoice.invoice_no)).where(invoice.invoice_no.like(f"{prefix}%"))
    )).scalar()
    seq = int(last.rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


async def create_return(db: AsyncSession, data, user_id: Optional[int]) -> invoice:
    """data: invoice_no, items [{product_id, qty, batch_no?, batch_id?}], reason, refund_method, return_date."""
    if data.refund_method not in ("cash", "adjust"):
        raise ValueError("refund_method must be 'cash' or 'adjust'")
    orig = await _original(db, data.invoice_no, lock=True)  # serialises returns on one bill
    access.check_outlet(orig.outlet_id)
    shift_id = await shift_service.guard(db, orig.outlet_id, user_id, data.return_date or date.today())
    raw_lines = await returnable_lines(db, orig)
    lines_by_batch = {(l["product_id"], (l.get("batch_no") or "").strip()): l for l in raw_lines}
    lines_by_pid = {l["product_id"]: l for l in raw_lines}

    rows, totals = [], {"taxable_amt": ZERO, "cgst_amount": ZERO, "sgst_amount": ZERO, "igst_amount": ZERO, "total": ZERO}
    for req in data.items:
        qty = Decimal(str(req.qty))
        if qty <= 0:
            continue
        req_bno = (getattr(req, "batch_no", None) or "").strip()
        line = lines_by_batch.get((req.product_id, req_bno)) or lines_by_pid.get(req.product_id)
        if not line:
            raise ValueError(f"Product {req.product_id} is not on bill {orig.invoice_no}")
        if qty > line["returnable_qty"]:
            raise OverflowError(f"{line['name']}: only {line['returnable_qty']} returnable, asked {qty}")
        amount = refund_for(line["paid"], line["sold_qty"], line["returned_qty"], line["refunded"], qty)
        calc = split_gst(amount, line["gst_percent"], orig.is_interstate)
        for k in totals:
            totals[k] += calc[k]
        
        batch_no = getattr(req, "batch_no", None) or line.get("batch_no")
        batch_id = getattr(req, "batch_id", None) or line.get("batch_id")
        exp_d = line.get("expiry_date")
        exp_date_val = date.fromisoformat(exp_d) if exp_d and isinstance(exp_d, str) else exp_d

        rows.append(invoice_item(
            product_id=line["product_id"], item_code=line["item_code"], name=line["name"],
            qty=qty, unit=line["unit"], rate=_two(amount / qty), disc_val=ZERO, disc_type="₹",
            gst_percent=line["gst_percent"], hsn_code=line["hsn_code"],
            batch_no=batch_no, batch_id=batch_id, expiry_date=exp_date_val,
            **calc,
        ))
    if not rows:
        raise ValueError("Enter a return quantity for at least one item")

    total = totals["total"]
    adjusted = min(total, Decimal(orig.due_amount or 0)) if data.refund_method == "adjust" else ZERO
    total_gst = totals["cgst_amount"] + totals["sgst_amount"] + totals["igst_amount"]

    for attempt in range(3):
        cn = invoice(
            outlet_id=orig.outlet_id, invoice_no=await _next_cn_no(db), customer_id=orig.customer_id,
            invoice_type="return", invoice_date=data.return_date or date.today(), invoice_datetime=datetime.now(),
            subtotal=totals["taxable_amt"], discount=ZERO, taxable_amount=totals["taxable_amt"],
            cgst_amount=totals["cgst_amount"], sgst_amount=totals["sgst_amount"], igst_amount=totals["igst_amount"],
            total_gst=total_gst, cd_percent=ZERO, cd_amount=ZERO, total_amount=total, round_off=ZERO,
            paid_amount=total, due_amount=ZERO, payment_mode=data.refund_method, is_interstate=orig.is_interstate,
            notes=data.notes, status="paid", created_by=user_id,
            ref_invoice_no=orig.invoice_no, return_reason=data.reason,
            refund_method=data.refund_method, adjusted_amount=adjusted, shift_id=shift_id,
        )
        cn.items = rows
        try:
            async with db.begin_nested():
                db.add(cn)
                await db.flush()
            break
        except IntegrityError:  # number taken by a concurrent return; take the next one
            if attempt == 2:
                raise

    for r in rows:
        line_ref = lines_by_batch.get((r.product_id, (r.batch_no or "").strip())) or lines_by_pid.get(r.product_id)
        ho_pid = line_ref["ho_product_id"] if line_ref else None
        if ho_pid:  # line not in HO item master -> credit note only, no stock
            await _write_stock_ledger(
                db, ho_pid, "sale_return", r.qty, cn.id, "sales_return", orig.outlet_id,
                f"Credit note {cn.invoice_no} against {orig.invoice_no}" + (f" (Batch: {r.batch_no})" if r.batch_no else ""),
                user_id,
                batch_no=r.batch_no,
                batch_id=r.batch_id,
                expiry_date=r.expiry_date,
            )
            await _update_product_stock(db, ho_pid, r.qty)

            # Restore location batch stock
            if r.batch_id:
                await batch_service.record_batch_movement(
                    db=db,
                    batch_id=r.batch_id,
                    location_id=orig.outlet_id or 1,
                    qty_delta=r.qty,
                    movement_type="sale_return",
                    product_id=ho_pid,
                    allow_negative=True,
                )

    if adjusted:
        orig.due_amount = Decimal(orig.due_amount) - adjusted
        orig.status = bill_status(orig.due_amount, Decimal(orig.total_amount))

    if Decimal(orig.total_amount or 0) > 0:      # take back the points this share of the bill earned (and return redeemed ones)
        from app.services import loyalty_service
        await loyalty_service.reverse_bill(db, orig.id, user_id, share=min(total / Decimal(orig.total_amount), Decimal(1)),
                                           reason=f"Return {cn.invoice_no}", ref=cn.invoice_no)
    await db.commit()
    from app.services.auth_service import write_audit
    await write_audit(db=db, module="billing", action="create_credit_note", record_id=cn.id, record_no=cn.invoice_no,
                      description=f"Credit note {cn.invoice_no} for {total} against {orig.invoice_no} ({data.refund_method})",
                      user_id=user_id)
    return cn


async def cancel_return(db: AsyncSession, return_id: int, reason: str, user_id: Optional[int]) -> invoice:
    cn = (await db.execute(select(invoice).where(invoice.id == return_id).with_for_update())).scalar_one_or_none()
    if not cn or cn.invoice_type != "return" or not cn.invoice_no.startswith(CN_PREFIX):
        raise LookupError("Credit note not found (outlet returns are cancelled at the outlet)")
    if cn.status == "cancelled":
        return cn  # idempotent
    access.check_outlet(cn.outlet_id)
    await shift_service.guard(db, cn.outlet_id, user_id)
    posted = (await db.execute(
        select(stock_ledger.product_id, stock_ledger.qty)
        .where(stock_ledger.ref_id == cn.id, stock_ledger.txn_type == "sale_return")
    )).all()
    for pid, qty in posted:
        await _write_stock_ledger(db, pid, "sale_return_cancel", -qty, cn.id, "sales_return_cancel", cn.outlet_id,
                                  f"Cancel {cn.invoice_no}: {reason}", user_id)
        await _update_product_stock(db, pid, -qty)

    # Revert location batch stock
    cn_items = (await db.execute(select(invoice_item).where(invoice_item.invoice_id == cn.id))).scalars().all()
    for it in cn_items:
        if it.batch_id:
            await batch_service.record_batch_movement(
                db=db,
                batch_id=it.batch_id,
                location_id=cn.outlet_id or 1,
                qty_delta=-it.qty,
                movement_type="sale",
                product_id=it.product_id,
                allow_negative=True,
            )

    if cn.adjusted_amount:
        orig = (await db.execute(select(invoice).where(invoice.invoice_no == cn.ref_invoice_no).with_for_update())).scalar_one_or_none()
        if orig:
            orig.due_amount = Decimal(orig.due_amount) + Decimal(cn.adjusted_amount)
            orig.status = bill_status(orig.due_amount, Decimal(orig.total_amount))

    cn.status = "cancelled"
    await db.commit()
    from app.services.auth_service import write_audit
    await write_audit(db=db, module="billing", action="cancel_credit_note", record_id=cn.id, record_no=cn.invoice_no,
                      description=f"Credit note {cn.invoice_no} cancelled. Reason: {reason}", user_id=user_id)
    return cn


if __name__ == "__main__":
    # Bill 33719-style line: MRP 275 incl 5% GST, 13.75 discount -> paid 261.25
    c = split_gst(Decimal("261.25"), Decimal("5"), False)
    assert (c["taxable_amt"], c["cgst_amount"], c["sgst_amount"]) == (Decimal("248.81"), Decimal("6.22"), Decimal("6.22")), c
    assert split_gst(Decimal("118"), Decimal("18"), True)["igst_amount"] == Decimal("18.00")
    # Partial then final return pays out exactly what was paid
    paid, sold = Decimal("100"), Decimal("3")
    r1 = refund_for(paid, sold, Decimal("0"), Decimal("0"), Decimal("1"))
    r2 = refund_for(paid, sold, Decimal("1"), r1, Decimal("2"))
    assert (r1, r1 + r2) == (Decimal("33.33"), Decimal("100.00")), (r1, r2)
    assert [bill_status(Decimal(d), Decimal("100")) for d in ("0", "40", "100")] == ["paid", "partial", "unpaid"]
    print("ok")
