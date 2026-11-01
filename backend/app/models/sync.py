from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import base


from app.models.purchase import (
    purchase as unit_wise_purchase,
    purchase_item as unit_wise_purchase_item,
)


class unit_wise_purchase_return(base):
    __tablename__ = "unit_wise_purchase_returns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    prn_no: Mapped[str] = mapped_column(String(50), nullable=False)
    outlet_id: Mapped[int | None] = mapped_column(Integer)  # None = HO debit note
    supplier_id: Mapped[int | None] = mapped_column(Integer, default=1)
    purchase_id: Mapped[int | None] = mapped_column(Integer)
    ref_purchase_no: Mapped[str | None] = mapped_column(String(30))
    return_date: Mapped[date | None] = mapped_column(Date)
    is_interstate: Mapped[bool] = mapped_column(Boolean, default=False)
    total_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    taxable_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    cgst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    sgst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    igst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    total_gst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    adjusted_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    reason: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="confirmed")
    vendor_ack: Mapped[bool] = mapped_column(Boolean, default=False)
    vendor_ack_at: Mapped[datetime | None] = mapped_column(DateTime)
    vendor_remarks: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class unit_wise_purchase_return_item(base):
    __tablename__ = "unit_wise_purchase_return_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    prn_id: Mapped[int] = mapped_column(Integer, ForeignKey("unit_wise_purchase_returns.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int | None] = mapped_column(Integer)
    item_code: Mapped[str | None] = mapped_column(String(50))
    name: Mapped[str | None] = mapped_column(String(200))
    hsn_code: Mapped[str | None] = mapped_column(String(20))
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    unit: Mapped[str | None] = mapped_column(String(20), default="PCS")
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    basic_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    taxable_amt: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    gst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    cgst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    sgst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    igst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    cgst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    sgst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    igst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    gst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    batch_no: Mapped[str | None] = mapped_column(String(100))
    batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="SET NULL"))
    expiry_date: Mapped[date | None] = mapped_column(Date)


class unit_wise_stock_transfer(base):
    __tablename__ = "unit_wise_stock_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transfer_no: Mapped[str] = mapped_column(String(50), nullable=False)
    from_outlet_id: Mapped[int] = mapped_column(Integer, default=1)
    to_outlet_id: Mapped[int] = mapped_column(Integer, default=1)
    transfer_date: Mapped[date | None] = mapped_column(Date)
    type: Mapped[str] = mapped_column(String(10), default="OUT")
    status: Mapped[str] = mapped_column(String(20), default="completed")
    remarks: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    received_at: Mapped[datetime | None] = mapped_column(DateTime)
    received_by: Mapped[int | None] = mapped_column(Integer)

    # Manufacturing & movement type extensions
    movement_type: Mapped[str] = mapped_column(String(50), default="OUT")
    mfg_order_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mfg_order_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)


class unit_wise_stock_transfer_item(base):
    __tablename__ = "unit_wise_stock_transfer_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transfer_id: Mapped[int] = mapped_column(Integer, ForeignKey("unit_wise_stock_transfers.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    unit: Mapped[str] = mapped_column(String(10), default="PCS")
    cost_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    mrp: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    total_val: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    received_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    batch_no: Mapped[str | None] = mapped_column(String(100))
    batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="SET NULL"))
    mfg_date: Mapped[date | None] = mapped_column(Date)
    expiry_date: Mapped[date | None] = mapped_column(Date)


class outlet_stock(base):
    __tablename__ = "outlet_stock"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outlet_id: Mapped[int] = mapped_column(Integer, nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    stock_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


class sync_log(base):
    __tablename__ = "sync_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outlet_id: Mapped[int] = mapped_column(Integer, nullable=False)
    sync_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="success")
    message: Mapped[str | None] = mapped_column(Text)
    records_synced: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
