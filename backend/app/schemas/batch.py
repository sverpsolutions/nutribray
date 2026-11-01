from datetime import date, datetime
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel, Field


class BatchStockOut(BaseModel):
    id: int
    batch_id: int
    product_id: int
    location_id: int
    opening_qty: Decimal
    received_qty: Decimal
    sold_qty: Decimal
    returned_qty: Decimal
    transferred_in_qty: Decimal
    transferred_out_qty: Decimal
    adjusted_qty: Decimal
    current_qty: Decimal
    reserved_qty: Decimal
    updated_at: datetime

    class Config:
        from_attributes = True


class ProductBatchOut(BaseModel):
    id: int
    product_id: int
    product_name: Optional[str] = None
    item_code: Optional[str] = None
    barcode: Optional[str] = None
    category_name: Optional[str] = None
    brand_name: Optional[str] = None
    batch_no: str
    supplier_batch_no: Optional[str] = None
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    supplier_phone: Optional[str] = None
    supplier_contact_name: Optional[str] = None
    supplier_code: Optional[str] = None
    supplier_email: Optional[str] = None
    mfg_date: Optional[date] = None
    exp_date: Optional[date] = None
    first_receipt_date: Optional[date] = None
    purchase_rate: Decimal
    cost_price: Decimal
    mrp: Decimal
    selling_price: Decimal
    status: str
    notes: Optional[str] = None
    total_stock: Decimal = Decimal("0.000")
    location_stocks: List[BatchStockOut] = []
    days_to_expiry: Optional[int] = None
    value_at_risk_cost: Optional[Decimal] = Decimal("0.00")
    value_at_risk_mrp: Optional[Decimal] = Decimal("0.00")
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BatchCreateIn(BaseModel):
    product_id: int
    batch_no: str
    supplier_batch_no: Optional[str] = None
    supplier_id: Optional[int] = None
    mfg_date: Optional[date] = None
    exp_date: Optional[date] = None
    purchase_rate: Optional[Decimal] = Decimal("0.00")
    cost_price: Optional[Decimal] = Decimal("0.00")
    mrp: Optional[Decimal] = Decimal("0.00")
    selling_price: Optional[Decimal] = Decimal("0.00")
    barcode: Optional[str] = None
    notes: Optional[str] = None
    initial_location_id: Optional[int] = 1
    initial_qty: Optional[Decimal] = Decimal("0.000")


class BatchStatusUpdateIn(BaseModel):
    status: str = Field(..., pattern="^(Active|Near Expiry|Expired|Quarantined|Recalled|Closed)$")
    reason: Optional[str] = None


class BatchKPIsOut(BaseModel):
    total_batches: int
    active_batches: int
    near_expiry_5d: int = 0
    near_expiry_15d: int = 0
    near_expiry_7d: int = 0
    near_expiry_30d: int = 0
    near_expiry_60d: int = 0
    near_expiry_90d: int = 0
    expired_batches: int = 0
    quarantined_batches: int = 0
    recalled_batches: int = 0
    total_stock_units: Decimal = Decimal("0.000")
    value_at_risk_cost: Decimal = Decimal("0.00")
    value_at_risk_mrp: Decimal = Decimal("0.00")


class BatchExpiryReportSummary(BaseModel):
    total_records: int
    total_stock_units: Decimal
    total_cost_value: Decimal
    total_mrp_value: Decimal
    expired_count: int
    next_5d_count: int
    next_15d_count: int
    next_30d_count: int


class BatchExpiryReportOut(BaseModel):
    summary: BatchExpiryReportSummary
    data: List[ProductBatchOut]
    total: int
    page: int
    limit: int
