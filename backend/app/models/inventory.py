from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base

class multi_transfer_session(base):
    __tablename__ = "multi_transfer_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_location_id: Mapped[int] = mapped_column(Integer, nullable=False) # Warehouse ID
    status: Mapped[str] = mapped_column(String(20), default="DRAFT") # DRAFT, CONFIRMED
    draft_ref_number: Mapped[str | None] = mapped_column(String(50))
    remarks: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    branches: Mapped[list["multi_transfer_session_branch"]] = relationship(back_populates="session", cascade="all, delete-orphan", lazy="selectin")
    items: Mapped[list["multi_transfer_session_item"]] = relationship(back_populates="session", cascade="all, delete-orphan", lazy="selectin")

class multi_transfer_session_branch(base):
    __tablename__ = "multi_transfer_session_branches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("multi_transfer_sessions.id", ondelete="CASCADE"))
    branch_id: Mapped[int] = mapped_column(Integer, nullable=False) # Outlet ID

    session: Mapped["multi_transfer_session"] = relationship(back_populates="branches")

class multi_transfer_session_item(base):
    __tablename__ = "multi_transfer_session_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("multi_transfer_sessions.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(Integer, nullable=False)
    barcode: Mapped[str | None] = mapped_column(String(50))
    qty_per_branch: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=1)
    batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="SET NULL"))
    batch_no: Mapped[str | None] = mapped_column(String(100))
    mfg_date: Mapped[date | None] = mapped_column(Date)
    expiry_date: Mapped[date | None] = mapped_column(Date)

    session: Mapped["multi_transfer_session"] = relationship(back_populates="items")
