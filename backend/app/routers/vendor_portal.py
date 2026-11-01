import math
import secrets
from datetime import datetime, date as date_type, timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user, current_user_dep
from app.core.security import verify_password, get_password_hash, create_access_token, create_refresh_token
from app.models.party import (
    supplier as supplier_model,
    vendor_profile_request,
    vendor_item_request,
)
from app.models.purchase import (
    po_header, po_item, po_audit_log,
    purchase as purchase_model, purchase_item as purchase_item_model,
)
from app.models.sync import (
    unit_wise_purchase_return,
    unit_wise_purchase_return_item,
)
from app.models.invoice import (
    invoice as invoice_model, invoice_item as invoice_item_model,
)
from app.models.product import product as product_model
from app.models.user import user as user_model, audit_log as audit_log_model
from app.schemas.party import (
    supplier_out,
    vendor_profile_request_create,
    vendor_profile_request_out,
    vendor_item_request_create,
    vendor_item_request_out,
    po_vendor_ack_in,
    vendor_login_in,
    vendor_activate_in,
    vendor_forgot_password_in,
    vendor_reset_password_in,
    prn_vendor_ack_in,
)
from app.services.auth_service import write_audit

router = APIRouter(prefix="/vendor-portal", tags=["vendor-portal"])


# ── VENDOR CONTEXT RESOLVER ───────────────────────────────────────────────────

async def _resolve_vendor_supplier(
    current_user: current_user_dep,
    db: AsyncSession,
    requested_supplier_id: int | None = None,
) -> supplier_model:
    """
    Enforces strict tenant isolation:
    - If user has a linked supplier_id, they can ONLY access their own supplier data.
    - If user is admin/manager, they can view as requested_supplier_id or default to first active.
    - Otherwise, raises 403 Forbidden.
    """
    if current_user.supplier_id:
        target_id = current_user.supplier_id
    elif current_user.role in ("admin", "manager"):
        if requested_supplier_id:
            target_id = requested_supplier_id
        else:
            first_id = (await db.execute(
                select(supplier_model.id).where(supplier_model.status == True).order_by(supplier_model.id).limit(1)
            )).scalar_one_or_none()
            if not first_id:
                raise HTTPException(status_code=404, detail="No active supplier found")
            target_id = first_id
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Your user account is not linked to an active supplier profile.",
        )

    supp = (await db.execute(
        select(supplier_model).where(supplier_model.id == target_id)
    )).scalar_one_or_none()

    if not supp:
        raise HTTPException(status_code=404, detail="Supplier record not found")

    return supp


def _check_perm(supp: supplier_model, perm_key: str, default: bool = True):
    """Enforces fine-grained supplier portal permissions on the backend."""
    perms = supp.portal_permissions or {}
    allowed = perms.get(perm_key, default)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access to {perm_key.replace('_', ' ')} is disabled for your vendor account by company administration."
        )


# ── VENDOR AUTHENTICATION ─────────────────────────────────────────────────────

@router.post("/auth/login")
async def vendor_login(body: vendor_login_in, db: AsyncSession = Depends(get_db)):
    clean_user = body.username.strip()
    u_res = await db.execute(
        select(user_model).where(
            (func.lower(user_model.username) == clean_user.lower()) |
            (func.lower(user_model.email) == clean_user.lower())
        )
    )
    db_user = u_res.scalar_one_or_none()

    if not db_user or not verify_password(body.password, db_user.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    if not db_user.status:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your vendor account is inactive or suspended. Please contact Nutribay Head Office.")

    if not db_user.supplier_id and db_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No supplier profile is linked to this account.")

    target_supplier_id = db_user.supplier_id
    if not target_supplier_id and db_user.role in ("admin", "manager"):
        first_sup = (await db.execute(select(supplier_model.id).where(supplier_model.status == True).limit(1))).scalar_one_or_none()
        target_supplier_id = first_sup

    supp = (await db.execute(select(supplier_model).where(supplier_model.id == target_supplier_id))).scalar_one_or_none()
    if not supp or not supp.status:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="The linked supplier account is inactive or not found.")

    db_user.last_login = datetime.now()
    await write_audit(
        db=db, module="vendor_portal", action="login",
        record_id=db_user.id, description=f"Vendor user '{db_user.username}' logged into Vendor Portal",
        user_id=db_user.id, user_name=db_user.username
    )
    await db.commit()

    access_token = create_access_token(db_user.id, db_user.role)
    refresh_token = create_refresh_token(db_user.id)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": db_user.id,
            "username": db_user.username,
            "name": db_user.name,
            "email": db_user.email,
            "role": db_user.role,
            "supplier_id": supp.id,
        },
        "supplier": {
            "id": supp.id,
            "name": supp.name,
            "trade_name": supp.trade_name,
            "supplier_code": supp.supplier_code,
            "gst_number": supp.gst_number,
            "portal_permissions": supp.portal_permissions or {},
            "portal_sales_enabled": supp.portal_sales_enabled,
        }
    }


@router.post("/auth/activate")
async def vendor_activate(body: vendor_activate_in, db: AsyncSession = Depends(get_db)):
    token = body.token.strip()
    u_res = await db.execute(
        select(user_model).where(user_model.reset_token == token)
    )
    db_user = u_res.scalar_one_or_none()

    if not db_user:
        # Check supplier onboarding token fallback
        s_res = await db.execute(select(supplier_model).where(supplier_model.onboarding_token == token))
        supp = s_res.scalar_one_or_none()
        if supp:
            u2_res = await db.execute(select(user_model).where(user_model.supplier_id == supp.id))
            db_user = u2_res.scalar_one_or_none()

    if not db_user:
        raise HTTPException(status_code=400, detail="Invalid or expired activation link.")

    if db_user.reset_token_expiry and db_user.reset_token_expiry < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Activation token has expired. Please request a new invitation.")

    db_user.password = get_password_hash(body.password)
    db_user.reset_token = None
    db_user.reset_token_expiry = None
    db_user.status = True
    db_user.last_login = datetime.now()

    await write_audit(
        db=db, module="vendor_portal", action="activate",
        record_id=db_user.id, description=f"Vendor user '{db_user.username}' activated account and set password",
        user_id=db_user.id, user_name=db_user.username
    )
    await db.commit()

    access_token = create_access_token(db_user.id, db_user.role)
    return {
        "success": True,
        "message": "Account activated successfully. You can now access your vendor portal.",
        "access_token": access_token,
        "username": db_user.username,
    }


@router.post("/auth/forgot-password")
async def vendor_forgot_password(body: vendor_forgot_password_in, db: AsyncSession = Depends(get_db)):
    clean_val = body.username_or_email.strip()
    u_res = await db.execute(
        select(user_model).where(
            (func.lower(user_model.username) == clean_val.lower()) |
            (func.lower(user_model.email) == clean_val.lower())
        )
    )
    db_user = u_res.scalar_one_or_none()

    if db_user and db_user.role in ("vendor", "supplier", "admin"):
        token = secrets.token_urlsafe(32)
        db_user.reset_token = token
        db_user.reset_token_expiry = datetime.utcnow() + timedelta(hours=24)
        await write_audit(
            db=db, module="vendor_portal", action="forgot_password",
            record_id=db_user.id, description=f"Vendor user '{db_user.username}' requested password reset",
            user_id=db_user.id, user_name=db_user.username
        )
        await db.commit()
        return {
            "success": True,
            "message": "Password reset instructions have been initiated. Please use the reset link provided or check with purchasing.",
            "reset_link": f"/vendor/reset-password/{token}",
        }

    return {
        "success": True,
        "message": "If the account exists, password reset instructions have been processed.",
    }


@router.post("/auth/reset-password")
async def vendor_reset_password(body: vendor_reset_password_in, db: AsyncSession = Depends(get_db)):
    token = body.token.strip()
    u_res = await db.execute(select(user_model).where(user_model.reset_token == token))
    db_user = u_res.scalar_one_or_none()

    if not db_user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")

    if db_user.reset_token_expiry and db_user.reset_token_expiry < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Reset token has expired. Please request a new one.")

    db_user.password = get_password_hash(body.new_password)
    db_user.reset_token = None
    db_user.reset_token_expiry = None

    await write_audit(
        db=db, module="vendor_portal", action="reset_password",
        record_id=db_user.id, description=f"Vendor user '{db_user.username}' successfully reset their password",
        user_id=db_user.id, user_name=db_user.username
    )
    await db.commit()
    return {"success": True, "message": "Password reset successfully. You can now log in with your new password."}


# ── DASHBOARD ─────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def get_vendor_dashboard(
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    s_id = supp.id

    # 1. PO metrics
    valid_po_statuses = ["approved", "sent", "partially_received", "received", "completed", "closed", "cancelled"]
    pos_q = select(po_header).where(po_header.supplier_id == s_id, po_header.status.in_(valid_po_statuses))
    all_pos = (await db.execute(pos_q.options(selectinload(po_header.items)))).scalars().all()

    total_pos = len(all_pos)
    open_pos = 0
    partially_received_pos = 0
    completed_pos = 0

    for po in all_pos:
        st = (po.status or "").lower()
        if st in ("completed", "received", "closed"):
            completed_pos += 1
        elif st in ("approved", "sent", "partial", "partially_received"):
            open_pos += 1

        tot_ord = sum((it.order_qty or it.qty or Decimal("0")) for it in po.items)
        tot_rec = sum((it.received_qty or Decimal("0")) for it in po.items)
        if tot_rec > Decimal("0") and tot_rec < tot_ord:
            partially_received_pos += 1

    # 2. Total GRNs
    total_grns_r = await db.execute(
        select(func.count(purchase_model.id)).where(purchase_model.supplier_id == s_id)
    )
    total_grns = total_grns_r.scalar_one()

    # 3. Total PRNs
    total_prns_r = await db.execute(
        select(func.count(unit_wise_purchase_return.id)).where(unit_wise_purchase_return.supplier_id == s_id)
    )
    total_prns = total_prns_r.scalar_one()

    # 4. Cheques count
    cheques_cnt_r = await db.execute(
        text("SELECT COUNT(*) FROM supplier_payments WHERE supplier_id = :sid AND mode = 'cheque'"),
        {"sid": s_id}
    )
    total_cheques = cheques_cnt_r.scalar_one()

    # 5. Payments total & Outstanding Balance
    pay_tot_r = await db.execute(
        text("SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE supplier_id = :sid AND status IN ('approved', 'paid')"),
        {"sid": s_id}
    )
    total_payments = float(pay_tot_r.scalar_one())

    due_r = await db.execute(
        text("SELECT COALESCE(SUM(due_amount), 0) FROM unit_wise_purchases WHERE supplier_id = :sid AND status <> 'cancelled'"),
        {"sid": s_id}
    )
    outstanding_balance = float(due_r.scalar_one())

    # 6. Supplied Products count
    prod_cnt_r = await db.execute(
        select(func.count(product_model.id)).where(product_model.supplier_id == s_id)
    )
    supplied_items_count = prod_cnt_r.scalar_one()

    # 7. Pending Item Requests
    item_req_r = await db.execute(
        select(func.count(vendor_item_request.id)).where(
            vendor_item_request.supplier_id == s_id,
            vendor_item_request.status.in_(["submitted", "under_review", "correction_requested"])
        )
    )
    pending_item_requests = item_req_r.scalar_one()

    # 8. Pending Profile Requests
    prof_req_r = await db.execute(
        select(func.count(vendor_profile_request.id)).where(
            vendor_profile_request.supplier_id == s_id,
            vendor_profile_request.status == "pending"
        )
    )
    pending_profile_requests = prof_req_r.scalar_one()

    # 9. Sales summary (if enabled)
    sales_summary_30d = None
    if supp.portal_sales_enabled:
        p_ids_r = await db.execute(select(product_model.id).where(product_model.supplier_id == s_id))
        p_ids = [r[0] for r in p_ids_r.all()]
        if p_ids:
            sq = (
                select(
                    func.sum(invoice_item_model.qty).label("qty"),
                    func.sum(invoice_item_model.total).label("val")
                )
                .join(invoice_model, invoice_model.id == invoice_item_model.invoice_id)
                .where(
                    invoice_item_model.product_id.in_(p_ids),
                    invoice_model.invoice_date >= date_type.today() - timedelta(days=30)
                )
            )
            s_row = (await db.execute(sq)).one_or_none()
            if s_row:
                sales_summary_30d = {
                    "sales_quantity": float(s_row.qty or 0),
                    "sales_value": float(s_row.val or 0),
                }

    # 10. Recent POs (latest 5)
    recent_pos = []
    sorted_pos = sorted(all_pos, key=lambda x: (x.po_date or date_type.min, x.id), reverse=True)[:5]
    for p in sorted_pos:
        recent_pos.append({
            "id": p.id,
            "po_no": p.po_no,
            "po_date": str(p.po_date),
            "expected_date": str(p.expected_date) if p.expected_date else None,
            "status": p.status,
            "total_amount": float(p.total_amount or 0),
            "vendor_ack": p.vendor_ack,
            "items_count": len(p.items),
        })

    # 11. Recent GRNs (latest 5)
    recent_grns_r = await db.execute(
        select(purchase_model)
        .where(purchase_model.supplier_id == s_id)
        .order_by(purchase_model.invoice_date.desc(), purchase_model.id.desc())
        .limit(5)
    )
    recent_grns = [{
        "id": g.id,
        "purchase_no": g.purchase_no,
        "invoice_no": g.invoice_no,
        "invoice_date": str(g.invoice_date),
        "total_amount": float(g.total_amount or 0),
        "status": g.status,
    } for g in recent_grns_r.scalars().all()]

    # 12. Recent PRNs (latest 5)
    recent_prns_r = await db.execute(
        select(unit_wise_purchase_return)
        .where(unit_wise_purchase_return.supplier_id == s_id)
        .order_by(unit_wise_purchase_return.return_date.desc(), unit_wise_purchase_return.id.desc())
        .limit(5)
    )
    recent_prns = [{
        "id": pr.id,
        "prn_no": pr.prn_no,
        "return_date": str(pr.return_date) if pr.return_date else None,
        "ref_purchase_no": pr.ref_purchase_no,
        "total_amount": float(pr.total_amount or 0),
        "reason": pr.reason,
        "status": pr.status,
        "vendor_ack": pr.vendor_ack,
    } for pr in recent_prns_r.scalars().all()]

    # 13. Recent Cheques (latest 5)
    recent_chqs_r = await db.execute(
        text("""
            SELECT id, payment_no, reference_no, payment_date, amount, status
            FROM supplier_payments
            WHERE supplier_id = :sid AND mode = 'cheque'
            ORDER BY payment_date DESC, id DESC LIMIT 5
        """),
        {"sid": s_id}
    )
    recent_cheques = []
    for c in recent_chqs_r.mappings().all():
        ref = c["reference_no"] or ""
        masked_ref = f"****{ref[-4:]}" if len(ref) >= 4 else (f"****{ref}" if ref else "N/A")
        recent_cheques.append({
            "id": c["id"],
            "payment_no": c["payment_no"],
            "cheque_no_masked": masked_ref,
            "cheque_date": str(c["payment_date"]) if c["payment_date"] else None,
            "amount": float(c["amount"] or 0),
            "status": c["status"] or "issued",
        })

    return {
        "supplier": {
            "id": supp.id,
            "name": supp.name,
            "trade_name": supp.trade_name,
            "supplier_code": supp.supplier_code,
            "supplier_type": supp.supplier_type,
            "phone": supp.phone,
            "email": supp.email,
            "gst_number": supp.gst_number,
            "pan_number": supp.pan_number,
            "registration_status": supp.registration_status,
            "portal_sales_enabled": supp.portal_sales_enabled,
            "portal_sales_config": supp.portal_sales_config or {},
            "portal_permissions": supp.portal_permissions or {},
        },
        "kpis": {
            "total_pos": total_pos,
            "open_pos": open_pos,
            "partially_received_pos": partially_received_pos,
            "completed_pos": completed_pos,
            "total_grns": total_grns,
            "total_prns": total_prns,
            "total_cheques": total_cheques,
            "total_payments": total_payments,
            "outstanding_balance": outstanding_balance,
            "pending_deliveries": open_pos,
            "supplied_items_count": supplied_items_count,
            "pending_item_requests": pending_item_requests,
            "pending_profile_requests": pending_profile_requests,
            "sales_summary_30d": sales_summary_30d,
        },
        "recent_pos": recent_pos,
        "recent_grns": recent_grns,
        "recent_prns": recent_prns,
        "recent_cheques": recent_cheques,
    }


# ── VENDOR PROFILE ────────────────────────────────────────────────────────────

@router.get("/profile")
async def get_vendor_profile(
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    
    from app.routers.suppliers import _all_selects
    q = _all_selects(select(supplier_model).where(supplier_model.id == supp.id))
    supp_full = (await db.execute(q)).scalar_one()

    pending_req = (await db.execute(
        select(vendor_profile_request)
        .where(vendor_profile_request.supplier_id == supp.id, vendor_profile_request.status == "pending")
        .order_by(vendor_profile_request.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    res = supplier_out.model_validate(supp_full).model_dump()
    res["pending_profile_request"] = vendor_profile_request_out.model_validate(pending_req).model_dump() if pending_req else None
    return res


@router.post("/profile-update-request")
async def create_profile_update_request(
    body: vendor_profile_request_create,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "edit_profile")

    if not body.changes:
        raise HTTPException(status_code=400, detail="No changes provided in the update request")

    req = vendor_profile_request(
        supplier_id=supp.id,
        requested_by_user_id=current_user.user_id,
        status="pending",
        changes=body.changes,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    await write_audit(
        db=db, module="vendor_portal", action="profile_update_request",
        record_id=req.id, description=f"Vendor {supp.name} submitted profile change request",
        user_id=current_user.user_id, user_name=current_user.username,
    )
    return req


# ── PURCHASE ORDERS ───────────────────────────────────────────────────────────

@router.get("/purchase-orders")
async def list_vendor_purchase_orders(
    status: str | None = None,
    from_date: date_type | None = None,
    to_date: date_type | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "view_pos")

    q = select(po_header).where(
        po_header.supplier_id == supp.id,
        po_header.status != "draft",
        po_header.approval_status == "approved"
    )

    if status and status != "all":
        q = q.where(po_header.status == status)
    if from_date:
        q = q.where(po_header.po_date >= from_date)
    if to_date:
        q = q.where(po_header.po_date <= to_date)

    total_r = await db.execute(select(func.count()).select_from(q.subquery()))
    total = total_r.scalar_one()

    pos_r = await db.execute(
        q.options(selectinload(po_header.items))
        .order_by(po_header.po_date.desc(), po_header.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    pos = pos_r.scalars().all()

    p_ids = {it.product_id for p in pos for it in p.items}
    prod_map = {}
    if p_ids:
        prods_r = await db.execute(
            select(product_model.id, product_model.name, product_model.item_code, product_model.barcode, product_model.brand, product_model.unit)
            .where(product_model.id.in_(p_ids))
        )
        for pr in prods_r.all():
            prod_map[pr.id] = {
                "name": pr.name,
                "item_code": pr.item_code,
                "barcode": pr.barcode,
                "brand": pr.brand,
                "unit": pr.unit or "PCS",
            }

    items_out = []
    for p in pos:
        po_items_list = []
        tot_ord = Decimal("0.00")
        tot_rec = Decimal("0.00")
        for it in p.items:
            pm = prod_map.get(it.product_id, {})
            ord_q = it.order_qty or it.qty or Decimal("0.00")
            rec_q = it.received_qty or Decimal("0.00")
            pend_q = max(Decimal("0.00"), ord_q - rec_q)
            tot_ord += ord_q
            tot_rec += rec_q

            po_items_list.append({
                "id": it.id,
                "product_id": it.product_id,
                "product_name": pm.get("name", "Product"),
                "item_code": pm.get("item_code"),
                "barcode": pm.get("barcode"),
                "brand": pm.get("brand"),
                "unit": pm.get("unit") or "PCS",
                "order_qty": float(ord_q),
                "received_qty": float(rec_q),
                "pending_qty": float(pend_q),
                "rate": float(it.rate or 0),
                "gst_percent": float(it.gst_percent or 0),
                "total": float(it.total or it.amount or 0),
            })

        items_out.append({
            "id": p.id,
            "po_no": p.po_no,
            "po_date": str(p.po_date),
            "expected_date": str(p.expected_date) if p.expected_date else None,
            "outlet_id": p.outlet_id,
            "status": p.status,
            "total_amount": float(p.total_amount or 0),
            "vendor_ack": p.vendor_ack,
            "vendor_ack_at": p.vendor_ack_at.isoformat() if p.vendor_ack_at else None,
            "vendor_expected_delivery": str(p.vendor_expected_delivery) if p.vendor_expected_delivery else None,
            "vendor_delivery_remarks": p.vendor_delivery_remarks,
            "total_ordered_qty": float(tot_ord),
            "total_received_qty": float(tot_rec),
            "item_count": len(p.items),
            "items": po_items_list,
        })

    return {
        "items": items_out,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": math.ceil(total / per_page) if per_page else 1,
    }


@router.get("/purchase-orders/{po_id}")
async def get_vendor_purchase_order_detail(
    po_id: int,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "view_pos")

    po = (await db.execute(
        select(po_header)
        .where(
            po_header.id == po_id,
            po_header.supplier_id == supp.id,
            po_header.status != "draft",
        )
        .options(selectinload(po_header.items), selectinload(po_header.terms_conditions))
    )).scalar_one_or_none()

    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    p_ids = {it.product_id for it in po.items}
    prod_map = {}
    if p_ids:
        prods_r = await db.execute(
            select(product_model.id, product_model.name, product_model.item_code, product_model.barcode, product_model.brand, product_model.unit)
            .where(product_model.id.in_(p_ids))
        )
        for pr in prods_r.all():
            prod_map[pr.id] = {
                "name": pr.name, "item_code": pr.item_code, "barcode": pr.barcode, "brand": pr.brand, "unit": pr.unit
            }

    po_items_list = []
    tot_ord = Decimal("0.00")
    tot_rec = Decimal("0.00")
    for it in po.items:
        pm = prod_map.get(it.product_id, {})
        ord_q = it.order_qty or it.qty or Decimal("0.00")
        rec_q = it.received_qty or Decimal("0.00")
        tot_ord += ord_q
        tot_rec += rec_q
        po_items_list.append({
            "id": it.id,
            "product_id": it.product_id,
            "product_name": pm.get("name", "Product"),
            "item_code": pm.get("item_code"),
            "barcode": pm.get("barcode"),
            "brand": pm.get("brand"),
            "unit": pm.get("unit") or "PCS",
            "order_qty": float(ord_q),
            "received_qty": float(rec_q),
            "pending_qty": float(max(Decimal("0.00"), ord_q - rec_q)),
            "rate": float(it.rate or 0),
            "gst_percent": float(it.gst_percent or 0),
            "total": float(it.total or it.amount or 0),
        })

    terms_list = [{
        "title": t.title,
        "description": t.description,
        "term_type": t.term_type,
    } for t in po.terms_conditions]

    return {
        "id": po.id,
        "po_no": po.po_no,
        "po_date": str(po.po_date),
        "expected_date": str(po.expected_date) if po.expected_date else None,
        "outlet_id": po.outlet_id,
        "status": po.status,
        "approval_status": po.approval_status,
        "total_amount": float(po.total_amount or 0),
        "vendor_ack": po.vendor_ack,
        "vendor_ack_at": po.vendor_ack_at.isoformat() if po.vendor_ack_at else None,
        "vendor_expected_delivery": str(po.vendor_expected_delivery) if po.vendor_expected_delivery else None,
        "vendor_delivery_remarks": po.vendor_delivery_remarks,
        "notes": po.notes,
        "total_ordered_qty": float(tot_ord),
        "total_received_qty": float(tot_rec),
        "items": po_items_list,
        "terms_conditions": terms_list,
    }


@router.post("/purchase-orders/{po_id}/acknowledge")
async def acknowledge_purchase_order(
    po_id: int,
    body: po_vendor_ack_in,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)

    po = (await db.execute(
        select(po_header).where(po_header.id == po_id, po_header.supplier_id == supp.id)
    )).scalar_one_or_none()

    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    po.vendor_ack = True
    po.vendor_ack_at = datetime.now()
    if body.vendor_expected_delivery:
        po.vendor_expected_delivery = body.vendor_expected_delivery
    if body.vendor_delivery_remarks:
        po.vendor_delivery_remarks = body.vendor_delivery_remarks

    audit = po_audit_log(
        po_id=po.id,
        action="vendor_acknowledged",
        description=f"PO acknowledged by vendor {supp.name} (Exp delivery: {body.vendor_expected_delivery or 'Not specified'})",
        created_by=current_user.user_id,
    )
    db.add(audit)
    await db.commit()
    return {
        "success": True,
        "message": "Purchase order acknowledged successfully",
        "vendor_ack_at": po.vendor_ack_at.isoformat(),
        "vendor_expected_delivery": str(po.vendor_expected_delivery) if po.vendor_expected_delivery else None,
    }


# ── GRN (GOODS RECEIVED NOTE) ─────────────────────────────────────────────────

@router.get("/grns")
async def list_vendor_grns(
    from_date: date_type | None = None,
    to_date: date_type | None = None,
    po_no: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "view_grn")

    q = select(purchase_model).where(purchase_model.supplier_id == supp.id)

    if from_date:
        q = q.where(purchase_model.invoice_date >= from_date)
    if to_date:
        q = q.where(purchase_model.invoice_date <= to_date)
    if po_no:
        q = q.where(purchase_model.notes.ilike(f"%{po_no}%"))

    total_r = await db.execute(select(func.count()).select_from(q.subquery()))
    total = total_r.scalar_one()

    grns_r = await db.execute(
        q.options(selectinload(purchase_model.items))
        .order_by(purchase_model.invoice_date.desc(), purchase_model.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    grns = grns_r.scalars().all()

    p_ids = {it.product_id for g in grns for it in g.items}
    prod_map = {}
    if p_ids:
        prods_r = await db.execute(
            select(product_model.id, product_model.name, product_model.item_code, product_model.barcode, product_model.unit)
            .where(product_model.id.in_(p_ids))
        )
        for pr in prods_r.all():
            prod_map[pr.id] = {
                "name": pr.name, "item_code": pr.item_code, "barcode": pr.barcode, "unit": pr.unit
            }

    res = []
    for g in grns:
        item_rows = []
        for it in g.items:
            pm = prod_map.get(it.product_id, {})
            item_rows.append({
                "id": it.id,
                "product_id": it.product_id,
                "product_name": pm.get("name", "Product"),
                "item_code": it.item_code or pm.get("item_code"),
                "barcode": pm.get("barcode"),
                "unit": it.unit or pm.get("unit") or "PCS",
                "qty_received": float(it.qty or 0),
                "free_qty": float(it.free_qty or 0),
                "price": float(it.price or 0),
                "taxable_amt": float(it.taxable_amt or it.basic_amt or 0),
                "gst_percent": float(it.gst_percent or 0),
                "total": float(it.total or 0),
                "batch_no": it.batch_no,
                "mfg_date": str(it.mfg_date) if it.mfg_date else None,
                "expiry_date": str(it.expiry_date) if it.expiry_date else None,
            })

        res.append({
            "id": g.id,
            "purchase_no": g.purchase_no,
            "invoice_no": g.invoice_no,
            "invoice_date": str(g.invoice_date),
            "outlet_id": g.outlet_id,
            "total_qty": float(g.total_qty or 0),
            "taxable_amount": float(g.taxable_amount or 0),
            "total_gst": float(g.total_gst or 0),
            "total_amount": float(g.total_amount or 0),
            "status": g.status,
            "notes": g.notes,
            "items": item_rows,
        })

    return {
        "items": res,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": math.ceil(total / per_page) if per_page else 1,
    }


# ── PRN (PURCHASE RETURN NOTE) ────────────────────────────────────────────────

@router.get("/prns")
async def list_vendor_prns(
    search: str | None = None,
    from_date: date_type | None = None,
    to_date: date_type | None = None,
    status: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "view_prn")

    q = select(unit_wise_purchase_return).where(unit_wise_purchase_return.supplier_id == supp.id)
    if search:
        search_term = f"%{search.strip()}%"
        q = q.where(
            (unit_wise_purchase_return.prn_no.ilike(search_term)) |
            (unit_wise_purchase_return.ref_purchase_no.ilike(search_term)) |
            (unit_wise_purchase_return.reason.ilike(search_term))
        )
    if from_date:
        q = q.where(unit_wise_purchase_return.return_date >= from_date)
    if to_date:
        q = q.where(unit_wise_purchase_return.return_date <= to_date)
    if status and status != "all":
        q = q.where(unit_wise_purchase_return.status == status)

    total_r = await db.execute(select(func.count()).select_from(q.subquery()))
    total = total_r.scalar_one()

    prns_r = await db.execute(
        q.order_by(unit_wise_purchase_return.return_date.desc(), unit_wise_purchase_return.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    prns = prns_r.scalars().all()

    prn_ids = [p.id for p in prns]
    items_map = {}
    if prn_ids:
        it_r = await db.execute(
            select(unit_wise_purchase_return_item)
            .where(unit_wise_purchase_return_item.prn_id.in_(prn_ids))
        )
        for it in it_r.scalars().all():
            items_map.setdefault(it.prn_id, []).append({
                "id": it.id,
                "product_id": it.product_id,
                "name": it.name,
                "item_code": it.item_code,
                "hsn_code": it.hsn_code,
                "qty": float(it.qty or 0),
                "unit": it.unit,
                "price": float(it.price or 0),
                "total": float(it.total or 0),
                "batch_no": it.batch_no,
                "return_reason": it.return_reason,
            })

    out_items = []
    for p in prns:
        out_items.append({
            "id": p.id,
            "prn_no": p.prn_no,
            "return_date": str(p.return_date) if p.return_date else None,
            "ref_purchase_no": p.ref_purchase_no,
            "total_qty": float(p.total_qty or 0),
            "taxable_amount": float(p.taxable_amount or 0),
            "total_gst": float(p.total_gst or 0),
            "total_amount": float(p.total_amount or 0),
            "reason": p.reason,
            "notes": p.notes,
            "status": p.status,
            "vendor_ack": p.vendor_ack,
            "vendor_ack_at": p.vendor_ack_at.isoformat() if p.vendor_ack_at else None,
            "vendor_remarks": p.vendor_remarks,
            "items": items_map.get(p.id, []),
        })

    return {
        "items": out_items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": math.ceil(total / per_page) if per_page else 1,
    }


@router.post("/prns/{prn_id}/acknowledge")
async def acknowledge_prn(
    prn_id: int,
    body: prn_vendor_ack_in,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "view_prn")

    prn = (await db.execute(
        select(unit_wise_purchase_return).where(
            unit_wise_purchase_return.id == prn_id,
            unit_wise_purchase_return.supplier_id == supp.id
        )
    )).scalar_one_or_none()

    if not prn:
        raise HTTPException(status_code=404, detail="Purchase Return Note not found")

    prn.vendor_ack = True
    prn.vendor_ack_at = datetime.now()
    if body.vendor_remarks:
        prn.vendor_remarks = body.vendor_remarks

    await write_audit(
        db=db, module="vendor_portal", action="prn_ack",
        record_id=prn.id, description=f"Vendor acknowledged PRN #{prn.prn_no}",
        user_id=current_user.user_id, user_name=current_user.username
    )
    await db.commit()
    return {"success": True, "message": "PRN acknowledged successfully"}


# ── CHEQUES MANAGEMENT ────────────────────────────────────────────────────────

@router.get("/cheques")
async def list_vendor_cheques(
    status: str | None = None,
    from_date: date_type | None = None,
    to_date: date_type | None = None,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "view_cheques")

    sql = """
        SELECT sp.id, sp.payment_no, sp.payment_date, sp.reference_no, sp.amount,
               sp.status, sp.remarks, sp.created_at, b.name AS bank_name
        FROM supplier_payments sp
        LEFT JOIN bank_accounts b ON b.id = sp.bank_account_id
        WHERE sp.supplier_id = :sid AND sp.mode = 'cheque'
    """
    params = {"sid": supp.id}
    if status and status != "all":
        sql += " AND sp.status = :st"
        params["st"] = status
    if from_date:
        sql += " AND sp.payment_date >= :fdate"
        params["fdate"] = from_date
    if to_date:
        sql += " AND sp.payment_date <= :tdate"
        params["tdate"] = to_date

    sql += " ORDER BY sp.payment_date DESC, sp.id DESC LIMIT 100"

    rows = (await db.execute(text(sql), params)).mappings().all()

    cheques_out = []
    for r in rows:
        ref = r["reference_no"] or ""
        masked_ref = f"****{ref[-4:]}" if len(ref) >= 4 else (f"****{ref}" if ref else "N/A")
        cheques_out.append({
            "id": r["id"],
            "payment_no": r["payment_no"],
            "cheque_no_masked": masked_ref,
            "cheque_date": str(r["payment_date"]) if r["payment_date"] else None,
            "bank_name": r["bank_name"] or "Company Bank",
            "amount": float(r["amount"] or 0),
            "status": r["status"] or "issued",
            "remarks": r["remarks"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        })

    return cheques_out


# ── PAYMENTS & LEDGER ─────────────────────────────────────────────────────────

@router.get("/payments")
async def list_vendor_payments(
    from_date: date_type | None = None,
    to_date: date_type | None = None,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "view_payments")

    sql = """
        SELECT sp.id, sp.payment_no, sp.payment_date, sp.mode, sp.reference_no,
               sp.amount, sp.status, sp.remarks, sp.created_at, b.name AS bank_name,
               (SELECT STRING_AGG(g.purchase_no || COALESCE(' (Bill: ' || g.bill_no || ')', ''), ', ')
                FROM supplier_payment_allocations a
                JOIN unit_wise_purchases g ON g.id = a.purchase_id
                WHERE a.payment_id = sp.id AND a.status = 'active') AS allocated_bills
        FROM supplier_payments sp
        LEFT JOIN bank_accounts b ON b.id = sp.bank_account_id
        WHERE sp.supplier_id = :sid
    """
    params = {"sid": supp.id}
    if from_date:
        sql += " AND sp.payment_date >= :fdate"
        params["fdate"] = from_date
    if to_date:
        sql += " AND sp.payment_date <= :tdate"
        params["tdate"] = to_date

    sql += " ORDER BY sp.payment_date DESC, sp.id DESC LIMIT 200"
    rows = (await db.execute(text(sql), params)).mappings().all()

    return [{
        "id": r["id"],
        "payment_no": r["payment_no"],
        "payment_date": str(r["payment_date"]) if r["payment_date"] else None,
        "mode": (r["mode"] or "neft").upper(),
        "reference_no": (f"****{r['reference_no'][-4:]}" if r['reference_no'] and len(r['reference_no']) >= 4 else (r['reference_no'] or '')) if r['mode'] == 'cheque' else r['reference_no'],
        "amount": float(r["amount"] or 0),
        "status": r["status"] or "approved",
        "bank_name": r["bank_name"],
        "allocated_bills": r["allocated_bills"],
        "remarks": r["remarks"],
    } for r in rows]


@router.get("/ledger")
async def get_vendor_ledger(
    from_date: date_type | None = None,
    to_date: date_type | None = None,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "view_ledger")

    opening_bal = Decimal(str(supp.opening_balance or "0.00"))

    # Purchases / GRNs (Credit: Goods supplied to company)
    purchases_q = select(purchase_model).where(
        purchase_model.supplier_id == supp.id,
        purchase_model.status != "cancelled"
    )
    if from_date:
        purchases_q = purchases_q.where(purchase_model.invoice_date >= from_date)
    if to_date:
        purchases_q = purchases_q.where(purchase_model.invoice_date <= to_date)
    purchases = (await db.execute(purchases_q)).scalars().all()

    # Payments made to supplier (Debit: Cash/Bank outflow to vendor)
    payments_sql = """
        SELECT payment_no, payment_date, amount, mode, reference_no, status
        FROM supplier_payments
        WHERE supplier_id = :sid AND status IN ('approved', 'paid')
    """
    params = {"sid": supp.id}
    if from_date:
        payments_sql += " AND payment_date >= :fdate"
        params["fdate"] = from_date
    if to_date:
        payments_sql += " AND payment_date <= :tdate"
        params["tdate"] = to_date
    payments = (await db.execute(text(payments_sql), params)).mappings().all()

    # Returns / PRNs / Debit Notes (Debit: Returned items to vendor)
    prns_q = select(unit_wise_purchase_return).where(
        unit_wise_purchase_return.supplier_id == supp.id,
        unit_wise_purchase_return.status != "cancelled"
    )
    if from_date:
        prns_q = prns_q.where(unit_wise_purchase_return.return_date >= from_date)
    if to_date:
        prns_q = prns_q.where(unit_wise_purchase_return.return_date <= to_date)
    prns = (await db.execute(prns_q)).scalars().all()

    entries = []

    for p in purchases:
        amt = Decimal(str(p.total_amount or "0.00"))
        entries.append({
            "date": p.invoice_date,
            "ref_no": p.purchase_no,
            "invoice_no": p.invoice_no,
            "type": "PURCHASE",
            "description": f"Purchase / GRN ({p.invoice_no or p.purchase_no})",
            "debit": Decimal("0.00"),
            "credit": amt,
        })

    for pay in payments:
        amt = Decimal(str(pay["amount"] or "0.00"))
        entries.append({
            "date": pay["payment_date"],
            "ref_no": pay["payment_no"],
            "invoice_no": pay["reference_no"],
            "type": "PAYMENT",
            "description": f"Payment via {pay['mode'].upper()} ({pay['reference_no'] or pay['payment_no']})",
            "debit": amt,
            "credit": Decimal("0.00"),
        })

    for ret in prns:
        amt = Decimal(str(ret.total_amount or "0.00"))
        entries.append({
            "date": ret.return_date,
            "ref_no": ret.prn_no,
            "invoice_no": ret.ref_purchase_no,
            "type": "RETURN / PRN",
            "description": f"Debit Note / Return ({ret.prn_no})",
            "debit": amt,
            "credit": Decimal("0.00"),
        })

    entries.sort(key=lambda x: (x["date"] or date_type.min, x["ref_no"]))

    running = opening_bal
    rows = []
    tot_debit = Decimal("0.00")
    tot_credit = Decimal("0.00")

    for e in entries:
        tot_debit += e["debit"]
        tot_credit += e["credit"]
        running = running + e["credit"] - e["debit"]
        rows.append({
            "date": str(e["date"]) if e["date"] else None,
            "ref_no": e["ref_no"],
            "invoice_no": e.get("invoice_no"),
            "type": e["type"],
            "description": e["description"],
            "debit": float(e["debit"]),
            "credit": float(e["credit"]),
            "balance": float(running),
        })

    return {
        "supplier": {
            "id": supp.id,
            "name": supp.name,
            "supplier_code": supp.supplier_code,
            "gst_number": supp.gst_number,
        },
        "opening_balance": float(opening_bal),
        "total_credit": float(tot_credit),
        "total_debit": float(tot_debit),
        "closing_balance": float(running),
        "transactions": rows,
    }


# ── PURCHASE INVOICES ─────────────────────────────────────────────────────────

@router.get("/invoices")
async def list_vendor_invoices(
    from_date: date_type | None = None,
    to_date: date_type | None = None,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)

    q = select(purchase_model).where(
        purchase_model.supplier_id == supp.id,
        purchase_model.status != "cancelled"
    )
    if from_date:
        q = q.where(purchase_model.invoice_date >= from_date)
    if to_date:
        q = q.where(purchase_model.invoice_date <= to_date)

    q = q.order_by(purchase_model.invoice_date.desc(), purchase_model.id.desc()).limit(200)
    invoices = (await db.execute(q)).scalars().all()

    return [{
        "id": inv.id,
        "purchase_no": inv.purchase_no,
        "invoice_no": inv.invoice_no,
        "invoice_date": str(inv.invoice_date),
        "total_amount": float(inv.total_amount or 0),
        "paid_amount": float(inv.paid_amount or 0),
        "due_amount": float(inv.due_amount or 0),
        "status": inv.status,
        "notes": inv.notes,
    } for inv in invoices]


# ── ITEM-WISE SALES REPORT (PERMISSION CONTROLLED) ────────────────────────────

@router.get("/item-sales")
async def get_vendor_item_sales(
    from_date: date_type | None = None,
    to_date: date_type | None = None,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)

    if not supp.portal_sales_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Item sales reports are not enabled for your vendor account. Please contact the Nutribay purchasing department.",
        )

    cfg = supp.portal_sales_config or {}
    view_qty = cfg.get("view_sales_quantity", True)
    view_val = cfg.get("view_sales_value", True)
    view_stock = cfg.get("view_stock_position", False)
    view_outlet = cfg.get("view_outlet_wise", False)

    p_r = await db.execute(
        select(product_model.id, product_model.name, product_model.item_code, product_model.barcode,
               product_model.brand, product_model.category, product_model.stock_qty, product_model.mrp)
        .where(product_model.supplier_id == supp.id)
    )
    products = p_r.all()
    if not products:
        return {
            "permissions": cfg,
            "summary": {"total_qty": 0, "total_value": 0, "product_count": 0},
            "products": [],
        }

    prod_ids = [p.id for p in products]

    q = (
        select(
            invoice_item_model.product_id,
            func.sum(invoice_item_model.qty).label("total_sold_qty"),
            func.sum(invoice_item_model.total).label("total_sold_value"),
        )
        .join(invoice_model, invoice_model.id == invoice_item_model.invoice_id)
        .where(invoice_item_model.product_id.in_(prod_ids))
    )
    if from_date:
        q = q.where(invoice_model.invoice_date >= from_date)
    if to_date:
        q = q.where(invoice_model.invoice_date <= to_date)

    q = q.group_by(invoice_item_model.product_id)
    sales_r = await db.execute(q)
    sales_map = {row.product_id: {"qty": float(row.total_sold_qty or 0), "value": float(row.total_sold_value or 0)} for row in sales_r.all()}

    res_products = []
    tot_qty = 0.0
    tot_val = 0.0

    for p in products:
        s = sales_map.get(p.id, {"qty": 0.0, "value": 0.0})
        tot_qty += s["qty"]
        tot_val += s["value"]

        item_row = {
            "product_id": p.id,
            "product_name": p.name,
            "item_code": p.item_code,
            "barcode": p.barcode,
            "brand": p.brand,
            "category": p.category,
            "mrp": float(p.mrp or 0),
            "sales_qty": s["qty"] if view_qty else None,
            "sales_value": s["value"] if view_val else None,
            "current_stock": float(p.stock_qty or 0) if view_stock else None,
        }
        res_products.append(item_row)

    return {
        "permissions": {
            "view_sales_quantity": view_qty,
            "view_sales_value": view_val,
            "view_stock_position": view_stock,
            "view_outlet_wise": view_outlet,
            "export_allowed": cfg.get("export_allowed", False),
        },
        "summary": {
            "total_qty": tot_qty if view_qty else None,
            "total_value": tot_val if view_val else None,
            "product_count": len(products),
        },
        "products": res_products,
    }


# ── NEW ITEM REQUESTS (PROPOSALS) ─────────────────────────────────────────────

@router.get("/item-requests")
async def list_vendor_item_requests(
    status: str | None = None,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "view_item_requests")

    q = select(vendor_item_request).where(vendor_item_request.supplier_id == supp.id)
    if status and status != "all":
        q = q.where(vendor_item_request.status == status)

    q = q.order_by(vendor_item_request.created_at.desc())
    r = await db.execute(q)
    return r.scalars().all()


@router.post("/item-requests")
async def submit_vendor_item_request(
    body: vendor_item_request_create,
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    _check_perm(supp, "submit_item_requests")

    if body.barcode:
        existing = (await db.execute(
            select(product_model.id, product_model.name)
            .where(product_model.barcode == body.barcode)
        )).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Barcode '{body.barcode}' already exists on product '{existing.name}' (ID: {existing.id}). Please check or contact purchasing.",
            )

    req_no = f"NIR-{supp.supplier_code or supp.id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"

    item_req = vendor_item_request(
        request_no=req_no,
        supplier_id=supp.id,
        product_name=body.product_name,
        brand_name=body.brand_name,
        brand_id=body.brand_id,
        category_name=body.category_name,
        category_id=body.category_id,
        manufacturer=body.manufacturer,
        vendor_item_code=body.vendor_item_code,
        barcode=body.barcode,
        description=body.description,
        unit=body.unit,
        pack_size=body.pack_size,
        purchase_rate=body.purchase_rate,
        mrp=body.mrp,
        proposed_selling_price=body.proposed_selling_price or body.mrp,
        gst_percent=body.gst_percent,
        hsn_code=body.hsn_code,
        moq=body.moq,
        lead_time_days=body.lead_time_days,
        country_of_origin=body.country_of_origin,
        image_url=body.image_url,
        brochure_url=body.brochure_url,
        vendor_remarks=body.vendor_remarks,
        status="submitted",
    )
    db.add(item_req)
    await db.commit()
    await db.refresh(item_req)

    await write_audit(
        db=db, module="vendor_portal", action="create_item_request",
        record_id=item_req.id, description=f"Vendor {supp.name} proposed new item '{body.product_name}' (Request #{req_no})",
        user_id=current_user.user_id, user_name=current_user.username,
    )
    return item_req


# ── PORTAL PERMISSIONS / SETTINGS ─────────────────────────────────────────────

@router.get("/settings")
async def get_vendor_portal_settings(
    supplier_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await _resolve_vendor_supplier(current_user, db, supplier_id)
    return {
        "portal_sales_enabled": supp.portal_sales_enabled,
        "portal_sales_config": supp.portal_sales_config or {},
        "portal_permissions": supp.portal_permissions or {},
    }
