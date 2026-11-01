from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base

class stock_take(base):
    __tablename__ = "stock_takes"

    id: Mapped[int]                     = mapped_column(Integer, primary_key=True)
    take_no: Mapped[str]                = mapped_column(String(30), unique=True, nullable=False)
    location_id: Mapped[int]            = mapped_column(Integer, nullable=False)
    location_name: Mapped[str | None]   = mapped_column(String(100), nullable=True)
    status: Mapped[str]                 = mapped_column(String(20), default="in_progress")  # in_progress, completed, cancelled
    notes: Mapped[str | None]           = mapped_column(Text, nullable=True)
    started_by: Mapped[int | None]      = mapped_column(Integer, nullable=True)
    started_by_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    started_at: Mapped[datetime]        = mapped_column(DateTime, server_default=func.now())
    finalized_by: Mapped[int | None]    = mapped_column(Integer, nullable=True)
    finalized_by_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    adjust_stock: Mapped[bool]          = mapped_column(Boolean, default=True)
    total_items: Mapped[int]            = mapped_column(Integer, default=0)
    counted_items: Mapped[int]          = mapped_column(Integer, default=0)
    created_at: Mapped[datetime]        = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime]        = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    items: Mapped[list["stock_take_item"]] = relationship(
        "stock_take_item", back_populates="take_rel", cascade="all, delete-orphan",
        order_by="stock_take_item.id"
    )

class stock_take_item(base):
    __tablename__ = "stock_take_items"

    id: Mapped[int]                  = mapped_column(Integer, primary_key=True)
    stock_take_id: Mapped[int]       = mapped_column(Integer, ForeignKey("stock_takes.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int]          = mapped_column(Integer, nullable=False)
    product_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    item_code: Mapped[str | None]    = mapped_column(String(50), nullable=True)
    unit: Mapped[str]                = mapped_column(String(20), default="PCS")
    system_qty: Mapped[Decimal]      = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    counted_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)  # None = uncounted
    batch_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="SET NULL"), nullable=True)
    mfg_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    saved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    take_rel: Mapped["stock_take"]   = relationship("stock_take", back_populates="items")
    batches: Mapped[list["stock_take_item_batch"]] = relationship(
        "stock_take_item_batch", back_populates="item_rel", cascade="all, delete-orphan",
        order_by="stock_take_item_batch.id"
    )

class stock_take_item_batch(base):
    __tablename__ = "stock_take_item_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stock_take_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("stock_take_items.id", ondelete="CASCADE"), nullable=False)
    stock_take_id: Mapped[int] = mapped_column(Integer, ForeignKey("stock_takes.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="SET NULL"), nullable=True)
    batch_no: Mapped[str] = mapped_column(String(100), nullable=False)
    mfg_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    system_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    counted_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    variance: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    item_rel: Mapped["stock_take_item"] = relationship("stock_take_item", back_populates="batches")
