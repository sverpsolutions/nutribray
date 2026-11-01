"""Promotions → Schemes: master CRUD, live evaluation (POS + simulator), usage report."""
import json
from datetime import date, datetime, time
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.services import scheme_service
from app.services.auth_service import write_audit

router = APIRouter(prefix="/schemes", tags=["schemes"])
editor = require_role("superadmin", "admin", "manager")

TYPE_LABELS = {
    "QTY_SLAB": "Quantity Slab (Buy X Get Y Free)", "VALUE_DISC": "Value-Based Discount",
    "FREE_ITEM": "Free Item (Same/Different)", "MIX_MATCH": "Mix and Match", "CARTON": "Carton-Based",
    "TARGET": "Customer Target Bonus", "CASH_DISC": "Cash Discount", "CREDIT_NOTE": "Credit Note Scheme",
    "CHEAPEST_FREE": "Buy N — Cheapest Free (2+1)", "BULK_TIER": "Bulk Discount (qty tiers)",
}
CUSTOMER_TYPES = ("retail", "wholesale", "hotel", "institution")


class slab_in(BaseModel):
    min_qty: Decimal = Decimal("0")
    max_qty: Decimal = Decimal("0")
    min_value: Decimal = Decimal("0")
    free_qty: Decimal = Decimal("0")
    discount_percent: Decimal = Field(Decimal("0"), ge=0, le=100)
    discount_percent2: Decimal = Field(Decimal("0"), ge=0, le=100)
    discount_value: Decimal = Decimal("0")
    free_item_id: int | None = None


class free_in(BaseModel):
    product_id: int
    qty: Decimal = Decimal("1")


class group_in(BaseModel):
    name: str = "Group"
    min_qty: Decimal = Decimal("1")
    product_ids: list[int] = []


class scheme_in(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    scheme_type: str
    apply_on: str = "item"
    priority: int = Field(5, ge=1, le=99)
    start_date: date
    end_date: date
    start_time: time | None = None
    end_time: time | None = None
    is_active: bool = True
    outlet_ids: list[int] = []
    customer_ids: list[int] = []
    customer_types: list[str] = []
    qty_basis: str = "line"
    product_ids: list[int] = []
    brand_id: int | None = None
    category_id: int | None = None
    min_qty: Decimal = Field(Decimal("0"), ge=0)
    min_value: Decimal = Field(Decimal("0"), ge=0)
    discount_percent: Decimal = Field(Decimal("0"), ge=0, le=100)
    discount_percent2: Decimal = Field(Decimal("0"), ge=0, le=100)
    discount_value: Decimal = Field(Decimal("0"), ge=0)
    free_qty: Decimal = Field(Decimal("0"), ge=0)
    free_item_id: int | None = None
    is_recursive: bool = False
    is_combination_allowed: bool = True
    max_benefit_per_invoice: Decimal = Field(Decimal("0"), ge=0)
    expiry_days_trigger: int | None = Field(None, ge=0)
    target_amount: Decimal = Field(Decimal("0"), ge=0)
    credit_note_percent: Decimal = Field(Decimal("0"), ge=0, le=100)
    credit_note_timing: str = "immediate"
    carton_size: int = Field(1, ge=1)
    slabs: list[slab_in] = []
    free_items: list[free_in] = []
    mix_groups: list[group_in] = []
    notes: str | None = None


class eval_item(BaseModel):
    product_id: int
    qty: Decimal
    rate: Decimal          # GST-inclusive selling price per unit
    gst: Decimal | None = None


class eval_in(BaseModel):
    items: list[eval_item]
    customer_id: int | None = None
    outlet_id: int | None = None
    payment_mode: str = "cash"
    bill_date: date | None = None
    at: time | None = None


def _validate(b: scheme_in):
    """Refuse schemes that would save as Active and then silently give nothing (NCG _check_cheapest_free idea, for every type)."""
    t = b.scheme_type
    if t not in TYPE_LABELS:
        raise HTTPException(400, "Unknown scheme type.")
    if b.end_date < b.start_date:
        raise HTTPException(400, "End date is before start date.")
    if (b.start_time is None) != (b.end_time is None):
        raise HTTPException(400, "Give both start and end time, or neither.")
    if t == "MIX_MATCH":
        b.apply_on = "mix_match"
        if not b.mix_groups or any(not g.product_ids for g in b.mix_groups):
            raise HTTPException(400, "Mix & Match needs at least one group, each with items.")
    elif t in ("CASH_DISC",):
        b.apply_on = "invoice"
    on = b.apply_on
    if on not in ("item", "brand", "category", "brand_category", "invoice", "mix_match"):
        raise HTTPException(400, "Unknown 'apply on'.")
    if on == "item" and not b.product_ids and t not in ("VALUE_DISC", "CREDIT_NOTE", "TARGET"):
        raise HTTPException(400, "Pick the item(s) this scheme applies to.")
    if on in ("brand", "brand_category") and not b.brand_id:
        raise HTTPException(400, "Pick the brand.")
    if on in ("category", "brand_category") and not b.category_id:
        raise HTTPException(400, "Pick the category.")
    has_disc = b.discount_percent > 0 or b.discount_value > 0
    if t == "QTY_SLAB" and not b.slabs and not (b.min_qty > 0 and (b.free_qty > 0 or has_disc)):
        raise HTTPException(400, "Quantity slab: add slabs, or set Min Qty with a free qty / discount.")
    if t == "VALUE_DISC" and not b.slabs and not has_disc:
        raise HTTPException(400, "Value discount: set a discount % or ₹ (or add value slabs).")
    if t == "FREE_ITEM" and not b.free_items and not (b.free_qty > 0 and (b.free_item_id or b.product_ids)):
        raise HTTPException(400, "Free item: add the free product(s) and qty.")
    if t == "CARTON" and (b.min_qty <= 0 or not (b.free_qty > 0 or b.discount_percent > 0)):
        raise HTTPException(400, "Carton scheme: set Min cartons and a free qty or discount %.")
    if t == "TARGET" and (b.target_amount <= 0 or b.discount_percent <= 0):
        raise HTTPException(400, "Target scheme: set the target amount and the bonus %.")
    if t == "CASH_DISC" and b.discount_percent <= 0:
        raise HTTPException(400, "Cash discount: set the discount %.")
    if t == "CREDIT_NOTE" and b.credit_note_percent <= 0:
        raise HTTPException(400, "Credit note scheme: set the credit note %.")
    if t == "CHEAPEST_FREE":
        if b.min_qty < 2 or b.min_qty != b.min_qty.to_integral_value():
            raise HTTPException(400, "Cheapest free: Min Qty is the GROUP size (2+1 → 3), a whole number of 2 or more.")
        fq = b.free_qty or Decimal(1)
        if fq >= b.min_qty or fq != fq.to_integral_value():
            raise HTTPException(400, "Cheapest free: Free Qty must be a whole number smaller than Min Qty.")
    if t == "BULK_TIER":
        tiers = sorted(b.slabs, key=lambda x: x.min_qty)
        if not tiers:
            raise HTTPException(400, "Bulk discount: add at least one quantity tier.")
        for i, x in enumerate(tiers):
            if x.min_qty <= 0 or (x.discount_percent <= 0 and x.discount_value <= 0):
                raise HTTPException(400, f"Tier {i + 1}: set 'from qty' and a discount % or ₹ per unit.")
            if x.max_qty and x.max_qty < x.min_qty:
                raise HTTPException(400, f"Tier {i + 1}: 'to qty' is below 'from qty'.")
            if i and (not tiers[i - 1].max_qty or tiers[i - 1].max_qty >= x.min_qty):
                raise HTTPException(400, f"Tiers overlap: tier {i} must end below {x.min_qty:f} (only the last tier can be open-ended).")
        b.slabs = tiers
    if b.qty_basis not in ("line", "total"):
        raise HTTPException(400, "Unknown quantity basis.")
    if any(c not in CUSTOMER_TYPES for c in b.customer_types):
        raise HTTPException(400, "Unknown customer type.")
    if b.credit_note_timing not in ("immediate", "end_of_month", "end_of_quarter"):
        raise HTTPException(400, "Unknown credit note timing.")


def _params(b: scheme_in) -> dict:
    p = b.model_dump(exclude={"slabs", "free_items", "mix_groups"})
    for k in ("outlet_ids", "customer_ids", "product_ids", "customer_types"):
        p[k] = p[k] or None
    p["slabs"] = json.dumps([s.model_dump(mode="json") for s in b.slabs])
    p["free_items"] = json.dumps([f.model_dump(mode="json") for f in b.free_items])
    p["mix_groups"] = json.dumps([g.model_dump(mode="json") for g in b.mix_groups])
    return p


COLS = [c for c in scheme_in.model_fields]


@router.get("/types")
async def scheme_types(_=Depends(get_current_user)):
    return [{"code": k, "label": v} for k, v in TYPE_LABELS.items()]


@router.get("")
async def list_schemes(status: str = Query("all", pattern="^(all|active|inactive|expired|upcoming)$"),
                       search: str = "", kind: str = Query("scheme", pattern="^(scheme|bulk)$"), db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    where, p = ["TRUE"], {"q": f"%{search.strip()}%", "d": date.today()}
    if search.strip():
        where.append("s.name ILIKE :q")
    where.append("s.scheme_type " + ("= 'BULK_TIER'" if kind == "bulk" else "<> 'BULK_TIER'"))
    where.append({"all": "TRUE", "active": "s.is_active AND :d BETWEEN s.start_date AND s.end_date",
                  "inactive": "NOT s.is_active", "expired": "s.end_date < :d", "upcoming": "s.start_date > :d"}[status])
    rows = (await db.execute(text(f"""
        SELECT s.id, s.name, s.scheme_type, s.apply_on, s.priority, s.start_date, s.end_date, s.start_time, s.end_time,
               s.is_active, s.is_combination_allowed, s.discount_percent, s.discount_percent2, s.discount_value, s.free_qty,
               s.min_qty, s.min_value, s.outlet_ids, s.slabs, s.customer_types, s.qty_basis, s.max_benefit_per_invoice, b.name AS brand_name, c.name AS category_name,
               COALESCE(cardinality(s.product_ids), 0) AS item_count,
               COALESCE(l.bills, 0) AS bills, COALESCE(l.given, 0) AS discount_given
        FROM schemes s
        LEFT JOIN brands b ON b.id = s.brand_id
        LEFT JOIN item_categories c ON c.id = s.category_id
        LEFT JOIN (SELECT scheme_id, COUNT(DISTINCT invoice_id) bills, SUM(discount_given) given
                   FROM scheme_usage_log GROUP BY scheme_id) l ON l.scheme_id = s.id
        WHERE {' AND '.join(where)} ORDER BY s.is_active DESC, s.priority, s.id DESC"""), p)).mappings().all()
    today = date.today()
    out = []
    for r in rows:
        r = dict(r)
        r["type_label"] = TYPE_LABELS.get(r["scheme_type"], r["scheme_type"])
        r["state"] = ("inactive" if not r["is_active"] else "expired" if r["end_date"] < today
                      else "upcoming" if r["start_date"] > today else "active")
        out.append(r)
    return out


@router.get("/report")
async def scheme_report(from_date: date = Query(...), to_date: date = Query(...), scheme_id: int | None = None,
                        outlet_id: int | None = None, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    p = {"f": from_date, "t": to_date, "s": scheme_id, "o": outlet_id}
    flt = ("l.applied_at::date BETWEEN :f AND :t AND (CAST(:s AS INT) IS NULL OR l.scheme_id = :s) "
           "AND (CAST(:o AS INT) IS NULL OR l.outlet_id = :o)")
    summary = (await db.execute(text(f"""
        SELECT l.scheme_id, l.scheme_name, l.scheme_type, COUNT(DISTINCT l.invoice_id) bills,
               COUNT(DISTINCT l.customer_id) customers, SUM(l.discount_given) discount_given,
               SUM(CASE WHEN l.benefit_type = 'free_item' THEN l.free_qty ELSE 0 END) free_qty
        FROM scheme_usage_log l WHERE {flt}
        GROUP BY l.scheme_id, l.scheme_name, l.scheme_type ORDER BY discount_given DESC NULLS LAST"""), p)).mappings().all()
    detail = (await db.execute(text(f"""
        SELECT l.applied_at, l.invoice_id, l.invoice_no, l.scheme_name, l.benefit_type, l.discount_given, l.free_qty,
               fp.name AS free_product, cu.name AS customer, o.outlet_name, l.note
        FROM scheme_usage_log l
        LEFT JOIN products fp ON fp.id = l.free_product_id
        LEFT JOIN customers cu ON cu.id = l.customer_id
        LEFT JOIN outlets o ON o.id = l.outlet_id
        WHERE {flt} ORDER BY l.applied_at DESC LIMIT 500"""), p)).mappings().all()
    return {"summary": summary, "detail": detail}


@router.post("/evaluate")
async def evaluate(body: eval_in, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await scheme_service.evaluate(
        db, items=[i.model_dump() for i in body.items], customer_id=body.customer_id, outlet_id=body.outlet_id,
        payment_mode=body.payment_mode.lower(), bill_date=body.bill_date, at=body.at)


@router.get("/{scheme_id}")
async def get_scheme(scheme_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    r = (await db.execute(text("SELECT * FROM schemes WHERE id = :i"), {"i": scheme_id})).mappings().first()
    if not r:
        raise HTTPException(404, "Scheme not found")
    s = dict(r)
    pids = set(s["product_ids"] or []) | {x for x in [s["free_item_id"]] if x}
    pids |= {f["product_id"] for f in s["free_items"]} | {sl.get("free_item_id") for sl in s["slabs"] if sl.get("free_item_id")}
    for g in s["mix_groups"]:
        pids |= set(g.get("product_ids") or [])
    names = dict((await db.execute(text("SELECT id, name FROM products WHERE id = ANY(:p)"), {"p": list(pids)})).all()) if pids else {}
    s["product_names"] = {str(k): v for k, v in names.items()}
    cids = s["customer_ids"] or []
    s["customer_names"] = {str(k): v for k, v in (await db.execute(
        text("SELECT id, name FROM customers WHERE id = ANY(:c)"), {"c": cids})).all()} if cids else {}
    s["type_label"] = TYPE_LABELS.get(s["scheme_type"])
    s["log"] = (await db.execute(text(
        "SELECT applied_at, invoice_id, invoice_no, benefit_type, discount_given, free_qty, note FROM scheme_usage_log "
        "WHERE scheme_id = :i ORDER BY applied_at DESC LIMIT 20"), {"i": scheme_id})).mappings().all()
    return s


@router.post("")
async def create_scheme(body: scheme_in, db: AsyncSession = Depends(get_db), user=Depends(editor)):
    _validate(body)
    p = _params(body)
    jsonb = {"slabs", "free_items", "mix_groups"}
    vals = ", ".join(f"CAST(:{c} AS JSONB)" if c in jsonb else f":{c}" for c in COLS)
    new_id = (await db.execute(text(f"INSERT INTO schemes ({', '.join(COLS)}, created_by) VALUES ({vals}, :uid) RETURNING id"),
                               {**p, "uid": user.user_id})).scalar()
    await write_audit(db=db, module="schemes", action="create_scheme", record_id=new_id, record_no=body.name,
                      description=f"Scheme '{body.name}' ({body.scheme_type}) created", user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"id": new_id}


@router.put("/{scheme_id}")
async def update_scheme(scheme_id: int, body: scheme_in, db: AsyncSession = Depends(get_db), user=Depends(editor)):
    _validate(body)
    p = _params(body)
    jsonb = {"slabs", "free_items", "mix_groups"}
    sets = ", ".join(f"{c} = CAST(:{c} AS JSONB)" if c in jsonb else f"{c} = :{c}" for c in COLS)
    n = (await db.execute(text(f"UPDATE schemes SET {sets}, updated_at = NOW() WHERE id = :id"), {**p, "id": scheme_id})).rowcount
    if not n:
        raise HTTPException(404, "Scheme not found")
    await write_audit(db=db, module="schemes", action="update_scheme", record_id=scheme_id, record_no=body.name,
                      description=f"Scheme '{body.name}' updated", user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"success": True}


@router.post("/{scheme_id}/toggle")
async def toggle_scheme(scheme_id: int, db: AsyncSession = Depends(get_db), user=Depends(editor)):
    r = (await db.execute(text("UPDATE schemes SET is_active = NOT is_active, updated_at = NOW() WHERE id = :i "
                               "RETURNING name, is_active"), {"i": scheme_id})).first()
    if not r:
        raise HTTPException(404, "Scheme not found")
    await write_audit(db=db, module="schemes", action="toggle_scheme", record_id=scheme_id, record_no=r[0],
                      description=f"Scheme '{r[0]}' {'activated' if r[1] else 'deactivated'}", user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"is_active": r[1]}


@router.post("/{scheme_id}/clone")
async def clone_scheme(scheme_id: int, db: AsyncSession = Depends(get_db), user=Depends(editor)):
    cols = ", ".join(c for c in COLS if c not in ("name", "is_active"))
    new_id = (await db.execute(text(
        f"INSERT INTO schemes (name, is_active, {cols}, created_by) SELECT LEFT(name || ' (Copy)', 150), FALSE, {cols}, :u "
        "FROM schemes WHERE id = :i RETURNING id"), {"i": scheme_id, "u": user.user_id})).scalar()
    if not new_id:
        raise HTTPException(404, "Scheme not found")
    await db.commit()
    return {"id": new_id}


@router.delete("/{scheme_id}")
async def delete_scheme(scheme_id: int, db: AsyncSession = Depends(get_db), user=Depends(editor)):
    used = (await db.execute(text("SELECT COUNT(*) FROM scheme_usage_log WHERE scheme_id = :i"), {"i": scheme_id})).scalar()
    if used:
        raise HTTPException(400, f"This scheme was applied on {used} bill line(s) — deactivate it instead of deleting, so reports stay complete.")
    name = (await db.execute(text("DELETE FROM schemes WHERE id = :i RETURNING name"), {"i": scheme_id})).scalar()
    if not name:
        raise HTTPException(404, "Scheme not found")
    await write_audit(db=db, module="schemes", action="delete_scheme", record_id=scheme_id, record_no=name,
                      description=f"Scheme '{name}' deleted", user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"success": True}
