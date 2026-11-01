import math
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user, current_user_dep, require_role
from app.core.security import hash_password
from app.models.user import user as user_model
from app.models.outlet import outlet as outlet_model
from app.schemas.user import user_create, user_list_out, user_update, user_password_change, user_password_reset
from app.schemas.common import paginated_response, success_response
from app.services.auth_service import write_audit
from app.utils.search import word_match

router = APIRouter(prefix="/users", tags=["users"])


admin_only = require_role("superadmin", "admin")


async def _outlet_name(db: AsyncSession, outlet_id: int | None) -> str:
    if not outlet_id:
        return "Head Office"
    name = (await db.execute(text("SELECT outlet_name FROM outlets WHERE id = :i"), {"i": outlet_id})).scalar()
    if not name:
        raise HTTPException(status_code=400, detail=f"Location #{outlet_id} does not exist")
    return name


async def _block_if_busy(db: AsyncSession, u, what: str):
    """A user cannot be moved or deactivated while a drawer or cash is in their name (it would be orphaned)."""
    shift = (await db.execute(text("SELECT id FROM cashier_shifts WHERE cashier_id = :u AND status = 'open'"),
                              {"u": u.id})).scalar()
    if shift:
        raise HTTPException(400, f"{u.name} has open shift #{shift} — close it before you {what}")
    held = (await db.execute(text("""
        SELECT COALESCE(SUM(amount) FILTER (WHERE to_type = 'person' AND to_ref = :u AND status = 'posted'), 0)
             - COALESCE(SUM(amount) FILTER (WHERE from_type = 'person' AND from_ref = :u
                    AND (status = 'posted' OR (status = 'pending' AND kind IN ('handover', 'deposit')))), 0)
        FROM cash_entries WHERE (to_type = 'person' AND to_ref = :u) OR (from_type = 'person' AND from_ref = :u)"""),
        {"u": u.id})).scalar() or 0
    incoming = (await db.execute(text("""
        SELECT COUNT(*) FROM cash_entries WHERE kind = 'handover' AND status = 'pending' AND to_type = 'person' AND to_ref = :u"""),
        {"u": u.id})).scalar()
    if held or incoming:
        raise HTTPException(400, f"{u.name} is holding ₹{held:,.2f} cash"
                            + (f" and has {incoming} handover(s) to accept" if incoming else "")
                            + f" — settle it in Cash Management before you {what}")


def _guard_superadmin(current_user, target_role: str | None, new_role: str | None = None):
    if current_user.role != "superadmin" and "superadmin" in (target_role, new_role):
        raise HTTPException(403, "Only a superadmin can create or change a superadmin")


@router.get("", response_model=paginated_response[user_list_out])
async def list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    search: str = Query(""),
    role: str | None = Query(None),
    outlet_id: int | None = Query(None, description="0 = Head Office (no location)"),
    status_filter: bool | None = Query(None, alias="status"),
    current_user: current_user_dep = Depends(require_role("superadmin", "admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    q = select(user_model, outlet_model.outlet_name).outerjoin(outlet_model, outlet_model.id == user_model.outlet_id)
    if search:
        q = q.where(word_match(search, user_model.name, user_model.username, user_model.email))
    if role:
        q = q.where(user_model.role == role)
    if outlet_id is not None:
        q = q.where(user_model.outlet_id.is_(None) if outlet_id == 0 else user_model.outlet_id == outlet_id)
    if status_filter is not None:
        q = q.where(user_model.status == status_filter)

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await db.execute(q.order_by(user_model.status.desc(), user_model.name)
                             .offset((page - 1) * per_page).limit(per_page))).all()
    data = []
    for u, oname in rows:
        out = user_list_out.model_validate(u)
        out.outlet_name = oname or "Head Office"
        data.append(out)
    return {"data": data, "total": total, "page": page, "per_page": per_page,
            "total_pages": math.ceil(total / per_page)}


@router.post("", response_model=success_response, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: user_create,
    current_user: current_user_dep = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    _guard_superadmin(current_user, body.role)
    exists = await db.execute(select(user_model).where(func.lower(user_model.username) == body.username.lower()))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="username already exists")
    loc = await _outlet_name(db, body.outlet_id)

    new_user = user_model(
        name=body.name.strip(),
        username=body.username,
        password=hash_password(body.password),
        email=body.email,
        role=body.role,
        role_id=body.role_id,
        outlet_id=body.outlet_id or None,
        hht_login_id=body.hht_login_id,
        device_permission=body.device_permission,
        warehouse_permission=body.warehouse_permission,
        putaway_rights=body.putaway_rights,
        rack_transfer_rights=body.rack_transfer_rights,
    )
    db.add(new_user)
    await db.flush()

    await write_audit(
        db=db,
        module="users",
        action="create",
        record_id=new_user.id,
        description=f"user {new_user.username} created as {new_user.role} at {loc}",
        user_id=current_user.user_id,
        user_name=current_user.username,
    )
    await db.commit()
    return {"message": "user created", "id": new_user.id}


@router.get("/{user_id}", response_model=user_list_out)
async def get_user(
    user_id: int,
    current_user: current_user_dep = Depends(require_role("superadmin", "admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(user_model).where(user_model.id == user_id))
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    out = user_list_out.model_validate(db_user)
    out.outlet_name = await _outlet_name(db, db_user.outlet_id)
    return out


@router.put("/{user_id}", response_model=success_response)
async def update_user(
    user_id: int,
    body: user_update,
    current_user: current_user_dep = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(user_model).where(user_model.id == user_id))
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")

    # unset fields stay; an explicit null clears nullable ones (outlet_id null = Head Office)
    cols = user_model.__table__.c
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or cols[k].nullable}
    if "outlet_id" in data:
        data["outlet_id"] = data["outlet_id"] or None
    _guard_superadmin(current_user, db_user.role, data.get("role"))
    if user_id == current_user.user_id and (data.get("role", db_user.role) != db_user.role or data.get("status") is False):
        raise HTTPException(400, "You cannot change your own role or deactivate yourself")

    changes = []
    if "outlet_id" in data and data["outlet_id"] != db_user.outlet_id:
        new_loc = await _outlet_name(db, data["outlet_id"])
        await _block_if_busy(db, db_user, "move them to another location")
        changes.append(f"location {await _outlet_name(db, db_user.outlet_id)} -> {new_loc}")
    if data.get("status") is False and db_user.status:
        await _block_if_busy(db, db_user, "deactivate them")
        changes.append("deactivated")
    if "role" in data and data["role"] != db_user.role:
        changes.append(f"role {db_user.role} -> {data['role']}")

    if data:
        await db.execute(update(user_model).where(user_model.id == user_id).values(**data))
        await write_audit(
            db=db,
            module="users",
            action="update",
            record_id=user_id,
            description=f"user {db_user.username} updated: {', '.join(changes) or 'details'}",
            user_id=current_user.user_id,
            user_name=current_user.username,
        )
        await db.commit()
    return {"message": "user updated", "id": user_id}


@router.delete("/{user_id}", response_model=success_response)
async def delete_user(
    user_id: int,
    current_user: current_user_dep = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    if user_id == current_user.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cannot deactivate yourself")

    result = await db.execute(select(user_model).where(user_model.id == user_id))
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    _guard_superadmin(current_user, db_user.role)
    await _block_if_busy(db, db_user, "deactivate them")

    await db.execute(update(user_model).where(user_model.id == user_id).values(status=False))
    await write_audit(
        db=db,
        module="users",
        action="deactivate",
        record_id=user_id,
        description=f"user {user_id} deactivated (soft delete)",
        user_id=current_user.user_id,
        user_name=current_user.username,
    )
    await db.commit()
    return {"message": "user deactivated", "id": user_id}


@router.post("/{user_id}/reset-password", response_model=success_response)
async def reset_password(
    user_id: int,
    body: user_password_reset,
    current_user: current_user_dep = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    db_user = (await db.execute(select(user_model).where(user_model.id == user_id))).scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    _guard_superadmin(current_user, db_user.role)
    await db.execute(update(user_model).where(user_model.id == user_id).values(password=hash_password(body.new_password)))
    await write_audit(db=db, module="users", action="reset_password", record_id=user_id,
                      description=f"password reset for {db_user.username}",
                      user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "password reset", "id": user_id}


@router.post("/{user_id}/change-password", response_model=success_response)
async def change_password(
    user_id: int,
    body: user_password_change,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.user_id != user_id and current_user.role not in ("superadmin", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="cannot change another user's password")

    result = await db.execute(select(user_model).where(user_model.id == user_id))
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")

    from app.core.security import verify_password
    if not verify_password(body.old_password, db_user.password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="old password is incorrect")

    await db.execute(
        update(user_model).where(user_model.id == user_id).values(password=hash_password(body.new_password))
    )
    await write_audit(
        db=db,
        module="users",
        action="change_password",
        record_id=user_id,
        user_id=current_user.user_id,
        user_name=current_user.username,
    )
    await db.commit()
    return {"message": "password changed", "id": user_id}
