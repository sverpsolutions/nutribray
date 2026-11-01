from datetime import date, time, timedelta
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core import access
from app.core.dependencies import get_current_user, require_role, current_user_dep
from app.services import shift_service as svc

router = APIRouter(prefix="/shifts", tags=["day & shift"])
manager = require_role(*svc.MANAGER_ROLES)


class day_open_in(BaseModel):
    outlet_id: int = 0
    business_date: date = Field(default_factory=date.today)
    remarks: Optional[str] = None


class day_close_in(BaseModel):
    remarks: Optional[str] = None
    safe_counted: Optional[Decimal] = Field(None, ge=0)  # physical count of the safe after all shifts are closed
    force: bool = False  # auto-close open shifts at system figures (emergency day close)


class shift_open_in(BaseModel):
    outlet_id: int = 0
    opening_cash: Decimal = Field(Decimal("0"), ge=0)
    shift_name: str = "General"
    terminal_no: Optional[str] = None
    remarks: Optional[str] = None


class shift_close_in(BaseModel):
    actual: dict[str, Decimal] = {}         # counted amount per payment mode
    denominations: Optional[dict] = None    # {"500": n, ..., "coins": x}; overrides actual["cash"]
    remarks: Optional[str] = None


async def _run(coro):
    try:
        return await coro
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/status")
async def status(outlet_id: int = Query(0), db: AsyncSession = Depends(get_db),
                 user: current_user_dep = Depends(get_current_user)):
    """What the POS / Day & Shift screen needs: the outlet's open day and my open shift."""
    day = await svc.open_day(db, outlet_id)
    mine = await svc.open_shift_of(db, user.user_id)
    last_closed = (await db.execute(text("""
        SELECT business_date FROM business_days WHERE outlet_id = :loc AND status = 'closed'
        ORDER BY business_date DESC LIMIT 1"""), {"loc": outlet_id})).scalar()
    return {
        "outlet_id": outlet_id,
        "outlet_name": await svc.outlet_name(db, outlet_id),
        "day": await svc.get_day(db, day["id"]) if day else None,
        "my_shift": await svc.get_shift(db, mine["id"]) if mine else None,
        "suggested_opening": await svc.suggested_opening(db, outlet_id),
        "last_closed_date": last_closed,
        "can_manage_day": user.role in svc.MANAGER_ROLES,
        **await _store_info(db, outlet_id),
    }


async def _store_info(db, outlet_id: int) -> dict:
    from app.services import store_shifts as ss
    st = await ss.settings(db, outlet_id)
    return {"operating_mode": st["operating_mode"], "shift_plan": st["shift_plan"], "auto_rollover": st["auto_rollover"],
            "current_slot": ss.current_slot(st["shift_plan"], ss.now_ist())["name"] if st["shift_plan"] else None,
            "today": ss.now_ist().date()}


@router.post("/day/open")
async def day_open(body: day_open_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(manager)):
    return await _run(svc.day_open(db, body.outlet_id, body.business_date, body.remarks, user))


@router.post("/day/reopen")
async def day_reopen(outlet_id: int = Query(0), reason: str = Query(..., min_length=5, max_length=300), db: AsyncSession = Depends(get_db),
                     user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.day_reopen(db, outlet_id, user, reason))


@router.get("/closing-board")
async def closing_board(business_date: Optional[date] = None, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    from app.services import day_close_service
    from app.services.mfg_stock_service import today
    return await day_close_service.board(db, business_date or today())


@router.get("/day/{day_id}/checklist")
async def day_checklist(day_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    from app.services import day_close_service
    day = (await db.execute(text("SELECT * FROM business_days WHERE id = :i"), {"i": day_id})).mappings().first()
    if not day:
        raise HTTPException(404, "Business day not found")
    access.check_outlet(day["outlet_id"])
    return await day_close_service.checklist(db, dict(day))


class review_in(BaseModel):
    note: Optional[str] = None


@router.post("/day/{day_id}/approve")
async def day_approve(day_id: int, b: review_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    from app.services import day_close_service
    return await day_close_service.review(db, day_id, "approve", b.note, user)


@router.post("/day/{day_id}/reject")
async def day_reject(day_id: int, b: review_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    from app.services import day_close_service
    return await day_close_service.review(db, day_id, "reject", b.note, user)


class closing_settings_in(BaseModel):
    closing_time: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    closing_review: bool = False


@router.put("/closing-settings/{outlet_id}")
async def closing_settings(outlet_id: int, b: closing_settings_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    access.check_outlet(outlet_id)
    await db.execute(text("UPDATE outlets SET closing_time = CAST(:t AS TIME), closing_review = :r WHERE id = :o"),
                     {"t": b.closing_time, "r": b.closing_review, "o": outlet_id})
    from app.services.auth_service import write_audit
    await write_audit(db=db, module="day_shift", action="closing_settings", record_id=outlet_id, record_no=str(outlet_id),
                      description=f"Closing time {b.closing_time or '-'}, review {'on' if b.closing_review else 'off'}",
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"success": True}


@router.get("/days")
async def list_days(outlet_id: Optional[int] = Query(None), from_date: Optional[date] = None, to_date: Optional[date] = None,
                    limit: int = Query(60, le=200), db: AsyncSession = Depends(get_db),
                    user: current_user_dep = Depends(get_current_user)):
    sp: dict = {}
    sf = access.outlet_filter("d.outlet_id", sp)
    rows = (await db.execute(text(f"""
        SELECT d.id, d.outlet_id, COALESCE(o.outlet_name, 'Head Office') AS outlet_name, d.business_date, d.status,
               d.opened_at, d.closed_at, ou.name AS opened_by_name, cu.name AS closed_by_name,
               d.total_bills, d.net_sales, d.total_collected, d.total_cash, d.total_shortage, d.total_excess
        FROM business_days d LEFT JOIN outlets o ON o.id = d.outlet_id
        LEFT JOIN users ou ON ou.id = d.opened_by LEFT JOIN users cu ON cu.id = d.closed_by
        WHERE (CAST(:loc AS INT) IS NULL OR d.outlet_id = :loc) {sf}
          AND (CAST(:fd AS DATE) IS NULL OR d.business_date >= :fd) AND (CAST(:td AS DATE) IS NULL OR d.business_date <= :td)
        ORDER BY d.business_date DESC, d.id DESC LIMIT :lim"""),
        {"loc": outlet_id, "fd": from_date, "td": to_date, "lim": limit, **sp})).mappings().all()
    return [dict(r) for r in rows]


@router.get("/day/{day_id}")
async def get_day(day_id: int, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.get_day(db, day_id))


@router.post("/day/{day_id}/close")
async def day_close(day_id: int, body: day_close_in, db: AsyncSession = Depends(get_db),
                    user: current_user_dep = Depends(manager)):
    return await _run(svc.day_close(db, day_id, body.remarks, body.force, user, body.safe_counted))


@router.post("/open")
async def shift_open(body: shift_open_in, db: AsyncSession = Depends(get_db),
                     user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.shift_open(db, body.outlet_id, body.opening_cash, body.shift_name,
                                     body.terminal_no, body.remarks, user))


@router.get("")
async def list_shifts(outlet_id: Optional[int] = Query(None), day_id: Optional[int] = None,
                      cashier_id: Optional[int] = None, from_date: Optional[date] = None, to_date: Optional[date] = None,
                      limit: int = Query(100, le=500), db: AsyncSession = Depends(get_db),
                      user: current_user_dep = Depends(get_current_user)):
    sp: dict = {}
    sf = access.outlet_filter("s.outlet_id", sp)
    rows = (await db.execute(text(f"""
        SELECT s.id, s.business_day_id, s.outlet_id, COALESCE(o.outlet_name, 'Head Office') AS outlet_name,
               s.business_date, s.shift_no, s.shift_name, s.terminal_no, s.status, s.opened_at, s.closed_at,
               u.name AS cashier_name, s.opening_cash, s.total_bills, s.total_sales,
               s.expected_cash, s.actual_cash, s.short_amount, s.excess_amount
        FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id LEFT JOIN outlets o ON o.id = s.outlet_id
        WHERE (CAST(:loc AS INT) IS NULL OR s.outlet_id = :loc) {sf} AND (CAST(:day AS INT) IS NULL OR s.business_day_id = :day)
          AND (CAST(:cid AS INT) IS NULL OR s.cashier_id = :cid)
          AND (CAST(:fd AS DATE) IS NULL OR s.business_date >= :fd) AND (CAST(:td AS DATE) IS NULL OR s.business_date <= :td)
        ORDER BY s.opened_at DESC LIMIT :lim"""),
        {"loc": outlet_id, "day": day_id, "cid": cashier_id, "fd": from_date, "td": to_date, "lim": limit, **sp})).mappings().all()
    return [dict(r) for r in rows]


# ── 24-hour stores: shift plan, day-end + next day, monitor ──────────────────
class slot_in(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class store_settings_in(BaseModel):
    outlet_ids: list[int] = Field(min_length=1)
    operating_mode: str = Field(pattern="^(STANDARD|24H)$")
    shift_plan: Optional[list[slot_in]] = None
    auto_rollover: bool = False
    closing_time: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    closing_review: Optional[bool] = None


@router.get("/store-settings")
async def store_settings(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    from app.services import store_shifts as ss
    p: dict = {}
    rows = (await db.execute(text(f"""SELECT id AS outlet_id, outlet_name AS store, operating_mode, shift_plan, auto_rollover, closing_time, closing_review
        FROM outlets WHERE COALESCE(is_active, TRUE) {access.outlet_filter('id', p)} ORDER BY outlet_name"""), p)).mappings().all()
    return [{**dict(r), "closing_time": r["closing_time"].strftime("%H:%M") if r["closing_time"] else None,
             "shift_plan": r["shift_plan"] or (ss.DEFAULT_PLAN if r["operating_mode"] == "24H" else None)} for r in rows]


@router.put("/store-settings")
async def save_store_settings(b: store_settings_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Set one or many stores (e.g. all 25) to 24-hour working with the same shift plan."""
    import json
    from app.services import store_shifts as ss
    plan = None
    if b.operating_mode == "24H":
        try:
            plan = ss.validate_plan([x.model_dump() for x in b.shift_plan] if b.shift_plan else ss.DEFAULT_PLAN)
        except ValueError as e:
            raise HTTPException(400, str(e))
    for oid in b.outlet_ids:
        access.check_outlet(oid)
        await db.execute(text("""UPDATE outlets SET operating_mode = CAST(:m AS VARCHAR), shift_plan = CAST(:p AS JSONB), auto_rollover = :a,
            closing_time = CASE WHEN CAST(:m AS VARCHAR) = '24H' THEN TIME '23:59' ELSE COALESCE(CAST(:ct AS TIME), closing_time) END,
            closing_review = COALESCE(CAST(:cr AS BOOLEAN), closing_review) WHERE id = :o"""),
            {"m": b.operating_mode, "p": json.dumps(plan) if plan else None, "a": b.auto_rollover and b.operating_mode == "24H",
             "ct": b.closing_time, "cr": b.closing_review, "o": oid})
    from app.services.auth_service import write_audit
    await write_audit(db=db, module="day_shift", action="store_shift_settings", record_id=0, record_no=f"{len(b.outlet_ids)} store(s)",
                      new_data=json.dumps({"mode": b.operating_mode, "plan": plan, "auto_rollover": b.auto_rollover, "stores": b.outlet_ids}),
                      description=f"{len(b.outlet_ids)} store(s) set to {b.operating_mode}" + (f" with shifts {', '.join(x['name'] for x in plan)}" if plan else ""),
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"updated": len(b.outlet_ids)}


class close_open_in(BaseModel):
    safe_counted: Decimal = Field(ge=0)
    remarks: Optional[str] = None


@router.post("/day/{day_id}/close-and-open")
async def close_and_open(day_id: int, b: close_open_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(manager)):
    """Day-end at 23:59 and the next business day opened straight away (24-hour stores)."""
    from app.services.store_shifts import now_ist
    day = (await db.execute(text("SELECT outlet_id, business_date FROM business_days WHERE id = :i"), {"i": day_id})).mappings().first()
    if not day:
        raise HTTPException(404, "Business day not found")
    access.check_outlet(day["outlet_id"])
    from app.services.store_shifts import settings as store_settings_of
    closed = await _run(svc.day_close(db, day_id, b.remarks, False, user, b.safe_counted))
    n = now_ist()
    nxt = max(day["business_date"] + timedelta(days=1), n.date())          # an older day closed late -> open today
    early = (await store_settings_of(db, day["outlet_id"]))["operating_mode"] == "24H" and n.time() >= time(23, 30)
    if nxt > n.date() and not early:
        return {"closed": closed, "next_day": None, "message": f"Day closed. Open {nxt:%d-%m-%Y} at 00:00."}
    opened = await _run(svc.day_open(db, day["outlet_id"], nxt, "Opened right after day-end", user, allow_next_day=early))
    return {"closed": closed, "next_day": opened}


@router.get("/monitor")
async def shift_monitor(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Head Office: every store's current shift slot, open shifts, overdue shifts."""
    from app.services import store_shifts as ss
    return await ss.monitor(db, access.allowed_outlets())


@router.get("/{shift_id}")
async def get_shift(shift_id: int, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.get_shift(db, shift_id))


@router.post("/{shift_id}/close")
async def shift_close(shift_id: int, body: shift_close_in, db: AsyncSession = Depends(get_db),
                      user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.shift_close(db, shift_id, body.actual, body.denominations, body.remarks, user))
