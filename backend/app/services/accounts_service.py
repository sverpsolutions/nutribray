"""
Accounts payable (SPS): bill entry on GRNs -> supplier payments (maker-checker) -> ledger / aging, plus bank book
and receivables aging.

GRN (unit_wise_purchases) is the payable; its due_amount is the single outstanding figure. It drops with
paid-at-GRN, debit notes (purchase_returns_service) and posted payment allocations below.

Controls
  * a GRN is payable only after its supplier bill is entered and verified (bill = GRN within Rs 1);
    a bigger difference makes it "disputed" until accounts accepts it with a reason or raises a debit note
  * the verifier is not the person who made the GRN; a supplier bill number can be booked once
  * a payment is created "pending" and posts only when a DIFFERENT accounts user approves it;
    pending allocations reserve the bill, so the same due cannot be paid twice
  * bank modes only, UTR / cheque no required and unique per bank account
  * void of a posted payment reverses its allocations (dues come back), with a reason
"""
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.auth_service import write_audit

ZERO = Decimal("0.00")
ACCOUNTS = ("superadmin", "admin")
MODES = ("neft", "rtgs", "imps", "upi", "cheque")
BILL_TOLERANCE = Decimal("1.00")
WALK_IN_ID = 1  # POS walk-in customer: cannot owe money; a due on it is unreconciled sync data, not a receivable


def _two(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"))


def _need_accounts(user, what: str):
    if user.role not in ACCOUNTS:
        raise ValueError(f"Only accounts (admin) can {what}")


async def _audit(db, user, action, rid, no, desc):
    await write_audit(db=db, module="accounts", action=action, record_id=rid, record_no=no, description=desc,
                      user_id=user.user_id, user_name=user.username)


async def _reserved(db, purchase_id: int, exclude_payment: Optional[int] = None) -> Decimal:
    """Amount + discount of allocations on PENDING payments: reserved, not yet off the due."""
    v = (await db.execute(text("""
        SELECT COALESCE(SUM(a.amount + a.discount), 0) FROM supplier_payment_allocations a
        JOIN supplier_payments p ON p.id = a.payment_id
        WHERE a.purchase_id = :g AND a.status = 'active' AND p.status = 'pending'
          AND (CAST(:x AS INT) IS NULL OR p.id <> :x)"""), {"g": purchase_id, "x": exclude_payment})).scalar()
    return _two(v)


# ── bill entry ────────────────────────────────────────────────────────────────

async def enter_bill(db: AsyncSession, user, purchase_id: int, bill_no: str, bill_date: date, bill_amount: Decimal,
                     attachment: Optional[str], remarks: Optional[str], accept_difference: bool = False) -> dict:
    _need_accounts(user, "verify supplier bills")
    g = (await db.execute(text("SELECT * FROM unit_wise_purchases WHERE id = :i FOR UPDATE"), {"i": purchase_id})).mappings().first()
    if not g:
        raise ValueError("GRN not found")
    if g["status"] == "cancelled":
        raise ValueError("GRN is cancelled")
    if g["bill_status"] == "verified":
        raise ValueError(f"Bill for {g['purchase_no']} is already verified")
    if g["created_by"] == user.user_id:
        raise ValueError("The person who made the GRN cannot verify its bill")
    bill_no = (bill_no or "").strip()
    if not bill_no or not attachment:
        raise ValueError("Supplier bill number and a copy of the bill are required")
    if bill_date > date.today():
        raise ValueError("Bill date cannot be in the future")
    dup = (await db.execute(text("""
        SELECT purchase_no FROM unit_wise_purchases WHERE supplier_id = :s AND UPPER(bill_no) = UPPER(:b) AND id <> :i"""),
        {"s": g["supplier_id"], "b": bill_no, "i": purchase_id})).scalar()
    if dup:
        raise ValueError(f"Bill {bill_no} of this supplier is already booked on {dup}")
    bill_amount = _two(bill_amount)
    diff = bill_amount - _two(g["total_amount"])
    if abs(diff) <= BILL_TOLERANCE:
        status = "verified"
    elif accept_difference:
        if not remarks or len(remarks.strip()) < 5:
            raise ValueError(f"Bill differs from GRN by Rs {diff:,.2f} — give the reason for accepting it")
        status = "verified"  # payable stays the GRN due (what was received); difference is on record
    else:
        status = "disputed"
    days = (await db.execute(text("SELECT COALESCE(credit_limit_days, 0) FROM suppliers WHERE id = :s"),
                             {"s": g["supplier_id"]})).scalar() or 0
    await db.execute(text("""
        UPDATE unit_wise_purchases SET bill_status = :st, bill_no = :b, bill_date = :d, bill_amount = :a,
          bill_attachment = :att, bill_remarks = :r, bill_verified_by = :u, bill_verified_at = NOW(), due_date = :due
        WHERE id = :i"""), {"st": status, "b": bill_no, "d": bill_date, "a": bill_amount, "att": attachment,
                           "r": remarks, "u": user.user_id, "due": bill_date + timedelta(days=int(days)), "i": purchase_id})
    await _audit(db, user, f"bill_{status}", purchase_id, g["purchase_no"],
                 f"Bill {bill_no} {bill_amount} vs GRN {g['total_amount']} (diff {diff}) -> {status}")
    await db.commit()
    return {"status": status, "difference": diff}


# ── payments ──────────────────────────────────────────────────────────────────

async def _check_allocations(db, supplier_id: int, allocations: list[dict], payment_amount: Decimal,
                             exclude_payment: Optional[int] = None) -> list[dict]:
    seen, out, cash = set(), [], ZERO
    for a in allocations:
        pid = int(a["purchase_id"])
        amt, disc = _two(a.get("amount")), _two(a.get("discount"))
        if pid in seen:
            raise ValueError("The same GRN is listed twice")
        seen.add(pid)
        if amt < 0 or disc < 0 or amt + disc <= 0:
            raise ValueError("Each bill line needs a positive amount or discount")
        g = (await db.execute(text("SELECT * FROM unit_wise_purchases WHERE id = :i FOR UPDATE"), {"i": pid})).mappings().first()
        if not g or g["supplier_id"] != supplier_id:
            raise ValueError(f"GRN #{pid} does not belong to this supplier")
        if g["bill_status"] != "verified":
            raise ValueError(f"{g['purchase_no']}: supplier bill is not verified yet ({g['bill_status']})")
        open_due = _two(g["due_amount"]) - await _reserved(db, pid, exclude_payment)
        if amt + disc > open_due:
            raise ValueError(f"{g['purchase_no']}: only Rs {open_due:,.2f} is open (incl. other pending payments)")
        cash += amt
        out.append({"purchase_id": pid, "amount": amt, "discount": disc, "purchase_no": g["purchase_no"]})
    if cash > payment_amount:
        raise ValueError(f"Bills take Rs {cash:,.2f} but the payment is only Rs {payment_amount:,.2f}")
    return out


async def create_payment(db: AsyncSession, user, supplier_id: int, bank_account_id: int, payment_date: date, mode: str,
                         reference_no: str, amount: Decimal, allocations: list[dict], remarks: Optional[str]) -> dict:
    _need_accounts(user, "make supplier payments")
    if mode not in MODES:
        raise ValueError("Supplier payments go through the bank (NEFT / RTGS / IMPS / UPI / cheque)")
    reference_no = (reference_no or "").strip()
    if not reference_no:
        raise ValueError("UTR / cheque number is required")
    if payment_date > date.today() and mode != "cheque":
        raise ValueError("Payment date cannot be in the future (except a post-dated cheque)")
    amount = _two(amount)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    if not (await db.execute(text("SELECT 1 FROM suppliers WHERE id = :s"), {"s": supplier_id})).scalar():
        raise ValueError("Supplier not found")
    if not (await db.execute(text("SELECT 1 FROM bank_accounts WHERE id = :b AND is_active"), {"b": bank_account_id})).scalar():
        raise ValueError("Select an active bank account")
    dup = (await db.execute(text("""
        SELECT payment_no FROM supplier_payments WHERE bank_account_id = :b AND mode = :m AND UPPER(reference_no) = UPPER(:r)
          AND status IN ('pending', 'posted')"""), {"b": bank_account_id, "m": mode, "r": reference_no})).scalar()
    if dup:
        raise ValueError(f"{mode.upper()} reference {reference_no} is already used on {dup}")
    allocs = await _check_allocations(db, supplier_id, allocations, amount)
    pid = (await db.execute(text("""
        INSERT INTO supplier_payments (supplier_id, bank_account_id, payment_date, mode, reference_no, amount, status, remarks, created_by)
        VALUES (:s, :b, :d, :m, :r, :a, 'pending', :rem, :u) RETURNING id"""),
        {"s": supplier_id, "b": bank_account_id, "d": payment_date, "m": mode, "r": reference_no, "a": amount,
         "rem": remarks, "u": user.user_id})).scalar()
    no = f"SPAY-{pid:06d}"
    await db.execute(text("UPDATE supplier_payments SET payment_no = :n WHERE id = :i"), {"n": no, "i": pid})
    for a in allocs:
        await db.execute(text("""
            INSERT INTO supplier_payment_allocations (payment_id, purchase_id, amount, discount, created_by)
            VALUES (:p, :g, :a, :d, :u)"""), {"p": pid, "g": a["purchase_id"], "a": a["amount"], "d": a["discount"], "u": user.user_id})
    await _audit(db, user, "payment_create", pid, no,
                 f"{no} {amount} to supplier {supplier_id} via {mode} {reference_no}; bills: "
                 + ", ".join(f"{a['purchase_no']} {a['amount']}+{a['discount']}" for a in allocs))
    await db.commit()
    return {"id": pid, "payment_no": no, "status": "pending"}


async def _apply(db, payment_id: int, sign: int):
    """sign=-1 takes allocations off the GRN dues (post); +1 puts them back (void)."""
    for a in (await db.execute(text("""
            SELECT purchase_id, amount, discount FROM supplier_payment_allocations WHERE payment_id = :p AND status = 'active'"""),
            {"p": payment_id})).mappings():
        g = (await db.execute(text("SELECT due_amount, paid_amount, total_amount FROM unit_wise_purchases WHERE id = :i FOR UPDATE"),
                              {"i": a["purchase_id"]})).mappings().one()
        due = _two(g["due_amount"]) + sign * (_two(a["amount"]) + _two(a["discount"]))
        if due < 0:
            raise ValueError("A bill would go below zero — it was settled elsewhere; reject this payment")
        paid = _two(g["paid_amount"]) - sign * _two(a["amount"])
        status = "paid" if due <= 0 else ("partial" if paid > 0 else "draft")
        await db.execute(text("UPDATE unit_wise_purchases SET due_amount = :d, paid_amount = :p, status = :s, updated_at = NOW() WHERE id = :i"),
                         {"d": due, "p": paid, "s": status, "i": a["purchase_id"]})


async def decide_payment(db: AsyncSession, user, payment_id: int, approve: bool, remarks: Optional[str]):
    _need_accounts(user, "approve supplier payments")
    p = (await db.execute(text("SELECT * FROM supplier_payments WHERE id = :i FOR UPDATE"), {"i": payment_id})).mappings().first()
    if not p or p["status"] != "pending":
        raise ValueError("Only pending payments can be approved or rejected")
    if p["created_by"] == user.user_id:
        raise ValueError("The person who made the payment cannot approve it")
    if approve:
        await _apply(db, payment_id, -1)
    elif not remarks:
        raise ValueError("Give a reason for rejecting")
    else:
        await db.execute(text("UPDATE supplier_payment_allocations SET status = 'reversed' WHERE payment_id = :p"), {"p": payment_id})
    st = "posted" if approve else "rejected"
    await db.execute(text("UPDATE supplier_payments SET status = :s, actioned_by = :u, actioned_at = NOW(), action_remarks = :r WHERE id = :i"),
                     {"s": st, "u": user.user_id, "r": remarks, "i": payment_id})
    await _audit(db, user, f"payment_{st}", payment_id, p["payment_no"], f"{p['payment_no']} {st}. {remarks or ''}")
    await db.commit()


async def void_payment(db: AsyncSession, user, payment_id: int, reason: str):
    _need_accounts(user, "void supplier payments")
    if not reason or len(reason.strip()) < 5:
        raise ValueError("Give a clear reason (e.g. cheque bounced, wrong supplier)")
    p = (await db.execute(text("SELECT * FROM supplier_payments WHERE id = :i FOR UPDATE"), {"i": payment_id})).mappings().first()
    if not p or p["status"] != "posted":
        raise ValueError("Only posted payments can be voided")
    await _apply(db, payment_id, +1)
    await db.execute(text("UPDATE supplier_payment_allocations SET status = 'reversed' WHERE payment_id = :p"), {"p": payment_id})
    await db.execute(text("UPDATE supplier_payments SET status = 'void', actioned_by = :u, actioned_at = NOW(), action_remarks = :r WHERE id = :i"),
                     {"u": user.user_id, "r": reason, "i": payment_id})
    await _audit(db, user, "payment_void", payment_id, p["payment_no"], f"{p['payment_no']} voided: {reason}")
    await db.commit()


async def allocate_advance(db: AsyncSession, user, payment_id: int, allocations: list[dict]):
    """Adjust the unallocated (advance) part of a posted payment against verified bills."""
    _need_accounts(user, "adjust supplier advances")
    p = (await db.execute(text("SELECT * FROM supplier_payments WHERE id = :i FOR UPDATE"), {"i": payment_id})).mappings().first()
    if not p or p["status"] != "posted":
        raise ValueError("Only posted payments can be adjusted")
    used = _two((await db.execute(text("""
        SELECT COALESCE(SUM(amount), 0) FROM supplier_payment_allocations WHERE payment_id = :p AND status = 'active'"""),
        {"p": payment_id})).scalar())
    allocs = await _check_allocations(db, p["supplier_id"], allocations, _two(p["amount"]) - used)
    for a in allocs:
        aid = (await db.execute(text("""
            INSERT INTO supplier_payment_allocations (payment_id, purchase_id, amount, discount, created_by)
            VALUES (:p, :g, :a, :d, :u) RETURNING id"""),
            {"p": payment_id, "g": a["purchase_id"], "a": a["amount"], "d": a["discount"], "u": user.user_id})).scalar()
        g = (await db.execute(text("SELECT due_amount, paid_amount FROM unit_wise_purchases WHERE id = :i"), {"i": a["purchase_id"]})).mappings().one()
        due, paid = _two(g["due_amount"]) - a["amount"] - a["discount"], _two(g["paid_amount"]) + a["amount"]
        await db.execute(text("UPDATE unit_wise_purchases SET due_amount = :d, paid_amount = :p, status = :s, updated_at = NOW() WHERE id = :i"),
                         {"d": due, "p": paid, "s": "paid" if due <= 0 else "partial", "i": a["purchase_id"]})
        await _audit(db, user, "advance_adjust", aid, p["payment_no"], f"{p['payment_no']} advance {a['amount']}+{a['discount']} -> {a['purchase_no']}")
    await db.commit()


# ── reports ───────────────────────────────────────────────────────────────────

DUE_EXPR = "COALESCE(g.due_date, g.invoice_date + COALESCE(s.credit_limit_days, 0))"


async def aging(db: AsyncSession, supplier_id: Optional[int] = None) -> list[dict]:
    rows = (await db.execute(text(f"""
        SELECT s.id AS supplier_id, s.name AS supplier_name,
          COALESCE(SUM(g.due_amount) FILTER (WHERE CURRENT_DATE <= {DUE_EXPR}), 0) AS not_due,
          COALESCE(SUM(g.due_amount) FILTER (WHERE CURRENT_DATE - {DUE_EXPR} BETWEEN 1 AND 30), 0) AS d30,
          COALESCE(SUM(g.due_amount) FILTER (WHERE CURRENT_DATE - {DUE_EXPR} BETWEEN 31 AND 60), 0) AS d60,
          COALESCE(SUM(g.due_amount) FILTER (WHERE CURRENT_DATE - {DUE_EXPR} BETWEEN 61 AND 90), 0) AS d90,
          COALESCE(SUM(g.due_amount) FILTER (WHERE CURRENT_DATE - {DUE_EXPR} > 90), 0) AS d90p,
          COALESCE(SUM(g.due_amount), 0) AS total,
          COALESCE(SUM(g.due_amount) FILTER (WHERE g.bill_status <> 'verified'), 0) AS unverified,
          (SELECT COALESCE(SUM(p.amount), 0) - COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a
                  JOIN supplier_payments p2 ON p2.id = a.payment_id
                  WHERE p2.supplier_id = s.id AND p2.status = 'posted' AND a.status = 'active'), 0)
             FROM supplier_payments p WHERE p.supplier_id = s.id AND p.status = 'posted') AS advance
        FROM suppliers s JOIN unit_wise_purchases g ON g.supplier_id = s.id AND g.status <> 'cancelled' AND g.due_amount > 0
        WHERE (CAST(:s AS INT) IS NULL OR s.id = :s)
        GROUP BY s.id, s.name ORDER BY total DESC"""), {"s": supplier_id})).mappings().all()
    return [dict(r) for r in rows]


async def ledger(db: AsyncSession, supplier_id: int, from_date: date, to_date: date) -> dict:
    """Supplier ledger: credit = we owe more (GRN), debit = we owe less (payment, discount, debit note)."""
    p = {"s": supplier_id, "fd": from_date, "td": to_date}
    lines_sql = """
        SELECT invoice_date AS d, created_at AS t, 'GRN' AS type, purchase_no AS ref, COALESCE(bill_no, invoice_no) AS doc,
               0::numeric AS debit, total_amount AS credit FROM unit_wise_purchases WHERE supplier_id = :s AND status <> 'cancelled'
        UNION ALL
        SELECT invoice_date, created_at, 'Paid at GRN', purchase_no, payment_mode, paid_amount - COALESCE((SELECT SUM(a.amount)
                 FROM supplier_payment_allocations a JOIN supplier_payments sp ON sp.id = a.payment_id
                 WHERE a.purchase_id = g.id AND a.status = 'active' AND sp.status = 'posted'), 0), 0
          FROM unit_wise_purchases g WHERE supplier_id = :s AND status <> 'cancelled'
        UNION ALL
        SELECT payment_date, created_at, 'Payment', payment_no, mode || ' ' || reference_no, amount, 0
          FROM supplier_payments WHERE supplier_id = :s AND status = 'posted'
        UNION ALL
        SELECT sp.payment_date, a.created_at, 'Discount', sp.payment_no, g.purchase_no, a.discount, 0
          FROM supplier_payment_allocations a JOIN supplier_payments sp ON sp.id = a.payment_id
          JOIN unit_wise_purchases g ON g.id = a.purchase_id
          WHERE sp.supplier_id = :s AND sp.status = 'posted' AND a.status = 'active' AND a.discount > 0
        UNION ALL
        SELECT return_date, created_at, 'Debit note', prn_no, ref_purchase_no, total_amount, 0
          FROM unit_wise_purchase_returns WHERE supplier_id = :s AND status <> 'cancelled'
    """
    opening = _two((await db.execute(text("SELECT COALESCE(opening_balance, 0) FROM suppliers WHERE id = :s"), p)).scalar())
    before = (await db.execute(text(f"SELECT COALESCE(SUM(credit - debit), 0) FROM ({lines_sql}) x WHERE d < :fd"), p)).scalar()
    rows = (await db.execute(text(f"SELECT * FROM ({lines_sql}) x WHERE d BETWEEN :fd AND :td AND (debit <> 0 OR credit <> 0) ORDER BY d, t"), p)).mappings().all()
    bal = opening + _two(before)
    out = []
    for r in rows:
        bal += _two(r["credit"]) - _two(r["debit"])
        out.append({**dict(r), "balance": bal})
    return {"opening": opening + _two(before), "lines": out, "closing": bal}


async def bank_book(db: AsyncSession, bank_account_id: int, from_date: date, to_date: date) -> dict:
    """Bank entries the system knows: opening + verified cash deposits - posted supplier payments."""
    acc = (await db.execute(text("SELECT * FROM bank_accounts WHERE id = :b"), {"b": bank_account_id})).mappings().first()
    if not acc:
        raise ValueError("Bank account not found")
    p = {"b": bank_account_id, "fd": from_date, "td": to_date, "od": acc["opening_date"] or date(2000, 1, 1)}
    lines_sql = """
        SELECT credited_date AS d, actioned_at AS t, 'Cash deposit' AS type, entry_no AS ref,
               COALESCE(bank_ref, '') || ' · ' || COALESCE(ref_no, '') AS doc, credited_amount AS receipt, 0::numeric AS payment
          FROM cash_entries WHERE kind = 'deposit' AND status = 'posted' AND to_ref = :b AND credited_date >= :od
        UNION ALL
        SELECT sp.payment_date, sp.actioned_at, 'Supplier payment', sp.payment_no, s.name || ' · ' || sp.mode || ' ' || sp.reference_no, 0, sp.amount
          FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id
          WHERE sp.bank_account_id = :b AND sp.status = 'posted' AND sp.payment_date >= :od
    """
    before = (await db.execute(text(f"SELECT COALESCE(SUM(receipt - payment), 0) FROM ({lines_sql}) x WHERE d < :fd"), p)).scalar()
    rows = (await db.execute(text(f"SELECT * FROM ({lines_sql}) x WHERE d BETWEEN :fd AND :td ORDER BY d, t"), p)).mappings().all()
    bal = _two(acc["opening_balance"]) + _two(before)
    opening = bal
    out = []
    for r in rows:
        bal += _two(r["receipt"]) - _two(r["payment"])
        out.append({**dict(r), "balance": bal})
    return {"account": dict(acc), "opening": opening, "lines": out, "closing": bal}


async def receivables(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(text("""
        SELECT c.id AS customer_id, c.name AS customer_name, c.phone, c.credit_limit, c.credit_days,
          COUNT(*) AS bills,
          COALESCE(SUM(i.due_amount) FILTER (WHERE CURRENT_DATE - i.invoice_date <= COALESCE(c.credit_days, 0)), 0) AS not_due,
          COALESCE(SUM(i.due_amount) FILTER (WHERE CURRENT_DATE - i.invoice_date - COALESCE(c.credit_days, 0) BETWEEN 1 AND 30), 0) AS d30,
          COALESCE(SUM(i.due_amount) FILTER (WHERE CURRENT_DATE - i.invoice_date - COALESCE(c.credit_days, 0) BETWEEN 31 AND 60), 0) AS d60,
          COALESCE(SUM(i.due_amount) FILTER (WHERE CURRENT_DATE - i.invoice_date - COALESCE(c.credit_days, 0) BETWEEN 61 AND 90), 0) AS d90,
          COALESCE(SUM(i.due_amount) FILTER (WHERE CURRENT_DATE - i.invoice_date - COALESCE(c.credit_days, 0) > 90), 0) AS d90p,
          COALESCE(SUM(i.due_amount), 0) AS total, MIN(i.invoice_date) AS oldest
        FROM unit_wise_invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.status <> 'cancelled' AND i.invoice_type <> 'return' AND i.due_amount > 0 AND c.id <> :walkin
        GROUP BY c.id ORDER BY total DESC"""), {"walkin": WALK_IN_ID})).mappings().all()
    return [dict(r) for r in rows]
