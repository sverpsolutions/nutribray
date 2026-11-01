from datetime import datetime
from decimal import Decimal
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base


class storage_type_master(base):
    __tablename__ = "storage_type_master"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False) # NORMAL, COLD STORAGE, FROZEN, DRY AREA
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class temperature_category_master(base):
    __tablename__ = "temperature_category_master"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False) # AMBIENT, CHILLED, FROZEN
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class item_packaging_master(base):
    __tablename__ = "item_packaging_master"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(50))

    # ── UOMs ────────────────────────────────────────────────────────────────────
    base_uom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("unit_master.id"))
    purchase_uom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("unit_master.id"))
    sales_uom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("unit_master.id"))
    inner_pack_uom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("unit_master.id"))
    outer_carton_uom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("unit_master.id"))

    # ── Packaging Type ──────────────────────────────────────────────────────────
    # LOOSE | INNER_OUTER | ONLY_OUTER
    packaging_type: Mapped[str] = mapped_column(String(20), default="LOOSE", nullable=False)

    # ── Inner Pack ──────────────────────────────────────────────────────────────
    inner_pack_qty: Mapped[int] = mapped_column(Integer, default=1, nullable=False)          # units per inner pack
    inner_packs_per_carton: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # inner packs per outer carton
    total_units_per_carton: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # auto-calculated
    
    # ── Outer Carton ─────────────────────────────────────────────────────────────
    outer_carton_qty: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # ── Outer Carton Dimensions ─────────────────────────────────────────────────
    carton_length_cm: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    carton_width_cm: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    carton_height_cm: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    carton_volume_cbm: Mapped[Decimal | None] = mapped_column(Numeric(12, 8))   # auto-calculated

    # ── Weight ──────────────────────────────────────────────────────────────────
    gross_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    net_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))

    # ── Barcodes per Level ──────────────────────────────────────────────────────
    unit_barcode: Mapped[str | None] = mapped_column(String(50))
    inner_barcode: Mapped[str | None] = mapped_column(String(50))
    carton_barcode: Mapped[str | None] = mapped_column(String(50))

    # ── Storage & Life ──────────────────────────────────────────────────────────
    shelf_life_days: Mapped[int | None] = mapped_column(Integer)
    storage_type_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("storage_type_master.id"))
    temperature_category_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("temperature_category_master.id"))

    # ── Warehouse ───────────────────────────────────────────────────────────────
    rack_location: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(Text)

    # ── Flags & Audit ───────────────────────────────────────────────────────────
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # ── Index ───────────────────────────────────────────────────────────────────
    __table_args__ = (
        Index("ix_pkg_product_id", "product_id"),
        Index("ix_pkg_item_code", "item_code"),
    )
