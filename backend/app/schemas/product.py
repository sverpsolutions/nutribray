from typing import Literal
from datetime import datetime, date
from decimal import Decimal
from pydantic import BaseModel, field_validator


# ── Manufacturer ──────────────────────────────────────────────────────────────

class manufacturer_create(BaseModel):
    name: str
    code: str | None = None
    country: str | None = None

class manufacturer_out(BaseModel):
    id: int
    name: str
    code: str | None
    country: str | None
    is_active: bool
    model_config = {"from_attributes": True}


class sub_manufacturer_create(BaseModel):
    name: str
    manufacturer_id: int
    code: str | None = None

class sub_manufacturer_out(BaseModel):
    id: int
    name: str
    manufacturer_id: int
    code: str | None
    is_active: bool
    model_config = {"from_attributes": True}


class sub_manufacturer_update(BaseModel):
    name: str | None = None
    manufacturer_id: int | None = None
    code: str | None = None
    is_active: bool | None = None


# ── Brand ─────────────────────────────────────────────────────────────────────

class brand_create(BaseModel):
    name: str
    code: str | None = None
    short_name: str | None = None
    subcategory_id: int | None = None
    manufacturer_id: int | None = None

class brand_update(BaseModel):
    name: str | None = None
    short_name: str | None = None
    subcategory_id: int | None = None
    manufacturer_id: int | None = None
    is_active: bool | None = None


class brand_out(BaseModel):
    id: int
    name: str
    code: str | None = None
    manufacturer_id: int | None
    subcategory_id: int | None = None
    subcategory_name: str | None = None
    short_name: str | None = None
    is_active: bool
    created_by_name: str | None = None
    model_config = {"from_attributes": True}


# ── Category ──────────────────────────────────────────────────────────────────

class category_create(BaseModel):
    name: str
    parent_id: int = 0
    short_name: str | None = None


class category_out(BaseModel):
    id: int
    name: str
    parent_id: int
    short_name: str | None = None
    status: bool
    model_config = {"from_attributes": True}


# ── Unit ──────────────────────────────────────────────────────────────────────

class unit_create(BaseModel):
    unit_code: str
    unit_name: str
    unit_type: str = "Count"


class unit_out(BaseModel):
    id: int
    unit_code: str
    unit_name: str
    unit_type: str
    is_active: bool
    model_config = {"from_attributes": True}


# ── GST Master ────────────────────────────────────────────────────────────────

class gst_create(BaseModel):
    tax_name: str
    gst_percent: Decimal
    cgst_pct: Decimal = Decimal("0.00")
    sgst_pct: Decimal = Decimal("0.00")
    igst_pct: Decimal = Decimal("0.00")


class gst_out(BaseModel):
    id: int
    tax_name: str
    gst_percent: Decimal
    cgst_pct: Decimal
    sgst_pct: Decimal
    igst_pct: Decimal
    is_active: bool
    model_config = {"from_attributes": True}


# ── HSN Master ────────────────────────────────────────────────────────────────

class hsn_create(BaseModel):
    hsn_code: str
    code_type: str = "HSN"
    category_type: str = "Goods"
    description: str | None = None
    gst_percent: Decimal = Decimal("0.00")
    cgst_pct: Decimal = Decimal("0.00")
    sgst_pct: Decimal = Decimal("0.00")
    igst_pct: Decimal = Decimal("0.00")


class hsn_update(BaseModel):
    code_type: str | None = None
    category_type: str | None = None
    description: str | None = None
    gst_percent: Decimal | None = None
    cgst_pct: Decimal | None = None
    sgst_pct: Decimal | None = None
    igst_pct: Decimal | None = None
    is_active: bool | None = None

class hsn_out(BaseModel):
    id: int
    hsn_code: str
    code_type: str
    category_type: str
    description: str | None
    gst_percent: Decimal
    cgst_pct: Decimal
    sgst_pct: Decimal
    igst_pct: Decimal
    is_active: bool
    model_config = {"from_attributes": True}


class variant_create(BaseModel):
    name: str
    code: str | None = None

class variant_out(BaseModel):
    id: int
    name: str
    code: str | None
    is_active: bool
    model_config = {"from_attributes": True}

class variant_update(BaseModel):
    name: str | None = None
    code: str | None = None
    is_active: bool | None = None


class flavour_create(BaseModel):
    name: str
    code: str | None = None

class flavour_out(BaseModel):
    id: int
    name: str
    code: str | None
    is_active: bool
    model_config = {"from_attributes": True}

class flavour_update(BaseModel):
    name: str | None = None
    code: str | None = None
    is_active: bool | None = None


class product_classification_create(BaseModel):
    name: str
    meaning: str | None = None

class product_classification_update(BaseModel):
    name: str | None = None
    meaning: str | None = None
    is_active: bool | None = None

class product_classification_out(BaseModel):
    id: int
    name: str
    meaning: str | None
    is_active: bool
    model_config = {"from_attributes": True}


# ── Item Category / Group / Subgroup / Subcategory ────────────────────────────

class item_category_create(BaseModel):
    name: str
    code: str | None = None
    short_name: str | None = None
    subgroup_id: int | None = None
    parent_id: int | None = None

class item_category_update(BaseModel):
    name: str | None = None
    short_name: str | None = None
    subgroup_id: int | None = None
    is_active: bool | None = None


class item_category_out(BaseModel):
    id: int
    name: str
    code: str | None
    short_name: str | None = None
    subgroup_id: int | None
    subgroup_name: str | None = None
    parent_id: int | None
    is_active: bool
    created_by_name: str | None = None
    model_config = {"from_attributes": True}


class item_group_create(BaseModel):
    name: str
    code: str | None = None
    short_name: str | None = None

class item_group_update(BaseModel):
    name: str | None = None
    short_name: str | None = None
    is_active: bool | None = None


class item_group_out(BaseModel):
    id: int
    name: str
    code: str | None
    short_name: str | None = None
    is_active: bool
    created_by_name: str | None = None
    model_config = {"from_attributes": True}


class item_subgroup_create(BaseModel):
    group_id: int
    name: str
    code: str | None = None
    short_name: str | None = None

class item_subgroup_update(BaseModel):
    group_id: int | None = None
    name: str | None = None
    short_name: str | None = None
    is_active: bool | None = None


class item_subgroup_out(BaseModel):
    id: int
    group_id: int
    group_name: str | None = None
    name: str
    code: str | None
    short_name: str | None = None
    is_active: bool
    created_by_name: str | None = None
    model_config = {"from_attributes": True}


class item_subcategory_create(BaseModel):
    category_id: int
    name: str
    code: str | None = None
    short_name: str | None = None
    default_hsn_id: int | None = None

class item_subcategory_update(BaseModel):
    category_id: int | None = None
    name: str | None = None
    short_name: str | None = None
    default_hsn_id: int | None = None
    is_active: bool | None = None


class item_subcategory_out(BaseModel):
    id: int
    category_id: int
    category_name: str | None = None
    name: str
    code: str | None
    short_name: str | None = None
    default_hsn_id: int | None = None
    hsn_code: str | None = None
    hsn_description: str | None = None
    is_active: bool
    created_by_name: str | None = None
    model_config = {"from_attributes": True}


class country_create(BaseModel):
    name: str
    code: str | None = None

class country_out(BaseModel):
    id: int
    name: str
    code: str | None = None
    is_active: bool = True
    model_config = {"from_attributes": True}

class sub_category_brand_create(BaseModel):
    name: str
    brand_id: int
    subcategory_id: int
    code: str | None = None
    short_name: str | None = None

class sub_category_brand_update(BaseModel):
    name: str | None = None
    brand_id: int | None = None
    subcategory_id: int | None = None
    short_name: str | None = None
    is_active: bool | None = None

class sub_category_brand_out(BaseModel):
    id: int
    name: str
    code: str | None = None
    brand_id: int
    brand_name: str | None = None
    subcategory_id: int
    short_name: str | None = None
    is_active: bool
    created_by_name: str | None = None
    model_config = {"from_attributes": True}

# ── Product ───────────────────────────────────────────────────────────────────

class product_create(BaseModel):
    item_type: Literal["FG", "RM", "PM", "SFG", "CONS", "OTH"] = "FG"
    bom_applicable: bool = False
    default_store_id: int | None = None
    item_remarks: str | None = None
    purchase_pack_qty: Decimal | None = None
    min_order_qty: Decimal | None = None
    name: str
    bill_print_name: str | None = None
    full_item_name: str | None = None
    print_name: str | None = None
    item_code: str | None = None
    category: str | None = None
    category_id: int | None = None
    subcategory: str | None = None
    brand: str | None = None
    brand_id: int | None = None
    hsn_code: str | None = None
    hsn_id: int | None = None
    suggested_hsn_id: int | None = None
    unit_id: int | None = None
    unit: str = "PCS"
    carton_size: int = 1
    purchase_price: Decimal = Decimal("0.00")
    cost_price: Decimal = Decimal("0.00")
    basic_cost: Decimal = Decimal("0.00")
    selling_price: Decimal = Decimal("0.00")
    wsp: Decimal = Decimal("0.00")
    mrp: Decimal = Decimal("0.00")
    gst_percent: Decimal = Decimal("0.00")
    purchase_tax_percent: Decimal = Decimal("0.00")
    sale_tax_percent: Decimal = Decimal("0.00")
    description: str | None = None
    barcode: str | None = None
    barcode_crt: str | None = None
    plu_code: int | None = None
    image_path: str | None = None
    model_no: str | None = None
    manufacturer_id: int | None = None
    submanufacturer_id: int | None = None
    classification_id: int | None = None
    variant_id: int | None = None
    flavour_id: int | None = None
    manufacturer_name: str | None = None
    needs_printing: bool = False
    group_id: int | None = None
    subgroup_id: int | None = None
    subcategory_id: int | None = None
    supplier_id: int | None = None
    country_id: int | None = None
    low_stock_threshold: int = 5
    min_stock: Decimal = Decimal("0.000")
    reorder_level: Decimal = Decimal("0.00")
    max_stock_level: Decimal = Decimal("0.00")
    shelf_life_days: int | None = None
    rack_no: str | None = None
    aisle_no: str | None = None
    weight_kg: Decimal | None = None
    variant: str | None = None
    size: str | None = None
    sub_category_brand_id: int | None = None
    allow_neg_stock: bool = False
    is_dual_unit: bool = False
    is_consumable: bool = False
    is_raw_material: bool = False
    is_sellable: bool = True
    is_raw_non_sellable: bool = False
    is_batch_required: bool = False
    has_batch_tracking: bool = False
    has_expiry_tracking: bool = False
    mfg_date_required: bool = False
    exp_date_required: bool = False
    min_shelf_life_purchase_days: int | None = None
    min_shelf_life_sale_days: int | None = None
    near_expiry_alert_days: int = 60
    allow_expired_sale: bool = False
    allow_neg_batch_stock: bool = False
    batch_wise_purchase_rate: bool = True
    batch_wise_selling_price: bool = False
    is_fefo_enabled: bool = True
    is_weighing_item: bool = False
    is_asset: bool = False
    is_discountable: bool = True
    is_hidden_pos: bool = False
    is_expired: bool = False
    allow_purchase: bool = True
    allow_sale: bool = True
    status: str = "ACTIVE"
    approved_by: str | None = None
    multiplier_to_base: Decimal = Decimal("1.000")
    conversion_factor: Decimal = Decimal("1.000")
    purchase_unit: str | None = None
    ref_item_code: str | None = None
    thumbnail_img: str | None = None
    expiry_date: date | None = None
    img_front: str | None = None
    img_back: str | None = None
    img_top: str | None = None
    img_side: str | None = None
    # Pricing engine
    pricing_mode           : str = "STANDARD"
    fixed_margin_percent   : Decimal | None = None
    allow_custom_margin    : bool = True
    minimum_margin_percent : Decimal | None = None
    default_channel_margin : Decimal | None = None
    online_partner_enabled : bool = False
    # Margins
    cp_margin: Decimal = Decimal("0.00")
    mrp_margin: Decimal = Decimal("0.00")
    sp_margin: Decimal = Decimal("0.00")
    wsp_margin: Decimal = Decimal("0.00")
    price_update_level: str = "All Store Level"

    @field_validator('category_id', 'brand_id', 'hsn_id', 'suggested_hsn_id', 'unit_id', 'plu_code', 
                     'manufacturer_id', 'submanufacturer_id', 'classification_id', 'variant_id', 'flavour_id', 
                     'group_id', 'subgroup_id', 'subcategory_id', 'supplier_id', 'country_id', 'sub_category_brand_id',
                     'carton_size', 'shelf_life_days', 'low_stock_threshold', mode='before')
    @classmethod
    def empty_str_to_int(cls, v):
        if v == "": return None
        return v

    @field_validator('purchase_price', 'cost_price', 'basic_cost', 'selling_price', 'wsp', 'mrp', 
                     'gst_percent', 'purchase_tax_percent', 'sale_tax_percent', 'min_stock', 
                     'reorder_level', 'max_stock_level', 'weight_kg', 'multiplier_to_base', 
                     'conversion_factor', 'cp_margin', 'mrp_margin', 'sp_margin', 'wsp_margin',
                     'fixed_margin_percent', 'minimum_margin_percent', 'default_channel_margin', mode='before')
    @classmethod
    def empty_str_to_decimal(cls, v):
        if v == "": return None
        return v

    @field_validator('expiry_date', mode='before')
    @classmethod
    def empty_str_to_date(cls, v):
        if v == "": return None
        return v
    cp_margin: Decimal = Decimal("0.00")
    mrp_margin: Decimal = Decimal("0.00")
    sp_margin: Decimal = Decimal("0.00")
    wsp_margin: Decimal = Decimal("0.00")
    price_update_level: str | None = "All Store Level"
    price_update_target: str | None = None
    filter_combination_name: str | None = None
    # Pricing engine
    pricing_mode           : str | None   = 'STANDARD'
    fixed_margin_percent   : Decimal | None = None
    allow_custom_margin    : bool         = True
    minimum_margin_percent : Decimal | None = None
    default_channel_margin : Decimal | None = None
    online_partner_enabled : bool         = False


class product_update(BaseModel):
    item_type: Literal["FG", "RM", "PM", "SFG", "CONS", "OTH"] | None = None
    bom_applicable: bool | None = None
    needs_printing: bool | None = None
    default_store_id: int | None = None
    item_remarks: str | None = None
    purchase_pack_qty: Decimal | None = None
    min_order_qty: Decimal | None = None
    name: str | None = None
    bill_print_name: str | None = None
    full_item_name: str | None = None
    print_name: str | None = None
    item_code: str | None = None
    category: str | None = None
    category_id: int | None = None
    subcategory: str | None = None
    brand: str | None = None
    brand_id: int | None = None
    hsn_code: str | None = None
    hsn_id: int | None = None
    suggested_hsn_id: int | None = None
    unit_id: int | None = None
    unit: str | None = None
    carton_size: int | None = None
    purchase_price: Decimal | None = None
    cost_price: Decimal | None = None
    basic_cost: Decimal | None = None
    selling_price: Decimal | None = None
    wsp: Decimal | None = None
    mrp: Decimal | None = None
    gst_percent: Decimal | None = None
    purchase_tax_percent: Decimal | None = None
    sale_tax_percent: Decimal | None = None
    plu_code: int | None = None
    image_path: str | None = None
    description: str | None = None
    barcode: str | None = None
    barcode_crt: str | None = None
    model_no: str | None = None
    manufacturer_id: int | None = None
    submanufacturer_id: int | None = None
    classification_id: int | None = None
    variant_id: int | None = None
    flavour_id: int | None = None
    group_id: int | None = None
    subgroup_id: int | None = None
    subcategory_id: int | None = None
    supplier_id: int | None = None
    country_id: int | None = None
    low_stock_threshold: int | None = None
    min_stock: Decimal | None = None
    reorder_level: Decimal | None = None
    max_stock_level: Decimal | None = None
    shelf_life_days: int | None = None
    rack_no: str | None = None
    aisle_no: str | None = None
    weight_kg: Decimal | None = None
    expiry_date: date | None = None
    variant: str | None = None
    size: str | None = None
    sub_category_brand_id: int | None = None
    ref_item_code: str | None = None
    is_active: bool | None = None
    is_dual_unit: bool | None = None
    is_consumable: bool | None = None
    is_raw_material: bool | None = None
    is_sellable: bool | None = None
    is_raw_non_sellable: bool | None = None
    is_batch_required: bool | None = None
    has_batch_tracking: bool | None = None
    has_expiry_tracking: bool | None = None
    mfg_date_required: bool | None = None
    exp_date_required: bool | None = None
    min_shelf_life_purchase_days: int | None = None
    min_shelf_life_sale_days: int | None = None
    near_expiry_alert_days: int | None = None
    allow_expired_sale: bool | None = None
    allow_neg_batch_stock: bool | None = None
    batch_wise_purchase_rate: bool | None = None
    batch_wise_selling_price: bool | None = None
    is_fefo_enabled: bool | None = None
    is_weighing_item: bool | None = None
    is_asset: bool | None = None
    is_discountable: bool | None = None
    is_hidden_pos: bool | None = None
    is_expired: bool | None = None
    allow_purchase: bool | None = None
    allow_sale: bool | None = None
    allow_neg_stock: bool | None = None
    status: str | None = None
    approved_by: str | None = None
    multiplier_to_base: Decimal | None = None
    conversion_factor: Decimal | None = None
    purchase_unit: str | None = None
    price_update_level: str | None = None
    price_update_target: str | None = None
    filter_combination_name: str | None = None
    # Pricing engine
    pricing_mode           : str | None   = None
    fixed_margin_percent   : Decimal | None = None
    allow_custom_margin    : bool | None  = None
    minimum_margin_percent : Decimal | None = None
    default_channel_margin : Decimal | None = None
    online_partner_enabled : bool | None  = None
    # Margins
    cp_margin: Decimal | None = None
    mrp_margin: Decimal | None = None
    sp_margin: Decimal | None = None
    wsp_margin: Decimal | None = None
    img_front: str | None = None
    img_back: str | None = None
    img_top: str | None = None
    img_side: str | None = None
    thumbnail_img: str | None = None

    @field_validator('category_id', 'brand_id', 'hsn_id', 'suggested_hsn_id', 'unit_id', 'plu_code', 
                     'manufacturer_id', 'submanufacturer_id', 'classification_id', 'variant_id', 'flavour_id', 
                     'group_id', 'subgroup_id', 'subcategory_id', 'supplier_id', 'country_id', 'sub_category_brand_id',
                     'carton_size', 'shelf_life_days', 'low_stock_threshold', mode='before')
    @classmethod
    def empty_str_to_int(cls, v):
        if v == "": return None
        return v

    @field_validator('purchase_price', 'cost_price', 'basic_cost', 'selling_price', 'wsp', 'mrp', 
                     'gst_percent', 'purchase_tax_percent', 'sale_tax_percent', 'min_stock', 
                     'reorder_level', 'max_stock_level', 'weight_kg', 'multiplier_to_base', 
                     'conversion_factor', 'cp_margin', 'mrp_margin', 'sp_margin', 'wsp_margin',
                     'fixed_margin_percent', 'minimum_margin_percent', 'default_channel_margin', mode='before')
    @classmethod
    def empty_str_to_decimal(cls, v):
        if v == "": return None
        return v

    @field_validator('expiry_date', mode='before')
    @classmethod
    def empty_str_to_date(cls, v):
        if v == "": return None
        return v


class barcode_out(BaseModel):
    id: int
    product_id: int
    barcode: str
    barcode_type: str
    is_primary: bool
    model_config = {"from_attributes": True}


class product_out(BaseModel):
    item_type: Literal["FG", "RM", "PM", "SFG", "CONS", "OTH"] | None = None
    bom_applicable: bool | None = None
    default_store_id: int | None = None
    item_remarks: str | None = None
    purchase_pack_qty: Decimal | None = None
    min_order_qty: Decimal | None = None
    id: int
    name: str
    bill_print_name: str | None = None
    full_item_name: str | None = None
    print_name: str | None = None          # alias for bill_print_name (frontend compat)
    item_code: str | None = None
    category: str
    category_id: int | None = None
    subcategory: str | None = None
    subcategory_id: int | None = None
    brand: str | None = None
    brand_id: int | None = None
    hsn_code: str | None = None
    hsn_id: int | None = None
    suggested_hsn_id: int | None = None
    unit: str
    unit_id: int | None = None
    purchase_price: Decimal = Decimal("0")
    cost_price: Decimal = Decimal("0")
    basic_cost: Decimal = Decimal("0")
    selling_price: Decimal = Decimal("0")
    wsp: Decimal = Decimal("0")
    mrp: Decimal = Decimal("0")
    gst_percent: Decimal = Decimal("0")
    purchase_tax_percent: Decimal = Decimal("0")
    sale_tax_percent: Decimal = Decimal("0")
    stock_qty: Decimal = Decimal("0")
    stock_pcs: Decimal = Decimal("0")
    plu_code: int | None = None
    image_path: str | None = None
    thumbnail_img: str | None = None
    img_front: str | None = None
    img_back: str | None = None
    img_top: str | None = None
    img_side: str | None = None
    barcode: str | None = None
    barcode_crt: str | None = None
    model_no: str | None = None
    manufacturer_id: int | None = None
    manufacturer_name: str | None = None
    needs_printing: bool = False
    submanufacturer_id: int | None = None
    classification_id: int | None = None
    group_id: int | None = None
    subgroup_id: int | None = None
    variant_id: int | None = None
    flavour_id: int | None = None
    sub_category_brand_id: int | None = None
    supplier_id: int | None = None
    country_id: int | None = None
    low_stock_threshold: int = 5
    min_stock: Decimal = Decimal("0")
    reorder_level: Decimal = Decimal("0")
    max_stock_level: Decimal = Decimal("0")
    shelf_life_days: int | None = None
    rack_no: str | None = None
    aisle_no: str | None = None
    weight_kg: Decimal | None = None
    variant: str | None = None
    size: str | None = None
    ref_item_code: str | None = None
    cp_margin: Decimal = Decimal("0")
    mrp_margin: Decimal = Decimal("0")
    sp_margin: Decimal = Decimal("0")
    wsp_margin: Decimal = Decimal("0")
    multiplier_to_base: Decimal = Decimal("1")
    conversion_factor: Decimal = Decimal("1")
    purchase_unit: str | None = None
    allow_neg_stock: bool = False
    is_active: bool = True
    is_dual_unit: bool = False
    is_consumable: bool = False
    is_raw_material: bool = False
    is_sellable: bool = True
    is_raw_non_sellable: bool = False
    is_batch_required: bool = False
    has_batch_tracking: bool = False
    has_expiry_tracking: bool = False
    mfg_date_required: bool = False
    exp_date_required: bool = False
    min_shelf_life_purchase_days: int | None = None
    min_shelf_life_sale_days: int | None = None
    near_expiry_alert_days: int = 60
    allow_expired_sale: bool = False
    allow_neg_batch_stock: bool = False
    batch_wise_purchase_rate: bool = True
    batch_wise_selling_price: bool = False
    is_fefo_enabled: bool = True
    is_weighing_item: bool = False
    is_asset: bool = False
    is_discountable: bool = True
    is_hidden_pos: bool = False
    is_expired: bool = False
    allow_purchase: bool = True
    allow_sale: bool = True
    prompt_qty: bool = False
    prompt_price: bool = False
    status: str = "ACTIVE"
    approved_by: str | None = None
    price_update_level: str | None = None
    price_update_target: str | None = None
    filter_combination_name: str | None = None
    inner_pack_qty: int | None = None
    outer_carton_qty: int | None = None
    # Pricing engine
    pricing_mode           : str = "STANDARD"
    fixed_margin_percent   : Decimal | None = None
    allow_custom_margin    : bool = True
    minimum_margin_percent : Decimal | None = None
    default_channel_margin : Decimal | None = None
    online_partner_enabled : bool = False
    price_update_level     : str = "All Store Level"
    total_pcs_in_carton: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    model_config = {"from_attributes": True}

    def model_post_init(self, __context):
        # print_name is not a DB column — serve bill_print_name as fallback
        if self.print_name is None and self.bill_print_name:
            object.__setattr__(self, 'print_name', self.bill_print_name)


class product_list_out(BaseModel):
    id: int
    name: str
    item_code: str | None
    item_type: str | None = None
    category: str
    brand: str | None
    manufacturer_name: str | None = None   # job-work customer the item is made for
    needs_printing: bool = False
    unit: str
    selling_price: Decimal
    mrp: Decimal
    gst_percent: Decimal
    stock_qty: Decimal
    barcode: str | None
    is_active: bool
    status: str | None = None
    thumbnail_img: str | None = None
    inner_pack_qty: int | None = None
    outer_carton_qty: int | None = None
    total_pcs_in_carton: int | None = None
    model_config = {"from_attributes": True}


class barcode_generate_request(BaseModel):
    product_id: int
    barcode: str | None = None          # if None → auto-generate EAN13
    barcode_type: str = "EAN13"
    is_primary: bool = False


class outlet_pricing_out(BaseModel):
    id: int
    outlet_id: int
    product_id: int
    cost_price: Decimal | None
    wsp: Decimal | None
    mrp: Decimal | None
    selling_price: Decimal | None
    stock_qty: Decimal | None
    is_active: bool
    unit_code: str | None = None
    outlet_name: str | None = None
    type: str | None = None
    model_config = {"from_attributes": True}


class outlet_pricing_update(BaseModel):
    outlet_id: int
    cost_price: Decimal | None = None
    wsp: Decimal | None = None
    mrp: Decimal | None = None
    selling_price: Decimal | None = None
    is_active: bool | None = True


# ── HSN Management ────────────────────────────────────────────────────────────

class hsn_exception_log_out(BaseModel):
    id: int
    product_id: int | None
    item_code: str | None
    subcategory_id: int | None
    suggested_hsn_id: int | None
    entered_hsn_id: int | None
    user_id: int | None
    reason: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class hsn_history_out(BaseModel):
    id: int
    product_id: int | None
    old_hsn_id: int | None
    new_hsn_id: int | None
    changed_by: int | None
    created_at: datetime
    model_config = {"from_attributes": True}
