from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from fastapi import HTTPException, status, Request
from app.models.user import user as user_model, audit_log
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token


async def login(username: str, password: str, db: AsyncSession, request: Request | None = None):
    from sqlalchemy import func
    result = await db.execute(
        select(user_model).where(
            (func.lower(user_model.username) == func.lower(username)) | 
            (func.lower(user_model.hht_login_id) == func.lower(username))
        )
    )
    db_user = result.scalar_one_or_none()

    async def refuse(code: int, detail: str, why: str):
        # failed logins on a real account are audited (login history report); unknown usernames have no user to log against
        if db_user:
            await write_audit(db=db, module="auth", action="login_failed", record_id=db_user.id, description=f"{db_user.username}: {why}",
                              user_id=db_user.id, user_name=db_user.username,
                              ip_address=request.client.host if request and request.client else None)
            await db.commit()
        raise HTTPException(status_code=code, detail=detail)

    if not db_user or not verify_password(password, db_user.password):
        await refuse(status.HTTP_401_UNAUTHORIZED, "invalid username or password", "wrong password")

    if not db_user.status:
        await refuse(status.HTTP_403_FORBIDDEN, "account is inactive", "account inactive")
    today = datetime.now().date()
    if (db_user.valid_from and db_user.valid_from > today) or (db_user.valid_until and db_user.valid_until < today):
        await refuse(status.HTTP_403_FORBIDDEN, "account is outside its validity period", "outside validity period")

    await db.execute(
        update(user_model)
        .where(user_model.id == db_user.id)
        .values(last_login=datetime.now())
    )

    await write_audit(
        db=db,
        module="auth",
        action="login",
        record_id=db_user.id,
        description=f"user {db_user.username} logged in",
        user_id=db_user.id,
        user_name=db_user.username,
        ip_address=request.client.host if request and request.client else None,
    )

    await db.commit()

    access_token = create_access_token(db_user.id, db_user.role)
    refresh_token = create_refresh_token(db_user.id)

    return access_token, refresh_token, db_user


async def refresh_access_token(refresh_token: str, db: AsyncSession):
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid refresh token")

    user_id = payload.get("sub")
    result = await db.execute(select(user_model).where(user_model.id == int(user_id)))
    db_user = result.scalar_one_or_none()

    if not db_user or not db_user.status:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found or inactive")

    return create_access_token(db_user.id, db_user.role)


async def write_audit(
    db: AsyncSession,
    module: str,
    action: str,
    user_id: int | None = None,
    user_name: str | None = None,
    record_id: int | None = None,
    record_no: str | None = None,
    old_data: str | None = None,
    new_data: str | None = None,
    description: str | None = None,
    meta_data: dict | None = None,
    ip_address: str | None = None,
):
    log = audit_log(
        module=module,
        action=action,
        record_id=record_id,
        record_no=record_no,
        old_data=old_data,
        new_data=new_data,
        description=description,
        meta_data=meta_data,
        user_id=user_id,
        user_name=user_name,
        ip_address=ip_address,
    )
    db.add(log)
