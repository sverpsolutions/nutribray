from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base
from app.models.outlet import outlet
from app.models.product import item_category
from app.models.user import role, user


class user_store_assignment(base):
    __tablename__ = "user_store_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    outlet_id: Mapped[int] = mapped_column(Integer, ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    outlet_rel: Mapped["outlet"] = relationship("outlet", foreign_keys=[outlet_id], lazy="joined")


class user_category_assignment(base):
    __tablename__ = "user_category_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey("item_categories.id", ondelete="CASCADE"), nullable=False)
    include_subcategories: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    category_rel: Mapped["item_category"] = relationship("item_category", foreign_keys=[category_id], lazy="joined")


class dashboard_widget(base):
    __tablename__ = "dashboard_widgets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    widget_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    default_width: Mapped[int] = mapped_column(Integer, default=1)
    min_width: Mapped[int] = mapped_column(Integer, default=1)
    max_width: Mapped[int] = mapped_column(Integer, default=4)
    required_permission: Mapped[str | None] = mapped_column(String(100))
    endpoint_url: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class dashboard_template(base):
    __tablename__ = "dashboard_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    role_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("roles.id", ondelete="SET NULL"))
    department: Mapped[str | None] = mapped_column(String(50))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_user_customization: Mapped[bool] = mapped_column(Boolean, default=True)
    layout_config: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    widgets: Mapped[list["template_widget"]] = relationship(
        "template_widget",
        back_populates="template_rel",
        cascade="all, delete-orphan",
        order_by="template_widget.position"
    )


class template_widget(base):
    __tablename__ = "template_widgets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(Integer, ForeignKey("dashboard_templates.id", ondelete="CASCADE"), nullable=False)
    widget_id: Mapped[int] = mapped_column(Integer, ForeignKey("dashboard_widgets.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    col_span: Mapped[int] = mapped_column(Integer, default=1)
    row_span: Mapped[int] = mapped_column(Integer, default=1)
    config: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True)

    template_rel: Mapped["dashboard_template"] = relationship("dashboard_template", back_populates="widgets")
    widget_rel: Mapped["dashboard_widget"] = relationship("dashboard_widget", lazy="joined")


class user_dashboard_preference(base):
    __tablename__ = "user_dashboard_preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    template_id: Mapped[int] = mapped_column(Integer, ForeignKey("dashboard_templates.id", ondelete="CASCADE"), nullable=False)
    layout_overrides: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
