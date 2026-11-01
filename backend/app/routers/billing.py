from datetime import date
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from app.core import access
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, current_user_dep
from app.schemas.invoice import (
    invoice_create, invoice_out, invoice_list_out,
    invoice_update, payment_in, payment_out,
    delete_request_create,
)
from app.schemas.common import paginated_response, success_response
from app.services import billing_service
from app.models.invoice import delete_request

router = APIRouter(prefix="/billing", tags=["billing"])


# ─── Invoices ─────────────────────────────────────────────────────────────────

@router.post("/invoices", response_model=invoice_out)
async def create_invoice(
    data: invoice_create,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    try:
        inv = await billing_service.create_invoice(db, data, current_user.id)
        return inv
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/invoices", response_model=paginated_response[invoice_list_out])
async def list_invoices(
    customer_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    outlet_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    items, total = await billing_service.list_invoices(
        db, customer_id, status, from_date, to_date, page, per_page, outlet_id
    )
    return paginated_response[invoice_list_out](
        data=[invoice_list_out.model_validate(i) for i in items],
        total=total,
        page=page,
        per_page=per_page,
        total_pages=-(-total // per_page),
    )


@router.get("/invoices/{invoice_id}", response_model=invoice_out)
async def get_invoice(
    invoice_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    inv = await billing_service.get_invoice(db, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    access.check_outlet(inv.outlet_id)
    return inv


@router.post("/invoices/{invoice_id}/payment", response_model=invoice_out)
async def add_payment(
    invoice_id: int,
    data: payment_in,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    try:
        inv = await billing_service.add_payment(db, invoice_id, data, current_user.id)
        return inv
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/invoices/{invoice_id}/cancel", response_model=success_response)
async def cancel_invoice(
    invoice_id: int,
    reason: str = Query(..., min_length=5),
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    try:
        await billing_service.cancel_invoice(db, invoice_id, reason, current_user.id)
        return success_response(message="Invoice cancelled successfully")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── Delete Requests ──────────────────────────────────────────────────────────

@router.post("/delete-requests", response_model=success_response)
async def raise_delete_request(
    data: delete_request_create,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    req = delete_request(
        module=data.module,
        record_id=data.record_id,
        record_no=data.record_no,
        reason=data.reason,
        requested_by=current_user.id,
        status="pending",
    )
    db.add(req)
    await db.commit()
    return success_response(message="Delete request submitted")


@router.get("/delete-requests")
async def list_delete_requests(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    from sqlalchemy import select, func as sqlfunc
    q = select(delete_request).order_by(delete_request.id.desc())
    if status:
        q = q.where(delete_request.status == status)
    total_res = await db.execute(select(sqlfunc.count()).select_from(q.subquery()))
    total = total_res.scalar() or 0
    rows = await db.execute(q.offset((page - 1) * per_page).limit(per_page))
    items = rows.scalars().all()
    from app.schemas.invoice import delete_request_out
    return paginated_response(
        items=[delete_request_out.model_validate(i) for i in items],
        total=total, page=page, per_page=per_page,
    )


@router.post("/delete-requests/{req_id}/approve", response_model=success_response)
async def approve_delete_request(
    req_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    from datetime import datetime
    req = await db.get(delete_request, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    req.status = "approved"
    req.approved_by = current_user.id
    req.approved_at = datetime.utcnow()
    await db.commit()
    return success_response(message="Request approved")
