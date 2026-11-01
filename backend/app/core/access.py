"""Central access control: module/action permissions + per-request data scope (outlet / category / group).

* Module permissions are slugs "<module>.<action>" in the existing `permissions` table. A user's effective set is
  the role's `role_permissions` plus per-user `user_granular_permissions` overrides (granted = grant, false = deny).
  admin / superadmin bypass everything.
* `enforce_access` is an app-wide dependency. It maps the request path + method to (module, action) once, centrally,
  so every endpoint — including ones added later under a mapped prefix — is checked without editing it. Mapped
  paths require a valid login (several report endpoints had none). Permissions are read from the DB on every
  request: no cache, so a change or a deactivation applies to the very next request.
* It also stores the caller's data scope in a ContextVar; queries add `outlet_filter()` / `product_filter()` and
  writes call `check_outlet()` / `check_products()`. Unrestricted users get no clause at all.
"""
from contextvars import ContextVar
from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy import text

from app.core.database import async_session_factory
from app.core.security import decode_token

ACTIONS = ["view", "create", "edit", "delete", "approve", "cancel", "print", "export", "import", "submit", "reopen", "email",
           "change_price", "change_batch", "remove_expired", "po", "grn", "wholesale", "items", "prices", "release", "override"]
A_ALL = ACTIONS

# key, label, kind (module | report), actions offered
MODULES: list[tuple[str, str, str, list[str]]] = [
    ("dashboard", "Dashboard", "module", ["view"]),
    ("items", "Item Master", "module", ["view", "create", "edit", "delete", "import", "export", "change_price"]),
    ("masters", "Masters (brand, category, HSN, units…)", "module", ["view", "create", "edit", "delete"]),
    ("suppliers", "Supplier Master", "module", ["view", "create", "edit", "delete", "approve", "export"]),
    ("customers", "Customer Master", "module", ["view", "create", "edit", "delete", "export"]),
    ("outlets", "Outlet Master", "module", ["view", "create", "edit", "delete"]),
    ("purchase_order", "Purchase Order", "module", ["view", "create", "edit", "delete", "approve", "cancel", "print", "export", "email"]),
    ("grn", "GRN / Purchase Inward", "module", ["view", "create", "edit", "cancel", "print", "export"]),
    ("purchase_return", "Purchase Return", "module", ["view", "create", "approve", "cancel", "print"]),
    ("stock_transfer", "Stock Transfer / Dispatch", "module", ["view", "create", "edit", "approve", "cancel", "print"]),
    ("stock_adjustment", "Stock Take & Adjustment", "module", ["view", "create", "edit", "approve", "cancel", "import"]),
    ("batches", "Batch & Expiry", "module", ["view", "create", "edit"]),
    ("warehouse", "Warehouse / WMS", "module", ["view", "create", "edit", "delete"]),
    ("billing", "Sales & Billing (POS)", "module", ["view", "create", "edit", "cancel", "print", "export"]),
    ("sales_return", "Sales Return / Credit Note", "module", ["view", "create", "cancel", "print"]),
    ("estimates", "Estimates", "module", ["view", "create", "edit", "delete"]),
    ("day_shift", "Day & Shift Open/Close", "module", ["view", "create", "approve", "submit", "reopen"]),
    ("cash", "Cash, Expense & Bank Deposit", "module", ["view", "create", "approve", "cancel"]),
    ("accounts", "Accounts Payable", "module", ["view", "create", "edit", "approve"]),
    ("schemes", "Schemes & Bulk Discount", "module", ["view", "create", "edit", "delete"]),
    ("shop", "Online Shop", "module", ["view", "create", "edit", "delete"]),
    ("manufacturing", "Manufacturing / Production", "module", ["view", "create", "edit", "delete", "approve", "cancel", "print", "export", "release", "override"]),
    ("import_export", "Data Import / Export", "module", ["view", "import", "export"]),
    ("approvals", "Approvals", "module", ["view", "approve", "edit"]),
    ("payment_modes", "Payment Mode Master", "module", ["view", "create", "edit", "delete"]),
    ("expiry", "Expiry, Batch Correction & Expired Removal", "module", ["view", "remove_expired", "change_batch", "edit", "export"]),
    ("loyalty", "Loyalty Programme", "module", ["view", "create", "edit", "export"]),
    ("discounts", "Discount Control", "module", ["view", "edit"]),
    ("imports", "Excel Import (PO, GRN, wholesale, items, prices)", "module", ["view", "export", "po", "grn", "wholesale", "items", "prices"]),
    ("users", "User Management", "module", ["view", "create", "edit", "delete"]),
    ("settings", "Company & System Settings", "module", ["view", "edit"]),
    ("audit", "Audit Logs", "module", ["view", "export"]),
    ("rep_sales", "Sales Reports", "report", ["view", "print", "export"]),
    ("rep_purchase", "Purchase Reports", "report", ["view", "print", "export"]),
    ("rep_stock", "Stock & Inventory Reports", "report", ["view", "print", "export"]),
    ("rep_gst", "GST & HSN Reports", "report", ["view", "print", "export"]),
    ("rep_finance", "P&L, Outstanding & Payment Reports", "report", ["view", "print", "export"]),
    ("rep_analytics", "Margin & Channel Analytics", "report", ["view", "print", "export"]),
]
ALL_SLUGS = [f"{k}.{a}" for k, _, _, acts in MODULES for a in acts]

# starting templates for existing roles (admin can change them on the Roles screen / per user)
_V = lambda *ms: [f"{m}.view" for m in ms]
_F = lambda *ms: [s for m in ms for s in ALL_SLUGS if s.startswith(m + ".")]
_REPORTS = [k for k, _, kind, _ in MODULES if kind == "report"]
ROLE_TEMPLATES: dict[str, list[str]] = {
    "manager": [s for s in ALL_SLUGS if not s.startswith(("users.", "settings.edit", "audit."))],
    "store_manager": _F("dashboard", "billing", "sales_return", "estimates", "day_shift", "cash", "customers", "grn",
                        "stock_transfer", "stock_adjustment", "batches", "schemes") + _V("items", "masters", "suppliers",
                        "purchase_order", "outlets") + _F("rep_sales", "rep_stock"),
    "staff": _V("dashboard", "items", "customers", "estimates", "day_shift", "schemes") + [
        "billing.view", "billing.create", "billing.print", "sales_return.view", "sales_return.create", "sales_return.print",
        "customers.create", "estimates.create", "day_shift.create", "cash.view", "cash.create"],
    "viewer": [f"{k}.view" for k, *_ in MODULES if k not in ("users", "settings", "audit")],
    "category_manager": _V("dashboard", "masters", "suppliers", "outlets", "batches") + _F("items", "purchase_order", "schemes")
        + ["grn.view", "grn.create", "grn.print"] + _F("rep_sales", "rep_stock", "rep_purchase"),
    "area_sales_manager": _V("dashboard", "items", "customers", "billing", "sales_return", "stock_transfer", "day_shift", "cash")
        + _F(*_REPORTS),
    "purchase_manager": _V("dashboard", "items", "masters", "outlets", "batches") + _F("suppliers", "purchase_order", "grn",
        "purchase_return", "accounts") + _F("rep_purchase", "rep_stock"),
    "accounts_manager": _V("dashboard", "suppliers", "customers", "billing", "grn", "purchase_return") + _F("accounts", "cash", "day_shift")
        + _F("rep_finance", "rep_gst", "rep_sales", "rep_purchase"),
}

# path prefix -> module; longest prefix wins. Unlisted paths are not checked here (login, public shop, vendor
# portal, POS sync agents, guest PO links, the user's own manufacturing module …).
PATHS: dict[str, str] = {
    "/dashboard": "dashboard", "/products": "items", "/masters": "masters", "/states": "masters", "/channels": "masters",
    "/packaging": "masters", "/suppliers": "suppliers", "/customers": "customers", "/outlets": "outlets",
    "/purchases/po": "purchase_order", "/purchases/multi-po": "purchase_order", "/purchases/intelligence": "purchase_order",
    "/purchases": "grn", "/purchase-returns": "purchase_return",
    "/inventory": "stock_transfer", "/logistics": "stock_transfer", "/stock-take": "stock_adjustment", "/batches": "batches",
    "/warehouse": "warehouse", "/wms": "warehouse",
    "/billing": "billing", "/billing/returns": "sales_return", "/estimates": "estimates", "/shifts": "day_shift",
    "/cash": "cash", "/accounts": "accounts", "/schemes": "schemes", "/import-export": "import_export",
    "/users": "users", "/roles": "users", "/permissions": "users", "/access": "users", "/company": "settings",
    "/audit-logs": "audit", "/stock-reports": "rep_stock", "/manufacturing": "manufacturing",
    "/purchases/po-email": "purchase_order", "/imports": "imports", "/item-requests": "items", "/approvals": "approvals", "/payment-modes": "payment_modes", "/expiry": "expiry", "/loyalty": "loyalty",
    "/discount-policy": "discounts", "/ho-dashboard": "dashboard",
    "/reports": "rep_analytics",
    **{f"/reports/{p}": "rep_sales" for p in ("sales", "hourly", "sales-trend", "top-items", "category-sales",
                                               "customer-analytics", "unit-dashboard", "hierarchy", "item-velocity")},
    **{f"/reports/{p}": "rep_purchase" for p in ("purchase", "sales-vs-purchase")},
    "/reports/stock": "rep_stock", "/reports/ledger": "rep_stock",
    **{f"/reports/{p}": "rep_gst" for p in ("gst", "tax-breakup", "hsn-mismatch", "hsn-mapping", "hsn-exceptions")},
    **{f"/reports/{p}": "rep_finance" for p in ("pl", "outstanding", "payments", "payments-matrix")},
    "/reports/backup": "settings", "/reports/email": "settings",
}
_PATHS_SORTED = sorted(PATHS.items(), key=lambda kv: -len(kv[0]))


# (method, path prefix) -> action, for endpoints whose action is not one of the generic verbs
ACTION_PATHS: dict[tuple[str, str], str] = {
    ("POST", "/expiry/removals"): "remove_expired", ("POST", "/expiry/batch-correction"): "change_batch",
    ("POST", "/expiry/expiry-correction"): "edit", ("PUT", "/expiry/bands"): "edit",
    ("PUT", "/approvals/policies"): "edit", ("POST", "/purchases/po-email"): "email", ("POST", "/imports/po"): "po", ("POST", "/imports/grn"): "grn",
    ("POST", "/imports/wholesale"): "wholesale", ("POST", "/imports/items"): "items", ("POST", "/imports/prices"): "prices", ("PUT", "/purchases/po-email/settings"): "edit", ("POST", "/shifts/day/reopen"): "reopen", ("PUT", "/shifts/closing-settings"): "approve", ("PUT", "/shifts/store-settings"): "approve",
    ("PUT", "/discount-policy"): "edit", ("PUT", "/loyalty/config"): "edit", ("PUT", "/loyalty/rules"): "edit", ("POST", "/loyalty/adjust"): "view", ("POST", "/discount-policy/request"): "view",
    ("POST", "/approvals/file"): "view", ("POST", "/approvals/resubmit"): "view", ("POST", "/approvals/cancel"): "view",
}


def register_paths(paths: dict[str, str]):
    """Routers that define their own sub-paths (the report engine) add them to the central map."""
    PATHS.update(paths)
    _PATHS_SORTED[:] = sorted(PATHS.items(), key=lambda kv: -len(kv[0]))

# GETs every logged-in user may make: pickers and lookups other screens need (results are still scope-filtered)
LOOKUP_PREFIXES = ("/masters/", "/products/lookup/", "/products/search")
LOOKUPS = ("/products/search", "/outlets", "/payment-modes", "/expiry/bands", "/masters", "/states", "/customers", "/suppliers", "/company",
           "/shifts/status", "/reports/filters", "/access/me", "/schemes/types", "/dashboard/user-scope", "/reports/x")
POST_VIEW = ("search", "lookup", "lookup_ajax", "evaluate", "check-invoice", "preview")
API_PREFIX = "/api/v1"

_scope: ContextVar[Optional[dict]] = ContextVar("access_scope", default=None)


def classify(path: str, method: str) -> Optional[tuple[str, str]]:
    """(module, action) for an API path, or None when this path is not centrally controlled."""
    if not path.startswith(API_PREFIX):
        return None
    p = path[len(API_PREFIX):].rstrip("/") or "/"
    module = next((m for pre, m in _PATHS_SORTED if p == pre or p.startswith(pre + "/")), None)
    if not module or "/guest/" in p:          # guest PO links for vendors are public by design
        return None
    segs = set(p.lower().split("/"))
    for (m, pre), act in ACTION_PATHS.items():
        if method == m and (p == pre or p.startswith(pre + "/")):
            return (module, act)
    if method in ("GET", "HEAD"):
        if p in LOOKUPS or p.startswith(LOOKUP_PREFIXES):
            return ("*", "view")
        act = "export" if segs & {"export", "excel", "csv", "download", "json", "xml"} else "print" if segs & {"print", "pdf"} else "view"
        return (module, act)
    if method == "DELETE":
        return (module, "delete")
    if method in ("PUT", "PATCH"):
        return (module, "approve" if segs & {"approve", "reject"} else "edit")
    if p == "/schemes/evaluate":                      # POS asks the scheme engine while billing
        return ("billing", "view")
    if p.startswith("/reports/x/"):                   # report engine uploads (GSTR-2B file) only read data
        return (module, "view")
    if segs & {"change-password"}:
        return ("*", "view")                          # the endpoint itself checks it is your own password
    if segs & set(POST_VIEW):
        return (module, "view")
    for words, act in (({"production-release"}, "release"), ({"approve", "reject", "finalize", "confirm", "close-day", "verify"}, "approve"),
                       ({"cancel", "void"}, "cancel"), ({"import", "upload", "process"}, "import"),
                       ({"export", "email"}, "export"), ({"print", "mark-printed"}, "print"),
                       ({"toggle", "receive", "dispatch", "dispatch-confirm", "items", "boxes", "reset-password"}, "edit")):
        if segs & words:
            return (module, act)
    return (module, "create")


async def effective_permissions(db, user_id: int, role: str, role_id: Optional[int]) -> set[str]:
    rows = (await db.execute(text("""
        SELECT p.slug FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = COALESCE(:rid, (SELECT id FROM roles WHERE slug = :role))"""), {"rid": role_id, "role": role})).scalars().all()
    perms = set(rows)
    for slug, granted in (await db.execute(text("SELECT slug, granted FROM user_granular_permissions WHERE user_id = :u"),
                                           {"u": user_id})).all():
        (perms.add if granted else perms.discard)(slug)
    return perms


async def load_scope(db, user_id: int) -> dict:
    """Data scope of a non-admin user: outlet ids, category ids, group (sub-category) ids. None = all."""
    u = (await db.execute(text("SELECT outlet_id, all_outlets, all_categories FROM users WHERE id = :u"), {"u": user_id})).one()
    outlets = None
    if not u.all_outlets:
        outlets = set((await db.execute(text("""
            SELECT outlet_id FROM user_store_assignments WHERE user_id = :u
            UNION SELECT o.id FROM outlets o JOIN user_region_assignments r ON r.region_id = o.region_id AND r.user_id = :u
            UNION SELECT o.id FROM outlets o JOIN user_zone_assignments z ON z.zone_id = o.zone_id AND z.user_id = :u"""),
            {"u": user_id})).scalars().all())
        if u.outlet_id:
            outlets.add(u.outlet_id)
    cats = None if u.all_categories else set((await db.execute(text(
        "SELECT category_id FROM user_category_assignments WHERE user_id = :u"), {"u": user_id})).scalars().all())
    groups = set((await db.execute(text("SELECT subcategory_id FROM user_subcategory_assignments WHERE user_id = :u"),
                                   {"u": user_id})).scalars().all()) or None
    return {"user_id": user_id, "outlets": outlets, "categories": cats, "groups": groups}


async def _deny(db, user_id, username, request: Request, why: str):
    await db.execute(text("""INSERT INTO audit_logs (module, action, record_id, description, user_id, user_name, ip_address, created_at)
        VALUES ('security', 'access_denied', :u, :d, :u, :n, :ip, NOW())"""),
        {"d": f"{request.method} {request.url.path}: {why}"[:500], "u": user_id, "n": username,
         "ip": request.client.host if request.client else None})
    await db.commit()
    raise HTTPException(403, f"Access denied: {why}")


async def enforce_access(request: Request):
    _scope.set(None)
    cls = classify(request.url.path, request.method)
    auth = request.headers.get("authorization", "")
    payload = decode_token(auth[7:]) if auth.lower().startswith("bearer ") else None
    if not payload or payload.get("type") != "access" or not payload.get("sub"):
        if cls:
            raise HTTPException(401, "Please log in.", headers={"WWW-Authenticate": "Bearer"})
        return
    async with async_session_factory() as db:
        u = (await db.execute(text("""SELECT id, username, role, role_id, status, supplier_id,
                                       valid_from, valid_until FROM users WHERE id = :u"""), {"u": int(payload["sub"])})).first()
        if not u or not u.status:
            if cls:
                raise HTTPException(401, "This account is inactive.")
            return
        if (u.valid_from and u.valid_from > _today()) or (u.valid_until and u.valid_until < _today()):
            if cls:
                raise HTTPException(401, "This account is outside its validity period.")
            return
        if u.role in ("admin", "superadmin") or u.supplier_id:
            return                                    # admins: everything; vendors: vendor portal has its own checks
        sc = await load_scope(db, u.id)
        _scope.set(sc)
        if not cls:
            return
        if sc["outlets"] is not None:                 # any outlet named in the request must be one of yours
            bad = await _foreign_outlets(request, sc["outlets"])
            if bad:
                await _deny(db, u.id, u.username, request, f"location #{bad} is not assigned to you.")
        module, action = cls
        if module == "*":
            return
        slug = f"{module}.{action}"
        if slug not in await effective_permissions(db, u.id, u.role, u.role_id):
            label = next((l for k, l, *_ in MODULES if k == module), module)
            await _deny(db, u.id, u.username, request, f"you do not have '{action}' permission on {label}.")


OUTLET_KEYS = ("outlet_id", "outlet_ids", "location_id", "from_outlet_id", "from_location_id", "source_location_id")


async def _foreign_outlets(request: Request, mine: set) -> Optional[int]:
    """First outlet id in the query string or JSON body (top level) that is outside `mine` (0 = Head Office)."""
    vals = []
    for k in OUTLET_KEYS:
        vals += request.query_params.getlist(k)
    if request.method in ("POST", "PUT", "PATCH") and "json" in request.headers.get("content-type", ""):
        try:
            body = await request.json()
        except Exception:
            body = None
        if isinstance(body, dict):
            for k in OUTLET_KEYS:
                v = body.get(k)
                vals += v if isinstance(v, list) else [v]
    for v in vals:
        if v in (None, ""):
            continue
        try:
            oid = int(v)
        except (TypeError, ValueError):
            continue
        if oid not in mine:
            return oid
    return None


def _today():
    from datetime import date
    return date.today()


# ── data-scope helpers for queries ───────────────────────────────────────────

def scope() -> Optional[dict]:
    """None = unrestricted (admin) for this request."""
    return _scope.get()


def outlet_filter(col: str, params: dict) -> str:
    s = _scope.get()
    if not s or s["outlets"] is None:
        return ""
    params["_scope_outlets"] = sorted(s["outlets"]) or [0]
    return f" AND {col} = ANY(:_scope_outlets)"


def product_filter(alias: str, params: dict) -> str:
    """Category + group restriction on a products alias (p)."""
    s = _scope.get()
    if not s:
        return ""
    sql = ""
    if s["categories"] is not None:
        params["_scope_cats"] = sorted(s["categories"]) or [0]
        sql += f" AND {alias}.category_id = ANY(:_scope_cats)"
    if s["groups"]:
        params["_scope_groups"] = sorted(s["groups"])
        sql += f" AND {alias}.subcategory_id = ANY(:_scope_groups)"
    return sql


def product_where(model) -> list:
    """Same restriction as product_filter, as SQLAlchemy conditions on the products model."""
    s = _scope.get()
    if not s:
        return []
    conds = []
    if s["categories"] is not None:
        conds.append(model.category_id.in_(sorted(s["categories"]) or [0]))
    if s["groups"]:
        conds.append(model.subcategory_id.in_(sorted(s["groups"])))
    return conds


def outlet_where(col) -> list:
    s = _scope.get()
    return [] if not s or s["outlets"] is None else [col.in_(sorted(s["outlets"]) or [0])]


def product_restricted() -> bool:
    s = _scope.get()
    return bool(s and (s["categories"] is not None or s["groups"]))


def allowed_outlets() -> Optional[list[int]]:
    s = _scope.get()
    return None if not s or s["outlets"] is None else sorted(s["outlets"])


def check_category(category_id: Optional[int], subcategory_id: Optional[int] = None):
    """For item create / edit: the item's category and group must be inside the caller's scope."""
    s = _scope.get()
    if not s:
        return
    if s["categories"] is not None and category_id not in s["categories"]:
        raise HTTPException(403, "Access denied: that category is not assigned to you.")
    if s["groups"] and subcategory_id not in s["groups"]:
        raise HTTPException(403, "Access denied: that group (sub-category) is not assigned to you.")


def check_outlet(outlet_id: Optional[int]):
    s = _scope.get()
    if s and s["outlets"] is not None and outlet_id is not None and outlet_id not in s["outlets"]:
        raise HTTPException(403, f"Access denied: you are not assigned to location #{outlet_id}.")


async def check_products(db, product_ids) -> None:
    """403 if any of the products is outside the caller's categories / groups."""
    ids = sorted({int(i) for i in product_ids if i})
    if not ids or not product_restricted():
        return
    params = {"ids": ids}
    ok = set((await db.execute(text("SELECT p.id FROM products p WHERE p.id = ANY(:ids)" + product_filter("p", params)),
                               params)).scalars().all())
    bad = [i for i in ids if i not in ok]
    if bad:
        names = (await db.execute(text("SELECT name FROM products WHERE id = ANY(:b) LIMIT 3"), {"b": bad})).scalars().all()
        raise HTTPException(403, "Access denied: these items are outside your categories/groups: " + ", ".join(names or map(str, bad)))


def require_unrestricted():
    """Company-wide analytics that cannot be split by location / category: unrestricted users only."""
    if allowed_outlets() is not None or product_restricted():
        raise HTTPException(403, "Access denied: this is a company-wide report. It is available only to users with "
                                 "all outlets and all categories.")


def require_whole_bill_access():
    """Bill-level money reports cannot be split by category; category-limited users get item-level reports instead."""
    if product_restricted():
        raise HTTPException(403, "Access denied: this report totals whole bills across all categories. "
                                 "Use the item / category-wise reports, which show only your categories.")


if __name__ == "__main__":  # self-check: python -m app.core.access
    assert classify("/api/v1/purchases/grn", "POST") == ("grn", "create")
    assert classify("/api/v1/purchases/po/5/approve", "POST") == ("purchase_order", "approve")
    assert classify("/api/v1/products/search", "GET") == ("*", "view")
    assert classify("/api/v1/products", "GET") == ("items", "view")
    assert classify("/api/v1/reports/sales", "GET") == ("rep_sales", "view")
    assert classify("/api/v1/reports/gst", "GET") == ("rep_gst", "view")
    assert classify("/api/v1/billing/returns", "POST") == ("sales_return", "create")
    assert classify("/api/v1/billing/invoices/3/cancel", "POST") == ("billing", "cancel")
    assert classify("/api/v1/stock-take/finalize/2", "POST") == ("stock_adjustment", "approve")
    assert classify("/api/v1/auth/login", "POST") is None and classify("/api/v1/sync/x", "POST") is None
    assert classify("/api/v1/schemes/evaluate", "POST") == ("billing", "view")
    assert all(s in ALL_SLUGS for t in ROLE_TEMPLATES.values() for s in t), [s for t in ROLE_TEMPLATES.values() for s in t if s not in ALL_SLUGS]
    print("access OK")
