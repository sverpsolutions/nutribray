from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import require_role, current_user_dep
from app.models.user import role as role_model, permission as permission_model, role_permission
from app.schemas.user import role_out, role_create, permission_out, permission_create, assign_permissions
from app.schemas.common import success_response
from app.services.auth_service import write_audit

router = APIRouter(tags=["roles & permissions"])


# ── Roles ────────────────────────────────────────────────────────────────────

@router.get("/roles", response_model=list[role_out])
async def list_roles(
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(role_model).where(role_model.is_active == True))
    return result.scalars().all()


@router.post("/roles", response_model=success_response, status_code=status.HTTP_201_CREATED)
async def create_role(
    body: role_create,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    exists = await db.execute(select(role_model).where(role_model.slug == body.slug))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="role slug already exists")

    new_role = role_model(name=body.name, slug=body.slug, description=body.description)
    db.add(new_role)
    await db.flush()
    await write_audit(db=db, module="roles", action="create", record_id=new_role.id,
                      user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "role created", "id": new_role.id}


@router.delete("/roles/{role_id}", response_model=success_response)
async def delete_role(
    role_id: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(role_model).where(role_model.id == role_id))
    db_role = result.scalar_one_or_none()
    if not db_role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")

    db_role.is_active = False
    await write_audit(db=db, module="roles", action="deactivate", record_id=role_id,
                      user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "role deactivated", "id": role_id}


# ── Permissions ───────────────────────────────────────────────────────────────

@router.get("/permissions", response_model=list[permission_out])
async def list_permissions(
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(permission_model))
    return result.scalars().all()


@router.post("/permissions", response_model=success_response, status_code=status.HTTP_201_CREATED)
async def create_permission(
    body: permission_create,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    exists = await db.execute(select(permission_model).where(permission_model.slug == body.slug))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="permission slug already exists")

    new_perm = permission_model(module=body.module, name=body.name, slug=body.slug, description=body.description)
    db.add(new_perm)
    await db.flush()
    await db.commit()
    return {"message": "permission created", "id": new_perm.id}


# ── Role ↔ Permission assignment ─────────────────────────────────────────────

@router.get("/roles/{role_id}/permissions", response_model=list[permission_out])
async def get_role_permissions(
    role_id: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(permission_model)
        .join(role_permission, role_permission.permission_id == permission_model.id)
        .where(role_permission.role_id == role_id)
    )
    return result.scalars().all()


@router.put("/roles/{role_id}/permissions", response_model=success_response)
async def assign_role_permissions(
    role_id: int,
    body: assign_permissions,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    role_exists = await db.execute(select(role_model).where(role_model.id == role_id))
    if not role_exists.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="role not found")

    await db.execute(delete(role_permission).where(role_permission.role_id == role_id))

    for perm_id in body.permission_ids:
        db.add(role_permission(role_id=role_id, permission_id=perm_id))

    await write_audit(db=db, module="roles", action="assign_permissions", record_id=role_id,
                      new_data=str(body.permission_ids),
                      user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "permissions assigned", "id": role_id}
