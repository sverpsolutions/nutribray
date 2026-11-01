"""Manufacturing Phase A: customer brands, artwork, packaging specs, item units, department stores & stock.

Lives under /manufacturing/... so User Management's 'manufacturing' permissions apply (view / create / edit /
approve …). Approval endpoints also refuse a user approving their own request (admins excepted).
"""
import json
import os
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.services import mfg_stock_service as stk
from app.services.auth_service import write_audit

router = APIRouter(prefix="/manufacturing", tags=["manufacturing setup"])
ADMIN = ("admin", "superadmin")


async def _rows(db, sql, p=None):
    return [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()} for r in (await db.execute(text(sql), p or {})).mappings().all()]


async def _audit(db, user, action, rid, no, desc):
    await write_audit(db=db, module="manufacturing", action=action, record_id=rid or 0, record_no=no, description=desc,
                      user_id=user.user_id, user_name=user.username)


def _not_own(requested_by, user):
    if requested_by == user.user_id and user.role not in ADMIN:
        raise HTTPException(403, "You cannot approve your own request. Ask another approver.")


# ── uploads (artwork files, packaging photos) ─────────────────────────────────
ALLOWED = {".png", ".jpg", ".jpeg", ".webp", ".pdf", ".ai", ".cdr", ".svg"}


@router.post("/master/file")
async def upload(file: UploadFile = File(...), user=Depends(get_current_user)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED:
        raise HTTPException(400, f"Allowed files: {', '.join(sorted(ALLOWED))}")
    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(400, "File is larger than 15 MB.")
    os.makedirs("uploads/mfg", exist_ok=True)
    name = f"mfg_{datetime.now():%Y%m%d%H%M%S}_{uuid.uuid4().hex[:8]}{ext}"
    with open(os.path.join("uploads/mfg", name), "wb") as fh:
        fh.write(data)
    return {"path": f"/uploads/mfg/{name}", "name": file.filename}


# ── brands ────────────────────────────────────────────────────────────────────
class brand_in(BaseModel):
    code: str = Field(min_length=2, max_length=30)
    name: str = Field(min_length=2, max_length=120)
    customer_id: Optional[int] = None
    is_own_brand: bool = False
    notes: Optional[str] = None
    is_active: bool = True


@router.get("/brands")
async def list_brands(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _rows(db, """SELECT b.*, c.name AS customer_name, c.customer_code, c.gst_number, c.phone,
        (SELECT COUNT(*) FROM mfg_pack_specs s WHERE s.brand_id = b.id AND s.status = 'APPROVED') AS specs,
        (SELECT COUNT(*) FROM mfg_artworks a WHERE a.brand_id = b.id AND a.status = 'APPROVED') AS artworks
        FROM mfg_brands b LEFT JOIN customers c ON c.id = b.customer_id ORDER BY b.is_own_brand DESC, c.name, b.name""")


@router.post("/brands")
async def create_brand(b: brand_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if not b.is_own_brand and not b.customer_id:
        raise HTTPException(400, "Choose the customer this brand belongs to, or tick 'Own brand'.")
    if (await db.execute(text("SELECT 1 FROM mfg_brands WHERE UPPER(code) = UPPER(:c)"), {"c": b.code})).first():
        raise HTTPException(400, f"Brand code {b.code} already exists.")
    bid = (await db.execute(text("""INSERT INTO mfg_brands (code, name, customer_id, is_own_brand, notes, is_active, created_by)
        VALUES (UPPER(:code), :name, :cid, :own, :notes, :act, :u) RETURNING id"""),
        {"code": b.code, "name": b.name, "cid": None if b.is_own_brand else b.customer_id, "own": b.is_own_brand,
         "notes": b.notes, "act": b.is_active, "u": user.user_id})).scalar()
    await _audit(db, user, "create_brand", bid, b.code.upper(), f"Brand {b.name} created")
    await db.commit()
    return {"id": bid}


@router.put("/brands/{bid}")
async def update_brand(bid: int, b: brand_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    n = (await db.execute(text("""UPDATE mfg_brands SET name = :name, customer_id = :cid, is_own_brand = :own, notes = :notes,
        is_active = :act WHERE id = :id"""), {"name": b.name, "cid": None if b.is_own_brand else b.customer_id, "own": b.is_own_brand,
                                              "notes": b.notes, "act": b.is_active, "id": bid})).rowcount
    if not n:
        raise HTTPException(404, "Brand not found")
    await _audit(db, user, "update_brand", bid, b.code, f"Brand {b.name} updated")
    await db.commit()
    return {"success": True}


# ── artwork & packaging specs (revisioned, approve supersedes, history kept) ──
class artwork_in(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    brand_id: int
    title: str = Field(min_length=2, max_length=150)
    applies_to: str = "TIN"
    colours: Optional[str] = None
    description: Optional[str] = None
    file_path: Optional[str] = None
    effective_from: Optional[date] = None


class spec_in(BaseModel):
    spec_code: str = Field(min_length=2, max_length=40)
    brand_id: int
    product_id: int
    customer_item_code: Optional[str] = None
    product_spec: Optional[str] = None
    tin_size: Optional[str] = None
    tin_type: Optional[str] = None
    cap_type: Optional[str] = None
    cap_colour: Optional[str] = None
    printing_colour: Optional[str] = None
    packaging_instructions: Optional[str] = None
    units_per_carton: int = Field(1, ge=1)
    std_pack_qty: Optional[Decimal] = None
    quality_requirements: Optional[str] = None
    tin_artwork_id: Optional[int] = None
    cap_artwork_id: Optional[int] = None
    label_artwork_id: Optional[int] = None
    carton_artwork_id: Optional[int] = None
    printed_tin_item_id: Optional[int] = None
    cap_item_id: Optional[int] = None
    label_item_id: Optional[int] = None
    carton_item_id: Optional[int] = None
    photos: list[str] = []
    effective_from: Optional[date] = None


TABLES = {"artworks": ("mfg_artworks", "code", artwork_in), "specs": ("mfg_pack_specs", "spec_code", spec_in)}


def _cols(model) -> list[str]:
    return list(model.model_fields)


@router.get("/master/artworks")
async def list_artworks(brand_id: Optional[int] = None, status: Optional[str] = None, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _rows(db, """SELECT a.*, b.name AS brand_name, b.code AS brand_code, c.name AS customer_name
        FROM mfg_artworks a JOIN mfg_brands b ON b.id = a.brand_id LEFT JOIN customers c ON c.id = b.customer_id
        WHERE (CAST(:b AS INT) IS NULL OR a.brand_id = :b) AND (CAST(:s AS TEXT) IS NULL OR a.status = :s)
        ORDER BY a.code, a.revision DESC""", {"b": brand_id, "s": status})


@router.get("/master/specs")
async def list_specs(brand_id: Optional[int] = None, status: Optional[str] = None, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _rows(db, """SELECT s.*, b.name AS brand_name, b.code AS brand_code, b.is_own_brand, c.name AS customer_name,
        p.name AS product_name, p.item_code,
        pt.name AS printed_tin_name, pt.item_code AS printed_tin_code, cp.name AS cap_name, lb.name AS label_name, ct.name AS carton_name,
        ta.code || ' r' || ta.revision AS tin_artwork, ca.code || ' r' || ca.revision AS cap_artwork,
        la.code || ' r' || la.revision AS label_artwork, ka.code || ' r' || ka.revision AS carton_artwork, ta.file_path AS tin_artwork_file
        FROM mfg_pack_specs s JOIN mfg_brands b ON b.id = s.brand_id LEFT JOIN customers c ON c.id = b.customer_id
        JOIN products p ON p.id = s.product_id
        LEFT JOIN products pt ON pt.id = s.printed_tin_item_id LEFT JOIN products cp ON cp.id = s.cap_item_id
        LEFT JOIN products lb ON lb.id = s.label_item_id LEFT JOIN products ct ON ct.id = s.carton_item_id
        LEFT JOIN mfg_artworks ta ON ta.id = s.tin_artwork_id LEFT JOIN mfg_artworks ca ON ca.id = s.cap_artwork_id
        LEFT JOIN mfg_artworks la ON la.id = s.label_artwork_id LEFT JOIN mfg_artworks ka ON ka.id = s.carton_artwork_id
        WHERE (CAST(:b AS INT) IS NULL OR s.brand_id = :b) AND (CAST(:s AS TEXT) IS NULL OR s.status = :s)
        ORDER BY s.spec_code, s.revision DESC""", {"b": brand_id, "s": status})


async def _check_spec(db, body: spec_in):
    if (await db.execute(text("SELECT is_active FROM mfg_brands WHERE id = :b"), {"b": body.brand_id})).scalar() is not True:
        raise HTTPException(400, "Choose an active brand.")
    for f in ("tin_artwork_id", "cap_artwork_id", "label_artwork_id", "carton_artwork_id"):
        aid = getattr(body, f)
        if aid:
            br = (await db.execute(text("SELECT brand_id FROM mfg_artworks WHERE id = :a AND status <> 'INACTIVE'"), {"a": aid})).scalar()
            if br != body.brand_id:
                raise HTTPException(400, f"{f.replace('_artwork_id', '').title()} artwork belongs to another brand — another customer's design cannot be used.")


@router.post("/master/{kind}")
async def create_versioned(kind: str, body: dict, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if kind not in TABLES:
        raise HTTPException(404, "Not found")
    table, code_col, model = TABLES[kind]
    b = model(**body)
    if kind == "specs":
        await _check_spec(db, b)
    if kind == "artworks" and b.applies_to not in ("TIN", "CAP", "LABEL", "CARTON", "POUCH", "OTHER"):
        raise HTTPException(400, "Unknown artwork type.")
    code = getattr(b, code_col).upper()
    if (await db.execute(text(f"SELECT 1 FROM {table} WHERE UPPER({code_col}) = :c"), {"c": code})).first():
        raise HTTPException(400, f"{code} already exists — open it and create a new revision instead.")
    data = b.model_dump()
    data[code_col] = code
    if "photos" in data:
        data["photos"] = json.dumps(data["photos"])
    cols = list(data)
    vals = ", ".join(f"CAST(:{c} AS JSONB)" if c == "photos" else f":{c}" for c in cols)
    rid = (await db.execute(text(f"INSERT INTO {table} ({', '.join(cols)}, created_by) VALUES ({vals}, :u) RETURNING id"),
                            {**data, "u": user.user_id})).scalar()
    await _audit(db, user, f"create_{kind[:-1]}", rid, code, f"{kind[:-1].title()} {code} r1 created (draft)")
    await db.commit()
    return {"id": rid}


@router.put("/master/{kind}/{rid}")
async def update_versioned(kind: str, rid: int, body: dict, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if kind not in TABLES:
        raise HTTPException(404, "Not found")
    table, code_col, model = TABLES[kind]
    cur = (await db.execute(text(f"SELECT status, {code_col} AS code, revision FROM {table} WHERE id = :i"), {"i": rid})).mappings().first()
    if not cur:
        raise HTTPException(404, "Not found")
    if cur["status"] != "DRAFT":
        raise HTTPException(400, f"{cur['code']} r{cur['revision']} is {cur['status'].lower()} and cannot be changed. Create a new revision.")
    b = model(**{**body, code_col: cur["code"]})
    if kind == "specs":
        await _check_spec(db, b)
    data = {k: v for k, v in b.model_dump().items() if k != code_col}
    if "photos" in data:
        data["photos"] = json.dumps(data["photos"])
    sets = ", ".join(f"{c} = CAST(:{c} AS JSONB)" if c == "photos" else f"{c} = :{c}" for c in data)
    await db.execute(text(f"UPDATE {table} SET {sets} WHERE id = :id"), {**data, "id": rid})
    await _audit(db, user, f"update_{kind[:-1]}", rid, cur["code"], f"{cur['code']} r{cur['revision']} draft edited")
    await db.commit()
    return {"success": True}


@router.post("/master/{kind}/{rid}/approve")
async def approve_versioned(kind: str, rid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Approve a draft. The previously approved revision of the same code becomes SUPERSEDED (kept, never deleted)."""
    if kind not in TABLES:
        raise HTTPException(404, "Not found")
    table, code_col, _ = TABLES[kind]
    cur = (await db.execute(text(f"SELECT status, {code_col} AS code, revision, created_by FROM {table} WHERE id = :i FOR UPDATE"),
                            {"i": rid})).mappings().first()
    if not cur:
        raise HTTPException(404, "Not found")
    if cur["status"] != "DRAFT":
        raise HTTPException(400, f"Only a draft can be approved (this one is {cur['status'].lower()}).")
    _not_own(cur["created_by"], user)
    today = stk.today()
    await db.execute(text(f"""UPDATE {table} SET status = 'SUPERSEDED', effective_to = :y
        WHERE {code_col} = :c AND status = 'APPROVED'"""), {"c": cur["code"], "y": today - timedelta(days=1)})
    await db.execute(text(f"""UPDATE {table} SET status = 'APPROVED', approved_by = :u, approved_at = NOW(),
        effective_from = COALESCE(effective_from, :t) WHERE id = :i"""), {"u": user.user_id, "t": today, "i": rid})
    await _audit(db, user, f"approve_{kind[:-1]}", rid, cur["code"], f"{cur['code']} r{cur['revision']} approved")
    await db.commit()
    return {"success": True}


@router.post("/master/{kind}/{rid}/revise")
async def revise_versioned(kind: str, rid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """New draft revision copied from this one; the approved revision stays in force until the new one is approved."""
    if kind not in TABLES:
        raise HTTPException(404, "Not found")
    table, code_col, model = TABLES[kind]
    src = (await db.execute(text(f"SELECT * FROM {table} WHERE id = :i"), {"i": rid})).mappings().first()
    if not src:
        raise HTTPException(404, "Not found")
    if (await db.execute(text(f"SELECT 1 FROM {table} WHERE {code_col} = :c AND status = 'DRAFT'"), {"c": src[code_col]})).first():
        raise HTTPException(400, f"{src[code_col]} already has a draft revision — edit that one.")
    nxt = (await db.execute(text(f"SELECT MAX(revision) + 1 FROM {table} WHERE {code_col} = :c"), {"c": src[code_col]})).scalar()
    cols = [c for c in _cols(model)]
    vals = ", ".join(f"CAST(:{c} AS JSONB)" if c == "photos" else f":{c}" for c in cols)
    data = {c: (json.dumps(src[c]) if c == "photos" else src[c]) for c in cols}
    data["effective_from"] = None
    new_id = (await db.execute(text(f"INSERT INTO {table} ({', '.join(cols)}, revision, created_by) VALUES ({vals}, :r, :u) RETURNING id"),
                               {**data, "r": nxt, "u": user.user_id})).scalar()
    await _audit(db, user, f"revise_{kind[:-1]}", new_id, src[code_col], f"{src[code_col]} r{nxt} draft created from r{src['revision']}")
    await db.commit()
    return {"id": new_id, "revision": nxt}


@router.put("/master/{kind}/{rid}/deactivate")
async def deactivate_versioned(kind: str, rid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if kind not in TABLES:
        raise HTTPException(404, "Not found")
    table, code_col, _ = TABLES[kind]
    code = (await db.execute(text(f"UPDATE {table} SET status = 'INACTIVE', effective_to = COALESCE(effective_to, CURRENT_DATE) "
                                  f"WHERE id = :i RETURNING {code_col}"), {"i": rid})).scalar()
    if not code:
        raise HTTPException(404, "Not found")
    await _audit(db, user, f"deactivate_{kind[:-1]}", rid, code, f"{code} set inactive")
    await db.commit()
    return {"success": True}


# ── item units & conversion ───────────────────────────────────────────────────
class uom_in(BaseModel):
    unit: str = Field(min_length=1, max_length=20)
    factor: Decimal = Field(gt=0)
    for_purchase: bool = False
    for_stock: bool = False
    for_production: bool = False
    for_packing: bool = False
    for_sales: bool = False


@router.get("/items/{pid}/units")
async def item_units(pid: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    it = await stk.item(db, pid)
    units = await _rows(db, "SELECT unit, factor, for_purchase, for_stock, for_production, for_packing, for_sales FROM mfg_item_uoms "
                            "WHERE product_id = :p ORDER BY factor", {"p": pid})
    return {"item": {**it, "units_per_carton": int(it["units_per_carton"])}, "units": units}


@router.put("/items/{pid}/units")
async def save_item_units(pid: int, body: list[uom_in], db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    it = await stk.item(db, pid)
    seen = set()
    for u in body:
        key = u.unit.upper()
        if key in seen or key == it["unit"]:
            raise HTTPException(400, f"Unit {key} is listed twice or is the item's base unit ({it['unit']}).")
        seen.add(key)
    await db.execute(text("DELETE FROM mfg_item_uoms WHERE product_id = :p"), {"p": pid})
    for u in body:
        await db.execute(text("""INSERT INTO mfg_item_uoms (product_id, unit, factor, for_purchase, for_stock, for_production, for_packing, for_sales)
            VALUES (:p, :unit, :factor, :fp, :fs, :fpr, :fpk, :fsl)"""),
            {"p": pid, "unit": u.unit.upper(), "factor": u.factor, "fp": u.for_purchase, "fs": u.for_stock, "fpr": u.for_production,
             "fpk": u.for_packing, "fsl": u.for_sales})
    await _audit(db, user, "item_units", pid, it["item_code"], f"Units for {it['name']}: " + ", ".join(f"{u.unit.upper()}={u.factor}" for u in body))
    await db.commit()
    return {"success": True}


@router.get("/convert")
async def convert(product_id: int, qty: Decimal, unit: Optional[str] = None, units_per_carton: Optional[int] = None,
                  db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    it = await stk.item(db, product_id)
    base = await stk.to_base(db, product_id, qty, unit, units_per_carton)
    c = stk.cartons(base, units_per_carton or int(it["units_per_carton"]))
    return {"base_unit": it["unit"], "base_qty": float(base), "cartons": c["cartons"], "loose": float(c["loose"]),
            "units_per_carton": c["units_per_carton"]}

class export_in(BaseModel):
    title: str = Field(max_length=120)
    meta: list[list] = []
    cols: list[str]
    rows: list[list]


@router.post("/export/xlsx")
async def export_xlsx(b: export_in, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Any report table as an Excel file with the company logo, name and address in the heading."""
    from fastapi.responses import Response
    from app.services import mfg_export
    data = mfg_export.build(await mfg_export.company_head(db), b.title, b.meta, b.cols, b.rows)
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="report.xlsx"'})



# -- department access: admins see every store, other users only the stores assigned to them ------------
ADMIN_ROLES = ("admin", "superadmin", "super_admin")


async def _scope(db, user):
    """None = every store (admin); otherwise the list of store ids this user may see."""
    if user.role in ADMIN_ROLES:
        return None
    return list((await db.execute(text("SELECT store_id FROM mfg_user_stores WHERE user_id = :u"), {"u": user.user_id})).scalars().all()) or [0]


def _one(scope, store_id):
    """Store filter for views that need a single store: a restricted user is held to one of their own."""
    if scope is None:
        return store_id
    if store_id and store_id not in scope:
        raise HTTPException(403, "You do not have access to that department.")
    return store_id or scope[0]


@router.get("/store-access/me")
async def my_store_access(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    sc = await _scope(db, user)
    return {"all": sc is None, "store_ids": sc or [], "admin": user.role in ADMIN_ROLES}


@router.get("/store-access")
async def store_access(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Only an administrator can assign departments.")
    return await _rows(db, """SELECT u.id, u.name, u.username, u.role, u.department, u.designation,
        COALESCE((SELECT array_agg(store_id ORDER BY store_id) FROM mfg_user_stores x WHERE x.user_id = u.id), '{}') AS store_ids
        FROM users u WHERE u.status IS TRUE ORDER BY u.name""")


class store_access_in(BaseModel):
    store_ids: list[int] = []


@router.put("/store-access/{uid}")
async def set_store_access(uid: int, b: store_access_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Only an administrator can assign departments.")
    await db.execute(text("DELETE FROM mfg_user_stores WHERE user_id = :u"), {"u": uid})
    for sid in set(b.store_ids):
        await db.execute(text("INSERT INTO mfg_user_stores (user_id, store_id) VALUES (:u, :s)"), {"u": uid, "s": sid})
    await _audit(db, user, "store_access", uid, str(uid), f"Departments for user {uid}: {sorted(set(b.store_ids))}")
    await db.commit()
    return {"success": True}


# ── stores, stock, ledger ─────────────────────────────────────────────────────
@router.get("/stores")
async def list_stores(for_pick: bool = False, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    sc = None if for_pick else await _scope(db, user)   # for_pick: every department as a destination in a form
    return await _rows(db, """SELECT s.*, o.outlet_name, COALESCE(x.items, 0) AS items, COALESCE(x.qty, 0) AS qty
        FROM mfg_stores s LEFT JOIN outlets o ON o.id = s.outlet_id
        LEFT JOIN (SELECT store_id, COUNT(*) FILTER (WHERE qty > 0) AS items, SUM(qty) AS qty FROM mfg_stock GROUP BY 1) x ON x.store_id = s.id
        WHERE (CAST(:a AS INT[]) IS NULL OR s.id = ANY(:a)) ORDER BY s.sort, s.id""", {"a": sc})


class store_in(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    outlet_id: Optional[int] = None
    usable: bool = True
    is_active: bool = True


@router.put("/stores/{sid}")
async def update_store(sid: int, b: store_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    n = (await db.execute(text("UPDATE mfg_stores SET name = :n, outlet_id = :o, usable = :u, is_active = :a WHERE id = :i"),
                          {"n": b.name, "o": b.outlet_id, "u": b.usable, "a": b.is_active, "i": sid})).rowcount
    if not n:
        raise HTTPException(404, "Store not found")
    await _audit(db, user, "update_store", sid, b.name, f"Store {b.name} updated")
    await db.commit()
    return {"success": True}


@router.get("/stock")
async def store_stock(store_id: Optional[int] = None, brand_id: Optional[int] = None, search: str = "", show_zero: bool = False,
                      db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    sc = await _scope(db, user)
    _one(sc, store_id)
    rows = await _rows(db, """SELECT st.code AS store_code, st.name AS store, st.kind, st.usable, st.is_wip, s.store_id,
        s.product_id, p.item_code, p.name AS item, UPPER(COALESCE(p.unit, 'PCS')) AS unit, s.batch_no, s.brand_id,
        b.name AS brand, b.code AS brand_code, s.qty, COALESCE(NULLIF(pk.total_units_per_carton, 0), 1) AS units_per_carton,
        COALESCE(p.cost_price, 0) * s.qty AS value
        FROM mfg_stock s JOIN mfg_stores st ON st.id = s.store_id JOIN products p ON p.id = s.product_id
        LEFT JOIN mfg_brands b ON b.id = s.brand_id LEFT JOIN item_packaging_master pk ON pk.product_id = p.id AND pk.is_active
        WHERE (CAST(:s AS INT) IS NULL OR s.store_id = :s) AND (CAST(:a AS INT[]) IS NULL OR s.store_id = ANY(:a)) AND (CAST(:b AS INT) IS NULL OR s.brand_id = :b)
          AND (:show OR s.qty <> 0) AND (:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q OR s.batch_no ILIKE :q)
        ORDER BY st.sort, p.name, s.batch_no""", {"s": store_id, "a": sc, "b": brand_id, "show": show_zero, "q": f"%{search.strip()}%"})
    for r in rows:
        c = stk.cartons(r["qty"], int(r["units_per_carton"]))
        r["cartons"], r["loose"] = c["cartons"], float(c["loose"])
    return rows


@router.get("/ledger")
async def ledger(store_id: Optional[int] = None, product_id: Optional[int] = None, from_date: Optional[date] = None,
                 to_date: Optional[date] = None, search: str = "", db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    sc = await _scope(db, user)
    _one(sc, store_id)
    return await _rows(db, """SELECT t.id, t.doc_no, t.txn_type, TO_CHAR(t.posted_at, 'DD Mon YYYY HH24:MI') AS posted,
        p.item_code, p.name AS item, UPPER(COALESCE(p.unit, 'PCS')) AS unit, t.batch_no, b.name AS brand,
        fs.name AS from_store, ts.name AS to_store, t.qty, t.unit_entered, t.qty_entered, t.ref_no, t.remarks, u.name AS posted_by,
        t.reversal_of, (SELECT r.doc_no FROM mfg_stock_txns r WHERE r.reversal_of = t.id) AS reversed_by
        FROM mfg_stock_txns t JOIN products p ON p.id = t.product_id LEFT JOIN mfg_brands b ON b.id = t.brand_id
        LEFT JOIN mfg_stores fs ON fs.id = t.from_store_id LEFT JOIN mfg_stores ts ON ts.id = t.to_store_id
        LEFT JOIN users u ON u.id = t.posted_by
        WHERE (CAST(:s AS INT) IS NULL OR t.from_store_id = :s OR t.to_store_id = :s) AND (CAST(:p AS INT) IS NULL OR t.product_id = :p)
          AND (CAST(:a AS INT[]) IS NULL OR t.from_store_id = ANY(:a) OR t.to_store_id = ANY(:a))
          AND (CAST(:fd AS DATE) IS NULL OR CAST(t.posted_at AS date) >= :fd)
          AND (CAST(:td AS DATE) IS NULL OR CAST(t.posted_at AS date) <= :td)
          AND (:q = '%%' OR t.doc_no ILIKE :q OR p.name ILIKE :q OR t.ref_no ILIKE :q OR t.batch_no ILIKE :q)
        ORDER BY t.id DESC LIMIT 2000""", {"s": store_id, "a": sc, "p": product_id, "fd": from_date, "td": to_date, "q": f"%{search.strip()}%"})

_DELTA = """CASE WHEN CAST(:s AS INT) IS NULL THEN (CASE WHEN t.from_store_id IS NULL THEN t.qty WHEN t.to_store_id IS NULL THEN -t.qty ELSE 0 END)
    ELSE (CASE WHEN t.to_store_id = :s THEN t.qty ELSE 0 END) - (CASE WHEN t.from_store_id = :s THEN t.qty ELSE 0 END) END"""
_UPC = "COALESCE((SELECT NULLIF(MAX(pk.total_units_per_carton), 0) FROM item_packaging_master pk WHERE pk.product_id = p.id), 1)"


def _story(r: dict) -> str:
    """One plain sentence saying what the movement was, who it was for and where the stock went."""
    t, who = r["txn_type"], (f" for {r['customer']}" if r.get("customer") else "") + (f" (order {r['so_no']})" if r.get("so_no") else "")
    mo = r.get("order_no") or r.get("ref_no") or ""
    if t == "OPENING": return "Opening stock entered"
    if t == "MATERIAL_ISSUE": return f"Issued to production {mo} to make {r.get('making') or '-'}{who}"
    if t == "CONSUME": return f"Used up in production {mo} making {r.get('making') or '-'}{who}"
    if t == "PRODUCE": return f"Produced in {mo}{who}; sent to {r['to_store'] or 'QC'}"
    if t == "QC_RELEASE": return f"Passed QC ({mo}); moved {r['from_store']} to {r['to_store']}{who}"
    if t == "TRANSFER": return f"Transferred {r['from_store']} to {r['to_store']} ({r.get('ref_no') or ''})"
    if t.startswith("COUNT"): return f"Stock take {r.get('ref_no') or ''}: {r.get('remarks') or ''}"
    return f"{t.replace('_', ' ').title()} {r.get('ref_no') or ''} {r.get('remarks') or ''}".strip()


@router.get("/ledger/item")
async def item_ledger(product_id: int, store_id: Optional[int] = None, from_date: Optional[date] = None, to_date: Optional[date] = None,
                      db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Running ledger of one item: opening, every movement with in / out / balance, closing. No store = whole plant (transfers net to zero)."""
    store_id = _one(await _scope(db, user), store_id)
    it = (await _rows(db, f"""SELECT p.id, p.item_code, p.name, p.item_type, p.manufacturer_name AS customer, UPPER(COALESCE(p.unit, 'PCS')) AS unit,
        {_UPC} AS units_per_carton FROM products p WHERE p.id = :p""", {"p": product_id}))
    if not it:
        raise HTTPException(404, "Item not found")
    rows = await _rows(db, f"""SELECT t.id, t.doc_no, t.txn_type, CAST(t.posted_at AS date) AS d,
        TO_CHAR(t.posted_at, 'DD Mon YYYY HH24:MI') AS posted, t.batch_no, b.name AS brand, fs.name AS from_store,
        ts.name AS to_store, t.ref_no, t.remarks, u.name AS posted_by, {_DELTA} AS delta,
        mo.order_no, mp.name AS making, so.so_no, c.name AS customer
        FROM mfg_stock_txns t LEFT JOIN mfg_brands b ON b.id = t.brand_id LEFT JOIN mfg_stores fs ON fs.id = t.from_store_id
        LEFT JOIN mfg_stores ts ON ts.id = t.to_store_id LEFT JOIN users u ON u.id = t.posted_by
        LEFT JOIN mfg_orders mo ON mo.order_no = t.ref_no AND t.ref_type IN ('mfg_order', 'mfg_output')
        LEFT JOIN products mp ON mp.id = mo.product_id LEFT JOIN mfg_sales_orders so ON so.id = mo.sales_order_id
        LEFT JOIN mfg_brands mb ON mb.id = mo.brand_id LEFT JOIN customers c ON c.id = COALESCE(so.customer_id, mb.customer_id)
        WHERE t.product_id = :p AND (CAST(:s AS INT) IS NULL OR t.from_store_id = :s OR t.to_store_id = :s)
          AND (CAST(:td AS DATE) IS NULL OR CAST(t.posted_at AS date) <= :td)
        ORDER BY t.id""", {"p": product_id, "s": store_id, "td": to_date})
    opening = sum((float(r["delta"]) for r in rows if from_date and r["d"] < from_date), 0.0)
    bal, out = opening, []
    for r in rows:
        if from_date and r["d"] < from_date:
            continue
        dl = float(r["delta"])
        bal += dl
        out.append({**r, "story": _story(r), "delta": dl, "d": str(r["d"]), "in": max(dl, 0), "out": max(-dl, 0), "balance": bal})
    orders = await _rows(db, """SELECT o.order_no, o.status, o.planned_qty, o.completed_qty, so.so_no, c.name AS customer, b.name AS brand, so.delivery_date, so.ordered_qty
        FROM mfg_orders o LEFT JOIN mfg_sales_orders so ON so.id = o.sales_order_id LEFT JOIN mfg_brands b ON b.id = o.brand_id
        LEFT JOIN customers c ON c.id = COALESCE(so.customer_id, b.customer_id) WHERE o.product_id = :p ORDER BY o.id DESC LIMIT 50""", {"p": product_id})
    used = await _rows(db, """SELECT mo.order_no, mp.name AS making, so.so_no, c.name AS customer, SUM(CASE WHEN t.txn_type = 'CONSUME' THEN t.qty ELSE 0 END) AS consumed,
        SUM(CASE WHEN t.txn_type = 'MATERIAL_ISSUE' THEN t.qty ELSE 0 END) AS issued
        FROM mfg_stock_txns t JOIN mfg_orders mo ON mo.order_no = t.ref_no AND t.ref_type = 'mfg_order' JOIN products mp ON mp.id = mo.product_id
        LEFT JOIN mfg_sales_orders so ON so.id = mo.sales_order_id LEFT JOIN mfg_brands mb ON mb.id = mo.brand_id LEFT JOIN customers c ON c.id = COALESCE(so.customer_id, mb.customer_id)
        WHERE t.product_id = :p AND t.txn_type IN ('CONSUME', 'MATERIAL_ISSUE') GROUP BY mo.order_no, mp.name, so.so_no, c.name ORDER BY mo.order_no DESC""", {"p": product_id})
    return {"orders": orders, "used_in": used, "item": it[0], "opening": opening, "closing": bal, "total_in": sum(r["in"] for r in out), "total_out": sum(r["out"] for r in out), "rows": out}


@router.get("/stock-report")
async def stock_report(store_id: Optional[int] = None, item_type: str = "", search: str = "", db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Stock held in each department, split by item type, with the item-level detail and what is out at printers."""
    sc = await _scope(db, user)
    _one(sc, store_id)
    rows = await _rows(db, f"""SELECT st.id AS store_id, st.code AS store_code, st.name AS store, st.sort, s.product_id, p.item_type, p.item_code, p.name AS item, p.manufacturer_name AS customer,
        UPPER(COALESCE(p.unit, 'PCS')) AS unit, s.batch_no, b.name AS brand, s.qty, {_UPC} AS units_per_carton, COALESCE(p.cost_price, 0) * s.qty AS value
        FROM mfg_stock s JOIN mfg_stores st ON st.id = s.store_id JOIN products p ON p.id = s.product_id LEFT JOIN mfg_brands b ON b.id = s.brand_id
        WHERE s.qty <> 0 AND (CAST(:s AS INT) IS NULL OR s.store_id = :s) AND (CAST(:a AS INT[]) IS NULL OR s.store_id = ANY(:a))
          AND (:ty = '' OR p.item_type = :ty) AND (:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q OR s.batch_no ILIKE :q OR p.manufacturer_name ILIKE :q)
        ORDER BY st.sort, p.item_type, p.name, s.batch_no""", {"s": store_id, "a": sc, "ty": item_type.upper(), "q": f"%{search.strip()}%"})
    for r in rows:
        c = stk.cartons(r["qty"], int(r["units_per_carton"]))
        r["cartons"], r["loose"] = c["cartons"], float(c["loose"])
    dept: dict = {}
    for r in rows:
        d = dept.setdefault(r["store_id"], {"store_id": r["store_id"], "store_code": r["store_code"], "store": r["store"], "items": set(), "value": 0.0, "types": {}})
        d["items"].add(r["item_code"])
        d["value"] += float(r["value"])
        t = d["types"].setdefault(r["item_type"], {"items": set(), "qty": 0.0})
        t["items"].add(r["item_code"])
        t["qty"] += float(r["qty"])
    matrix = [{"store_id": d["store_id"], "store_code": d["store_code"], "store": d["store"], "items": len(d["items"]), "value": d["value"],
               "types": {k: {"items": len(v["items"]), "qty": v["qty"]} for k, v in d["types"].items()}} for d in dept.values()]
    printer = [] if sc is not None else await _rows(db, """SELECT j.job_no, j.vendor_name, j.vendor_type, j.job_date, j.expected_return, j.status, p.item_code, p.name AS item,
        j.qty_issued - j.accepted_qty - j.rejected_qty - j.damaged_qty - j.lost_qty - j.returned_qty AS pending, b.name AS brand
        FROM mfg_print_jobs j JOIN products p ON p.id = COALESCE(j.plain_item_id, j.printed_item_id) LEFT JOIN mfg_brands b ON b.id = j.brand_id
        WHERE j.status IN ('ISSUED', 'PARTIAL') ORDER BY j.job_date""")
    for j in printer:
        j["job_date"], j["expected_return"] = str(j["job_date"]), str(j["expected_return"] or "")
    return {"matrix": matrix, "rows": rows, "printer": printer}


@router.get("/stock-summary")
async def stock_summary(store_id: Optional[int] = None, from_date: Optional[date] = None, to_date: Optional[date] = None, item_type: str = "",
                        search: str = "", only_active: bool = True, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Item-wise opening / received / issued / closing for a period, with cartons - the stock statement."""
    store_id = _one(await _scope(db, user), store_id)
    rows = await _rows(db, f"""SELECT p.id AS product_id, p.item_code, p.name AS item, p.item_type, p.manufacturer_name AS customer, UPPER(COALESCE(p.unit, 'PCS')) AS unit,
        {_UPC} AS units_per_carton,
        COALESCE(SUM(CASE WHEN CAST(:fd AS DATE) IS NOT NULL AND d < :fd THEN delta END), 0) AS opening,
        COALESCE(SUM(CASE WHEN delta > 0 AND (CAST(:fd AS DATE) IS NULL OR d >= :fd) THEN delta END), 0) AS received,
        COALESCE(SUM(CASE WHEN delta < 0 AND (CAST(:fd AS DATE) IS NULL OR d >= :fd) THEN -delta END), 0) AS issued,
        COALESCE(SUM(delta), 0) AS closing
        FROM products p LEFT JOIN (SELECT t.product_id, CAST(t.posted_at AS date) AS d, {_DELTA} AS delta
            FROM mfg_stock_txns t WHERE (CAST(:s AS INT) IS NULL OR t.from_store_id = :s OR t.to_store_id = :s)) x ON x.product_id = p.id
            AND (CAST(:td AS DATE) IS NULL OR x.d <= :td)
        WHERE p.item_type IN ('FG', 'RM', 'PM') AND (:ty = '' OR p.item_type = :ty) AND (:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q OR p.manufacturer_name ILIKE :q)
        GROUP BY p.id ORDER BY p.item_type, p.name""",
        {"s": store_id, "fd": from_date, "td": to_date, "ty": item_type.upper(), "q": f"%{search.strip()}%"})
    return [r for r in rows if not only_active or r["opening"] or r["received"] or r["issued"] or r["closing"]]


class move_line(BaseModel):
    product_id: int
    qty: Decimal = Field(gt=0)
    unit: Optional[str] = None
    batch_no: str = ""
    brand_id: int = 0


class opening_in(BaseModel):
    store_id: int
    lines: list[move_line] = Field(min_length=1)
    remarks: Optional[str] = None
    request_key: Optional[str] = Field(None, max_length=60)


@router.post("/stock/opening")
async def post_opening(b: opening_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Opening balance into a department store (stock already in the building when the module starts)."""
    if user.role not in ADMIN + ("manager",):
        raise HTTPException(403, "Only a manager or administrator can post opening stock.")
    doc = await stk.next_doc(db, "OPN")
    for i, ln in enumerate(b.lines):
        await stk.post(db, txn_type="OPENING", product_id=ln.product_id, qty_base=await stk.to_base(db, ln.product_id, ln.qty, ln.unit),
                       from_store=None, to_store=b.store_id, user_id=user.user_id, batch_no=ln.batch_no, brand_id=ln.brand_id,
                       unit_entered=ln.unit, qty_entered=ln.qty, ref_type="opening", ref_no=doc, remarks=b.remarks, doc_no=doc,
                       request_key=f"{b.request_key}:{i}" if b.request_key else None)
    await _audit(db, user, "opening_stock", 0, doc, f"Opening stock {doc}: {len(b.lines)} line(s)")
    await db.commit()
    return {"doc_no": doc}


class transfer_in(BaseModel):
    from_store_id: int
    to_store_id: int
    lines: list[move_line] = Field(min_length=1)
    remarks: Optional[str] = None


@router.get("/transfers")
async def list_transfers(status: Optional[str] = None, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    sc = await _scope(db, user)
    heads = await _rows(db, """SELECT t.*, COALESCE(fs.name, 'Warehouse: ' || wo.outlet_name) AS from_store, ts.name AS to_store, ru.name AS requested_by_name, au.name AS approved_by_name,
        TO_CHAR(t.requested_at, 'DD Mon YYYY HH24:MI') AS requested
        FROM mfg_transfers t LEFT JOIN mfg_stores fs ON fs.id = t.from_store_id LEFT JOIN outlets wo ON wo.id = t.from_outlet_id
        JOIN mfg_stores ts ON ts.id = t.to_store_id
        LEFT JOIN users ru ON ru.id = t.requested_by LEFT JOIN users au ON au.id = t.approved_by
        WHERE (CAST(:s AS TEXT) IS NULL OR t.status = :s) AND (CAST(:a AS INT[]) IS NULL OR t.from_store_id = ANY(:a) OR t.to_store_id = ANY(:a))
        ORDER BY t.id DESC LIMIT 500""", {"s": status, "a": sc})
    if heads:
        lines = await _rows(db, """SELECT l.*, p.name AS item, p.item_code, UPPER(COALESCE(p.unit, 'PCS')) AS unit, b.name AS brand,
            COALESCE((SELECT NULLIF(MAX(pk.total_units_per_carton), 0) FROM item_packaging_master pk WHERE pk.product_id = p.id), 1) AS units_per_carton
            FROM mfg_transfer_lines l JOIN products p ON p.id = l.product_id LEFT JOIN mfg_brands b ON b.id = l.brand_id
            WHERE l.transfer_id = ANY(:ids) ORDER BY l.id""", {"ids": [h["id"] for h in heads]})
        for h in heads:
            h["lines"] = [l for l in lines if l["transfer_id"] == h["id"]]
    return heads


@router.post("/transfers")
async def create_transfer(b: transfer_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if b.from_store_id == b.to_store_id:
        raise HTTPException(400, "Choose two different stores.")
    sc = await _scope(db, user)
    if sc is not None and b.from_store_id not in sc:
        raise HTTPException(403, "You can only send stock out of your own department.")
    no = await stk.next_doc(db, "TRF")
    tid = (await db.execute(text("""INSERT INTO mfg_transfers (transfer_no, from_store_id, to_store_id, remarks, requested_by)
        VALUES (:n, :f, :t, :r, :u) RETURNING id"""), {"n": no, "f": b.from_store_id, "t": b.to_store_id, "r": b.remarks, "u": user.user_id})).scalar()
    for ln in b.lines:
        base = await stk.to_base(db, ln.product_id, ln.qty, ln.unit)
        have = await stk.balance(db, b.from_store_id, ln.product_id, ln.batch_no, ln.brand_id)
        if have < base:
            it = await stk.item(db, ln.product_id)
            raise HTTPException(400, f"Only {have.normalize():f} {it['unit']} of '{it['name']}' in the source store; requested {base.normalize():f}.")
        await db.execute(text("""INSERT INTO mfg_transfer_lines (transfer_id, product_id, batch_no, brand_id, qty, unit_entered, qty_entered)
            VALUES (:t, :p, :b, :br, :q, :u, :qe)"""), {"t": tid, "p": ln.product_id, "b": ln.batch_no, "br": ln.brand_id, "q": base,
                                                         "u": ln.unit, "qe": ln.qty})
    await _audit(db, user, "create_transfer", tid, no, f"Transfer {no} requested ({len(b.lines)} line(s))")
    await db.commit()
    return {"id": tid, "transfer_no": no}


@router.post("/transfers/{tid}/approve")
async def approve_transfer(tid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    t = (await db.execute(text("SELECT * FROM mfg_transfers WHERE id = :i FOR UPDATE"), {"i": tid})).mappings().first()
    if not t:
        raise HTTPException(404, "Transfer not found")
    if t["status"] != "PENDING":
        raise HTTPException(400, f"Transfer {t['transfer_no']} is already {t['status'].lower()}.")
    _not_own(t["requested_by"], user)
    lines = (await db.execute(text("SELECT * FROM mfg_transfer_lines WHERE transfer_id = :i ORDER BY id"), {"i": tid})).mappings().all()
    if t["from_outlet_id"]:                       # warehouse (GRN location) -> plant store: leaves the outlet stock at the same moment
        from app.services.billing_service import _update_product_stock, _write_stock_ledger
        for ln in lines:
            q = stk.d(ln["qty"])
            have = stk.d((await db.execute(text("SELECT stock_qty FROM outlet_stock WHERE outlet_id = :o AND product_id = :p FOR UPDATE"),
                                           {"o": t["from_outlet_id"], "p": ln["product_id"]})).scalar())
            if have < q:
                it = await stk.item(db, ln["product_id"])
                raise HTTPException(400, f"Warehouse has only {have.normalize():f} {it['unit']} of '{it['name']}' (requested {q.normalize():f}).")
            await _update_product_stock(db, ln["product_id"], -q, t["from_outlet_id"])
            await _write_stock_ledger(db=db, product_id=ln["product_id"], txn_type="mfg_inward", qty=-q, ref_id=tid, ref_type="mfg_transfer",
                                      outlet_id=t["from_outlet_id"], notes=f"{t['transfer_no']} to plant store", user_id=user.user_id,
                                      batch_no=ln["batch_no"] or None)
            await stk.post(db, txn_type="INWARD", product_id=ln["product_id"], qty_base=q, from_store=None, to_store=t["to_store_id"],
                           user_id=user.user_id, batch_no=ln["batch_no"], brand_id=ln["brand_id"], ref_type="transfer", ref_id=tid,
                           ref_no=t["transfer_no"], doc_no=t["transfer_no"], request_key=f"trf:{tid}:{ln['id']}", remarks="From warehouse")
        lines = []
    for ln in lines:
        await stk.post(db, txn_type="TRANSFER", product_id=ln["product_id"], qty_base=ln["qty"], from_store=t["from_store_id"],
                       to_store=t["to_store_id"], user_id=user.user_id, batch_no=ln["batch_no"], brand_id=ln["brand_id"],
                       unit_entered=ln["unit_entered"], qty_entered=ln["qty_entered"], ref_type="transfer", ref_id=tid,
                       ref_no=t["transfer_no"], doc_no=t["transfer_no"], request_key=f"trf:{tid}:{ln['id']}")
    await db.execute(text("UPDATE mfg_transfers SET status = 'APPROVED', approved_by = :u, approved_at = NOW() WHERE id = :i"),
                     {"u": user.user_id, "i": tid})
    await _audit(db, user, "approve_transfer", tid, t["transfer_no"], f"Transfer {t['transfer_no']} approved and posted")
    await db.commit()
    return {"success": True}


class reason_in(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/transfers/{tid}/reject")
async def reject_transfer(tid: int, b: reason_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    no = (await db.execute(text("""UPDATE mfg_transfers SET status = 'REJECTED', approved_by = :u, approved_at = NOW(), reject_reason = :r
        WHERE id = :i AND status = 'PENDING' RETURNING transfer_no"""), {"u": user.user_id, "r": b.reason, "i": tid})).scalar()
    if not no:
        raise HTTPException(400, "Only a pending transfer can be rejected.")
    await _audit(db, user, "reject_transfer", tid, no, f"Transfer {no} rejected: {b.reason}")
    await db.commit()
    return {"success": True}


@router.post("/stock/txns/{txn_id}/reverse")
async def reverse_txn(txn_id: int, b: reason_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in ADMIN + ("manager",):
        raise HTTPException(403, "Only a manager or administrator can reverse a posted movement.")
    r = await stk.reverse(db, txn_id, user.user_id, b.reason)
    await _audit(db, user, "reverse_stock_movement", txn_id, r["doc_no"], f"Movement #{txn_id} reversed: {b.reason}")
    await db.commit()
    return r


# ── customer-wise finished goods from the company-grouped Excel (plant inventory) ──
@router.post("/import/customer-items")
async def import_customer_items(file: UploadFile = File(...), hsn: str = Query("", pattern=r"^(\d{4,8})?$"),
                                mrp: Decimal = Query(Decimal("300"), ge=0), commit: bool = False, create_missing: bool = False,
                                db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Preview first (nothing written); commit=true creates brands, items and carton packing in one transaction."""
    from app.services import mfg_customer_items as ci
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (10 MB max).")
    try:
        groups = ci.parse(data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(400, "Could not read the Excel file (.xlsx).")
    if not hsn and not all(g.get("kind") == "PM" for g in groups):
        raise HTTPException(400, "Enter the HSN for the finished goods.")
    p = await ci.plan(db, groups, hsn, Decimal(0) if groups and groups[0].get("kind") == "PM" else mrp)
    if not commit:
        return p
    return {**p, "result": await ci.commit(db, p, create_missing, user)}


@router.post("/import/boms")
async def import_boms(file: UploadFile = File(...), commit: bool = False, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """BOMs from Excel: preview first (nothing written); commit=true creates missing components + DRAFT BOMs for the ready rows."""
    from app.services import mfg_bom_import as bi
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "File too large (5 MB max).")
    try:
        rows = bi.parse(data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(400, "Could not read the Excel file (.xlsx).")
    p = await bi.plan(db, rows)
    if not commit:
        return p
    if not p["summary"]["ready"]:
        raise HTTPException(400, "No BOM is ready to import — fix the problems shown in the preview.")
    return {**p, "result": await bi.commit(db, p, user)}
