"""Administration → User Management: users + outlet / category / group access + module/action permissions.

Rules enforced here (server side, not just in the screen):
  * nobody changes their own role, status, scope or permissions;
  * only a superadmin touches superadmin accounts or hands out admin / superadmin;
  * a non-admin user manager can only grant permissions, outlets and categories they hold themselves;
  * every change is written to user_permission_audit with before / after, in the same transaction.
"""
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.security import hash_password
from app.routers.users import _block_if_busy

router = APIRouter(prefix="/access", tags=["user management"])
ADMIN = ("admin", "superadmin")


class user_access_in(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.@-]+$")
    password: str | None = Field(None, min_length=8, max_length=128)
    email: str | None = None
    mobile: str | None = Field(None, max_length=20)
    employee_code: str | None = Field(None, max_length=30)
    department: str | None = Field(None, max_length=60)
    designation: str | None = Field(None, max_length=60)
    role: str
    outlet_id: int | None = None             # default outlet
    status: bool = True
    valid_from: date | None = None
    valid_until: date | None = None
    all_outlets: bool = False
    outlet_ids: list[int] = []
    all_categories: bool = False
    category_ids: list[int] = []
    group_ids: list[int] = []                # item sub-categories; empty = all groups of the allowed categories
    permissions: list[str] = []              # effective module.action set wanted for this user
    mfg_store_ids: list[int] | None = None   # manufacturing departments the user may see; None = leave unchanged


class password_in(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


async def _actor(db, user) -> dict:
    """What the person making the change may hand out."""
    if user.role in ADMIN:
        return {"admin": True, "superadmin": user.role == "superadmin"}
    sc = await access.load_scope(db, user.user_id)
    return {"admin": False, "superadmin": False, "scope": sc,
            "perms": await access.effective_permissions(db, user.user_id, user.role, user.role_id)}


async def _snapshot(db, uid: int) -> dict:
    u = (await db.execute(text("SELECT * FROM users WHERE id = :u"), {"u": uid})).mappings().first()
    if not u:
        raise HTTPException(404, "User not found")
    outs = sorted((await db.execute(text("SELECT outlet_id FROM user_store_assignments WHERE user_id = :u"), {"u": uid})).scalars().all())
    cats = sorted((await db.execute(text("SELECT category_id FROM user_category_assignments WHERE user_id = :u"), {"u": uid})).scalars().all())
    grps = sorted((await db.execute(text("SELECT subcategory_id FROM user_subcategory_assignments WHERE user_id = :u"), {"u": uid})).scalars().all())
    perms = sorted(access.ALL_SLUGS) if u["role"] in ADMIN else sorted(
        await access.effective_permissions(db, uid, u["role"], u["role_id"]))
    return {"role": u["role"], "status": u["status"], "outlet_id": u["outlet_id"],
            "valid_from": str(u["valid_from"]) if u["valid_from"] else None,
            "valid_until": str(u["valid_until"]) if u["valid_until"] else None,
            "all_outlets": u["all_outlets"], "outlet_ids": outs, "all_categories": u["all_categories"],
            "category_ids": cats, "group_ids": grps, "permissions": perms}


def _diff(before: dict, after: dict) -> str:
    out = []
    for k in ("role", "status", "outlet_id", "valid_from", "valid_until", "all_outlets", "all_categories"):
        if before.get(k) != after.get(k):
            out.append(f"{k}: {before.get(k)} → {after.get(k)}")
    for k in ("outlet_ids", "category_ids", "group_ids", "permissions"):
        b, a = set(before.get(k) or []), set(after.get(k) or [])
        if a - b:
            out.append(f"+{k[:-4] if k.endswith('_ids') else k}: {', '.join(map(str, sorted(a - b)))}")
        if b - a:
            out.append(f"-{k[:-4] if k.endswith('_ids') else k}: {', '.join(map(str, sorted(b - a)))}")
    return "; ".join(out) or "no access change"


async def _save(db, uid: int, b: user_access_in, actor: dict, me) -> None:
    role_row = (await db.execute(text("SELECT id FROM roles WHERE slug = :r AND COALESCE(is_active, TRUE)"), {"r": b.role})).first()
    if not role_row:
        raise HTTPException(400, f"Unknown role '{b.role}'.")
    if b.role in ADMIN and not actor["admin"]:
        raise HTTPException(403, "Only an administrator can create administrators.")
    if b.role == "superadmin" and not actor["superadmin"]:
        raise HTTPException(403, "Only a super administrator can create super administrators.")
    if b.valid_from and b.valid_until and b.valid_until < b.valid_from:
        raise HTTPException(400, "'Valid until' is before 'valid from'.")
    bad = set(b.permissions) - set(access.ALL_SLUGS)
    if bad:
        raise HTTPException(400, f"Unknown permission(s): {', '.join(sorted(bad))}")

    outs, cats, grps = set(b.outlet_ids), set(b.category_ids), set(b.group_ids)
    if b.outlet_id and not b.all_outlets:
        outs.add(b.outlet_id)
    if b.role not in ADMIN and not b.all_outlets and not outs:
        raise HTTPException(400, "Give the user at least one outlet (or All outlets).")
    if b.role not in ADMIN and not b.all_categories and not cats:
        raise HTTPException(400, "Give the user at least one category (or All categories).")
    if outs and (await db.execute(text("SELECT COUNT(*) FROM outlets WHERE id = ANY(:o)"), {"o": list(outs)})).scalar() != len(outs):
        raise HTTPException(400, "One of the outlets does not exist.")
    if grps:
        rows = (await db.execute(text("SELECT id, category_id FROM item_subcategories WHERE id = ANY(:g)"), {"g": list(grps)})).all()
        if len(rows) != len(grps):
            raise HTTPException(400, "One of the groups does not exist.")
        if not b.all_categories and any(c not in cats for _, c in rows):
            raise HTTPException(400, "A selected group belongs to a category the user is not given.")

    if not actor["admin"]:  # no privilege escalation: hand out only what you hold
        sc = actor["scope"]
        if b.permissions and not set(b.permissions) <= actor["perms"]:
            raise HTTPException(403, "You cannot grant permissions you do not have: "
                                + ", ".join(sorted(set(b.permissions) - actor["perms"])[:6]))
        if sc["outlets"] is not None and (b.all_outlets or not outs <= sc["outlets"]):
            raise HTTPException(403, "You can only assign outlets you are assigned to.")
        if sc["categories"] is not None and (b.all_categories or not cats <= sc["categories"]):
            raise HTTPException(403, "You can only assign categories you are assigned to.")

    await db.execute(text("""UPDATE users SET name=:name, username=:username, email=:email, mobile=:mobile,
        employee_code=:employee_code, department=:department, designation=:designation, role=:role, role_id=:role_id,
        outlet_id=:outlet_id, status=:status, valid_from=:valid_from, valid_until=:valid_until,
        all_outlets=:all_outlets, all_categories=:all_categories, updated_by=:me, updated_at=NOW() WHERE id=:id"""),
        {**b.model_dump(exclude={"password", "outlet_ids", "category_ids", "group_ids", "permissions", "mfg_store_ids"}),
         "role_id": role_row[0], "me": me.user_id, "id": uid})
    for table, col, vals in (("user_store_assignments", "outlet_id", set() if b.all_outlets else outs),
                             ("user_category_assignments", "category_id", set() if b.all_categories else cats),
                             ("user_subcategory_assignments", "subcategory_id", grps)):
        await db.execute(text(f"DELETE FROM {table} WHERE user_id = :u"), {"u": uid})
        for v in sorted(vals):
            await db.execute(text(f"INSERT INTO {table} (user_id, {col}) VALUES (:u, :v)"), {"u": uid, "v": v})
    if b.mfg_store_ids is not None:
        await db.execute(text("DELETE FROM mfg_user_stores WHERE user_id = :u"), {"u": uid})
        for sid in set(b.mfg_store_ids):
            await db.execute(text("INSERT INTO mfg_user_stores (user_id, store_id) VALUES (:u, :s)"), {"u": uid, "s": sid})
    if b.outlet_id:
        await db.execute(text("UPDATE user_store_assignments SET is_primary = (outlet_id = :o) WHERE user_id = :u"),
                         {"o": b.outlet_id, "u": uid})

    # permissions: store only the difference from the role template, so a template change still reaches the user
    await db.execute(text("DELETE FROM user_granular_permissions WHERE user_id = :u"), {"u": uid})
    if b.role not in ADMIN:
        role_perms = await access.effective_permissions(db, -1, b.role, role_row[0])
        want = set(b.permissions)
        for slug, granted in [(s, True) for s in want - role_perms] + [(s, False) for s in role_perms - want]:
            await db.execute(text("INSERT INTO user_granular_permissions (user_id, slug, granted) VALUES (:u, :s, :g)"),
                             {"u": uid, "s": slug, "g": granted})


async def _audit(db, uid, before, after, me, request: Request, what: str):
    await db.execute(text("""INSERT INTO user_permission_audit (user_id, changed_by, changed_by_name, before, after, summary, ip_address)
        VALUES (:u, :by, :byn, CAST(:b AS JSONB), CAST(:a AS JSONB), :s, :ip)"""),
        {"u": uid, "by": me.user_id, "byn": me.username, "b": json.dumps(before) if before else None,
         "a": json.dumps(after) if after else None, "s": f"{what}: {_diff(before or {}, after or {})}"[:4000],
         "ip": request.client.host if request.client else None})


def _not_self(uid, me):
    if uid == me.user_id:
        raise HTTPException(403, "You cannot change your own access. Ask another administrator.")


async def _guard_target(db, uid, me):
    role = (await db.execute(text("SELECT role FROM users WHERE id = :u"), {"u": uid})).scalar()
    if role is None:
        raise HTTPException(404, "User not found")
    if role == "superadmin" and me.role != "superadmin":
        raise HTTPException(403, "Only a super administrator can change a super administrator.")
    if role in ADMIN and me.role not in ADMIN:
        raise HTTPException(403, "Only an administrator can change an administrator.")


# ── endpoints ────────────────────────────────────────────────────────────────

@router.get("/me")
async def my_access(db: AsyncSession = Depends(get_db), me=Depends(get_current_user)):
    """What the logged-in user may do — the screen uses it to hide menus; the server enforces it regardless."""
    if me.role in ADMIN:
        return {"admin": True, "permissions": access.ALL_SLUGS, "scope": None, "path_modules": access.PATHS}
    sc = await access.load_scope(db, me.user_id)
    return {"admin": False, "permissions": sorted(await access.effective_permissions(db, me.user_id, me.role, me.role_id)),
            "scope": {k: (sorted(v) if v is not None else None) for k, v in sc.items() if k != "user_id"}, "path_modules": access.PATHS}


@router.get("/catalog")
async def catalog(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    roles = (await db.execute(text("SELECT id, name, slug FROM roles WHERE COALESCE(is_active, TRUE) ORDER BY id"))).mappings().all()
    role_perms = {}
    for r in roles:
        role_perms[r["slug"]] = access.ALL_SLUGS if r["slug"] in ADMIN else sorted(
            await access.effective_permissions(db, -1, r["slug"], r["id"]))
    return {
        "modules": [{"key": k, "label": l, "kind": kind, "actions": acts} for k, l, kind, acts in access.MODULES],
        "mfg_stores": (await db.execute(text("SELECT id, code, name FROM mfg_stores WHERE is_active ORDER BY sort, id"))).mappings().all(),
        "actions": access.ACTIONS, "roles": roles, "role_permissions": role_perms,
        "outlets": (await db.execute(text("SELECT id, unit_code, outlet_name FROM outlets WHERE is_active ORDER BY outlet_name"))).mappings().all(),
        "categories": (await db.execute(text("""SELECT c.id, c.name, g.name AS department FROM item_categories c
            LEFT JOIN item_subgroups sg ON sg.id = c.subgroup_id LEFT JOIN item_groups g ON g.id = sg.group_id
            WHERE c.is_active ORDER BY g.name, c.name"""))).mappings().all(),
        "groups": (await db.execute(text("""SELECT s.id, s.name, s.category_id FROM item_subcategories s
            WHERE s.is_active ORDER BY s.name"""))).mappings().all(),
    }


@router.get("/users")
async def list_users(search: str = "", status: str = "all", db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    flt, p = "u.supplier_id IS NULL", {"q": f"%{search.strip()}%"}
    if search.strip():
        flt += " AND (u.name ILIKE :q OR u.username ILIKE :q OR u.employee_code ILIKE :q OR u.mobile ILIKE :q)"
    if status in ("active", "inactive"):
        flt += f" AND u.status = {'TRUE' if status == 'active' else 'FALSE'}"
    return (await db.execute(text(f"""
        SELECT u.id, u.name, u.username, u.employee_code, u.mobile, u.email, u.department, u.designation, u.role, u.status,
               u.last_login, u.valid_from, u.valid_until, u.all_outlets, u.all_categories, o.outlet_name AS default_outlet,
               (SELECT COUNT(*) FROM user_store_assignments a WHERE a.user_id = u.id) AS outlet_count,
               (SELECT COUNT(*) FROM user_category_assignments a WHERE a.user_id = u.id) AS category_count,
               (SELECT COUNT(*) FROM user_subcategory_assignments a WHERE a.user_id = u.id) AS group_count
        FROM users u LEFT JOIN outlets o ON o.id = u.outlet_id WHERE {flt} ORDER BY u.status DESC, u.name"""), p)).mappings().all()


@router.get("/users/{uid}")
async def get_user(uid: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    u = (await db.execute(text("""SELECT u.id, u.name, u.username, u.email, u.mobile, u.employee_code, u.department, u.designation,
        u.role, u.outlet_id, u.status, u.valid_from, u.valid_until, u.last_login, u.created_at, u.updated_at,
        cb.name AS created_by_name, ub.name AS updated_by_name
        FROM users u LEFT JOIN users cb ON cb.id = u.created_by LEFT JOIN users ub ON ub.id = u.updated_by
        WHERE u.id = :u AND u.supplier_id IS NULL"""), {"u": uid})).mappings().first()
    if not u:
        raise HTTPException(404, "User not found")
    snap = await _snapshot(db, uid)
    audit = (await db.execute(text("SELECT created_at, changed_by_name, summary FROM user_permission_audit WHERE user_id = :u "
                                   "ORDER BY created_at DESC LIMIT 30"), {"u": uid})).mappings().all()
    mfg = (await db.execute(text("SELECT store_id FROM mfg_user_stores WHERE user_id = :u ORDER BY 1"), {"u": uid})).scalars().all()
    return {**u, **snap, "audit": audit, "mfg_store_ids": mfg}


@router.post("/users")
async def create_user(body: user_access_in, request: Request, db: AsyncSession = Depends(get_db), me=Depends(get_current_user)):
    if not body.password:
        raise HTTPException(400, "Set a password (8+ characters).")
    if (await db.execute(text("SELECT 1 FROM users WHERE LOWER(username) = LOWER(:n)"), {"n": body.username})).first():
        raise HTTPException(400, f"Username '{body.username}' is already taken.")
    actor = await _actor(db, me)
    uid = (await db.execute(text("""INSERT INTO users (name, username, password, role, status, created_by, created_at, updated_at)
        VALUES (:n, :un, :pw, :r, TRUE, :me, NOW(), NOW()) RETURNING id"""),
        {"n": body.name, "un": body.username, "pw": hash_password(body.password), "r": body.role, "me": me.user_id})).scalar()
    await _save(db, uid, body, actor, me)
    await _audit(db, uid, None, await _snapshot(db, uid), me, request, f"user {body.username} created")
    await db.commit()
    return {"id": uid}


@router.put("/users/{uid}")
async def update_user(uid: int, body: user_access_in, request: Request, db: AsyncSession = Depends(get_db), me=Depends(get_current_user)):
    _not_self(uid, me)
    await _guard_target(db, uid, me)
    if (await db.execute(text("SELECT 1 FROM users WHERE LOWER(username) = LOWER(:n) AND id <> :u"), {"n": body.username, "u": uid})).first():
        raise HTTPException(400, f"Username '{body.username}' is already taken.")
    before = await _snapshot(db, uid)
    if (before["status"] and not body.status) or (before["outlet_id"] != body.outlet_id):
        u = (await db.execute(text("SELECT id, name FROM users WHERE id = :u"), {"u": uid})).one()
        await _block_if_busy(db, u, "deactivate this user" if not body.status else "change the default outlet")
    await _save(db, uid, body, await _actor(db, me), me)
    if body.password:
        await db.execute(text("UPDATE users SET password = :p WHERE id = :u"), {"p": hash_password(body.password), "u": uid})
    after = await _snapshot(db, uid)
    await _audit(db, uid, before, after, me, request, f"user {body.username} updated" + (" (password reset)" if body.password else ""))
    await db.commit()
    return {"success": True}


@router.post("/users/{uid}/reset-password")
async def reset_password(uid: int, body: password_in, request: Request, db: AsyncSession = Depends(get_db), me=Depends(get_current_user)):
    _not_self(uid, me)
    await _guard_target(db, uid, me)
    await db.execute(text("UPDATE users SET password = :p, updated_by = :me, updated_at = NOW() WHERE id = :u"),
                     {"p": hash_password(body.new_password), "me": me.user_id, "u": uid})
    await _audit(db, uid, None, None, me, request, "password reset")
    await db.commit()
    return {"success": True}


@router.post("/users/{uid}/toggle")
async def toggle_user(uid: int, request: Request, db: AsyncSession = Depends(get_db), me=Depends(get_current_user)):
    _not_self(uid, me)
    await _guard_target(db, uid, me)
    before = await _snapshot(db, uid)
    if before["status"]:
        await _block_if_busy(db, (await db.execute(text("SELECT id, name FROM users WHERE id = :u"), {"u": uid})).one(), "deactivate this user")
    await db.execute(text("UPDATE users SET status = NOT status, updated_by = :me, updated_at = NOW() WHERE id = :u"), {"me": me.user_id, "u": uid})
    after = await _snapshot(db, uid)
    await _audit(db, uid, before, after, me, request, "activated" if after["status"] else "deactivated")
    await db.commit()
    return {"status": after["status"]}


@router.put("/roles/{role_slug}/permissions")
async def set_role_template(role_slug: str, body: list[str], request: Request, db: AsyncSession = Depends(get_db), me=Depends(get_current_user)):
    if me.role not in ADMIN:
        raise HTTPException(403, "Only an administrator can change role templates.")
    if role_slug in ADMIN:
        raise HTTPException(400, "Administrator roles always have every permission.")
    rid = (await db.execute(text("SELECT id FROM roles WHERE slug = :r"), {"r": role_slug})).scalar()
    if not rid:
        raise HTTPException(404, "Role not found")
    bad = set(body) - set(access.ALL_SLUGS)
    if bad:
        raise HTTPException(400, f"Unknown permission(s): {', '.join(sorted(bad))}")
    before = sorted(await access.effective_permissions(db, -1, role_slug, rid))
    await db.execute(text("DELETE FROM role_permissions WHERE role_id = :r"), {"r": rid})
    await db.execute(text("INSERT INTO role_permissions (role_id, permission_id) SELECT :r, id FROM permissions WHERE slug = ANY(:s)"),
                     {"r": rid, "s": sorted(set(body))})
    await db.execute(text("""INSERT INTO user_permission_audit (user_id, changed_by, changed_by_name, before, after, summary, ip_address)
        VALUES (0, :by, :byn, CAST(:b AS JSONB), CAST(:a AS JSONB), :s, :ip)"""),
        {"by": me.user_id, "byn": me.username, "b": json.dumps(before), "a": json.dumps(sorted(set(body))),
         "s": f"role template '{role_slug}': {_diff({'permissions': before}, {'permissions': sorted(set(body))})}"[:4000],
         "ip": request.client.host if request.client else None})
    await db.commit()
    return {"success": True}


@router.get("/audit")
async def audit_log(user_id: int | None = None, db: AsyncSession = Depends(get_db), me=Depends(get_current_user)):
    if me.role not in ADMIN:
        raise HTTPException(403, "Only administrators can see the permission audit.")
    changes = (await db.execute(text("""SELECT a.created_at, a.user_id, u.name AS user_name, a.changed_by_name, a.summary, a.ip_address
        FROM user_permission_audit a LEFT JOIN users u ON u.id = a.user_id
        WHERE (CAST(:u AS INT) IS NULL OR a.user_id = :u) ORDER BY a.created_at DESC LIMIT 300"""), {"u": user_id})).mappings().all()
    denials = (await db.execute(text("""SELECT created_at, user_name, description, ip_address FROM audit_logs
        WHERE module = 'security' AND (CAST(:u AS INT) IS NULL OR user_id = :u) ORDER BY created_at DESC LIMIT 200"""),
        {"u": user_id})).mappings().all()
    return {"changes": changes, "denials": denials}
