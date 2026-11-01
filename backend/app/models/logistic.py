from datetime import datetime
from decimal import Decimal
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, Date, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.product import product
    from app.models.user import user

class logistic_transfer(base):
    __tablename__ = "logistic_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transfer_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    source_location_id: Mapped[int] = mapped_column(Integer, nullable=False) # Warehouse ID
    destination_location_id: Mapped[int] = mapped_column(Integer, nullable=False) # Outlet ID
    transfer_date: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    priority: Mapped[str] = mapped_column(String(20), default="Normal") # Normal, Urgent, Express
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT") # DRAFT, PACKING, PACKED, DISPATCHED, DELIVERED
    
    source_transfer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("unit_wise_stock_transfers.id"))
    
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    items: Mapped[list["logistic_transfer_item"]] = relationship(back_populates="transfer", cascade="all, delete-orphan", lazy="selectin")
    boxes: Mapped[list["logistic_box"]] = relationship(back_populates="transfer", cascade="all, delete-orphan", lazy="selectin")
    dispatch_details: Mapped["logistic_dispatch_detail | None"] = relationship(back_populates="transfer", uselist=False, cascade="all, delete-orphan", lazy="selectin")
    timeline: Mapped[list["logistic_timeline"]] = relationship(back_populates="transfer", cascade="all, delete-orphan", lazy="selectin")

class logistic_transfer_item(base):
    __tablename__ = "logistic_transfer_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transfer_id: Mapped[int] = mapped_column(Integer, ForeignKey("logistic_transfers.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    
    transfer: Mapped["logistic_transfer"] = relationship(back_populates="items")
    product: Mapped["product"] = relationship(lazy="selectin")

    @property
    def name(self) -> str | None:
        return self.product.name if self.product else None

    @property
    def item_code(self) -> str | None:
        return self.product.item_code if self.product else None

    @property
    def barcode(self) -> str | None:
        return self.product.barcode if self.product else None

    @property
    def hsn_code(self) -> str | None:
        return self.product.hsn_code if self.product else None

    @property
    def unit(self) -> str | None:
        return self.product.unit if self.product else None

    @property
    def mrp(self) -> Decimal | None:
        return self.product.mrp if self.product else None

class logistic_box(base):
    __tablename__ = "logistic_boxes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transfer_id: Mapped[int] = mapped_column(Integer, ForeignKey("logistic_transfers.id", ondelete="CASCADE"))
    box_number: Mapped[str] = mapped_column(String(20), nullable=False) # BOX-001
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    length_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    width_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    height_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    seal_number: Mapped[str | None] = mapped_column(String(50))
    box_type: Mapped[str | None] = mapped_column(String(50)) # cardboard, wooden crate, etc.
    is_printed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    transfer: Mapped["logistic_transfer"] = relationship(back_populates="boxes")
    items: Mapped[list["logistic_box_item"]] = relationship(back_populates="box", cascade="all, delete-orphan", lazy="selectin")

class logistic_box_item(base):
    __tablename__ = "logistic_box_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    box_id: Mapped[int] = mapped_column(Integer, ForeignKey("logistic_boxes.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)

    box: Mapped["logistic_box"] = relationship(back_populates="items")

class logistic_dispatch_detail(base):
    __tablename__ = "logistic_dispatch_details"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transfer_id: Mapped[int] = mapped_column(Integer, ForeignKey("logistic_transfers.id", ondelete="CASCADE"))
    vehicle_reg_no: Mapped[str | None] = mapped_column(String(50))
    vehicle_type: Mapped[str | None] = mapped_column(String(50))
    gps_tracking_id: Mapped[str | None] = mapped_column(String(100))
    eta: Mapped[datetime | None] = mapped_column(DateTime)
    driver_name: Mapped[str | None] = mapped_column(String(100))
    driver_mobile: Mapped[str | None] = mapped_column(String(20))
    driver_license_no: Mapped[str | None] = mapped_column(String(50))
    helper_name: Mapped[str | None] = mapped_column(String(100))
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime)

    transfer: Mapped["logistic_transfer"] = relationship(back_populates="dispatch_details")

class logistic_timeline(base):
    __tablename__ = "logistic_timeline"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transfer_id: Mapped[int] = mapped_column(Integer, ForeignKey("logistic_transfers.id", ondelete="CASCADE"))
    event: Mapped[str] = mapped_column(String(50)) # CREATED, PACKING, PACKED, DISPATCHED, etc.
    description: Mapped[str | None] = mapped_column(Text)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    transfer: Mapped["logistic_transfer"] = relationship(back_populates="timeline")
