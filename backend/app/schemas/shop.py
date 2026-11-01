from pydantic import BaseModel
from decimal import Decimal
from datetime import datetime, date
from typing import List, Optional

# ── Shop Customer ─────────────────────────────────────────────────────────────

class ShopCustomerCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: str = "Delhi"
    pincode: Optional[str] = None

class ShopCustomerOut(BaseModel):
    id: int
    name: str
    phone: str
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: str
    pincode: Optional[str] = None
    status: bool
    created_at: datetime
    class Config:
        from_attributes = True

class ShopOrderItemCreate(BaseModel):
    product_id: int
    name: str
    qty: Decimal
    unit: str | None = None
    rate: Decimal
    total: Decimal

class ShopOrderCreate(BaseModel):
    customer_id: int | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None
    subtotal: Decimal
    discount: Decimal = Decimal("0.00")
    tax_amount: Decimal = Decimal("0.00")
    delivery_fee: Decimal = Decimal("0.00")
    total_amount: Decimal
    payment_mode: str = "cod"
    delivery_address: str | None = None
    notes: str | None = None
    items: List[ShopOrderItemCreate]

class ShopOrderOut(BaseModel):
    id: int
    order_no: str
    order_date: date
    order_datetime: datetime
    customer_id: int | None = None
    subtotal: Decimal
    discount: Decimal = Decimal("0.00")
    delivery_fee: Decimal = Decimal("0.00")
    total_amount: Decimal
    payment_mode: str
    payment_status: str
    order_status: str
    delivery_address: str | None = None
    notes: str | None = None
    class Config:
        from_attributes = True

class ShopOrderItemOut(BaseModel):
    id: int
    product_id: int
    name: str
    qty: Decimal
    unit: str | None = None
    rate: Decimal
    total: Decimal
    class Config:
        from_attributes = True

class ShopOrderDetailOut(BaseModel):
    id: int
    order_no: str
    order_date: date
    order_datetime: datetime
    customer_id: int | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    subtotal: Decimal
    discount: Decimal
    delivery_fee: Decimal
    total_amount: Decimal
    payment_mode: str
    payment_status: str
    order_status: str
    delivery_address: str | None = None
    notes: str | None = None
    items: List[ShopOrderItemOut] = []
    class Config:
        from_attributes = True

class ShopDashboardStats(BaseModel):
    total_sales: Decimal = Decimal("0")
    total_orders: int = 0
    total_customers: int = 0
    avg_order_value: Decimal = Decimal("0")
    pending_orders: int = 0
    delivered_orders: int = 0

class ShopSalesReport(BaseModel):
    date: date
    order_count: int
    total_sales: Decimal

class ShopTopProduct(BaseModel):
    product_id: int
    name: str
    total_qty: Decimal
    total_sales: Decimal

class ShopBannerBase(BaseModel):
    title: str | None = None
    image: str
    link: str | None = None
    status: bool = True
    sort_order: int = 0

class ShopBannerCreate(ShopBannerBase):
    pass

class ShopBannerOut(ShopBannerBase):
    id: int
    created_at: datetime
    class Config:
        from_attributes = True

class ProductImageSetupRequest(BaseModel):
    dry_run: bool = False
