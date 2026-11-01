"""Purchase returns / debit notes (DN-HO-YYYY-NNNN) — goods sent back to a supplier.

Two modes (CHANGELOG v1.2.0-beta.2):
- against a GRN: qty limited to received - already returned; rate = GRN taxable
  per unit (incl. line + header discount); GRN due reduced by the debit note.
- direct (NCG default, PO optional): supplier + products; rate defaults to the
  product's purchase/cost price.
Rates are GST-exclusive (NCG PurchaseReturns): taxable = rate x qty, GST on top.
Stock leaves HO: stock_ledger 'purchase_return' (negative) + products.stock_qty.
HO stock is not enforced (it is not maintained yet); the screen warns instead.
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import CompanySetting
from app.models.invoice import stock_ledger
from app.models.party import supplier
from app.models.product import product
from app.models.purchase import purchase, purchase_item
from app.models.sync import unit_wise_purchase_return as pr, unit_wise_purchase_return_item as pr_item
from app.core import access
from app.services.billing_service import _write_stock_ledger, _update_product_stock
from app.services import batch_service

DN_PREFIX = "DN-HO-"
ZERO = Decimal("0")


def _two(v) -> Decimal:
    return Decimal(v).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ─── Pure calculations ────────────────────────────────────────────────────────

def gst_on(taxable: Decimal, gst_pct: Decimal, interstate: bool) -> dict:
    """GST added on top of a GST-exclusive taxable value."""
    taxable = _two(taxable)
    if interstate:
        igst = _two(taxable * gst_pct / 100)
        return {"taxable_amt": taxable, "cgst_percent": ZERO, "sgst_percent": ZERO, "igst_percent": gst_pct,
                "cgst_amount": ZERO, "sgst_amount": ZERO, "igst_amount": igst, "gst_amount": igst, "total": taxable + igst}
    half = _two(gst_pct / 2)
    cgst = _two(taxable * half / 100)
    return {"taxable_amt": taxable, "cgst_percent": half, "sgst_percent": half, "igst_percent": ZERO,
            "cgst_amount": cgst, "sgst_amount": cgst, "igst_amount": ZERO, "gst_amount": 2 * cgst, "total": taxable + 2 * cgst}


def taxable_for(line_taxable: Decimal, received: Decimal, returned_qty: Decimal, returned_taxable: Decimal, qty: Decimal) -> Decimal:
    """Taxable value for returning `qty`; the last units take exactly what is left."""
    if qty >= received - returned_qty:
        return _two(line_taxable) - returned_taxable
    return _two(line_taxable * qty / received)


def is_interstate(company_state: Optional[str], supplier_state: Optional[str]) -> bool:
    a, b = (company_state or "").strip().lower(), (supplier_state or "").strip().lower()
    return bool(a and b and a != b)


# ─── Lookups ──────────────────────────────────────────────────────────────────

async def _company_state(db: AsyncSession) -> Optional[str]:
    return (await db.execute(select(CompanySetting.company_state).limit(1))).scalar()


async def _grn(db: AsyncSession, purchase_no: str, lock: bool = False) -> purchase:
    stmt = select(purchase).where(purchase.purchase_no == purchase_no)
    if lock:
        stmt = stmt.with_for_update()
    g = (await db.execute(stmt)).scalar_one_or_none()
    if not g:
        raise LookupError(f"GRN {purchase_no} not found")
    if g.status == "cancelled":
        raise ValueError(f"GRN {purchase_no} is cancelled")
    access.check_outlet(g.outlet_id)
    return g


async def grn_lines(db: AsyncSession, g: purchase) -> list[dict]:
    items = (await db.execute(select(purchase_item).where(purchase_item.purchase_id == g.id))).scalars().all()
    line_sum = sum(Decimal(i.taxable_amt or 0) for i in items) or Decimal(1)
    header_factor = Decimal(g.taxable_amount or 0) / line_sum if g.taxable_amount else Decimal(1)  # spreads header discount

    # Group by (product_id, batch_no) so batches are individually returnable
    lines: dict[tuple, dict] = {}
    for it in items:
        k = (it.product_id, (it.batch_no or "").strip())
        row = lines.setdefault(k, {
            "product_id": it.product_id,
            "batch_no": it.batch_no,
            "batch_id": it.batch_id,
            "expiry_date": str(it.expiry_date) if it.expiry_date else None,
            "hsn_code": it.hsn_code,
            "unit": it.unit,
            "gst_percent": Decimal(it.gst_percent or 0),
            "received_qty": ZERO,
            "taxable": ZERO
        })
        row["received_qty"] += Decimal(it.qty or 0)
        row["taxable"] += Decimal(it.taxable_amt or 0) * header_factor

    done = (await db.execute(
        select(pr_item.product_id, func.coalesce(pr_item.batch_no, ''), func.sum(pr_item.qty), func.sum(pr_item.taxable_amt))
        .join(pr, pr.id == pr_item.prn_id)
        .where(pr.purchase_id == g.id, pr.status != "cancelled")
        .group_by(pr_item.product_id, pr_item.batch_no)
    )).all()
    returned = {(pid, (b or '').strip()): (Decimal(q or 0), Decimal(t or 0)) for pid, b, q, t in done}
    
    prod_ids = [row["product_id"] for row in lines.values()]
    prods = {p.id: p for p in (await db.execute(select(product).where(product.id.in_(prod_ids)))).scalars()} if prod_ids else {}

    out = []
    for (pid, b_no), row in lines.items():
        p = prods.get(pid)
        rq, rt = returned.get((pid, b_no), (ZERO, ZERO))
        out.append({
            **row,
            "taxable": _two(row["taxable"]),
            "name": p.name if p else f"#{pid}",
            "item_code": p.item_code if p else None,
            "hsn_code": row["hsn_code"] or (p.hsn_code if p else None),
            "rate": _two(row["taxable"] / row["received_qty"]) if row["received_qty"] else ZERO,
            "returned_qty": rq,
            "returned_taxable": rt,
            "returnable_qty": max(row["received_qty"] - rq, ZERO),
            "ho_stock": Decimal(p.stock_qty or 0) if p else ZERO,
        })
    return out


async def lookup_grn(db: AsyncSession, purchase_no: str) -> dict:
    g = await _grn(db, purchase_no)
    sup = await db.get(supplier, g.supplier_id) if g.supplier_id else None
    return {"grn": g, "supplier": sup, "lines": await grn_lines(db, g),
            "is_interstate": is_interstate(await _company_state(db), sup.state if sup else None)}


# ─── Create / cancel ──────────────────────────────────────────────────────────

async def _next_dn_no(db: AsyncSession) -> str:
    prefix = f"{DN_PREFIX}{date.today().year}-"
    last = (await db.execute(select(func.max(pr.prn_no)).where(pr.prn_no.like(f"{prefix}%")))).scalar()
    return f"{prefix}{(int(last.rsplit('-', 1)[1]) + 1 if last else 1):04d}"


async def create_return(db: AsyncSession, data, user_id: Optional[int]) -> pr:
    """data: purchase_no | supplier_id, items [{product_id, qty, rate?, batch_no?, batch_id?, expiry_date?}], reason, return_date, notes."""
    g = await _grn(db, data.purchase_no, lock=True) if data.purchase_no else None
    await access.check_products(db, [r.product_id for r in data.items])
    supplier_id = g.supplier_id if g else data.supplier_id
    sup = await db.get(supplier, supplier_id) if supplier_id else None
    if not sup:
        raise ValueError("Select a supplier (or a GRN)")
    inter = is_interstate(await _company_state(db), sup.state)

    rows = []
    if g:
        grn_items = await grn_lines(db, g)
        # Index by (product_id, batch_no) and fallback by product_id
        lines_by_batch = {(l["product_id"], (l.get("batch_no") or "").strip()): l for l in grn_items}
        lines_by_pid = {l["product_id"]: l for l in grn_items}

        for req in data.items:
            qty = Decimal(str(req.qty))
            req_bno = (req.batch_no or "").strip()
            l = lines_by_batch.get((req.product_id, req_bno)) or lines_by_pid.get(req.product_id)
            if not l:
                raise ValueError(f"Product {req.product_id} is not on GRN {g.purchase_no}")
            if qty > l["returnable_qty"]:
                raise OverflowError(f"{l['name']}: only {l['returnable_qty']} returnable, asked {qty}")
            taxable = taxable_for(l["taxable"], l["received_qty"], l["returned_qty"], l["returned_taxable"], qty)
            batch_id = req.batch_id or l.get("batch_id")
            batch_no = req.batch_no or l.get("batch_no")
            exp_date = req.expiry_date or (date.fromisoformat(l["expiry_date"]) if l.get("expiry_date") else None)
            rows.append((req.product_id, l["item_code"], l["name"], l["hsn_code"], l["unit"], qty, l["gst_percent"], taxable, batch_no, batch_id, exp_date))
    else:
        prods = {p.id: p for p in (await db.execute(select(product).where(product.id.in_([r.product_id for r in data.items])))).scalars()}
        for req in data.items:
            p = prods.get(req.product_id)
            if not p:
                raise LookupError(f"Product {req.product_id} not found")
            qty = Decimal(str(req.qty))
            rate = Decimal(str(req.rate)) if req.rate else Decimal(p.purchase_price or p.cost_price or 0)
            if rate <= 0:
                raise ValueError(f"{p.name}: enter a rate (no purchase/cost price on item master)")
            rows.append((p.id, p.item_code, p.name, p.hsn_code, p.unit, qty, Decimal(p.gst_percent or 0), _two(rate * qty), req.batch_no, req.batch_id, req.expiry_date))
    rows = [r for r in rows if r[5] > 0]
    if not rows:
        raise ValueError("Enter a return quantity for at least one item")

    items, tot = [], dict.fromkeys(("taxable_amt", "cgst_amount", "sgst_amount", "igst_amount", "gst_amount", "total"), ZERO)
    for pid, code, name, hsn, unit, qty, gst_pct, taxable, b_no, b_id, exp_d in rows:
        calc = gst_on(taxable, gst_pct, inter)
        for k in tot:
            tot[k] += calc[k]
        items.append(pr_item(
            product_id=pid, item_code=code, name=name, hsn_code=hsn, unit=unit, qty=qty,
            price=_two(taxable / qty), basic_amount=calc["taxable_amt"], gst_percent=gst_pct,
            batch_no=b_no, batch_id=b_id, expiry_date=exp_d,
            **calc
        ))

    adjusted = min(tot["total"], Decimal(g.due_amount or 0)) if g else ZERO
    for attempt in range(3):
        dn = pr(prn_no=await _next_dn_no(db), outlet_id=g.outlet_id if g else None, supplier_id=sup.id,
                purchase_id=g.id if g else None, ref_purchase_no=g.purchase_no if g else None,
                return_date=data.return_date or date.today(), is_interstate=inter,
                total_qty=sum(i.qty for i in items), taxable_amount=tot["taxable_amt"],
                cgst_amount=tot["cgst_amount"], sgst_amount=tot["sgst_amount"], igst_amount=tot["igst_amount"],
                total_gst=tot["gst_amount"], total_amount=tot["total"], adjusted_amount=adjusted,
                reason=data.reason, notes=data.notes, status="confirmed", created_by=user_id)
        try:
            async with db.begin_nested():
                db.add(dn)
                await db.flush()
            break
        except IntegrityError:  # number taken concurrently; take the next one
            if attempt == 2:
                raise
    for it in items:
        it.prn_id = dn.id
        db.add(it)
        await _write_stock_ledger(
            db, it.product_id, "purchase_return", -it.qty, dn.id, "purchase_return", dn.outlet_id,
            f"Debit note {dn.prn_no}" + (f" against {g.purchase_no}" if g else "") + (f" (Batch: {it.batch_no})" if it.batch_no else ""),
            user_id,
            batch_no=it.batch_no,
            batch_id=it.batch_id,
            expiry_date=it.expiry_date
        )
        await _update_product_stock(db, it.product_id, -it.qty)

        # Decrement Location-wise batch stock if batch specified
        if it.batch_id:
            await batch_service.record_batch_movement(
                db=db,
                batch_id=it.batch_id,
                location_id=dn.outlet_id or 1,
                qty_delta=-it.qty,
                movement_type="purchase_return",
                product_id=it.product_id,
                allow_negative=False,
            )

    if adjusted:
        g.due_amount = Decimal(g.due_amount) - adjusted

    await db.commit()
    from app.services.auth_service import write_audit
    await write_audit(db=db, module="purchases", action="create_debit_note", record_id=dn.id, record_no=dn.prn_no,
                      description=f"Debit note {dn.prn_no} for {dn.total_amount} to {sup.name}" + (f" against GRN {g.purchase_no}" if g else ""),
                      user_id=user_id)
    return dn


async def cancel_return(db: AsyncSession, return_id: int, reason: str, user_id: Optional[int]) -> pr:
    dn = (await db.execute(select(pr).where(pr.id == return_id).with_for_update())).scalar_one_or_none()
    if not dn or not dn.prn_no.startswith(DN_PREFIX):
        raise LookupError("Debit note not found (outlet PRNs are cancelled at the outlet)")
    access.check_outlet(dn.outlet_id)
    if dn.status == "cancelled":
        return dn
    
    # Revert stock ledger and master product stock
    posted = (await db.execute(select(stock_ledger.product_id, stock_ledger.qty)
                               .where(stock_ledger.ref_id == dn.id, stock_ledger.txn_type == "purchase_return"))).all()
    for pid, qty in posted:
        await _write_stock_ledger(db, pid, "purchase_return_cancel", -qty, dn.id, "purchase_return_cancel", dn.outlet_id,
                                  f"Cancel {dn.prn_no}: {reason}", user_id)
        await _update_product_stock(db, pid, -qty)

    # Revert location-wise batch stock
    pr_items = (await db.execute(select(pr_item).where(pr_item.prn_id == dn.id))).scalars().all()
    for it in pr_items:
        if it.batch_id:
            await batch_service.record_batch_movement(
                db=db,
                batch_id=it.batch_id,
                location_id=dn.outlet_id or 1,
                qty_delta=it.qty,
                movement_type="purchase",
                product_id=it.product_id,
            )

    if dn.adjusted_amount and dn.purchase_id:
        g = (await db.execute(select(purchase).where(purchase.id == dn.purchase_id).with_for_update())).scalar_one_or_none()
        if g:
            g.due_amount = Decimal(g.due_amount) + Decimal(dn.adjusted_amount)
    dn.status = "cancelled"
    await db.commit()
    from app.services.auth_service import write_audit
    await write_audit(db=db, module="purchases", action="cancel_debit_note", record_id=dn.id, record_no=dn.prn_no,
                      description=f"Debit note {dn.prn_no} cancelled. Reason: {reason}", user_id=user_id)
    return dn


if __name__ == "__main__":
    c = gst_on(Decimal("1000"), Decimal("18"), False)
    assert (c["cgst_amount"], c["sgst_amount"], c["total"]) == (Decimal("90.00"), Decimal("90.00"), Decimal("1180.00")), c
    assert gst_on(Decimal("1000"), Decimal("12"), True)["igst_amount"] == Decimal("120.00")
    t1 = taxable_for(Decimal("100"), Decimal("3"), ZERO, ZERO, Decimal("1"))
    t2 = taxable_for(Decimal("100"), Decimal("3"), Decimal("1"), t1, Decimal("2"))
    assert (t1, t1 + t2) == (Decimal("33.33"), Decimal("100.00"))
    assert is_interstate("Delhi", "Haryana") and not is_interstate("Delhi", " delhi ") and not is_interstate(None, "Haryana")
    print("ok")
