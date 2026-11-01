"""
Pydantic Schemas for Nutribray Manufacturing Module.
Includes:
- BOM schemas
- Manufacturing Order schemas
- Material Planning & Shortage schemas
- Material Reservation & Issue schemas
- Output & QC Release schemas
- Forward & Backward Traceability schemas
- Dashboard & Reports schemas
"""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field


# ─── BOM SCHEMAS ─────────────────────────────────────────────────────────────
class BomItemBase(BaseModel):
    product_id: int
    material_type: str = "RAW_MATERIAL"  # RAW_MATERIAL, PACKAGING, PREMIX, CONSUMABLE, SUB_ASSEMBLY
    quantity: Decimal = Field(..., gt=0)
    unit: str = "KG"
    wastage_pct: Decimal = Field(default=Decimal("0.00"), ge=0, le=100)
    cost_per_unit: Decimal = Field(default=Decimal("0.00"), ge=0)
    is_critical: bool = False
    sub_bom_id: Optional[int] = None
    stage: str = "Mixing"
    sequence: int = 1
    notes: Optional[str] = None
    round_up: bool = False                 # whole units per order (cartons, tins); else keep decimals
    preferred_store_id: Optional[int] = None


class BomItemCreate(BomItemBase):
    pass


class BomItemOut(BomItemBase):
    id: int
    bom_id: int
    total_cost: Decimal
    product_name: Optional[str] = None
    item_code: Optional[str] = None
    barcode: Optional[str] = None
    available_stock: Optional[Decimal] = Decimal("0.000")

    class Config:
        from_attributes = True


class BomBase(BaseModel):
    bom_no: Optional[str] = None
    bom_name: str
    product_id: int
    revision: int = 1
    version_label: str = "v1.0"
    product_type: str = "FINISHED"  # FINISHED, SEMI_FINISHED
    batch_size: Decimal = Field(default=Decimal("1.000"), gt=0)
    batch_unit: str = "PCS"
    expected_yield_pct: Decimal = Field(default=Decimal("100.00"), ge=0)
    tolerance_pct: Decimal = Field(default=Decimal("2.00"), ge=0)
    expected_wastage_pct: Decimal = Field(default=Decimal("0.00"), ge=0)
    valid_from: date = Field(default_factory=date.today)
    valid_to: Optional[date] = None
    labor_cost: Decimal = Field(default=Decimal("0.00"), ge=0)
    overhead_cost: Decimal = Field(default=Decimal("0.00"), ge=0)
    notes: Optional[str] = None


class BomCreate(BomBase):
    items: List[BomItemCreate]


class BomUpdate(BaseModel):
    bom_name: Optional[str] = None
    version_label: Optional[str] = None
    batch_size: Optional[Decimal] = None
    batch_unit: Optional[str] = None
    expected_yield_pct: Optional[Decimal] = None
    tolerance_pct: Optional[Decimal] = None
    expected_wastage_pct: Optional[Decimal] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    labor_cost: Optional[Decimal] = None
    overhead_cost: Optional[Decimal] = None
    notes: Optional[str] = None
    items: Optional[List[BomItemCreate]] = None


class BomApprovalIn(BaseModel):
    action: str = "APPROVE"  # APPROVE, REJECT, OBSOLETE
    remarks: Optional[str] = None


class BomOut(BomBase):
    id: int
    bom_no: str
    status: str
    approved_by: Optional[int] = None
    approved_by_name: Optional[str] = None
    approved_at: Optional[datetime] = None
    approval_remarks: Optional[str] = None
    total_cost: Decimal
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    product_name: Optional[str] = None
    item_code: Optional[str] = None
    items: List[BomItemOut] = []

    class Config:
        from_attributes = True


class BomListOut(BaseModel):
    customer_name: Optional[str] = None
    id: int
    bom_no: str
    bom_name: str
    product_id: int
    product_name: Optional[str] = None
    item_code: Optional[str] = None
    revision: int
    version_label: str
    product_type: str
    batch_size: Decimal
    batch_unit: str
    expected_yield_pct: Decimal
    status: str
    total_cost: Decimal
    items_count: int = 0
    valid_from: date
    valid_to: Optional[date] = None
    created_at: datetime


# ─── MANUFACTURING ORDER SCHEMAS ─────────────────────────────────────────────
class MfgOrderCreate(BaseModel):
    product_id: int
    bom_id: int
    planned_qty: Decimal = Field(..., gt=0)
    unit: str = "PCS"
    plant_id: Optional[int] = None
    department: str = "Production"
    source_warehouse_id: Optional[int] = None
    target_warehouse_id: Optional[int] = None
    planned_start_date: date
    planned_end_date: date
    notes: Optional[str] = None


class MfgOrderUpdate(BaseModel):
    planned_qty: Optional[Decimal] = None
    unit: Optional[str] = None
    plant_id: Optional[int] = None
    department: Optional[str] = None
    source_warehouse_id: Optional[int] = None
    target_warehouse_id: Optional[int] = None
    planned_start_date: Optional[date] = None
    planned_end_date: Optional[date] = None
    notes: Optional[str] = None


class MfgOrderItemOut(BaseModel):
    id: int
    mfg_order_id: int
    product_id: int
    product_name: Optional[str] = None
    item_code: Optional[str] = None
    barcode: Optional[str] = None
    material_type: str
    required_qty: Decimal
    reserved_qty: Decimal
    issued_qty: Decimal
    consumed_qty: Decimal
    returned_qty: Decimal
    unit: str
    cost_per_unit: Decimal
    total_cost: Decimal
    status: str
    current_stock: Optional[Decimal] = Decimal("0.000")
    shortage_qty: Optional[Decimal] = Decimal("0.000")

    class Config:
        from_attributes = True


class MfgOrderBatchItem(BaseModel):
    id: int
    mfg_order_id: int
    mfg_order_item_id: int
    product_id: int
    product_name: Optional[str] = None
    item_code: Optional[str] = None
    batch_id: int
    batch_no: str
    expiry_date: Optional[date] = None
    reserved_qty: Decimal
    issued_qty: Decimal
    consumed_qty: Decimal
    returned_qty: Decimal
    status: str

    class Config:
        from_attributes = True


class MfgOrderOutputOut(BaseModel):
    id: int
    mfg_order_id: int
    output_no: str
    product_id: int
    product_name: Optional[str] = None
    batch_id: Optional[int] = None
    batch_no: str
    good_qty: Decimal
    rejected_qty: Decimal
    scrap_qty: Decimal
    unit: str
    mfg_date: date
    exp_date: Optional[date] = None
    qc_status: str
    qc_released_at: Optional[datetime] = None
    qc_released_by: Optional[int] = None
    qc_notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


ProductionOutputOut = MfgOrderOutputOut


class MfgOrderOut(BaseModel):
    id: int
    order_no: str
    product_id: int
    product_name: Optional[str] = None
    item_code: Optional[str] = None
    bom_id: int
    bom_no: Optional[str] = None
    bom_name: Optional[str] = None
    planned_qty: Decimal
    completed_qty: Decimal
    rejected_qty: Decimal
    scrap_qty: Decimal
    unit: str
    plant_id: Optional[int] = None
    plant_name: Optional[str] = None
    department: str
    source_warehouse_id: Optional[int] = None
    target_warehouse_id: Optional[int] = None
    production_batch_no: Optional[str] = None
    production_batch_id: Optional[int] = None
    planned_start_date: date
    planned_end_date: date
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None
    status: str
    qc_status: str
    qc_inspection_no: Optional[str] = None
    qc_remarks: Optional[str] = None
    qc_released_by: Optional[int] = None
    qc_released_at: Optional[datetime] = None
    estimated_cost: Decimal
    actual_cost: Decimal
    supervisor_id: Optional[int] = None
    supervisor_name: Optional[str] = None
    approved_by: Optional[int] = None
    approved_by_name: Optional[str] = None
    approved_at: Optional[datetime] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    items: List[MfgOrderItemOut] = []
    batches: List[MfgOrderBatchItem] = []
    outputs: List[MfgOrderOutputOut] = []

    class Config:
        from_attributes = True


class MfgOrderListOut(BaseModel):
    id: int
    order_no: str
    product_id: int
    product_name: Optional[str] = None
    item_code: Optional[str] = None
    bom_no: Optional[str] = None
    planned_qty: Decimal
    completed_qty: Decimal
    unit: str
    department: str
    planned_start_date: date
    planned_end_date: date
    status: str
    qc_status: str
    production_batch_no: Optional[str] = None
    created_at: datetime


# ─── MATERIAL PLANNING & RESERVATION SCHEMAS ─────────────────────────────────
class BatchAllocation(BaseModel):
    batch_id: int
    batch_no: str
    expiry_date: Optional[date] = None
    available_qty: Decimal
    allocated_qty: Decimal


class MaterialRequirementItem(BaseModel):
    product_id: int
    product_name: str
    item_code: Optional[str] = None
    material_type: str
    required_qty: Decimal
    unit: str
    available_stock: Decimal
    shortage_qty: Decimal
    suggested_batches: List[BatchAllocation] = []


class ProductionPlanningOut(BaseModel):
    mfg_order_id: int
    order_no: str
    product_id: int
    product_name: str
    planned_qty: Decimal
    unit: str
    requirements: List[MaterialRequirementItem]
    has_shortage: bool
    total_shortage_items: int


class MaterialReserveBatchIn(BaseModel):
    order_item_id: int
    product_id: int
    batch_id: int
    batch_no: str
    expiry_date: Optional[date] = None
    qty: Decimal = Field(..., gt=0)


class MaterialReserveIn(BaseModel):
    reservations: List[MaterialReserveBatchIn]


class MaterialIssueBatchIn(BaseModel):
    order_item_id: int
    batch_id: int
    qty: Decimal = Field(..., gt=0)


class MaterialIssueIn(BaseModel):
    issues: List[MaterialIssueBatchIn]
    transfer_to_department: Optional[str] = None
    notes: Optional[str] = None


class MaterialConsumeBatchIn(BaseModel):
    order_item_id: int
    batch_id: int
    qty: Decimal = Field(..., gt=0)


class MaterialConsumeIn(BaseModel):
    consumptions: List[MaterialConsumeBatchIn]
    notes: Optional[str] = None


class MaterialReturnBatchIn(BaseModel):
    order_item_id: int
    batch_id: int
    qty: Decimal = Field(..., gt=0)
    reason: Optional[str] = None


class MaterialReturnIn(BaseModel):
    returns: List[MaterialReturnBatchIn]
    notes: Optional[str] = None


# ─── PRODUCTION OUTPUT & QC SCHEMAS ──────────────────────────────────────────
class ProductionOutputCreate(BaseModel):
    good_qty: Decimal = Field(..., ge=0)
    rejected_qty: Decimal = Field(default=Decimal("0.000"), ge=0)
    scrap_qty: Decimal = Field(default=Decimal("0.000"), ge=0)
    unit: str = "PCS"
    batch_no: Optional[str] = None  # Auto-generated if not given
    mfg_date: date
    exp_date: Optional[date] = None
    notes: Optional[str] = None


class QcReleaseIn(BaseModel):
    decision: str = "RELEASE"  # RELEASE, REJECT, QUARANTINE
    inspection_no: Optional[str] = None
    accepted_qty: Optional[Decimal] = None
    rejected_qty: Optional[Decimal] = None
    remarks: Optional[str] = None


# ─── TRACEABILITY SCHEMAS ────────────────────────────────────────────────────
class TraceBatchSource(BaseModel):
    batch_id: int
    batch_no: str
    product_id: int
    product_name: str
    material_type: str
    qty_used: Decimal
    unit: str
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    supplier_batch_no: Optional[str] = None
    grn_no: Optional[str] = None
    grn_date: Optional[date] = None
    po_no: Optional[str] = None
    coa_attachment: Optional[str] = None
    qc_status: Optional[str] = None


class BackwardTraceabilityOut(BaseModel):
    finished_batch_id: int
    finished_batch_no: str
    product_id: int
    product_name: str
    mfg_order_id: int
    order_no: str
    bom_id: int
    bom_no: str
    bom_version: str
    output_qty: Decimal
    unit: str
    mfg_date: date
    exp_date: Optional[date] = None
    qc_status: str
    qc_inspection_no: Optional[str] = None
    supervisor_name: Optional[str] = None
    raw_materials_used: List[TraceBatchSource]
    packaging_materials_used: List[TraceBatchSource]


class TraceBatchDestination(BaseModel):
    mfg_order_id: int
    order_no: str
    finished_product_id: int
    finished_product_name: str
    finished_batch_id: int
    finished_batch_no: str
    qty_produced: Decimal
    unit: str
    mfg_date: date
    exp_date: Optional[date] = None
    qc_status: str
    outlets_transferred_to: List[Dict[str, Any]] = []
    invoices_sold_to: List[Dict[str, Any]] = []


class ForwardTraceabilityOut(BaseModel):
    source_batch_id: int
    source_batch_no: str
    product_id: int
    product_name: str
    material_type: str
    supplier_name: Optional[str] = None
    grn_no: Optional[str] = None
    receipt_date: Optional[date] = None
    total_received_qty: Decimal
    current_batch_stock: Decimal
    affected_orders: List[TraceBatchDestination]


# ─── DASHBOARD & SUMMARY ─────────────────────────────────────────────────────
class ManufacturingDashboardOut(BaseModel):
    total_orders_count: int
    active_in_production_count: int
    completed_orders_count: int
    pending_qc_count: int
    active_boms_count: int
    total_material_shortages_count: int
    recent_orders: List[MfgOrderListOut]
    low_stock_raw_materials: List[Dict[str, Any]]
