from pydantic import BaseModel
from decimal import Decimal
from datetime import datetime, date
from typing import List, Optional

class MultiTransferItemBase(BaseModel):
    product_id: int
    barcode: Optional[str] = None
    qty_per_branch: Decimal
    batch_id: Optional[int] = None
    batch_no: Optional[str] = None
    mfg_date: Optional[date] = None
    expiry_date: Optional[date] = None

class MultiTransferItemCreate(MultiTransferItemBase):
    pass

class MultiTransferItemOut(MultiTransferItemBase):
    id: int
    session_id: int
    class Config:
        from_attributes = True

class MultiTransferSessionBase(BaseModel):
    from_location_id: int
    remarks: Optional[str] = None

class MultiTransferSessionCreate(MultiTransferSessionBase):
    branch_ids: List[int]
    items: List[MultiTransferItemCreate]

class MultiTransferSessionOut(MultiTransferSessionBase):
    id: int
    status: str
    draft_ref_number: Optional[str] = None
    created_at: datetime
    branch_ids: List[int] = []
    items: List[MultiTransferItemOut] = []
    
    class Config:
        from_attributes = True

class BranchChipInfo(BaseModel):
    id: int
    unit_code: str
    outlet_name: str
    city: Optional[str] = None
    state: Optional[str] = None
    is_active: bool
