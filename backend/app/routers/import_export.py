from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user, current_user_dep
from app.services import import_service, location_import_service
import os
import shutil
import re

router = APIRouter(prefix="/import-export", tags=["import-export"])

def _safe_upload_path(filename: str, prefix: str = "temp_") -> str:
    clean_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', os.path.basename(filename or 'upload'))
    upload_dir = os.path.abspath("uploads")
    os.makedirs(upload_dir, exist_ok=True)
    target_path = os.path.abspath(os.path.join(upload_dir, f"{prefix}{clean_name}"))
    if not target_path.startswith(upload_dir):
        raise HTTPException(400, "Invalid file path")
    return target_path

@router.get("/template/locations")
async def download_location_template():
    try:
        path = await location_import_service.generate_location_template()
        return FileResponse(
            path, 
            filename="location_import_template.xlsx",
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    except Exception as e:
        raise HTTPException(500, f"Template generation failed: {str(e)}")

@router.post("/import/locations")
async def import_locations(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user)
):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(400, "Only Excel (.xlsx/.xls) files allowed")
    
    temp_path = _safe_upload_path(file.filename, prefix="locations_")
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    try:
        result = await location_import_service.process_location_import(temp_path, db)
        return result
    except Exception as e:
        raise HTTPException(500, f"Import failed: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass

@router.get("/template")
async def download_template(db: AsyncSession = Depends(get_db)):
    """Download product import template (no auth required for convenience)."""
    try:
        path = await import_service.generate_template(db)
        return FileResponse(
            path, 
            filename="product_import_template.xlsx",
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    except Exception as e:
        raise HTTPException(500, f"Template generation failed: {str(e)}")

@router.post("/preview")
async def preview_import(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user)
):
    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(400, "Only Excel (.xlsx/.xls) or CSV files allowed")
    
    temp_path = _safe_upload_path(file.filename, prefix="temp_")
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    try:
        preview = await import_service.validate_and_preview(temp_path, db)
        return preview
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Validation error: {str(e)}")

@router.post("/process")
async def process_import(
    filename: str,
    auto_create: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user)
):
    temp_path = _safe_upload_path(filename, prefix="temp_")
    if not os.path.isfile(temp_path):
        raise HTTPException(400, "File not found. Please upload again.")
    
    try:
        result = await import_service.process_import(temp_path, current_user.user_id, db, auto_create)
        # Clean up temp file
        try: os.remove(temp_path)
        except: pass
        return result
    except Exception as e:
        raise HTTPException(500, f"Import failed: {str(e)}")

@router.get("/history")
async def import_history(
    db: AsyncSession = Depends(get_db),
    current_user: current_user_dep = Depends(get_current_user)
):
    from app.models.import_log import product_import_log
    from sqlalchemy import select
    logs = (await db.execute(
        select(product_import_log).order_by(product_import_log.created_at.desc()).limit(50)
    )).scalars().all()
    return [
        {
            "id": l.id, "filename": l.filename, "total_rows": l.total_rows,
            "success_rows": l.success_rows, "failed_rows": l.failed_rows,
            "status": l.status, "created_at": str(l.created_at)
        }
        for l in logs
    ]
