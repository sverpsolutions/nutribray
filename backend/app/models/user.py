from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base


class role(base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    users: Mapped[list["user"]] = relationship("user", back_populates="role_rel")
    role_permissions: Mapped[list["role_permission"]] = relationship("role_permission", back_populates="role_rel")


class permission(base):
    __tablename__ = "permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    module: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    role_permissions: Mapped[list["role_permission"]] = relationship("role_permission", back_populates="permission_rel")
    user_permissions: Mapped[list["user_permission"]] = relationship("user_permission", back_populates="permission_rel")


class role_permission(base):
    __tablename__ = "role_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("roles.id"), nullable=False)
    permission_id: Mapped[int] = mapped_column(Integer, ForeignKey("permissions.id"), nullable=False)

    role_rel: Mapped["role"] = relationship("role", back_populates="role_permissions")
    permission_rel: Mapped["permission"] = relationship("permission", back_populates="role_permissions")


class user_permission(base):
    __tablename__ = "user_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    permission_id: Mapped[int] = mapped_column(Integer, ForeignKey("permissions.id"), nullable=False)

    permission_rel: Mapped["permission"] = relationship("permission", back_populates="user_permissions")


class user_granular_permission(base):
    __tablename__ = "user_granular_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    granted: Mapped[bool] = mapped_column(Boolean, default=True)


class module_permission(base):
    __tablename__ = "module_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    module_key: Mapped[str] = mapped_column(String(50), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class user(base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(30), default="staff")
    role_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("roles.id"))
    outlet_id: Mapped[int | None] = mapped_column(Integer)
    supplier_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True)
    default_dashboard_template_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("dashboard_templates.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # HHT / WMS Permissions
    hht_login_id: Mapped[str | None] = mapped_column(String(50), unique=True)
    device_permission: Mapped[bool] = mapped_column(Boolean, default=False)
    warehouse_permission: Mapped[bool] = mapped_column(Boolean, default=False)
    putaway_rights: Mapped[bool] = mapped_column(Boolean, default=False)
    rack_transfer_rights: Mapped[bool] = mapped_column(Boolean, default=False)

    last_login: Mapped[datetime | None] = mapped_column(DateTime)
    employee_code: Mapped[str | None] = mapped_column(String(30))
    mobile: Mapped[str | None] = mapped_column(String(20))
    department: Mapped[str | None] = mapped_column(String(60))
    designation: Mapped[str | None] = mapped_column(String(60))
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_until: Mapped[date | None] = mapped_column(Date)
    all_outlets: Mapped[bool] = mapped_column(Boolean, default=False)      # data scope: every outlet
    all_categories: Mapped[bool] = mapped_column(Boolean, default=False)   # data scope: every category
    created_by: Mapped[int | None] = mapped_column(Integer)
    updated_by: Mapped[int | None] = mapped_column(Integer)
    reset_token: Mapped[str | None] = mapped_column(String(100))
    reset_token_expiry: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    role_rel: Mapped["role | None"] = relationship("role", back_populates="users")


class audit_log(base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    module: Mapped[str] = mapped_column(String(50), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    record_id: Mapped[int | None] = mapped_column(Integer)
    record_no: Mapped[str | None] = mapped_column(String(50))
    old_data: Mapped[str | None] = mapped_column(Text)
    new_data: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    meta_data: Mapped[dict | None] = mapped_column(JSON)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    user_name: Mapped[str | None] = mapped_column(String(100))
    ip_address: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
