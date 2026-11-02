import os
import uuid
from datetime import date, datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, update
from typing import Optional
from app.core.database import get_db
from app.models.company import CompanySetting
from app.schemas.company import CompanySettingOut, CompanySettingUpdate, COMPANY_TYPES
from app.core.dependencies import get_current_user, require_role
from app.services.auth_service import write_audit

router = APIRouter(prefix="/company", tags=["company"])
admin_only = require_role("superadmin", "admin")

# Compliance checklist (bombayfishries settings: global regulatory documents) + retail licences.
# has_expiry = the licence must be renewed; shows expiring / expired.
DOC_TYPES: list[dict] = [
    {"group": "Registration", "type": "PAN", "label": "PAN Card (Company)", "has_expiry": False},
    {"group": "Registration", "type": "GST_CERT", "label": "GST Registration Certificate", "has_expiry": False},
    {"group": "Registration", "type": "COI", "label": "Certificate of Incorporation", "has_expiry": False},
    {"group": "Registration", "type": "CIN", "label": "CIN / LLPIN Master Data", "has_expiry": False},
    {"group": "Registration", "type": "MOA", "label": "Memorandum of Association (MOA)", "has_expiry": False},
    {"group": "Registration", "type": "AOA", "label": "Articles of Association (AOA)", "has_expiry": False},
    {"group": "Registration", "type": "TAN", "label": "TAN Allotment Letter", "has_expiry": False},
    {"group": "Directors", "type": "DIR_PAN", "label": "Director PAN Card", "has_expiry": False},
    {"group": "Directors", "type": "DIR_AADHAAR", "label": "Director Aadhaar Card", "has_expiry": False},
    {"group": "Directors", "type": "DIR_DSC", "label": "Director Digital Signature (DSC)", "has_expiry": True},
    {"group": "Licences", "type": "FSSAI", "label": "FSSAI Food Licence", "has_expiry": True},
    {"group": "Licences", "type": "SHOPS_EST", "label": "Shops & Establishment Licence", "has_expiry": True},
    {"group": "Licences", "type": "TRADE", "label": "Trade Licence (Municipal)", "has_expiry": True},
    {"group": "Licences", "type": "FIRE_NOC", "label": "Fire NOC", "has_expiry": True},
    {"group": "Licences", "type": "POLLUTION_NOC", "label": "Pollution Control Consent", "has_expiry": True},
    {"group": "Licences", "type": "WEIGHTS", "label": "Legal Metrology (Weights & Measures)", "has_expiry": True},
    {"group": "Address & Tax", "type": "REG_ADDR_PROOF", "label": "Registered Office Proof (Rent / Electricity)", "has_expiry": False},
    {"group": "Address & Tax", "type": "PT_REG", "label": "Profession Tax Registration", "has_expiry": False},
    {"group": "Address & Tax", "type": "MSME", "label": "MSME / Udyam Registration", "has_expiry": False},
    {"group": "Address & Tax", "type": "IEC", "label": "Import Export Code (IEC)", "has_expiry": False},
]
DOC_INDEX = {d["type"]: d for d in DOC_TYPES}
EXPIRY_WARN_DAYS = 30
UPLOADS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}


async def _save_file(file: UploadFile, folder: str, allowed: dict, max_mb: int) -> str:
    ext = allowed.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, f"Upload one of: {', '.join(e.strip('.').upper() for e in allowed.values())}")
    data = await file.read(max_mb * 1024 * 1024 + 1)
    if len(data) > max_mb * 1024 * 1024:
        raise HTTPException(400, f"File is larger than {max_mb} MB")
    path = os.path.join("uploads", folder)
    os.makedirs(path, exist_ok=True)
    name = f"{datetime.now():%Y%m%d}-{uuid.uuid4().hex[:12]}{ext}"
    with open(os.path.join(path, name), "wb") as f:
        f.write(data)
    return f"/uploads/{folder}/{name}"


async def _row(db: AsyncSession) -> CompanySetting:
    settings = (await db.execute(select(CompanySetting).order_by(CompanySetting.id))).scalars().first()
    if not settings:
        settings = CompanySetting(key_name='general', brand_name="NUTRIBRAY", legal_name="Nutribray", logo_path="/nutribay_logo.svg")
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
    return settings


@router.get("/settings", response_model=CompanySettingOut)
async def get_company_settings(db: AsyncSession = Depends(get_db)):
    # public on purpose: login page / receipts read brand, logo and address
    return await _row(db)


@router.post("/settings", response_model=CompanySettingOut)
async def update_company_settings(
    data: CompanySettingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(admin_only),
):
    settings = await _row(db)
    # only fields the client sent; explicit empty clears them
    new = data.model_dump(exclude_unset=True)
    for k in ("state_code", "company_state", "company_pan"):  # filled from GSTIN by the validator
        if getattr(data, k) is not None:
            new[k] = getattr(data, k)
    norm = lambda x: float(x) if isinstance(x, Decimal) else x  # NUMERIC columns come back as Decimal
    changed = {k: (getattr(settings, k), v) for k, v in new.items() if norm(getattr(settings, k, None)) != v}
    if changed:
        await db.execute(update(CompanySetting).where(CompanySetting.id == settings.id)
                         .values(**new, updated_at=datetime.now(), updated_by=current_user.user_id))
        await write_audit(db=db, module="company", action="update", record_id=settings.id,
                          description="Company profile changed: " + "; ".join(f"{k}: {o!r} -> {n!r}" for k, (o, n) in changed.items())[:1900],
                          user_id=current_user.user_id, user_name=current_user.username)
        await db.commit()
    db.expire_all()
    return await _row(db)


@router.post("/logo")
async def upload_logo(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user = Depends(admin_only)):
    path = await _save_file(file, "company", {k: v for k, v in UPLOADS.items() if k != "application/pdf"}, 2)
    settings = await _row(db)
    await db.execute(update(CompanySetting).where(CompanySetting.id == settings.id)
                     .values(logo_path=path, updated_at=datetime.now(), updated_by=current_user.user_id))
    await write_audit(db=db, module="company", action="logo", record_id=settings.id, description=f"Logo changed to {path}",
                      user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"logo_path": path}


@router.get("/meta")
async def meta(_=Depends(get_current_user)):
    return {"company_types": COMPANY_TYPES, "doc_types": DOC_TYPES, "expiry_warn_days": EXPIRY_WARN_DAYS}


def _status(d: Optional[dict], spec: dict) -> str:
    if not d:
        return "missing"
    if spec["has_expiry"]:
        if not d["expiry_date"]:
            return "no_expiry"
        days = (d["expiry_date"] - date.today()).days
        if days < 0:
            return "expired"
        if days <= EXPIRY_WARN_DAYS:
            return "expiring"
    return "valid"


@router.get("/documents")
async def documents(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    rows = (await db.execute(text("""
        SELECT d.*, u.name AS uploaded_by_name FROM company_documents d LEFT JOIN users u ON u.id = d.uploaded_by
        ORDER BY d.doc_type, d.created_at DESC"""))).mappings().all()
    by_type: dict[str, list] = {}
    for r in rows:
        by_type.setdefault(r["doc_type"], []).append(dict(r))
    out = []
    for spec in DOC_TYPES:
        hist = by_type.get(spec["type"], [])
        cur = next((h for h in hist if h["is_current"]), None)
        out.append({**spec, "status": _status(cur, spec), "current": cur, "history": [h for h in hist if not h["is_current"]]})
    return out


@router.post("/documents")
async def upload_document(
    doc_type: str = Form(...),
    doc_number: Optional[str] = Form(None),
    issue_date: Optional[date] = Form(None),
    expiry_date: Optional[date] = Form(None),
    notes: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(admin_only),
):
    spec = DOC_INDEX.get(doc_type)
    if not spec:
        raise HTTPException(400, "Unknown document type")
    if spec["has_expiry"] and not expiry_date:
        raise HTTPException(400, f"{spec['label']} needs its expiry / valid-till date")
    if issue_date and expiry_date and expiry_date <= issue_date:
        raise HTTPException(400, "Expiry date must be after the issue date")
    path = await _save_file(file, "company_docs", UPLOADS, 5)
    # the new upload becomes current; the old one stays as history
    await db.execute(text("UPDATE company_documents SET is_current = false WHERE doc_type = :t AND is_current"), {"t": doc_type})
    did = (await db.execute(text("""
        INSERT INTO company_documents (doc_type, doc_number, file_path, issue_date, expiry_date, notes, uploaded_by)
        VALUES (:t, :n, :p, :i, :e, :notes, :u) RETURNING id"""),
        {"t": doc_type, "n": (doc_number or "").strip() or None, "p": path, "i": issue_date, "e": expiry_date,
         "notes": notes, "u": current_user.user_id})).scalar()
    await write_audit(db=db, module="company", action="document_upload", record_id=did, record_no=doc_type,
                      description=f"{spec['label']} uploaded{f' (valid till {expiry_date})' if expiry_date else ''}",
                      user_id=current_user.user_id, user_name=current_user.username)
    await db.commit()
    return {"id": did, "file_path": path}
