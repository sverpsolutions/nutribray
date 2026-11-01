from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base


# ── PO HEADER ───────────────────────────────────────────────────────────────
class po_header(base):
    __tablename__ = "po_headers"

    id: Mapped[int]             = mapped_column(Integer, primary_key=True)
    po_no: Mapped[str]          = mapped_column(String(30), unique=True, nullable=False)
    supplier_id: Mapped[int]    = mapped_column(Integer, ForeignKey("suppliers.id"), nullable=False)
    outlet_id: Mapped[int | None]  = mapped_column(Integer, nullable=True)
    po_date: Mapped[date]       = mapped_column(Date, nullable=False)
    expected_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivery_days: Mapped[int]  = mapped_column(Integer, default=7)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    status: Mapped[str]         = mapped_column(String(20), default="draft")
    approval_status: Mapped[str] = mapped_column(String(30), default="draft")
    approved_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approval_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    reject_reason: Mapped[str | None]   = mapped_column(Text, nullable=True)
    markdown_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_master: Mapped[bool]        = mapped_column(Boolean, default=False)
    parent_po_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("po_headers.id"), nullable=True)
    vendor_invoice_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    vendor_invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    vendor_invoice_file: Mapped[str | None] = mapped_column(Text, nullable=True)
    vendor_ack: Mapped[bool] = mapped_column(Boolean, default=False)
    vendor_ack_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    vendor_expected_delivery: Mapped[date | None] = mapped_column(Date, nullable=True)
    vendor_delivery_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    terms: Mapped[str | None]   = mapped_column(Text, nullable=True)
    notes: Mapped[str | None]   = mapped_column(Text, nullable=True)
    created_by: Mapped[int]     = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Manufacturing Linkage
    mfg_order_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mfg_order_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    material_type: Mapped[str] = mapped_column(String(30), default="GENERAL")

    items: Mapped[list["po_item"]] = relationship(
        "po_item", back_populates="po_rel", cascade="all, delete-orphan"
    )
    terms_conditions: Mapped[list["po_terms_condition"]] = relationship(
        "po_terms_condition", back_populates="po_rel", cascade="all, delete-orphan",
        order_by="po_terms_condition.term_type, po_terms_condition.sequence_no"
    )
    distributions: Mapped[list["po_distribution_hdr"]] = relationship(
        "po_distribution_hdr", back_populates="po_rel", cascade="all, delete-orphan"
    )
    audit_logs: Mapped[list["po_audit_log"]] = relationship(
        "po_audit_log", back_populates="po_rel", cascade="all, delete-orphan",
        order_by="po_audit_log.created_at"
    )


# ── PO ITEM ──────────────────────────────────────────────────────────────────
class po_item(base):
    __tablename__ = "po_items"

    id: Mapped[int]            = mapped_column(Integer, primary_key=True)
    po_id: Mapped[int]         = mapped_column(Integer, ForeignKey("po_headers.id"), nullable=False)
    product_id: Mapped[int]    = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    qty: Mapped[Decimal]       = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    order_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    rate: Mapped[Decimal]      = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    gst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    total: Mapped[Decimal]     = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    amount: Mapped[Decimal]    = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    received_qty: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    # Intelligence snapshot
    warehouse_stock: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    outlet_stock: Mapped[Decimal]    = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    doh_value: Mapped[Decimal]       = mapped_column(Numeric(8, 2), default=Decimal("0.00"))
    sale_7d: Mapped[Decimal]         = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    sale_30d: Mapped[Decimal]        = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    avg_daily_sale: Mapped[Decimal]  = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    suggested_qty: Mapped[Decimal]   = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    mrp: Mapped[Decimal]             = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    markdown_percent: Mapped[Decimal]= mapped_column(Numeric(5, 2), default=Decimal("0.00"))

    po_rel: Mapped["po_header"] = relationship("po_header", back_populates="items")
    dist_items: Mapped[list["po_distribution_dtl"]] = relationship(
        "po_distribution_dtl", back_populates="po_item_rel", cascade="all, delete-orphan"
    )


# ── PO TERMS CONDITIONS ───────────────────────────────────────────────────────
class po_terms_condition(base):
    __tablename__ = "po_terms_conditions"

    id: Mapped[int]          = mapped_column(Integer, primary_key=True)
    po_id: Mapped[int]       = mapped_column(Integer, ForeignKey("po_headers.id"), nullable=False)
    term_type: Mapped[str]   = mapped_column(String(10), default="DYNAMIC")
    title: Mapped[str]       = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sequence_no: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime]   = mapped_column(DateTime, server_default=func.now())

    po_rel: Mapped["po_header"] = relationship("po_header", back_populates="terms_conditions")


# ── PO DISTRIBUTION ───────────────────────────────────────────────────────────
class po_distribution_hdr(base):
    __tablename__ = "po_distribution_hdr"

    id: Mapped[int]              = mapped_column(Integer, primary_key=True)
    po_id: Mapped[int]           = mapped_column(Integer, ForeignKey("po_headers.id"), nullable=False)
    outlet_id: Mapped[int]       = mapped_column(Integer, nullable=False)
    status: Mapped[str]          = mapped_column(String(20), default="pending")
    transfer_status: Mapped[str] = mapped_column(String(20), default="pending")
    remarks: Mapped[str | None]  = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    po_rel: Mapped["po_header"] = relationship("po_header", back_populates="distributions")
    details: Mapped[list["po_distribution_dtl"]] = relationship(
        "po_distribution_dtl", back_populates="dist_hdr_rel", cascade="all, delete-orphan"
    )


class po_distribution_dtl(base):
    __tablename__ = "po_distribution_dtl"

    id: Mapped[int]              = mapped_column(Integer, primary_key=True)
    distribution_id: Mapped[int] = mapped_column(Integer, ForeignKey("po_distribution_hdr.id"), nullable=False)
    po_item_id: Mapped[int]      = mapped_column(Integer, ForeignKey("po_items.id"), nullable=False)
    product_id: Mapped[int]      = mapped_column(Integer, nullable=False)
    allocated_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    received_qty: Mapped[Decimal]  = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    pending_qty: Mapped[Decimal]   = mapped_column(Numeric(12, 3), default=Decimal("0.000"))

    dist_hdr_rel: Mapped["po_distribution_hdr"] = relationship("po_distribution_hdr", back_populates="details")
    po_item_rel: Mapped["po_item"]               = relationship("po_item", back_populates="dist_items")


# ── PO AUDIT LOG ──────────────────────────────────────────────────────────────
class po_audit_log(base):
    __tablename__ = "po_audit_log"

    id: Mapped[int]           = mapped_column(Integer, primary_key=True)
    po_id: Mapped[int]        = mapped_column(Integer, ForeignKey("po_headers.id"), nullable=False)
    action: Mapped[str]       = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    old_status: Mapped[str | None]  = mapped_column(String(50), nullable=True)
    new_status: Mapped[str | None]  = mapped_column(String(50), nullable=True)
    created_by: Mapped[int | None]  = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime]    = mapped_column(DateTime, server_default=func.now())

    po_rel: Mapped["po_header"] = relationship("po_header", back_populates="audit_logs")


# ── SUPPLIER PO TERMS ─────────────────────────────────────────────────────────
class supplier_po_terms(base):
    __tablename__ = "supplier_po_terms"

    id: Mapped[int]             = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int]    = mapped_column(Integer, ForeignKey("suppliers.id"), unique=True, nullable=False)
    payment_terms: Mapped[str | None]      = mapped_column(Text, nullable=True)
    delivery_terms: Mapped[str | None]     = mapped_column(Text, nullable=True)
    transport_terms: Mapped[str | None]    = mapped_column(Text, nullable=True)
    tax_terms: Mapped[str | None]          = mapped_column(Text, nullable=True)
    replacement_policy: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_po_terms: Mapped[str | None]   = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None]            = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── UNIT WISE PURCHASE (GRN) ──────────────────────────────────────────────────
class purchase(base):
    __tablename__ = "unit_wise_purchases"

    id: Mapped[int]              = mapped_column(Integer, primary_key=True)
    outlet_id: Mapped[int | None]= mapped_column(Integer, nullable=True)
    purchase_no: Mapped[str]     = mapped_column(String(30), unique=True, nullable=False)
    supplier_id: Mapped[int]     = mapped_column(Integer, ForeignKey("suppliers.id"), nullable=False)
    invoice_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    invoice_date: Mapped[date]   = mapped_column(Date, nullable=False)
    total_qty: Mapped[Decimal]   = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    subtotal: Mapped[Decimal]    = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    discount: Mapped[Decimal]    = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    taxable_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    total_gst: Mapped[Decimal]   = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    total_amount: Mapped[Decimal]= mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    due_amount: Mapped[Decimal]  = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    payment_mode: Mapped[str]    = mapped_column(String(20), default="credit")
    notes: Mapped[str | None]    = mapped_column(Text, nullable=True)
    status: Mapped[str]          = mapped_column(String(20), default="partial")
    round_off: Mapped[Decimal]   = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    po_id: Mapped[int | None]    = mapped_column(Integer, ForeignKey("po_headers.id"), nullable=True)
    created_by: Mapped[int]      = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Manufacturing & QC fields
    material_type: Mapped[str]   = mapped_column(String(30), default="GENERAL")
    qc_status: Mapped[str]       = mapped_column(String(30), default="PENDING")
    qc_inspection_no: Mapped[str | None] = mapped_column(String(50), nullable=True)

    items: Mapped[list["purchase_item"]] = relationship(
        "purchase_item", back_populates="purchase_rel", cascade="all, delete-orphan"
    )


class purchase_item(base):
    __tablename__ = "unit_wise_purchase_items"

    id: Mapped[int]           = mapped_column(Integer, primary_key=True)
    purchase_id: Mapped[int]  = mapped_column(Integer, ForeignKey("unit_wise_purchases.id"), nullable=False)
    product_id: Mapped[int]   = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    qty: Mapped[Decimal]      = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    free_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    pcs: Mapped[Decimal]      = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    unit: Mapped[str]         = mapped_column(String(20), default="PCS")
    price: Mapped[Decimal]    = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    disc_val: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    disc_type: Mapped[str]    = mapped_column(String(5), default="₹")
    basic_amt: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    basic_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=True)
    discount_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=True)
    discount_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=True)
    taxable_amt: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    taxable_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=True)
    gst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    gst_amount: Mapped[Decimal]  = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    total: Mapped[Decimal]       = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    hsn_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    challan_item_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    po_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("po_items.id", ondelete="SET NULL"), nullable=True)
    batch_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    batch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_batches.id", ondelete="SET NULL"), nullable=True)
    mfg_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Manufacturing & QC Line Item extensions
    qc_status: Mapped[str]       = mapped_column(String(30), default="PENDING")
    accepted_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    rejected_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    quarantined_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0.000"))
    supplier_lot_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    coa_attachment: Mapped[str | None] = mapped_column(String(255), nullable=True)
    inspection_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    warehouse_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rack_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    purchase_rel: Mapped["purchase"] = relationship("purchase", back_populates="items")
