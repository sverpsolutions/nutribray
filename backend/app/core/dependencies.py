from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from app.core.database import get_db
from app.core.security import decode_token

bearer_scheme = HTTPBearer(auto_error=False)


class current_user_dep:
    def __init__(self, user_id: int, role: str, username: str, role_id: int | None = None, supplier_id: int | None = None):
        self.user_id = user_id
        self.id = user_id  # billing/estimates routers read .id
        self.role = role
        self.username = username
        self.role_id = role_id
        self.supplier_id = supplier_id


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> current_user_dep:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not credentials:
        raise exc

    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise exc

    user_id = payload.get("sub")
    if not user_id:
        raise exc

    row = await db.execute(
        text("SELECT id, role, role_id, username, status, supplier_id FROM users WHERE id = :uid"),
        {"uid": int(user_id)},
    )
    user = row.fetchone()
    if not user or not user.status:
        raise exc

    return current_user_dep(
        user_id=user.id,
        role=user.role,
        username=user.username,
        role_id=user.role_id,
        supplier_id=user.supplier_id,
    )


def require_role(*roles: str):
    """Role guard. On paths the central access check controls (core/access.py) the user's module/action
    permission has already been verified for this request, so it decides instead of the fixed role list —
    except User Management, whose legacy endpoints stay administrator-only."""
    async def _check(request: Request, user: current_user_dep = Depends(get_current_user)):
        from app.core.access import classify
        cls = classify(request.url.path, request.method)
        if cls and cls[0] not in ("users", "*"):
            return user
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient role")
        return user
    return _check


def require_permission(slug: str):
    """
    Check permission by slug.
    Priority:
      1. user_granular_permissions (per-user override — granted=true/false)
      2. role_permissions → permissions (role-level)
    Admin role bypasses all permission checks.
    """
    async def _check(
        user: current_user_dep = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if user.role == "admin":
            return user

        # 1. check user-level granular override
        granular = await db.execute(
            text(
                "SELECT granted FROM user_granular_permissions "
                "WHERE user_id = :uid AND slug = :slug LIMIT 1"
            ),
            {"uid": user.user_id, "slug": slug},
        )
        row = granular.fetchone()
        if row is not None:
            if not row.granted:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"permission denied: {slug}")
            return user

        # 2. check role-level permission via role_id
        if user.role_id:
            role_perm = await db.execute(
                text(
                    """
                    SELECT rp.id FROM role_permissions rp
                    JOIN permissions p ON rp.permission_id = p.id
                    WHERE rp.role_id = :role_id AND p.slug = :slug
                    LIMIT 1
                    """
                ),
                {"role_id": user.role_id, "slug": slug},
            )
            if role_perm.fetchone():
                return user

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"permission denied: {slug}")
    return _check
