from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


# ─── Invoice Item ────────────────────────────────────────────────────────────

class invoice_item_in(BaseModel):
    product_id: int
    item_code: Optional[str] = None
    name: Optional[str] = None
    qty: Decimal = Decimal("1.000")
    pcs: Decimal = Decimal("0.000")
    unit: str = "PCS"
    rate: Decimal = Decimal("0.00")
    disc_val: Decimal = Decimal("0.00")
    disc_type: str = "₹"          # ₹ or %
    gst_percent: Decimal = Decimal("0.00")
    hsn_code: Optional[str] = None
    challan_item_id: Optional[int] = None
    batch_no: Optional[str] = None
    batch_id: Optional[int] = None
    expiry_date: Optional[date] = None


class invoice_item_out(BaseModel):
    id: int
    invoice_id: int
    product_id: int
    item_code: Optional[str]
    name: Optional[str]
    qty: Decimal
    pcs: Decimal
    unit: str
    rate: Decimal
    disc_val: Decimal
    disc_type: str
    taxable_amt: Decimal
    gst_percent: Decimal
    cgst_percent: Decimal
    sgst_percent: Decimal
    igst_percent: Decimal
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    total: Decimal
    hsn_code: Optional[str]
    challan_item_id: Optional[int]
    batch_no: Optional[str] = None
    batch_id: Optional[int] = None
    expiry_date: Optional[date] = None

    model_config = {"from_attributes": True}


# ─── Invoice Payment ─────────────────────────────────────────────────────────

class payment_in(BaseModel):
    amount: Decimal
    payment_date: date
    payment_mode: str = "cash"
    reference_no: Optional[str] = None
    notes: Optional[str] = None


class payment_out(BaseModel):
    id: int
    payment_no: str
    outlet_id: Optional[int]
    customer_id: int
    invoice_id: Optional[int]
    amount: Decimal
    payment_date: date
    payment_mode: str
    reference_no: Optional[str]
    notes: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Invoice Create / Update ─────────────────────────────────────────────────

class split_payment_in(BaseModel):
    payment_mode: str = Field(min_length=1, max_length=20)   # any active mode of the Payment Mode Master (checked in billing)
    amount: Decimal = Field(gt=0)


class invoice_create(BaseModel):
    outlet_id: Optional[int] = None
    customer_id: int
    invoice_type: str = "retail"
    invoice_date: date
    invoice_datetime: Optional[datetime] = None
    payment_mode: str = "cash"
    is_interstate: bool = False
    cd_percent: Decimal = Decimal("0.00")
    notes: Optional[str] = None
    items: list[invoice_item_in]
    # optional advance payment at time of invoice save
    paid_amount: Decimal = Decimal("0.00")
    round_off: bool = False  # round grand total to nearest rupee
    # split payment: when given, replaces payment_mode/paid_amount (one payment row per entry)
    payments: list[split_payment_in] = []
    # POS: run the scheme engine server-side and add its discounts / free lines (client never sends them)
    apply_schemes: bool = False
    # request number of an approved High Discount request, when the bill's discount is above the approval limit
    discount_approval_no: Optional[str] = None


class invoice_update(BaseModel):
    invoice_date: Optional[date] = None
    payment_mode: Optional[str] = None
    cd_percent: Optional[Decimal] = None
    notes: Optional[str] = None
    is_interstate: Optional[bool] = None
    items: Optional[list[invoice_item_in]] = None


# ─── Invoice Out ─────────────────────────────────────────────────────────────

class invoice_out(BaseModel):
    id: int
    outlet_id: Optional[int]
    invoice_no: str
    customer_id: int
    invoice_type: str
    invoice_date: date
    invoice_datetime: Optional[datetime]
    subtotal: Decimal
    discount: Decimal
    taxable_amount: Decimal
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    total_gst: Decimal
    cd_percent: Decimal
    cd_amount: Decimal
    round_off: Decimal = Decimal("0")
    total_amount: Decimal
    paid_amount: Decimal
    due_amount: Decimal
    payment_mode: str
    is_interstate: bool
    notes: Optional[str]
    status: str
    created_by: Optional[int]
    created_at: datetime
    updated_at: datetime
    items: list[invoice_item_out] = []
    payments: list[payment_out] = []

    model_config = {"from_attributes": True}


class invoice_list_out(BaseModel):
    id: int
    invoice_no: str
    customer_id: int
    invoice_date: date
    total_amount: Decimal
    paid_amount: Decimal
    due_amount: Decimal
    payment_mode: str
    status: str
    created_at: datetime
    outlet_id: Optional[int] = None
    outlet_name: Optional[str] = None
    split: list[split_payment_in] = []  # per-mode amounts, only for payment_mode == "split"

    model_config = {"from_attributes": True}


# ─── Estimate Item ────────────────────────────────────────────────────────────

class estimate_item_in(BaseModel):
    product_id: Optional[int] = None
    item_code: Optional[str] = None
    description: Optional[str] = None
    qty: Decimal = Decimal("1.000")
    unit: str = "PCS"
    rate: Decimal = Decimal("0.00")
    discount: Decimal = Decimal("0.00")
    tax_percent: Decimal = Decimal("0.00")
    cost_price: Decimal = Decimal("0.00")


class estimate_item_out(BaseModel):
    id: int
    estimate_id: int
    product_id: Optional[int]
    item_code: Optional[str]
    description: Optional[str]
    qty: Decimal
    unit: str
    rate: Decimal
    discount: Decimal
    tax_percent: Decimal
    tax_amount: Decimal
    total: Decimal
    cost_price: Decimal

    model_config = {"from_attributes": True}


# ─── Estimate Create / Update ─────────────────────────────────────────────────

class estimate_create(BaseModel):
    customer_id: int
    customer_name: str
    customer_mobile: Optional[str] = None
    estimate_date: date
    valid_until: Optional[date] = None
    notes: Optional[str] = None
    items: list[estimate_item_in]


class estimate_update(BaseModel):
    estimate_date: Optional[date] = None
    valid_until: Optional[date] = None
    notes: Optional[str] = None
    items: Optional[list[estimate_item_in]] = None


# ─── Estimate Out ─────────────────────────────────────────────────────────────

class estimate_out(BaseModel):
    id: int
    estimate_no: str
    customer_id: int
    customer_name: str
    customer_mobile: Optional[str]
    estimate_date: date
    valid_until: Optional[date]
    subtotal: Decimal
    total_discount: Decimal
    total_tax: Decimal
    total_amount: Decimal
    notes: Optional[str]
    status: str
    converted_to: Optional[int]
    created_at: datetime
    updated_at: datetime
    items: list[estimate_item_out] = []

    model_config = {"from_attributes": True}


class estimate_list_out(BaseModel):
    id: int
    estimate_no: str
    customer_id: int
    customer_name: str
    estimate_date: date
    valid_until: Optional[date]
    total_amount: Decimal
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Delete Request ───────────────────────────────────────────────────────────

class delete_request_create(BaseModel):
    module: str
    record_id: int
    record_no: str
    reason: str


class delete_request_out(BaseModel):
    id: int
    module: Optional[str]
    record_id: Optional[int]
    record_no: Optional[str]
    reason: Optional[str]
    requested_by: Optional[int]
    status: str
    approved_by: Optional[int]
    approved_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}
