import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.models.outlet import outlet
from app.models.warehouse import warehouse_zone
import os
from app.core.config import get_settings

async def generate_location_template():
    df = pd.DataFrame(columns=[
        "unit_code", "outlet_name", "server_name", "database_name", 
        "db_username", "db_password", "type", "city", "state", 
        "pincode", "address", "manager_name", "manager_mobile"
    ])
    # Add a sample row
    sample = {
        "unit_code": "MBGUR01",
        "outlet_name": "Nutribray DLF",
        "server_name": "192.168.1.100",
        "database_name": "MBGUR01",
        "db_username": "sysuser",
        "db_password": "",
        "type": "O",
        "city": "Gurgaon",
        "state": "Haryana",
        "pincode": "122002",
        "address": "DLF Phase 1",
        "manager_name": "John Doe",
        "manager_mobile": "9876543210"
    }
    df = pd.concat([df, pd.DataFrame([sample])], ignore_index=True)
    
    path = "uploads/location_import_template.xlsx"
    os.makedirs("uploads", exist_ok=True)
    df.to_excel(path, index=False)
    return path

async def process_location_import(file_path: str, db: AsyncSession):
    df = pd.read_excel(file_path)
    results = {"total": len(df), "success": 0, "errors": []}
    
    for index, row in df.iterrows():
        unit_code = str(row.get("unit_code", "")).strip()
        if not unit_code:
            results["errors"].append(f"Row {index+2}: Missing unit_code")
            continue
            
        try:
            # Check if outlet exists
            res = await db.execute(select(outlet).where(outlet.unit_code == unit_code))
            existing = res.scalar_one_or_none()
            
            data = {
                "outlet_name": str(row.get("outlet_name", "")),
                "server_name": str(row.get("server_name", "")),
                "database_name": str(row.get("database_name", "")),
                "db_username": str(row.get("db_username", "sysuser")),
                "db_password": str(row.get("db_password", get_settings().legacy_mssql_password)),
                "type": str(row.get("type", "O")),
                "city": str(row.get("city", "")),
                "state": str(row.get("state", "")),
                "pincode": str(row.get("pincode", "")),
                "address": str(row.get("address", "")),
                "manager_name": str(row.get("manager_name", "")),
                "manager_mobile": str(row.get("manager_mobile", "")),
                "is_active": True,
                "is_connected": False # Will be tested later
            }
            
            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
            else:
                new_outlet = outlet(unit_code=unit_code, **data)
                db.add(new_outlet)
                await db.flush() # To get ID if needed
                
                # Auto-create warehouse zone for this outlet
                new_zone = warehouse_zone(
                    zone_name=f"{data['outlet_name']} Main Zone",
                    description=f"Auto-created zone for {unit_code}"
                )
                db.add(new_zone)
            
            results["success"] += 1
        except Exception as e:
            results["errors"].append(f"Row {index+2}: {str(e)}")
            
    await db.commit()
    return results
