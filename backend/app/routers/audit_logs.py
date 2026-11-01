from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from datetime import datetime
from app.core.database import get_db
from app.schemas.audit_log import audit_log_out, audit_log_create
from app.models.user import audit_log as AuditLog
from app.core.dependencies import get_current_user, current_user_dep
from app.services.auth_service import write_audit

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])

@router.get("", response_model=List[audit_log_out])
@router.get("/", response_model=List[audit_log_out], include_in_schema=False)
async def list_logs(
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
    skip: int = 0,
    limit: int = 100,
    module: Optional[str] = None,
    action: Optional[str] = None,
    user_id: Optional[int] = None
):
    q = select(AuditLog)
    if module:
        q = q.where(AuditLog.module == module)
    if action:
        q = q.where(AuditLog.action == action)
    if user_id:
        q = q.where(AuditLog.user_id == user_id)
    
    result = await db.execute(q.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit))
    return result.scalars().all()

@router.post("", response_model=audit_log_out)
@router.post("/", response_model=audit_log_out, include_in_schema=False)
async def create_log(
    log_data: audit_log_create,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user)
):
    """
    Manually create a log entry (e.g. from frontend for OPEN/CLOSE events)
    """
    await write_audit(
        db=db,
        user_id=current_user.user_id,
        user_name=current_user.username,
        action=log_data.action,
        module=log_data.module,
        record_id=int(log_data.record_id) if str(log_data.record_id or "").isdigit() else 0,  # column is a NOT NULL integer
        record_no=(log_data.record_id or "")[:50] or None,
        description=log_data.details,
        meta_data=log_data.meta_data,
        ip_address=request.client.host if request.client else None
    )
    await db.commit()

    return {
        "id": 0, "user_id": current_user.user_id, "user_name": current_user.username,
        "action": log_data.action, "module": log_data.module, "record_no": log_data.record_id,
        "details": log_data.details, "meta_data": log_data.meta_data, "ip_address": request.client.host if request.client else None,
        "created_at": datetime.now()
    }
