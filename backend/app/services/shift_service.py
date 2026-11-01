"""
Business day + cashier shift control (ported from NCG Shifts / EmergencyDayClose).

Flow per outlet (outlet 0 = HO):
  Day Open (manager) -> Shift Open (cashier, opening float) -> billing stamps shift_id
  -> Shift Close (count drawer, reconcile every payment mode) -> Day Close (all shifts
  closed, totals frozen). Same-day reopen is allowed; older days stay final.

Money for a shift comes from unit_wise_payments (bill-time + later collections) stamped
with the shift; cash refunds come from cash credit notes stamped with the shift.
"""
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.auth_service import write_audit

ZERO = Decimal("0.00")
MANAGER_ROLES = ("superadmin", "admin", "manager")
CASHIER_ROLES = ("staff",)  # users.role has no "cashier"; billing staff must work inside their own shift
DENOMS = (500, 200, 100, 50, 20, 10, 5, 2, 1)
MODE = "LOWER(TRIM(p.payment_mode))"  # 'Cash ' and 'cash' are one drawer


def _two(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"))


def loc(outlet_id: Optional[int]) -> int:
    return outlet_id or 0


def _outlet_sql(col: str) -> str:
    return f"COALESCE({col}, 0) = :loc"


async def outlet_name(db: AsyncSession, outlet_id: int) -> str:
    if not outlet_id:
        return "Head Office"
    n = (await db.execute(text("SELECT outlet_name FROM outlets WHERE id = :i"), {"i": outlet_id})).scalar()
    return n or f"Outlet #{outlet_id}"


async def open_day(db: AsyncSession, outlet_id: int):
    return (await db.execute(text(
        "SELECT * FROM business_days WHERE outlet_id = :loc AND status = 'open'"), {"loc": outlet_id})).mappings().first()


async def open_shift_of(db: AsyncSession, user_id: int):
    return (await db.execute(text(
        "SELECT * FROM cashier_shifts WHERE cashier_id = :u AND status = 'open'"), {"u": user_id})).mappings().first()


# ── gate for billing actions ──────────────────────────────────────────────────

async def guard(db: AsyncSession, outlet_id: Optional[int], user_id: Optional[int],
                on_date: Optional[date] = None) -> Optional[int]:
    """Block money/stock-moving billing actions unless the outlet's business day is open.
    Cashiers also need their own open shift at that outlet. Returns the shift_id to stamp."""
    l = loc(outlet_id)
    day = await open_day(db, l)
    if not day:
        raise ValueError(f"Business day is not open for {await outlet_name(db, l)}. "
                         "A manager must do Day Open first (Billing → Day & Shift).")
    if on_date and on_date != day["business_date"]:
        raise ValueError(f"Open business day is {day['business_date']:%d-%m-%Y}; "
                         f"date {on_date:%d-%m-%Y} is not allowed")
    if not user_id:
        return None
    shift = await open_shift_of(db, user_id)
    role = (await db.execute(text("SELECT role FROM users WHERE id = :u"), {"u": user_id})).scalar()
    if role in CASHIER_ROLES:
        if not shift:
            raise ValueError("Open your cashier shift before billing (Billing → Day & Shift)")
        if shift["outlet_id"] != l:
            raise ValueError(f"Your shift is open at {await outlet_name(db, shift['outlet_id'])}, "
                             f"not {await outlet_name(db, l)}")
    return shift["id"] if shift and shift["outlet_id"] == l else None


# ── figures ───────────────────────────────────────────────────────────────────

async def shift_figures(db: AsyncSession, shift) -> dict:
    """Live system figures for a shift (what the drawer/wallets should hold)."""
    p = {"sid": shift["id"]}
    modes = {r.mode: _two(r.amt) for r in await db.execute(text(f"""
        SELECT {MODE} AS mode, SUM(p.amount) AS amt
        FROM unit_wise_payments p LEFT JOIN unit_wise_invoices i ON i.id = p.invoice_id
        WHERE p.shift_id = :sid AND (i.id IS NULL OR i.status <> 'cancelled')
        GROUP BY 1 HAVING SUM(p.amount) <> 0 ORDER BY 1"""), p)}
    inv = (await db.execute(text("""
        SELECT COUNT(*) FILTER (WHERE invoice_type <> 'return')                     AS bills,
               COALESCE(SUM(total_amount) FILTER (WHERE invoice_type <> 'return'), 0) AS sales,
               COALESCE(SUM(total_amount) FILTER (WHERE invoice_type = 'return'), 0)  AS returns,
               COALESCE(SUM(total_amount - adjusted_amount)
                        FILTER (WHERE invoice_type = 'return' AND refund_method = 'cash'), 0) AS cash_refunds,
               MIN(invoice_no) FILTER (WHERE invoice_type <> 'return') AS first_bill,
               MAX(invoice_no) FILTER (WHERE invoice_type <> 'return') AS last_bill
        FROM unit_wise_invoices WHERE shift_id = :sid AND status <> 'cancelled'"""), p)).mappings().one()
    # credit given = this shift's bills minus what was collected against them within the shift
    paid_in_shift = (await db.execute(text("""
        SELECT COALESCE(SUM(p.amount), 0) FROM unit_wise_payments p
        JOIN unit_wise_invoices i ON i.id = p.invoice_id
        WHERE p.shift_id = :sid AND i.shift_id = :sid AND i.status <> 'cancelled' AND i.invoice_type <> 'return'"""), p)).scalar()
    cash_in = modes.get("cash", ZERO)
    cash_refunds = _two(inv["cash_refunds"])
    from app.services import cash_service  # cash book: drawer pay-ins, expenses, pickups
    mv = await cash_service.drawer_moves(db, shift["id"])
    return {
        "modes": modes,  # system collection per payment mode
        "total_collected": _two(sum(modes.values(), ZERO)),
        "system_cash": cash_in,
        "cash_refunds": cash_refunds,
        "expected_cash": _two(Decimal(shift["opening_cash"]) + cash_in - cash_refunds
                              + mv["pay_in"] - mv["expenses"] - mv["pickups"]),
        "pay_ins": mv["pay_in"], "expenses": mv["expenses"], "pickups": mv["pickups"],
        "pending_expenses": mv["pending_expenses"],
        "total_bills": inv["bills"],
        "total_sales": _two(inv["sales"]),
        "total_returns": _two(inv["returns"]),
        "credit_sales": _two(Decimal(inv["sales"]) - Decimal(paid_in_shift)),
        "first_bill": inv["first_bill"], "last_bill": inv["last_bill"],
    }


def reconcile(fig: dict, actual: dict[str, Decimal]) -> dict:
    """Per-mode system vs actual. Cash is checked against the expected drawer (float + cash in - refunds)."""
    actual = {k.strip().lower(): _two(v) for k, v in actual.items()}
    system = {**fig["modes"], "cash": fig["expected_cash"]}
    rows = []
    for m in sorted(set(system) | set(actual), key=lambda m: (m != "cash", m)):
        s, a = system.get(m, ZERO), actual.get(m, ZERO)
        rows.append({"mode": m, "system": str(s), "actual": str(a), "diff": str(a - s)})
    diffs = [Decimal(r["diff"]) for r in rows]
    return {
        "mode_totals": rows,
        "actual_cash": actual.get("cash", ZERO),
        "diff_total": _two(sum(diffs, ZERO)),
        "short_amount": _two(-sum((d for d in diffs if d < 0), ZERO)),
        "excess_amount": _two(sum((d for d in diffs if d > 0), ZERO)),
    }


def count_denominations(den: dict) -> Decimal:
    return _two(sum(Decimal(str(int(den.get(str(d), 0) or 0) * d)) for d in DENOMS) + Decimal(str(den.get("coins", 0) or 0)))


async def day_figures(db: AsyncSession, day) -> dict:
    p = {"loc": day["outlet_id"], "d": day["business_date"], "day": day["id"]}
    inv = (await db.execute(text(f"""
        SELECT COUNT(*) FILTER (WHERE invoice_type <> 'return' AND status <> 'cancelled') AS bills,
               COUNT(*) FILTER (WHERE invoice_type <> 'return' AND status = 'cancelled')  AS cancelled,
               COALESCE(SUM(subtotal)      FILTER (WHERE invoice_type <> 'return' AND status <> 'cancelled'), 0) AS gross,
               COALESCE(SUM(discount + cd_amount) FILTER (WHERE invoice_type <> 'return' AND status <> 'cancelled'), 0) AS disc,
               COALESCE(SUM(total_gst)     FILTER (WHERE invoice_type <> 'return' AND status <> 'cancelled'), 0) AS gst,
               COALESCE(SUM(total_amount)  FILTER (WHERE invoice_type <> 'return' AND status <> 'cancelled'), 0) AS net,
               COALESCE(SUM(due_amount)    FILTER (WHERE invoice_type <> 'return' AND status <> 'cancelled'), 0) AS credit,
               COALESCE(SUM(total_amount)  FILTER (WHERE invoice_type = 'return' AND status <> 'cancelled'), 0)  AS returns,
               COALESCE(SUM(total_amount - adjusted_amount)
                        FILTER (WHERE invoice_type = 'return' AND refund_method = 'cash' AND status <> 'cancelled'), 0) AS cash_refunds
        FROM unit_wise_invoices WHERE invoice_date = :d AND {_outlet_sql('outlet_id')}"""), p)).mappings().one()
    modes = {r.mode: _two(r.amt) for r in await db.execute(text(f"""
        SELECT {MODE} AS mode, SUM(p.amount) AS amt
        FROM unit_wise_payments p LEFT JOIN unit_wise_invoices i ON i.id = p.invoice_id
        WHERE p.payment_date = :d AND {_outlet_sql('p.outlet_id')} AND (i.id IS NULL OR i.status <> 'cancelled')
        GROUP BY 1 HAVING SUM(p.amount) <> 0 ORDER BY 1"""), p)}
    shifts = [dict(r) for r in (await db.execute(text("""
        SELECT s.id, s.shift_no, s.shift_name, s.terminal_no, s.status, s.opened_at, s.closed_at, s.opening_cash,
               s.total_bills, s.total_sales, s.expected_cash, s.actual_cash, s.short_amount, s.excess_amount,
               u.name AS cashier_name
        FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id
        WHERE s.business_day_id = :day ORDER BY s.opened_at"""), p)).mappings()]
    closed = [s for s in shifts if s["status"] == "closed"]
    if inv["cash_refunds"]:  # NCG: refunds paid out of the drawer reduce the day's cash
        modes["cash"] = _two(modes.get("cash", ZERO) - Decimal(inv["cash_refunds"]))
    return {
        "total_bills": inv["bills"], "cancelled_bills": inv["cancelled"],
        "gross_sales": _two(inv["gross"]), "total_discount": _two(inv["disc"]), "total_gst": _two(inv["gst"]),
        "net_sales": _two(inv["net"]), "total_returns": _two(inv["returns"]), "total_credit": _two(inv["credit"]),
        "modes": modes, "total_collected": _two(sum(modes.values(), ZERO)), "total_cash": modes.get("cash", ZERO),
        "total_shortage": _two(sum((Decimal(s["short_amount"]) for s in closed), ZERO)),
        "total_excess": _two(sum((Decimal(s["excess_amount"]) for s in closed), ZERO)),
        "shifts": shifts,
        "open_shifts": [s for s in shifts if s["status"] == "open"],
    }


# ── actions ───────────────────────────────────────────────────────────────────

async def _audit(db, user, module, action, record_id, description):
    await write_audit(db=db, module=module, action=action, record_id=record_id, description=description,
                      user_id=user.user_id, user_name=user.username)


async def day_open(db: AsyncSession, outlet_id: int, business_date: date, remarks: Optional[str], user, allow_next_day: bool = False) -> dict:
    from datetime import timedelta
    from app.services.store_shifts import now_ist
    if business_date > now_ist().date() + timedelta(days=1 if allow_next_day else 0):   # 24-hour stores may open tomorrow from 23:30          # India date: the server clock is UTC (00:00-05:30 IST is still 'yesterday' there)
        raise ValueError("Business date cannot be in the future")
    name = await outlet_name(db, outlet_id)
    cur = await open_day(db, outlet_id)
    if cur:
        raise ValueError(f"Business day {cur['business_date']:%d-%m-%Y} is already open for {name}")
    last = (await db.execute(text("SELECT MAX(business_date) FROM business_days WHERE outlet_id = :loc"),
                             {"loc": outlet_id})).scalar()
    if last and business_date < last:
        raise ValueError(f"{name} already has business day {last:%d-%m-%Y}; cannot open an earlier date")
    try:
        new_id = (await db.execute(text("""
            INSERT INTO business_days (outlet_id, business_date, status, opened_by, opened_at, open_remarks)
            VALUES (:loc, :d, 'open', :u, NOW(), :r) RETURNING id"""),
            {"loc": outlet_id, "d": business_date, "u": user.user_id, "r": remarks})).scalar()
    except IntegrityError:
        await db.rollback()
        raise ValueError(f"Business day {business_date:%d-%m-%Y} was already opened for {name}"
                         + (" — use Reopen if it was closed today" if business_date == now_ist().date() else ""))
    await _audit(db, user, "day_shift", "day_open", new_id, f"Day open {business_date} at {name}")
    await db.commit()
    return await get_day(db, new_id)


async def day_reopen(db: AsyncSession, outlet_id: int, user, reason: str = "") -> dict:
    """Reopen the store's latest closed business day — through Approvals (DAY_REOPEN policy); a reason is required."""
    from app.services import approval_service, day_close_service
    day = await day_close_service.reopen_target(db, outlet_id)
    r = await approval_service.submit(db, request_type="DAY_REOPEN", user=user, reason=reason, outlet_id=outlet_id,
                                      payload={"day_id": day["id"], "outlet_id": outlet_id},
                                      summary=f"Reopen business day {day['business_date']:%d-%m-%Y} at {await outlet_name(db, outlet_id)}",
                                      ref_type="business_day", ref_id=day["id"], ref_no=str(day["business_date"]),
                                      old_value={"status": "closed"}, new_value={"status": "open"})
    await db.commit()
    if r["status"] == "APPROVED":
        return {**await get_day(db, day["id"]), "approval": r}
    return {"approval": r, "message": f"Reopen request {r['request_no']} sent for approval"}


async def day_close(db: AsyncSession, day_id: int, remarks: Optional[str], force: bool, user,
                    safe_counted: Optional[Decimal] = None, allow_pending_expenses: bool = False) -> dict:
    day = (await db.execute(text("SELECT * FROM business_days WHERE id = :i FOR UPDATE"), {"i": day_id})).mappings().first()
    if not day or day["status"] != "open":
        raise ValueError("Business day is not open")
    if safe_counted is None:
        raise ValueError("Count the cash in the safe and enter it to close the day")
    pending = (await db.execute(text("""
        SELECT COUNT(*) FROM cash_entries WHERE kind = 'expense' AND status = 'pending' AND outlet_id = :o"""),
        {"o": day["outlet_id"]})).scalar()
    if pending and not allow_pending_expenses:      # the midnight auto day-end leaves them pending for the next day
        raise ValueError(f"{pending} expense(s) are waiting for approval — approve or reject them first")
    from app.services import day_close_service
    checks = await day_close_service.checklist(db, dict(day))
    stop = [c for c in checks if c["blocking"] and c["key"] not in ("open_shifts", "pending_expenses")]
    if stop:
        raise ValueError("Finish these before closing: " + "; ".join(f"{c['label']}: {c['count']}" for c in stop))
    fig = await day_figures(db, day)
    if fig["open_shifts"]:
        names = ", ".join(f"{s['cashier_name']} (#{s['id']})" for s in fig["open_shifts"])
        if not force:
            raise ValueError(f"Close these shifts first: {names}")
        # emergency close: system figures are taken as counted, flagged in remarks
        for s in fig["open_shifts"]:
            shift = (await db.execute(text("SELECT * FROM cashier_shifts WHERE id = :i"), {"i": s["id"]})).mappings().one()
            sf = await shift_figures(db, shift)
            await _close_shift_row(db, shift, sf, {**sf["modes"], "cash": sf["expected_cash"]}, None,
                                   f"Auto-closed at day close by {user.username} (not counted)", user)
        fig = await day_figures(db, day)
    from app.services import cash_service
    safe = await cash_service.post_safe_count(db, day, safe_counted, user)
    await db.execute(text("""
        UPDATE business_days SET safe_expected = :safe_expected, safe_counted = :safe_counted,
          safe_variance = :safe_variance, status = 'closed', closed_by = :u, closed_at = NOW(), close_remarks = :r,
          total_bills = :total_bills, cancelled_bills = :cancelled_bills, gross_sales = :gross_sales,
          total_discount = :total_discount, total_gst = :total_gst, net_sales = :net_sales,
          total_returns = :total_returns, total_credit = :total_credit, total_collected = :total_collected,
          total_cash = :total_cash, mode_totals = CAST(:modes AS JSON),
          total_shortage = :total_shortage, total_excess = :total_excess
        WHERE id = :i"""), {
        **{k: v for k, v in fig.items() if k not in ("modes", "shifts", "open_shifts")},
        "modes": json.dumps({k: str(v) for k, v in fig["modes"].items()}),
        **safe, "u": user.user_id, "r": remarks, "i": day_id})
    await day_close_service.after_close(db, day_id, checks)
    await _audit(db, user, "day_shift", "day_close", day_id,
                 f"Day close {day['business_date']} at {await outlet_name(db, day['outlet_id'])}: net {fig['net_sales']}")
    await db.commit()
    return await get_day(db, day_id)


async def shift_open(db: AsyncSession, outlet_id: int, opening_cash: Decimal, shift_name: str,
                     terminal_no: Optional[str], remarks: Optional[str], user) -> dict:
    day = await open_day(db, outlet_id)
    if not day:
        raise ValueError(f"Business day is not open for {await outlet_name(db, outlet_id)}")
    if await open_shift_of(db, user.user_id):
        raise ValueError("You already have an open shift — close it first")
    if opening_cash < 0:
        raise ValueError("Opening cash cannot be negative")
    from app.services import cash_service
    if opening_cash > 0:  # the float comes out of the safe: check before creating the shift
        await cash_service._require_funds(db, "safe", outlet_id, opening_cash,
            f"Safe at {await outlet_name(db, outlet_id)} (record its opening balance as a Pay-in first)")
    from app.services.store_shifts import slot_for_open
    shift_name, planned_end, shift_no = await slot_for_open(db, outlet_id, day["id"], day["business_date"], shift_name)   # 24-hour stores: Night / Morning / Evening
    try:
        sid = (await db.execute(text("""
            INSERT INTO cashier_shifts (business_day_id, outlet_id, business_date, cashier_id, shift_name,
                                        terminal_no, status, opened_at, opening_cash, open_remarks, planned_end, shift_no)
            VALUES (:day, :loc, :d, :u, :n, :t, 'open', NOW(), :c, :r, :pe, :no) RETURNING id"""),
            {"pe": planned_end, "no": shift_no, "day": day["id"], "loc": outlet_id, "d": day["business_date"], "u": user.user_id,
             "n": shift_name or "General", "t": terminal_no, "c": opening_cash, "r": remarks})).scalar()
    except IntegrityError:
        await db.rollback()
        raise ValueError("You already have an open shift")
    await cash_service.post_float(db, sid, outlet_id, day["business_date"], opening_cash, user)
    await _audit(db, user, "day_shift", "shift_open", sid, f"Shift open with float {opening_cash}")
    await db.commit()
    return await get_shift(db, sid)


async def _close_shift_row(db, shift, fig, actual: dict, denominations: Optional[dict], remarks, user):
    if fig.get("pending_expenses"):
        raise ValueError(f"Shift #{shift['id']} has {fig['pending_expenses']} expense(s) waiting for approval — approve or reject first")
    rec = reconcile(fig, actual)
    await db.execute(text("""
        UPDATE cashier_shifts SET status = 'closed', closed_at = NOW(), closed_by = :u, close_remarks = :r,
          total_bills = :total_bills, total_sales = :total_sales, total_returns = :total_returns,
          cash_refunds = :cash_refunds, credit_sales = :credit_sales, system_cash = :system_cash,
          actual_cash = :actual_cash, expected_cash = :expected_cash, mode_totals = CAST(:mode_totals AS JSON),
          diff_total = :diff_total, short_amount = :short_amount, excess_amount = :excess_amount,
          denominations = CAST(:den AS JSON)
        WHERE id = :i"""), {
        **{k: fig[k] for k in ("total_bills", "total_sales", "total_returns", "cash_refunds", "credit_sales",
                               "system_cash", "expected_cash")},
        **rec, "mode_totals": json.dumps(rec["mode_totals"]), "den": json.dumps(denominations) if denominations else None,
        "u": user.user_id, "r": remarks, "i": shift["id"]})
    from app.services import cash_service
    await cash_service.post_shift_close(db, shift, rec["actual_cash"], user)
    await _audit(db, user, "day_shift", "shift_close", shift["id"],
                 f"Shift #{shift['id']} closed. Short {rec['short_amount']}, excess {rec['excess_amount']}")
    return rec


async def shift_close(db: AsyncSession, shift_id: int, actual: dict, denominations: Optional[dict],
                      remarks: Optional[str], user) -> dict:
    shift = (await db.execute(text("SELECT * FROM cashier_shifts WHERE id = :i FOR UPDATE"), {"i": shift_id})).mappings().first()
    if not shift or shift["status"] != "open":
        raise ValueError("Shift is not open")
    if shift["cashier_id"] != user.user_id and user.role not in MANAGER_ROLES:
        raise ValueError("Only the cashier or a manager can close this shift")
    if denominations:
        actual = {**actual, "cash": count_denominations(denominations)}
    if any(Decimal(str(v or 0)) < 0 for v in actual.values()):
        raise ValueError("Counted amounts cannot be negative")
    fig = await shift_figures(db, shift)
    if shift["cashier_id"] != user.user_id:
        remarks = f"[Closed by manager {user.username}] {remarks or ''}".strip()
    await _close_shift_row(db, shift, fig, actual, denominations, remarks, user)
    await db.commit()
    return await get_shift(db, shift_id)


# ── reads ─────────────────────────────────────────────────────────────────────

def _jsonable(row: dict) -> dict:
    return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in row.items()}


async def get_day(db: AsyncSession, day_id: int) -> dict:
    day = (await db.execute(text("""
        SELECT d.*, ou.name AS opened_by_name, cu.name AS closed_by_name
        FROM business_days d LEFT JOIN users ou ON ou.id = d.opened_by LEFT JOIN users cu ON cu.id = d.closed_by
        WHERE d.id = :i"""), {"i": day_id})).mappings().first()
    if not day:
        raise ValueError("Business day not found")
    out = dict(day)
    out["outlet_name"] = await outlet_name(db, day["outlet_id"])
    fig = await day_figures(db, day)
    out["shifts"], out["open_shifts"] = fig["shifts"], fig["open_shifts"]
    if day["status"] == "open":  # live; closed days keep their frozen snapshot
        from app.services import cash_service
        out["safe_balance"] = await cash_service.balance(db, "safe", day["outlet_id"])
        out["safe_expected_at_close"] = await cash_service.safe_expected_at_close(db, day)
        out.update({k: v for k, v in fig.items() if k not in ("shifts", "open_shifts")})
        out["mode_totals"] = {k: str(v) for k, v in fig["modes"].items()}
    out.pop("modes", None)
    return out


async def get_shift(db: AsyncSession, shift_id: int) -> dict:
    s = (await db.execute(text("""
        SELECT s.*, u.name AS cashier_name, cb.name AS closed_by_name
        FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id LEFT JOIN users cb ON cb.id = s.closed_by
        WHERE s.id = :i"""), {"i": shift_id})).mappings().first()
    if not s:
        raise ValueError("Shift not found")
    out = dict(s)
    out["outlet_name"] = await outlet_name(db, s["outlet_id"])
    # store address / phone / GSTIN for the printed report header (HO details are used when empty)
    o = (await db.execute(text("""
        SELECT address, city, state, pincode, store_phone, gst_number FROM outlets WHERE id = :i"""),
        {"i": s["outlet_id"]})).mappings().first()
    out["outlet"] = dict(o) if o else None
    fig = await shift_figures(db, s)
    out["first_bill"], out["last_bill"] = fig["first_bill"], fig["last_bill"]
    if s["status"] == "open":
        out["live"] = {**fig, "modes": {k: str(v) for k, v in fig["modes"].items()}}
    return out


async def suggested_opening(db: AsyncSession, outlet_id: int) -> Decimal:
    """NCG: carry forward the last closed shift's counted cash at this outlet."""
    v = (await db.execute(text("""
        SELECT actual_cash FROM cashier_shifts WHERE outlet_id = :loc AND status = 'closed'
        ORDER BY closed_at DESC LIMIT 1"""), {"loc": outlet_id})).scalar()
    return _two(v)


if __name__ == "__main__":
    # reconciliation self-check: python -m app.services.shift_service
    fig = {"modes": {"cash": Decimal("1500"), "upi": Decimal("800"), "mobikwik": Decimal("200")},
           "expected_cash": Decimal("2400.00")}  # float 1000 + cash 1500 - refund 100
    r = reconcile(fig, {"Cash": 2350, "upi": 800, "card": 50})
    by = {x["mode"]: x for x in r["mode_totals"]}
    assert [x["mode"] for x in r["mode_totals"]] == ["cash", "card", "mobikwik", "upi"], r
    assert by["cash"]["diff"] == "-50.00" and by["mobikwik"]["diff"] == "-200.00" and by["card"]["diff"] == "50.00"
    assert (r["short_amount"], r["excess_amount"], r["diff_total"]) == (Decimal("250.00"), Decimal("50.00"), Decimal("-200.00"))
    assert count_denominations({"500": 3, "100": 2, "10": 1, "coins": 4.5}) == Decimal("1714.50")
    print("ok")
