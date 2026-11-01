from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, update, text, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from app.core.database import get_db
from app.core.config import get_settings
from sqlalchemy.engine import make_url
from app.core.dependencies import get_current_user
from app.core.scope import get_user_scope, UserScope
from app.models.outlet import outlet, region, outlet_zone
from app.models.company import CompanySetting
from app.models.user import user as UserModel
from app.schemas.outlet import (
    OutletCreate, OutletOut, 
    RegionCreate, RegionOut, 
    ZoneCreate, ZoneOut, 
    CompanyHierarchy, HierarchyRegion, HierarchyZone, HierarchyStore
)
import asyncio
from typing import Optional, List
from urllib.parse import quote_plus

router = APIRouter(prefix="/outlets", tags=["outlets"], dependencies=[Depends(get_current_user)])


# ─────────────────────────────────────────────────────────────
# COMPANY HIERARCHY TREE
# ─────────────────────────────────────────────────────────────
@router.get("/hierarchy", response_model=CompanyHierarchy)
async def get_company_hierarchy(
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Returns the complete Company -> Region -> Zone -> Store hierarchy tree."""
    # 1. Company Details
    company_row = (await db.execute(select(CompanySetting).order_by(CompanySetting.id))).scalars().first()
    comp_name = getattr(company_row, "legal_name", None) or "Nutribay"
    brand_name = getattr(company_row, "brand_name", None) or "nutribay"
    ho_addr = getattr(company_row, "ho_address", None) or "TR-311, 312, ALTF Mohan Cooperative Industrial Estate, South Delhi – 110076"
    ho_ph = getattr(company_row, "ho_phone", None) or "74003 39365"
    ho_em = getattr(company_row, "ho_email", None) or ""
    logo_path = getattr(company_row, "logo_path", None) or "/nutribay_logo.svg"

    # 2. Fetch all active regions, zones, and outlets
    regions_res = await db.execute(select(region).where(region.is_active == True).order_by(region.name))
    regions_list = regions_res.scalars().all()

    zones_res = await db.execute(select(outlet_zone).where(outlet_zone.is_active == True).order_by(outlet_zone.name))
    zones_list = zones_res.scalars().all()

    outlets_res = await db.execute(select(outlet).where(outlet.is_active == True).order_by(outlet.unit_code))
    outlets_list = outlets_res.scalars().all()

    # Build Map of Outlets by zone_id
    outlets_by_zone = {}
    for o in outlets_list:
        zid = o.zone_id or 0
        if zid not in outlets_by_zone:
            outlets_by_zone[zid] = []
        outlets_by_zone[zid].append(HierarchyStore(
            id=o.id,
            unit_code=o.unit_code,
            outlet_name=o.outlet_name,
            display_name=o.display_name or o.outlet_name,
            city=o.city,
            state=o.state,
            pincode=o.pincode,
            manager_name=o.manager_name,
            manager_mobile=o.manager_mobile,
            store_type=o.store_type,
            store_category=o.store_category,
            is_active=o.is_active
        ))

    # Build Map of Zones by region_id
    zones_by_region = {}
    for z in zones_list:
        rid = z.region_id or 0
        if rid not in zones_by_region:
            zones_by_region[rid] = []
        zones_by_region[rid].append(HierarchyZone(
            id=z.id,
            zone_code=z.zone_code,
            name=z.name,
            manager_name=z.manager_name,
            contact_phone=z.contact_phone,
            is_active=z.is_active,
            outlets=outlets_by_zone.get(z.id, [])
        ))

    hierarchy_regions = []
    for r in regions_list:
        hierarchy_regions.append(HierarchyRegion(
            id=r.id,
            code=r.code,
            name=r.name,
            manager_name=r.manager_name,
            contact_phone=r.contact_phone,
            email=r.email,
            is_active=r.is_active,
            zones=zones_by_region.get(r.id, [])
        ))

    return CompanyHierarchy(
        company_name=comp_name,
        legal_name=comp_name,
        brand_name=brand_name,
        ho_address=ho_addr,
        ho_phone=ho_ph,
        ho_email=ho_em,
        logo_path=logo_path,
        total_regions=len(regions_list),
        total_zones=len(zones_list),
        total_stores=len(outlets_list),
        regions=hierarchy_regions
    )


# ─────────────────────────────────────────────────────────────
# REGIONS CRUD
# ─────────────────────────────────────────────────────────────
@router.get("/regions", response_model=List[RegionOut])
async def list_regions(db: AsyncSession = Depends(get_db)):
    # Fetch regions with zone and store counts
    sql = """
        SELECT r.id, r.code, r.name, r.manager_name, r.contact_phone, r.email, r.is_active, r.created_at,
               COUNT(DISTINCT z.id) as total_zones,
               COUNT(DISTINCT o.id) as total_stores
        FROM regions r
        LEFT JOIN outlet_zones z ON z.region_id = r.id AND z.is_active
        LEFT JOIN outlets o ON o.region_id = r.id AND o.is_active
        GROUP BY r.id, r.code, r.name, r.manager_name, r.contact_phone, r.email, r.is_active, r.created_at
        ORDER BY r.name
    """
    res = await db.execute(text(sql))
    rows = res.fetchall()
    return [
        RegionOut(
            id=r[0], code=r[1], name=r[2], manager_name=r[3],
            contact_phone=r[4], email=r[5], is_active=r[6], created_at=r[7],
            total_zones=r[8], total_stores=r[9]
        )
        for r in rows
    ]


@router.post("/regions", response_model=dict, status_code=201)
async def create_region(body: RegionCreate, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(region).where(region.code == body.code))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"Region code '{body.code}' already exists")
    
    new_reg = region(**body.model_dump())
    db.add(new_reg)
    await db.commit()
    await db.refresh(new_reg)
    return {"message": "Region created successfully", "id": new_reg.id}


@router.put("/regions/{id}", response_model=dict)
async def update_region(id: int, body: RegionCreate, db: AsyncSession = Depends(get_db)):
    reg_row = (await db.execute(select(region).where(region.id == id))).scalar_one_or_none()
    if not reg_row:
        raise HTTPException(status_code=404, detail="Region not found")
    
    for k, v in body.model_dump().items():
        setattr(reg_row, k, v)
    await db.commit()
    return {"message": "Region updated successfully"}


@router.delete("/regions/{id}", response_model=dict)
async def delete_region(id: int, db: AsyncSession = Depends(get_db)):
    reg_row = (await db.execute(select(region).where(region.id == id))).scalar_one_or_none()
    if not reg_row:
        raise HTTPException(status_code=404, detail="Region not found")
    
    reg_row.is_active = False
    await db.commit()
    return {"message": "Region deactivated successfully"}


# ─────────────────────────────────────────────────────────────
# ZONES CRUD
# ─────────────────────────────────────────────────────────────
@router.get("/zones", response_model=List[ZoneOut])
async def list_zones(
    region_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db)
):
    query = """
        SELECT z.id, z.name, z.zone_code, z.region_id, z.manager_name, z.contact_phone, z.email, z.is_active, z.created_at,
               r.name as region_name,
               COUNT(o.id) as total_stores
        FROM outlet_zones z
        LEFT JOIN regions r ON r.id = z.region_id
        LEFT JOIN outlets o ON o.zone_id = z.id AND o.is_active
    """
    params = {}
    if region_id:
        query += " WHERE z.region_id = :rid"
        params["rid"] = region_id
    query += " GROUP BY z.id, z.name, z.zone_code, z.region_id, z.manager_name, z.contact_phone, z.email, z.is_active, z.created_at, r.name ORDER BY z.name"
    
    res = await db.execute(text(query), params)
    rows = res.fetchall()
    return [
        ZoneOut(
            id=r[0], name=r[1], zone_code=r[2], region_id=r[3],
            manager_name=r[4], contact_phone=r[5], email=r[6], is_active=r[7], created_at=r[8],
            region_name=r[9], total_stores=r[10]
        )
        for r in rows
    ]


@router.post("/zones", response_model=dict, status_code=201)
async def create_zone(body: ZoneCreate, db: AsyncSession = Depends(get_db)):
    new_zone = outlet_zone(**body.model_dump())
    db.add(new_zone)
    await db.commit()
    await db.refresh(new_zone)
    return {"message": "Zone created successfully", "id": new_zone.id}


@router.put("/zones/{id}", response_model=dict)
async def update_zone(id: int, body: ZoneCreate, db: AsyncSession = Depends(get_db)):
    zone_row = (await db.execute(select(outlet_zone).where(outlet_zone.id == id))).scalar_one_or_none()
    if not zone_row:
        raise HTTPException(status_code=404, detail="Zone not found")
    
    for k, v in body.model_dump().items():
        setattr(zone_row, k, v)
    await db.commit()
    return {"message": "Zone updated successfully"}


@router.delete("/zones/{id}", response_model=dict)
async def delete_zone(id: int, db: AsyncSession = Depends(get_db)):
    zone_row = (await db.execute(select(outlet_zone).where(outlet_zone.id == id))).scalar_one_or_none()
    if not zone_row:
        raise HTTPException(status_code=404, detail="Zone not found")
    
    zone_row.is_active = False
    await db.commit()
    return {"message": "Zone deactivated successfully"}


# ─────────────────────────────────────────────────────────────
# OUTLETS CRUD & ENRICHED LISTING
# ─────────────────────────────────────────────────────────────
@router.get("", response_model=list[OutletOut])
async def list_outlets(
    region_id: Optional[int] = None,
    zone_id: Optional[int] = None,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    scope: UserScope = await get_user_scope(db, current_user)

    stmt = select(outlet, region.name.label("region_name"), outlet_zone.name.label("zone_name"))\
        .outerjoin(region, region.id == outlet.region_id)\
        .outerjoin(outlet_zone, outlet_zone.id == outlet.zone_id)
    
    conditions = []
    
    # User scope enforcement
    if not scope.is_unrestricted:
        if scope.outlet_ids:
            conditions.append(outlet.id.in_(scope.outlet_ids))
        else:
            return []

    # Query Filters
    if region_id:
        conditions.append(outlet.region_id == region_id)
    if zone_id:
        conditions.append(outlet.zone_id == zone_id)
    if is_active is not None:
        conditions.append(outlet.is_active == is_active)
    if search:
        s = f"%{search}%"
        conditions.append(or_(
            outlet.unit_code.ilike(s),
            outlet.outlet_name.ilike(s),
            outlet.display_name.ilike(s),
            outlet.city.ilike(s),
            outlet.manager_name.ilike(s)
        ))

    if conditions:
        stmt = stmt.where(and_(*conditions))

    stmt = stmt.order_by(outlet.unit_code)
    result = await db.execute(stmt)
    rows = result.all()

    out = []
    for o, reg_name, z_name in rows:
        d = OutletOut.model_validate(o)
        d.region_name = reg_name
        d.zone_name = z_name
        out.append(d)
    return out


@router.post("", response_model=dict, status_code=201)
async def create_outlet(body: OutletCreate, db: AsyncSession = Depends(get_db)):
    try:
        data = body.model_dump()
        new_outlet = outlet(**data)
        new_outlet.is_connected = True
        db.add(new_outlet)
        await db.commit()
        await db.refresh(new_outlet)
        return {"message": "Outlet registered successfully", "id": new_outlet.id}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.put("/{id}")
async def update_outlet(id: int, body: OutletCreate, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(outlet).where(outlet.id == id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Outlet not found")
    
    data = body.model_dump()
    for key, value in data.items():
        setattr(row, key, value)
    
    await db.commit()
    return {"message": "Outlet updated successfully"}


@router.delete("/{id}")
async def delete_outlet(id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(outlet).where(outlet.id == id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Outlet not found")
    
    await db.delete(row)
    await db.commit()
    return {"message": "Outlet deleted successfully"}


@router.post("/test-connection/{id}")
async def test_connection(id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(outlet).where(outlet.id == id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Outlet not found")
    
    if not row.server_name or not row.database_name:
        return {"success": False, "error": "Incomplete connection details"}

    host = row.server_name
    dbname = row.database_name
    user = row.db_username or "sysuser"
    password = row.db_password or get_settings().legacy_mssql_password
    
    is_sql_server = "\\" in host or row.type == "O"
    
    if is_sql_server:
        def check_mssql():
            try:
                import pymssql
                conn = pymssql.connect(
                    server=host,
                    user=user,
                    password=password,
                    database=dbname,
                    login_timeout=5,
                    timeout=5
                )
                cursor = conn.cursor()
                grp_code = None
                try:
                    cursor.execute("SELECT TOP 1 grp_code FROM sysfile")
                    res = cursor.fetchone()
                    if res and res[0]:
                        grp_code = str(res[0]).strip()
                except Exception:
                    pass

                invoice_count = 0
                for tbl in ['SALES_HDR', 'BILL_HDR', 'unit_wise_invoices']:
                    try:
                        cursor.execute(f"SELECT COUNT(*) FROM [{tbl}]")
                        invoice_count = cursor.fetchone()[0]
                        break
                    except Exception:
                        continue

                conn.close()
                msg = f"Connected to {dbname}. Invoices: {invoice_count}."
                if grp_code:
                    msg += f" Group Code: {grp_code}"
                return True, msg, invoice_count, grp_code
            except Exception as e:
                return False, str(e), 0, None

        success, message, count, grp_code = await asyncio.to_thread(check_mssql)

        if success:
            update_data = {"is_connected": True}
            if grp_code:
                update_data["grp_code"] = grp_code

            await db.execute(update(outlet).where(outlet.id == id).values(**update_data))
            await db.commit()
            return {
                "success": True,
                "is_connected": 1,
                "server": host,
                "data": {
                    "sample_info": message,
                    "invoice_count": count,
                    "grp_code": grp_code,
                }
            }
        else:
            await db.execute(update(outlet).where(outlet.id == id).values(is_connected=False))
            await db.commit()
            return {"success": False, "is_connected": 0, "error": message}

    else:
        user = row.db_username or "postgres"
        password = quote_plus(row.db_password or make_url(get_settings().database_url).password or "")
        host = "127.0.0.1" if row.server_name == "localhost" else row.server_name
        conn_url = f"postgresql+asyncpg://{user}:{password}@{host}/{dbname}"
        
        try:
            engine_test = create_async_engine(conn_url)
            async with engine_test.connect() as conn:
                await conn.execute(text("SELECT 1"))
                
                grp_code = None
                try:
                    res = await conn.execute(text("SELECT grp_cde FROM sysfile LIMIT 1"))
                    row_data = res.fetchone()
                    if row_data:
                        grp_code = str(row_data[0])
                except:
                    pass
                
                invoice_count = 0
                try:
                    res = await conn.execute(text("SELECT COUNT(*) FROM unit_wise_invoices"))
                    invoice_count = res.scalar() or 0
                except:
                    invoice_count = "N/A"
                
                update_data = {"is_connected": True}
                message = f"PostgreSQL Connection Successful. Found {invoice_count} invoices."
                if grp_code:
                    update_data["grp_code"] = grp_code
                    message += f" Group Code: {grp_code}"
                
                await db.execute(update(outlet).where(outlet.id == id).values(**update_data))
                await db.commit()
                await engine_test.dispose()
                
                return {
                    "success": True,
                    "is_connected": 1,
                    "server": host,
                    "data": {
                        "sample_info": message,
                        "grp_code": grp_code,
                        "invoice_count": invoice_count
                    }
                }
        except Exception as e:
            await db.execute(update(outlet).where(outlet.id == id).values(is_connected=False))
            await db.commit()
            return {"success": False, "is_connected": 0, "error": str(e)}
