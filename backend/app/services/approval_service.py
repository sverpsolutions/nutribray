"""Central approval engine.

submit() files a request (or posts it at once when its policy is switched off); decide() lets an authorised approver
approve / reject / return it. Every request type registers a handler: check(db, payload) runs at submit and again at
approval (stock can change in between), post(db, req, approver) applies the change. A rejected or returned request
never touches stock or prices; the PENDING -> APPROVED switch is row-locked, so a double click cannot post twice.

Who may approve is configuration (approval_policies.approver_roles), not code; approvers must also have the
'approvals.approve' permission and the request's store in their scope, and cannot approve their own request unless
the policy allows it.
"""
import json
from datetime import datetime
from typing import Awaitable, Callable, Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.services.auth_service import write_audit

Check = Callable[[AsyncSession, dict], Awaitable[None]]
Post = Callable[[AsyncSession, dict, object], Awaitable[Optional[str]]]
HANDLERS: dict[str, tuple[Check, Post]] = {}
ADMIN = ("admin", "superadmin")


def handler(request_type: str):
    def deco(cls):
        HANDLERS[request_type] = (cls.check, cls.post)
        return cls
    return deco


async def _no(db) -> str:
    yr = datetime.now().year
    n = (await db.execute(text("""INSERT INTO approval_seq (yr, last_no) VALUES (:y, 1)
        ON CONFLICT (yr) DO UPDATE SET last_no = approval_seq.last_no + 1 RETURNING last_no"""), {"y": yr})).scalar()
    return f"APR-{yr}-{n:05d}"


async def policy(db, request_type: str) -> dict:
    p = (await db.execute(text("SELECT * FROM approval_policies WHERE request_type = :t"), {"t": request_type})).mappings().first()
    if not p:
        raise HTTPException(400, f"Unknown request type {request_type}")
    return dict(p)


async def _audit(db, user, req: dict, action: str, desc: str):
    await write_audit(db=db, module="approvals", action=action, record_id=req["id"], record_no=req["request_no"],
                      description=desc, user_id=user.user_id, user_name=user.username,
                      meta_data={"type": req["request_type"], "outlet_id": req.get("outlet_id"), "ref": req.get("ref_no")})


async def submit(db, *, request_type: str, user, reason: str, payload: dict, outlet_id: Optional[int] = None, summary: str = "",
                 ref_type: Optional[str] = None, ref_id: Optional[int] = None, ref_no: Optional[str] = None,
                 old_value=None, new_value=None, attachment: Optional[str] = None, request_key: Optional[str] = None,
                 force_approval: bool = False) -> dict:
    """File a request. Returns {id, request_no, status}; status APPROVED means it was posted immediately (policy off)."""
    if not reason or len(reason.strip()) < 3:
        raise HTTPException(400, "Give a reason.")
    if request_key:
        dup = (await db.execute(text("SELECT id, request_no, status FROM approval_requests WHERE request_key = :k"), {"k": request_key})).mappings().first()
        if dup:
            return {**dict(dup), "duplicate": True}
    access.check_outlet(outlet_id)
    check, post = HANDLERS[request_type]
    await check(db, payload)
    pol = await policy(db, request_type)
    no = await _no(db)
    rid = (await db.execute(text("""INSERT INTO approval_requests (request_no, request_type, outlet_id, ref_type, ref_id, ref_no, summary,
        old_value, new_value, payload, reason, attachment, requested_by, request_key)
        VALUES (:no, :t, :o, :rt, :ri, :rn, :s, CAST(:ov AS JSONB), CAST(:nv AS JSONB), CAST(:p AS JSONB), :r, :a, :u, :k) RETURNING id"""),
        {"no": no, "t": request_type, "o": outlet_id, "rt": ref_type, "ri": ref_id, "rn": ref_no, "s": summary[:300],
         "ov": json.dumps(old_value, default=str), "nv": json.dumps(new_value, default=str), "p": json.dumps(payload, default=str),
         "r": reason.strip(), "a": attachment, "u": user.user_id, "k": request_key})).scalar()
    req = {"id": rid, "request_no": no, "request_type": request_type, "outlet_id": outlet_id, "ref_no": ref_no, "payload": payload,
           "requested_by": user.user_id, "reason": reason}
    await _audit(db, user, req, "submit", f"{pol['label']}: {summary} — {reason}")
    if pol["enabled"] or force_approval:
        return {"id": rid, "request_no": no, "status": "PENDING"}
    try:
        posted = await post(db, req, user)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.execute(text("""UPDATE approval_requests SET status = 'APPROVED', decided_by = :u, decided_at = NOW(),
        decision_note = 'Auto-approved (approval switched off for this type)', posted_ref = :p WHERE id = :i"""),
        {"u": user.user_id, "p": posted, "i": rid})
    await _audit(db, user, req, "auto_post", f"{no} posted without approval (policy off)")
    return {"id": rid, "request_no": no, "status": "APPROVED", "posted_ref": posted}


async def can_approve(db, user, req: dict, pol: dict, perms: Optional[set] = None) -> Optional[str]:
    """None when this user may decide the request, else the reason they cannot."""
    if user.role not in ADMIN:
        if user.role not in (pol["approver_roles"] or []):
            return f"Your role ({user.role}) cannot approve {pol['label'].lower()} requests."
        if perms is not None and "approvals.approve" not in perms:
            return "You do not have the Approvals → approve permission."
        outs = access.allowed_outlets()
        if outs is not None and req["outlet_id"] is not None and req["outlet_id"] not in outs:
            return "This request belongs to a store outside your assigned stores."
    if req["requested_by"] == user.user_id and not pol["allow_self"] and user.role not in ADMIN:
        return "You cannot approve your own request."
    if pol["threshold"] is not None and req.get("amount") is not None and float(req["amount"]) > float(pol["threshold"]) and user.role not in ADMIN:
        return f"Above the {pol['threshold']} limit: needs an administrator."
    return None


async def decide(db, rid: int, user, action: str, note: Optional[str]) -> dict:
    req = (await db.execute(text("SELECT * FROM approval_requests WHERE id = :i FOR UPDATE"), {"i": rid})).mappings().first()
    if not req:
        raise HTTPException(404, "Request not found")
    req = dict(req)
    if req["status"] != "PENDING":
        raise HTTPException(400, f"{req['request_no']} is already {req['status'].lower()}.")
    pol = await policy(db, req["request_type"])
    why = await can_approve(db, user, req, pol)
    if why:
        raise HTTPException(403, why)
    if action in ("reject", "return") and not (note and note.strip()):
        raise HTTPException(400, "Give a reason for rejecting or returning the request.")
    posted = None
    if action == "approve":
        check, post = HANDLERS[req["request_type"]]
        try:
            await check(db, {**req["payload"], "_rid": rid})   # still valid now? (stock may have moved since the request)
            posted = await post(db, req, user)
        except ValueError as e:                                # batch service reports stock problems as ValueError
            raise HTTPException(400, str(e))
    status = {"approve": "APPROVED", "reject": "REJECTED", "return": "RETURNED"}[action]
    await db.execute(text("""UPDATE approval_requests SET status = :s, decided_by = :u, decided_at = NOW(), decision_note = :n, posted_ref = :p
        WHERE id = :i"""), {"s": status, "u": user.user_id, "n": note, "p": posted, "i": rid})
    await _audit(db, user, req, action, f"{req['request_no']} {status.lower()}" + (f": {note}" if note else "") + (f" → {posted}" if posted else ""))
    return {"status": status, "posted_ref": posted}
