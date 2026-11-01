"""
Channel Partner Pricing Router — Bombay Fisheries ERP
Endpoints for managing online channel partners (Swiggy, Zomato, Blinkit, Amazon, etc.)
and per-item channel pricing with live settlement/profit calculation.

Workflow:
  UI → API → DB → JSON Response → UI
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from typing import List

from app.core.database import get_db
from app.core.dependencies import get_current_user, current_user_dep
from app.models.channel import channel_partner, item_channel_price
from app.models.product import product as product_model
from app.schemas.channel import (
    channel_partner_create, channel_partner_update, channel_partner_out,
    item_channel_price_upsert, item_channel_price_out,
    price_simulate_request, price_simulate_result,
)

router = APIRouter(prefix="/channels", tags=["channels"])


# ── Calculation Engine ────────────────────────────────────────────────────────

def calculate_channel_price(
    mrp              : float,
    cost_price       : float,
    commission_pct   : float,
    extra_margin_pct : float,
    delivery_charge  : float,
    packing_charge   : float,
) -> dict:
    """
    Core channel pricing formula:
      selling_price   = MRP × (1 + extra_margin%)
      commission_amt  = selling_price × commission%
      settlement      = selling_price - commission_amt - delivery - packing
      net_profit      = settlement - cost_price
      net_margin_pct  = (net_profit / cost_price) × 100
    """
    effective_cp   = cost_price
    selling_price  = round(mrp * (1 + extra_margin_pct / 100), 2)
    commission_amt = round(selling_price * commission_pct / 100, 2)
    settlement     = round(selling_price - commission_amt - delivery_charge - packing_charge, 2)
    net_profit     = round(settlement - effective_cp, 2)
    net_margin_pct = round((net_profit / effective_cp * 100) if effective_cp > 0 else 0.0, 2)

    warning = None
    if net_profit < 0:
        warning = "⚠ Below cost! Settlement is less than product cost."
    elif net_margin_pct < 5:
        warning = f"⚠ Thin margin ({net_margin_pct}%). Consider raising selling price."

    return {
        "selling_price"    : selling_price,
        "settlement_rate"  : settlement,
        "commission_amount": commission_amt,
        "net_profit"       : net_profit,
        "net_margin_pct"   : net_margin_pct,
        "effective_cp"     : effective_cp,
        "is_profitable"    : net_profit > 0,
        "profit_warning"   : warning,
    }


def _enrich(row: item_channel_price) -> dict:
    """Attach computed net_profit / net_margin_pct to an ORM row."""
    d = {
        "id"                   : row.id,
        "product_id"           : row.product_id,
        "partner_id"           : row.partner_id,
        "partner_name"         : row.partner_rel.partner_name if row.partner_rel else None,
        "partner_code"         : row.partner_rel.partner_code if row.partner_rel else None,
        "mrp"                  : float(row.mrp)                   if row.mrp                   else None,
        "base_cost"            : float(row.base_cost)             if row.base_cost             else None,
        "margin_percent"       : float(row.margin_percent)        if row.margin_percent        else None,
        "partner_commission"   : float(row.partner_commission)    if row.partner_commission    else None,
        "selling_price"        : float(row.selling_price)         if row.selling_price         else None,
        "final_settlement_rate": float(row.final_settlement_rate) if row.final_settlement_rate else None,
        "minimum_profit"       : float(row.minimum_profit)        if row.minimum_profit        else None,
        "is_active"            : row.is_active,
        "logo_url"             : row.partner_rel.logo_url if row.partner_rel else None,
        "created_at"           : row.created_at,
        "net_profit"           : None,
        "net_margin_pct"       : None,
    }
    if d["final_settlement_rate"] and d["base_cost"] and d["base_cost"] > 0:
        d["net_profit"]     = round(d["final_settlement_rate"] - d["base_cost"], 2)
        d["net_margin_pct"] = round(d["net_profit"] / d["base_cost"] * 100, 2)
    return d


# ── Channel Partner CRUD ──────────────────────────────────────────────────────

@router.get("/partners", response_model=List[channel_partner_out])
async def list_partners(
    active_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _: current_user_dep = Depends(get_current_user),
):
    """List all channel partners."""
    q = select(channel_partner)
    if active_only:
        q = q.where(channel_partner.is_active == True)
    q = q.order_by(channel_partner.partner_name)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.post("/partners", response_model=channel_partner_out, status_code=201)
async def create_partner(
    data: channel_partner_create,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    """Create a new channel partner. Admin only."""
    if current_user.role not in ("admin", "superadmin", "manager"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Check duplicate code
    existing = (await db.execute(
        select(channel_partner).where(channel_partner.partner_code == data.partner_code.upper())
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"Partner code '{data.partner_code}' already exists")

    new_partner = channel_partner(
        partner_name       = data.partner_name,
        partner_code       = data.partner_code.upper(),
        commission_percent = data.commission_percent,
        settlement_days    = data.settlement_days,
        gst_on_commission  = data.gst_on_commission,
        delivery_charge    = data.delivery_charge,
        packing_charge     = data.packing_charge,
        extra_margin       = data.extra_margin,
        is_active          = data.is_active,
        logo_url           = data.logo_url,
        remarks            = data.remarks,
    )
    db.add(new_partner)
    await db.commit()
    await db.refresh(new_partner)
    return new_partner


@router.put("/partners/{partner_id}", response_model=channel_partner_out)
async def update_partner(
    partner_id: int,
    data: channel_partner_update,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    """Update channel partner details."""
    if current_user.role not in ("admin", "superadmin", "manager"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    row = (await db.execute(
        select(channel_partner).where(channel_partner.id == partner_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Partner not found")

    update_data = data.model_dump(exclude_unset=True)
    update_data["updated_at"] = datetime.utcnow()
    for k, v in update_data.items():
        setattr(row, k, v)

    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/partners/{partner_id}")
async def deactivate_partner(
    partner_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    """Deactivate (soft-delete) a channel partner."""
    if current_user.role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    row = (await db.execute(
        select(channel_partner).where(channel_partner.id == partner_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Partner not found")

    row.is_active  = False
    row.updated_at = datetime.utcnow()
    await db.commit()
    return {"message": f"Partner '{row.partner_name}' deactivated"}


# ── Item Channel Prices ───────────────────────────────────────────────────────

@router.get("/products/{product_id}/prices")
async def get_product_channel_prices(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    _: current_user_dep = Depends(get_current_user),
):
    """Get all channel prices for a given product (with partner info + computed profit)."""
    # Verify product exists
    prod = (await db.execute(
        select(product_model).where(product_model.id == product_id)
    )).scalar_one_or_none()
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")

    # Get all channel prices with partner relationship
    from sqlalchemy.orm import selectinload
    rows = (await db.execute(
        select(item_channel_price)
        .options(selectinload(item_channel_price.partner_rel))
        .where(item_channel_price.product_id == product_id)
        .order_by(item_channel_price.partner_id)
    )).scalars().all()

    # Also pull all active partners to show empty slots for partners without a price yet
    all_partners = (await db.execute(
        select(channel_partner).where(channel_partner.is_active == True).order_by(channel_partner.partner_name)
    )).scalars().all()

    priced_partner_ids = {r.partner_id for r in rows}
    result = [_enrich(r) for r in rows]

    # Add blank stubs for un-priced partners
    for p in all_partners:
        if p.id not in priced_partner_ids:
            result.append({
                "id"                   : None,
                "product_id"           : product_id,
                "partner_id"           : p.id,
                "partner_name"         : p.partner_name,
                "partner_code"         : p.partner_code,
                "mrp"                  : float(prod.mrp) if prod.mrp else None,
                "base_cost"            : float(prod.cost_price) if prod.cost_price else None,
                "margin_percent"       : None,
                "partner_commission"   : float(p.commission_percent),
                "selling_price"        : None,
                "final_settlement_rate": None,
                "minimum_profit"       : None,
                "net_profit"           : None,
                "net_margin_pct"       : None,
                "is_active"            : True,
                "logo_url"             : p.logo_url,
                "created_at"           : None,
                "default_extra_margin" : float(p.extra_margin),
                "default_delivery"     : float(p.delivery_charge),
                "default_packing"      : float(p.packing_charge),
                "settlement_days"      : p.settlement_days,
            })

    return {
        "product_id"  : product_id,
        "product_name": prod.name,
        "mrp"         : float(prod.mrp) if prod.mrp else 0,
        "cost_price"  : float(prod.cost_price) if prod.cost_price else 0,
        "prices"      : result,
    }


@router.post("/products/{product_id}/prices")
async def upsert_product_channel_price(
    product_id: int,
    data: item_channel_price_upsert,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    """
    Create or update a channel price for a product-partner pair.
    Auto-calculates selling_price and settlement if mrp + commission are provided.
    """
    # Verify product
    prod = (await db.execute(
        select(product_model).where(product_model.id == product_id)
    )).scalar_one_or_none()
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")

    # Verify partner
    partner = (await db.execute(
        select(channel_partner).where(channel_partner.id == data.partner_id)
    )).scalar_one_or_none()
    if not partner:
        raise HTTPException(status_code=404, detail="Channel partner not found")

    # Auto-calculate if mrp and base_cost provided
    mrp       = data.mrp        or float(prod.mrp or 0)
    base_cost = data.base_cost  or float(prod.cost_price or 0)
    commission= data.partner_commission if data.partner_commission is not None else float(partner.commission_percent)
    extra_mgn = data.margin_percent if data.margin_percent is not None else float(partner.extra_margin)

    calc = calculate_channel_price(
        mrp             = mrp,
        cost_price      = base_cost,
        commission_pct  = commission,
        extra_margin_pct= extra_mgn,
        delivery_charge = float(partner.delivery_charge),
        packing_charge  = float(partner.packing_charge),
    )

    selling_price  = data.selling_price         or calc["selling_price"]
    settlement     = data.final_settlement_rate or calc["settlement_rate"]

    # Validate: settlement must cover cost
    if base_cost > 0 and settlement < base_cost:
        raise HTTPException(
            status_code=422,
            detail=f"Settlement rate ₹{settlement:.2f} is below cost ₹{base_cost:.2f}. "
                   "Increase selling price or reduce commission."
        )

    # Upsert
    existing = (await db.execute(
        select(item_channel_price).where(
            item_channel_price.product_id == product_id,
            item_channel_price.partner_id == data.partner_id,
        )
    )).scalar_one_or_none()

    if existing:
        existing.mrp                   = mrp
        existing.base_cost             = base_cost
        existing.margin_percent        = extra_mgn
        existing.partner_commission    = commission
        existing.selling_price         = selling_price
        existing.final_settlement_rate = settlement
        existing.minimum_profit        = data.minimum_profit
        existing.is_active             = data.is_active
        existing.updated_at            = datetime.utcnow()
        await db.commit()
        await db.refresh(existing)
        row = existing
    else:
        row = item_channel_price(
            product_id            = product_id,
            partner_id            = data.partner_id,
            mrp                   = mrp,
            base_cost             = base_cost,
            margin_percent        = extra_mgn,
            partner_commission    = commission,
            selling_price         = selling_price,
            final_settlement_rate = settlement,
            minimum_profit        = data.minimum_profit,
            is_active             = data.is_active,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)

    return {
        **_enrich(row),
        "calc"         : calc,
        "profit_warning": calc["profit_warning"],
    }


@router.delete("/prices/{price_id}")
async def delete_channel_price(
    price_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user),
):
    """Remove a channel price record."""
    row = (await db.execute(
        select(item_channel_price).where(item_channel_price.id == price_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Channel price not found")
    await db.delete(row)
    await db.commit()
    return {"message": "Channel price removed"}


# ── Price Simulator (no product required) ────────────────────────────────────

@router.post("/simulate", response_model=price_simulate_result)
async def simulate_price(data: price_simulate_request):
    """
    Pure price calculator — no DB access required.
    Returns full breakdown: selling price, settlement, profit, margin.

    Example:
      MRP=100, cost=75, commission=20%, extra_margin=25%
      → selling_price=125, settlement=100, net_profit=25, net_margin=33.33%
    """
    calc = calculate_channel_price(
        mrp             = data.mrp,
        cost_price      = data.cost_price,
        commission_pct  = data.partner_commission,
        extra_margin_pct= data.extra_margin,
        delivery_charge = data.delivery_charge,
        packing_charge  = data.packing_charge,
    )
    return price_simulate_result(**calc)
