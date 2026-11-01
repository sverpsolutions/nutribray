from pydantic import BaseModel
from datetime import datetime
from typing import Literal, Optional, List

class RegionBase(BaseModel):
    code: str
    name: str
    manager_name: Optional[str] = None
    contact_phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool = True

class RegionCreate(RegionBase):
    pass

class RegionOut(RegionBase):
    id: int
    created_at: Optional[datetime] = None
    total_zones: Optional[int] = 0
    total_stores: Optional[int] = 0

    class Config:
        from_attributes = True

class ZoneBase(BaseModel):
    name: str
    zone_code: Optional[str] = None
    region_id: Optional[int] = None
    manager_name: Optional[str] = None
    contact_phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool = True

class ZoneCreate(ZoneBase):
    pass

class ZoneOut(ZoneBase):
    id: int
    region_name: Optional[str] = None
    total_stores: Optional[int] = 0
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class OutletBase(BaseModel):
    unit_code: str
    outlet_name: str
    display_name: Optional[str] = None
    region_id: Optional[int] = None
    zone_id: Optional[int] = None
    server_name: Optional[str] = None
    database_name: Optional[str] = None
    db_username: Optional[str] = "postgres"
    db_password: Optional[str] = None
    grp_code: Optional[str] = None
    sync_required: bool = False
    sales_sync_required: bool = False
    closing_sync_required: bool = False
    schemes_sync_required: bool = False
    type: str = "O"
    is_active: bool = True
    negative_stock: Literal["company", "block", "allow"] = "company"  # billing below zero: follow company setting / block / allow
    
    # Basic Details
    outlet_code: Optional[str] = None
    short_name: Optional[str] = None
    company_name: Optional[str] = None
    
    # Address Details
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = "India"
    pincode: Optional[str] = None
    address: Optional[str] = None
    landmark: Optional[str] = None
    
    # Contact Details
    manager_name: Optional[str] = None
    manager_mobile: Optional[str] = None
    manager_email: Optional[str] = None
    store_phone: Optional[str] = None
    whatsapp_number: Optional[str] = None
    emergency_contact: Optional[str] = None
    
    # Tax Details
    gst_number: Optional[str] = None
    pan_number: Optional[str] = None
    
    # Location Details
    latitude: Optional[str] = None
    longitude: Optional[str] = None
    map_link: Optional[str] = None
    
    # Operation Details
    store_type: Optional[str] = "Company Operated"
    store_category: Optional[str] = None
    store_size: Optional[str] = None
    opening_date: Optional[datetime] = None
    store_timing: Optional[str] = "24 Hours / 7 Days Open"
    is_delivery_available: bool = False
    is_online_order_available: bool = False
    notes: Optional[str] = None
    
    # Price Update Settings
    price_update_level: Optional[str] = "All Store Level"
    
    # Document Paths
    store_image: Optional[str] = None
    front_image: Optional[str] = None
    gst_certificate: Optional[str] = None
    shop_license: Optional[str] = None
    other_docs: Optional[str] = None

class OutletCreate(OutletBase):
    pass

class OutletOut(OutletBase):
    id: int
    is_connected: bool
    last_connected_at: Optional[datetime] = None
    region_name: Optional[str] = None
    zone_name: Optional[str] = None

    class Config:
        from_attributes = True

class HierarchyStore(BaseModel):
    id: int
    unit_code: str
    outlet_name: str
    display_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    manager_name: Optional[str] = None
    manager_mobile: Optional[str] = None
    store_type: Optional[str] = None
    store_category: Optional[str] = None
    is_active: bool

class HierarchyZone(BaseModel):
    id: int
    zone_code: Optional[str] = None
    name: str
    manager_name: Optional[str] = None
    contact_phone: Optional[str] = None
    is_active: bool
    outlets: List[HierarchyStore] = []

class HierarchyRegion(BaseModel):
    id: int
    code: str
    name: str
    manager_name: Optional[str] = None
    contact_phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool
    zones: List[HierarchyZone] = []

class CompanyHierarchy(BaseModel):
    company_name: str
    legal_name: str
    brand_name: str
    ho_address: Optional[str] = None
    ho_phone: Optional[str] = None
    ho_email: Optional[str] = None
    logo_path: Optional[str] = None
    total_regions: int
    total_zones: int
    total_stores: int
    regions: List[HierarchyRegion] = []
