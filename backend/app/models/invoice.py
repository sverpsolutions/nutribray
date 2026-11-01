from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base


class invoice(base):
    __tablename__ = "unit_wise_invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outlet_id: Mapped[int | None] = mapped_column(Integer)
    invoice_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("customers.id"), nullable=False)
    invoice_type: Mapped[str] = mapped_column(String(20), default="retail")
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    invoice_datetime: Mapped[datetime | None] = mapped_column(DateTime)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    taxable_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    cgst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    sgst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    igst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    total_gst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    cd_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    cd_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    round_off: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    due_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    payment_mode: Mapped[str] = mapped_column(String(20), default="cash")
    is_interstate: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="unpaid")
    # Sales return / credit note (invoice_type='return' created at HO)
    ref_invoice_no: Mapped[str | None] = mapped_column(String(30))
    return_reason: Mapped[str | None] = mapped_column(String(255))
    refund_method: Mapped[str | None] = mapped_column(String(20))  # cash | adjust
    adjusted_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    shift_id: Mapped[int | None] = mapped_column(Integer)  # cashier shift the bill was made in
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    items: Mapped[list["invoice_item"]] = relationship(
        "invoice_item", back_populates="invoice_rel", cascade="all, delete-orphan"
    )
    payments: Mapped[list["invoice_payment"]] = relationship(
        "invoice_payment", back_populates="invoice_rel"
    )
    edit_logs: Mapped[list["invoice_edit_log"]] = relationship(
        "invoice_edit_log", back_populates="invoice_rel"
    )


class invoice_item(base):
    __tablename__ = "unit_wise_invoice_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(Integer, ForeignKey("unit_wise_invoices.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(50))
    name: Mapped[str | None] = mapped_column(String(150))
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=1.000)
    pcs: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0.000)
    unit: Mapped[str] = mapped_column(String(10), default="PCS")
    rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    disc_val: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    disc_type: Mapped[str] = mapped_column(String(5), default="₹")
    taxable_amt: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    gst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    cgst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    sgst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    igst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    cgst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    sgst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    igst_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    hsn_code: Mapped[str | None] = mapped_column(String(20))
    challan_item_id: Mapped[int | None] = mapped_column(Integer)
    batch_no: Mapped[str | None] = mapped_column(String(100))
    batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="SET NULL"))
    expiry_date: Mapped[date | None] = mapped_column(Date)

    invoice_rel: Mapped["invoice"] = relationship("invoice", back_populates="items")


class invoice_payment(base):
    __tablename__ = "unit_wise_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payment_no: Mapped[str] = mapped_column(String(30), nullable=False)
    outlet_id: Mapped[int | None] = mapped_column(Integer)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("customers.id"), nullable=False)
    invoice_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("unit_wise_invoices.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    payment_mode: Mapped[str] = mapped_column(String(20), default="cash")
    reference_no: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    shift_id: Mapped[int | None] = mapped_column(Integer)  # drawer the money went into
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    invoice_rel: Mapped["invoice | None"] = relationship("invoice", back_populates="payments")


class invoice_edit_log(base):
    __tablename__ = "invoice_edit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(Integer, ForeignKey("unit_wise_invoices.id"), nullable=False)
    field_name: Mapped[str | None] = mapped_column(String(50))
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    edited_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    edited_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    invoice_rel: Mapped["invoice"] = relationship("invoice", back_populates="edit_logs")


class stock_ledger(base):
    __tablename__ = "stock_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    txn_type: Mapped[str] = mapped_column(String(30), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    ref_id: Mapped[int | None] = mapped_column(Integer)
    ref_type: Mapped[str | None] = mapped_column(String(30))
    outlet_id: Mapped[int | None] = mapped_column(Integer)
    batch_no: Mapped[str | None] = mapped_column(String(100))
    batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="SET NULL"))
    expiry_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class delete_request(base):
    __tablename__ = "delete_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    module: Mapped[str | None] = mapped_column(String(50))
    record_id: Mapped[int | None] = mapped_column(Integer)
    record_no: Mapped[str | None] = mapped_column(String(50))
    reason: Mapped[str | None] = mapped_column(Text)
    requested_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    approved_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class estimate(base):
    __tablename__ = "estimates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    estimate_no: Mapped[str] = mapped_column(String(30), nullable=False)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("customers.id"), nullable=False)
    customer_name: Mapped[str] = mapped_column(String(100), nullable=False)
    customer_mobile: Mapped[str | None] = mapped_column(String(20))
    estimate_date: Mapped[date] = mapped_column(Date, nullable=False)
    valid_until: Mapped[date | None] = mapped_column(Date)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    total_discount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    total_tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    converted_to: Mapped[int | None] = mapped_column(Integer)
    closed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    items: Mapped[list["estimate_item"]] = relationship(
        "estimate_item", back_populates="estimate_rel", cascade="all, delete-orphan"
    )


class estimate_item(base):
    __tablename__ = "estimate_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    estimate_id: Mapped[int] = mapped_column(Integer, ForeignKey("estimates.id"), nullable=False)
    product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("products.id"))
    item_code: Mapped[str | None] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(String(200))
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=1.000)
    unit: Mapped[str] = mapped_column(String(10), default="PCS")
    rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    discount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    tax_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    cost_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)

    estimate_rel: Mapped["estimate"] = relationship("estimate", back_populates="items")
