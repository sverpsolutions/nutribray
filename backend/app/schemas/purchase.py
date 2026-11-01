from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, field_validator


# ── PO ITEM SCHEMAS ──────────────────────────────────────────────────────────
class po_item_in(BaseModel):
    product_id: int
    order_qty: Decimal
    rate: Decimal
    gst_percent: Decimal = Decimal("0")
    mrp: Decimal = Decimal("0")
    markdown_percent: Decimal = Decimal("0")
    # Intelligence snapshot (sent from frontend)
    warehouse_stock: Decimal = Decimal("0")
    outlet_stock: Decimal = Decimal("0")
    doh_value: Decimal = Decimal("0")
    sale_7d: Decimal = Decimal("0")
    sale_30d: Decimal = Decimal("0")
    avg_daily_sale: Decimal = Decimal("0")
    suggested_qty: Decimal = Decimal("0")


class po_item_out(BaseModel):
    id: int
    product_id: int
    product_name: str | None = None
    item_code: str | None = None
    base_unit: str | None = None
    order_qty: Decimal
    qty: Decimal
    rate: Decimal
    gst_percent: Decimal
    total: Decimal
    amount: Decimal
    received_qty: Decimal
    warehouse_stock: Decimal
    outlet_stock: Decimal
    doh_value: Decimal
    sale_7d: Decimal
    sale_30d: Decimal
    avg_daily_sale: Decimal
    suggested_qty: Decimal
    mrp: Decimal
    markdown_percent: Decimal

    class Config:
        from_attributes = True


# ── PO TERMS SCHEMAS ─────────────────────────────────────────────────────────
class po_term_in(BaseModel):
    term_type: str = "DYNAMIC"
    title: str
    description: str | None = None
    sequence_no: int = 0


class po_term_out(BaseModel):
    id: int
    term_type: str
    title: str
    description: str | None = None
    sequence_no: int

    class Config:
        from_attributes = True


# ── PO AUDIT ─────────────────────────────────────────────────────────────────
class po_audit_out(BaseModel):
    id: int
    action: str
    description: str | None = None
    old_status: str | None = None
    new_status: str | None = None
    created_by: int | None = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── PO HEADER SCHEMAS ─────────────────────────────────────────────────────────
class po_create(BaseModel):
    po_no: str
    supplier_id: int
    outlet_id: int | None = None
    po_date: date
    expected_date: date | None = None
    delivery_days: int = 7
    total_amount: Decimal = Decimal("0")
    notes: str | None = None
    terms: str | None = None
    markdown_enabled: bool = False
    status: str = "draft"
    items: list[po_item_in] = []
    fixed_terms: list[po_term_in] = []
    dynamic_terms: list[po_term_in] = []


class multi_po_item_in(po_item_in):
    distributions: dict[int, Decimal] = {}

class multi_po_create(po_create):
    items: list[multi_po_item_in] = []


class vendor_invoice_in(BaseModel):
    vendor_invoice_no: str
    vendor_invoice_date: date
    vendor_invoice_file: str | None = None


class po_update(BaseModel):
    supplier_id: int | None = None
    outlet_id: int | None = None
    expected_date: date | None = None
    delivery_days: int | None = None
    total_amount: Decimal | None = None
    notes: str | None = None
    terms: str | None = None
    markdown_enabled: bool | None = None
    items: list[po_item_in] | None = None
    fixed_terms: list[po_term_in] | None = None
    dynamic_terms: list[po_term_in] | None = None


class po_approve_in(BaseModel):
    status: str
    remarks: str | None = None


class po_list_out(BaseModel):
    id: int
    po_no: str
    supplier_id: int
    supplier_name: str | None = None
    outlet_id: int | None = None
    outlet_name: str | None = None
    po_date: date
    expected_date: date | None = None
    delivery_days: int | None = None
    total_amount: Decimal
    status: str
    approval_status: str
    markdown_enabled: bool | None = None
    is_master: bool = False
    parent_po_id: int | None = None
    vendor_invoice_no: str | None = None
    vendor_invoice_date: date | None = None
    vendor_invoice_file: str | None = None
    created_at: datetime
    item_count: int | None = None

    class Config:
        from_attributes = True


class po_detail_out(BaseModel):
    id: int
    po_no: str
    supplier_id: int
    supplier_name: str | None = None
    outlet_id: int | None = None
    outlet_name: str | None = None
    po_date: date
    expected_date: date | None = None
    delivery_days: int | None = None
    total_amount: Decimal
    status: str
    approval_status: str
    approved_by: int | None = None
    approved_at: datetime | None = None
    approval_remarks: str | None = None
    reject_reason: str | None = None
    markdown_enabled: bool | None = None
    terms: str | None = None
    notes: str | None = None
    is_master: bool = False
    parent_po_id: int | None = None
    vendor_invoice_no: str | None = None
    vendor_invoice_date: date | None = None
    vendor_invoice_file: str | None = None
    created_by: int | None = None
    created_at: datetime
    items: list[po_item_out] = []
    terms_conditions: list[po_term_out] = []
    audit_logs: list[po_audit_out] = []
    distributions: list['distribution_hdr_out'] = []

    class Config:
        from_attributes = True


# ── ITEM INTELLIGENCE (for PO grid) ─────────────────────────────────────────
class item_intel_out(BaseModel):
    product_id: int
    soh: Decimal                # Stock on hand (total warehouse)
    outlet_stock: Decimal
    doh: float | None           # Days on hand (None if no sales)
    sale_7d: Decimal
    sale_30d: Decimal
    avg_daily_sale: Decimal
    last_rate: Decimal
    suggested_qty: Decimal
    last_purchases: list[dict] = []


# ── DOH POPUP ────────────────────────────────────────────────────────────────
class doh_outlet_row(BaseModel):
    outlet_name: str
    current_qty: float
    avg_sale: float
    doh: float | None


# ── DISTRIBUTION SCHEMAS ──────────────────────────────────────────────────────
class distribution_item_in(BaseModel):
    po_item_id: int
    product_id: int
    allocated_qty: Decimal


class distribution_outlet_in(BaseModel):
    outlet_id: int
    items: list[distribution_item_in]
    remarks: str | None = None


class distribution_save_in(BaseModel):
    outlets: list[distribution_outlet_in]


class distribution_dtl_out(BaseModel):
    po_item_id: int
    product_id: int
    allocated_qty: Decimal
    received_qty: Decimal
    pending_qty: Decimal

    class Config:
        from_attributes = True


class distribution_hdr_out(BaseModel):
    id: int
    outlet_id: int
    outlet_name: str | None = None
    status: str
    transfer_status: str
    remarks: str | None = None
    child_po_id: int | None = None
    details: list[distribution_dtl_out] = []

    class Config:
        from_attributes = True


# ── SUPPLIER PO TERMS ─────────────────────────────────────────────────────────
class supplier_po_terms_in(BaseModel):
    payment_terms: str | None = None
    delivery_terms: str | None = None
    transport_terms: str | None = None
    tax_terms: str | None = None
    replacement_policy: str | None = None
    default_po_terms: str | None = None
    remarks: str | None = None


class supplier_po_terms_out(BaseModel):
    id: int
    supplier_id: int
    payment_terms: str | None = None
    delivery_terms: str | None = None
    transport_terms: str | None = None
    tax_terms: str | None = None
    replacement_policy: str | None = None
    default_po_terms: str | None = None
    remarks: str | None = None

    class Config:
        from_attributes = True


# ── PURCHASE (GRN) SCHEMAS ────────────────────────────────────────────────────
class purchase_item_in(BaseModel):
    product_id: int
    item_code: str | None = None
    qty: Decimal = Decimal("1")
    free_qty: Decimal = Decimal("0")
    pcs: Decimal = Decimal("0")
    unit: str = "PCS"
    price: Decimal
    disc_val: Decimal = Decimal("0")
    disc_type: str = "₹"
    gst_percent: Decimal = Decimal("0")
    hsn_code: str | None = None
    mrp: Decimal | None = None
    selling_price: Decimal | None = None
    batch_no: str | None = None
    supplier_batch_no: str | None = None
    mfg_date: date | None = None
    expiry_date: date | None = None
    po_item_id: int | None = None


class purchase_create(BaseModel):
    outlet_id: int | None = None
    supplier_id: int
    invoice_no: str
    invoice_date: date
    discount: Decimal = Decimal("0")
    round_off: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    payment_mode: str = "credit"
    notes: str | None = None
    action: str = "update"  # draft | update
    po_id: int | None = None  # GRN against PO
    items: list[purchase_item_in]

    @field_validator("invoice_no")
    @classmethod
    def validate_invoice_no(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Vendor invoice number is mandatory. Blank invoice numbers are not allowed.")
        return v.strip()



class purchase_item_out(BaseModel):
    id: int
    product_id: int
    product_name: str | None = None
    item_code: str | None = None
    qty: Decimal
    pcs: Decimal
    unit: str
    price: Decimal
    disc_val: Decimal
    taxable_amt: Decimal
    gst_percent: Decimal
    gst_amount: Decimal
    total: Decimal
    hsn_code: str | None = None
    batch_no: str | None = None
    batch_id: int | None = None
    mfg_date: date | None = None
    expiry_date: date | None = None

    class Config:
        from_attributes = True


class purchase_list_out(BaseModel):
    id: int
    purchase_no: str
    supplier_id: int
    supplier_name: str | None = None
    invoice_no: str | None = None
    invoice_date: date
    subtotal: Decimal
    total_gst: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    due_amount: Decimal
    payment_mode: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class purchase_detail_out(BaseModel):
    id: int
    purchase_no: str
    supplier_id: int
    supplier_name: str | None = None
    invoice_no: str | None = None
    invoice_date: date
    subtotal: Decimal
    discount: Decimal
    taxable_amount: Decimal
    total_gst: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    due_amount: Decimal
    payment_mode: str
    notes: str | None = None
    status: str
    created_at: datetime
    items: list[purchase_item_out] = []

    class Config:
        from_attributes = True
