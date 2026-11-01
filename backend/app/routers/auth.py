from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user, current_user_dep
from app.schemas.auth import login_request, token_response, refresh_request, user_out
from app.services.auth_service import login, refresh_access_token
from sqlalchemy import select
from app.models.user import user as user_model

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=dict)
async def login_endpoint(
    body: login_request,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    access_token, refresh_token, db_user = await login(body.username, body.password, db, request)

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": db_user.id,
            "name": db_user.name,
            "username": db_user.username,
            "email": db_user.email,
            "role": db_user.role,
            "role_id": db_user.role_id,
            "outlet_id": db_user.outlet_id,
        },
    }


@router.post("/refresh", response_model=token_response)
async def refresh_endpoint(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="no refresh token")

    new_access_token = await refresh_access_token(refresh_token, db)
    return {"access_token": new_access_token, "token_type": "bearer"}


@router.post("/logout")
async def logout_endpoint(response: Response):
    response.delete_cookie("refresh_token")
    return {"message": "logged out"}


@router.get("/me", response_model=user_out)
async def me_endpoint(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(user_model).where(user_model.id == current_user.user_id))
    db_user = result.scalar_one_or_none()
    if not db_user:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    return db_user
