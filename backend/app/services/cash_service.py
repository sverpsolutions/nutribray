"""
Cash book: every rupee is always in exactly one custody and every move is a numbered entry.

Custodies (type, ref):  drawer(shift_id)  safe(outlet_id, 0 = HO)  person(user_id)  bank(bank_account_id)
Sinks / sources:        expense  outside  adjustment

Entry kinds and who does them
  float_out    safe -> drawer          auto at shift open (opening float)
  shift_close  drawer -> safe          auto at shift close (counted cash)
  pickup       drawer -> safe          manager, mid-shift skim
  expense      drawer|safe -> expense  cashier (own drawer) / manager (safe); above category limit -> pending approval
  pay_in       outside -> drawer|safe  cashier (own drawer) / manager (safe)
  handover     safe|person -> person|safe   pending (in transit) until the RECEIVER accepts
  deposit      safe|person -> bank     pending until HO accounts verifies against the bank statement
  adjustment   safe <-> adjustment     auto at day close from the physical safe count

Balance rule: IN counts only posted entries; OUT counts posted entries plus pending handovers/deposits
(the cash has physically left). Pending expenses are not paid until approved.
"""
import os
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.auth_service import write_audit
from app.services import shift_service as shifts

ZERO = Decimal("0.00")
MANAGERS = shifts.MANAGER_ROLES
ACCOUNTS = ("superadmin", "admin")  # verify bank deposits, void entries, accept into any safe
PREFIX = {"expense": "EXP", "pay_in": "PIN", "pickup": "PCK", "float_out": "FLT", "shift_close": "SCL",
          "handover": "HND", "deposit": "DEP", "adjustment": "ADJ"}
IN_TRANSIT = ("handover", "deposit")
UPLOAD_DIR = os.path.join("uploads", "cash")
ALLOWED_UPLOADS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}
MAX_UPLOAD = 5 * 1024 * 1024


def _two(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"))


# ── balances ──────────────────────────────────────────────────────────────────

async def lock(db: AsyncSession, ctype: str, ref: int):
    """Serialise postings against one custody so two people cannot spend the same cash."""
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"cash:{ctype}:{ref}"})


async def balance(db: AsyncSession, ctype: str, ref: int) -> Decimal:
    if ctype == "drawer":
        shift = (await db.execute(text("SELECT * FROM cashier_shifts WHERE id = :i"), {"i": ref})).mappings().first()
        return (await shifts.shift_figures(db, shift))["expected_cash"] if shift else ZERO
    v = (await db.execute(text("""
        SELECT COALESCE(SUM(amount) FILTER (WHERE to_type = :t AND to_ref = :r AND status = 'posted'), 0)
             - COALESCE(SUM(amount) FILTER (WHERE from_type = :t AND from_ref = :r
                    AND (status = 'posted' OR (status = 'pending' AND kind IN ('handover', 'deposit')))), 0)
        FROM cash_entries WHERE (to_type = :t AND to_ref = :r) OR (from_type = :t AND from_ref = :r)"""),
        {"t": ctype, "r": ref})).scalar()
    return _two(v)


async def drawer_moves(db: AsyncSession, shift_id: int) -> dict:
    """Cash-book moves that change a drawer besides sales (used by shift_service)."""
    r = (await db.execute(text("""
        SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'posted' AND to_type = 'drawer' AND kind = 'pay_in'), 0)    AS pay_in,
               COALESCE(SUM(amount) FILTER (WHERE status = 'posted' AND from_type = 'drawer' AND kind = 'expense'), 0) AS expenses,
               COALESCE(SUM(amount) FILTER (WHERE status = 'posted' AND from_type = 'drawer' AND kind = 'pickup'), 0)  AS pickups,
               COUNT(*) FILTER (WHERE status = 'pending' AND from_type = 'drawer' AND kind = 'expense')               AS pending
        FROM cash_entries WHERE (to_type = 'drawer' AND to_ref = :s) OR (from_type = 'drawer' AND from_ref = :s)"""),
        {"s": shift_id})).mappings().one()
    return {"pay_in": _two(r["pay_in"]), "expenses": _two(r["expenses"]), "pickups": _two(r["pickups"]),
            "pending_expenses": r["pending"]}


# ── posting ───────────────────────────────────────────────────────────────────

async def _post(db: AsyncSession, *, kind: str, outlet_id: int, business_date: date, from_type: str,
                from_ref: Optional[int], to_type: str, to_ref: Optional[int], amount: Decimal, user,
                status: str = "posted", shift_id: Optional[int] = None, category_id: Optional[int] = None,
                party: Optional[str] = None, ref_no: Optional[str] = None, description: Optional[str] = None,
                attachment: Optional[str] = None) -> dict:
    amount = _two(amount)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    eid = (await db.execute(text("""
        INSERT INTO cash_entries (kind, outlet_id, business_date, shift_id, from_type, from_ref, to_type, to_ref, amount,
                                  status, category_id, party, ref_no, description, attachment, created_by)
        VALUES (:kind, :outlet, :d, :shift, :ft, :fr, :tt, :tr, :amt, :st, :cat, :party, :ref, :desc, :att, :u)
        RETURNING id"""), {
        "kind": kind, "outlet": outlet_id, "d": business_date, "shift": shift_id, "ft": from_type, "fr": from_ref,
        "tt": to_type, "tr": to_ref, "amt": amount, "st": status, "cat": category_id, "party": party, "ref": ref_no,
        "desc": description, "att": attachment, "u": user.user_id})).scalar()
    no = f"{PREFIX[kind]}-{eid:06d}"
    await db.execute(text("UPDATE cash_entries SET entry_no = :n WHERE id = :i"), {"n": no, "i": eid})
    await write_audit(db=db, module="cash", action=kind, record_id=eid, record_no=no,
                      description=f"{no} {status} {amount} {from_type}:{from_ref} -> {to_type}:{to_ref}",
                      user_id=user.user_id, user_name=user.username)
    return {"id": eid, "entry_no": no, "status": status, "amount": amount}


async def _require_funds(db, ctype, ref, amount, label):
    await lock(db, ctype, ref)
    have = await balance(db, ctype, ref)
    if _two(amount) > have:
        raise ValueError(f"{label} has only ₹{have:,.2f}; cannot take out ₹{_two(amount):,.2f}")


async def _outlet_day(db, outlet_id: int):
    day = await shifts.open_day(db, outlet_id)
    if not day:
        raise ValueError(f"Business day is not open for {await shifts.outlet_name(db, outlet_id)}")
    return day


async def _my_drawer(db, user, outlet_id: int):
    s = await shifts.open_shift_of(db, user.user_id)
    if not s or s["outlet_id"] != outlet_id:
        raise ValueError(f"You need an open shift at {await shifts.outlet_name(db, outlet_id)} to use the drawer")
    return s


def _need_manager(user, what: str):
    if user.role not in MANAGERS:
        raise ValueError(f"Only a manager can {what}")


async def _category(db, cid: Optional[int], ctype: str):
    if not cid:
        raise ValueError("Select a category")
    c = (await db.execute(text("SELECT * FROM cash_categories WHERE id = :i AND type = :t AND is_active"),
                          {"i": cid, "t": ctype})).mappings().first()
    if not c:
        raise ValueError("Invalid category")
    return c


# shift hooks (called from shift_service inside its transaction)
async def post_float(db, shift_id: int, outlet_id: int, business_date: date, amount: Decimal, user):
    if _two(amount) <= 0:
        return
    await _require_funds(db, "safe", outlet_id, amount,
                         f"Safe at {await shifts.outlet_name(db, outlet_id)} (record its opening balance as a Pay-in first)")
    await _post(db, kind="float_out", outlet_id=outlet_id, business_date=business_date, shift_id=shift_id,
                from_type="safe", from_ref=outlet_id, to_type="drawer", to_ref=shift_id, amount=amount, user=user,
                description="Opening float")


async def post_shift_close(db, shift, counted: Decimal, user):
    if _two(counted) <= 0:
        return
    await lock(db, "safe", shift["outlet_id"])
    await _post(db, kind="shift_close", outlet_id=shift["outlet_id"], business_date=shift["business_date"],
                shift_id=shift["id"], from_type="drawer", from_ref=shift["id"], to_type="safe",
                to_ref=shift["outlet_id"], amount=counted, user=user, description=f"Shift #{shift['id']} counted cash")


# ── user actions ──────────────────────────────────────────────────────────────

async def expense(db, user, outlet_id: int, source: str, category_id: int, amount: Decimal, party: Optional[str],
                  ref_no: Optional[str], description: Optional[str], attachment: Optional[str]) -> dict:
    day = await _outlet_day(db, outlet_id)
    cat = await _category(db, category_id, "expense")
    if cat["requires_bill"] and not (ref_no and attachment):
        raise ValueError(f"'{cat['name']}' needs the bill number and a photo of the bill")
    if not party:
        raise ValueError("Enter who the money was paid to")
    if source == "drawer":
        s = await _my_drawer(db, user, outlet_id)
        ref, shift_id = s["id"], s["id"]
    elif source == "safe":
        _need_manager(user, "pay expenses from the safe")
        ref, shift_id = outlet_id, None
    else:
        raise ValueError("source must be drawer or safe")
    lim = cat["approval_limit"]
    needs_ok = lim is not None and _two(amount) > Decimal(lim)
    if not needs_ok:  # paid now -> must be covered now
        await _require_funds(db, source, ref, amount, "Drawer" if source == "drawer" else "Safe")
    r = await _post(db, kind="expense", outlet_id=outlet_id, business_date=day["business_date"], shift_id=shift_id,
                    from_type=source, from_ref=ref, to_type="expense", to_ref=None, amount=amount, user=user,
                    status="pending" if needs_ok else "posted", category_id=category_id, party=party,
                    ref_no=ref_no, description=description, attachment=attachment)
    await db.commit()
    return r


async def pay_in(db, user, outlet_id: int, target: str, category_id: int, amount: Decimal,
                 party: Optional[str], description: Optional[str]) -> dict:
    day = await _outlet_day(db, outlet_id)
    await _category(db, category_id, "pay_in")
    if not party:
        raise ValueError("Enter where the cash came from")
    if target == "drawer":
        s = await _my_drawer(db, user, outlet_id)
        ref, shift_id = s["id"], s["id"]
    elif target == "safe":
        _need_manager(user, "add cash to the safe")
        ref, shift_id = outlet_id, None
    else:
        raise ValueError("target must be drawer or safe")
    await lock(db, target, ref)
    r = await _post(db, kind="pay_in", outlet_id=outlet_id, business_date=day["business_date"], shift_id=shift_id,
                    from_type="outside", from_ref=None, to_type=target, to_ref=ref, amount=amount, user=user,
                    category_id=category_id, party=party, description=description)
    await db.commit()
    return r


async def pickup(db, user, shift_id: int, amount: Decimal, description: Optional[str]) -> dict:
    _need_manager(user, "pick up cash from a drawer")
    s = (await db.execute(text("SELECT * FROM cashier_shifts WHERE id = :i"), {"i": shift_id})).mappings().first()
    if not s or s["status"] != "open":
        raise ValueError("Shift is not open")
    if s["cashier_id"] == user.user_id:
        raise ValueError("A pickup must be done by a manager other than the cashier")
    await _require_funds(db, "drawer", shift_id, amount, "Drawer")
    await lock(db, "safe", s["outlet_id"])
    r = await _post(db, kind="pickup", outlet_id=s["outlet_id"], business_date=s["business_date"], shift_id=shift_id,
                    from_type="drawer", from_ref=shift_id, to_type="safe", to_ref=s["outlet_id"], amount=amount,
                    user=user, description=description or "Cash pickup to safe")
    await db.commit()
    return r


async def _source(db, user, src_type: str, src_ref: Optional[int], what: str):
    """Validate who may move cash out of a custody; returns (ref, outlet_id, business_date)."""
    if src_type == "safe":
        _need_manager(user, f"{what} from a safe")
        day = await _outlet_day(db, src_ref or 0)
        return src_ref or 0, src_ref or 0, day["business_date"]
    if src_type == "person":
        return user.user_id, 0, date.today()  # only your own cash
    raise ValueError("Cash can only move from a safe or from your own custody")


async def handover(db, user, src_type: str, src_ref: Optional[int], to_type: str, to_ref: int,
                   amount: Decimal, description: Optional[str]) -> dict:
    ref, outlet_id, bdate = await _source(db, user, src_type, src_ref, "hand over cash")
    if to_type == "person":
        ok = (await db.execute(text("SELECT status FROM users WHERE id = :u"), {"u": to_ref})).scalar()
        if not ok:
            raise ValueError("Receiver is not an active user")
        if to_ref == user.user_id:
            raise ValueError("You cannot hand over cash to yourself")
    elif to_type == "safe":
        if src_type == "safe" and to_ref == ref:
            raise ValueError("Source and destination safe are the same")
    else:
        raise ValueError("Handover goes to a person or a safe")
    await _require_funds(db, src_type, ref, amount, "Safe" if src_type == "safe" else "Your cash in hand")
    r = await _post(db, kind="handover", outlet_id=outlet_id, business_date=bdate, from_type=src_type, from_ref=ref,
                    to_type=to_type, to_ref=to_ref, amount=amount, user=user, status="pending", description=description)
    await db.commit()
    return r


async def deposit(db, user, src_type: str, src_ref: Optional[int], bank_account_id: int, amount: Decimal,
                  slip_no: Optional[str], deposit_date: date, attachment: Optional[str], description: Optional[str]) -> dict:
    if not slip_no or not attachment:
        raise ValueError("Deposit slip number and slip photo are required")
    if deposit_date > date.today():
        raise ValueError("Deposit date cannot be in the future")
    acc = (await db.execute(text("SELECT name FROM bank_accounts WHERE id = :i AND is_active"), {"i": bank_account_id})).scalar()
    if not acc:
        raise ValueError("Select an active bank account")
    dup = (await db.execute(text("""
        SELECT entry_no FROM cash_entries WHERE kind = 'deposit' AND to_ref = :b AND ref_no = :s
          AND status IN ('pending', 'posted')"""), {"b": bank_account_id, "s": slip_no.strip()})).scalar()
    if dup:
        raise ValueError(f"Slip {slip_no} is already used on {dup}")
    ref, outlet_id, bdate = await _source(db, user, src_type, src_ref, "deposit cash")
    await _require_funds(db, src_type, ref, amount, "Safe" if src_type == "safe" else "Your cash in hand")
    r = await _post(db, kind="deposit", outlet_id=outlet_id, business_date=bdate, from_type=src_type, from_ref=ref,
                    to_type="bank", to_ref=bank_account_id, amount=amount, user=user, status="pending",
                    party=acc, ref_no=slip_no.strip(), description=f"Deposited on {deposit_date:%d-%m-%Y}. {description or ''}".strip(),
                    attachment=attachment)
    await db.commit()
    return r


# ── second-person actions ─────────────────────────────────────────────────────

async def _entry(db, eid: int):
    e = (await db.execute(text("SELECT * FROM cash_entries WHERE id = :i FOR UPDATE"), {"i": eid})).mappings().first()
    if not e:
        raise ValueError("Entry not found")
    return e


async def _act(db, e, user, status: str, remarks: Optional[str], **extra):
    sets = ", ".join(f"{k} = :{k}" for k in extra)
    await db.execute(text(f"""
        UPDATE cash_entries SET status = :st, actioned_by = :u, actioned_at = NOW(), action_remarks = :r
        {', ' + sets if sets else ''} WHERE id = :i"""), {"st": status, "u": user.user_id, "r": remarks, "i": e["id"], **extra})
    await write_audit(db=db, module="cash", action=f"{e['kind']}_{status}", record_id=e["id"], record_no=e["entry_no"],
                      description=f"{e['entry_no']} -> {status}. {remarks or ''}", user_id=user.user_id, user_name=user.username)
    await db.commit()


async def decide_expense(db, user, eid: int, approve: bool, remarks: Optional[str]):
    e = await _entry(db, eid)
    if e["kind"] != "expense" or e["status"] != "pending":
        raise ValueError("Only pending expenses can be approved or rejected")
    _need_manager(user, "approve expenses")
    if e["created_by"] == user.user_id:
        raise ValueError("You cannot approve your own expense")
    if approve:
        if e["from_type"] == "drawer":
            st = (await db.execute(text("SELECT status FROM cashier_shifts WHERE id = :i"), {"i": e["from_ref"]})).scalar()
            if st != "open":
                raise ValueError("That shift is closed; reject this and raise it again from the safe")
        else:
            await _outlet_day(db, e["outlet_id"])
        await _require_funds(db, e["from_type"], e["from_ref"], e["amount"], "Drawer" if e["from_type"] == "drawer" else "Safe")
    elif not remarks:
        raise ValueError("Give a reason for rejecting")
    await _act(db, e, user, "posted" if approve else "rejected", remarks)


async def decide_handover(db, user, eid: int, accept: bool, remarks: Optional[str]):
    e = await _entry(db, eid)
    if e["kind"] != "handover" or e["status"] != "pending":
        raise ValueError("Only pending handovers can be accepted or rejected")
    if e["created_by"] == user.user_id:
        raise ValueError("The sender cannot accept or reject their own handover")
    if e["to_type"] == "person":
        if e["to_ref"] != user.user_id:
            raise ValueError("Only the receiver can accept this handover")
    else:  # into a safe: a manager of that outlet (or admin), with the outlet's day open
        urow = (await db.execute(text("SELECT outlet_id FROM users WHERE id = :u"), {"u": user.user_id})).scalar()
        if not (user.role in ACCOUNTS or (user.role in MANAGERS and (urow or 0) == e["to_ref"])):
            raise ValueError("Only a manager of the receiving location can accept into its safe")
        if accept:
            await _outlet_day(db, e["to_ref"])
            await lock(db, "safe", e["to_ref"])
    if not accept and not remarks:
        raise ValueError("Give a reason for rejecting")
    # accepting means the receiver counted the full amount; a different amount must be rejected and re-sent
    await _act(db, e, user, "posted" if accept else "rejected", remarks)


async def verify_deposit(db, user, eid: int, ok: bool, credited_amount: Optional[Decimal], bank_ref: Optional[str],
                         credited_date: Optional[date], remarks: Optional[str]):
    e = await _entry(db, eid)
    if e["kind"] != "deposit" or e["status"] != "pending":
        raise ValueError("Only deposits waiting for verification can be verified")
    if user.role not in ACCOUNTS:
        raise ValueError("Only accounts (admin) can verify bank deposits")
    if e["created_by"] == user.user_id:
        raise ValueError("The depositor cannot verify their own deposit")
    if not ok:
        if not remarks:
            raise ValueError("Give a reason (e.g. not found in bank statement)")
        await _act(db, e, user, "rejected", remarks)  # cash is back on the depositor's custody to explain
        return
    if credited_amount is None or not bank_ref or not credited_date:
        raise ValueError("Enter the credited amount, bank reference and credit date from the statement")
    credited = _two(credited_amount)
    if credited > e["amount"] or credited <= 0:
        raise ValueError("Credited amount must be more than 0 and not more than the deposit")
    if credited < e["amount"] and not remarks:
        raise ValueError(f"Bank credited ₹{e['amount'] - credited:,.2f} less — explain in remarks")
    await _act(db, e, user, "posted", remarks, credited_amount=credited, bank_ref=bank_ref.strip(), credited_date=credited_date)


async def cancel(db, user, eid: int, reason: str):
    """Creator withdraws a pending entry (before the other person acts)."""
    e = await _entry(db, eid)
    if e["status"] != "pending":
        raise ValueError("Only pending entries can be cancelled")
    if e["created_by"] != user.user_id:
        raise ValueError("Only the person who created it can cancel it")
    if not reason:
        raise ValueError("Give a reason")
    await _act(db, e, user, "cancelled", reason)


async def void(db, user, eid: int, reason: str):
    """Admin reverses a posted expense / pay-in / pickup on the same open business day. Everything else is final."""
    e = await _entry(db, eid)
    if user.role not in ACCOUNTS:
        raise ValueError("Only admin can void an entry")
    if e["status"] != "posted" or e["kind"] not in ("expense", "pay_in", "pickup"):
        raise ValueError("Only posted expenses, pay-ins and pickups can be voided")
    if not reason or len(reason.strip()) < 5:
        raise ValueError("Give a clear reason")
    day = await shifts.open_day(db, e["outlet_id"])
    if not day or day["business_date"] != e["business_date"]:
        raise ValueError("The business day of this entry is closed; it can no longer be voided")
    if e["shift_id"]:
        st = (await db.execute(text("SELECT status FROM cashier_shifts WHERE id = :i"), {"i": e["shift_id"]})).scalar()
        if st != "open":
            raise ValueError("The shift of this entry is closed; it can no longer be voided")
    holder = ("drawer", e["to_ref"]) if e["to_type"] == "drawer" else ("safe", e["to_ref"]) if e["to_type"] == "safe" else None
    if holder:  # voiding a pay-in/pickup takes cash back out of where it went
        await _require_funds(db, *holder, e["amount"], "Drawer" if holder[0] == "drawer" else "Safe")
    await _act(db, e, user, "void", reason)


# ── safe count at day close ───────────────────────────────────────────────────

async def post_safe_count(db, day, counted: Decimal, user) -> dict:
    await lock(db, "safe", day["outlet_id"])
    expected = await balance(db, "safe", day["outlet_id"])
    counted = _two(counted)
    if counted < 0:
        raise ValueError("Counted safe cash cannot be negative")
    diff = counted - expected
    if diff:
        await _post(db, kind="adjustment", outlet_id=day["outlet_id"], business_date=day["business_date"],
                    from_type="safe" if diff < 0 else "adjustment", from_ref=day["outlet_id"] if diff < 0 else None,
                    to_type="adjustment" if diff < 0 else "safe", to_ref=None if diff < 0 else day["outlet_id"],
                    amount=abs(diff), user=user,
                    description=f"Safe count at day close: expected {expected}, counted {counted} ({'short' if diff < 0 else 'excess'})")
    return {"safe_expected": expected, "safe_counted": counted, "safe_variance": _two(diff)}


async def safe_expected_at_close(db, day) -> Decimal:
    """Safe balance once every open shift of the day lands its expected cash (shown on Day Close)."""
    bal = await balance(db, "safe", day["outlet_id"])
    for s in (await db.execute(text("SELECT * FROM cashier_shifts WHERE business_day_id = :d AND status = 'open'"),
                               {"d": day["id"]})).mappings():
        bal += (await shifts.shift_figures(db, s))["expected_cash"]
    return _two(bal)


# ── uploads ───────────────────────────────────────────────────────────────────

def save_upload(content: bytes, content_type: str) -> str:
    ext = ALLOWED_UPLOADS.get(content_type)
    if not ext:
        raise ValueError("Upload a JPG, PNG, WEBP or PDF")
    if len(content) > MAX_UPLOAD:
        raise ValueError("File is larger than 5 MB")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    name = f"{datetime.now():%Y%m}-{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
        f.write(content)
    return f"/uploads/cash/{name}"
