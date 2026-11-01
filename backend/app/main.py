import os
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.core.database import engine
from app.core.access import enforce_access
from app.routers import (
    auth, users, roles, masters, products, customers, suppliers,
    billing, estimates, outlets, sync, reports, company, states,
    warehouse, packaging, import_export, wms, purchases, channels,
    audit_logs, inventory, logistic, stock_reports, shop, returns, purchase_returns, dashboard, shifts, cash, accounts,
    stock_take, batches, vendor_portal, dashboard_builder, schemes, access, report_engine, manufacturing, mfg_setup, mfg_printing, mfg_production, mfg_sales, mfg_reports, approvals, payment_modes, expiry, retail_reports, retail_ops, purchase_controls, imports, mfg_planning_api, mfg_stock_take  # noqa: F401
)

_settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background scheduler
    from app.core.scheduler import start_scheduler
    start_scheduler()
    import asyncio
    from app.services import po_email_service
    asyncio.create_task(po_email_service.worker())   # vendor PO e-mails (Outlook) — queued / retry rows
    from app.services import store_shifts
    asyncio.create_task(store_shifts.rollover_task())  # 24-hour stores: keep billing across midnight
    from app.services import telegram_bot
    asyncio.create_task(telegram_bot.alerts_worker())  # Telegram scheduled alerts (idempotent per account / alert / slot)
    
    yield
    await engine.dispose()


app = FastAPI(
    title=_settings.app_name,
    version=_settings.app_version,
    debug=_settings.debug,
    lifespan=lifespan,
    dependencies=[Depends(enforce_access)],  # central module/action permission + data scope (core/access.py)
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.origins_list,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"

# phase 2
app.include_router(auth.router,    prefix=API_PREFIX)
app.include_router(users.router,   prefix=API_PREFIX)
app.include_router(roles.router,   prefix=API_PREFIX)

# phase 3
app.include_router(masters.router,   prefix=API_PREFIX)
app.include_router(products.router,  prefix=API_PREFIX)

# phase 4
app.include_router(customers.router, prefix=API_PREFIX)
app.include_router(suppliers.router, prefix=API_PREFIX)

# phase 5
app.include_router(billing.router,   prefix=API_PREFIX)
app.include_router(estimates.router, prefix=API_PREFIX)
app.include_router(outlets.router,   prefix=API_PREFIX)
app.include_router(sync.router,      prefix=API_PREFIX)
app.include_router(reports.router,   prefix=API_PREFIX)
app.include_router(company.router,   prefix=API_PREFIX)
app.include_router(states.router,    prefix=API_PREFIX)
app.include_router(warehouse.router, prefix=API_PREFIX)
app.include_router(wms.router,       prefix=API_PREFIX)
app.include_router(packaging.router,     prefix=API_PREFIX)
app.include_router(import_export.router, prefix=API_PREFIX)
app.include_router(purchases.router,     prefix=API_PREFIX)
# Phase 6 — Channel Partner Pricing Engine
app.include_router(channels.router,      prefix=API_PREFIX)
app.include_router(audit_logs.router,    prefix=API_PREFIX)
app.include_router(inventory.router,     prefix=API_PREFIX)
app.include_router(logistic.router,      prefix=API_PREFIX)
app.include_router(stock_reports.router, prefix=API_PREFIX)
app.include_router(returns.router,       prefix=API_PREFIX)
app.include_router(purchase_returns.router, prefix=API_PREFIX)
app.include_router(shop.router,          prefix=API_PREFIX)
app.include_router(dashboard.router,     prefix=API_PREFIX)
app.include_router(shifts.router,        prefix=API_PREFIX)
app.include_router(cash.router,          prefix=API_PREFIX)
app.include_router(accounts.router,      prefix=API_PREFIX)
app.include_router(stock_take.router,    prefix=API_PREFIX)
app.include_router(batches.router,       prefix=API_PREFIX)
app.include_router(vendor_portal.router, prefix=API_PREFIX)
app.include_router(dashboard_builder.router, prefix=API_PREFIX)
app.include_router(schemes.router,       prefix=API_PREFIX)
app.include_router(access.router,        prefix=API_PREFIX)
app.include_router(report_engine.router, prefix=API_PREFIX)
app.include_router(manufacturing.router, prefix=API_PREFIX)
app.include_router(mfg_setup.router, prefix=API_PREFIX)
for _r in (mfg_printing, mfg_production, mfg_sales, approvals, payment_modes, expiry, imports, mfg_planning_api, mfg_stock_take):
    app.include_router(_r.router, prefix=API_PREFIX)
from app.routers import telegram as _tg
app.include_router(_tg.hook, prefix=API_PREFIX)     # Telegram webhook: public, checked by its secret header
app.include_router(_tg.router, prefix=API_PREFIX)
for _r in (*retail_ops.routers, *purchase_controls.routers):
    app.include_router(_r, prefix=API_PREFIX)


from fastapi.staticfiles import StaticFiles
if not os.path.exists("uploads"):
    os.makedirs("uploads")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok", "app": _settings.app_name, "version": _settings.app_version}


from fastapi import UploadFile, File
import uuid

@app.post(f"{API_PREFIX}/upload/supplier-doc")
async def upload_supplier_doc_generic(file: UploadFile = File(...)):
    folder = "supplier_docs"
    upload_dir = os.path.join("uploads", folder)
    os.makedirs(upload_dir, exist_ok=True)
    orig_ext = os.path.splitext(file.filename or "")[1].lower() or ".pdf"
    unique_filename = f"doc_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}{orig_ext}"
    saved_disk_path = os.path.join(upload_dir, unique_filename)
    with open(saved_disk_path, "wb") as f_out:
        f_out.write(await file.read())
    return {"file_path": f"/uploads/{folder}/{unique_filename}"}


from fastapi import Request
from fastapi.responses import JSONResponse
import traceback
import os

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Log to file
    with open("BACKEND_CRASH_LOG.txt", "a") as f:
        f.write(f"\n{'='*50}\n")
        f.write(f"TIMESTAMP: {datetime.now()}\n")
        f.write(f"PATH: {request.url.path}\n")
        f.write(f"ERROR: {str(exc)}\n")
        f.write(traceback.format_exc())
        f.write(f"{'='*50}\n")
    
    detail_msg = f"Internal Server Error: {str(exc)}" if _settings.debug else "Internal Server Error. Please contact administrator."
    return JSONResponse(
        status_code=500,
        content={"detail": detail_msg}
    )

from fastapi.exceptions import RequestValidationError
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    with open("BACKEND_CRASH_LOG.txt", "a") as f:
        f.write(f"\n{'='*50}\n")
        f.write(f"TIMESTAMP: {datetime.now()}\n")
        f.write(f"PATH: {request.url.path}\n")
        f.write(f"VALIDATION ERROR: {exc.errors()}\n")
        f.write(f"{'='*50}\n")
    return JSONResponse(
        status_code=422,
        content={"detail": f"VALIDATION ERROR: {exc.errors()}"}
    )

