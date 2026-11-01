"""
State Master API
----------------
Provides Indian GST state codes for dropdowns and GSTIN validation.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.database import get_db
from app.core.dependencies import get_current_user, current_user_dep
from app.models.state import state_master
from app.utils.search import word_match
from app.utils.gst_validators import (
    validate_gstin, extract_pan_from_gstin, extract_state_code_from_gstin,
    validate_pan, validate_cin, get_state_name, STATE_CODE_MAP
)

router = APIRouter(prefix="/states", tags=["states"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class state_out(BaseModel):
    id: int
    state_name: str
    state_code: str
    is_ut: bool
    model_config = {"from_attributes": True}


class gstin_validate_request(BaseModel):
    gstin: str
    state_code: str | None = None     # supplier's selected state code for cross-check


class gstin_validate_response(BaseModel):
    valid: bool
    error: str | None = None
    pan: str | None = None             # auto-extracted
    state_code: str | None = None      # extracted from GSTIN
    state_name: str | None = None
    state_mismatch: bool = False
    mismatch_message: str | None = None


class pan_validate_request(BaseModel):
    pan: str


class cin_validate_request(BaseModel):
    cin: str
    company_type: str | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[state_out])
async def list_states(
    search: str = Query(""),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all active Indian states for dropdowns."""
    q = select(state_master).where(state_master.is_active == True).order_by(state_master.state_code)
    if search:
        q = q.where(word_match(search, state_master.state_name))
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.get("/by-code/{code}", response_model=state_out)
async def get_state_by_code(
    code: str,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        select(state_master).where(state_master.state_code == code.strip().zfill(2))
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail=f"State code '{code}' not found")
    return row


@router.post("/validate-gstin", response_model=gstin_validate_response)
async def validate_gstin_endpoint(
    body: gstin_validate_request,
    current_user: current_user_dep = Depends(get_current_user),
):
    """
    Validate GSTIN format, extract PAN and state.
    Optionally cross-check with supplier's selected state code.
    """
    g = body.gstin.strip().upper() if body.gstin else ""

    if not g:
        return gstin_validate_response(valid=True)

    is_valid, error = validate_gstin(g)
    if not is_valid:
        return gstin_validate_response(valid=False, error=error)

    pan = extract_pan_from_gstin(g)
    state_code = extract_state_code_from_gstin(g)
    state_name = get_state_name(state_code)

    # Cross-check with supplier selected state
    state_mismatch = False
    mismatch_msg = None
    if body.state_code and body.state_code.strip():
        sel = body.state_code.strip().zfill(2)
        if sel != state_code:
            state_mismatch = True
            sel_name = get_state_name(sel) or sel
            mismatch_msg = (
                f"GSTIN State Code '{state_code}' ({state_name}) does not match "
                f"selected state '{sel}' ({sel_name})"
            )

    return gstin_validate_response(
        valid=True,
        pan=pan,
        state_code=state_code,
        state_name=state_name,
        state_mismatch=state_mismatch,
        mismatch_message=mismatch_msg,
    )


@router.post("/validate-pan")
async def validate_pan_endpoint(
    body: pan_validate_request,
    current_user: current_user_dep = Depends(get_current_user),
):
    is_valid, error = validate_pan(body.pan)
    return {"valid": is_valid, "error": error or None}


@router.post("/validate-cin")
async def validate_cin_endpoint(
    body: cin_validate_request,
    current_user: current_user_dep = Depends(get_current_user),
):
    is_valid, error = validate_cin(body.cin, body.company_type)
    return {"valid": is_valid, "error": error or None}
