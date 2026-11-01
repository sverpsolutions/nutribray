"""
Channel Partner & Item Channel Price Models
Bombay Fisheries ERP — Online Channel Pricing Engine
"""
from datetime import datetime
from decimal import Decimal
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base


class channel_partner(base):
    __tablename__ = "channel_partners"

    id                 : Mapped[int]            = mapped_column(Integer, primary_key=True)
    partner_name       : Mapped[str]            = mapped_column(String(100), nullable=False)
    partner_code       : Mapped[str]            = mapped_column(String(30), unique=True, nullable=False)
    commission_percent : Mapped[Decimal]        = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    settlement_days    : Mapped[int]            = mapped_column(Integer, default=7)
    gst_on_commission  : Mapped[bool]           = mapped_column(Boolean, default=False)
    delivery_charge    : Mapped[Decimal]        = mapped_column(Numeric(8, 2), default=Decimal("0.00"))
    packing_charge     : Mapped[Decimal]        = mapped_column(Numeric(8, 2), default=Decimal("0.00"))
    extra_margin       : Mapped[Decimal]        = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    is_active          : Mapped[bool]           = mapped_column(Boolean, default=True)
    logo_url           : Mapped[str | None]     = mapped_column(String(255))
    remarks            : Mapped[str | None]     = mapped_column(Text)
    created_at         : Mapped[datetime]       = mapped_column(DateTime, server_default=func.now())
    updated_at         : Mapped[datetime]       = mapped_column(DateTime, server_default=func.now())

    item_prices: Mapped[list["item_channel_price"]] = relationship(
        "item_channel_price", back_populates="partner_rel", cascade="all, delete-orphan"
    )


class item_channel_price(base):
    __tablename__ = "item_channel_prices"

    id                    : Mapped[int]            = mapped_column(Integer, primary_key=True)
    product_id            : Mapped[int]            = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    partner_id            : Mapped[int]            = mapped_column(Integer, ForeignKey("channel_partners.id"), nullable=False)
    mrp                   : Mapped[Decimal | None]  = mapped_column(Numeric(10, 2))
    base_cost             : Mapped[Decimal | None]  = mapped_column(Numeric(10, 2))
    margin_percent        : Mapped[Decimal | None]  = mapped_column(Numeric(5, 2))
    partner_commission    : Mapped[Decimal | None]  = mapped_column(Numeric(5, 2))
    selling_price         : Mapped[Decimal | None]  = mapped_column(Numeric(10, 2))
    final_settlement_rate : Mapped[Decimal | None]  = mapped_column(Numeric(10, 2))
    minimum_profit        : Mapped[Decimal | None]  = mapped_column(Numeric(10, 2))
    is_active             : Mapped[bool]            = mapped_column(Boolean, default=True)
    created_at            : Mapped[datetime]        = mapped_column(DateTime, server_default=func.now())
    updated_at            : Mapped[datetime]        = mapped_column(DateTime, server_default=func.now())

    partner_rel : Mapped["channel_partner"] = relationship("channel_partner", back_populates="item_prices")
    product_rel : Mapped["product"]         = relationship("product", back_populates="channel_prices")


# Avoid circular import — import product lazily
from app.models.product import product  # noqa: E402, F401
