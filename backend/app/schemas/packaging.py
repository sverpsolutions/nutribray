from datetime import datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, model_validator


PackagingType = Literal["LOOSE", "INNER_OUTER", "ONLY_OUTER"]


class storage_type_out(BaseModel):
    id: int
    name: str
    is_active: bool
    model_config = {"from_attributes": True}

class temperature_category_out(BaseModel):
    id: int
    name: str
    is_active: bool
    model_config = {"from_attributes": True}


class packaging_create(BaseModel):
    product_id: int
    item_code: str | None = None
    packaging_type: PackagingType = "LOOSE"

    # UOMs
    base_uom_id: int | None = None
    purchase_uom_id: int | None = None
    sales_uom_id: int | None = None
    inner_pack_uom_id: int | None = None
    outer_carton_uom_id: int | None = None

    inner_pack_qty: int = 1
    inner_packs_per_carton: int = 1
    outer_carton_qty: int = 1
    # total_units_per_carton is auto-calculated; ignored if sent

    carton_length_cm: Decimal | None = None
    carton_width_cm: Decimal | None = None
    carton_height_cm: Decimal | None = None
    # carton_volume_cbm is auto-calculated

    gross_weight_kg: Decimal | None = None
    net_weight_kg: Decimal | None = None

    unit_barcode: str | None = None
    inner_barcode: str | None = None
    carton_barcode: str | None = None

    shelf_life_days: int | None = None
    storage_type_id: int | None = None
    temperature_category_id: int | None = None

    rack_location: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_packaging(self):
        pt = self.packaging_type

        # LOOSE — disable inner/outer fields
        if pt == "LOOSE":
            self.inner_pack_qty = 1
            self.inner_packs_per_carton = 1

        # ONLY_OUTER — inner pack is always 1
        if pt == "ONLY_OUTER":
            self.inner_pack_qty = 1

        # Qty must be ≥ 1
        if self.inner_pack_qty < 1:
            raise ValueError("Inner Pack Qty must be ≥ 1")
        if self.inner_packs_per_carton < 1:
            raise ValueError("No. of Inner Packs per Carton must be ≥ 1")

        # Dimensions must be > 0 if provided
        for field in ("carton_length_cm", "carton_width_cm", "carton_height_cm"):
            val = getattr(self, field)
            if val is not None and val <= 0:
                raise ValueError(f"{field} must be > 0")

        # Gross ≥ Net
        if self.gross_weight_kg and self.net_weight_kg:
            if self.gross_weight_kg < self.net_weight_kg:
                raise ValueError("Gross Weight must be ≥ Net Weight")

        return self


class packaging_update(BaseModel):
    packaging_type: PackagingType | None = None
    
    # UOMs
    base_uom_id: int | None = None
    purchase_uom_id: int | None = None
    sales_uom_id: int | None = None
    inner_pack_uom_id: int | None = None
    outer_carton_uom_id: int | None = None

    inner_pack_qty: int | None = None
    inner_packs_per_carton: int | None = None
    outer_carton_qty: int | None = None
    
    carton_length_cm: Decimal | None = None
    carton_width_cm: Decimal | None = None
    carton_height_cm: Decimal | None = None
    gross_weight_kg: Decimal | None = None
    net_weight_kg: Decimal | None = None
    
    unit_barcode: str | None = None
    inner_barcode: str | None = None
    carton_barcode: str | None = None
    
    shelf_life_days: int | None = None
    storage_type_id: int | None = None
    temperature_category_id: int | None = None

    rack_location: str | None = None
    notes: str | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def validate_update(self):
        if self.inner_pack_qty is not None and self.inner_pack_qty < 1:
            raise ValueError("Inner Pack Qty must be ≥ 1")
        if self.inner_packs_per_carton is not None and self.inner_packs_per_carton < 1:
            raise ValueError("No. of Inner Packs per Carton must be ≥ 1")
        for field in ("carton_length_cm", "carton_width_cm", "carton_height_cm"):
            val = getattr(self, field)
            if val is not None and val <= 0:
                raise ValueError(f"{field} must be > 0")
        if self.gross_weight_kg and self.net_weight_kg:
            if self.gross_weight_kg < self.net_weight_kg:
                raise ValueError("Gross Weight must be ≥ Net Weight")
        return self


class packaging_out(BaseModel):
    id: int
    product_id: int
    item_code: str | None = None
    packaging_type: str
    
    base_uom_id: int | None = None
    purchase_uom_id: int | None = None
    sales_uom_id: int | None = None
    inner_pack_uom_id: int | None = None
    outer_carton_uom_id: int | None = None

    inner_pack_qty: int
    inner_packs_per_carton: int
    total_units_per_carton: int
    outer_carton_qty: int

    carton_length_cm: Decimal | None = None
    carton_width_cm: Decimal | None = None
    carton_height_cm: Decimal | None = None
    carton_volume_cbm: Decimal | None = None
    gross_weight_kg: Decimal | None = None
    net_weight_kg: Decimal | None = None
    
    unit_barcode: str | None = None
    inner_barcode: str | None = None
    carton_barcode: str | None = None
    
    shelf_life_days: int | None = None
    storage_type_id: int | None = None
    temperature_category_id: int | None = None

    rack_location: str | None = None
    notes: str | None = None
    is_active: bool
    created_by: int | None = None
    updated_by: int | None = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}
