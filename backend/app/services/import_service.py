import os
import pandas as pd
import json
from datetime import datetime
from app.core import access
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert, func, and_
from app.models.product import (
    product as product_model, item_group, item_subgroup, item_category,
    item_subcategory, brand as brand_model, sub_category_brand, variant_master, flavour_master,
    manufacturer as manufacturer_model, sub_manufacturer as sub_manufacturer_model,
    product_classification, product_barcode, unit_master
)
from app.models.packaging import (
    storage_type_master, temperature_category_master, item_packaging_master
)
from app.models.import_log import product_import_log

COL_MAP = {
    'ITEM CODE': 'item_code', 'ITEM NAME': 'name', 'BILL PRINT NAME': 'bill_print_name',
    'FULL ITEM NAME': 'full_item_name', 'GROUP': 'group_name', 'SUB GROUP': 'subgroup_name',
    'CATEGORY': 'category_name', 'SUB CATEGORY': 'subcategory_name', 'BRAND': 'brand_name',
    'SUB BRAND': 'subbrand_name', 'VARIANT': 'variant_name', 'FLAVOUR': 'flavour_name',
    'MANUFACTURE': 'manufacturer_name', 'SUB MANUFACTURE': 'submanufacturer_name',
    'CLASSIFICATION': 'classification_name', 'BASE UOM': 'base_uom', 'PURCHASE UOM': 'purchase_uom',
    'SALES UOM': 'sales_uom', 'INNER PACK': 'inner_pack_qty', 'OUTER CARTON': 'outer_carton_qty',
    'GST %': 'gst_percent', 'HSN CODE': 'hsn_code', 'BARCODE': 'barcode', 'MRP': 'mrp',
    'COST PRICE': 'cost_price', 'SALE PRICE': 'selling_price', 'STORAGE TYPE': 'storage_type',
    'TEMPERATURE TYPE': 'temperature_type', 'ACTIVE STATUS': 'is_active'
}

async def generate_template(db: AsyncSession):
    groups = (await db.execute(select(item_group.name))).scalars().all()
    subgroups = (await db.execute(select(item_subgroup.name))).scalars().all()
    categories = (await db.execute(select(item_category.name))).scalars().all()
    subcategories = (await db.execute(select(item_subcategory.name))).scalars().all()
    brands = (await db.execute(select(brand_model.name))).scalars().all()
    subbrands = (await db.execute(select(sub_category_brand.name))).scalars().all()
    variants = (await db.execute(select(variant_master.name))).scalars().all()
    flavours = (await db.execute(select(flavour_master.name))).scalars().all()
    manufacturers = (await db.execute(select(manufacturer_model.name))).scalars().all()
    classifications = (await db.execute(select(product_classification.name))).scalars().all()
    uoms = (await db.execute(select(unit_master.unit_code))).scalars().all()
    stor_types = (await db.execute(select(storage_type_master.name))).scalars().all()
    temp_types = (await db.execute(select(temperature_category_master.name))).scalars().all()

    df = pd.DataFrame(columns=COL_MAP.keys())
    sample_row = {
        'ITEM CODE': 'FMCG001', 'ITEM NAME': 'Amul Butter 500g', 'BILL PRINT NAME': 'Amul Butter 500g',
        'FULL ITEM NAME': 'Amul Butter 500g Salted', 'GROUP': groups[0] if groups else 'FMCG Food',
        'SUB GROUP': subgroups[0] if subgroups else 'Grocery', 'CATEGORY': categories[0] if categories else 'Dairy Product',
        'SUB CATEGORY': subcategories[0] if subcategories else 'Butter', 'BRAND': brands[0] if brands else 'Amul',
        'SUB BRAND': subbrands[0] if subbrands else 'Butter', 'VARIANT': variants[0] if variants else '500gm',
        'FLAVOUR': flavours[0] if flavours else 'Salted', 'MANUFACTURE': manufacturers[0] if manufacturers else 'AMUL',
        'SUB MANUFACTURE': '', 'CLASSIFICATION': classifications[0] if classifications else 'Regular',
        'BASE UOM': uoms[0] if uoms else 'PCS', 'PURCHASE UOM': uoms[0] if uoms else 'PCS', 'SALES UOM': uoms[0] if uoms else 'PCS',
        'INNER PACK': 12, 'OUTER CARTON': 6, 'GST %': 12, 'HSN CODE': '04051000', 'BARCODE': '8901234567890',
        'MRP': 250, 'COST PRICE': 210, 'SALE PRICE': 240, 'STORAGE TYPE': stor_types[0] if stor_types else 'Dry',
        'TEMPERATURE TYPE': temp_types[0] if temp_types else 'Normal', 'ACTIVE STATUS': 'ACTIVE'
    }
    df.loc[0] = sample_row

    output_path = "uploads/product_template.xlsx"
    if not os.path.exists("uploads"): os.makedirs("uploads")
    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Item Master')
        val_df = pd.DataFrame({
            'Groups': pd.Series(groups), 'SubGroups': pd.Series(subgroups), 'Categories': pd.Series(categories),
            'SubCategories': pd.Series(subcategories), 'Brands': pd.Series(brands), 'SubBrands': pd.Series(subbrands),
            'Variants': pd.Series(variants), 'Flavours': pd.Series(flavours), 'Manufacturers': pd.Series(manufacturers),
            'Classifications': pd.Series(classifications), 'UOMs': pd.Series(uoms),
            'StorageTypes': pd.Series(stor_types), 'TempTypes': pd.Series(temp_types), 'Status': pd.Series(['ACTIVE', 'INACTIVE'])
        })
        val_df.to_excel(writer, index=False, sheet_name='Validations')
    return output_path

async def get_or_create_simple(db: AsyncSession, model, name: str, auto_create: bool):
    """For models without hierarchical parent (variant, flavour)."""
    if not name: return None
    q = select(model).where(model.name == name)
    res = (await db.execute(q)).scalar_one_or_none()
    if res: return res.id
    if auto_create:
        new_m = model(name=name)
        db.add(new_m)
        await db.flush()
        return new_m.id
    return None

async def get_or_create_hierarchical(db: AsyncSession, model, name: str, parent_field: str, parent_id, auto_create: bool):
    """For models with a parent FK (subgroup→group, category→subgroup, etc.)."""
    if not name or parent_id is None: return None
    q = select(model).where(and_(model.name == name, getattr(model, parent_field) == parent_id))
    res = (await db.execute(q)).scalar_one_or_none()
    if res: return res.id
    if auto_create:
        new_m = model(name=name, **{parent_field: parent_id})
        db.add(new_m)
        await db.flush()
        return new_m.id
    return None

async def validate_and_preview(file_path: str, db: AsyncSession):
    if file_path.endswith('.csv'):
        df = pd.read_csv(file_path)
    else:
        # Smart header detection — find the row containing 'ITEM CODE'
        df_raw = pd.read_excel(file_path, sheet_name=0, header=None, nrows=20)
        header_row = 0
        for i, row in df_raw.iterrows():
            if any(str(v).strip().upper() == 'ITEM CODE' for v in row.values if pd.notnull(v)):
                header_row = i
                break
        df = pd.read_excel(file_path, sheet_name=0, header=header_row)
    df = df.where(pd.notnull(df), None)
    # Strip whitespace from column names
    df.columns = [str(c).strip() for c in df.columns]
    # Drop fully empty rows
    df = df.dropna(how='all').reset_index(drop=True)

    # Pre-fetch for validation
    groups = {r.name: r.id for r in (await db.execute(select(item_group))).scalars().all()}
    subgroups = {r.name: (r.id, r.group_id) for r in (await db.execute(select(item_subgroup))).scalars().all()}
    categories = {r.name: (r.id, r.subgroup_id) for r in (await db.execute(select(item_category))).scalars().all()}
    subcategories = {r.name: (r.id, r.category_id) for r in (await db.execute(select(item_subcategory))).scalars().all()}
    brands = {r.name: (r.id, r.subcategory_id) for r in (await db.execute(select(brand_model))).scalars().all()}
    subbrands = {r.name: (r.id, r.brand_id) for r in (await db.execute(select(sub_category_brand))).scalars().all()}
    uoms = {r.unit_code: r.id for r in (await db.execute(select(unit_master))).scalars().all()}

    existing_barcodes = set((await db.execute(select(product_barcode.barcode))).scalars().all())
    existing_item_codes = set((await db.execute(select(product_model.item_code))).scalars().all())

    preview_rows = []
    total_valid = 0
    total_error = 0

    for idx, row in df.iterrows():
        errors = []
        raw_d = row.to_dict()
        # Convert numpy types to JSON-safe Python types
        d = {}
        for k, v in raw_d.items():
            if v is None or (isinstance(v, float) and pd.isna(v)):
                d[k] = ''
            elif hasattr(v, 'item'):  # numpy scalar
                d[k] = v.item()
            else:
                d[k] = str(v) if not isinstance(v, (int, float, str, bool)) else v
        row_idx = idx + 2

        # DB Duplicates
        if d.get('BARCODE') and str(d.get('BARCODE')) in existing_barcodes:
            errors.append(f"Barcode '{d.get('BARCODE')}' already exists in database")
        if d.get('ITEM CODE') and str(d.get('ITEM CODE')) in existing_item_codes:
            errors.append(f"Item Code '{d.get('ITEM CODE')}' already exists in database")

        # Hierarchy validation
        g_id = groups.get(d.get('GROUP'))
        if not g_id: errors.append(f"Group '{d.get('GROUP')}' not found")

        sg_info = subgroups.get(d.get('SUB GROUP'))
        if sg_info and g_id and sg_info[1] != g_id: errors.append(f"Sub Group '{d.get('SUB GROUP')}' mismatch with Group")

        c_info = categories.get(d.get('CATEGORY'))
        if c_info and sg_info and c_info[1] != sg_info[0]: errors.append(f"Category mismatch with Sub Group")

        preview_rows.append({'row': row_idx, 'data': d, 'errors': errors, 'is_valid': len(errors) == 0})
        if len(errors) == 0: total_valid += 1
        else: total_error += 1

    return {'rows': preview_rows, 'total_rows': len(df), 'total_valid': total_valid, 'total_error': total_error}

async def process_import(file_path: str, user_id: int, db: AsyncSession, auto_create: bool = True):
    preview = await validate_and_preview(file_path, db)
    if preview['total_valid'] == 0: return {'success': False, 'message': 'No valid rows'}

    # Caches
    cache = {
        'group': {r.name: r.id for r in (await db.execute(select(item_group))).scalars().all()},
        'unit': {r.unit_code: r.id for r in (await db.execute(select(unit_master))).scalars().all()},
        'class': {r.name: r.id for r in (await db.execute(select(product_classification))).scalars().all()},
        'storage': {r.name: r.id for r in (await db.execute(select(storage_type_master))).scalars().all()},
        'temp': {r.name: r.id for r in (await db.execute(select(temperature_category_master))).scalars().all()},
        'man': {r.name: r.id for r in (await db.execute(select(manufacturer_model))).scalars().all()}
    }

    imported_count = 0
    errors_log = []

    async with db.begin():
        for row in preview['rows']:
            if not row['is_valid']:
                errors_log.append({'row': row['row'], 'errors': row['errors']})
                continue

            try:
                d = row['data']
                # 1. Resolve Hierarchy (Auto-create if needed)
                g_id = cache['group'].get(d.get('GROUP'))
                if not g_id and auto_create:
                    new_g = item_group(name=d.get('GROUP'), created_by=user_id)
                    db.add(new_g); await db.flush(); g_id = new_g.id; cache['group'][d.get('GROUP')] = g_id

                sg_id = await get_or_create_hierarchical(db, item_subgroup, d.get('SUB GROUP'), 'group_id', g_id, auto_create)
                c_id = await get_or_create_hierarchical(db, item_category, d.get('CATEGORY'), 'subgroup_id', sg_id, auto_create)
                sc_id = await get_or_create_hierarchical(db, item_subcategory, d.get('SUB CATEGORY'), 'category_id', c_id, auto_create)
                access.check_category(c_id, sc_id)  # each row must sit in the importer's categories / groups
                b_id = await get_or_create_hierarchical(db, brand_model, d.get('BRAND'), 'subcategory_id', sc_id, auto_create)
                sb_id = await get_or_create_hierarchical(db, sub_category_brand, d.get('SUB BRAND'), 'brand_id', b_id, auto_create)

                # 2. Non-hierarchical masters
                v_id = await get_or_create_simple(db, variant_master, d.get('VARIANT'), auto_create) if d.get('VARIANT') else None
                f_id = await get_or_create_simple(db, flavour_master, d.get('FLAVOUR'), auto_create) if d.get('FLAVOUR') else None
                m_id = cache['man'].get(d.get('MANUFACTURE'))

                # Filter combo
                combo = [d.get('GROUP'), d.get('SUB GROUP'), d.get('CATEGORY'), d.get('SUB CATEGORY'), d.get('BRAND'), d.get('SUB BRAND'), d.get('VARIANT'), d.get('FLAVOUR')]
                filter_combo = "#".join([str(x) for x in combo if x])

                # 3. Create Product
                new_prod = product_model(
                    item_code=str(d.get('ITEM CODE')) if d.get('ITEM CODE') else None,
                    name=d.get('ITEM NAME'), bill_print_name=d.get('BILL PRINT NAME') or d.get('ITEM NAME'),
                    full_item_name=d.get('FULL ITEM NAME') or d.get('ITEM NAME'),
                    category=d.get('CATEGORY') or '',
                    group_id=g_id, subgroup_id=sg_id, category_id=c_id, subcategory_id=sc_id,
                    brand_id=b_id, sub_category_brand_id=sb_id, variant_id=v_id, flavour_id=f_id,
                    manufacturer_id=m_id, classification_id=cache['class'].get(d.get('CLASSIFICATION')),
                    unit_id=cache['unit'].get(d.get('BASE UOM')), unit=d.get('BASE UOM') or 'PCS',
                    hsn_code=str(d.get('HSN CODE')) if d.get('HSN CODE') else None,
                    barcode=str(d.get('BARCODE')), gst_percent=d.get('GST %') or 0,
                    mrp=d.get('MRP') or 0, cost_price=d.get('COST PRICE') or 0, selling_price=d.get('SALE PRICE') or 0,
                    is_active=True if str(d.get('ACTIVE STATUS')).upper() == 'ACTIVE' else False,
                    filter_combination_name=filter_combo, created_by=user_id
                )
                db.add(new_prod); await db.flush()

                # Primary Barcode
                db.add(product_barcode(product_id=new_prod.id, barcode=str(d.get('BARCODE')), is_primary=True))

                # Packaging
                base_uom_id = cache['unit'].get(d.get('BASE UOM'))
                db.add(item_packaging_master(
                    product_id=new_prod.id,
                    base_uom_id=base_uom_id,
                    purchase_uom_id=cache['unit'].get(d.get('PURCHASE UOM')) or base_uom_id,
                    sales_uom_id=cache['unit'].get(d.get('SALES UOM')) or base_uom_id,
                    inner_pack_qty=d.get('INNER PACK') or 1, outer_carton_qty=d.get('OUTER CARTON') or 1,
                    total_units_per_carton=(d.get('INNER PACK') or 1) * (d.get('OUTER CARTON') or 1),
                    storage_type_id=cache['storage'].get(d.get('STORAGE TYPE')),
                    temperature_category_id=cache['temp'].get(d.get('TEMPERATURE TYPE'))
                ))
                imported_count += 1
            except Exception as e:
                errors_log.append({'row': row['row'], 'errors': [str(e)]})

        # Log
        log = product_import_log(
            filename=os.path.basename(file_path), total_rows=len(preview['rows']),
            success_rows=imported_count, failed_rows=len(preview['rows']) - imported_count,
            error_summary=errors_log, created_by=user_id
        )
        db.add(log)
    return {'success': True, 'imported': imported_count, 'failed': len(preview['rows']) - imported_count}
