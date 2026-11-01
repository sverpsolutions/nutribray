"""
Billing Service — Phase 5
Handles: invoice CRUD, GST calc, stock ledger, invoice numbering, estimates
"""
from datetime import date, datetime
import json
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, func, update, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.invoice import (
    invoice, invoice_item, invoice_payment,
    stock_ledger, estimate, estimate_item,
)
from app.models.product import product as product_model
from app.models.outlet import outlet as outlet_model
from app.services import shift_service, batch_service, scheme_service, discount_service, loyalty_service
from app.core import access
from app.schemas.invoice import (
    invoice_create, payment_in,
    estimate_create, estimate_item_in, invoice_item_in,
)

# ─── Number Generators ────────────────────────────────────────────────────────

async def _next_invoice_no(db: AsyncSession, outlet_id: Optional[int]) -> str:
    """Generate invoice number: INV-YYYYMMDD-NNNN"""
    today = date.today().strftime("%Y%m%d")
    prefix = f"INV-{today}-"
    result = await db.execute(
        select(func.count()).select_from(invoice)
        .where(invoice.invoice_no.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    return f"{prefix}{count + 1:04d}"


async def _next_payment_no(db: AsyncSession) -> str:
    today = date.today().strftime("%Y%m%d")
    prefix = f"PAY-{today}-"
    result = await db.execute(
        select(func.count()).select_from(invoice_payment)
        .where(invoice_payment.payment_no.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    return f"{prefix}{count + 1:04d}"


async def _next_estimate_no(db: AsyncSession) -> str:
    today = date.today().strftime("%Y%m%d")
    prefix = f"EST-{today}-"
    result = await db.execute(
        select(func.count()).select_from(estimate)
        .where(estimate.estimate_no.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    return f"{prefix}{count + 1:04d}"


# ─── GST Calculation Helpers ──────────────────────────────────────────────────

def _two(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _calc_item(item_in, is_interstate: bool, cd_percent: Decimal = Decimal("0")):
    """
    Returns dict of computed fields for one invoice line item.
    GST rule: is_interstate=False → CGST+SGST; True → IGST only
    Bill-level CD (cash discount) comes off each line's taxable value BEFORE GST, so GST falls
    with it and, on GST-inclusive retail prices, the customer gets exactly cd% off the selling price.
    cd_taxable / cd_amount are the line's CD share (excl. / incl. GST); they are not item columns.
    """
    qty = item_in.qty
    rate = item_in.rate
    disc_val = item_in.disc_val
    disc_type = item_in.disc_type
    gst_pct = item_in.gst_percent

    gross = _two(qty * rate)

    if disc_type == "%":
        disc_amt = _two(gross * disc_val / Decimal("100"))
    else:
        disc_amt = _two(disc_val * qty)

    taxable = _two(gross - disc_amt)
    cd_taxable = _two(taxable * cd_percent / Decimal("100"))
    taxable -= cd_taxable
    half_gst = _two(gst_pct / Decimal("2"))

    if is_interstate:
        cgst_pct = Decimal("0.00")
        sgst_pct = Decimal("0.00")
        igst_pct = gst_pct
        cgst_amt = Decimal("0.00")
        sgst_amt = Decimal("0.00")
        igst_amt = _two(taxable * igst_pct / Decimal("100"))
    else:
        cgst_pct = half_gst
        sgst_pct = half_gst
        igst_pct = Decimal("0.00")
        cgst_amt = _two(taxable * cgst_pct / Decimal("100"))
        sgst_amt = _two(taxable * sgst_pct / Decimal("100"))
        igst_amt = Decimal("0.00")

    total = _two(taxable + cgst_amt + sgst_amt + igst_amt)

    return {
        "taxable_amt": taxable,
        "cgst_percent": cgst_pct,
        "sgst_percent": sgst_pct,
        "igst_percent": igst_pct,
        "cgst_amount": cgst_amt,
        "sgst_amount": sgst_amt,
        "igst_amount": igst_amt,
        "total": total,
        "cd_taxable": cd_taxable,
        "cd_amount": _two(cd_taxable * (1 + gst_pct / Decimal("100"))),
    }


def _calc_invoice_totals(items_data: list[dict]):
    """Aggregate item totals. CD is already inside each line (see _calc_item)."""
    subtotal     = sum(i["taxable_amt"] + i["cd_taxable"] for i in items_data)  # taxable before CD
    discount     = sum(
        (i["qty"] * i["rate"] * i["disc_val"] / Decimal("100")
         if i["disc_type"] == "%" else i["disc_val"] * i["qty"])
        for i in items_data
    )
    taxable      = sum(i["taxable_amt"] for i in items_data)
    cgst_amount  = sum(i["cgst_amount"] for i in items_data)
    sgst_amount  = sum(i["sgst_amount"] for i in items_data)
    igst_amount  = sum(i["igst_amount"] for i in items_data)
    total_gst    = _two(cgst_amount + sgst_amount + igst_amount)

    cd_amount    = _two(sum(i["cd_amount"] for i in items_data))  # what the customer saved, incl. GST
    total_amount = _two(taxable + total_gst)

    return {
        "subtotal":      _two(subtotal),
        "discount":      _two(discount),
        "taxable_amount": _two(taxable),
        "cgst_amount":   _two(cgst_amount),
        "sgst_amount":   _two(sgst_amount),
        "igst_amount":   _two(igst_amount),
        "total_gst":     total_gst,
        "cd_amount":     cd_amount,
        "total_amount":  total_amount,
    }


# ─── Stock Ledger ─────────────────────────────────────────────────────────────

async def _write_stock_ledger(
    db: AsyncSession,
    product_id: int,
    txn_type: str,
    qty: Decimal,
    ref_id: int,
    ref_type: str,
    outlet_id: Optional[int],
    notes: Optional[str],
    user_id: Optional[int],
    batch_no: Optional[str] = None,
    batch_id: Optional[int] = None,
    expiry_date: Optional[date] = None,
):
    entry = stock_ledger(
        product_id=product_id,
        txn_type=txn_type,
        qty=qty,
        ref_id=ref_id,
        ref_type=ref_type,
        outlet_id=outlet_id,
        notes=notes,
        created_by=user_id,
        batch_no=batch_no,
        batch_id=batch_id,
        expiry_date=expiry_date,
    )
    db.add(entry)


async def _negative_blocked(db: AsyncSession, outlet_id: Optional[int]) -> bool:
    """Outlet master rule wins (block / allow); 'company' or no outlet follows Company Settings."""
    company = bool((await db.execute(text("SELECT block_negative_stock FROM company_settings ORDER BY id LIMIT 1"))).scalar())
    if not outlet_id:
        return company
    rule = (await db.execute(text("SELECT negative_stock FROM outlets WHERE id = :o"), {"o": outlet_id})).scalar()
    return {"block": True, "allow": False}.get(rule, company)


async def _update_product_stock(db: AsyncSession, product_id: int, delta: Decimal, outlet_id: Optional[int] = None):
    """Add delta (negative = deduction) to products.stock_qty, and to the outlet's own stock row when outlet_id is
    given and the outlet has one (the figure the POS shows).

    Settings → Block negative inventory: a deduction may not take stock below zero — the outlet's stock when
    outlet_id is given, else company stock — unless the item is marked "Allow Neg. Stock". Every outflow
    (sale, transfer, purchase return …) comes through here, so this one guard covers them all. The product row
    is locked, so two counters cannot both sell the last unit."""
    if delta < 0 and await _negative_blocked(db, outlet_id):
        p = (await db.execute(text("SELECT name, stock_qty, allow_neg_stock FROM products WHERE id = :p FOR UPDATE"),
                              {"p": product_id})).one()
        if not p.allow_neg_stock:
            avail = p.stock_qty or Decimal("0")
            if outlet_id:
                at_outlet = (await db.execute(text("SELECT stock_qty FROM outlet_stock WHERE outlet_id = :o AND product_id = :p"),
                                              {"o": outlet_id, "p": product_id})).scalar()
                avail = avail if at_outlet is None else at_outlet
            if avail + delta < 0:
                raise HTTPException(400, f"Not enough stock for '{p.name}': available {avail.normalize():f}, needed {(-delta).normalize():f}. "
                                         "Negative stock is blocked for this outlet (Outlet Master / Company Settings).")
    await db.execute(
        update(product_model)
        .where(product_model.id == product_id)
        .values(stock_qty=product_model.stock_qty + delta)
    )
    if outlet_id:
        await db.execute(text("UPDATE outlet_stock SET stock_qty = stock_qty + :d, updated_at = NOW() "
                              "WHERE outlet_id = :o AND product_id = :p"), {"d": delta, "o": outlet_id, "p": product_id})


async def check_payment_modes(db: AsyncSession, modes, outlet_id: Optional[int], strict: bool = False):
    """Payment Mode Master: a deactivated mode, or one not allowed at this outlet, cannot be used on a new bill.
    Split payments (strict) must use a mode from the master; the single legacy payment_mode of older POS sync agents
    is still accepted when it is not in the master."""
    if strict:
        known = set((await db.execute(text("SELECT LOWER(code) FROM payment_modes"))).scalars().all())
        unknown = sorted({str(m or "").lower() for m in modes} - known)
        if unknown:
            raise HTTPException(400, f"Unknown payment mode: {', '.join(unknown)} (add it in Settings → Payment Modes).")
    bad = (await db.execute(text("""SELECT name FROM payment_modes WHERE LOWER(code) = ANY(:m)
        AND (NOT is_active OR (outlet_ids IS NOT NULL AND NOT (CAST(:o AS INT) = ANY(outlet_ids))) OR NOT ('SALE' = ANY(applies_to)))"""),
        {"m": [str(m or "").lower() for m in modes], "o": outlet_id})).scalars().all()
    if bad:
        raise HTTPException(400, f"Payment mode not allowed here: {', '.join(bad)} (Payment Mode Master).")


# ─── Invoice Service ──────────────────────────────────────────────────────────

async def create_invoice(
    db: AsyncSession,
    data: invoice_create,
    user_id: Optional[int],
) -> invoice:
    access.check_outlet(data.outlet_id)
    await access.check_products(db, [it.product_id for it in data.items])
    for p in data.payments:
        p.payment_mode = p.payment_mode.strip().lower()
    await check_payment_modes(db, [p.payment_mode for p in data.payments] if data.payments else [data.payment_mode], data.outlet_id,
                              strict=bool(data.payments))
    shift_id = await shift_service.guard(db, data.outlet_id, user_id, data.invoice_date)
    invoice_no = await _next_invoice_no(db, data.outlet_id)

    # build item rows + collect computed dicts for totalling
    item_rows = []
    items_data = []
    location_id = data.outlet_id or 1

    manual_item_disc = any((it.disc_val or 0) > 0 for it in data.items)   # before schemes merge into disc_val
    schemes = None
    if data.apply_schemes and data.items:
        modes = {p.payment_mode for p in data.payments} if data.payments else {data.payment_mode}
        pay_mode = "cash" if modes <= scheme_service.CASH_LIKE else next(iter(modes))
        schemes = await scheme_service.evaluate(
            db, customer_id=data.customer_id, outlet_id=data.outlet_id, payment_mode=pay_mode, bill_date=data.invoice_date,
            at=(data.invoice_datetime or datetime.now()).time(),
            items=[{"product_id": it.product_id, "qty": it.qty, "gst": it.gst_percent,
                    "rate": _two(it.rate * (1 + it.gst_percent / Decimal("100")))} for it in data.items])
        for it, dv in zip(data.items, schemes["line_disc_val"]):
            if dv > 0 and not (it.disc_type == "%" and it.disc_val > 0):  # a manual % discount wins over the scheme
                it.disc_type, it.disc_val = "₹", it.disc_val + dv
        for f in schemes["free_items"]:
            data.items.append(invoice_item_in(product_id=f["product_id"], name=f["name"], qty=f["qty"], rate=Decimal("0"),
                                              gst_percent=f["gst_percent"]))
        if schemes["applied"]:
            data.notes = ((data.notes + "\n") if data.notes else "") + "Schemes: " + ", ".join(
                f"{a['scheme_name']}" + (f" (-₹{a['discount']})" if a["discount"] > 0 else "") for a in schemes["applied"])

    for item_in in data.items:
        # Fetch product to check lifecycle status and batch tracking flags
        prod_q = await db.execute(select(product_model).where(product_model.id == item_in.product_id))
        prod_obj = prod_q.scalar_one_or_none()
        
        if not prod_obj:
            raise ValueError(f"Product ID {item_in.product_id} not found")
        
        if not prod_obj.allow_sale:
            raise ValueError(f"Item '{prod_obj.name}' is not allowed for sale (Status: {prod_obj.status})")
            
        if prod_obj.is_expired:
            raise ValueError(f"Item '{prod_obj.name}' has expired and cannot be sold")

        # Batch & FEFO Allocation
        if prod_obj.has_batch_tracking or prod_obj.is_batch_required:
            if item_in.batch_id:
                # Specific batch selected
                is_ok, reason = await batch_service.check_batch_sale_eligibility(
                    db=db,
                    batch_id=item_in.batch_id,
                    location_id=location_id,
                    qty_needed=item_in.qty,
                    prod_override_allow_expired=prod_obj.allow_expired_sale,
                )
                if not is_ok:
                    raise ValueError(f"Batch validation failed for '{prod_obj.name}': {reason}")
            else:
                # Auto FEFO allocation
                allocs, unallocated = await batch_service.allocate_fefo_batches(
                    db=db,
                    product_id=prod_obj.id,
                    location_id=location_id,
                    required_qty=item_in.qty,
                    allow_expired=prod_obj.allow_expired_sale,
                )
                if unallocated > Decimal("0") and not prod_obj.allow_neg_batch_stock:
                    raise ValueError(
                        f"Insufficient batch stock for '{prod_obj.name}'. Required: {item_in.qty}, Available in active batches: {item_in.qty - unallocated}"
                    )
                if allocs:
                    item_in.batch_id = allocs[0]["batch_id"]
                    item_in.batch_no = allocs[0]["batch_no"]
                    if allocs[0].get("exp_date"):
                        item_in.expiry_date = date.fromisoformat(allocs[0]["exp_date"])

        calc = _calc_item(item_in, data.is_interstate, data.cd_percent)
        row = invoice_item(
            product_id=item_in.product_id,
            item_code=item_in.item_code,
            name=item_in.name,
            qty=item_in.qty,
            pcs=item_in.pcs,
            unit=item_in.unit,
            rate=item_in.rate,
            disc_val=item_in.disc_val,
            disc_type=item_in.disc_type,
            gst_percent=item_in.gst_percent,
            hsn_code=item_in.hsn_code,
            challan_item_id=item_in.challan_item_id,
            batch_no=item_in.batch_no,
            batch_id=item_in.batch_id,
            expiry_date=item_in.expiry_date,
            **{k: v for k, v in calc.items() if not k.startswith("cd_")},
        )
        item_rows.append(row)
        items_data.append({**item_in.__dict__, **calc})

    totals = _calc_invoice_totals(items_data)
    if data.round_off:
        rounded = totals["total_amount"].quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        totals["round_off"] = rounded - totals["total_amount"]
        totals["total_amount"] = rounded

    if data.payments:
        paid = _two(sum(p.amount for p in data.payments))
        modes = {p.payment_mode for p in data.payments}
        data.payment_mode = modes.pop() if len(modes) == 1 else "split"
    else:
        paid = data.paid_amount
    if paid > totals["total_amount"] and not data.payments and paid - totals["total_amount"] <= Decimal("0.05"):
        paid = totals["total_amount"]  # paisa drift between screen and server rounding
    if paid > totals["total_amount"]:
        raise ValueError("Paid amount is more than the bill total")
    due  = _two(totals["total_amount"] - paid)
    status = "paid" if due <= Decimal("0") else ("partial" if paid > Decimal("0") else "unpaid")

    # discount control (server-side; the till cannot bypass it) and loyalty tender
    loyalty_amt = _two(sum((p.amount for p in data.payments if (p.payment_mode or "").lower() == "loyalty"), Decimal("0")))
    if (data.payment_mode or "").lower() == "loyalty" and not data.payments:
        loyalty_amt = paid
    breakdown, approval_used = None, None
    if data.invoice_type not in ("return", "credit_note"):
        scheme_amt = _two(sum((Decimal(str(a["discount"])) for a in schemes["applied"]), Decimal("0"))) if schemes else Decimal("0")
        bill_amt = _two(sum((i["cd_taxable"] for i in items_data), Decimal("0")))
        gross = sum((Decimal(str(i["qty"])) * Decimal(str(i["rate"])) for i in items_data), Decimal("0"))
        pct = ((totals["discount"] + bill_amt) / gross * 100).quantize(Decimal("0.01")) if gross > 0 else Decimal("0")
        used = {k for k, on in (("item", manual_item_disc), ("bill", data.cd_percent > 0), ("scheme", scheme_amt > 0), ("loyalty", loyalty_amt > 0)) if on}
        role = (await db.execute(text("SELECT role FROM users WHERE id = :u"), {"u": user_id})).scalar() or ""
        approval_used = await discount_service.enforce(db, used=used, pct=pct, outlet_id=data.outlet_id, role=role,
                                                       approval_no=data.discount_approval_no, invoice_no=invoice_no)
        breakdown = {"item": str(_two(totals["discount"] - scheme_amt)), "scheme": str(scheme_amt), "bill": str(bill_amt),
                     "loyalty": str(loyalty_amt), "pct": str(pct), "types": sorted(used)}

    inv = invoice(
        outlet_id=data.outlet_id,
        invoice_no=invoice_no,
        customer_id=data.customer_id,
        invoice_type=data.invoice_type,
        invoice_date=data.invoice_date,
        invoice_datetime=data.invoice_datetime,
        payment_mode=data.payment_mode,
        is_interstate=data.is_interstate,
        cd_percent=data.cd_percent,
        notes=data.notes,
        paid_amount=paid,
        due_amount=due,
        status=status,
        created_by=user_id,
        shift_id=shift_id,
        **totals,
    )
    inv.items = item_rows
    db.add(inv)
    await db.flush()  # get inv.id

    # stock ledger — write FIRST, then update qty and batch stock
    for item_in in data.items:
        await _write_stock_ledger(
            db=db,
            product_id=item_in.product_id,
            txn_type="sale",
            qty=-item_in.qty,          # negative = outgoing
            ref_id=inv.id,
            ref_type="invoice",
            outlet_id=data.outlet_id,
            notes=f"Invoice {invoice_no}" + (f" (Batch: {item_in.batch_no})" if item_in.batch_no else ""),
            user_id=user_id,
            batch_no=item_in.batch_no,
            batch_id=item_in.batch_id,
            expiry_date=item_in.expiry_date,
        )
        await _update_product_stock(db, item_in.product_id, -item_in.qty, data.outlet_id)

        if item_in.batch_id:
            await batch_service.record_batch_movement(
                db=db,
                batch_id=item_in.batch_id,
                location_id=location_id,
                qty_delta=-item_in.qty,
                movement_type="sale",
                product_id=item_in.product_id,
                allow_negative=False,
            )

    # record payment if paid_amount > 0
    parts = [(p.payment_mode, p.amount) for p in data.payments] or ([(data.payment_mode, paid)] if paid > Decimal("0") else [])
    for mode, amount in parts:
        db.add(invoice_payment(
            payment_no=await _next_payment_no(db),
            outlet_id=data.outlet_id,
            customer_id=data.customer_id,
            invoice_id=inv.id,
            amount=amount,
            payment_date=data.invoice_date,
            payment_mode=mode,
            created_by=user_id,
            shift_id=shift_id,
        ))
        await db.flush()  # next _next_payment_no must count this row

    if schemes and schemes["applied"]:
        await scheme_service.log_applied(db, invoice_id=inv.id, invoice_no=invoice_no, outlet_id=data.outlet_id,
                                         customer_id=data.customer_id, result=schemes, user_id=user_id)

    if breakdown is not None:
        await db.execute(text("UPDATE unit_wise_invoices SET discount_breakdown = CAST(:b AS JSONB), discount_approval_no = :a WHERE id = :i"),
                         {"b": json.dumps(breakdown), "a": approval_used, "i": inv.id})
    if loyalty_amt > 0:
        await loyalty_service.redeem(db, customer_id=data.customer_id, outlet_id=data.outlet_id, amount=loyalty_amt,
                                     bill_total=totals["total_amount"], invoice_id=inv.id, invoice_no=invoice_no, user_id=user_id)
    if data.invoice_type not in ("return", "credit_note", "proforma"):
        await loyalty_service.earn(db, customer_id=data.customer_id, outlet_id=data.outlet_id, on=data.invoice_date,
                                   lines=[(i["product_id"], i["total"]) for i in items_data], paid_by_points=loyalty_amt,
                                   invoice_id=inv.id, invoice_no=invoice_no, user_id=user_id)

    await db.commit()
    await db.refresh(inv)
    
    # Audit log
    from app.services.auth_service import write_audit
    await write_audit(
        db=db,
        module="billing",
        action="create_invoice",
        record_id=inv.id,
        record_no=inv.invoice_no,
        description=f"Invoice {inv.invoice_no} created for {totals['total_amount']}",
        user_id=user_id,
        user_name=None, # will be fetched in write_audit if missing or we can pass it if we have it
    )

    # reload with relationships
    result = await db.execute(
        select(invoice)
        .options(selectinload(invoice.items), selectinload(invoice.payments))
        .where(invoice.id == inv.id)
    )
    return result.scalar_one()


async def get_invoice(db: AsyncSession, invoice_id: int) -> Optional[invoice]:
    result = await db.execute(
        select(invoice)
        .options(selectinload(invoice.items), selectinload(invoice.payments))
        .where(invoice.id == invoice_id)
    )
    return result.scalar_one_or_none()


async def list_invoices(
    db: AsyncSession,
    customer_id: Optional[int] = None,
    status: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    page: int = 1,
    per_page: int = 25,
    outlet_id: Optional[int] = None,
):
    q = select(invoice).where(*access.outlet_where(invoice.outlet_id)).order_by(invoice.id.desc())
    if outlet_id:
        q = q.where(invoice.outlet_id == outlet_id)
    if customer_id:
        q = q.where(invoice.customer_id == customer_id)
    if status:
        q = q.where(invoice.status == status)
    if from_date:
        q = q.where(invoice.invoice_date >= from_date)
    if to_date:
        q = q.where(invoice.invoice_date <= to_date)

    total_res = await db.execute(select(func.count()).select_from(q.subquery()))
    total = total_res.scalar() or 0

    q = q.offset((page - 1) * per_page).limit(per_page)
    rows = await db.execute(q.add_columns(outlet_model.outlet_name).outerjoin(outlet_model, outlet_model.id == invoice.outlet_id))
    items = []
    for inv, outlet_name in rows.all():
        inv.outlet_name = outlet_name  # plain attribute for invoice_list_out, not a column
        inv.split = []
        items.append(inv)
    # split bills: attach per-mode amounts so the list can show "Cash 300 + UPI 200"
    by_id = {i.id: i for i in items if i.payment_mode == "split"}
    if by_id:
        pays = await db.execute(select(invoice_payment).where(invoice_payment.invoice_id.in_(by_id)).order_by(invoice_payment.id))
        for p in pays.scalars():
            by_id[p.invoice_id].split.append({"payment_mode": p.payment_mode, "amount": p.amount})
    return items, total


async def add_payment(
    db: AsyncSession,
    invoice_id: int,
    data: payment_in,
    user_id: Optional[int],
) -> invoice:
    inv = await db.get(invoice, invoice_id)
    if not inv:
        raise ValueError("Invoice not found")
    access.check_outlet(inv.outlet_id)
    if inv.status == "cancelled":
        raise ValueError("Cannot collect payment on a cancelled invoice")
    shift_id = await shift_service.guard(db, inv.outlet_id, user_id, data.payment_date)

    pay_no = await _next_payment_no(db)
    pay = invoice_payment(
        payment_no=pay_no,
        outlet_id=inv.outlet_id,
        customer_id=inv.customer_id,
        invoice_id=invoice_id,
        amount=data.amount,
        payment_date=data.payment_date,
        payment_mode=data.payment_mode,
        reference_no=data.reference_no,
        notes=data.notes,
        created_by=user_id,
        shift_id=shift_id,
    )
    db.add(pay)

    new_paid = _two(inv.paid_amount + data.amount)
    new_due  = _two(inv.total_amount - new_paid)
    new_status = "paid" if new_due <= Decimal("0") else "partial"

    inv.paid_amount = new_paid
    inv.due_amount  = new_due
    inv.status      = new_status

    await db.commit()
    await db.refresh(inv)

    from app.services.auth_service import write_audit
    await write_audit(
        db=db,
        module="billing",
        action="add_payment",
        record_id=inv.id,
        record_no=inv.invoice_no,
        description=f"Payment of {data.amount} added to invoice {inv.invoice_no}",
        user_id=user_id,
    )

    result = await db.execute(
        select(invoice)
        .options(selectinload(invoice.items), selectinload(invoice.payments))
        .where(invoice.id == invoice_id)
    )
    return result.scalar_one()


async def cancel_invoice(
    db: AsyncSession,
    invoice_id: int,
    reason: str,
    user_id: Optional[int],
) -> invoice:
    inv = await db.get(invoice, invoice_id)
    if not inv:
        raise ValueError("Invoice not found")
    access.check_outlet(inv.outlet_id)
    if inv.status == "cancelled":
        raise ValueError("Invoice already cancelled")
    await shift_service.guard(db, inv.outlet_id, user_id)

    # restore stock
    items_res = await db.execute(
        select(invoice_item).where(invoice_item.invoice_id == invoice_id)
    )
    for it in items_res.scalars().all():
        await _write_stock_ledger(
            db=db,
            product_id=it.product_id,
            txn_type="sale_cancel",
            qty=it.qty,               # positive = restoring
            ref_id=invoice_id,
            ref_type="invoice_cancel",
            outlet_id=inv.outlet_id,
            notes=f"Cancel {inv.invoice_no}: {reason}",
            user_id=user_id,
            batch_no=it.batch_no,
            batch_id=it.batch_id,
            expiry_date=it.expiry_date,
        )
        await _update_product_stock(db, it.product_id, it.qty, inv.outlet_id)

        if it.batch_id:
            await batch_service.record_batch_movement(
                db=db,
                batch_id=it.batch_id,
                location_id=inv.outlet_id or 1,
                qty_delta=it.qty,
                movement_type="sale_return",
                product_id=it.product_id,
                allow_negative=True,
            )

    inv.status = "cancelled"
    await loyalty_service.reverse_bill(db, inv.id, user_id, reason="Bill cancelled")
    await db.commit()
    await db.refresh(inv)

    from app.services.auth_service import write_audit
    await write_audit(
        db=db,
        module="billing",
        action="cancel_invoice",
        record_id=inv.id,
        record_no=inv.invoice_no,
        description=f"Invoice {inv.invoice_no} cancelled. Reason: {reason}",
        user_id=user_id,
    )

    return inv


# ─── Estimate Service ─────────────────────────────────────────────────────────

def _calc_estimate_item(item_in: estimate_item_in):
    gross    = _two(item_in.qty * item_in.rate)
    disc_amt = _two(item_in.discount)
    taxable  = _two(gross - disc_amt)
    tax_amt  = _two(taxable * item_in.tax_percent / Decimal("100"))
    total    = _two(taxable + tax_amt)
    return {"tax_amount": tax_amt, "total": total}


async def create_estimate(
    db: AsyncSession,
    data: estimate_create,
    user_id: Optional[int],
) -> estimate:
    est_no = await _next_estimate_no(db)
    item_rows = []
    subtotal = Decimal("0")
    total_discount = Decimal("0")
    total_tax = Decimal("0")
    total_amount = Decimal("0")

    for item_in in data.items:
        calc = _calc_estimate_item(item_in)
        row = estimate_item(
            product_id=item_in.product_id,
            item_code=item_in.item_code,
            description=item_in.description,
            qty=item_in.qty,
            unit=item_in.unit,
            rate=item_in.rate,
            discount=item_in.discount,
            tax_percent=item_in.tax_percent,
            cost_price=item_in.cost_price,
            **calc,
        )
        item_rows.append(row)
        gross = _two(item_in.qty * item_in.rate)
        subtotal       += gross
        total_discount += item_in.discount
        total_tax      += calc["tax_amount"]
        total_amount   += calc["total"]

    est = estimate(
        estimate_no=est_no,
        customer_id=data.customer_id,
        customer_name=data.customer_name,
        customer_mobile=data.customer_mobile,
        estimate_date=data.estimate_date,
        valid_until=data.valid_until,
        notes=data.notes,
        subtotal=_two(subtotal),
        total_discount=_two(total_discount),
        total_tax=_two(total_tax),
        total_amount=_two(total_amount),
        created_by=user_id,
    )
    est.items = item_rows
    db.add(est)
    await db.commit()
    await db.refresh(est)
    result = await db.execute(
        select(estimate)
        .options(selectinload(estimate.items))
        .where(estimate.id == est.id)
    )
    return result.scalar_one()


async def get_estimate(db: AsyncSession, est_id: int) -> Optional[estimate]:
    result = await db.execute(
        select(estimate)
        .options(selectinload(estimate.items))
        .where(estimate.id == est_id)
    )
    return result.scalar_one_or_none()


async def list_estimates(
    db: AsyncSession,
    customer_id: Optional[int] = None,
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 25,
):
    q = select(estimate).order_by(estimate.id.desc())
    if customer_id:
        q = q.where(estimate.customer_id == customer_id)
    if status:
        q = q.where(estimate.status == status)

    total_res = await db.execute(select(func.count()).select_from(q.subquery()))
    total = total_res.scalar() or 0

    q = q.offset((page - 1) * per_page).limit(per_page)
    rows = await db.execute(q)
    return rows.scalars().all(), total


async def convert_estimate_to_invoice(
    db: AsyncSession,
    est_id: int,
    payment_mode: str,
    paid_amount: Decimal,
    user_id: Optional[int],
) -> invoice:
    est = await get_estimate(db, est_id)
    if not est:
        raise ValueError("Estimate not found")
    if est.status != "pending":
        raise ValueError("Only pending estimates can be converted")

    # build invoice_create from estimate
    items = [
        invoice_item_in(
            product_id=it.product_id or 0,
            item_code=it.item_code,
            name=it.description,
            qty=it.qty,
            unit=it.unit,
            rate=it.rate,
            disc_val=it.discount,
            disc_type="₹",
            gst_percent=it.tax_percent,
        )
        for it in est.items
    ]

    from app.schemas.invoice import invoice_create as _ic
    day = await shift_service.open_day(db, 0)  # estimates are HO documents; invoice dated on the business day
    inv_data = _ic(
        customer_id=est.customer_id,
        invoice_date=day["business_date"] if day else est.estimate_date,
        payment_mode=payment_mode,
        paid_amount=paid_amount,
        items=items,
    )
    inv = await create_invoice(db, inv_data, user_id)

    # mark estimate as converted
    est.status = "converted"
    est.converted_to = inv.id
    await db.commit()
    return inv



if __name__ == "__main__":
    # CD self-check: python -m app.services.billing_service
    from types import SimpleNamespace as NS
    # Red Bull: 10 x Rs 325 incl. 40% GST, sent GST-exclusive like the POS does
    it = NS(qty=Decimal("10"), rate=Decimal("232.1429"), disc_val=Decimal("0"), disc_type="₹", gst_percent=Decimal("40"))
    near = lambda v, want: abs(v - Decimal(want)) <= Decimal("0.02")  # per-line GST rounding; round-off absorbs it
    assert near(_calc_item(it, False)["total"], "3250")
    c = _calc_item(it, False, Decimal("10"))
    t = _calc_invoice_totals([{**c, "qty": it.qty, "rate": it.rate, "disc_val": it.disc_val, "disc_type": it.disc_type}])
    assert near(t["total_amount"], "2925"), t           # 10% off selling price (was 3017.86: 10% off taxable)
    assert t["taxable_amount"] == Decimal("2089.29") and near(t["total_gst"], "835.71"), t  # GST falls too
    assert t["cd_amount"] == Decimal("325.00") and t["subtotal"] == Decimal("2321.43"), t
    print("ok")
