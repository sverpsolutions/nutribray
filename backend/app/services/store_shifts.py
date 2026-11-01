"""24-hour stores: fixed shift plan per store, day-end -> next day at midnight, automatic rollover safety net, shift monitor.

Default plan (IST):  Night 00:00-08:00 · Morning 08:00-16:00 · Evening 16:00-23:59, then day-end and the next business day.
Each cashier still opens / counts / closes their own shift (shift_service); this only names the slot, records its planned
end so Head Office sees overdue shifts, and keeps the store billing across midnight.

Rollover (only stores with auto_rollover on): if a 24-hour store's business day is still open AFTER midnight + grace, the
system closes it — open shifts closed at system figures, safe taken as expected (not counted), marked AUTO and sent for
review — and opens today's day so billing never stops. Every auto step is in the audit log and on the closing board.
"""
import logging
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import text

log = logging.getLogger("store_shifts")
DEFAULT_PLAN = [{"name": "Night", "start": "00:00", "end": "08:00"}, {"name": "Morning", "start": "08:00", "end": "16:00"},
                {"name": "Evening", "start": "16:00", "end": "23:59"}]
GRACE_MIN = 15


def now_ist() -> datetime:
    return datetime.utcnow() + timedelta(hours=5, minutes=30)


def _t(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def validate_plan(plan: list[dict]) -> list[dict]:
    """Slots must cover the day in order without gaps or overlaps (00:00 ... 23:59)."""
    if not plan:
        raise ValueError("Add at least one shift.")
    names = set()
    prev_end = None
    for i, s in enumerate(plan):
        if not s.get("name") or s["name"] in names:
            raise ValueError("Each shift needs a different name.")
        names.add(s["name"])
        st, en = _t(s["start"]), _t(s["end"])
        if en <= st:
            raise ValueError(f"{s['name']}: end must be after start (a 24-hour day ends at 23:59).")
        if i == 0 and st != time(0, 0):
            raise ValueError("The first shift must start at 00:00.")
        if prev_end and st != prev_end:
            raise ValueError(f"{s['name']} must start when the previous shift ends ({prev_end:%H:%M}).")
        prev_end = en
    if prev_end not in (time(23, 59), time(0, 0)):
        raise ValueError("The last shift must end at 23:59 (day-end).")
    return plan


def current_slot(plan: list[dict], at: datetime) -> dict:
    t = at.time()
    for s in plan:
        if _t(s["start"]) <= t < _t(s["end"]) or (s["end"] == "23:59" and t >= _t(s["start"])):
            return s
    return plan[-1]


def slot_end(business_date: date, slot: dict) -> datetime:
    return datetime.combine(business_date, _t(slot["end"])) + (timedelta(seconds=59) if slot["end"] == "23:59" else timedelta())


async def settings(db, outlet_id: int) -> dict:
    r = (await db.execute(text("SELECT operating_mode, shift_plan, auto_rollover FROM outlets WHERE id = :o"), {"o": outlet_id})).mappings().first()
    if not r:
        return {"operating_mode": "STANDARD", "shift_plan": None, "auto_rollover": False}
    return {"operating_mode": r["operating_mode"], "shift_plan": r["shift_plan"] or (DEFAULT_PLAN if r["operating_mode"] == "24H" else None),
            "auto_rollover": r["auto_rollover"]}


async def slot_for_open(db, outlet_id: int, business_day_id: int, business_date: date, requested: Optional[str]) -> tuple[str, Optional[datetime], int]:
    """Shift name, planned end and shift number for a new cashier shift. The number restarts at 1 every business day:
    24-hour stores use the slot position (Night 1, Morning 2, Evening 3); other stores count 1, 2, 3 … within the day."""
    st = await settings(db, outlet_id)
    if st["operating_mode"] != "24H":
        n = (await db.execute(text("SELECT COALESCE(MAX(shift_no), 0) + 1 FROM cashier_shifts WHERE business_day_id = :d"), {"d": business_day_id})).scalar()
        return requested or "General", None, n
    plan = st["shift_plan"]
    slot = next((s for s in plan if s["name"] == requested), None) or current_slot(plan, now_ist())
    return slot["name"], slot_end(business_date, slot), plan.index(slot) + 1


async def rollover(db, outlet_id: int, system_user) -> Optional[str]:
    """Midnight safety net for one 24-hour store. Returns what happened (None = nothing to do)."""
    from app.services import cash_service, day_close_service, shift_service
    today = now_ist().date()
    day = await shift_service.open_day(db, outlet_id)
    if day and day["business_date"] < today:
        checks = await day_close_service.checklist(db, dict(day))
        stop = [c for c in checks if c["blocking"] and c["key"] not in ("open_shifts", "pending_expenses")]
        if stop:   # draft bills: people must finish them; keep billing on the old date and show it on the board
            return f"blocked: {'; '.join(c['label'] for c in stop)}"
        expected = await cash_service.balance(db, "safe", outlet_id)
        try:
            await shift_service.day_close(db, day["id"], "AUTO day-end after midnight (24-hour store) — open shifts closed at system figures, "
                                          "safe not counted", True, system_user, Decimal(str(expected)), allow_pending_expenses=True)
        except ValueError as e:
            await db.rollback()
            return f"blocked: {e}"
        await db.execute(text("UPDATE business_days SET auto_closed = TRUE, review_status = 'SUBMITTED' WHERE id = :i"), {"i": day["id"]})
        await db.execute(text("UPDATE cashier_shifts SET auto_closed = TRUE WHERE business_day_id = :i AND close_remarks LIKE 'Auto-closed%'"),
                         {"i": day["id"]})
        await db.commit()
        day = None
    if not day:
        await shift_service.day_open(db, outlet_id, today, "AUTO day open at midnight (24-hour store)", system_user)
        return f"rolled over to {today}"
    return None


async def rollover_task():
    """Every minute: 24-hour stores with auto rollover, after midnight + grace."""
    import asyncio
    from app.core.database import async_session_factory
    from app.core.dependencies import current_user_dep
    await asyncio.sleep(60)
    while True:
        try:
            n = now_ist()
            if n.time() >= time(0, GRACE_MIN) or n.hour >= 1:
                async with async_session_factory() as db:
                    outlets = (await db.execute(text("""SELECT o.id FROM outlets o WHERE o.operating_mode = '24H' AND o.auto_rollover
                        AND COALESCE(o.is_active, TRUE) AND NOT EXISTS (SELECT 1 FROM business_days d WHERE d.outlet_id = o.id
                        AND d.business_date >= :t AND d.status = 'open')"""), {"t": n.date()})).scalars().all()
                    if outlets:
                        u = (await db.execute(text("SELECT id, username FROM users WHERE role IN ('admin','superadmin') AND status ORDER BY id LIMIT 1"))).first()
                        sysu = current_user_dep(u[0], "admin", f"system ({u[1]})")
                        for oid in outlets:
                            try:
                                r = await rollover(db, oid, sysu)
                                if r:
                                    log.info("outlet %s: %s", oid, r)
                            except Exception:
                                await db.rollback()
                                log.exception("rollover outlet %s", oid)
        except Exception:
            log.exception("rollover task")
        await asyncio.sleep(60)


async def monitor(db, outlet_ids: Optional[list[int]] = None) -> list[dict]:
    """Per store: mode, current slot, open shifts with planned end and overdue flag, last closed shift."""
    n = now_ist()
    rows = []
    for o in (await db.execute(text("""SELECT id, outlet_name, operating_mode, shift_plan, auto_rollover FROM outlets
            WHERE COALESCE(is_active, TRUE) AND (CAST(:ids AS INT[]) IS NULL OR id = ANY(:ids)) ORDER BY outlet_name"""), {"ids": outlet_ids})).mappings():
        plan = o["shift_plan"] or (DEFAULT_PLAN if o["operating_mode"] == "24H" else None)
        shifts = [dict(s) for s in (await db.execute(text("""SELECT s.id, s.shift_no, s.shift_name, s.status, s.opened_at, s.planned_end, s.closed_at, s.auto_closed,
            s.expected_cash, s.actual_cash, u.name AS cashier FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id
            JOIN business_days d ON d.id = s.business_day_id WHERE s.outlet_id = :o AND (s.status = 'open' OR d.status = 'open')
            ORDER BY s.opened_at"""), {"o": o["id"]})).mappings()]
        for s in shifts:
            s["overdue"] = s["status"] == "open" and s["planned_end"] is not None and n > s["planned_end"] + timedelta(minutes=GRACE_MIN)
        rows.append({"outlet_id": o["id"], "store": o["outlet_name"], "mode": o["operating_mode"], "auto_rollover": o["auto_rollover"],
                     "current_slot": current_slot(plan, n)["name"] if plan else None, "plan": plan, "shifts": shifts,
                     "overdue": any(s["overdue"] for s in shifts)})
    return rows


if __name__ == "__main__":
    validate_plan(DEFAULT_PLAN)
    for bad in ([{"name": "A", "start": "01:00", "end": "23:59"}], [{"name": "A", "start": "00:00", "end": "08:00"}, {"name": "B", "start": "09:00", "end": "23:59"}],
                [{"name": "A", "start": "00:00", "end": "20:00"}]):
        try:
            validate_plan(bad)
            raise AssertionError(bad)
        except ValueError:
            pass
    assert current_slot(DEFAULT_PLAN, datetime(2026, 10, 29, 0, 5))["name"] == "Night"
    assert current_slot(DEFAULT_PLAN, datetime(2026, 10, 29, 8, 0))["name"] == "Morning"
    assert current_slot(DEFAULT_PLAN, datetime(2026, 10, 29, 23, 59, 30))["name"] == "Evening"
    assert slot_end(date(2026, 10, 29), DEFAULT_PLAN[2]) == datetime(2026, 10, 29, 23, 59, 59)
    assert [DEFAULT_PLAN.index(current_slot(DEFAULT_PLAN, datetime(2026, 10, 29, h))) + 1 for h in (0, 9, 17)] == [1, 2, 3]
    print("store_shifts OK")
