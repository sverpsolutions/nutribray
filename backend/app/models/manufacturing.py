"""
Manufacturing Module Models for Nutribray ERP.
Includes:
- mfg_bom (Bill of Materials)
- mfg_bom_item (BOM Components, Raw & Packaging materials)
- mfg_order (Manufacturing / Production Orders)
- mfg_order_item (Order Material Requirements)
- mfg_order_batch (Batch-level Reservations, Issues & Consumptions)
- mfg_order_output (Production Outputs, Finished Goods & QC Release)
"""
from datetime import datetime, date
from decimal import Decimal
from typing import TYPE_CHECKING
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base

if TYPE_CHECKING:
    from app.models.product import product
    from app.models.batch import product_batch
    from app.models.user import user
    from app.models.outlet import outlet


class mfg_bom(base):
    __tablename__ = "mfg_boms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bom_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    bom_name: Mapped[str] = mapped_column(String(150), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    version_label: Mapped[str] = mapped_column(String(20), default="v1.0")
    product_type: Mapped[str] = mapped_column(String(30), default="FINISHED")  # FINISHED, SEMI_FINISHED
    batch_size: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("1.000"))
    batch_unit: Mapped[str] = mapped_column(String(20), default="PCS")
    expected_yield_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("100.00"))
    tolerance_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("2.00"))
    expected_wastage_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT")  # DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, OBSOLETE
    approved_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approval_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    labor_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    overhead_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    product_rel: Mapped["product"] = relationship("product", foreign_keys=[product_id], lazy="selectin")
    items: Mapped[list["mfg_bom_item"]] = relationship(
        "mfg_bom_item",
        primaryjoin="mfg_bom.id == mfg_bom_item.bom_id",
        foreign_keys="[mfg_bom_item.bom_id]",
        back_populates="bom_rel",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="mfg_bom_item.sequence"
    )


class mfg_bom_item(base):
    __tablename__ = "mfg_bom_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bom_id: Mapped[int] = mapped_column(Integer, ForeignKey("mfg_boms.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    material_type: Mapped[str] = mapped_column(String(30), default="RAW_MATERIAL")  # RAW_MATERIAL, PACKAGING, PREMIX, CONSUMABLE, SUB_ASSEMBLY
    quantity: Mapped[Decimal] = mapped_column(Numeric(16, 8), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="KG")
    wastage_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    cost_per_unit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    total_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    is_critical: Mapped[bool] = mapped_column(Boolean, default=False)
    sub_bom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("mfg_boms.id", ondelete="SET NULL"), nullable=True)
    stage: Mapped[str] = mapped_column(String(50), default="Mixing")
    sequence: Mapped[int] = mapped_column(Integer, default=1)
    round_up: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    preferred_store_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    bom_rel: Mapped["mfg_bom"] = relationship("mfg_bom", foreign_keys=[bom_id], back_populates="items")
    product_rel: Mapped["product"] = relationship("product", foreign_keys=[product_id], lazy="selectin")


class mfg_order(base):
    __tablename__ = "mfg_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    bom_id: Mapped[int] = mapped_column(Integer, ForeignKey("mfg_boms.id"), nullable=False)
    planned_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    completed_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    rejected_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    scrap_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    unit: Mapped[str] = mapped_column(String(20), default="PCS")
    plant_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("outlets.id", ondelete="SET NULL"), nullable=True)
    department: Mapped[str] = mapped_column(String(100), default="Production")
    source_warehouse_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_warehouse_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    production_batch_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    production_batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="SET NULL"), nullable=True)
    planned_start_date: Mapped[date] = mapped_column(Date, nullable=False)
    planned_end_date: Mapped[date] = mapped_column(Date, nullable=False)
    actual_start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT")  # DRAFT, APPROVED, RESERVED, ISSUED, IN_PRODUCTION, QC_PENDING, RELEASED, COMPLETED, CANCELLED
    qc_status: Mapped[str] = mapped_column(String(30), default="PENDING")
    qc_inspection_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    qc_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    qc_released_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    qc_released_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    estimated_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    actual_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    supervisor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    product_rel: Mapped["product"] = relationship("product", foreign_keys=[product_id], lazy="selectin")
    bom_rel: Mapped["mfg_bom"] = relationship("mfg_bom", foreign_keys=[bom_id], lazy="selectin")
    items: Mapped[list["mfg_order_item"]] = relationship("mfg_order_item", back_populates="order_rel", cascade="all, delete-orphan", lazy="selectin")
    batches: Mapped[list["mfg_order_batch"]] = relationship("mfg_order_batch", back_populates="order_rel", cascade="all, delete-orphan", lazy="selectin")
    outputs: Mapped[list["mfg_order_output"]] = relationship("mfg_order_output", back_populates="order_rel", cascade="all, delete-orphan", lazy="selectin")


class mfg_order_item(base):
    __tablename__ = "mfg_order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mfg_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("mfg_orders.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    material_type: Mapped[str] = mapped_column(String(30), default="RAW_MATERIAL")
    required_qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    reserved_qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0.0000"))
    issued_qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0.0000"))
    consumed_qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0.0000"))
    returned_qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0.0000"))
    unit: Mapped[str] = mapped_column(String(20), default="KG")
    cost_per_unit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    total_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    status: Mapped[str] = mapped_column(String(30), default="PENDING")

    # Relationships
    order_rel: Mapped["mfg_order"] = relationship("mfg_order", back_populates="items")
    product_rel: Mapped["product"] = relationship("product", foreign_keys=[product_id], lazy="selectin")


class mfg_order_batch(base):
    __tablename__ = "mfg_order_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mfg_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("mfg_orders.id", ondelete="CASCADE"), nullable=False)
    mfg_order_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("mfg_order_items.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("product_batches.id"), nullable=False)
    batch_no: Mapped[str] = mapped_column(String(100), nullable=False)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reserved_qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0.0000"))
    issued_qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0.0000"))
    consumed_qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0.0000"))
    returned_qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0.0000"))
    status: Mapped[str] = mapped_column(String(30), default="RESERVED")

    # Relationships
    order_rel: Mapped["mfg_order"] = relationship("mfg_order", back_populates="batches")
    product_rel: Mapped["product"] = relationship("product", foreign_keys=[product_id], lazy="selectin")
    batch_rel: Mapped["product_batch"] = relationship("product_batch", foreign_keys=[batch_id], lazy="selectin")


class mfg_order_output(base):
    __tablename__ = "mfg_order_outputs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mfg_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("mfg_orders.id", ondelete="CASCADE"), nullable=False)
    output_no: Mapped[str] = mapped_column(String(50), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="SET NULL"), nullable=True)
    batch_no: Mapped[str] = mapped_column(String(100), nullable=False)
    good_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    rejected_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    scrap_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    unit: Mapped[str] = mapped_column(String(20), default="PCS")
    mfg_date: Mapped[date] = mapped_column(Date, nullable=False)
    exp_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    qc_status: Mapped[str] = mapped_column(String(30), default="PENDING")
    qc_released_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    qc_released_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    qc_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Relationships
    order_rel: Mapped["mfg_order"] = relationship("mfg_order", back_populates="outputs")
    product_rel: Mapped["product"] = relationship("product", foreign_keys=[product_id], lazy="selectin")
    batch_rel: Mapped["product_batch"] = relationship("product_batch", foreign_keys=[batch_id], lazy="selectin")
