import math
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core import access
from app.core.dependencies import get_current_user, require_role, current_user_dep
from app.models.product import (
    brand, category, manufacturer, product, unit_master, gst_master, hsn_master,
    item_category, item_group, item_subgroup, item_subcategory,
    sub_category_brand, country, sub_manufacturer, variant_master, flavour_master,
    product_classification
)
from app.models.company import CompanySetting
from app.schemas.product import (
    brand_create, brand_update, brand_out,
    category_create, category_out,
    manufacturer_create, manufacturer_out,
    unit_create, unit_out,
    gst_create, gst_out,
    hsn_create, hsn_update, hsn_out,
    hsn_exception_log_out, hsn_history_out,
    item_category_create, item_category_update, item_category_out,
    item_group_create, item_group_update, item_group_out,
    item_subgroup_create, item_subgroup_update, item_subgroup_out,
    item_subcategory_create, item_subcategory_update, item_subcategory_out,
    sub_category_brand_create, sub_category_brand_update, sub_category_brand_out,
    country_create, country_out,
    sub_manufacturer_create, sub_manufacturer_update, sub_manufacturer_out,
    variant_create, variant_update, variant_out,
    flavour_create, flavour_update, flavour_out,
    product_classification_create, product_classification_update, product_classification_out,
)
from app.schemas.common import success_response, paginated_response
from app.services.auth_service import write_audit
from app.utils.search import word_match

router = APIRouter(prefix="/masters", tags=["masters"])


# ── helper ────────────────────────────────────────────────────────────────────

async def _generate_next_code(db: AsyncSession, model, prefix: str = "", suffix_len: int = 3):
    """
    Generates the next sequential code.
    If prefix is "01" and suffix_len is 3, looks for "01001", "01002", etc.
    """
    if not prefix:
        # Top level, e.g., Group 01, 02...
        q = select(model.code).where(model.code.regexp_match(r'^\d{2}$')).order_by(model.code.desc()).limit(1)
        res = await db.execute(q)
        last = res.scalar()
        if not last: return "01"
        return str(int(last) + 1).zfill(2)
    else:
        # Child level, e.g., Subgroup 01001, 01002...
        pattern = f"^{prefix}\\d{{{suffix_len}}}$"
        q = select(model.code).where(model.code.regexp_match(pattern)).order_by(model.code.desc()).limit(1)
        res = await db.execute(q)
        last = res.scalar()
        if not last: return prefix + "1".zfill(suffix_len)
        suffix = last[len(prefix):]
        return prefix + str(int(suffix) + 1).zfill(suffix_len)

def _paginate(rows, total, page, per_page):
    return {
        "data": rows,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": math.ceil(total / per_page) if per_page else 1,
    }


# ── Manufacturers ─────────────────────────────────────────────────────────────

@router.get("/manufacturers", response_model=list[manufacturer_out])
async def list_manufacturers(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(select(manufacturer).where(manufacturer.is_active == True))
    return rows.scalars().all()


@router.post("/manufacturers", response_model=success_response, status_code=201)
async def create_manufacturer(
    body: manufacturer_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = manufacturer(name=body.name, code=body.code, country=body.country)
    db.add(obj)
    await db.flush()
    await write_audit(db=db, module="masters", action="create_manufacturer",
                      record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "manufacturer created", "id": obj.id}


@router.delete("/manufacturers/{mid}", response_model=success_response)
async def delete_manufacturer(
    mid: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(manufacturer).where(manufacturer.id == mid).values(is_active=False))
    await write_audit(db=db, module="masters", action="delete_manufacturer",
                      record_id=mid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "manufacturer deactivated", "id": mid}


# ── Sub Manufacturers ─────────────────────────────────────────────────────────

@router.get("/sub-manufacturers", response_model=list[sub_manufacturer_out])
async def list_sub_manufacturers(
    manufacturer_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(sub_manufacturer).where(sub_manufacturer.is_active == True)
    if manufacturer_id:
        q = q.where(sub_manufacturer.manufacturer_id == manufacturer_id)
    rows = await db.execute(q)
    return rows.scalars().all()


@router.post("/sub-manufacturers", response_model=success_response, status_code=201)
async def create_sub_manufacturer(
    body: sub_manufacturer_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = sub_manufacturer(manufacturer_id=body.manufacturer_id, name=body.name, code=body.code)
    db.add(obj)
    await db.flush()
    await db.commit()
    return {"message": "sub manufacturer created", "id": obj.id}


@router.delete("/sub-manufacturers/{smid}", response_model=success_response)
async def delete_sub_manufacturer(
    smid: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(sub_manufacturer).where(sub_manufacturer.id == smid).values(is_active=False))
    await write_audit(db=db, module="masters", action="delete_sub_manufacturer",
                      record_id=smid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "sub manufacturer deactivated", "id": smid}


@router.put("/sub-manufacturers/{smid}", response_model=success_response)
async def update_sub_manufacturer(
    smid: int,
    body: sub_manufacturer_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        data = body.model_dump(exclude_unset=True)
        if not data:
            raise HTTPException(status_code=400, detail="No data to update")
            
        await db.execute(update(sub_manufacturer).where(sub_manufacturer.id == smid).values(**data))
        await write_audit(db=db, module="masters", action="update_sub_manufacturer",
                          record_id=smid, user_id=current_user.user_id, user_name=current_user.username)
        await db.commit()
        return {"message": "sub manufacturer updated", "id": smid}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ── Brands ────────────────────────────────────────────────────────────────────

@router.get("/brands", response_model=list[brand_out])
async def list_brands(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import joinedload
    rows = await db.execute(
        select(brand)
        .options(joinedload(brand.creator), joinedload(brand.subcategory_rel))
        .where(brand.is_active == True)
    )
    return rows.scalars().all()


@router.post("/brands", response_model=success_response, status_code=201)
async def create_brand(
    body: brand_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump()
    if not data.get("code"):
        # Brands always use simple sequential 4-digit codes (1001, 1002, ...)
        q = select(brand.code).where(brand.code.regexp_match(r'^\d{4}$')).order_by(brand.code.desc()).limit(1)
        res = await db.execute(q)
        last = res.scalar()
        data["code"] = str(int(last) + 1).zfill(4) if last else "1001"

    data["created_by"] = current_user.user_id
    data["updated_by"] = current_user.user_id

    obj = brand(**data)
    db.add(obj)
    await db.flush()
    await write_audit(db=db, module="masters", action="create_brand",
                      record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "brand created", "id": obj.id}


@router.delete("/brands/{bid}", response_model=success_response)
async def delete_brand(
    bid: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(brand).where(brand.id == bid).values(is_active=False))
    await write_audit(db=db, module="masters", action="delete_brand",
                      record_id=bid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "brand deactivated", "id": bid}


@router.put("/brands/{bid}", response_model=success_response)
async def update_brand_endpoint(
    bid: int,
    body: brand_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = await db.get(brand, bid)
    if not obj: raise HTTPException(404, "Brand not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items(): setattr(obj, k, v)
    obj.updated_by = current_user.user_id
    await db.commit()
    await write_audit(db=db, module="masters", action="update_brand",
                      record_id=bid, user_id=current_user.user_id, user_name=current_user.username)
    return {"message": "Brand updated", "id": bid}


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories", response_model=list[category_out])
async def list_categories(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(select(category).where(category.status == True))
    return rows.scalars().all()


@router.post("/categories", response_model=success_response, status_code=201)
async def create_category(
    body: category_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = category(
        name=body.name, 
        parent_id=body.parent_id,
        short_name=body.short_name,
        updated_by=current_user.user_id
    )
    db.add(obj)
    await db.flush()
    await write_audit(db=db, module="masters", action="create_category",
                      record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "category created", "id": obj.id}


@router.delete("/categories/{cid}", response_model=success_response)
async def delete_category(
    cid: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(category).where(category.id == cid).values(status=False))
    await write_audit(db=db, module="masters", action="delete_category",
                      record_id=cid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "category deactivated", "id": cid}


# ── Units ─────────────────────────────────────────────────────────────────────

@router.get("/units", response_model=list[unit_out])
async def list_units(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(select(unit_master).where(unit_master.is_active == True))
    return rows.scalars().all()


@router.post("/units", response_model=success_response, status_code=201)
async def create_unit(
    body: unit_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    exists = await db.execute(select(unit_master).where(unit_master.unit_code == body.unit_code))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="unit_code already exists")
    obj = unit_master(unit_code=body.unit_code, unit_name=body.unit_name, unit_type=body.unit_type)
    db.add(obj)
    await db.flush()
    await write_audit(db=db, module="masters", action="create_unit",
                      record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "unit created", "id": obj.id}


@router.delete("/units/{uid}", response_model=success_response)
async def delete_unit(
    uid: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(unit_master).where(unit_master.id == uid).values(is_active=False))
    await write_audit(db=db, module="masters", action="delete_unit",
                      record_id=uid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "unit deactivated", "id": uid}


# ── GST Master ────────────────────────────────────────────────────────────────

@router.get("/gst", response_model=list[gst_out])
async def list_gst(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(select(gst_master).where(gst_master.is_active == True))
    return rows.scalars().all()


@router.post("/gst", response_model=success_response, status_code=201)
async def create_gst(
    body: gst_create,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    obj = gst_master(**body.model_dump())
    db.add(obj)
    await db.flush()
    await write_audit(db=db, module="masters", action="create_gst",
                      record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "gst rate created", "id": obj.id}


@router.delete("/gst/{gid}", response_model=success_response)
async def delete_gst(
    gid: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(gst_master).where(gst_master.id == gid).values(is_active=False))
    await write_audit(db=db, module="masters", action="delete_gst",
                      record_id=gid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "gst rate deactivated", "id": gid}


# ── Variants ──────────────────────────────────────────────────────────────────

@router.get("/variants", response_model=list[variant_out])
async def list_variants(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(select(variant_master).where(variant_master.is_active == True))
    return rows.scalars().all()


@router.post("/variants", response_model=success_response, status_code=201)
async def create_variant(
    body: variant_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = variant_master(name=body.name, code=body.code)
    db.add(obj)
    await db.flush()
    await write_audit(db=db, module="masters", action="create_variant",
                      record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "variant created", "id": obj.id}


@router.put("/variants/{vid}", response_model=success_response)
async def update_variant(
    vid: int,
    body: variant_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(variant_master).where(variant_master.id == vid).values(**body.model_dump(exclude_unset=True)))
    await write_audit(db=db, module="masters", action="update_variant",
                      record_id=vid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "variant updated", "id": vid}


@router.delete("/variants/{vid}", response_model=success_response)
async def delete_variant(
    vid: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(variant_master).where(variant_master.id == vid).values(is_active=False))
    await write_audit(db=db, module="masters", action="delete_variant",
                      record_id=vid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "variant deactivated", "id": vid}


# ── Flavours ──────────────────────────────────────────────────────────────────

@router.get("/flavours", response_model=list[flavour_out])
async def list_flavours(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(select(flavour_master).where(flavour_master.is_active == True))
    return rows.scalars().all()


@router.post("/flavours", response_model=success_response, status_code=201)
async def create_flavour(
    body: flavour_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = flavour_master(name=body.name, code=body.code)
    db.add(obj)
    await db.flush()
    await write_audit(db=db, module="masters", action="create_flavour",
                      record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "flavour created", "id": obj.id}


@router.put("/flavours/{fid}", response_model=success_response)
async def update_flavour(
    fid: int,
    body: flavour_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(flavour_master).where(flavour_master.id == fid).values(**body.model_dump(exclude_unset=True)))
    await write_audit(db=db, module="masters", action="update_flavour",
                      record_id=fid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "flavour updated", "id": fid}


@router.delete("/flavours/{fid}", response_model=success_response)
async def delete_flavour(
    fid: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(flavour_master).where(flavour_master.id == fid).values(is_active=False))
    await write_audit(db=db, module="masters", action="delete_flavour",
                      record_id=fid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "flavour deactivated", "id": fid}


# ── Product Classifications ───────────────────────────────────────────────────

@router.get("/product-classifications", response_model=list[product_classification_out])
async def list_product_classifications(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(select(product_classification).where(product_classification.is_active == True))
    return rows.scalars().all()


@router.post("/product-classifications", response_model=success_response, status_code=201)
async def create_product_classification(
    body: product_classification_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = product_classification(name=body.name, meaning=body.meaning)
    db.add(obj)
    await db.flush()
    await write_audit(db=db, module="masters", action="create_product_classification",
                      record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "product classification created", "id": obj.id}


@router.put("/product-classifications/{pcid}", response_model=success_response)
async def update_product_classification(
    pcid: int,
    body: product_classification_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(product_classification).where(product_classification.id == pcid).values(**body.model_dump(exclude_unset=True)))
    await write_audit(db=db, module="masters", action="update_product_classification",
                      record_id=pcid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "product classification updated", "id": pcid}


@router.delete("/product-classifications/{pcid}", response_model=success_response)
async def delete_product_classification(
    pcid: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(product_classification).where(product_classification.id == pcid).values(is_active=False))
    await write_audit(db=db, module="masters", action="delete_product_classification",
                      record_id=pcid, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "product classification deactivated", "id": pcid}


# ── HSN Master ────────────────────────────────────────────────────────────────

@router.get("/hsn", response_model=paginated_response[hsn_out])
async def list_hsn(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    search: str = Query(""),
    code_type: str | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(hsn_master).where(hsn_master.is_active == True)
    if code_type:
        q = q.where(hsn_master.code_type.ilike(code_type))
    q = q.where(word_match(search, hsn_master.hsn_code, hsn_master.description, hsn_master.category_type))
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    result = await db.execute(q.offset((page - 1) * per_page).limit(per_page))
    rows = result.scalars().all()
    return _paginate(rows, total, page, per_page)


@router.get("/hsn/{hsn_id}", response_model=hsn_out)
async def get_hsn(
    hsn_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(hsn_master).where(hsn_master.id == hsn_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="hsn not found")
    return row


from fastapi import Request

@router.post("/hsn", response_model=success_response, status_code=201)
async def create_hsn(
    request: Request,
    body: hsn_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    raw_data = await request.json()
    print(f"DEBUG RAW REQUEST: {raw_data}")
    print(f"DEBUG: CREATING HSN/SAC: {body.model_dump()}")
    # Validation
    if body.code_type == "SAC":
        if len(body.hsn_code) != 6:
            raise HTTPException(status_code=400, detail="SAC code must be exactly 6 digits")
    else:
        # HSN validation based on company settings
        settings = (await db.execute(select(CompanySetting))).scalar_one_or_none()
        required_len = settings.hsn_code_length if settings else 8
        if len(body.hsn_code) != required_len:
            raise HTTPException(status_code=400, detail=f"HSN code must be exactly {required_len} digits")

    exists = await db.execute(select(hsn_master).where(hsn_master.hsn_code == body.hsn_code))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"{body.code_type} code already exists")
    
    data = body.model_dump()
    obj = hsn_master(**data)
    # Double ensure code_type and category_type are set from input
    obj.code_type = body.code_type
    obj.category_type = body.category_type
    
    db.add(obj)
    await db.flush()
    await write_audit(db=db, module="masters", action="create_hsn",
                      record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"message": "hsn created", "id": obj.id}


@router.put("/hsn/{hsn_id}", response_model=success_response)
async def update_hsn(
    hsn_id: int,
    body: hsn_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump(exclude_none=True)
    if data:
        await db.execute(update(hsn_master).where(hsn_master.id == hsn_id).values(**data))
        await db.commit()
    return {"message": "hsn updated", "id": hsn_id}


@router.delete("/hsn/{hsn_id}", response_model=success_response)
async def delete_hsn(
    hsn_id: int,
    current_user: current_user_dep = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(update(hsn_master).where(hsn_master.id == hsn_id).values(is_active=False))
    await db.commit()
    return {"message": "hsn deactivated", "id": hsn_id}


# ── Item Categories / Groups / Subgroups / Subcategories ──────────────────────

@router.get("/item-categories", response_model=list[item_category_out])
async def list_item_categories(
    subgroup_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import joinedload
    q = select(item_category).options(
        joinedload(item_category.creator),
        joinedload(item_category.subgroup_rel)
    ).where(item_category.is_active == True)
    sc = access.scope()  # a category-limited user sees only their categories
    if sc and sc["categories"] is not None:
        q = q.where(item_category.id.in_(sorted(sc["categories"]) or [0]))
    
    if subgroup_id:
        q = q.where(item_category.subgroup_id == subgroup_id)
        
    rows = await db.execute(q)
    return rows.scalars().all()


@router.post("/item-categories", response_model=success_response, status_code=201)
async def create_item_category(
    body: item_category_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    with open("masters_debug.log", "a") as f:
        f.write(f"\n[{datetime.now()}] START create_item_category: {body.model_dump()}\n")
        try:
            code = body.code
            if not code:
                parent_subgroup = await db.get(item_subgroup, body.subgroup_id)
                prefix = parent_subgroup.code if parent_subgroup else ""
                code = await _generate_next_code(db, item_category, prefix=prefix)
            
            obj = item_category(
                subgroup_id=body.subgroup_id,
                name=body.name,
                code=code,
                short_name=body.short_name,
                parent_id=body.parent_id,
                is_active=True,
                created_by=current_user.user_id,
                updated_by=current_user.user_id
            )
            db.add(obj)
            await db.flush()
            await write_audit(db=db, module="masters", action="create_item_category",
                              record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
            await db.commit()
            f.write("COMMIT SUCCESSFUL\n")
            return {"message": "item category created", "id": obj.id}
        except Exception as e:
            f.write(f"CRITICAL ERROR: {str(e)}\n")
            await db.rollback()
            raise HTTPException(status_code=500, detail=str(e))


@router.put("/item-categories/{cid}", response_model=success_response)
async def update_item_category(
    cid: int,
    body: item_category_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = await db.get(item_category, cid)
    if not obj: raise HTTPException(404, "Category not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items(): setattr(obj, k, v)
    obj.updated_by = current_user.user_id
    await db.commit()
    return {"message": "Category updated", "id": cid}


@router.get("/item-groups", response_model=list[item_group_out])
async def list_item_groups(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import joinedload
    rows = await db.execute(
        select(item_group)
        .options(joinedload(item_group.creator))
        .where(item_group.is_active == True)
        .order_by(item_group.id.asc())
    )
    return rows.scalars().all()


@router.post("/item-groups", response_model=success_response, status_code=201)
async def create_item_group(
    body: item_group_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    print(">>> ENTERING create_item_group")
    data = body.model_dump()
    if not data.get("code"):
        data["code"] = await _generate_next_code(db, item_group, suffix_len=2)
    
    data["created_by"] = current_user.user_id
    data["updated_by"] = current_user.user_id
    
    # Explicitly ensure short_name is handled if present in body but somehow lost in dump
    if hasattr(body, 'short_name'):
        data['short_name'] = body.short_name

    print(f">>> SAVING ITEM GROUP: name={body.name}, short={body.short_name}, user={current_user.user_id}")
    obj = item_group(
        name=body.name,
        code=data.get("code"),
        short_name=body.short_name,
        is_active=True,
        created_by=current_user.user_id,
        updated_by=current_user.user_id
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    print(f">>> SAVED GROUP ID: {obj.id}")
    
    await write_audit(db=db, module="masters", action="create_item_group",
                      record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
    return {"message": "item group created", "id": obj.id}


@router.put("/item-groups/{group_id}", response_model=success_response)
async def update_item_group(
    group_id: int,
    body: item_group_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    print(f">>> UPDATING ITEM GROUP: {group_id}")
    res = await db.execute(select(item_group).where(item_group.id == group_id))
    obj = res.scalar_one_or_none()
    
    if not obj:
        print(f">>> NOT FOUND: {group_id}")
        raise HTTPException(status_code=404, detail=f"item group {group_id} not found")
    
    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(obj, key, value)
    
    obj.updated_by = current_user.user_id
    await db.commit()
    await write_audit(db=db, module="masters", action="update_item_group",
                      record_id=group_id, user_id=current_user.user_id, user_name=current_user.username)
    return {"message": "item group updated"}


@router.get("/item-subgroups", response_model=list[item_subgroup_out])
async def list_item_subgroups(
    group_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import joinedload
    q = select(item_subgroup).options(
        joinedload(item_subgroup.creator),
        joinedload(item_subgroup.group_rel)
    ).where(item_subgroup.is_active == True)
    if group_id:
        q = q.where(item_subgroup.group_id == group_id)
    rows = await db.execute(q)
    return rows.scalars().all()


@router.post("/item-subgroups", response_model=success_response, status_code=201)
async def create_item_subgroup(
    body: item_subgroup_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        # 1. Code Generation
        code = body.code
        if not code:
            parent_group = await db.get(item_group, body.group_id)
            if not parent_group:
                raise HTTPException(status_code=400, detail="Parent group not found")
            prefix = parent_group.code or ""
            code = await _generate_next_code(db, item_subgroup, prefix=prefix)

        # 2. Object Creation
        obj = item_subgroup()
        obj.group_id  = body.group_id
        obj.name      = body.name
        obj.code      = code
        obj.short_name = body.short_name
        obj.is_active = True
        obj.created_by = current_user.user_id
        obj.updated_by = current_user.user_id
        db.add(obj)
        await db.flush()

        # 3. Audit Log (non-critical)
        try:
            await write_audit(db=db, module="masters", action="create_item_subgroup",
                              record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
        except Exception:
            pass

        await db.commit()
        return {"message": "item subgroup created", "id": obj.id}

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/item-subgroups/{sid}", response_model=success_response)
async def update_item_subgroup(
    sid: int,
    body: item_subgroup_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = await db.get(item_subgroup, sid)
    if not obj: raise HTTPException(404, "Subgroup not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items(): setattr(obj, k, v)
    obj.updated_by = current_user.user_id
    await db.commit()
    return {"message": "Subgroup updated", "id": sid}


@router.get("/item-subcategories", response_model=list[item_subcategory_out])
async def list_item_subcategories(
    category_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import joinedload
    q = select(item_subcategory).options(
        joinedload(item_subcategory.creator),
        joinedload(item_subcategory.category_rel),
        joinedload(item_subcategory.default_hsn_rel)
    ).where(item_subcategory.is_active == True)
    sc = access.scope()
    if sc and sc["categories"] is not None:
        q = q.where(item_subcategory.category_id.in_(sorted(sc["categories"]) or [0]))
    if sc and sc["groups"]:
        q = q.where(item_subcategory.id.in_(sorted(sc["groups"])))
    if category_id:
        q = q.where(item_subcategory.category_id == category_id)
    rows = await db.execute(q)
    return rows.scalars().all()


@router.post("/item-subcategories", response_model=success_response, status_code=201)
async def create_item_subcategory(
    body: item_subcategory_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        code = body.code
        if not code:
            parent_cat = await db.get(item_category, body.category_id)
            prefix = parent_cat.code if parent_cat else ""
            code = await _generate_next_code(db, item_subcategory, prefix=prefix)

        obj = item_subcategory(
            category_id=body.category_id,
            name=body.name,
            code=code,
            short_name=body.short_name,
            default_hsn_id=body.default_hsn_id,
            is_active=True,
            created_by=current_user.user_id,
            updated_by=current_user.user_id,
        )
        db.add(obj)
        await db.flush()
        await write_audit(db=db, module="masters", action="create_item_subcategory",
                          record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
        await db.commit()
        return {"message": "item subcategory created", "id": obj.id}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/item-subcategories/{sid}", response_model=success_response)
async def update_item_subcategory(
    sid: int,
    body: item_subcategory_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        obj = await db.get(item_subcategory, sid)
        if not obj:
            raise HTTPException(404, "Subcategory not found")

        data = body.model_dump(exclude_unset=True)
        for k, v in data.items():
            setattr(obj, k, v)

        obj.updated_by = current_user.user_id
        await db.commit()
        await db.refresh(obj)
        return {"message": "Subcategory updated", "id": sid}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sub-brands", response_model=list[sub_category_brand_out])
async def list_sub_brands(
    brand_id: int | None = Query(None),
    subcategory_id: int | None = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import joinedload
    q = select(sub_category_brand).options(
        joinedload(sub_category_brand.creator),
        joinedload(sub_category_brand.brand_rel)
    ).where(sub_category_brand.is_active == True)
    if brand_id:
        q = q.where(sub_category_brand.brand_id == brand_id)
    if subcategory_id:
        q = q.where(sub_category_brand.subcategory_id == subcategory_id)
    rows = await db.execute(q)
    return rows.scalars().all()


@router.post("/sub-brands", response_model=success_response, status_code=201)
async def create_sub_brand(
    body: sub_category_brand_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    try:
        code = getattr(body, 'code', None)
        if not code:
            parent = await db.get(brand, body.brand_id)
            prefix = parent.code if parent and parent.code else ""
            code = await _generate_next_code(db, sub_category_brand, prefix=prefix, suffix_len=2)

        obj = sub_category_brand(
            brand_id=body.brand_id,
            subcategory_id=body.subcategory_id,
            name=body.name,
            code=code,
            short_name=body.short_name,
            is_active=True,
            created_by=current_user.user_id,
            updated_by=current_user.user_id,
        )
        db.add(obj)
        await db.flush()
        await write_audit(db=db, module="masters", action="create_sub_brand",
                          record_id=obj.id, user_id=current_user.user_id, user_name=current_user.username)
        await db.commit()
        return {"message": "sub brand created", "id": obj.id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Sub-brand creation failed: {str(e)}")


@router.put("/sub-brands/{sbid}", response_model=success_response)
async def update_sub_brand(
    sbid: int,
    body: sub_category_brand_update,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = await db.get(sub_category_brand, sbid)
    if not obj: raise HTTPException(404, "Sub-brand not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items(): setattr(obj, k, v)
    obj.updated_by = current_user.user_id
    await db.commit()
    return {"message": "Sub-brand updated", "id": sbid}


@router.get("/countries", response_model=list[country_out])
async def list_countries(
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(select(country).where(country.is_active == True))
    return rows.scalars().all()


@router.post("/countries", response_model=success_response, status_code=201)
async def create_country(
    body: country_create,
    current_user: current_user_dep = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    obj = country(name=body.name, code=body.code)
    db.add(obj)
    await db.flush()
    await db.commit()
    return {"message": "country created", "id": obj.id}


# ── Suggested HSN Logic ───────────────────────────────────────────────────────

@router.get("/suggested-hsn/{subcategory_id}", response_model=hsn_out)
async def get_suggested_hsn(
    subcategory_id: int,
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import joinedload
    subcat = await db.execute(
        select(item_subcategory)
        .options(joinedload(item_subcategory.default_hsn_rel))
        .where(item_subcategory.id == subcategory_id)
    )
    obj = subcat.scalar_one_or_none()
    if not obj or not obj.default_hsn_rel:
        raise HTTPException(status_code=404, detail="No suggested HSN for this subcategory")
    return obj.default_hsn_rel
