from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, current_user_dep
from app.schemas.invoice import (
    estimate_create, estimate_update, estimate_out, estimate_list_out,
    invoice_out,
)
from app.schemas.common import paginated_response, success_response
from app.services import billing_service

router = APIRouter(prefix="/estimates", tags=["estimates"])


@router.post("", response_model=estimate_out)
async def create_estimate(
    data: estimate_create,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    est = await billing_service.create_estimate(db, data, current_user.id)
    return est


@router.get("", response_model=paginated_response[estimate_list_out])
async def list_estimates(
    customer_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    items, total = await billing_service.list_estimates(db, customer_id, status, page, per_page)
    return paginated_response[estimate_list_out](
        data=[estimate_list_out.model_validate(i) for i in items],
        total=total, page=page, per_page=per_page, total_pages=-(-total // per_page),
    )


@router.get("/{est_id}", response_model=estimate_out)
async def get_estimate(
    est_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    est = await billing_service.get_estimate(db, est_id)
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return est


@router.post("/{est_id}/convert", response_model=invoice_out)
async def convert_to_invoice(
    est_id: int,
    payment_mode: str = Query("cash"),
    paid_amount: Decimal = Query(Decimal("0.00")),
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    try:
        inv = await billing_service.convert_estimate_to_invoice(
            db, est_id, payment_mode, paid_amount, current_user.id
        )
        return inv
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{est_id}/close", response_model=success_response)
async def close_estimate(
    est_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    est = await billing_service.get_estimate(db, est_id)
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    est.status = "closed"
    est.closed_by = current_user.id
    from datetime import datetime
    est.closed_at = datetime.utcnow()
    await db.commit()
    return success_response(message="Estimate closed")
