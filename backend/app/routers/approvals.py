"""Approvals inbox (Store Manager / Area Manager / Head Office) and approval policy configuration."""
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.services import approval_service as aps
from app.services import expiry_service  # noqa: F401  (registers its request handlers)
from app.services.auth_service import write_audit

router = APIRouter(prefix="/approvals", tags=["approvals"])


async def _rows(db, sql, p=None):
    return [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()} for r in (await db.execute(text(sql), p or {})).mappings().all()]


def _scope(p: dict) -> str:
    outs = access.allowed_outlets()
    if outs is None:
        return ""
    p["outs"] = outs
    return " AND (a.outlet_id IS NULL OR a.outlet_id = ANY(:outs))"


@router.get("")
async def inbox(status: Optional[str] = "PENDING", request_type: Optional[str] = None, outlet_id: Optional[int] = None, mine: bool = False,
                search: str = "", db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    p = {"s": status or None, "t": request_type, "o": outlet_id, "u": user.user_id, "q": f"%{search.strip()}%"}
    rows = await _rows(db, f"""SELECT a.*, pol.label, pol.approver_roles, pol.allow_self, o.outlet_name AS store, ru.name AS requested_by_name,
        du.name AS decided_by_name, TO_CHAR(a.requested_at + INTERVAL '5 hours 30 minutes', 'DD Mon YYYY HH24:MI') AS requested
        FROM approval_requests a JOIN approval_policies pol ON pol.request_type = a.request_type LEFT JOIN outlets o ON o.id = a.outlet_id
        LEFT JOIN users ru ON ru.id = a.requested_by LEFT JOIN users du ON du.id = a.decided_by
        WHERE (CAST(:s AS TEXT) IS NULL OR a.status = :s) AND (CAST(:t AS TEXT) IS NULL OR a.request_type = :t)
          AND (CAST(:o AS INT) IS NULL OR a.outlet_id = :o) AND (NOT {str(mine).upper()} OR a.requested_by = :u)
          AND (:q = '%%' OR a.request_no ILIKE :q OR a.summary ILIKE :q OR a.ref_no ILIKE :q) {_scope(p)}
        ORDER BY a.id DESC LIMIT 500""", p)
    perms = await access.effective_permissions(db, user.user_id, user.role, user.role_id)
    for r in rows:
        why = await aps.can_approve(db, user, r, {"approver_roles": r["approver_roles"], "allow_self": r["allow_self"], "label": r["label"],
                                                   "threshold": None}, perms) if r["status"] == "PENDING" else "decided"
        r["can_decide"], r["cannot_reason"] = why is None, why
    return rows


@router.get("/summary")
async def summary(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    p: dict = {}
    return await _rows(db, f"""SELECT a.request_type, pol.label, COUNT(*) AS pending FROM approval_requests a
        JOIN approval_policies pol ON pol.request_type = a.request_type WHERE a.status = 'PENDING' {_scope(p)} GROUP BY 1, 2""", p)


class decide_in(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


async def _decide(db, rid, user, action, note):
    r = await aps.decide(db, rid, user, action, note)
    await db.commit()
    return r


@router.post("/{rid}/approve")
async def approve(rid: int, b: decide_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await _decide(db, rid, user, "approve", b.note)


class reject_in(BaseModel):
    note: str = Field(min_length=3, max_length=500)
    return_for_correction: bool = False


@router.post("/{rid}/reject")
async def reject(rid: int, b: reject_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await _decide(db, rid, user, "return" if b.return_for_correction else "reject", b.note)


class resubmit_in(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    payload: Optional[dict] = None


@router.post("/resubmit/{rid}")
async def resubmit(rid: int, b: resubmit_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """The requester corrects a returned request and sends it again."""
    req = (await db.execute(text("SELECT * FROM approval_requests WHERE id = :i FOR UPDATE"), {"i": rid})).mappings().first()
    if not req or req["requested_by"] != user.user_id:
        raise HTTPException(404, "Request not found")
    if req["status"] != "RETURNED":
        raise HTTPException(400, "Only a request returned for correction can be resubmitted.")
    payload = {**req["payload"], **(b.payload or {})}
    check, _ = aps.HANDLERS[req["request_type"]]
    await check(db, {**payload, "_rid": rid})
    import json
    await db.execute(text("""UPDATE approval_requests SET status = 'PENDING', reason = :r, payload = CAST(:p AS JSONB), decided_by = NULL,
        decided_at = NULL WHERE id = :i"""), {"r": b.reason, "p": json.dumps(payload, default=str), "i": rid})
    await write_audit(db=db, module="approvals", action="resubmit", record_id=rid, record_no=req["request_no"], description=b.reason,
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"success": True}


@router.post("/cancel/{rid}")
async def cancel(rid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    n = (await db.execute(text("""UPDATE approval_requests SET status = 'CANCELLED', decided_by = :u, decided_at = NOW(), decision_note = 'Withdrawn'
        WHERE id = :i AND requested_by = :u AND status IN ('PENDING','RETURNED') RETURNING request_no"""), {"u": user.user_id, "i": rid})).scalar()
    if not n:
        raise HTTPException(400, "Only your own pending or returned request can be withdrawn.")
    await write_audit(db=db, module="approvals", action="withdraw", record_id=rid, record_no=n, description="Request withdrawn",
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"success": True}


@router.get("/policies")
async def policies(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _rows(db, "SELECT * FROM approval_policies ORDER BY label")


class policy_in(BaseModel):
    request_type: str
    enabled: bool
    approver_roles: list[str] = Field(min_length=1)
    allow_self: bool = False
    threshold: Optional[Decimal] = None


@router.put("/policies")
async def save_policies(rows: list[policy_in], db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    roles = set((await db.execute(text("SELECT slug FROM roles"))).scalars().all()) | {"admin", "superadmin"}
    for r in rows:
        if set(r.approver_roles) - roles:
            raise HTTPException(400, f"Unknown role(s): {', '.join(set(r.approver_roles) - roles)}")
        if r.request_type == "EXPIRY_CORRECTION" and not r.enabled:
            raise HTTPException(400, "Expiry date corrections always need approval (they could hide expired stock).")
        old = (await db.execute(text("SELECT enabled, approver_roles, allow_self, threshold FROM approval_policies WHERE request_type = :t"),
                                {"t": r.request_type})).mappings().first()
        if not old:
            raise HTTPException(400, f"Unknown request type {r.request_type}")
        await db.execute(text("""UPDATE approval_policies SET enabled = :e, approver_roles = :ar, allow_self = :s, threshold = :th
            WHERE request_type = :t"""), {"e": r.enabled, "ar": r.approver_roles, "s": r.allow_self, "th": r.threshold, "t": r.request_type})
        if dict(old) != {"enabled": r.enabled, "approver_roles": r.approver_roles, "allow_self": r.allow_self, "threshold": r.threshold}:
            await write_audit(db=db, module="approvals", action="policy_change", record_id=0, record_no=r.request_type,
                              old_data=str(dict(old)), new_data=str(r.model_dump()), description=f"Approval policy {r.request_type} changed",
                              user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"success": True}


@router.post("/file")
async def attach(file: UploadFile = File(...), _=Depends(get_current_user)):
    """Supporting document / photo for a request (any logged-in user; image or PDF, max 10 MB)."""
    import os
    import uuid
    from datetime import datetime
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".pdf"):
        raise HTTPException(400, "Attach an image or a PDF.")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "File is larger than 10 MB.")
    os.makedirs("uploads/approvals", exist_ok=True)
    name = f"apr_{datetime.now():%Y%m%d%H%M%S}_{uuid.uuid4().hex[:8]}{ext}"
    with open(os.path.join("uploads/approvals", name), "wb") as fh:
        fh.write(data)
    return {"path": f"/uploads/approvals/{name}"}
