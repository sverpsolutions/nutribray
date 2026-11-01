from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel


class RackInfo(BaseModel):
    id: int
    rack_code: str
    aisle_code: Optional[str]
    division_code: Optional[str]
    rack_number: str
    shelf_level: Optional[str]
    bin_code: Optional[str]
    current_qty: Decimal
    capacity: Optional[int]


class PendingGRN(BaseModel):
    id: int
    grn_no: str
    grn_date: datetime
    supplier_name: str
    total_items: int
    status: str


class GRNItem(BaseModel):
    id: int
    product_id: int
    item_code: str
    item_name: str
    qty_total: Decimal
    qty_placed: Decimal
    qty_remaining: Decimal
    barcode: Optional[str]


class PutawayRequest(BaseModel):
    grn_id: int
    rack_code: str
    barcode: str
    qty: Decimal
    device_id: Optional[str]


class RackInventorySchema(BaseModel):
    product_name: str
    item_code: str
    qty: Decimal
    status: str
    batch_no: Optional[str]
    expiry_date: Optional[date]


class WMSDashboardStats(BaseModel):
    total_pending_grn: int
    total_floor_stock: Decimal
    total_rack_stock: Decimal
    today_putaway_qty: Decimal
    rack_utilization_pct: float
