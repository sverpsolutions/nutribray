import random
import string
import base64
import os
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from fastapi import HTTPException, status
from app.models.product import (
    product as product_model, product_barcode,
    hsn_exception_log, hsn_history, hsn_master
)
from app.schemas.product import product_create, product_update
from app.services.auth_service import write_audit
from app.models.outlet import outlet as outlet_model
from app.models.product import (
    outlet_pricing, item_group, item_subgroup, item_category, 
    item_subcategory, brand, sub_category_brand, variant_master, 
    flavour_master
)

async def sync_filter_combination(prod: product_model, db: AsyncSession):
    """
    Generate and save the filter_combination_name based on the hierarchy IDs.
    Sequence: GROUP#SUB GROUP#CATEGORY#SUB CATEGORY#BRAND#SUB BRAND#VARIANT#FLAVOUR
    """
    parts = []
    
    # 1. Group
    if prod.group_id:
        res = await db.execute(select(item_group.name).where(item_group.id == prod.group_id))
        parts.append(res.scalar() or "")
    else: parts.append("")

    # 2. Sub Group
    if prod.subgroup_id:
        res = await db.execute(select(item_subgroup.name).where(item_subgroup.id == prod.subgroup_id))
        parts.append(res.scalar() or "")
    else: parts.append("")

    # 3. Category
    if prod.category_id:
        res = await db.execute(select(item_category.name).where(item_category.id == prod.category_id))
        parts.append(res.scalar() or "")
    else: parts.append("")

    # 4. Sub Category
    if prod.subcategory_id:
        res = await db.execute(select(item_subcategory.name).where(item_subcategory.id == prod.subcategory_id))
        parts.append(res.scalar() or "")
    else: parts.append("")

    # 5. Brand
    if prod.brand_id:
        res = await db.execute(select(brand.name).where(brand.id == prod.brand_id))
        parts.append(res.scalar() or "")
    else: parts.append("")

    # 6. Sub Brand
    if prod.sub_category_brand_id:
        res = await db.execute(select(sub_category_brand.name).where(sub_category_brand.id == prod.sub_category_brand_id))
        parts.append(res.scalar() or "")
    else: parts.append("")

    # 7. Variant
    if prod.variant_id:
        res = await db.execute(select(variant_master.name).where(variant_master.id == prod.variant_id))
        parts.append(res.scalar() or "")
    else: parts.append("")

    # 8. Flavour
    if prod.flavour_id:
        res = await db.execute(select(flavour_master.name).where(flavour_master.id == prod.flavour_id))
        parts.append(res.scalar() or "")
    else: parts.append("")

    prod.filter_combination_name = "#".join(parts)

async def propagate_product_prices(product_id: int, db: AsyncSession):
    """
    Push product prices to outlets based on the product's price_update_level and target.
    """
    # 1. Get the product
    prod_res = await db.execute(select(product_model).where(product_model.id == product_id))
    prod = prod_res.scalar_one_or_none()
    if not prod:
        return

    level = prod.price_update_level
    target = prod.price_update_target

    # 2. Find target outlets
    q = select(outlet_model).where(outlet_model.is_active == True)
    
    if level == "City Level" and target:
        q = q.where(outlet_model.city == target)
    elif level == "State Level" and target:
        q = q.where(outlet_model.state == target)
    elif level == "Store Type Level" and target:
        q = q.where(outlet_model.store_type == target)
    elif level == "All Store Level":
        pass # All outlets
    else:
        return # Selective is handled manually in UI generally

    outlets = (await db.execute(q)).scalars().all()
    
    for o in outlets:
        # Check if pricing exists for this outlet
        pricing_res = await db.execute(
            select(outlet_pricing).where(
                outlet_pricing.product_id == product_id,
                outlet_pricing.outlet_id == o.id
            )
        )
        pricing = pricing_res.scalar_one_or_none()
        
        if pricing:
            pricing.cost_price = prod.cost_price
            pricing.mrp = prod.mrp
            pricing.selling_price = prod.selling_price
            pricing.wsp = prod.wsp
        else:
            new_pricing = outlet_pricing(
                product_id=product_id,
                outlet_id=o.id,
                cost_price=prod.cost_price,
                mrp=prod.mrp,
                selling_price=prod.selling_price,
                wsp=prod.wsp,
                is_active=True
            )
            db.add(new_pricing)
    
    await db.flush()


def generate_ean13() -> str:
    """
    Generate a valid EAN-13 barcode number.
    First 12 digits random, 13th is the check digit.
    """
    digits = [random.randint(0, 9) for _ in range(12)]
    # calculate check digit
    even_sum = sum(digits[i] for i in range(1, 12, 2))
    odd_sum = sum(digits[i] for i in range(0, 12, 2))
    check = (10 - ((odd_sum + even_sum * 3) % 10)) % 10
    digits.append(check)
    return "".join(str(d) for d in digits)


def save_product_image(base64_str: str, filename: str) -> str:
    """Saves base64 image as a file and returns the path."""
    if not base64_str or not base64_str.startswith("data:image"):
        return base64_str
    
    try:
        header, encoded = base64_str.split(",", 1)
        # Extract extension
        ext = "png"
        if "jpeg" in header or "jpg" in header: ext = "jpg"
        elif "webp" in header: ext = "webp"
        elif "gif" in header: ext = "gif"
        
        directory = "uploads/products"
        if not os.path.exists(directory):
            os.makedirs(directory)
            
        file_path = f"{directory}/{filename}.{ext}"
        with open(file_path, "wb") as f:
            f.write(base64.b64decode(encoded))
            
        return f"/uploads/products/{filename}.{ext}"
    except Exception as e:
        print(f"Error saving image: {e}")
        return base64_str


def generate_item_code(name: str) -> str:
    prefix = "".join(c.upper() for c in name if c.isalpha())[:4]
    suffix = "".join(random.choices(string.digits + string.ascii_uppercase, k=6))
    return f"{prefix}{suffix}"


async def create_product(
    body: product_create,
    db: AsyncSession,
    user_id: int,
    username: str,
) -> product_model:
    # auto-generate item_code if not provided
    item_code = body.item_code or generate_item_code(body.name)

    # check barcode uniqueness if provided
    if body.barcode:
        existing = await db.execute(
            select(product_barcode).where(product_barcode.barcode == body.barcode)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"barcode '{body.barcode}' already exists"
            )

    # check PLU code uniqueness and mandatory status
    if body.is_weighing_item and not body.plu_code:
        raise HTTPException(status_code=400, detail="PLU code is mandatory for weighing items")
    
    if body.plu_code:
        existing_plu = await db.execute(
            select(product_model).where(product_model.plu_code == body.plu_code)
        )
        if existing_plu.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"PLU code {body.plu_code} already exists")

    # sync denormalized fields from FK if provided
    synced = body.model_dump()
    if body.hsn_id and not body.hsn_code:
        from app.models.product import hsn_master
        hsn_row = await db.execute(select(hsn_master).where(hsn_master.id == body.hsn_id))
        hsn = hsn_row.scalar_one_or_none()
        if hsn:
            synced["hsn_code"] = hsn.hsn_code
            if float(synced.get("gst_percent", 0)) == 0:
                synced["gst_percent"] = hsn.gst_percent

    if body.brand_id and not body.brand:
        from app.models.product import brand
        brand_row = await db.execute(select(brand).where(brand.id == body.brand_id))
        b = brand_row.scalar_one_or_none()
        if b:
            synced["brand"] = b.name

    if body.category_id and not body.category:
        from app.models.product import item_category
        cat_row = await db.execute(select(item_category).where(item_category.id == body.category_id))
        c = cat_row.scalar_one_or_none()
        if c:
            synced["category"] = c.name

    # Auto-create or fetch sub_category_brand
    if body.brand_id and body.subcategory_id:
        from app.models.product import sub_category_brand, item_subcategory, brand
        scb_query = await db.execute(
            select(sub_category_brand)
            .where(
                sub_category_brand.brand_id == body.brand_id,
                sub_category_brand.subcategory_id == body.subcategory_id
            )
        )
        scb = scb_query.scalar_one_or_none()
        
        if not scb:
            b_row = await db.execute(select(brand).where(brand.id == body.brand_id))
            b_obj = b_row.scalar_one_or_none()
            sc_row = await db.execute(select(item_subcategory).where(item_subcategory.id == body.subcategory_id))
            sc_obj = sc_row.scalar_one_or_none()
            
            if b_obj and sc_obj:
                scb = sub_category_brand(
                    name=f"{b_obj.name} {sc_obj.name}",
                    brand_id=b_obj.id,
                    subcategory_id=sc_obj.id,
                    short_name=None,
                    updated_by=user_id
                )
                db.add(scb)
                await db.flush()
                
        if scb:
            synced["sub_category_brand_id"] = scb.id

    # Ensure item_code is unique
    for _ in range(5):
        existing_code = await db.execute(
            select(product_model.id).where(product_model.item_code == item_code)
        )
        if not existing_code.scalar_one_or_none():
            break
        item_code = generate_item_code(body.name)

    synced['item_code'] = item_code
    
    # Save images to file system
    img_prefix = body.barcode or item_code
    if body.img_front: synced['img_front'] = save_product_image(body.img_front, f"{img_prefix}_front")
    if body.img_back:  synced['img_back']  = save_product_image(body.img_back,  f"{img_prefix}_back")
    if body.img_top:   synced['img_top']   = save_product_image(body.img_top,   f"{img_prefix}_top")
    if body.img_side:  synced['img_side']  = save_product_image(body.img_side,  f"{img_prefix}_side")
    
    # Backward compatibility for thumbnail
    if synced.get('img_front'):
        synced['thumbnail_img'] = synced['img_front']
    elif body.thumbnail_img:
        synced['thumbnail_img'] = save_product_image(body.thumbnail_img, f"{img_prefix}_thumb")

    new_product = product_model(
        **{k: v for k, v in synced.items() if hasattr(product_model, k)},
        stock_qty=0,
        stock_pcs=0,
    )
    db.add(new_product)
    try:
        await db.flush()
    except Exception as e:
        import traceback
        try:
            os.makedirs("scratch", exist_ok=True)
            with open("scratch/debug_payload.txt", "w") as f:
                f.write(traceback.format_exc())
                f.write("\n\n")
                for k, v in synced.items():
                    f.write(f"{k} = {repr(v)} ({type(v)})\n")
        except Exception:
            pass
        raise e

    # create barcode record
    barcode_val = body.barcode or generate_ean13()
    db.add(product_barcode(
        product_id=new_product.id,
        barcode=barcode_val,
        barcode_type="EAN13",
        is_primary=True,
    ))

    # sync barcode back to products.barcode column
    new_product.barcode = barcode_val

    # HSN Mismatch Exception Logging
    if body.hsn_id and body.suggested_hsn_id and body.hsn_id != body.suggested_hsn_id:
        db.add(hsn_exception_log(
            product_id=new_product.id,
            item_code=new_product.item_code,
            subcategory_id=body.subcategory_id,
            suggested_hsn_id=body.suggested_hsn_id,
            entered_hsn_id=body.hsn_id,
            user_id=user_id,
            reason="Initial creation mismatch"
        ))

    # Sync filter combination
    await sync_filter_combination(new_product, db)

    # Propagate prices (best-effort — use savepoint so FK errors don't kill the main transaction)
    try:
        async with db.begin_nested():
            await propagate_product_prices(new_product.id, db)
    except Exception:
        pass

    await write_audit(
        db=db,
        module="products",
        action="create",
        record_id=new_product.id,
        record_no=new_product.item_code,
        description=f"product '{new_product.name}' created",
        user_id=user_id,
        user_name=username,
    )

    await db.commit()
    await db.refresh(new_product)
    return new_product


async def update_product(
    product_id: int,
    body: product_update,
    db: AsyncSession,
    user_id: int,
    username: str,
) -> product_model:
    result = await db.execute(select(product_model).where(product_model.id == product_id))
    prod = result.scalar_one_or_none()
    if not prod:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="product not found")

    update_data = body.model_dump(exclude_none=True)
    update_data["updated_at"] = datetime.utcnow()

    # Save images to file system
    img_prefix = update_data.get('barcode') or prod.barcode or update_data.get('item_code') or prod.item_code
    if update_data.get('img_front'): update_data['img_front'] = save_product_image(update_data['img_front'], f"{img_prefix}_front")
    if update_data.get('img_back'):  update_data['img_back']  = save_product_image(update_data['img_back'],  f"{img_prefix}_back")
    if update_data.get('img_top'):   update_data['img_top']   = save_product_image(update_data['img_top'],   f"{img_prefix}_top")
    if update_data.get('img_side'):  update_data['img_side']  = save_product_image(update_data['img_side'],  f"{img_prefix}_side")
    
    if update_data.get('img_front'):
        update_data['thumbnail_img'] = update_data['img_front']
    elif update_data.get('thumbnail_img'):
        update_data['thumbnail_img'] = save_product_image(update_data['thumbnail_img'], f"{img_prefix}_thumb")

    # Validate PLU on update
    is_weighing = update_data.get('is_weighing_item', prod.is_weighing_item)
    plu = update_data.get('plu_code', prod.plu_code)
    
    if is_weighing and not plu:
        raise HTTPException(status_code=400, detail="PLU code is mandatory for weighing items")
    
    if plu and plu != prod.plu_code:
        existing_plu = await db.execute(
            select(product_model).where(product_model.plu_code == plu)
        )
        if existing_plu.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"PLU code {plu} already exists")

    # Track HSN History
    old_hsn_id = prod.hsn_id
    new_hsn_id = update_data.get('hsn_id', old_hsn_id)
    if new_hsn_id and new_hsn_id != old_hsn_id:
        db.add(hsn_history(
            product_id=product_id,
            old_hsn_id=old_hsn_id,
            new_hsn_id=new_hsn_id,
            changed_by=user_id
        ))

    # Track HSN Exception (if updated or if mismatch persists)
    s_hsn_id = update_data.get('suggested_hsn_id', prod.suggested_hsn_id)
    if new_hsn_id and s_hsn_id and new_hsn_id != s_hsn_id:
        # Log mismatch if it's a new mismatch or updated
        db.add(hsn_exception_log(
            product_id=product_id,
            item_code=prod.item_code,
            subcategory_id=update_data.get('subcategory_id', prod.subcategory_id),
            suggested_hsn_id=s_hsn_id,
            entered_hsn_id=new_hsn_id,
            user_id=user_id,
            reason="Update mismatch"
        ))

    # Update object attributes
    for k, v in update_data.items():
        setattr(prod, k, v)
    
    # Sync filter combination
    await sync_filter_combination(prod, db)

    # Propagate prices (best-effort — use savepoint so FK errors don't kill the main transaction)
    try:
        async with db.begin_nested():
            await propagate_product_prices(product_id, db)
    except Exception:
        pass
    await write_audit(
        db=db,
        module="products",
        action="update",
        record_id=product_id,
        description=f"product {product_id} updated",
        user_id=user_id,
        user_name=username,
    )
    await db.commit()
    await db.refresh(prod)
    return prod


async def add_barcode(
    product_id: int,
    barcode_val: str,
    barcode_type: str,
    is_primary: bool,
    db: AsyncSession,
    user_id: int,
    username: str,
) -> product_barcode:
    # check product exists
    result = await db.execute(select(product_model).where(product_model.id == product_id))
    prod = result.scalar_one_or_none()
    if not prod:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="product not found")

    # check barcode uniqueness
    existing = await db.execute(
        select(product_barcode).where(product_barcode.barcode == barcode_val)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"barcode '{barcode_val}' already assigned to another product"
        )

    if is_primary:
        # demote existing primary
        await db.execute(
            update(product_barcode)
            .where(product_barcode.product_id == product_id, product_barcode.is_primary == True)
            .values(is_primary=False)
        )

    new_bc = product_barcode(
        product_id=product_id,
        barcode=barcode_val,
        barcode_type=barcode_type,
        is_primary=is_primary,
    )
    db.add(new_bc)

    if is_primary:
        await db.execute(
            update(product_model).where(product_model.id == product_id).values(barcode=barcode_val)
        )

    await write_audit(
        db=db, module="products", action="add_barcode",
        record_id=product_id, new_data=barcode_val,
        user_id=user_id, user_name=username,
    )
    await db.commit()
    await db.refresh(new_bc)
    return new_bc
