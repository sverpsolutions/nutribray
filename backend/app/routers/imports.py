"""Excel imports: template -> preview (validated, nothing saved) -> commit (once) through the existing services."""
import json
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.services import approval_service as aps
from app.services import excel_import as X
from app.services.auth_service import write_audit

router = APIRouter(prefix="/imports", tags=["excel imports"])
MODULES = {"po": "PO", "grn": "GRN", "wholesale": "WHOLESALE", "items": "ITEMS", "prices": "PRICES"}
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _mod(m: str) -> str:
    if m not in MODULES:
        raise HTTPException(404, "Unknown import")
    return MODULES[m]


async def _perms(db, user) -> set:
    return set(access.ALL_SLUGS) if user.role in ("admin", "superadmin") else await access.effective_permissions(db, user.user_id, user.role, user.role_id)


async def _flags(db, user, header: dict) -> dict:
    p = await _perms(db, user)
    return {**header, "_can_approve": "purchase_order.approve" in p, "_can_change_rate": "items.change_price" in p or "billing.edit" in p,
            "_can_edit": "items.edit" in p, "_can_change_price": "items.change_price" in p, "_can_create_item": "items.create" in p}


def _revive(module: str, rows: list[dict]) -> list[dict]:
    kinds = {k: kind for k, _, _, kind in X.COLUMNS[module]}
    for r in rows:
        for k, kind in kinds.items():
            v = r.get(k)
            if v is None or v == "":
                continue
            r[k] = Decimal(str(v)) if kind == "num" else date.fromisoformat(str(v)) if kind == "date" else v
        r["_errors"] = [e for e in r.get("_errors") or [] if "is not a number" in e or "is not a date" in e]   # parse errors stay
    return rows


@router.get("/{m}/template")
async def download_template(m: str, _=Depends(get_current_user)):
    mod = _mod(m)
    return Response(X.template(mod), media_type=XLSX, headers={"Content-Disposition": f'attachment; filename="{m}_import_template.xlsx"'})


@router.post("/{m}/preview")
async def preview(m: str, file: UploadFile = File(...), header: str = Form("{}"), db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    mod = _mod(m)
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, "Upload an .xlsx file (Excel Workbook).")
    data = await file.read()
    try:
        hdr = json.loads(header or "{}")
    except ValueError:
        raise HTTPException(400, "Bad header data")
    rows = await X.validate(db, mod, X.parse(mod, data), await _flags(db, user, hdr), user)
    h = X.file_hash(data, hdr)
    earlier = (await db.execute(text("""SELECT import_no, created_refs FROM import_jobs WHERE module = :m AND file_hash = :h
        AND status IN ('IMPORTED','PARTIAL','PENDING_APPROVAL') ORDER BY id DESC LIMIT 1"""), {"m": mod, "h": h})).mappings().first()
    s = X.summary(rows)
    no = f"IMP-{(await db.execute(text('SELECT COUNT(*) + 1 FROM import_jobs'))).scalar():06d}"
    jid = (await db.execute(text("""INSERT INTO import_jobs (import_no, module, file_name, file_hash, outlet_id, header, rows, total_rows, valid_rows, failed_rows, created_by)
        VALUES (:no, :m, :f, :h, :o, CAST(:hd AS JSONB), CAST(:r AS JSONB), :t, :v, :x, :u) RETURNING id"""),
        {"no": no, "m": mod, "f": file.filename[:200], "h": h, "o": hdr.get("outlet_id"), "hd": json.dumps(hdr, default=str),
         "r": json.dumps(X.jsonable(rows)), "t": s["total"], "v": s["valid"], "x": s["invalid"], "u": user.user_id})).scalar()
    await db.commit()
    return {"job_id": jid, "import_no": no, "summary": s, "rows": X.jsonable(rows)[:5000],
            "already_imported": dict(earlier) if earlier else None}


class commit_in(BaseModel):
    only_valid: bool = False            # import the valid rows and report the rest (never silent)
    allow_duplicate_file: bool = False  # the same file was imported before and the user really wants a second document
    reason: Optional[str] = None


@router.post("/{m}/commit/{job_id}")
async def commit(m: str, job_id: int, b: commit_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    mod = _mod(m)
    job = (await db.execute(text("SELECT * FROM import_jobs WHERE id = :i AND module = :m FOR UPDATE"), {"i": job_id, "m": mod})).mappings().first()
    if not job:
        raise HTTPException(404, "Import not found")
    if job["status"] != "PREVIEW":
        raise HTTPException(400, f"{job['import_no']} is already {job['status'].lower()} — upload the file again for a new import.")
    if job["created_by"] != user.user_id and user.role not in ("admin", "superadmin"):
        raise HTTPException(403, "Only the person who uploaded the file can import it.")
    dup = (await db.execute(text("""SELECT import_no, created_refs FROM import_jobs WHERE module = :m AND file_hash = :h AND id <> :i
        AND status IN ('IMPORTED','PARTIAL','PENDING_APPROVAL') LIMIT 1"""), {"m": mod, "h": job["file_hash"], "i": job_id})).mappings().first()
    if dup and not b.allow_duplicate_file:
        raise HTTPException(409, f"This file was already imported as {dup['import_no']} ({dup['created_refs'] or '-'}). Confirm to import it again.")
    header = await _flags(db, user, dict(job["header"]))
    rows = await X.validate(db, mod, _revive(mod, list(job["rows"])), header, user)      # re-check: stock / prices may have changed
    good = [r for r in rows if r["status"] != "INVALID"]
    bad = len(rows) - len(good)
    if bad and not b.only_valid:
        raise HTTPException(400, f"{bad} row(s) have errors — correct the file and upload again, or choose to import only the {len(good)} valid row(s).")
    if not good:
        raise HTTPException(400, "No valid rows to import.")
    # claim the job first: the services below commit, so this job can never create a second document
    await db.execute(text("UPDATE import_jobs SET status = 'IMPORTED', committed_at = NOW() WHERE id = :i"), {"i": job_id})
    refs, status, msg = await COMMIT[mod](db, header, good, user, job, b)
    status = status if not bad or status == "PENDING_APPROVAL" else "PARTIAL"
    await db.execute(text("""UPDATE import_jobs SET status = :s, rows = CAST(:r AS JSONB), valid_rows = :v, failed_rows = :f, created_refs = :refs,
        message = :msg, committed_at = NOW() WHERE id = :i"""),
        {"s": status, "r": json.dumps(X.jsonable(rows)), "v": len(good), "f": bad,
         "refs": refs, "msg": msg, "i": job_id})
    await write_audit(db=db, module="imports", action=f"import_{m}", record_id=job_id, record_no=job["import_no"],
                      description=f"{job['import_no']} {mod}: {len(good)} row(s) imported, {bad} rejected → {refs or '-'}. {msg or ''}",
                      user_id=user.user_id, user_name=user.username, meta_data={"file": job["file_name"], "outlet_id": job["outlet_id"]})
    await db.commit()
    return {"status": status, "refs": refs, "message": msg, "imported": len(good), "rejected": bad}


# ── per-module commit (existing services do the real work) ────────────────────
async def _po(db, h, rows, user, job, b):
    from app.routers.purchases import _next_po_no, create_po
    from app.schemas.purchase import po_create, po_item_in
    if not h.get("supplier_id"):
        raise HTTPException(400, "Choose the supplier.")
    items = [po_item_in(product_id=r["product_id"], order_qty=r["qty"], rate=(r["basic_cost"] * (1 - X._d(r.get("discount_pct")) / 100)).quantize(Decimal("0.01")),
                        gst_percent=X._d(r.get("gst_pct")), mrp=X._d(r.get("mrp"))) for r in rows]
    total = sum((i.order_qty * i.rate * (1 + i.gst_percent / 100) for i in items), Decimal(0)).quantize(Decimal("0.01"))
    body = po_create(po_no=await _next_po_no(db), supplier_id=int(h["supplier_id"]), outlet_id=int(h["outlet_id"]), po_date=h.get("po_date") or date.today(),
                     expected_date=h.get("expected_date") or None, total_amount=total, notes=f"Imported from {job['file_name']} ({job['import_no']}). {h.get('notes') or ''}",
                     status="draft" if h.get("save_as_draft") else "pending_approval", items=items)
    r = await create_po(body, db, user)          # never 'approved': the normal PO approval (and then the vendor e-mail) follows
    if not r.get("success"):
        raise HTTPException(400, r.get("detail") or "PO could not be created")
    return r["po_no"], "IMPORTED", f"PO {r['po_no']} created ({'draft' if h.get('save_as_draft') else 'sent for approval'})"


async def _grn(db, h, rows, user, job, b):
    from app.routers.purchases import create_purchase
    from app.schemas.purchase import purchase_create, purchase_item_in
    if not (h.get("supplier_id") and h.get("invoice_no") and h.get("invoice_date")):
        raise HTTPException(400, "Supplier, supplier invoice number and date are required.")
    rej = [f"{r['item_name']} {r['rejected_qty']}" for r in rows if X._d(r.get("rejected_qty")) > 0]
    items = [purchase_item_in(product_id=r["product_id"], qty=r["accepted_qty"], free_qty=X._d(r.get("free_qty")), unit=r.get("unit") or r.get("_unit") or "PCS",
                              price=r["basic_cost"], disc_val=X._d(r.get("discount_pct")), disc_type="%", gst_percent=X._d(r.get("gst_pct")),
                              mrp=r.get("mrp"), selling_price=r.get("sp"), batch_no=r.get("batch_no"), mfg_date=r.get("mfg_date"),
                              expiry_date=r.get("expiry_date"), po_item_id=r.get("po_item_id")) for r in rows if X._d(r["accepted_qty"]) > 0]
    body = purchase_create(outlet_id=int(h["outlet_id"]), supplier_id=int(h["supplier_id"]), invoice_no=str(h["invoice_no"]),
                           invoice_date=h["invoice_date"], po_id=h.get("po_id") or None, action="update" if h.get("post_now") else "draft",
                           notes=f"Imported {job['import_no']}" + (f". Rejected at receipt: {', '.join(rej)}" if rej else ""), items=items)
    r = await create_purchase(body, db, user)
    no = getattr(r, "purchase_no", None) or (r.get("purchase_no") if isinstance(r, dict) else None)
    return no, "IMPORTED", f"GRN {no} {'posted to stock' if h.get('post_now') else 'saved as draft (post it after checking)'}"


async def _wholesale(db, h, rows, user, job, b):
    from app.schemas.invoice import invoice_create, invoice_item_in
    from app.services.billing_service import create_invoice
    if not h.get("customer_id"):
        raise HTTPException(400, "Choose the customer.")
    gst = {p: X._d(g) for p, g in (await db.execute(text("SELECT id, gst_percent FROM products WHERE id = ANY(:i)"), {"i": [r["product_id"] for r in rows]})).all()}
    items = []
    for r in rows:
        g = gst.get(r["product_id"], Decimal(0))
        bid = (await db.execute(text("SELECT id FROM product_batches WHERE product_id = :p AND batch_no = :b"), {"p": r["product_id"], "b": r["batch_no"]})).scalar() \
            if r.get("batch_no") else None
        items.append(invoice_item_in(product_id=r["product_id"], name=r["item_name"], qty=r["qty"], unit=r.get("unit") or r["_unit"],
                                     rate=(X._d(r["rate"]) / (1 + g / 100)).quantize(Decimal("0.0001")), gst_percent=g,
                                     disc_val=X._d(r.get("discount_pct")), disc_type="%", batch_id=bid, batch_no=r.get("batch_no")))
    data = invoice_create(outlet_id=int(h["outlet_id"]), customer_id=int(h["customer_id"]), invoice_type="wholesale", invoice_date=h.get("invoice_date") or date.today(),
                          payment_mode="credit", paid_amount=Decimal(0), items=items, discount_approval_no=h.get("discount_approval_no") or None,
                          notes=f"Wholesale import {job['import_no']}" + (f" · Customer PO {h['customer_po']}" if h.get("customer_po") else "")
                          + (f" · Terms: {h['payment_terms']}" if h.get("payment_terms") else ""))
    try:
        inv = await create_invoice(db, data, user.user_id)     # server pricing / GST / discount policy / stock / numbering
    except ValueError as e:
        raise HTTPException(400, str(e))
    return inv.invoice_no, "IMPORTED", f"Wholesale bill {inv.invoice_no} for ₹{inv.total_amount} (credit)"


async def _items(db, h, rows, user, job, b):
    from app.schemas.product import product_create
    from app.services.product_service import create_product
    made, updated, failed = [], 0, 0
    for r in rows:
        try:
            if r["mode"] == "CREATE":
                if not h.get("_can_create_item"):
                    raise HTTPException(403, "No item create permission")
                body = product_create(**{k: v for k, v in dict(name=r["item_name"], item_code=r.get("item_code"), barcode=r.get("barcode"),
                    category_id=r["category_id"], brand_id=r.get("brand_id"), hsn_code=r.get("hsn"), gst_percent=r.get("gst_pct"), unit=(r.get("unit") or "PCS").upper(),
                    basic_cost=r.get("basic_cost"), cost_price=r.get("cp"), mrp=r.get("mrp"), selling_price=r.get("sp"), wsp=r.get("wsp"),
                    has_batch_tracking=bool(r.get("batch_tracking")), item_type=(r.get("item_type") or "").upper() or None).items() if v is not None})
                p = await create_product(body, db, user.user_id, user.username)       # zero stock
                made.append(p.item_code)
            else:
                sets, prm = [], {"i": r["product_id"]}
                if r.get("item_type"):
                    r["item_type"] = r["item_type"].upper()
                for col, field in (("item_type", "item_type"), ("item_name", "name"), ("hsn", "hsn_code"), ("gst_pct", "gst_percent"), ("category_id", "category_id"), ("brand_id", "brand_id")):
                    if r.get(col) is not None:
                        sets.append(f"{field} = :{field}")
                        prm[field] = r[col]
                if r.get("active") is not None:
                    sets.append("is_active = :act")
                    prm["act"] = r["active"]
                if sets:
                    await db.execute(text(f"UPDATE products SET {', '.join(sets)}, updated_at = NOW() WHERE id = :i"), prm)
                price = {f: {"new": str(r[c])} for c, f in X.PRICE_FIELDS.items() if r.get(c) is not None}
                if price:
                    await X.apply_prices(db, [{"product_id": r["product_id"], "changes": price}], user.user_id, "ITEM_IMPORT", job["import_no"], None)
                await db.commit()
                updated += 1
        except HTTPException as e:
            await db.rollback()
            r["status"], r["_failed"] = "INVALID", e.detail
            failed += 1
    return ", ".join(made[:50]) + (" …" if len(made) > 50 else ""), "IMPORTED" if not failed else "PARTIAL", \
        f"{len(made)} item(s) created, {updated} updated, {failed} failed (no stock created)"


async def _prices(db, h, rows, user, job, b):
    if not h.get("_can_change_price"):
        raise HTTPException(403, "You need the Item Master → change price permission.")
    changes = [{"product_id": r["product_id"], "item": r["item_name"], "changes": r["changes"]} for r in rows if r.get("changes")]
    if not changes:
        raise HTTPException(400, "No price is different from the current price list.")
    reason = b.reason or f"Bulk price import {job['import_no']}"
    r = await aps.submit(db, request_type="PRICE_CHANGE", user=user, reason=reason, payload={"changes": changes, "import_id": job["id"]},
                         summary=f"{len(changes)} item price change(s) from {job['file_name']}", ref_type="import", ref_id=job["id"], ref_no=job["import_no"],
                         new_value={"items": len(changes)})
    if r["status"] == "APPROVED":
        return r["request_no"], "IMPORTED", f"{len(changes)} item price(s) updated"
    return r["request_no"], "PENDING_APPROVAL", f"{len(changes)} price change(s) sent for approval ({r['request_no']}) — nothing changes until approved"


COMMIT = {"PO": _po, "GRN": _grn, "WHOLESALE": _wholesale, "ITEMS": _items, "PRICES": _prices}


@router.get("/jobs")
async def history(module: Optional[str] = None, mine: bool = False, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    p: dict = {"m": module, "u": user.user_id, "outs": access.allowed_outlets()}
    return [dict(r) for r in (await db.execute(text(f"""SELECT j.id, j.import_no, j.module, j.file_name, j.total_rows, j.valid_rows, j.failed_rows, j.status,
        j.created_refs, j.message, o.outlet_name AS store, u.name AS uploaded_by,
        TO_CHAR(j.created_at + INTERVAL '5 hours 30 minutes', 'DD Mon YYYY HH24:MI') AS uploaded
        FROM import_jobs j LEFT JOIN outlets o ON o.id = j.outlet_id LEFT JOIN users u ON u.id = j.created_by
        WHERE (CAST(:m AS TEXT) IS NULL OR j.module = :m) AND (NOT {str(mine).upper()} OR j.created_by = :u)
          AND (CAST(:outs AS INT[]) IS NULL OR j.outlet_id IS NULL OR j.outlet_id = ANY(:outs))
        ORDER BY j.id DESC LIMIT 300"""), p)).mappings()]


@router.get("/jobs/{job_id}/export")
async def export_errors(job_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    job = (await db.execute(text("SELECT module, import_no, rows, outlet_id FROM import_jobs WHERE id = :i"), {"i": job_id})).mappings().first()
    if not job:
        raise HTTPException(404, "Import not found")
    access.check_outlet(job["outlet_id"])
    return Response(X.errors_xlsx(job["module"], job["rows"]), media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{job["import_no"]}_errors.xlsx"'})
