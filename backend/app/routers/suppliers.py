import math
import uuid
from datetime import datetime, date as date_type
from decimal import Decimal
import os
from fastapi import APIRouter, Depends, HTTPException, Query, status, File, UploadFile, Form
from sqlalchemy import func, select, text, update, delete, insert
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role, current_user_dep
from sqlalchemy.orm import selectinload
from app.models.party import (
    supplier as supplier_model,
    supplier_address, supplier_legal, supplier_contact,
    supplier_director, supplier_auth_person, supplier_brand,
    supplier_financial, supplier_document, supplier_note,
    supplier_terms as supplier_terms_model,
    supplier_challan, supplier_challan_item,
    supplier_approval_log,
)
from app.models.state import supplier_gstin as supplier_gstin_model
import secrets
from datetime import timedelta
from app.models.user import user as user_model, audit_log as audit_log_model
from app.core.security import get_password_hash
from app.schemas.party import (
    vendor_profile_request_review, vendor_profile_request_out, vendor_item_request_review, vendor_item_request_out, portal_settings_update,
    supplier_create, supplier_update, supplier_out, supplier_list_out,
    supplier_terms_create, supplier_terms_out, ledger_row,
    approval_action_body,
    vendor_portal_user_create, vendor_portal_user_update, vendor_portal_reset_password_in,
)
from app.schemas.common import paginated_response, success_response
from app.services.auth_service import write_audit
from app.utils.search import word_match

DEFAULT_PORTAL_PERMISSIONS = {
    "view_pos": True,
    "download_po": True,
    "view_grn": True,
    "download_grn": True,
    "view_prn": True,
    "download_prn": True,
    "view_sales": False,
    "view_sales_quantity": True,
    "view_sales_value": True,
    "view_outlet_sales": False,
    "view_cheques": True,
    "view_payments": True,
    "view_ledger": True,
    "download_statement": True,
    "view_item_requests": True,
    "submit_item_requests": True,
    "edit_profile": True,
}

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


# ── helpers ───────────────────────────────────────────────────────────────────

def _all_selects(q):
    """Add all relationship selectinloads to a query on supplier_model."""
    return q.options(
        selectinload(supplier_model.addresses),
        selectinload(supplier_model.legal),
        selectinload(supplier_model.contacts),
        selectinload(supplier_model.directors),
        selectinload(supplier_model.auth_persons),
        selectinload(supplier_model.brands),
        selectinload(supplier_model.financial),
        selectinload(supplier_model.documents),
        selectinload(supplier_model.internal_notes),
        selectinload(supplier_model.gstins),
        selectinload(supplier_model.approval_logs),
    )


async def _log_action(
    db: AsyncSession,
    supplier_id: int,
    action: str,
    from_status: str | None,
    to_status: str | None,
    remarks: str | None,
    performed_by: int | None,
    performed_by_name: str | None,
):
    """Insert one row into supplier_approval_logs (pure core SQL – no ORM object)."""
    await db.execute(
        insert(supplier_approval_log).values(
            supplier_id=supplier_id,
            action=action,
            from_status=from_status,
            to_status=to_status,
            remarks=remarks or None,
            performed_by=performed_by,
            performed_by_name=performed_by_name,
        )
    )


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=paginated_response[supplier_list_out])
async def list_suppliers(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=2000),
    search: str = Query(""),
    registration_status: str = Query("approved"),
    pending_review: bool = Query(False),     # shortcut: shows all non-approved/non-draft
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(supplier_model).where(supplier_model.status == True)

    if pending_review:
        # Show everything that needs admin attention
        q = q.where(supplier_model.registration_status.in_(
            ["submitted", "under_review", "correction_pending", "hold"]
        ))
    elif registration_status:
        q = q.where(supplier_model.registration_status == registration_status)

    if search:
        q = q.where(word_match(search, supplier_model.name, supplier_model.phone,
                               supplier_model.gst_number, supplier_model.supplier_code))
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await db.execute(
        q.order_by(supplier_model.name).offset((page - 1) * per_page).limit(per_page)
    )).scalars().all()
    return {
        "data": rows, "total": total, "page": page, "per_page": per_page,
        "total_pages": math.ceil(total / per_page) if per_page else 1,
    }


@router.post("", response_model=supplier_out, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    body: supplier_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        if not body.supplier_code:
            last_sup = (await db.execute(
                select(supplier_model).order_by(supplier_model.id.desc()).limit(1)
            )).scalar_one_or_none()
            next_id = (last_sup.id + 1) if last_sup else 1
            body.supplier_code = f"SUP-{next_id:04d}"

        exclude = {"addresses", "legal", "contacts", "directors", "auth_persons", "brands", "financial", "documents", "gstins"}
        data = {k: v for k, v in body.model_dump(exclude=exclude).items()
                if hasattr(supplier_model, k)}
        obj = supplier_model(**data)

        if body.addresses:
            obj.addresses = [supplier_address(**a.model_dump()) for a in body.addresses]
        if body.legal:
            obj.legal = supplier_legal(**body.legal.model_dump())
        if body.contacts:
            obj.contacts = [supplier_contact(**{k: v for k, v in c.model_dump().items() if hasattr(supplier_contact, k)}) for c in body.contacts]
        if body.directors:
            obj.directors = [supplier_director(**d.model_dump()) for d in body.directors]
        if body.auth_persons:
            obj.auth_persons = [supplier_auth_person(**ap.model_dump()) for ap in body.auth_persons]
        if body.brands:
            obj.brands = [supplier_brand(brand_id=b.brand_id, credit_days=b.credit_days) for b in body.brands]
        if body.financial:
            obj.financial = supplier_financial(**body.financial.model_dump())
        if body.documents:
            obj.documents = [supplier_document(**doc.model_dump()) for doc in body.documents]
        if body.gstins:
            obj.gstins = [supplier_gstin_model(**{k: v for k, v in g.model_dump().items() if k != 'id'}) for g in body.gstins]

        db.add(obj)
        await db.flush()
        await write_audit(db=db, module="suppliers", action="create", record_id=obj.id,
                          description=f"supplier '{obj.name}' created with code {obj.supplier_code}",
                          user_id=current_user.user_id, user_name=current_user.username)
        await db.commit()
        return await get_supplier(obj.id, current_user, db)
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{supplier_id}", response_model=supplier_out)
async def get_supplier(
    supplier_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = _all_selects(select(supplier_model).where(supplier_model.id == supplier_id))
    row = (await db.execute(q)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="supplier not found")
    return row


@router.put("/{supplier_id}", response_model=supplier_out)
async def update_supplier(
    supplier_id: int,
    body: supplier_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        q = _all_selects(select(supplier_model).where(supplier_model.id == supplier_id))
        obj = (await db.execute(q)).scalar_one_or_none()
        if not obj:
            raise HTTPException(status_code=404, detail="supplier not found")

        db.expire(obj, ['updated_at', 'created_at'])

        exclude_nested = {"addresses", "legal", "contacts", "directors", "auth_persons", "brands", "financial", "documents", "gstins"}
        for key, value in body.model_dump(exclude=exclude_nested).items():
            if hasattr(obj, key):
                setattr(obj, key, value)

        obj.updated_at = datetime.utcnow()

        if body.legal:
            if not obj.legal:
                obj.legal = supplier_legal(supplier_id=obj.id, **body.legal.model_dump())
            else:
                for k, v in body.legal.model_dump().items():
                    setattr(obj.legal, k, v)
        if body.financial:
            if not obj.financial:
                obj.financial = supplier_financial(supplier_id=obj.id, **body.financial.model_dump())
            else:
                for k, v in body.financial.model_dump().items():
                    setattr(obj.financial, k, v)
        if body.addresses is not None:
            obj.addresses = [supplier_address(**a.model_dump()) for a in body.addresses]
        if body.contacts is not None:
            obj.contacts = [supplier_contact(**{k: v for k, v in c.model_dump().items() if hasattr(supplier_contact, k)}) for c in body.contacts]
        if body.directors is not None:
            obj.directors = [supplier_director(**d.model_dump()) for d in body.directors]
        if body.auth_persons is not None:
            obj.auth_persons = [supplier_auth_person(**ap.model_dump()) for ap in body.auth_persons]
        if body.brands is not None:
            obj.brands = [supplier_brand(brand_id=b.brand_id, credit_days=b.credit_days) for b in body.brands]
        if body.documents is not None:
            obj.documents = [supplier_document(**doc.model_dump()) for doc in body.documents]
        if body.gstins is not None:
            obj.gstins = [supplier_gstin_model(**{k: v for k, v in g.model_dump().items() if k != 'id'}) for g in body.gstins]

        await write_audit(db=db, module="suppliers", action="update", record_id=supplier_id,
                          description=f"supplier '{obj.name}' updated",
                          user_id=current_user.user_id, user_name=current_user.username)
        await db.commit()
        return await get_supplier(supplier_id, current_user, db)
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{supplier_id}", response_model=success_response)
async def delete_supplier(
    supplier_id: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(supplier_model).where(supplier_model.id == supplier_id)
        .values(status=False, updated_at=func.now())
    )
    await write_audit(db=db, module="suppliers", action="deactivate", record_id=supplier_id,
                      user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "supplier deactivated", "id": supplier_id}


# ── Ledger ────────────────────────────────────────────────────────────────────

@router.get("/{supplier_id}/ledger", response_model=list[ledger_row])
async def supplier_ledger(
    supplier_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sup = (await db.execute(
        select(supplier_model).where(supplier_model.id == supplier_id)
    )).scalar_one_or_none()
    if not sup:
        raise HTTPException(status_code=404, detail="supplier not found")

    ledger: list[ledger_row] = []
    running = Decimal("0.00")

    if sup.opening_balance != 0:
        running += Decimal(str(sup.opening_balance))
        ledger.append(ledger_row(
            date=sup.created_at.date(),
            ref_no="OPEN",
            type="opening",
            description="Opening Balance",
            debit=Decimal(str(sup.opening_balance)) if sup.opening_balance > 0 else Decimal("0"),
            credit=abs(Decimal(str(sup.opening_balance))) if sup.opening_balance < 0 else Decimal("0"),
            balance=running,
        ))

    try:
        pur_result = await db.execute(text("""
            SELECT purchase_no, purchase_date, total_amount
            FROM unit_wise_purchases
            WHERE supplier_id = :sid AND status != 'cancelled'
            ORDER BY purchase_date, id
        """), {"sid": supplier_id})
        for p in pur_result.fetchall():
            running += Decimal(str(p.total_amount))
            ledger.append(ledger_row(
                date=p.purchase_date,
                ref_no=p.purchase_no,
                type="purchase",
                description=f"Purchase {p.purchase_no}",
                debit=Decimal(str(p.total_amount)),
                credit=Decimal("0"),
                balance=running,
            ))
    except Exception:
        pass

    ledger.sort(key=lambda x: x.date)
    return ledger


# ── Terms ─────────────────────────────────────────────────────────────────────

@router.get("/{supplier_id}/terms", response_model=list[supplier_terms_out])
async def get_terms(
    supplier_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(supplier_terms_model)
        .where(supplier_terms_model.supplier_id == supplier_id,
               supplier_terms_model.is_active == True)
    )).scalars().all()
    return rows


@router.post("/{supplier_id}/terms", response_model=supplier_terms_out, status_code=201)
async def add_terms(
    supplier_id: int,
    body: supplier_terms_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = supplier_terms_model(supplier_id=supplier_id, terms_text=body.terms_text)
    db.add(obj)
    await db.flush()
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{supplier_id}/terms/{term_id}", response_model=success_response)
async def delete_terms(
    supplier_id: int,
    term_id: int,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(supplier_terms_model)
        .where(supplier_terms_model.id == term_id,
               supplier_terms_model.supplier_id == supplier_id)
        .values(is_active=False, updated_at=func.now())
    )
    await db.commit()
    return {"message": "term deactivated", "id": term_id}


# ── Challans ──────────────────────────────────────────────────────────────────

@router.get("/{supplier_id}/challans", response_model=list[dict])
async def list_challans(
    supplier_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(supplier_challan)
        .where(supplier_challan.supplier_id == supplier_id)
        .order_by(supplier_challan.challan_date.desc())
    )).scalars().all()
    return [
        {
            "id": r.id, "challan_no": r.challan_no,
            "challan_date": r.challan_date.isoformat(),
            "status": r.status, "total_qty": float(r.total_qty),
            "notes": r.notes,
        }
        for r in rows
    ]


@router.post("/{supplier_id}/challans", response_model=success_response, status_code=201)
async def create_challan(
    supplier_id: int,
    body: dict,
    current_user: current_user_dep = Depends(require_role("admin", "manager", "staff")),
    db: AsyncSession = Depends(get_db),
):
    challan_date = date_type.fromisoformat(body.get("challan_date", str(date_type.today())))
    obj = supplier_challan(
        challan_no=body["challan_no"],
        supplier_id=supplier_id,
        challan_date=challan_date,
        total_qty=Decimal(str(body.get("total_qty", 0))),
        notes=body.get("notes"),
        created_by=current_user.user_id,
    )
    db.add(obj)
    await db.flush()
    await db.commit()
    return {"message": "challan created", "id": obj.id}


# ── Notes ─────────────────────────────────────────────────────────────────────

@router.post("/{supplier_id}/notes", response_model=success_response, status_code=201)
async def add_supplier_note(
    supplier_id: int,
    body: dict,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    note_text = body.get("note", "").strip()
    if not note_text:
        raise HTTPException(400, "Note text is required")
    await db.execute(
        insert(supplier_note).values(
            supplier_id=supplier_id,
            note=note_text,
            note_type=body.get("note_type", "internal"),
            created_by=current_user.user_id,
        )
    )
    await db.commit()
    return {"message": "note added", "id": supplier_id}


# ── Approval Logs ─────────────────────────────────────────────────────────────

@router.get("/{supplier_id}/approval-logs")
async def get_approval_logs(
    supplier_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(supplier_approval_log)
        .where(supplier_approval_log.supplier_id == supplier_id)
        .order_by(supplier_approval_log.created_at.desc())
    )).scalars().all()
    return [
        {
            "id": r.id,
            "action": r.action,
            "from_status": r.from_status,
            "to_status": r.to_status,
            "remarks": r.remarks,
            "performed_by_name": r.performed_by_name,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


# ── Vendor Onboarding & Approvals ─────────────────────────────────────────────

@router.post("/onboarding/link", response_model=supplier_out)
async def generate_onboarding_link(
    phone: str,
    name: str = "Pending Vendor",
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    token = str(uuid.uuid4())
    obj = supplier_model(
        name=name,
        phone=phone,
        registration_status="pending",
        onboarding_token=token,
        status=True,
        supplier_type="Distributor",
    )
    db.add(obj)
    await db.flush()
    await db.commit()
    return await get_supplier(obj.id, current_user, db)


@router.get("/public/registration/{token}", response_model=supplier_out)
async def get_public_registration(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    q = _all_selects(select(supplier_model).where(supplier_model.onboarding_token == token))
    obj = (await db.execute(q)).scalar_one_or_none()
    if not obj:
        raise HTTPException(404, "Invalid or expired token")
    return obj


@router.post("/public/registration/{token}", response_model=supplier_out)
async def submit_public_registration(
    token: str,
    body: supplier_create,
    db: AsyncSession = Depends(get_db),
):
    try:
        # ── 1. Verify token — select ONLY id/status, NOT full ORM object ──────
        #    Loading the full ORM object causes SQLAlchemy synchronize_session to
        #    find it in identity map & taint it with tz-aware datetimes from asyncpg.
        verify_q = select(supplier_model.id, supplier_model.registration_status).where(
            supplier_model.onboarding_token == token
        )
        row = (await db.execute(verify_q)).one_or_none()
        if not row:
            raise HTTPException(404, "Invalid or expired token")
        supplier_id, reg_status = row

        if reg_status == "approved":
            raise HTTPException(400, "This registration has already been approved and cannot be modified.")

        # ── 2. Build scalar UPDATE values ──────────────────────────────────────
        exclude_nested = {"addresses", "legal", "contacts", "directors", "auth_persons", "brands", "financial", "documents", "gstins"}
        exclude_protected = {"supplier_code", "onboarding_token", "registration_status"}
        scalar_vals: dict = {
            "registration_status": "submitted",
            "updated_at": func.now(),
        }
        for key, value in body.model_dump(exclude=exclude_nested | exclude_protected).items():
            if hasattr(supplier_model, key):
                scalar_vals[key] = value

        # ── 3. UPDATE suppliers — pure core SQL ────────────────────────────────
        await db.execute(
            update(supplier_model)
            .where(supplier_model.id == supplier_id)
            .values(**scalar_vals)
        )

        # ── 4. Relationships: DELETE old, INSERT new (core SQL only) ──────────
        await db.execute(delete(supplier_legal).where(supplier_legal.supplier_id == supplier_id))
        if body.legal:
            await db.execute(insert(supplier_legal).values(supplier_id=supplier_id, **body.legal.model_dump()))

        await db.execute(delete(supplier_financial).where(supplier_financial.supplier_id == supplier_id))
        if body.financial:
            await db.execute(insert(supplier_financial).values(supplier_id=supplier_id, **body.financial.model_dump()))

        await db.execute(delete(supplier_address).where(supplier_address.supplier_id == supplier_id))
        for addr in body.addresses or []:
            await db.execute(insert(supplier_address).values(supplier_id=supplier_id, **addr.model_dump()))

        await db.execute(delete(supplier_contact).where(supplier_contact.supplier_id == supplier_id))
        for contact in body.contacts or []:
            cd = {k: v for k, v in contact.model_dump().items() if hasattr(supplier_contact, k) and k != "id"}
            await db.execute(insert(supplier_contact).values(supplier_id=supplier_id, **cd))

        await db.execute(delete(supplier_director).where(supplier_director.supplier_id == supplier_id))
        for director in body.directors or []:
            await db.execute(insert(supplier_director).values(supplier_id=supplier_id, **director.model_dump()))

        await db.execute(delete(supplier_auth_person).where(supplier_auth_person.supplier_id == supplier_id))
        for ap in body.auth_persons or []:
            await db.execute(insert(supplier_auth_person).values(supplier_id=supplier_id, **ap.model_dump()))

        await db.execute(delete(supplier_gstin_model).where(supplier_gstin_model.supplier_id == supplier_id))
        for g in body.gstins or []:
            gd = {k: v for k, v in g.model_dump().items() if k not in ("id",)}
            await db.execute(insert(supplier_gstin_model).values(supplier_id=supplier_id, **gd))

        await db.execute(delete(supplier_document).where(supplier_document.supplier_id == supplier_id))
        for doc in body.documents or []:
            await db.execute(insert(supplier_document).values(supplier_id=supplier_id, **doc.model_dump()))

        # ── 5. Log the submission ──────────────────────────────────────────────
        await _log_action(db, supplier_id, "submitted", reg_status, "submitted",
                          "Vendor submitted registration form", None, "vendor")

        await db.commit()
        from collections import namedtuple
        MockUser = namedtuple("MockUser", ["user_id", "username"])
        return await get_supplier(supplier_id, MockUser(0, "public"), db)

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        import traceback
        print("submit_public_registration ERROR:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ── Approval Actions ──────────────────────────────────────────────────────────
# All use pure core SQL — never load the full ORM supplier object.
# Reason: asyncpg returns TIMESTAMP WITHOUT TIME ZONE as tz-aware Python datetimes;
# SQLAlchemy synchronize_session="evaluate" would then push a tz-aware value
# back into the TIMESTAMP column, raising asyncpg.DataError.

@router.post("/{supplier_id}/approve", response_model=supplier_out)
async def approve_supplier(
    supplier_id: int,
    body: approval_action_body = approval_action_body(),
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        # ── 1. Fetch minimal info (no ORM object in identity map) ──────────────
        row = (await db.execute(
            select(
                supplier_model.id,
                supplier_model.registration_status,
                supplier_model.supplier_code,
                supplier_model.gst_number,
                supplier_model.pan_number,
                supplier_model.name,
            ).where(supplier_model.id == supplier_id)
        )).one_or_none()

        if not row:
            raise HTTPException(404, "Supplier not found")

        s_id, reg_status, sup_code, gst_num, pan_num, sup_name = row

        if reg_status == "approved":
            raise HTTPException(400, "Vendor is already approved.")

        # ── 2. Duplicate checks before approval ────────────────────────────────
        if gst_num:
            dup = (await db.execute(
                select(supplier_model.id, supplier_model.name)
                .where(
                    supplier_model.gst_number == gst_num,
                    supplier_model.registration_status == "approved",
                    supplier_model.id != supplier_id,
                    supplier_model.status == True,
                )
            )).one_or_none()
            if dup:
                raise HTTPException(409, f"GST {gst_num} already exists in approved supplier '{dup[1]}' (ID {dup[0]}). Resolve the duplicate before approving.")

        if pan_num:
            dup = (await db.execute(
                select(supplier_model.id, supplier_model.name)
                .where(
                    supplier_model.pan_number == pan_num,
                    supplier_model.registration_status == "approved",
                    supplier_model.id != supplier_id,
                    supplier_model.status == True,
                )
            )).one_or_none()
            if dup:
                raise HTTPException(409, f"PAN {pan_num} already exists in approved supplier '{dup[1]}' (ID {dup[0]}). Resolve the duplicate before approving.")

        # ── 3. Generate unique supplier code if missing ────────────────────────
        if not sup_code:
            res_last = (await db.execute(
                text("""
                    SELECT COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE(supplier_code,'[^0-9]','','g'),'') AS INT)), 0)
                    FROM suppliers
                    WHERE supplier_code LIKE 'SUP-%' AND status = TRUE
                """)
            )).scalar()
            next_num = (res_last or 0) + 1
            sup_code = f"SUP-{next_num:04d}"

        # ── 4. UPDATE suppliers — pure core SQL ────────────────────────────────
        await db.execute(
            update(supplier_model)
            .where(supplier_model.id == supplier_id)
            .values(
                registration_status="approved",
                supplier_code=sup_code,
                approved_by=current_user.user_id,
                approved_at=func.now(),
                rejection_reason=None,
                correction_notes=None,
                updated_at=func.now(),
            )
        )

        # ── 5. Log the action ──────────────────────────────────────────────────
        await _log_action(db, supplier_id, "approved", reg_status, "approved",
                          body.remarks or f"Approved by {current_user.username}",
                          current_user.user_id, current_user.username)

        await write_audit(db=db, module="suppliers", action="approve", record_id=supplier_id,
                          description=f"vendor '{sup_name}' approved with code {sup_code}",
                          user_id=current_user.user_id, user_name=current_user.username)
        await db.commit()
        return await get_supplier(supplier_id, current_user, db)

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        import traceback
        print("approve_supplier ERROR:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{supplier_id}/reject", response_model=supplier_out)
async def reject_supplier(
    supplier_id: int,
    body: approval_action_body,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        if not body.remarks.strip():
            raise HTTPException(400, "Rejection reason / remarks is required.")

        row = (await db.execute(
            select(supplier_model.id, supplier_model.registration_status, supplier_model.name)
            .where(supplier_model.id == supplier_id)
        )).one_or_none()
        if not row:
            raise HTTPException(404, "Supplier not found")

        s_id, reg_status, sup_name = row

        await db.execute(
            update(supplier_model)
            .where(supplier_model.id == supplier_id)
            .values(
                registration_status="rejected",
                rejection_reason=body.remarks.strip(),
                updated_at=func.now(),
            )
        )
        await _log_action(db, supplier_id, "rejected", reg_status, "rejected",
                          body.remarks.strip(), current_user.user_id, current_user.username)
        await write_audit(db=db, module="suppliers", action="reject", record_id=supplier_id,
                          description=f"vendor '{sup_name}' rejected: {body.remarks[:100]}",
                          user_id=current_user.user_id, user_name=current_user.username)
        await db.commit()
        return await get_supplier(supplier_id, current_user, db)

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        import traceback
        print("reject_supplier ERROR:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{supplier_id}/hold", response_model=supplier_out)
async def hold_supplier(
    supplier_id: int,
    body: approval_action_body,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = (await db.execute(
            select(supplier_model.id, supplier_model.registration_status, supplier_model.name)
            .where(supplier_model.id == supplier_id)
        )).one_or_none()
        if not row:
            raise HTTPException(404, "Supplier not found")

        s_id, reg_status, sup_name = row

        await db.execute(
            update(supplier_model)
            .where(supplier_model.id == supplier_id)
            .values(registration_status="hold", updated_at=func.now())
        )
        await _log_action(db, supplier_id, "hold", reg_status, "hold",
                          body.remarks.strip() or None, current_user.user_id, current_user.username)
        await write_audit(db=db, module="suppliers", action="hold", record_id=supplier_id,
                          description=f"vendor '{sup_name}' placed on hold",
                          user_id=current_user.user_id, user_name=current_user.username)
        await db.commit()
        return await get_supplier(supplier_id, current_user, db)

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{supplier_id}/request-correction", response_model=supplier_out)
async def request_correction(
    supplier_id: int,
    body: approval_action_body,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        if not body.remarks.strip():
            raise HTTPException(400, "Please describe what corrections are needed.")

        row = (await db.execute(
            select(supplier_model.id, supplier_model.registration_status, supplier_model.name)
            .where(supplier_model.id == supplier_id)
        )).one_or_none()
        if not row:
            raise HTTPException(404, "Supplier not found")

        s_id, reg_status, sup_name = row

        correction_text = body.remarks.strip()
        if body.correction_fields:
            correction_text += "\n\nFields requiring correction:\n" + "\n".join(f"• {f}" for f in body.correction_fields)

        await db.execute(
            update(supplier_model)
            .where(supplier_model.id == supplier_id)
            .values(
                registration_status="correction_pending",
                correction_notes=correction_text,
                updated_at=func.now(),
            )
        )
        await _log_action(db, supplier_id, "correction_requested", reg_status, "correction_pending",
                          correction_text, current_user.user_id, current_user.username)
        await write_audit(db=db, module="suppliers", action="correction_request", record_id=supplier_id,
                          description=f"vendor '{sup_name}' sent for correction: {body.remarks[:100]}",
                          user_id=current_user.user_id, user_name=current_user.username)
        await db.commit()
        return await get_supplier(supplier_id, current_user, db)

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{supplier_id}/under-review", response_model=supplier_out)
async def mark_under_review(
    supplier_id: int,
    body: approval_action_body = approval_action_body(),
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = (await db.execute(
            select(supplier_model.id, supplier_model.registration_status)
            .where(supplier_model.id == supplier_id)
        )).one_or_none()
        if not row:
            raise HTTPException(404, "Supplier not found")

        s_id, reg_status = row
        await db.execute(
            update(supplier_model)
            .where(supplier_model.id == supplier_id)
            .values(registration_status="under_review", updated_at=func.now())
        )
        await _log_action(db, supplier_id, "under_review", reg_status, "under_review",
                          body.remarks.strip() or "Moved to Under Review",
                          current_user.user_id, current_user.username)
        await db.commit()
        return await get_supplier(supplier_id, current_user, db)

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ── POs for this Supplier ─────────────────────────────────────────────────────
@router.get("/{supplier_id}/pos")
async def get_supplier_pos(
    supplier_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    status: str | None = None,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.purchase import po_header, po_item
    from app.models.product import product as product_model

    base_q = select(po_header).where(po_header.supplier_id == supplier_id)
    if status and status != "all":
        base_q = base_q.where(po_header.status == status)

    total_r = await db.execute(select(func.count()).select_from(base_q.subquery()))
    total = total_r.scalar_one()

    pos_r = await db.execute(
        base_q.options(
            selectinload(po_header.items).selectinload(po_item.dist_items)
        )
        .order_by(po_header.po_date.desc(), po_header.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    pos = pos_r.scalars().all()

    # Load product names for items
    p_ids = {it.product_id for p in pos for it in p.items}
    prod_map = {}
    if p_ids:
        prods_r = await db.execute(select(product_model.id, product_model.name, product_model.item_code, product_model.barcode, product_model.unit).where(product_model.id.in_(p_ids)))
        for pr in prods_r.all():
            prod_map[pr.id] = {"name": pr.name, "item_code": pr.item_code, "barcode": pr.barcode, "unit": pr.unit}

    items_out = []
    for p in pos:
        po_items_list = []
        tot_ordered = Decimal("0.00")
        tot_received = Decimal("0.00")
        for it in p.items:
            pm = prod_map.get(it.product_id, {})
            tot_ordered += it.order_qty or it.qty or Decimal("0.00")
            tot_received += it.received_qty or Decimal("0.00")
            po_items_list.append({
                "id": it.id,
                "product_id": it.product_id,
                "product_name": pm.get("name", "Product"),
                "item_code": pm.get("item_code"),
                "barcode": pm.get("barcode"),
                "unit": pm.get("unit") or "PCS",
                "order_qty": float(it.order_qty or it.qty or 0),
                "received_qty": float(it.received_qty or 0),
                "pending_qty": float(max(Decimal("0.00"), (it.order_qty or it.qty or Decimal("0.00")) - (it.received_qty or Decimal("0.00")))),
                "rate": float(it.rate or 0),
                "gst_percent": float(it.gst_percent or 0),
                "total": float(it.total or it.amount or 0),
            })

        items_out.append({
            "id": p.id,
            "po_no": p.po_no,
            "po_date": str(p.po_date),
            "expected_date": str(p.expected_date) if p.expected_date else None,
            "status": p.status,
            "approval_status": p.approval_status,
            "total_amount": float(p.total_amount or 0),
            "vendor_ack": p.vendor_ack,
            "vendor_ack_at": p.vendor_ack_at.isoformat() if p.vendor_ack_at else None,
            "vendor_expected_delivery": str(p.vendor_expected_delivery) if p.vendor_expected_delivery else None,
            "vendor_delivery_remarks": p.vendor_delivery_remarks,
            "total_ordered_qty": float(tot_ordered),
            "total_received_qty": float(tot_received),
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


# ── GRNs for this Supplier ────────────────────────────────────────────────────
@router.get("/{supplier_id}/grns")
async def get_supplier_grns(
    supplier_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.purchase import purchase as purchase_model, purchase_item as purchase_item_model
    from app.models.product import product as product_model

    base_q = select(purchase_model).where(purchase_model.supplier_id == supplier_id)
    total_r = await db.execute(select(func.count()).select_from(base_q.subquery()))
    total = total_r.scalar_one()

    grns_r = await db.execute(
        base_q.options(selectinload(purchase_model.items))
        .order_by(purchase_model.invoice_date.desc(), purchase_model.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    grns = grns_r.scalars().all()

    p_ids = {it.product_id for g in grns for it in g.items}
    prod_map = {}
    if p_ids:
        prods_r = await db.execute(select(product_model.id, product_model.name, product_model.item_code, product_model.barcode, product_model.unit).where(product_model.id.in_(p_ids)))
        for pr in prods_r.all():
            prod_map[pr.id] = {"name": pr.name, "item_code": pr.item_code, "barcode": pr.barcode, "unit": pr.unit}

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
                "qty": float(it.qty or 0),
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


# ── Supplier Sales Analytics ──────────────────────────────────────────────────
@router.get("/{supplier_id}/sales")
async def get_supplier_sales(
    supplier_id: int,
    from_date: date_type | None = None,
    to_date: date_type | None = None,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.invoice import invoice as invoice_model, invoice_item as invoice_item_model
    from app.models.product import product as product_model

    # 1. Fetch products linked to this supplier
    p_r = await db.execute(
        select(product_model.id, product_model.name, product_model.item_code, product_model.barcode,
               product_model.brand, product_model.category, product_model.stock_qty, product_model.mrp)
        .where(product_model.supplier_id == supplier_id)
    )
    products = p_r.all()
    if not products:
        return {"summary": {"total_qty": 0, "total_value": 0, "product_count": 0}, "products": []}

    prod_ids = [p.id for p in products]

    # 2. Query invoice items for these products
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
        res_products.append({
            "product_id": p.id,
            "product_name": p.name,
            "item_code": p.item_code,
            "barcode": p.barcode,
            "brand": p.brand,
            "category": p.category,
            "mrp": float(p.mrp or 0),
            "current_stock": float(p.stock_qty or 0),
            "sales_qty": s["qty"],
            "sales_value": s["value"],
        })

    return {
        "summary": {
            "total_qty": tot_qty,
            "total_value": tot_val,
            "product_count": len(products),
        },
        "products": res_products,
    }


# ── Supplier New Item Requests ────────────────────────────────────────────────
@router.get("/{supplier_id}/item-requests")
async def list_supplier_item_requests(
    supplier_id: int,
    status: str | None = None,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.party import vendor_item_request

    q = select(vendor_item_request).where(vendor_item_request.supplier_id == supplier_id)
    if status and status != "all":
        q = q.where(vendor_item_request.status == status)

    q = q.order_by(vendor_item_request.created_at.desc())
    r = await db.execute(q)
    return r.scalars().all()


@router.post("/{supplier_id}/item-requests/{req_id}/review")
async def review_supplier_item_request(
    supplier_id: int,
    req_id: int,
    body: vendor_item_request_review,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    from app.models.party import vendor_item_request
    from app.models.product import product as product_model

    req = (await db.execute(
        select(vendor_item_request)
        .where(vendor_item_request.id == req_id, vendor_item_request.supplier_id == supplier_id)
    )).scalar_one_or_none()

    if not req:
        raise HTTPException(404, "Item request not found")

    new_status = body.action.lower()  # approve / reject / correction_requested
    if new_status == "approve":
        target_status = "approved"
    elif new_status == "reject":
        target_status = "rejected"
    elif new_status in ("correction_requested", "correction"):
        target_status = "correction_requested"
    else:
        target_status = new_status

    created_prod_id = None
    if target_status == "approved" and body.create_product:
        # Check if already created or existing barcode
        if req.barcode:
            existing = (await db.execute(select(product_model.id).where(product_model.barcode == req.barcode))).scalar_one_or_none()
            if existing:
                created_prod_id = existing

        if not created_prod_id:
            # Generate item code if not given
            code = req.vendor_item_code
            if not code:
                code = f"ITM-{datetime.now().strftime('%y%m%d%H%M%S')}"

            new_prod = product_model(
                name=req.product_name,
                item_code=code,
                barcode=req.barcode,
                category=req.category_name or "General",
                category_id=req.category_id,
                brand=req.brand_name,
                brand_id=req.brand_id,
                unit=req.unit or "PCS",
                purchase_price=req.purchase_rate,
                selling_price=req.proposed_selling_price or req.mrp,
                mrp=req.mrp,
                gst_percent=req.gst_percent,
                hsn_code=req.hsn_code,
                supplier_id=supplier_id,
                description=req.description,
                image_path=req.image_url,
            )
            db.add(new_prod)
            await db.flush()
            created_prod_id = new_prod.id

    req.status = target_status
    req.review_notes = body.review_notes
    req.reviewed_by = current_user.user_id
    req.reviewed_at = datetime.now()
    if created_prod_id:
        req.created_product_id = created_prod_id
    req.updated_at = datetime.now()

    await write_audit(
        db=db, module="suppliers", action=f"item_request_{target_status}",
        record_id=req.id, description=f"New item request {req.request_no} {target_status} by {current_user.username}",
        user_id=current_user.user_id, user_name=current_user.username
    )
    await db.commit()
    await db.refresh(req)
    return req


# ── Supplier Profile Requests ─────────────────────────────────────────────────
@router.get("/{supplier_id}/profile-requests")
async def list_supplier_profile_requests(
    supplier_id: int,
    status: str | None = None,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.party import vendor_profile_request

    q = select(vendor_profile_request).where(vendor_profile_request.supplier_id == supplier_id)
    if status and status != "all":
        q = q.where(vendor_profile_request.status == status)

    q = q.order_by(vendor_profile_request.created_at.desc())
    r = await db.execute(q)
    return r.scalars().all()


@router.post("/{supplier_id}/profile-requests/{req_id}/review")
async def review_supplier_profile_request(
    supplier_id: int,
    req_id: int,
    body: vendor_profile_request_review,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    from app.models.party import vendor_profile_request, supplier_financial, supplier_legal

    req = (await db.execute(
        select(vendor_profile_request)
        .where(vendor_profile_request.id == req_id, vendor_profile_request.supplier_id == supplier_id)
    )).scalar_one_or_none()

    if not req:
        raise HTTPException(404, "Profile change request not found")

    target_status = "approved" if body.action.lower() == "approve" else "rejected"

    if target_status == "approved" and req.changes:
        # Apply field changes to supplier
        supp = (await db.execute(select(supplier_model).where(supplier_model.id == supplier_id))).scalar_one_or_none()
        if supp:
            # Flatten or inspect changes
            # changes format: {"field_name": {"old": ..., "new": ...}} or {"field_name": "new_val"}
            for k, val in req.changes.items():
                new_v = val.get("new") if isinstance(val, dict) and "new" in val else val
                if hasattr(supp, k):
                    setattr(supp, k, new_v)
                elif k in ("bank_name", "account_no", "ifsc_code", "branch"):
                    # Check or update supplier_financial
                    fin = (await db.execute(select(supplier_financial).where(supplier_financial.supplier_id == supplier_id))).scalar_one_or_none()
                    if not fin:
                        fin = supplier_financial(supplier_id=supplier_id)
                        db.add(fin)
                    setattr(fin, k, new_v)
                elif k in ("cin_no", "pan_no", "tan_no"):
                    leg = (await db.execute(select(supplier_legal).where(supplier_legal.supplier_id == supplier_id))).scalar_one_or_none()
                    if not leg:
                        leg = supplier_legal(supplier_id=supplier_id)
                        db.add(leg)
                    setattr(leg, k, new_v)

            supp.updated_at = datetime.now()

    req.status = target_status
    req.review_notes = body.review_notes
    req.reviewed_by = current_user.user_id
    req.reviewed_at = datetime.now()
    req.updated_at = datetime.now()

    await write_audit(
        db=db, module="suppliers", action=f"profile_request_{target_status}",
        record_id=req.id, description=f"Vendor profile change request #{req.id} {target_status} by {current_user.username}",
        user_id=current_user.user_id, user_name=current_user.username
    )
    await db.commit()
    await db.refresh(req)
    return req


# ── Portal Settings ───────────────────────────────────────────────────────────
@router.put("/{supplier_id}/portal-settings")
async def update_supplier_portal_settings(
    supplier_id: int,
    body: portal_settings_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    supp = (await db.execute(select(supplier_model).where(supplier_model.id == supplier_id))).scalar_one_or_none()
    if not supp:
        raise HTTPException(404, "Supplier not found")

    supp.portal_sales_enabled = body.portal_sales_enabled
    supp.portal_sales_config = body.portal_sales_config
    supp.updated_at = datetime.now()

    await write_audit(
        db=db, module="suppliers", action="update_portal_settings",
        record_id=supplier_id, description=f"Updated portal settings for supplier {supp.name} (sales enabled: {supp.portal_sales_enabled})",
        user_id=current_user.user_id, user_name=current_user.username
    )
    await db.commit()
    return {
        "success": True,
        "portal_sales_enabled": supp.portal_sales_enabled,
        "portal_sales_config": supp.portal_sales_config,
    }


# ── Supplier Documents Upload & Delete ────────────────────────────────────────
@router.post("/{supplier_id}/documents")
async def upload_supplier_document(
    supplier_id: int,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    start_date: str | None = Form(None),
    end_date: str | None = Form(None),
    notes: str | None = Form(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = (await db.execute(select(supplier_model).where(supplier_model.id == supplier_id))).scalar_one_or_none()
    if not supp:
        raise HTTPException(404, "Supplier not found")

    folder = "supplier_docs"
    upload_dir = os.path.join("uploads", folder)
    os.makedirs(upload_dir, exist_ok=True)

    orig_ext = os.path.splitext(file.filename or "")[1].lower()
    if not orig_ext:
        content_map = {
            "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"
        }
        orig_ext = content_map.get(file.content_type or "", ".pdf")

    unique_filename = f"{supplier_id}_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}{orig_ext}"
    saved_disk_path = os.path.join(upload_dir, unique_filename)

    file_bytes = await file.read()
    with open(saved_disk_path, "wb") as f_out:
        f_out.write(file_bytes)

    public_file_url = f"/uploads/{folder}/{unique_filename}"

    s_date = None
    e_date = None
    if start_date and start_date.strip():
        try:
            s_date = datetime.strptime(start_date.strip(), "%Y-%m-%d").date()
        except Exception:
            pass
    if end_date and end_date.strip():
        try:
            e_date = datetime.strptime(end_date.strip(), "%Y-%m-%d").date()
        except Exception:
            pass

    doc_obj = supplier_document(
        supplier_id=supplier_id,
        document_type=document_type,
        file_path=public_file_url,
        start_date=s_date,
        end_date=e_date,
        notes=notes or None,
    )
    db.add(doc_obj)
    await db.commit()
    await db.refresh(doc_obj)

    await write_audit(
        db=db, module="suppliers", action="document_upload", record_id=doc_obj.id,
        description=f"Uploaded '{document_type}' for supplier {supp.name}",
        user_id=current_user.user_id, user_name=current_user.username,
    )

    return {
        "id": doc_obj.id,
        "supplier_id": doc_obj.supplier_id,
        "document_type": doc_obj.document_type,
        "file_path": doc_obj.file_path,
        "start_date": str(doc_obj.start_date) if doc_obj.start_date else None,
        "end_date": str(doc_obj.end_date) if doc_obj.end_date else None,
        "notes": doc_obj.notes,
    }


@router.delete("/{supplier_id}/documents/{doc_id}")
async def delete_supplier_document(
    supplier_id: int,
    doc_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc_obj = (await db.execute(
        select(supplier_document).where(supplier_document.id == doc_id, supplier_document.supplier_id == supplier_id)
    )).scalar_one_or_none()

    if not doc_obj:
        raise HTTPException(404, "Document not found")

    await db.delete(doc_obj)
    await db.commit()
    return {"success": True, "message": "Document deleted"}


# ── VENDOR PORTAL ACCESS MANAGEMENT ──────────────────────────────────────────

@router.get("/{supplier_id}/portal-access")
async def get_supplier_portal_access(
    supplier_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    supp = await db.get(supplier_model, supplier_id)
    if not supp:
        raise HTTPException(404, "Supplier not found")

    # Find linked user
    u_res = await db.execute(
        select(user_model).where(
            user_model.supplier_id == supplier_id,
            user_model.role.in_(["vendor", "supplier"])
        )
    )
    v_user = u_res.scalar_one_or_none()

    perms = {**DEFAULT_PORTAL_PERMISSIONS}
    if supp.portal_permissions:
        perms.update(supp.portal_permissions)
    perms["view_sales"] = supp.portal_sales_enabled

    # Login audit history
    login_history = []
    if v_user:
        logs_res = await db.execute(
            select(audit_log_model)
            .where(
                (audit_log_model.user_id == v_user.id) | (audit_log_model.record_id == v_user.id),
                audit_log_model.module.in_(["auth", "vendor_portal"]),
                audit_log_model.action.in_(["login", "vendor_login", "logout"])
            )
            .order_by(audit_log_model.created_at.desc())
            .limit(10)
        )
        for log in logs_res.scalars().all():
            login_history.append({
                "id": log.id,
                "action": log.action,
                "description": log.description,
                "ip_address": log.ip_address,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            })

    # Prepare portal link and invitation text
    activation_token = v_user.reset_token if (v_user and v_user.reset_token) else supp.onboarding_token
    portal_link = f"/vendor/activate/{activation_token}" if activation_token else "/vendor-portal"

    invitation_text = f"""Subject: Your Supplier Portal Access - NUTRIBAY

Dear {supp.name},

Your official Supplier Portal account for NUTRIBAY (Nutribay) has been created.

Login Username: {v_user.username if v_user else (supp.supplier_code or 'pending')}
Portal Access URL: {portal_link}

Through this secure portal, you can:
- View and acknowledge purchase orders (PO)
- Track Goods Received Notes (GRN) and receiving status
- View Purchase Return Notes (PRN)
- Check payment history, cheque clearing status, and supplier ledger
- Submit proposals for new item listings
- Update your company profile, bank, and GST details

For security, please set a strong password upon your first login and do not share your credentials.

Regards,
Purchase & Accounts Department
NUTRIBAY — Nutribay"""

    return {
        "supplier_id": supp.id,
        "supplier_code": supp.supplier_code,
        "supplier_name": supp.name,
        "has_account": v_user is not None,
        "user": {
            "id": v_user.id,
            "username": v_user.username,
            "email": v_user.email,
            "name": v_user.name,
            "role": v_user.role,
            "status": v_user.status,
            "last_login": v_user.last_login.isoformat() if v_user.last_login else None,
            "created_at": v_user.created_at.isoformat() if v_user.created_at else None,
            "has_reset_token": bool(v_user.reset_token),
        } if v_user else None,
        "portal_permissions": perms,
        "portal_link": portal_link,
        "invitation_text": invitation_text,
        "login_history": login_history,
    }


@router.post("/{supplier_id}/portal-access/create")
async def create_or_update_supplier_portal_user(
    supplier_id: int,
    body: vendor_portal_user_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    supp = await db.get(supplier_model, supplier_id)
    if not supp:
        raise HTTPException(404, "Supplier not found")

    clean_username = body.username.strip()
    # Check if username is taken by another user
    existing_user_by_name = (await db.execute(
        select(user_model).where(
            func.lower(user_model.username) == clean_username.lower(),
            user_model.supplier_id != supplier_id
        )
    )).scalar_one_or_none()
    if existing_user_by_name:
        raise HTTPException(400, f"Username '{clean_username}' is already taken by another account.")

    # Find existing vendor user for this supplier if any
    existing_v_user = (await db.execute(
        select(user_model).where(
            user_model.supplier_id == supplier_id,
            user_model.role.in_(["vendor", "supplier"])
        )
    )).scalar_one_or_none()

    # If no password provided, create temporary password or activation token
    temp_password = body.password.strip() if body.password else None
    activation_token = secrets.token_urlsafe(32)
    now = datetime.utcnow()

    if not existing_v_user:
        hashed_pwd = get_password_hash(temp_password or secrets.token_urlsafe(16))
        v_user = user_model(
            name=supp.name,
            username=clean_username,
            email=body.email or supp.email,
            password=hashed_pwd,
            role="vendor",
            supplier_id=supplier_id,
            status=True,
            reset_token=activation_token if not temp_password else None,
            reset_token_expiry=now + timedelta(days=7) if not temp_password else None,
        )
        db.add(v_user)
        action_desc = f"Created vendor login '{clean_username}' for supplier '{supp.name}'"
    else:
        v_user = existing_v_user
        v_user.username = clean_username
        v_user.email = body.email or supp.email or v_user.email
        v_user.status = True
        if temp_password:
            v_user.password = get_password_hash(temp_password)
            v_user.reset_token = None
            v_user.reset_token_expiry = None
        else:
            v_user.reset_token = activation_token
            v_user.reset_token_expiry = now + timedelta(days=7)
        action_desc = f"Updated vendor login '{clean_username}' for supplier '{supp.name}'"

    # Update portal permissions on supplier if provided
    if body.portal_permissions:
        cur_perms = supp.portal_permissions or {}
        cur_perms.update(body.portal_permissions)
        supp.portal_permissions = cur_perms
        if "view_sales" in body.portal_permissions:
            supp.portal_sales_enabled = bool(body.portal_permissions["view_sales"])

    await db.flush()
    await write_audit(
        db=db, module="suppliers", action="portal_user_save",
        record_id=supp.id, description=action_desc,
        user_id=current_user.user_id, user_name=current_user.username
    )
    await db.commit()

    return await get_supplier_portal_access(supplier_id, current_user, db)


@router.post("/{supplier_id}/portal-access/toggle-status")
async def toggle_supplier_portal_status(
    supplier_id: int,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    v_user = (await db.execute(
        select(user_model).where(
            user_model.supplier_id == supplier_id,
            user_model.role.in_(["vendor", "supplier"])
        )
    )).scalar_one_or_none()

    if not v_user:
        raise HTTPException(404, "No vendor login account exists for this supplier.")

    v_user.status = not v_user.status
    action_type = "activated" if v_user.status else "suspended"
    await write_audit(
        db=db, module="suppliers", action=f"portal_user_{action_type}",
        record_id=v_user.id, description=f"Vendor account '{v_user.username}' was {action_type} by admin",
        user_id=current_user.user_id, user_name=current_user.username
    )
    await db.commit()
    return {"success": True, "status": v_user.status, "message": f"Account {action_type} successfully"}


@router.post("/{supplier_id}/portal-access/reset-password")
async def reset_supplier_portal_password(
    supplier_id: int,
    body: vendor_portal_reset_password_in,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    v_user = (await db.execute(
        select(user_model).where(
            user_model.supplier_id == supplier_id,
            user_model.role.in_(["vendor", "supplier"])
        )
    )).scalar_one_or_none()

    if not v_user:
        raise HTTPException(404, "No vendor login account exists for this supplier.")

    if body.new_password and body.new_password.strip():
        v_user.password = get_password_hash(body.new_password.strip())
        v_user.reset_token = None
        v_user.reset_token_expiry = None
        msg = "Password updated directly."
        reset_link = None
    else:
        token = secrets.token_urlsafe(32)
        v_user.reset_token = token
        v_user.reset_token_expiry = datetime.utcnow() + timedelta(hours=48)
        reset_link = f"/vendor/reset-password/{token}"
        msg = "Password reset link generated (valid for 48 hours)."

    await write_audit(
        db=db, module="suppliers", action="portal_password_reset",
        record_id=v_user.id, description=f"Admin initiated password reset for vendor '{v_user.username}'",
        user_id=current_user.user_id, user_name=current_user.username
    )
    await db.commit()

    return {
        "success": True,
        "message": msg,
        "reset_link": reset_link,
        "reset_token": v_user.reset_token,
    }


@router.put("/{supplier_id}/portal-access/permissions")
async def update_supplier_portal_permissions(
    supplier_id: int,
    body: dict,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    supp = await db.get(supplier_model, supplier_id)
    if not supp:
        raise HTTPException(404, "Supplier not found")

    cur_perms = supp.portal_permissions or {}
    cur_perms.update(body.get("permissions", body))
    supp.portal_permissions = cur_perms

    if "view_sales" in cur_perms:
        supp.portal_sales_enabled = bool(cur_perms["view_sales"])

    await write_audit(
        db=db, module="suppliers", action="portal_permissions_update",
        record_id=supp.id, description=f"Updated portal permissions for supplier '{supp.name}'",
        user_id=current_user.user_id, user_name=current_user.username
    )
    await db.commit()
    return {"success": True, "permissions": supp.portal_permissions, "portal_sales_enabled": supp.portal_sales_enabled}

