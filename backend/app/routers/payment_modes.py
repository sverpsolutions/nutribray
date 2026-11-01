"""Payment Mode Master. Modes are never deleted (bills reference them) — they are deactivated."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.services.auth_service import write_audit

router = APIRouter(prefix="/payment-modes", tags=["payment modes"])
TYPES = ("CASH", "UPI", "CARD", "BANK", "CHEQUE", "CREDIT", "WALLET", "VOUCHER", "OTHER")
APPLIES = ("SALE", "PURCHASE", "EXPENSE", "RECEIPT", "PAYMENT")


@router.get("")
async def list_modes(active_only: bool = False, outlet_id: Optional[int] = None, applies_to: Optional[str] = None,
                     db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    rows = (await db.execute(text("""SELECT m.*, (SELECT COUNT(*) FROM unit_wise_payments x WHERE LOWER(x.payment_mode) = LOWER(m.code)) AS used_in
        FROM payment_modes m WHERE (NOT :a OR m.is_active) AND (CAST(:o AS INT) IS NULL OR m.outlet_ids IS NULL OR :o = ANY(m.outlet_ids))
          AND (CAST(:t AS TEXT) IS NULL OR :t = ANY(m.applies_to)) ORDER BY m.sort, m.name"""),
        {"a": active_only, "o": outlet_id, "t": applies_to})).mappings().all()
    return [dict(r) for r in rows]


class mode_in(BaseModel):
    code: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_\-]+$")
    name: str = Field(min_length=2, max_length=60)
    mode_type: str = "OTHER"
    ledger_account: Optional[str] = None
    outlet_ids: Optional[list[int]] = None
    applies_to: list[str] = ["SALE"]
    reconciliation_required: bool = False
    approval_required: bool = False
    sort: int = 0


def _valid(b: mode_in):
    if b.mode_type not in TYPES:
        raise HTTPException(400, f"Type must be one of {', '.join(TYPES)}")
    if not b.applies_to or set(b.applies_to) - set(APPLIES):
        raise HTTPException(400, f"Applies to must be from {', '.join(APPLIES)}")


async def _dup(db, b: mode_in, mid: int = 0):
    r = (await db.execute(text("SELECT code, name FROM payment_modes WHERE (LOWER(code) = LOWER(:c) OR LOWER(name) = LOWER(:n)) AND id <> :i"),
                          {"c": b.code, "n": b.name, "i": mid})).first()
    if r:
        raise HTTPException(400, f"A payment mode with this code or name already exists ({r[0]} / {r[1]}).")


@router.post("")
async def create(b: mode_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    _valid(b)
    await _dup(db, b)
    mid = (await db.execute(text("""INSERT INTO payment_modes (code, name, mode_type, ledger_account, outlet_ids, applies_to, reconciliation_required,
        approval_required, sort, created_by) VALUES (LOWER(:code), :name, :mode_type, :ledger_account, :outlet_ids, :applies_to,
        :reconciliation_required, :approval_required, :sort, :u) RETURNING id"""), {**b.model_dump(), "u": user.user_id})).scalar()
    await write_audit(db=db, module="payment_modes", action="create", record_id=mid, record_no=b.code, new_data=str(b.model_dump()),
                      description=f"Payment mode {b.name} created", user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"id": mid}


@router.put("/{mid}")
async def update(mid: int, b: mode_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    _valid(b)
    old = (await db.execute(text("SELECT * FROM payment_modes WHERE id = :i"), {"i": mid})).mappings().first()
    if not old:
        raise HTTPException(404, "Payment mode not found")
    used = (await db.execute(text("SELECT 1 FROM unit_wise_payments WHERE LOWER(payment_mode) = LOWER(:c) LIMIT 1"), {"c": old["code"]})).first()
    if used and b.code.lower() != old["code"].lower():
        raise HTTPException(400, "This mode is used on bills — its code cannot change (rename the display name instead).")
    await _dup(db, b, mid)
    await db.execute(text("""UPDATE payment_modes SET code = LOWER(:code), name = :name, mode_type = :mode_type, ledger_account = :ledger_account,
        outlet_ids = :outlet_ids, applies_to = :applies_to, reconciliation_required = :reconciliation_required, approval_required = :approval_required,
        sort = :sort WHERE id = :i"""), {**b.model_dump(), "i": mid})
    await write_audit(db=db, module="payment_modes", action="edit", record_id=mid, record_no=b.code, old_data=str(dict(old)),
                      new_data=str(b.model_dump()), description=f"Payment mode {b.name} changed", user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"success": True}


@router.delete("/{mid}")
async def deactivate(mid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """'Delete' deactivates: historical bills keep pointing at the mode."""
    code = (await db.execute(text("UPDATE payment_modes SET is_active = NOT is_active WHERE id = :i RETURNING code || ':' || is_active"),
                             {"i": mid})).scalar()
    if not code:
        raise HTTPException(404, "Payment mode not found")
    await write_audit(db=db, module="payment_modes", action="toggle_active", record_id=mid, record_no=code,
                      description=f"Payment mode {code} (active = after)", user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"success": True}
