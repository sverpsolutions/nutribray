"""Customizable Role-Based Dashboard Builder & Scoped Widget Feeds Router.
Provides backend-enforced data boundaries for Category Managers, ASMs, Store Managers, and Super Admins.
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.scope import get_user_scope, UserScope
from app.models.user import user as UserModel

router = APIRouter(prefix="/dashboard", tags=["dashboard_builder"])

SALE_FILTER = "invoice_type <> 'return'"


# --- Schemas ---

class WidgetConfigItem(BaseModel):
    widget_id: int
    widget_key: str
    position: int = 0
    col_span: int = 1
    row_span: int = 1
    config: Optional[Dict[str, Any]] = None
    is_visible: bool = True


class TemplateCreateSchema(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    role_id: Optional[int] = None
    department: Optional[str] = None
    is_default: bool = False
    allow_user_customization: bool = True
    layout_config: Optional[Dict[str, Any]] = None
    widgets: List[WidgetConfigItem] = []


class TemplateUpdateSchema(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    role_id: Optional[int] = None
    department: Optional[str] = None
    is_default: Optional[bool] = None
    allow_user_customization: Optional[bool] = None
    layout_config: Optional[Dict[str, Any]] = None
    widgets: Optional[List[WidgetConfigItem]] = None


class UserPreferencesSchema(BaseModel):
    template_id: int
    layout_overrides: Dict[str, Any]


class UserScopeAssignmentsSchema(BaseModel):
    outlet_ids: List[int] = []
    category_ids: List[int] = []
    default_template_id: Optional[int] = None


# --- Helper Database Fetcher ---

async def _rows(db: AsyncSession, sql: str, **params) -> List[Dict[str, Any]]:
    res = await db.execute(text(sql), params)
    return [dict(r) for r in res.mappings().all()]


# --- Dashboard Layout & Preference Endpoints ---

@router.get("/my-dashboard")
async def get_my_dashboard(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns the effective dashboard layout, active template, and user data scope."""
    scope = await get_user_scope(db, current_user)

    # 1. Determine active template:
    # Priority A: User explicit default_dashboard_template_id
    # Priority B: Template matching user's role_id
    # Priority C: Global default template (is_default = true)
    # Priority D: First available template
    template_id = scope.default_template_id
    template = None

    if template_id:
        t_res = await _rows(db, "SELECT * FROM dashboard_templates WHERE id = :id", id=template_id)
        if t_res:
            template = t_res[0]

    if not template and current_user.role_id:
        t_res = await _rows(db, "SELECT * FROM dashboard_templates WHERE role_id = :rid ORDER BY id LIMIT 1", rid=current_user.role_id)
        if t_res:
            template = t_res[0]

    if not template:
        t_res = await _rows(db, "SELECT * FROM dashboard_templates WHERE is_default = true LIMIT 1")
        if t_res:
            template = t_res[0]

    if not template:
        t_res = await _rows(db, "SELECT * FROM dashboard_templates ORDER BY id LIMIT 1")
        if t_res:
            template = t_res[0]

    if not template:
        raise HTTPException(status_code=404, detail="No dashboard template found.")

    tid = template["id"]

    # 2. Fetch widgets mapped to this template
    widgets = await _rows(db, """
        SELECT 
            tw.id, tw.template_id, tw.widget_id, tw.position, tw.col_span, tw.row_span,
            tw.config, tw.is_visible,
            dw.widget_key, dw.name, dw.category, dw.description, dw.default_width,
            dw.min_width, dw.max_width, dw.required_permission, dw.endpoint_url
        FROM template_widgets tw
        JOIN dashboard_widgets dw ON dw.id = tw.widget_id
        WHERE tw.template_id = :tid AND tw.is_visible = true
        ORDER BY tw.position ASC, tw.id ASC
    """, tid=tid)

    # 3. Check for user personalized preferences overrides
    pref_res = await _rows(db, "SELECT layout_overrides FROM user_dashboard_preferences WHERE user_id = :uid AND template_id = :tid", uid=current_user.id, tid=tid)
    preferences = pref_res[0]["layout_overrides"] if pref_res and template.get("allow_user_customization", True) else None

    # Merge preferences if available (override positions, col_span, visibility)
    if preferences and isinstance(preferences, dict):
        widget_overrides = preferences.get("widgets", {})
        for w in widgets:
            wkey = w["widget_key"]
            if wkey in widget_overrides:
                override = widget_overrides[wkey]
                if "position" in override:
                    w["position"] = override["position"]
                if "col_span" in override:
                    w["col_span"] = override["col_span"]
                if "is_visible" in override:
                    w["is_visible"] = override["is_visible"]
        # Filter hidden and sort by adjusted position
        widgets = [w for w in widgets if w["is_visible"]]
        widgets.sort(key=lambda x: x["position"])

    return {
        "template": template,
        "widgets": widgets,
        "scope": scope.to_dict(),
        "has_custom_preferences": bool(preferences)
    }


@router.get("/templates")
async def list_dashboard_templates(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists all available dashboard templates."""
    rows = await _rows(db, """
        SELECT dt.*, r.name AS role_name,
               (SELECT COUNT(*) FROM template_widgets tw WHERE tw.template_id = dt.id) AS widget_count
        FROM dashboard_templates dt
        LEFT JOIN roles r ON r.id = dt.role_id
        ORDER BY dt.is_default DESC, dt.id ASC
    """)
    return rows


@router.get("/templates/{template_id}")
async def get_dashboard_template(
    template_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Fetches details of a single dashboard template."""
    t_res = await _rows(db, """
        SELECT dt.*, r.name AS role_name
        FROM dashboard_templates dt
        LEFT JOIN roles r ON r.id = dt.role_id
        WHERE dt.id = :id
    """, id=template_id)
    if not t_res:
        raise HTTPException(status_code=404, detail="Template not found")

    widgets = await _rows(db, """
        SELECT tw.*, dw.widget_key, dw.name, dw.category, dw.description, dw.default_width
        FROM template_widgets tw
        JOIN dashboard_widgets dw ON dw.id = tw.widget_id
        WHERE tw.template_id = :tid
        ORDER BY tw.position ASC, tw.id ASC
    """, tid=template_id)

    return {
        "template": t_res[0],
        "widgets": widgets
    }


@router.post("/templates")
async def create_dashboard_template(
    payload: TemplateCreateSchema,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Admin creates a new dashboard template."""
    if (current_user.role or "").lower() not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Only administrators can create dashboard templates.")

    if payload.is_default:
        await db.execute(text("UPDATE dashboard_templates SET is_default = false"))

    res = await db.execute(text("""
        INSERT INTO dashboard_templates (name, slug, description, role_id, department, is_default, allow_user_customization, layout_config, created_by)
        VALUES (:name, :slug, :description, :role_id, :dept, :is_default, :allow_cust, :layout::jsonb, :uid)
        RETURNING id
    """), {
        "name": payload.name,
        "slug": payload.slug,
        "description": payload.description,
        "role_id": payload.role_id,
        "dept": payload.department,
        "is_default": payload.is_default,
        "allow_cust": payload.allow_user_customization,
        "layout": "{}" if payload.layout_config is None else str(payload.layout_config).replace("'", '"'),
        "uid": current_user.id
    })
    tmpl_id = res.scalar()

    # Insert widgets
    for w in payload.widgets:
        await db.execute(text("""
            INSERT INTO template_widgets (template_id, widget_id, position, col_span, row_span, config, is_visible)
            VALUES (:tid, :wid, :pos, :cspan, :rspan, :cfg::jsonb, :vis)
            ON CONFLICT (template_id, widget_id) DO UPDATE SET
                position = EXCLUDED.position,
                col_span = EXCLUDED.col_span,
                is_visible = EXCLUDED.is_visible
        """), {
            "tid": tmpl_id,
            "wid": w.widget_id,
            "pos": w.position,
            "cspan": w.col_span,
            "rspan": w.row_span,
            "cfg": "{}" if w.config is None else str(w.config).replace("'", '"'),
            "vis": w.is_visible
        })

    await db.commit()
    return {"message": "Template created successfully", "id": tmpl_id}


@router.put("/templates/{template_id}")
async def update_dashboard_template(
    template_id: int,
    payload: TemplateUpdateSchema,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Admin updates an existing dashboard template and widget assignments."""
    if (current_user.role or "").lower() not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Only administrators can update templates.")

    if payload.is_default:
        await db.execute(text("UPDATE dashboard_templates SET is_default = false WHERE id <> :id"), {"id": template_id})

    # Update template attributes
    updates = []
    params: Dict[str, Any] = {"id": template_id}
    if payload.name is not None:
        updates.append("name = :name")
        params["name"] = payload.name
    if payload.description is not None:
        updates.append("description = :description")
        params["description"] = payload.description
    if payload.role_id is not None:
        updates.append("role_id = :role_id")
        params["role_id"] = payload.role_id
    if payload.department is not None:
        updates.append("department = :department")
        params["department"] = payload.department
    if payload.is_default is not None:
        updates.append("is_default = :is_default")
        params["is_default"] = payload.is_default
    if payload.allow_user_customization is not None:
        updates.append("allow_user_customization = :allow_user_customization")
        params["allow_user_customization"] = payload.allow_user_customization

    if updates:
        updates.append("updated_at = NOW()")
        await db.execute(text(f"UPDATE dashboard_templates SET {', '.join(updates)} WHERE id = :id"), params)

    # Sync widgets if provided
    if payload.widgets is not None:
        await db.execute(text("DELETE FROM template_widgets WHERE template_id = :id"), {"id": template_id})
        for w in payload.widgets:
            await db.execute(text("""
                INSERT INTO template_widgets (template_id, widget_id, position, col_span, row_span, is_visible)
                VALUES (:tid, :wid, :pos, :cspan, :rspan, :vis)
            """), {
                "tid": template_id,
                "wid": w.widget_id,
                "pos": w.position,
                "cspan": w.col_span,
                "rspan": w.row_span,
                "vis": w.is_visible
            })

    await db.commit()
    return {"message": "Template updated successfully"}


@router.post("/templates/{template_id}/clone")
async def clone_dashboard_template(
    template_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Admin clones an existing template to create a customized variant."""
    if (current_user.role or "").lower() not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Only administrators can clone templates.")

    orig = await _rows(db, "SELECT * FROM dashboard_templates WHERE id = :id", id=template_id)
    if not orig:
        raise HTTPException(status_code=404, detail="Original template not found.")

    o = orig[0]
    new_slug = f"{o['slug']}_copy_{int(datetime.now().timestamp())}"
    new_name = f"{o['name']} (Copy)"

    res = await db.execute(text("""
        INSERT INTO dashboard_templates (name, slug, description, role_id, department, is_default, allow_user_customization, layout_config, created_by)
        VALUES (:name, :slug, :description, :role_id, :dept, false, :allow_cust, :layout::jsonb, :uid)
        RETURNING id
    """), {
        "name": new_name,
        "slug": new_slug,
        "description": o.get("description"),
        "role_id": o.get("role_id"),
        "dept": o.get("department"),
        "allow_cust": o.get("allow_user_customization", True),
        "layout": "{}" if not o.get("layout_config") else str(o["layout_config"]).replace("'", '"'),
        "uid": current_user.id
    })
    new_id = res.scalar()

    # Clone mapped widgets
    await db.execute(text("""
        INSERT INTO template_widgets (template_id, widget_id, position, col_span, row_span, config, is_visible)
        SELECT :new_id, widget_id, position, col_span, row_span, config, is_visible
        FROM template_widgets WHERE template_id = :orig_id
    """), {"new_id": new_id, "orig_id": template_id})

    await db.commit()
    return {"message": "Template cloned successfully", "id": new_id, "name": new_name}


@router.delete("/templates/{template_id}")
async def delete_dashboard_template(
    template_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Admin deletes a custom dashboard template."""
    if (current_user.role or "").lower() not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Only administrators can delete templates.")

    t_res = await _rows(db, "SELECT is_default FROM dashboard_templates WHERE id = :id", id=template_id)
    if not t_res:
        raise HTTPException(status_code=404, detail="Template not found")
    if t_res[0]["is_default"]:
        raise HTTPException(status_code=400, detail="Cannot delete default company template.")

    await db.execute(text("DELETE FROM dashboard_templates WHERE id = :id"), {"id": template_id})
    await db.commit()
    return {"message": "Template deleted successfully"}


@router.get("/widgets")
async def list_widget_library(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns the library catalog of available dashboard widgets."""
    return await _rows(db, "SELECT * FROM dashboard_widgets ORDER BY category, name")


@router.post("/preferences")
async def save_user_preferences(
    payload: UserPreferencesSchema,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Saves user personal layout customizations."""
    # Check if template allows customization
    t_res = await _rows(db, "SELECT allow_user_customization FROM dashboard_templates WHERE id = :id", id=payload.template_id)
    if not t_res or not t_res[0]["allow_user_customization"]:
        raise HTTPException(status_code=403, detail="Customization is locked for this dashboard template.")

    await db.execute(text("""
        INSERT INTO user_dashboard_preferences (user_id, template_id, layout_overrides, updated_at)
        VALUES (:uid, :tid, :overrides::jsonb, NOW())
        ON CONFLICT (user_id, template_id) DO UPDATE SET
            layout_overrides = EXCLUDED.layout_overrides,
            updated_at = NOW()
    """), {
        "uid": current_user.id,
        "tid": payload.template_id,
        "overrides": str(payload.layout_overrides).replace("'", '"')
    })
    await db.commit()
    return {"message": "Preferences saved successfully"}


@router.delete("/preferences/{template_id}")
async def reset_user_preferences(
    template_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Resets user's dashboard layout to the company template default."""
    await db.execute(text("""
        DELETE FROM user_dashboard_preferences
        WHERE user_id = :uid AND template_id = :tid
    """), {"uid": current_user.id, "tid": template_id})
    await db.commit()
    return {"message": "Dashboard reset to template default"}


# --- User Scope & Assignment Management Endpoints ---

@router.get("/user-scope")
async def get_current_user_scope(
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns the logged-in user's active data scope, permitted stores, and permitted categories."""
    scope = await get_user_scope(db, current_user)
    return scope.to_dict()


@router.get("/users/{user_id}/assignments")
async def get_user_assignments(
    user_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Admin inspects a specific user's store and category assignments."""
    if (current_user.role or "").lower() not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Forbidden")

    # Target user
    u_res = await _rows(db, "SELECT id, username, name, role, role_id, outlet_id, default_dashboard_template_id FROM users WHERE id = :id", id=user_id)
    if not u_res:
        raise HTTPException(status_code=404, detail="User not found")
    user_data = u_res[0]

    # Assigned stores
    stores = await _rows(db, """
        SELECT usa.outlet_id, usa.is_primary, o.outlet_name, o.unit_code
        FROM user_store_assignments usa
        JOIN outlets o ON o.id = usa.outlet_id
        WHERE usa.user_id = :uid
        ORDER BY o.outlet_name
    """, uid=user_id)

    # Assigned categories
    categories = await _rows(db, """
        SELECT uca.category_id, uca.include_subcategories, c.name AS category_name
        FROM user_category_assignments uca
        JOIN item_categories c ON c.id = uca.category_id
        WHERE uca.user_id = :uid
        ORDER BY c.name
    """, uid=user_id)

    return {
        "user": user_data,
        "assigned_stores": stores,
        "assigned_categories": categories,
    }


@router.post("/users/{user_id}/assignments")
async def update_user_assignments(
    user_id: int,
    payload: UserScopeAssignmentsSchema,
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Admin saves store and category assignments for a user."""
    if (current_user.role or "").lower() not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Forbidden")

    # Update default template if provided
    await db.execute(text("""
        UPDATE users
        SET default_dashboard_template_id = :tid,
            updated_at = NOW()
        WHERE id = :uid
    """), {"tid": payload.default_template_id, "uid": user_id})

    # Sync stores
    await db.execute(text("DELETE FROM user_store_assignments WHERE user_id = :uid"), {"uid": user_id})
    for oid in payload.outlet_ids:
        await db.execute(text("""
            INSERT INTO user_store_assignments (user_id, outlet_id, is_primary)
            VALUES (:uid, :oid, false)
            ON CONFLICT (user_id, outlet_id) DO NOTHING
        """), {"uid": user_id, "oid": oid})

    # Sync categories
    await db.execute(text("DELETE FROM user_category_assignments WHERE user_id = :uid"), {"uid": user_id})
    for cid in payload.category_ids:
        await db.execute(text("""
            INSERT INTO user_category_assignments (user_id, category_id, include_subcategories)
            VALUES (:uid, :cid, true)
            ON CONFLICT (user_id, category_id) DO NOTHING
        """), {"uid": user_id, "cid": cid})

    # Audit log entry
    await db.execute(text("""
        INSERT INTO audit_logs (module, action, record_id, description, user_id, user_name, created_at)
        VALUES ('ScopeManagement', 'UPDATE_USER_SCOPE', :uid, :desc, :admin_id, :admin_name, NOW())
    """), {
        "uid": user_id,
        "desc": f"Updated store scope ({len(payload.outlet_ids)} stores) and category scope ({len(payload.category_ids)} categories)",
        "admin_id": current_user.id,
        "admin_name": current_user.name or current_user.username
    })

    await db.commit()
    return {"message": "User access scope updated successfully"}


# --- Widget Data Feeds with Scope Enforcement ---

def _build_scope_conditions(
    scope: UserScope,
    req_outlet_id: Optional[int],
    req_category_id: Optional[int],
    invoice_alias: str = "i",
    product_alias: str = "p"
) -> tuple[str, dict]:
    """Generates SQL where-clauses and parameter dictionary based on user scope and requested filters."""
    clauses = []
    params: Dict[str, Any] = {}

    # Store Scope
    if not scope.is_unrestricted:
        if not scope.outlet_ids:
            # Deny by default: user has no assigned outlets
            clauses.append("1 = 0")
        else:
            clauses.append(f"{invoice_alias}.outlet_id = ANY(:permitted_outlet_ids)")
            params["permitted_outlet_ids"] = scope.outlet_ids

    # Requested store filter
    if req_outlet_id is not None:
        scope.validate_outlet_access(req_outlet_id)
        clauses.append(f"{invoice_alias}.outlet_id = :req_outlet_id")
        params["req_outlet_id"] = req_outlet_id

    # Category Scope
    if not scope.is_unrestricted and scope.category_ids:
        clauses.append(f"{product_alias}.category_id = ANY(:permitted_category_ids)")
        params["permitted_category_ids"] = scope.category_ids

    # Requested category filter
    if req_category_id is not None:
        scope.validate_category_access(req_category_id)
        clauses.append(f"{product_alias}.category_id = :req_category_id")
        params["req_category_id"] = req_category_id

    clause_str = " AND ".join(clauses) if clauses else "1 = 1"
    return clause_str, params


@router.get("/widgets/data/{widget_key}")
async def get_widget_data(
    widget_key: str,
    days: int = Query(7, ge=1, le=90),
    on: Optional[date] = Query(None),
    outlet_id: Optional[int] = Query(None, description="Optional store filter within permitted scope"),
    category_id: Optional[int] = Query(None, description="Optional category filter within permitted scope"),
    current_user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Scoped data provider for individual dashboard widgets."""
    scope = await get_user_scope(db, current_user)
    day = on or date.today()
    month_start = day.replace(day=1)
    start_date = day - timedelta(days=days - 1)

    # Validate requested filters
    if outlet_id is not None:
        scope.validate_outlet_access(outlet_id)
    if category_id is not None:
        scope.validate_category_access(category_id)

    # 1. KPI: Today's Sales
    if widget_key == "kpi_today_sales":
        cond, params = _build_scope_conditions(scope, outlet_id, category_id, "i", "p")
        params.update({"d": day, "yest": day - timedelta(days=1), "m": month_start})
        
        # Invoices join items & products if category filtering needed
        cat_join = "JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id JOIN products p ON p.item_code = ii.item_code" if (category_id or (not scope.is_unrestricted and scope.category_ids)) else ""
        
        if cat_join:
            sql = f"""
                SELECT
                    COALESCE(SUM(ii.total) FILTER (WHERE i.invoice_date = :d AND i.{SALE_FILTER}), 0) AS today_sales,
                    COUNT(DISTINCT i.id)   FILTER (WHERE i.invoice_date = :d AND i.{SALE_FILTER}) AS today_bills,
                    COALESCE(SUM(ii.total) FILTER (WHERE i.invoice_date = :yest AND i.{SALE_FILTER}), 0) AS yesterday_sales,
                    COALESCE(SUM(ii.total) FILTER (WHERE i.invoice_date = :d AND i.invoice_type = 'return'), 0) AS today_returns
                FROM unit_wise_invoices i
                {cat_join}
                WHERE {cond}
            """
        else:
            sql = f"""
                SELECT
                    COALESCE(SUM(i.total_amount) FILTER (WHERE i.invoice_date = :d AND i.{SALE_FILTER}), 0) AS today_sales,
                    COUNT(i.id)                  FILTER (WHERE i.invoice_date = :d AND i.{SALE_FILTER}) AS today_bills,
                    COALESCE(SUM(i.total_amount) FILTER (WHERE i.invoice_date = :yest AND i.{SALE_FILTER}), 0) AS yesterday_sales,
                    COALESCE(SUM(i.total_amount) FILTER (WHERE i.invoice_date = :d AND i.invoice_type = 'return'), 0) AS today_returns
                FROM unit_wise_invoices i
                WHERE {cond}
            """
        row = (await _rows(db, sql, **params))[0]
        today_sales = float(row["today_sales"])
        yest_sales = float(row["yesterday_sales"])
        growth = ((today_sales - yest_sales) / yest_sales * 100) if yest_sales > 0 else 0.0
        avg_bill = (today_sales / row["today_bills"]) if row["today_bills"] else 0.0

        return {
            "today_sales": today_sales,
            "yesterday_sales": yest_sales,
            "today_bills": row["today_bills"],
            "today_returns": float(row["today_returns"]),
            "growth_pct": round(growth, 1),
            "avg_bill": round(avg_bill, 0),
            "date": day
        }

    # 2. KPI: Month-To-Date Sales
    elif widget_key == "kpi_mtd_sales":
        cond, params = _build_scope_conditions(scope, outlet_id, category_id, "i", "p")
        params.update({"d": day, "m": month_start})
        cat_join = "JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id JOIN products p ON p.item_code = ii.item_code" if (category_id or (not scope.is_unrestricted and scope.category_ids)) else ""

        if cat_join:
            sql = f"""
                SELECT
                    COALESCE(SUM(ii.total) FILTER (WHERE i.invoice_date BETWEEN :m AND :d AND i.{SALE_FILTER}), 0) AS mtd_sales,
                    COUNT(DISTINCT i.id)   FILTER (WHERE i.invoice_date BETWEEN :m AND :d AND i.{SALE_FILTER}) AS mtd_bills
                FROM unit_wise_invoices i
                {cat_join}
                WHERE {cond}
            """
        else:
            sql = f"""
                SELECT
                    COALESCE(SUM(i.total_amount) FILTER (WHERE i.invoice_date BETWEEN :m AND :d AND i.{SALE_FILTER}), 0) AS mtd_sales,
                    COUNT(i.id)                  FILTER (WHERE i.invoice_date BETWEEN :m AND :d AND i.{SALE_FILTER}) AS mtd_bills
                FROM unit_wise_invoices i
                WHERE {cond}
            """
        row = (await _rows(db, sql, **params))[0]
        mtd_sales = float(row["mtd_sales"])
        day_count = max(1, day.day)
        daily_run_rate = mtd_sales / day_count

        return {
            "mtd_sales": mtd_sales,
            "mtd_bills": row["mtd_bills"],
            "daily_run_rate": round(daily_run_rate, 2),
            "days_elapsed": day_count
        }

    # 3. KPI: Gross Margin & Margin %
    elif widget_key == "kpi_gross_margin":
        cond, params = _build_scope_conditions(scope, outlet_id, category_id, "i", "p")
        params.update({"m": month_start, "d": day})
        sql = f"""
            SELECT
                COALESCE(SUM(ii.total), 0) AS revenue,
                COALESCE(SUM(ii.qty * COALESCE(NULLIF(p.cost_price, 0), NULLIF(p.purchase_price, 0), ii.rate * 0.7)), 0) AS estimated_cost
            FROM unit_wise_invoice_items ii
            JOIN unit_wise_invoices i ON i.id = ii.invoice_id
            JOIN products p ON p.item_code = ii.item_code
            WHERE i.invoice_date BETWEEN :m AND :d AND i.{SALE_FILTER} AND {cond}
        """
        row = (await _rows(db, sql, **params))[0]
        revenue = float(row["revenue"])
        cost = float(row["estimated_cost"])
        gross_profit = revenue - cost
        margin_pct = (gross_profit / revenue * 100) if revenue > 0 else 0.0

        return {
            "revenue": revenue,
            "estimated_cost": cost,
            "gross_profit": round(gross_profit, 2),
            "margin_pct": round(margin_pct, 1)
        }

    # 4. KPI: Total Stock Valuation
    elif widget_key == "kpi_stock_valuation":
        clauses = ["os.stock_qty > 0"]
        params = {}
        if not scope.is_unrestricted:
            if not scope.outlet_ids:
                clauses.append("1 = 0")
            else:
                clauses.append("os.outlet_id = ANY(:permitted_outlet_ids)")
                params["permitted_outlet_ids"] = scope.outlet_ids

            if scope.category_ids:
                clauses.append("p.category_id = ANY(:permitted_category_ids)")
                params["permitted_category_ids"] = scope.category_ids

        if outlet_id is not None:
            clauses.append("os.outlet_id = :req_outlet_id")
            params["req_outlet_id"] = outlet_id
        if category_id is not None:
            clauses.append("p.category_id = :req_category_id")
            params["req_category_id"] = category_id

        where_sql = " AND ".join(clauses)
        sql = f"""
            SELECT
                COALESCE(SUM(os.stock_qty), 0) AS total_units,
                COALESCE(SUM(os.stock_qty * COALESCE(NULLIF(p.cost_price, 0), NULLIF(p.purchase_price, 0), p.mrp * 0.7)), 0) AS valuation_cost,
                COUNT(DISTINCT os.product_id) AS sku_count
            FROM outlet_stock os
            JOIN products p ON p.id = os.product_id
            WHERE {where_sql}
        """
        row = (await _rows(db, sql, **params))[0]
        return {
            "total_units": float(row["total_units"]),
            "valuation_cost": round(float(row["valuation_cost"]), 2),
            "sku_count": row["sku_count"]
        }

    # 5. Chart: Daily Sales Trend
    elif widget_key == "sales_trend_chart":
        cond, params = _build_scope_conditions(scope, outlet_id, category_id, "i", "p")
        params.update({"s": start_date, "d": day})
        cat_join = "JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id JOIN products p ON p.item_code = ii.item_code" if (category_id or (not scope.is_unrestricted and scope.category_ids)) else ""

        if cat_join:
            sql = f"""
                SELECT g::date AS day,
                       COALESCE(SUM(ii.total), 0) AS sales,
                       COUNT(DISTINCT i.id) AS bills
                FROM generate_series(CAST(:s AS date), CAST(:d AS date), interval '1 day') g
                LEFT JOIN unit_wise_invoices i ON i.invoice_date = g::date AND i.{SALE_FILTER}
                LEFT JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id
                LEFT JOIN products p ON p.item_code = ii.item_code AND {cond}
                GROUP BY g ORDER BY g
            """
        else:
            sql = f"""
                SELECT g::date AS day,
                       COALESCE(SUM(i.total_amount), 0) AS sales,
                       COUNT(i.id) AS bills
                FROM generate_series(CAST(:s AS date), CAST(:d AS date), interval '1 day') g
                LEFT JOIN unit_wise_invoices i ON i.invoice_date = g::date AND i.{SALE_FILTER} AND {cond}
                GROUP BY g ORDER BY g
            """
        rows = await _rows(db, sql, **params)
        return {"days": days, "trend": rows}

    # 6. Chart: Category-Wise Sales
    elif widget_key == "category_sales_breakdown":
        cond, params = _build_scope_conditions(scope, outlet_id, category_id, "i", "p")
        params.update({"s": start_date, "d": day})
        sql = f"""
            SELECT
                c.id AS category_id,
                c.name AS category_name,
                COALESCE(SUM(ii.total), 0) AS sales,
                COALESCE(SUM(ii.qty), 0) AS qty,
                COUNT(DISTINCT i.id) AS bills
            FROM unit_wise_invoice_items ii
            JOIN unit_wise_invoices i ON i.id = ii.invoice_id
            JOIN products p ON p.item_code = ii.item_code
            JOIN item_categories c ON c.id = p.category_id
            WHERE i.invoice_date BETWEEN :s AND :d AND i.{SALE_FILTER} AND {cond}
            GROUP BY c.id, c.name
            ORDER BY sales DESC
            LIMIT 10
        """
        rows = await _rows(db, sql, **params)
        total_sales = sum(float(r["sales"]) for r in rows)
        for r in rows:
            r["share_pct"] = round((float(r["sales"]) / total_sales * 100), 1) if total_sales > 0 else 0
        return {"categories": rows, "total_sales": total_sales}

    # 7. Chart: Store-Wise Sales & Target
    elif widget_key == "store_sales_comparison":
        clauses = ["o.is_active = true"]
        params = {"d": day, "m": month_start}
        if not scope.is_unrestricted:
            if not scope.outlet_ids:
                clauses.append("1 = 0")
            else:
                clauses.append("o.id = ANY(:permitted_outlet_ids)")
                params["permitted_outlet_ids"] = scope.outlet_ids

        if outlet_id is not None:
            clauses.append("o.id = :req_outlet_id")
            params["req_outlet_id"] = outlet_id

        where_sql = " AND ".join(clauses)
        sql = f"""
            SELECT
                o.id,
                o.outlet_name AS name,
                o.unit_code AS code,
                COALESCE(SUM(i.total_amount) FILTER (WHERE i.invoice_date = :d), 0) AS today_sales,
                COUNT(i.id) FILTER (WHERE i.invoice_date = :d) AS today_bills,
                COALESCE(SUM(i.total_amount) FILTER (WHERE i.invoice_date BETWEEN :m AND :d), 0) AS month_sales,
                MAX(i.invoice_date) AS last_bill_date
            FROM outlets o
            LEFT JOIN unit_wise_invoices i ON i.outlet_id = o.id AND i.{SALE_FILTER}
            WHERE {where_sql}
            GROUP BY o.id, o.outlet_name, o.unit_code
            ORDER BY today_sales DESC, month_sales DESC
        """
        rows = await _rows(db, sql, **params)
        return {"stores": rows}

    # 8. Top Selling Products
    elif widget_key == "top_selling_products":
        cond, params = _build_scope_conditions(scope, outlet_id, category_id, "i", "p")
        params.update({"s": start_date, "d": day})
        sql = f"""
            SELECT
                p.id,
                ii.item_code,
                p.name,
                c.name AS category_name,
                SUM(ii.qty) AS qty,
                SUM(ii.total) AS value
            FROM unit_wise_invoice_items ii
            JOIN unit_wise_invoices i ON i.id = ii.invoice_id
            JOIN products p ON p.item_code = ii.item_code
            LEFT JOIN item_categories c ON c.id = p.category_id
            WHERE i.invoice_date BETWEEN :s AND :d AND i.{SALE_FILTER} AND {cond}
            GROUP BY p.id, ii.item_code, p.name, c.name
            ORDER BY value DESC
            LIMIT 10
        """
        rows = await _rows(db, sql, **params)
        return {"products": rows}

    # 9. Slow-Moving Products (high stock, 0 or low sales in 30 days)
    elif widget_key == "slow_moving_products":
        clauses = ["os.stock_qty > 10"]
        params = {"d": day}
        if not scope.is_unrestricted:
            if not scope.outlet_ids:
                clauses.append("1 = 0")
            else:
                clauses.append("os.outlet_id = ANY(:permitted_outlet_ids)")
                params["permitted_outlet_ids"] = scope.outlet_ids

            if scope.category_ids:
                clauses.append("p.category_id = ANY(:permitted_category_ids)")
                params["permitted_category_ids"] = scope.category_ids

        if outlet_id is not None:
            clauses.append("os.outlet_id = :req_outlet_id")
            params["req_outlet_id"] = outlet_id
        if category_id is not None:
            clauses.append("p.category_id = :req_category_id")
            params["req_category_id"] = category_id

        where_sql = " AND ".join(clauses)
        sql = f"""
            WITH recent_sales AS (
                SELECT ii.item_code, SUM(ii.qty) AS sold_qty
                FROM unit_wise_invoice_items ii
                JOIN unit_wise_invoices i ON i.id = ii.invoice_id
                WHERE i.invoice_date > CAST(:d AS date) - 30 AND i.{SALE_FILTER}
                GROUP BY ii.item_code
            )
            SELECT
                p.id, p.item_code, p.name, c.name AS category_name,
                SUM(os.stock_qty) AS stock_qty,
                COALESCE(rs.sold_qty, 0) AS sold_30d,
                p.mrp
            FROM outlet_stock os
            JOIN products p ON p.id = os.product_id
            LEFT JOIN item_categories c ON c.id = p.category_id
            LEFT JOIN recent_sales rs ON rs.item_code = p.item_code
            WHERE {where_sql} AND COALESCE(rs.sold_qty, 0) <= 2
            GROUP BY p.id, p.item_code, p.name, c.name, rs.sold_qty, p.mrp
            ORDER BY stock_qty DESC
            LIMIT 10
        """
        rows = await _rows(db, sql, **params)
        return {"slow_moving": rows}

    # 10. Near-Expiry Batches (≤5d, ≤15d, ≤30d with vendor details)
    elif widget_key == "near_expiry_batches":
        clauses = ["pb.status NOT IN ('inactive','blocked','expired')", "pb.exp_date IS NOT NULL"]
        params = {"today": day}
        
        # Limit to ≤ 30 days
        clauses.append("pb.exp_date BETWEEN :today AND CAST(:today AS date) + 30")

        if not scope.is_unrestricted:
            # batch stock here is per location, not per outlet, so only the category scope applies
            if scope.category_ids:
                clauses.append("p.category_id = ANY(:permitted_category_ids)")
                params["permitted_category_ids"] = scope.category_ids

        if category_id is not None:
            clauses.append("p.category_id = :req_category_id")
            params["req_category_id"] = category_id

        where_sql = " AND ".join(clauses)
        sql = f"""
            SELECT
                pb.id AS batch_id,
                pb.batch_no,
                pb.exp_date,
                pb.mrp,
                CAST(pb.exp_date - :today AS INTEGER) AS days_left,
                p.name AS product_name,
                p.item_code,
                c.name AS category_name,
                NULL AS outlet_name,
                COALESCE(pbs.current_qty, 0) AS stock_qty,
                s.name AS supplier_name,
                s.phone AS supplier_phone
            FROM product_batches pb
            JOIN products p ON p.id = pb.product_id
            LEFT JOIN item_categories c ON c.id = p.category_id
            JOIN product_batch_stock pbs ON pbs.batch_id = pb.id
            LEFT JOIN suppliers s ON s.id = pb.supplier_id
            WHERE {where_sql} AND COALESCE(pbs.current_qty, 0) > 0
            ORDER BY pb.exp_date ASC
            LIMIT 15
        """
        rows = await _rows(db, sql, **params)
        
        # Categorize into windows
        window_5d = [r for r in rows if r["days_left"] <= 5]
        window_15d = [r for r in rows if 5 < r["days_left"] <= 15]
        window_30d = [r for r in rows if 15 < r["days_left"] <= 30]

        return {
            "total_count": len(rows),
            "critical_5d_count": len(window_5d),
            "warning_15d_count": len(window_15d),
            "watch_30d_count": len(window_30d),
            "batches": rows
        }

    # 11. Out-of-Stock & Low Stock Alerts
    elif widget_key == "out_of_stock_alerts":
        clauses = ["i.invoice_date > CAST(:d AS date) - 30", f"i.{SALE_FILTER}", "i.outlet_id IS NOT NULL"]
        params = {"d": day}

        if not scope.is_unrestricted:
            if not scope.outlet_ids:
                clauses.append("1 = 0")
            else:
                clauses.append("i.outlet_id = ANY(:permitted_outlet_ids)")
                params["permitted_outlet_ids"] = scope.outlet_ids

            if scope.category_ids:
                clauses.append("p.category_id = ANY(:permitted_category_ids)")
                params["permitted_category_ids"] = scope.category_ids

        if outlet_id is not None:
            clauses.append("i.outlet_id = :req_outlet_id")
            params["req_outlet_id"] = outlet_id
        if category_id is not None:
            clauses.append("p.category_id = :req_category_id")
            params["req_category_id"] = category_id

        where_sql = " AND ".join(clauses)
        sql = f"""
            WITH sold AS (
                SELECT i.outlet_id, p.id AS product_id, SUM(ii.qty) AS sold_qty
                FROM unit_wise_invoice_items ii
                JOIN unit_wise_invoices i ON i.id = ii.invoice_id
                JOIN products p ON p.item_code = ii.item_code
                WHERE {where_sql}
                GROUP BY 1, 2
            )
            SELECT
                s.outlet_id, o.outlet_name AS outlet, p.id AS product_id, p.name, p.item_code,
                c.name AS category_name, s.sold_qty, COALESCE(os.stock_qty, 0) AS stock_qty
            FROM sold s
            JOIN products p ON p.id = s.product_id
            LEFT JOIN item_categories c ON c.id = p.category_id
            JOIN outlets o ON o.id = s.outlet_id
            LEFT JOIN outlet_stock os ON os.outlet_id = s.outlet_id AND os.product_id = s.product_id
            WHERE COALESCE(os.stock_qty, 0) <= 0
            ORDER BY s.sold_qty DESC
            LIMIT 10
        """
        rows = await _rows(db, sql, **params)
        return {"stockouts": rows, "count": len(rows)}

    # 12. Pending Operations (PO, GRN, PRN, Transfers)
    elif widget_key == "pending_operations_summary":
        store_filter = ""
        params = {"d": day}
        if not scope.is_unrestricted and scope.outlet_ids:
            store_filter = "AND outlet_id = ANY(:permitted_outlet_ids)"
            params["permitted_outlet_ids"] = scope.outlet_ids
        if outlet_id is not None:
            store_filter = "AND outlet_id = :req_outlet_id"
            params["req_outlet_id"] = outlet_id

        # Pending POs
        po_res = await db.execute(text(f"""
            SELECT COUNT(*) FROM po_headers WHERE status IN ('pending', 'draft') {store_filter}
        """), params)
        pending_po = po_res.scalar() or 0

        # Pending Stock Transfers
        tr_res = await db.execute(text(f"""
            SELECT COUNT(*) FROM unit_wise_stock_transfers WHERE status = 'pending' {store_filter.replace('outlet_id', 'to_outlet_id')}
        """), params)
        pending_transfers = tr_res.scalar() or 0

        # Pending Purchase Returns (PRN)
        prn_res = await db.execute(text(f"""
            SELECT COUNT(*) FROM unit_wise_purchase_returns WHERE status = 'pending' {store_filter}
        """), params)
        pending_prn = prn_res.scalar() or 0

        # Pending GRNs / Inward Challans
        grn_res = await db.execute(text(f"""
            SELECT COUNT(*) FROM supplier_challans WHERE status IN ('pending', 'submitted') {store_filter}
        """), params)
        pending_grn = grn_res.scalar() or 0

        return {
            "pending_po": pending_po,
            "pending_grn": pending_grn,
            "pending_prn": pending_prn,
            "pending_transfers": pending_transfers,
            "total_pending": pending_po + pending_grn + pending_prn + pending_transfers
        }

    # 13. Vendor Outstanding Summary (Finance / Super Admin)
    elif widget_key == "vendor_outstanding_summary":
        sql = """
            SELECT
                COALESCE(SUM(due_amount), 0) AS total_outstanding,
                COUNT(*) FILTER (WHERE due_amount > 0) AS unpaid_bills_count,
                COALESCE(SUM(due_amount) FILTER (WHERE due_date < CURRENT_DATE), 0) AS overdue_amount
            FROM sps_bill_entry
            WHERE status <> 'cancelled'
        """
        row = (await _rows(db, sql))[0]
        return {
            "total_outstanding": round(float(row["total_outstanding"]), 2),
            "unpaid_bills_count": row["unpaid_bills_count"],
            "overdue_amount": round(float(row["overdue_amount"]), 2)
        }

    else:
        raise HTTPException(status_code=404, detail=f"Widget '{widget_key}' not recognized.")
