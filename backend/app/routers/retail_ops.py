"""Loyalty programme, discount policy and the Head Office dashboard."""
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.services import approval_service as aps
from app.services import day_close_service, discount_service, loyalty_service
from app.services.auth_service import write_audit
from app.services.mfg_stock_service import today

loyalty = APIRouter(prefix="/loyalty", tags=["loyalty"])
discounts = APIRouter(prefix="/discount-policy", tags=["discount policy"])
ho = APIRouter(prefix="/ho-dashboard", tags=["head office"])
routers = (loyalty, discounts, ho)


async def _rows(db, sql, p=None):
    return [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()} for r in (await db.execute(text(sql), p or {})).mappings().all()]


async def _audit(db, user, module, action, no, desc, old=None, new=None):
    await write_audit(db=db, module=module, action=action, record_id=0, record_no=no, description=desc, old_data=old, new_data=new,
                      user_id=user.user_id, user_name=user.username)


# ── loyalty ───────────────────────────────────────────────────────────────────
@loyalty.get("/config")
async def get_config(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return {"config": await loyalty_service.config(db), "rules": await _rows(db, "SELECT * FROM loyalty_rules ORDER BY is_active DESC, id")}


class config_in(BaseModel):
    enabled: bool
    point_value: Decimal = Field(gt=0)
    min_redeem_points: Decimal = Field(ge=0)
    max_redeem_pct: Decimal = Field(ge=0, le=100)
    max_redeem_points: Optional[Decimal] = None
    redeem_outlet_ids: Optional[list[int]] = None
    consolidated: bool = True
    approval_above_points: Optional[Decimal] = None


@loyalty.put("/config")
async def put_config(b: config_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    old = await loyalty_service.config(db)
    await db.execute(text("""UPDATE loyalty_config SET enabled = :enabled, point_value = :point_value, min_redeem_points = :min_redeem_points,
        max_redeem_pct = :max_redeem_pct, max_redeem_points = :max_redeem_points, redeem_outlet_ids = :redeem_outlet_ids,
        consolidated = :consolidated, approval_above_points = :approval_above_points, updated_by = :u, updated_at = NOW() WHERE id = 1"""),
        {**b.model_dump(), "u": user.user_id})
    await _audit(db, user, "loyalty", "config", "loyalty_config", "Loyalty settings changed", str(old), str(b.model_dump()))
    await db.commit()
    return {"success": True}


class rule_in(BaseModel):
    id: Optional[int] = None
    name: str = Field(min_length=2, max_length=100)
    is_active: bool = True
    is_campaign: bool = False
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    spend_per_point: Decimal = Field(gt=0)
    multiplier: Decimal = Field(Decimal(1), gt=0)
    min_bill: Decimal = Field(Decimal(0), ge=0)
    max_points: Optional[Decimal] = None
    expiry_days: Optional[int] = Field(None, ge=1)
    outlet_ids: Optional[list[int]] = None
    category_ids: Optional[list[int]] = None
    product_ids: Optional[list[int]] = None
    excluded_product_ids: Optional[list[int]] = None
    excluded_category_ids: Optional[list[int]] = None


@loyalty.put("/rules")
async def put_rules(rows: list[rule_in], db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Rules are updated in place (history of earned points keeps its rule id); unlisted rules are switched off, not deleted."""
    keep = []
    cols = [c for c in rule_in.model_fields if c != "id"]
    for r in rows:
        d = r.model_dump()
        if r.id:
            await db.execute(text(f"UPDATE loyalty_rules SET {', '.join(f'{c} = :{c}' for c in cols)} WHERE id = :id"), d)
            keep.append(r.id)
        else:
            keep.append((await db.execute(text(f"INSERT INTO loyalty_rules ({', '.join(cols)}, created_by) VALUES ({', '.join(':' + c for c in cols)}, :u) RETURNING id"),
                                          {**d, "u": user.user_id})).scalar())
    await db.execute(text("UPDATE loyalty_rules SET is_active = FALSE WHERE NOT (id = ANY(:k))"), {"k": keep or [0]})
    await _audit(db, user, "loyalty", "rules", "loyalty_rules", f"{len(rows)} earning rule(s) saved", new=str([r.model_dump() for r in rows]))
    await db.commit()
    return {"success": True}


@loyalty.get("/customers")
async def customers(search: str = "", db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    q = search.strip()
    if len(q) < 2:
        return []
    rows = await _rows(db, """SELECT c.id, c.name, c.phone, c.loyalty_no, c.loyalty_status, c.loyalty_joined,
        COALESCE((SELECT SUM(points) FROM loyalty_ledger l WHERE l.customer_id = c.id), 0) AS points
        FROM customers c WHERE c.name ILIKE :q OR c.phone ILIKE :q OR c.loyalty_no ILIKE :q ORDER BY c.loyalty_status = 'ACTIVE' DESC, c.name LIMIT 30""",
                       {"q": f"%{q}%"})
    return rows


@loyalty.get("/customers/{cid}")
async def customer(cid: int, outlet_id: Optional[int] = None, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    c = (await db.execute(text("SELECT id, name, phone, loyalty_no, loyalty_status, loyalty_joined FROM customers WHERE id = :c"), {"c": cid})).mappings().first()
    if not c:
        raise HTTPException(404, "Customer not found")
    bal = await loyalty_service.balance(db, cid, outlet_id) if c["loyalty_status"] == "ACTIVE" else None
    await db.commit()          # lazy expiry rows
    ledger = await _rows(db, """SELECT l.id, TO_CHAR(l.created_at + INTERVAL '5 hours 30 minutes', 'DD Mon YYYY HH24:MI') AS at, l.txn_type, l.points,
        l.remaining, l.expires_on, l.reference, l.reason, l.amount, l.eligible_amount, o.outlet_name AS store, u.name AS by_user
        FROM loyalty_ledger l LEFT JOIN outlets o ON o.id = l.outlet_id LEFT JOIN users u ON u.id = l.created_by
        WHERE l.customer_id = :c ORDER BY l.id DESC LIMIT 300""", {"c": cid})
    return {**dict(c), "balance": bal, "ledger": ledger}


class enroll_in(BaseModel):
    loyalty_no: Optional[str] = Field(None, max_length=30)
    status: str = Field("ACTIVE", pattern="^(ACTIVE|BLOCKED|NONE)$")


@loyalty.post("/customers/{cid}/enroll")
async def enroll(cid: int, b: enroll_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    c = (await db.execute(text("SELECT phone, loyalty_no FROM customers WHERE id = :c FOR UPDATE"), {"c": cid})).mappings().first()
    if not c:
        raise HTTPException(404, "Customer not found")
    no = (b.loyalty_no or c["loyalty_no"] or c["phone"] or f"L{cid:07d}").strip()
    if (await db.execute(text("SELECT 1 FROM customers WHERE loyalty_no = :n AND id <> :c"), {"n": no, "c": cid})).first():
        raise HTTPException(400, f"Loyalty number {no} belongs to another customer.")
    await db.execute(text("UPDATE customers SET loyalty_no = :n, loyalty_status = :s, loyalty_joined = COALESCE(loyalty_joined, :d) WHERE id = :c"),
                     {"n": no, "s": b.status, "d": today(), "c": cid})
    await _audit(db, user, "loyalty", "enroll", no, f"Customer #{cid} loyalty {b.status} ({no})")
    await db.commit()
    return {"loyalty_no": no, "status": b.status}


class adjust_in(BaseModel):
    customer_id: int
    points: Decimal
    reason: str = Field(min_length=5, max_length=300)
    outlet_id: Optional[int] = None


@loyalty.post("/adjust")
async def adjust(b: adjust_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Manual point adjustment — always through Approvals (LOYALTY_ADJUST)."""
    if not ("loyalty.edit" in await access.effective_permissions(db, user.user_id, user.role, user.role_id) or user.role in ("admin", "superadmin")):
        raise HTTPException(403, "You need the Loyalty → edit permission to request a point adjustment.")
    c = (await db.execute(text("SELECT name FROM customers WHERE id = :c"), {"c": b.customer_id})).scalar()
    r = await aps.submit(db, request_type="LOYALTY_ADJUST", user=user, reason=b.reason, outlet_id=b.outlet_id,
                         payload={"customer_id": b.customer_id, "points": str(b.points)}, summary=f"{b.points:+f} points for {c}",
                         ref_type="customer", ref_id=b.customer_id, ref_no=c, new_value={"points": float(b.points)})
    await db.commit()
    return r


@loyalty.get("/summary")
async def summary(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    p: dict = {}
    return (await _rows(db, f"""SELECT COUNT(DISTINCT c.id) FILTER (WHERE c.loyalty_status = 'ACTIVE') AS members,
        COALESCE(SUM(l.points), 0) AS outstanding, COALESCE(SUM(l.points) FILTER (WHERE l.txn_type = 'EARN'), 0) AS earned,
        COALESCE(-SUM(l.points) FILTER (WHERE l.txn_type = 'REDEEM'), 0) AS redeemed,
        COALESCE(-SUM(l.points) FILTER (WHERE l.txn_type = 'EXPIRE'), 0) AS expired,
        COALESCE(SUM(l.points) FILTER (WHERE l.txn_type = 'EARN' AND l.created_at > NOW() - INTERVAL '30 days'), 0) AS earned_30d
        FROM customers c LEFT JOIN loyalty_ledger l ON l.customer_id = c.id WHERE TRUE {access.outlet_filter('l.outlet_id', p) if access.allowed_outlets() is not None else ''}""", p))[0]


# ── discount policy ───────────────────────────────────────────────────────────
@discounts.get("")
async def get_policy(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await discount_service.policy(db)


class policy_in(BaseModel):
    item_allowed: bool
    bill_allowed: bool
    scheme_allowed: bool
    loyalty_allowed: bool
    item_with_bill: bool
    item_with_scheme: bool
    bill_with_scheme: bool
    loyalty_with_discount: bool
    max_discount_pct: Decimal = Field(ge=0, le=100)
    approval_above_pct: Optional[Decimal] = Field(None, ge=0, le=100)
    override_roles: list[str] = ["admin", "superadmin"]


@discounts.put("")
async def put_policy(b: policy_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if b.approval_above_pct is not None and b.approval_above_pct > b.max_discount_pct:
        raise HTTPException(400, "The approval limit must be below the maximum discount.")
    old = await discount_service.policy(db)
    sets = ", ".join(f"{k} = :{k}" for k in b.model_dump())
    await db.execute(text(f"UPDATE discount_policy SET {sets}, updated_by = :u, updated_at = NOW() WHERE id = 1"), {**b.model_dump(), "u": user.user_id})
    await _audit(db, user, "discounts", "policy", "discount_policy", "Discount policy changed", str(old), str(b.model_dump()))
    await db.commit()
    return {"success": True}


class high_disc_in(BaseModel):
    outlet_id: int
    discount_pct: Decimal = Field(gt=0, le=100)
    bill_amount: Optional[Decimal] = None
    customer: Optional[str] = None
    reason: str = Field(min_length=5, max_length=300)


@discounts.post("/request")
async def request_high_discount(b: high_disc_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """The till asks for a discount above the approval limit; the approved request number is entered on the bill (used once)."""
    r = await aps.submit(db, request_type="HIGH_DISCOUNT", user=user, reason=b.reason, outlet_id=b.outlet_id,
                         payload={"discount_pct": str(b.discount_pct), "bill_amount": str(b.bill_amount or "")},
                         summary=f"{b.discount_pct}% discount" + (f" on ₹{b.bill_amount}" if b.bill_amount else "") + (f" for {b.customer}" if b.customer else ""),
                         new_value={"discount_pct": float(b.discount_pct)})
    await db.commit()
    return r


# ── head office dashboard ─────────────────────────────────────────────────────
@ho.get("")
async def dashboard(business_date: Optional[date] = None, outlet_id: Optional[int] = None, region_id: Optional[int] = None,
                    db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Consolidated view across the caller's stores (counts come from the database and respect store scope)."""
    d = business_date or today()
    p: dict = {"d": d, "t": today(), "o": outlet_id, "r": region_id}
    if outlet_id:
        access.check_outlet(outlet_id)
    scope = access.outlet_filter("x", p)
    W = lambda col: (scope.replace("x", col) + f" AND (CAST(:o AS INT) IS NULL OR {col} = :o)"     # noqa: E731
                     f" AND (CAST(:r AS INT) IS NULL OR {col} IN (SELECT id FROM outlets WHERE region_id = :r))")
    one = lambda sql: db.execute(text(sql), p)  # noqa: E731
    board = [b for b in await day_close_service.board(db, d) if (not outlet_id or b["outlet_id"] == outlet_id)]
    if region_id:
        ids = set((await one("SELECT id FROM outlets WHERE region_id = :r")).scalars().all())
        board = [b for b in board if b["outlet_id"] in ids]
    sales = await _rows(db, f"""SELECT o.id AS outlet_id, o.outlet_name AS store, COUNT(i.id) AS bills, COALESCE(SUM(i.total_amount), 0) AS sales
        FROM outlets o LEFT JOIN unit_wise_invoices i ON i.outlet_id = o.id AND i.invoice_date = :d AND i.status <> 'cancelled' AND i.invoice_type <> 'return'
        WHERE COALESCE(o.is_active, TRUE) {W('o.id')} GROUP BY o.id, o.outlet_name ORDER BY sales DESC""", p)
    stock = await _rows(db, f"""SELECT COALESCE(SUM(s.stock_qty), 0) AS qty, COALESCE(SUM(s.stock_qty * COALESCE(p.cost_price, 0)), 0) AS value
        FROM outlet_stock s JOIN products p ON p.id = s.product_id WHERE s.stock_qty > 0 {W('s.outlet_id')}""", p)
    exp = await _rows(db, f"""SELECT COUNT(*) FILTER (WHERE b.exp_date <= :t) AS expired_batches,
        COALESCE(SUM(s.current_qty * COALESCE(NULLIF(b.cost_price, 0), 0)) FILTER (WHERE b.exp_date <= :t), 0) AS expired_value,
        COUNT(*) FILTER (WHERE b.exp_date > :t AND b.exp_date - :t <= (SELECT MAX(days) FROM expiry_bands)) AS near_batches
        FROM product_batch_stock s JOIN product_batches b ON b.id = s.batch_id WHERE s.current_qty > 0 {W('s.location_id')}""", p)
    appr = {r["request_type"]: r["n"] for r in await _rows(db, f"""SELECT request_type, COUNT(*) AS n FROM approval_requests
        WHERE status = 'PENDING' {W('outlet_id')} GROUP BY 1""", p)}
    po = (await one(f"""SELECT COUNT(*) FILTER (WHERE COALESCE(approval_status, '') IN ('pending', 'pending_approval')) AS pending_approval,
        COUNT(*) FILTER (WHERE status IN ('approved', 'sent', 'partial', 'open')) AS open_po FROM po_headers WHERE TRUE {W('outlet_id')}""")).mappings().one()
    grn = (await one(f"SELECT COUNT(*) FROM unit_wise_purchases WHERE status = 'draft' {W('outlet_id')}")).scalar()
    try:
        async with db.begin_nested():
            failed_mail = (await one(f"SELECT COUNT(*) FROM po_email_outbox e JOIN po_headers h ON h.id = e.po_id WHERE e.status IN ('FAILED','RETRY') {W('h.outlet_id')}")).scalar()
    except Exception:
        failed_mail = None
    loy = await summary(db, None)
    return {
        "business_date": d,
        "cards": {
            "active_stores": len(board), "closed": sum(1 for b in board if not b["not_closed"]), "pending_closing": sum(1 for b in board if b["not_closed"]),
            "overdue_closing": sum(1 for b in board if b["overdue"]), "sales": sum(s["sales"] for s in sales), "bills": sum(s["bills"] for s in sales),
            "stock_value": stock[0]["value"], "po_pending_approval": po["pending_approval"], "po_open": po["open_po"], "grn_draft": grn,
            "near_expiry_batches": exp[0]["near_batches"], "expired_batches": exp[0]["expired_batches"], "expired_value": exp[0]["expired_value"],
            "approvals_expired_removal": appr.get("EXPIRED_REMOVAL", 0), "approvals_batch_correction": appr.get("BATCH_CORRECTION", 0),
            "approvals_price_change": appr.get("PRICE_CHANGE", 0), "approvals_total": sum(appr.values()), "failed_po_emails": failed_mail,
            "loyalty_members": loy["members"], "loyalty_outstanding": loy["outstanding"], "loyalty_earned_30d": loy["earned_30d"],
        },
        "stores": board, "sales": sales,
    }
