from datetime import datetime, date
from decimal import Decimal
from typing import TYPE_CHECKING
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base

from app.models.party import supplier  # noqa: F401

if TYPE_CHECKING:
    from app.models.product import product
    from app.models.user import user


class product_batch(base):
    __tablename__ = "product_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    batch_no: Mapped[str] = mapped_column(String(100), nullable=False)
    supplier_batch_no: Mapped[str | None] = mapped_column(String(100))
    supplier_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"))
    mfg_date: Mapped[date | None] = mapped_column(Date)
    exp_date: Mapped[date | None] = mapped_column(Date)
    first_receipt_date: Mapped[date | None] = mapped_column(Date)
    purchase_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    cost_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    mrp: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    selling_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    status: Mapped[str] = mapped_column(String(30), default="Active")  # Active, Near Expiry, Expired, Quarantined, Recalled, Closed
    barcode: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # Manufacturing & Traceability fields
    batch_type: Mapped[str] = mapped_column(String(30), default="STANDARD")  # STANDARD, RAW_MATERIAL, PACKAGING, SEMI_FINISHED, FINISHED_PRODUCT
    mfg_order_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bom_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_batch_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qc_status: Mapped[str] = mapped_column(String(30), default="Active")
    qc_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    qc_release_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    qc_released_by: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Relationships
    product_rel: Mapped["product"] = relationship("product", back_populates="batches", lazy="selectin")
    supplier_rel: Mapped["supplier | None"] = relationship("supplier", lazy="selectin")
    stocks: Mapped[list["product_batch_stock"]] = relationship("product_batch_stock", back_populates="batch_rel", cascade="all, delete-orphan", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("product_id", "batch_no", name="uq_product_batches_prod_batch"),
    )


class product_batch_stock(base):
    __tablename__ = "product_batch_stock"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    location_id: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # 1 = HO/Warehouse, or outlet_id
    opening_qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0.000"))
    received_qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0.000"))
    sold_qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0.000"))
    returned_qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0.000"))
    transferred_in_qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0.000"))
    transferred_out_qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0.000"))
    adjusted_qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0.000"))
    current_qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0.000"))
    reserved_qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0.000"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    batch_rel: Mapped["product_batch"] = relationship("product_batch", back_populates="stocks")
    product_rel: Mapped["product"] = relationship("product", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("batch_id", "location_id", name="uq_batch_stock_batch_location"),
    )
