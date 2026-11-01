from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, field_validator
from typing import List, Optional

# --- Item Schemas ---
class logistic_transfer_item_base(BaseModel):
    product_id: int
    quantity: Decimal

class logistic_transfer_item_create(logistic_transfer_item_base):
    pass

class logistic_transfer_item_out(logistic_transfer_item_base):
    id: int
    name: Optional[str] = None
    item_code: Optional[str] = None
    barcode: Optional[str] = None
    hsn_code: Optional[str] = None
    unit: Optional[str] = None
    mrp: Optional[Decimal] = None
    class Config:
        from_attributes = True

# --- Box Schemas ---
class logistic_box_item_base(BaseModel):
    product_id: int
    quantity: Decimal

class logistic_box_item_create(logistic_box_item_base):
    pass

class logistic_box_item_out(logistic_box_item_base):
    id: int
    class Config:
        from_attributes = True

class logistic_box_base(BaseModel):
    box_number: str
    weight_kg: Optional[Decimal] = None
    length_cm: Optional[Decimal] = None
    width_cm: Optional[Decimal] = None
    height_cm: Optional[Decimal] = None
    seal_number: Optional[str] = None
    box_type: Optional[str] = None

    @field_validator('weight_kg', 'length_cm', 'width_cm', 'height_cm', mode='before')
    @classmethod
    def _blank_is_none(cls, v):  # form sends "" for empty number inputs
        return None if v == '' else v

class logistic_box_create(logistic_box_base):
    items: List[logistic_box_item_create] = []

class logistic_box_out(logistic_box_base):
    id: int
    transfer_id: int
    is_printed: bool
    created_at: datetime
    items: List[logistic_box_item_out] = []
    class Config:
        from_attributes = True

# --- Dispatch Schemas ---
class logistic_dispatch_detail_base(BaseModel):
    vehicle_reg_no: Optional[str] = None
    vehicle_type: Optional[str] = None
    gps_tracking_id: Optional[str] = None
    eta: Optional[datetime] = None
    driver_name: Optional[str] = None
    driver_mobile: Optional[str] = None
    driver_license_no: Optional[str] = None
    helper_name: Optional[str] = None

    @field_validator('eta', mode='before')
    @classmethod
    def _blank_eta_is_none(cls, v):  # empty datetime-local input sends ""
        return None if v == '' else v

class logistic_dispatch_detail_update(logistic_dispatch_detail_base):
    pass

class logistic_dispatch_detail_out(logistic_dispatch_detail_base):
    id: int
    dispatched_at: Optional[datetime] = None
    class Config:
        from_attributes = True

# --- Timeline Schemas ---
class logistic_timeline_out(BaseModel):
    id: int
    event: str
    description: Optional[str]
    user_id: Optional[int]
    created_at: datetime
    class Config:
        from_attributes = True

# --- Main Transfer Schemas ---
class logistic_transfer_base(BaseModel):
    source_location_id: int
    destination_location_id: int
    priority: str = "Normal"
    notes: Optional[str] = None
    source_transfer_id: Optional[int] = None

class logistic_transfer_create(logistic_transfer_base):
    items: List[logistic_transfer_item_create] = []

class logistic_transfer_update(BaseModel):
    priority: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None

class logistic_transfer_out(logistic_transfer_base):
    id: int
    transfer_number: str
    transfer_date: datetime
    status: str
    source_transfer_no: Optional[str] = None
    created_by: Optional[int]
    created_at: datetime
    updated_at: datetime
    
    items: List[logistic_transfer_item_out] = []
    boxes: List[logistic_box_out] = []
    dispatch_details: Optional[logistic_dispatch_detail_out] = None
    timeline: List[logistic_timeline_out] = []

    class Config:
        from_attributes = True
