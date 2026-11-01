"""
Channel Partner Schemas — Bombay Fisheries ERP
"""
from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


# ── Channel Partner ───────────────────────────────────────────────────────────

class channel_partner_create(BaseModel):
    partner_name       : str
    partner_code       : str
    commission_percent : float = 0.0
    settlement_days    : int   = 7
    gst_on_commission  : bool  = False
    delivery_charge    : float = 0.0
    packing_charge     : float = 0.0
    extra_margin       : float = 0.0
    is_active          : bool  = True
    logo_url           : Optional[str] = None
    remarks            : Optional[str] = None

    @field_validator('commission_percent')
    @classmethod
    def validate_commission(cls, v):
        if not (0 <= v <= 100):
            raise ValueError('commission_percent must be between 0 and 100')
        return round(v, 2)

    @field_validator('extra_margin')
    @classmethod
    def validate_extra_margin(cls, v):
        if v < 0:
            raise ValueError('extra_margin cannot be negative')
        return round(v, 2)


class channel_partner_update(BaseModel):
    partner_name       : Optional[str]   = None
    commission_percent : Optional[float] = None
    settlement_days    : Optional[int]   = None
    gst_on_commission  : Optional[bool]  = None
    delivery_charge    : Optional[float] = None
    packing_charge     : Optional[float] = None
    extra_margin       : Optional[float] = None
    is_active          : Optional[bool]  = None
    logo_url           : Optional[str]   = None
    remarks            : Optional[str]   = None


class channel_partner_out(BaseModel):
    id                 : int
    partner_name       : str
    partner_code       : str
    commission_percent : float
    settlement_days    : int
    gst_on_commission  : bool
    delivery_charge    : float
    packing_charge     : float
    extra_margin       : float
    is_active          : bool
    logo_url           : Optional[str]
    remarks            : Optional[str]
    created_at         : datetime
    updated_at         : datetime

    model_config = {"from_attributes": True}


# ── Item Channel Price ────────────────────────────────────────────────────────

class item_channel_price_upsert(BaseModel):
    partner_id            : int
    mrp                   : Optional[float] = None
    base_cost             : Optional[float] = None
    margin_percent        : Optional[float] = None
    partner_commission    : Optional[float] = None
    selling_price         : Optional[float] = None
    final_settlement_rate : Optional[float] = None
    minimum_profit        : Optional[float] = None
    is_active             : bool = True


class item_channel_price_out(BaseModel):
    id                    : int
    product_id            : int
    partner_id            : int
    partner_name          : Optional[str]   = None
    partner_code          : Optional[str]   = None
    mrp                   : Optional[float] = None
    base_cost             : Optional[float] = None
    margin_percent        : Optional[float] = None
    partner_commission    : Optional[float] = None
    selling_price         : Optional[float] = None
    final_settlement_rate : Optional[float] = None
    minimum_profit        : Optional[float] = None
    net_profit            : Optional[float] = None   # computed
    net_margin_pct        : Optional[float] = None   # computed
    is_active             : bool
    created_at            : datetime

    model_config = {"from_attributes": True}


# ── Price Simulator ───────────────────────────────────────────────────────────

class price_simulate_request(BaseModel):
    mrp                : float
    cost_price         : float
    gst_percent        : float = 0.0
    partner_commission : float = 0.0
    extra_margin       : float = 0.0
    delivery_charge    : float = 0.0
    packing_charge     : float = 0.0

    @field_validator('mrp', 'cost_price')
    @classmethod
    def must_be_positive(cls, v):
        if v < 0:
            raise ValueError('Value cannot be negative')
        return round(v, 2)


class price_simulate_result(BaseModel):
    selling_price     : float
    settlement_rate   : float
    net_profit        : float
    net_margin_pct    : float
    effective_cp      : float
    commission_amount : float
    is_profitable     : bool
    profit_warning    : Optional[str] = None
