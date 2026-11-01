from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


# ── Zones ─────────────────────────────────────────────────────────────────────

class zone_create(BaseModel):
    zone_name: str
    warehouse_id: int | None = None
    description: str | None = None
    status: bool = True


class zone_out(BaseModel):
    id: int
    zone_name: str
    warehouse_id: int | None = None
    description: str | None = None
    status: bool
    created_at: datetime

    model_config = {"from_attributes": True}



# ── Aisle ─────────────────────────────────────────────────────────────────────

class aisle_create(BaseModel):
    aisle_code: str | None = None
    aisle_name: str
    warehouse_code: str | None = None
    warehouse_zone_id: int | None = None
    status: bool = True


class aisle_update(BaseModel):
    aisle_code: str | None = None
    aisle_name: str | None = None
    warehouse_code: str | None = None
    warehouse_zone_id: int | None = None
    status: bool | None = None


class aisle_out(BaseModel):
    id: int
    aisle_code: str
    aisle_name: str
    warehouse_code: str | None = None
    warehouse_zone_id: int | None = None
    status: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Division ──────────────────────────────────────────────────────────────────

class division_create(BaseModel):
    division_code: str | None = None
    division_name: str
    aisle_id: int
    aisle_code: str
    sequence_no: int = 1
    status: bool = True


class division_update(BaseModel):
    division_code: str | None = None
    division_name: str | None = None
    sequence_no: int | None = None
    status: bool | None = None


class division_out(BaseModel):
    id: int
    division_code: str
    division_name: str
    aisle_id: int | None = None
    aisle_code: str
    sequence_no: int
    status: bool

    model_config = {"from_attributes": True}


# ── Rack ──────────────────────────────────────────────────────────────────────

class rack_create(BaseModel):
    aisle_id: int | None = None
    division_id: int | None = None
    aisle_code: str
    division_code: str
    rack_number: str
    shelf_level: str | None = None
    bin_code: str | None = None
    capacity: int | None = None
    zone_id: int | None = None
    bay_number: str | None = None
    max_weight: Decimal | None = None
    status: bool = True


class rack_update(BaseModel):
    rack_number: str | None = None
    shelf_level: str | None = None
    bin_code: str | None = None
    capacity: int | None = None
    current_qty: Decimal | None = None
    zone_id: int | None = None
    bay_number: str | None = None
    max_weight: Decimal | None = None
    status: bool | None = None


class rack_out(BaseModel):
    id: int
    rack_code: str
    aisle_id: int | None = None
    division_id: int | None = None
    aisle_code: str | None = None
    division_code: str | None = None
    rack_number: str
    shelf_level: str | None = None
    bin_code: str | None = None
    capacity: int | None = None
    current_qty: Decimal
    zone_id: int | None = None
    bay_number: str | None = None
    max_weight: Decimal | None = None
    status: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class rack_qr_out(BaseModel):
    rack_code: str
    qr_text: str


# ── Item Rack Mapping ─────────────────────────────────────────────────────────

class item_rack_create(BaseModel):
    product_id: int
    rack_id: int
    rack_code: str | None = None
    priority: str = "Primary"
    min_qty: Decimal | None = None
    max_qty: Decimal | None = None


class item_rack_out(BaseModel):
    id: int
    product_id: int | None = None
    rack_id: int | None = None
    rack_code: str | None = None
    priority: str
    min_qty: Decimal | None = None
    max_qty: Decimal | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Hierarchy / Tree ──────────────────────────────────────────────────────────

class rack_tree_node(BaseModel):
    id: int
    rack_code: str
    rack_number: str
    shelf_level: str | None = None
    capacity: int | None = None
    current_qty: Decimal
    status: bool

    model_config = {"from_attributes": True}


class division_tree_node(BaseModel):
    id: int
    division_code: str
    division_name: str
    aisle_code: str
    sequence_no: int
    status: bool
    racks: list[rack_tree_node] = []

    model_config = {"from_attributes": True}


class warehouse_tree_node(BaseModel):
    id: int
    aisle_code: str
    aisle_name: str
    warehouse_code: str | None = None
    status: bool
    divisions: list[division_tree_node] = []

    model_config = {"from_attributes": True}


# ── Report schemas ────────────────────────────────────────────────────────────

class rack_summary_out(BaseModel):
    id: int
    rack_code: str
    capacity: int | None = None
    current_qty: Decimal
    fill_pct: float
    status_color: str   # green / yellow / red
    status: bool

    model_config = {"from_attributes": True}
