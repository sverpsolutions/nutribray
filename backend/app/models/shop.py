from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base

class shop_customer(base):
    __tablename__ = "shop_customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    email: Mapped[str | None] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(50))
    state: Mapped[str] = mapped_column(String(50), default="Delhi")
    pincode: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

class shop_order(base):
    __tablename__ = "shop_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("shop_customers.id"))
    order_date: Mapped[date] = mapped_column(Date, nullable=False, default=func.current_date())
    order_datetime: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    delivery_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    payment_mode: Mapped[str] = mapped_column(String(20), default="cod")
    payment_status: Mapped[str] = mapped_column(String(20), default="pending")
    order_status: Mapped[str] = mapped_column(String(20), default="pending") # pending, processing, shipped, delivered, cancelled
    delivery_address: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    items: Mapped[list["shop_order_item"]] = relationship(
        "shop_order_item", back_populates="order_rel", cascade="all, delete-orphan"
    )

class shop_order_item(base):
    __tablename__ = "shop_order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(Integer, ForeignKey("shop_orders.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(150))
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=1.000)
    unit: Mapped[str | None] = mapped_column(String(10))
    rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)

    order_rel: Mapped["shop_order"] = relationship("shop_order", back_populates="items")

class shop_banner(base):
    __tablename__ = "shop_banners"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str | None] = mapped_column(String(100))
    image: Mapped[str] = mapped_column(String(255), nullable=False)
    link: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
