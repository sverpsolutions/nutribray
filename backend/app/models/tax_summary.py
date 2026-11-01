from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import Date, DateTime, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import base

class unit_wise_tax_summary(base):
    __tablename__ = "unit_wise_tax_summary"
    __table_args__ = {"extend_existing": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outlet_id: Mapped[int] = mapped_column(Integer, nullable=False)
    summary_date: Mapped[date] = mapped_column(Date, nullable=False)
    
    sales_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    basic_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    
    gst_0: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    
    taxable_5: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    gst_5: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    
    taxable_12: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    gst_12: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    
    taxable_18: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    gst_18: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    
    taxable_28: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    gst_28: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    
    taxable_40: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    gst_40: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    
    cess: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
