from datetime import date
from decimal import Decimal
from typing import Literal, Optional
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core import access
from app.core.dependencies import get_current_user, require_role, current_user_dep
from app.services import cash_service as svc, shift_service as shifts

router = APIRouter(prefix="/cash", tags=["cash book"])
admin = require_role(*svc.ACCOUNTS)
amount_field = Field(..., gt=0, le=10_000_000)


async def _run(coro):
    try:
        return await coro
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── inputs ────────────────────────────────────────────────────────────────────

class expense_in(BaseModel):
    outlet_id: int = 0
    source: Literal["drawer", "safe"]
    category_id: int
    amount: Decimal = amount_field
    party: str = Field(..., min_length=2, max_length=150)
    ref_no: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
    attachment: Optional[str] = None


class pay_in_in(BaseModel):
    outlet_id: int = 0
    target: Literal["drawer", "safe"]
    category_id: int
    amount: Decimal = amount_field
    party: str = Field(..., min_length=2, max_length=150)
    description: Optional[str] = None


class pickup_in(BaseModel):
    shift_id: int
    amount: Decimal = amount_field
    description: Optional[str] = None


class handover_in(BaseModel):
    from_type: Literal["safe", "person"]
    from_ref: Optional[int] = None          # outlet id for a safe; ignored for person (always you)
    to_type: Literal["person", "safe"]
    to_ref: int
    amount: Decimal = amount_field
    description: Optional[str] = None


class deposit_in(BaseModel):
    from_type: Literal["safe", "person"]
    from_ref: Optional[int] = None
    bank_account_id: int
    amount: Decimal = amount_field
    slip_no: str = Field(..., min_length=1, max_length=50)
    deposit_date: date = Field(default_factory=date.today)
    attachment: str
    description: Optional[str] = None


class decide_in(BaseModel):
    approve: bool
    remarks: Optional[str] = None


class verify_in(BaseModel):
    ok: bool
    credited_amount: Optional[Decimal] = None
    bank_ref: Optional[str] = Field(None, max_length=60)
    credited_date: Optional[date] = None
    remarks: Optional[str] = None


class reason_in(BaseModel):
    reason: str = Field(..., min_length=3)


class category_in(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    type: Literal["expense", "pay_in"]
    approval_limit: Optional[Decimal] = Field(None, ge=0)
    requires_bill: bool = False
    is_active: bool = True
    sort_order: int = 0


class bank_in(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    bank_name: str = Field(..., min_length=2, max_length=100)
    account_no: str = Field(..., min_length=4, max_length=30)
    ifsc: Optional[str] = Field(None, pattern=r"^[A-Z]{4}0[A-Z0-9]{6}$")
    branch: Optional[str] = None
    is_active: bool = True
    opening_balance: Decimal = Decimal("0")       # bank book starts here
    opening_date: Optional[date] = None


# ── reads ─────────────────────────────────────────────────────────────────────

ENTRY_SQL = """
    SELECT e.*, c.name AS category_name, cu.name AS created_by_name, au.name AS actioned_by_name,
           COALESCE(o.outlet_name, CASE WHEN e.outlet_id = 0 THEN 'Head Office' END) AS outlet_name,
           CASE e.from_type WHEN 'safe' THEN 'Safe · ' || COALESCE(fo.outlet_name, 'Head Office')
                            WHEN 'person' THEN fu.name WHEN 'drawer' THEN 'Drawer · shift #' || e.from_ref
                            ELSE INITCAP(e.from_type) END AS from_label,
           CASE e.to_type WHEN 'safe' THEN 'Safe · ' || COALESCE(t_o.outlet_name, 'Head Office')
                          WHEN 'person' THEN tu.name WHEN 'drawer' THEN 'Drawer · shift #' || e.to_ref
                          WHEN 'bank' THEN ba.name ELSE INITCAP(e.to_type) END AS to_label
    FROM cash_entries e
    LEFT JOIN cash_categories c ON c.id = e.category_id
    LEFT JOIN users cu ON cu.id = e.created_by LEFT JOIN users au ON au.id = e.actioned_by
    LEFT JOIN outlets o ON o.id = e.outlet_id
    LEFT JOIN outlets fo ON e.from_type = 'safe' AND fo.id = e.from_ref
    LEFT JOIN users fu ON e.from_type = 'person' AND fu.id = e.from_ref
    LEFT JOIN outlets t_o ON e.to_type = 'safe' AND t_o.id = e.to_ref
    LEFT JOIN users tu ON e.to_type = 'person' AND tu.id = e.to_ref
    LEFT JOIN bank_accounts ba ON e.to_type = 'bank' AND ba.id = e.to_ref
"""


async def _entries(db, where: str, params: dict, limit: int = 200):
    rows = (await db.execute(text(f"{ENTRY_SQL} WHERE {where} ORDER BY e.created_at DESC, e.id DESC LIMIT :lim"),
                             {**params, "lim": limit})).mappings().all()
    return [dict(r) for r in rows]


@router.get("/meta")
async def meta(db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    cats = (await db.execute(text("SELECT * FROM cash_categories ORDER BY type, sort_order, name"))).mappings().all()
    banks = (await db.execute(text("SELECT * FROM bank_accounts ORDER BY is_active DESC, name"))).mappings().all()
    users = (await db.execute(text("SELECT id, name, role, outlet_id FROM users WHERE status ORDER BY name"))).mappings().all()
    return {"categories": [dict(c) for c in cats], "bank_accounts": [dict(b) for b in banks],
            "users": [dict(u) for u in users], "me": {"id": user.user_id, "role": user.role},
            "is_manager": user.role in svc.MANAGERS, "is_accounts": user.role in svc.ACCOUNTS}


@router.get("/position")
async def position(outlet_id: int = Query(0), db: AsyncSession = Depends(get_db),
                   user: current_user_dep = Depends(get_current_user)):
    """Branch cash: safe, open drawers, in-transit, today's entries and what needs action."""
    day = await shifts.open_day(db, outlet_id)
    drawers = []
    for s in (await db.execute(text("""
            SELECT s.*, u.name AS cashier_name FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id
            WHERE s.outlet_id = :o AND s.status = 'open' ORDER BY s.opened_at"""), {"o": outlet_id})).mappings():
        f = await shifts.shift_figures(db, s)
        drawers.append({"shift_id": s["id"], "cashier_id": s["cashier_id"], "cashier_name": s["cashier_name"],
                        "shift_name": s["shift_name"], "expected_cash": f["expected_cash"], "opening_cash": s["opening_cash"],
                        "pay_ins": f["pay_ins"], "expenses": f["expenses"], "pickups": f["pickups"]})
    out_transit = (await db.execute(text("""
        SELECT COALESCE(SUM(amount), 0) FROM cash_entries
        WHERE from_type = 'safe' AND from_ref = :o AND status = 'pending' AND kind IN ('handover', 'deposit')"""),
        {"o": outlet_id})).scalar()
    p = {"o": outlet_id, "d": day["business_date"] if day else date.today()}
    return {
        "outlet_id": outlet_id, "outlet_name": await shifts.outlet_name(db, outlet_id),
        "business_date": day["business_date"] if day else None,
        "safe_balance": await svc.balance(db, "safe", outlet_id),
        "drawers": drawers,
        "out_in_transit": svc._two(out_transit),
        "entries": await _entries(db, "e.outlet_id = :o AND e.business_date = :d", p),
        "pending_expenses": await _entries(db, "e.kind = 'expense' AND e.status = 'pending' AND e.outlet_id = :o", p),
        "incoming": await _entries(db, "e.kind = 'handover' AND e.status = 'pending' AND e.to_type = 'safe' AND e.to_ref = :o", p),
        "outgoing": await _entries(db, """e.status = 'pending' AND e.kind IN ('handover', 'deposit')
                                          AND e.from_type = 'safe' AND e.from_ref = :o""", p),
    }


@router.get("/my")
async def my_cash(db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    p = {"u": user.user_id}
    return {
        "balance": await svc.balance(db, "person", user.user_id),
        "incoming": await _entries(db, "e.kind = 'handover' AND e.status = 'pending' AND e.to_type = 'person' AND e.to_ref = :u", p),
        "outgoing": await _entries(db, """e.status = 'pending' AND e.kind IN ('handover', 'deposit')
                                          AND e.from_type = 'person' AND e.from_ref = :u""", p),
        "entries": await _entries(db, """(e.from_type = 'person' AND e.from_ref = :u) OR (e.to_type = 'person' AND e.to_ref = :u)
                                         OR e.created_by = :u""", p, 100),
    }


@router.get("/approvals")
async def approvals(db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    """What this user may act on: expenses (managers), handovers into safes (managers), deposits (accounts)."""
    urow = (await db.execute(text("SELECT outlet_id FROM users WHERE id = :u"), {"u": user.user_id})).scalar() or 0
    p = {"u": user.user_id, "o": urow}
    out = {"expenses": [], "safe_handovers": [], "deposits": []}
    if user.role in svc.MANAGERS:
        out["expenses"] = await _entries(db, "e.kind = 'expense' AND e.status = 'pending' AND e.created_by <> :u", p)
        cond = "TRUE" if user.role in svc.ACCOUNTS else "e.to_ref = :o"
        out["safe_handovers"] = await _entries(db, f"""e.kind = 'handover' AND e.status = 'pending' AND e.to_type = 'safe'
                                                      AND e.created_by <> :u AND {cond}""", p)
    if user.role in svc.ACCOUNTS:
        out["deposits"] = await _entries(db, "e.kind = 'deposit' AND e.status = 'pending' AND e.created_by <> :u", p)
    return out


@router.get("/control")
async def control(db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(admin)):
    """HO view: where all the cash is right now, across every branch and person."""
    rows = (await db.execute(text("""
        WITH locs AS (SELECT 0 AS id, 'Head Office' AS name UNION ALL SELECT id, outlet_name FROM outlets),
        mv AS (
            SELECT to_ref AS loc, amount AS amt FROM cash_entries WHERE to_type = 'safe' AND status = 'posted'
            UNION ALL
            SELECT from_ref, -amount FROM cash_entries WHERE from_type = 'safe'
              AND (status = 'posted' OR (status = 'pending' AND kind IN ('handover', 'deposit'))))
        SELECT l.id AS outlet_id, l.name AS outlet_name,
               COALESCE((SELECT SUM(amt) FROM mv WHERE mv.loc = l.id), 0) AS safe_balance,
               COALESCE((SELECT SUM(amount) FROM cash_entries WHERE from_type = 'safe' AND from_ref = l.id
                          AND status = 'pending' AND kind = 'handover'), 0) AS handover_in_transit,
               COALESCE((SELECT SUM(amount) FROM cash_entries WHERE from_type = 'safe' AND from_ref = l.id
                          AND status = 'pending' AND kind = 'deposit'), 0) AS deposits_unverified,
               (SELECT MAX(business_date) FROM cash_entries WHERE from_type = 'safe' AND from_ref = l.id
                 AND kind = 'deposit' AND status = 'posted') AS last_verified_deposit,
               COALESCE((SELECT SUM(amount) FROM cash_entries WHERE outlet_id = l.id AND kind = 'adjustment'
                          AND from_type = 'safe' AND business_date >= CURRENT_DATE - 30), 0) AS shortage_30d,
               (SELECT COUNT(*) FROM cash_entries WHERE outlet_id = l.id AND kind = 'expense' AND status = 'pending') AS pending_expenses,
               (SELECT status FROM business_days WHERE outlet_id = l.id ORDER BY business_date DESC LIMIT 1) AS day_status
        FROM locs l
        WHERE (CAST(:_mine AS INT[]) IS NULL OR l.id = ANY(CAST(:_mine AS INT[]))) AND (EXISTS (SELECT 1 FROM cash_entries e WHERE (e.from_type = 'safe' AND e.from_ref = l.id)
                         OR (e.to_type = 'safe' AND e.to_ref = l.id))
           OR EXISTS (SELECT 1 FROM business_days d WHERE d.outlet_id = l.id))
        ORDER BY l.name"""), {"_mine": access.allowed_outlets()})).mappings().all()
    people = (await db.execute(text("""
        SELECT u.id, u.name, u.role,
               COALESCE(SUM(e.amount) FILTER (WHERE e.to_type = 'person' AND e.to_ref = u.id AND e.status = 'posted'), 0)
             - COALESCE(SUM(e.amount) FILTER (WHERE e.from_type = 'person' AND e.from_ref = u.id
                   AND (e.status = 'posted' OR (e.status = 'pending' AND e.kind IN ('handover', 'deposit')))), 0) AS balance,
               MIN(e.created_at) FILTER (WHERE e.to_type = 'person' AND e.to_ref = u.id AND e.status = 'posted') AS holding_since
        FROM users u JOIN cash_entries e ON (e.to_type = 'person' AND e.to_ref = u.id) OR (e.from_type = 'person' AND e.from_ref = u.id)
        GROUP BY u.id, u.name, u.role HAVING
             COALESCE(SUM(e.amount) FILTER (WHERE e.to_type = 'person' AND e.to_ref = u.id AND e.status = 'posted'), 0)
           - COALESCE(SUM(e.amount) FILTER (WHERE e.from_type = 'person' AND e.from_ref = u.id
                 AND (e.status = 'posted' OR (e.status = 'pending' AND e.kind IN ('handover', 'deposit')))), 0) <> 0
        ORDER BY balance DESC"""))).mappings().all()
    banks = (await db.execute(text("""
        SELECT b.id, b.name, b.bank_name, RIGHT(b.account_no, 4) AS last4,
               COALESCE(SUM(e.credited_amount) FILTER (WHERE e.status = 'posted'), 0) AS verified_total,
               COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'pending'), 0) AS awaiting_verification,
               COALESCE(SUM(e.amount - e.credited_amount) FILTER (WHERE e.status = 'posted'), 0) AS bank_shortfall
        FROM bank_accounts b LEFT JOIN cash_entries e ON e.kind = 'deposit' AND e.to_ref = b.id
        GROUP BY b.id ORDER BY b.name"""))).mappings().all()
    return {"locations": [dict(r) for r in rows], "people": [dict(r) for r in people], "banks": [dict(r) for r in banks]}


@router.get("/entries")
async def entries(outlet_id: Optional[int] = None, kind: Optional[str] = None, status: Optional[str] = None,
                  from_date: Optional[date] = None, to_date: Optional[date] = None, search: str = "",
                  limit: int = Query(500, le=2000), db: AsyncSession = Depends(get_db),
                  user: current_user_dep = Depends(get_current_user)):
    where = ["(CAST(:o AS INT) IS NULL OR e.outlet_id = :o)", "(CAST(:k AS TEXT) IS NULL OR e.kind = :k)",
             "(CAST(:s AS TEXT) IS NULL OR e.status = :s)", "(CAST(:fd AS DATE) IS NULL OR e.business_date >= :fd)",
             "(CAST(:td AS DATE) IS NULL OR e.business_date <= :td)",
             "(:q = '' OR e.entry_no ILIKE :ql OR e.party ILIKE :ql OR e.ref_no ILIKE :ql OR e.description ILIKE :ql)"]
    sp: dict = {}
    if access.outlet_filter("e.outlet_id", sp):
        where.append("e.outlet_id = ANY(:_scope_outlets)")
    if user.role not in svc.MANAGERS:  # staff see only what they created or hold
        where.append("""(e.created_by = :u OR (e.to_type = 'person' AND e.to_ref = :u) OR (e.from_type = 'person' AND e.from_ref = :u))""")
    return await _entries(db, " AND ".join(where), {"o": outlet_id, "k": kind, "s": status, "fd": from_date, "td": to_date,
                                                    "q": search.strip(), "ql": f"%{search.strip()}%", "u": user.user_id, **sp}, limit)


# ── actions ───────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload(file: UploadFile = File(...), user: current_user_dep = Depends(get_current_user)):
    content = await file.read(svc.MAX_UPLOAD + 1)
    try:
        return {"path": svc.save_upload(content, file.content_type or "")}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/expense")
async def expense(b: expense_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.expense(db, user, b.outlet_id, b.source, b.category_id, b.amount, b.party.strip(),
                                  (b.ref_no or "").strip() or None, b.description, b.attachment))


@router.post("/pay-in")
async def pay_in(b: pay_in_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.pay_in(db, user, b.outlet_id, b.target, b.category_id, b.amount, b.party.strip(), b.description))


@router.post("/pickup")
async def pickup(b: pickup_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.pickup(db, user, b.shift_id, b.amount, b.description))


@router.post("/handover")
async def handover(b: handover_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.handover(db, user, b.from_type, b.from_ref, b.to_type, b.to_ref, b.amount, b.description))


@router.post("/deposit")
async def deposit(b: deposit_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.deposit(db, user, b.from_type, b.from_ref, b.bank_account_id, b.amount, b.slip_no,
                                  b.deposit_date, b.attachment, b.description))


@router.post("/entries/{eid}/expense-decision")
async def expense_decision(eid: int, b: decide_in, db: AsyncSession = Depends(get_db),
                           user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.decide_expense(db, user, eid, b.approve, b.remarks))


@router.post("/entries/{eid}/handover-decision")
async def handover_decision(eid: int, b: decide_in, db: AsyncSession = Depends(get_db),
                            user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.decide_handover(db, user, eid, b.approve, b.remarks))


@router.post("/entries/{eid}/verify")
async def verify(eid: int, b: verify_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.verify_deposit(db, user, eid, b.ok, b.credited_amount, b.bank_ref, b.credited_date, b.remarks))


@router.post("/entries/{eid}/cancel")
async def cancel(eid: int, b: reason_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.cancel(db, user, eid, b.reason.strip()))


@router.post("/entries/{eid}/void")
async def void(eid: int, b: reason_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.void(db, user, eid, b.reason.strip()))


# ── masters (admin) ───────────────────────────────────────────────────────────

ALLOWED_UPSERT_TABLES = {"cash_categories", "bank_accounts"}

async def _upsert(db, table: str, data: dict, rid: Optional[int], user):
    from sqlalchemy.exc import IntegrityError
    import re
    if table not in ALLOWED_UPSERT_TABLES:
        raise HTTPException(400, "Invalid target table")
    cols = list(data)
    for c in cols:
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", c):
            raise HTTPException(400, f"Invalid column name: {c}")
    try:
        if rid:
            await db.execute(text(f"UPDATE {table} SET {', '.join(f'{c} = :{c}' for c in cols)} WHERE id = :id"), {**data, "id": rid})
        else:
            rid = (await db.execute(text(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(':' + c for c in cols)}) RETURNING id"),
                                    data)).scalar()
        await svc.write_audit(db=db, module="cash", action=f"{table}_save", record_id=rid, description=str(data),
                              user_id=user.user_id, user_name=user.username)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Already exists")
    return {"id": rid}


@router.post("/categories")
async def add_category(b: category_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(admin)):
    return await _upsert(db, "cash_categories", b.model_dump(), None, user)


@router.put("/categories/{cid}")
async def edit_category(cid: int, b: category_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(admin)):
    return await _upsert(db, "cash_categories", b.model_dump(), cid, user)


@router.post("/bank-accounts")
async def add_bank(b: bank_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(admin)):
    return await _upsert(db, "bank_accounts", b.model_dump(), None, user)


@router.put("/bank-accounts/{bid}")
async def edit_bank(bid: int, b: bank_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(admin)):
    return await _upsert(db, "bank_accounts", b.model_dump(), bid, user)
