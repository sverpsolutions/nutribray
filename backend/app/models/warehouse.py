from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, Date, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.models.product import product
    from app.models.user import user


class warehouse_zone(base):
    __tablename__ = "warehouse_zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    zone_name: Mapped[str] = mapped_column(String(100), nullable=False)
    warehouse_id: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    aisles: Mapped[list["aisle_master"]] = relationship("aisle_master", back_populates="warehouse_zone_rel")
    racks: Mapped[list["rack_master"]] = relationship("rack_master", back_populates="zone_rel")


class aisle_master(base):
    __tablename__ = "aisle_master"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    aisle_code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    aisle_name: Mapped[str] = mapped_column(String(100), nullable=False)
    warehouse_code: Mapped[str | None] = mapped_column(String(20))
    warehouse_zone_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("warehouse_zones.id"))
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Relationships
    warehouse_zone_rel: Mapped["warehouse_zone | None"] = relationship("warehouse_zone", back_populates="aisles")
    divisions: Mapped[list["division_master"]] = relationship(
        "division_master", back_populates="aisle_rel", cascade="all, delete-orphan"
    )


class division_master(base):
    __tablename__ = "division_master"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    division_code: Mapped[str] = mapped_column(String(10), nullable=False)
    division_name: Mapped[str] = mapped_column(String(100), nullable=False)
    aisle_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("aisle_master.id", ondelete="CASCADE"))
    aisle_code: Mapped[str] = mapped_column(String(10), nullable=False)
    sequence_no: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    aisle_rel: Mapped["aisle_master"] = relationship("aisle_master", back_populates="divisions")
    racks: Mapped[list["rack_master"]] = relationship(
        "rack_master", back_populates="division_rel", cascade="all, delete-orphan"
    )


class rack_master(base):
    __tablename__ = "rack_master"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rack_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    aisle_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("aisle_master.id"))
    division_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("division_master.id"))
    zone_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("warehouse_zones.id"))
    aisle_code: Mapped[str | None] = mapped_column(String(10))
    division_code: Mapped[str | None] = mapped_column(String(10))
    rack_number: Mapped[str] = mapped_column(String(10), nullable=False)
    shelf_level: Mapped[str | None] = mapped_column(String(5))
    bay_number: Mapped[str | None] = mapped_column(String(20))
    bin_code: Mapped[str | None] = mapped_column(String(10))
    capacity: Mapped[int | None] = mapped_column(Integer)
    max_weight: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    current_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0"))
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Relationships
    zone_rel: Mapped["warehouse_zone | None"] = relationship("warehouse_zone", back_populates="racks")
    division_rel: Mapped["division_master"] = relationship("division_master", back_populates="racks")
    inventory: Mapped[list["rack_inventory"]] = relationship("rack_inventory", back_populates="rack_rel", cascade="all, delete-orphan")
    item_mappings: Mapped[list["item_rack_mapping"]] = relationship(
        "item_rack_mapping", back_populates="rack_rel", cascade="all, delete-orphan"
    )


class item_rack_mapping(base):
    __tablename__ = "item_rack_mapping"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("products.id", ondelete="CASCADE"))
    rack_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rack_master.id", ondelete="CASCADE"))
    rack_code: Mapped[str | None] = mapped_column(String(30))
    priority: Mapped[str] = mapped_column(String(20), default="Primary")
    min_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    max_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Relationships
    rack_rel: Mapped["rack_master"] = relationship("rack_master", back_populates="item_mappings")


class rack_inventory(base):
    __tablename__ = "rack_inventory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rack_id: Mapped[int] = mapped_column(Integer, ForeignKey("rack_master.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(30), default="Rack Stock")
    batch_no: Mapped[str | None] = mapped_column(String(50))
    expiry_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    rack_rel: Mapped["rack_master"] = relationship("rack_master", back_populates="inventory")


class putaway_batch(base):
    __tablename__ = "putaway_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    grn_id: Mapped[int] = mapped_column(Integer, nullable=False)
    grn_no: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    total_items: Mapped[int] = mapped_column(Integer, default=0)
    placed_items: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class putaway_log(base):
    __tablename__ = "putaway_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("putaway_batches.id"))
    grn_id: Mapped[int | None] = mapped_column(Integer)
    rack_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rack_master.id"))
    product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("products.id"))
    qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    device_id: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
