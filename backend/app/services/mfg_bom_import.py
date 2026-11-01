"""BOM import from Excel — one DRAFT BOM per finished item (batch size 1 unit), approved afterwards on BOM Approvals.

Columns (header row, any order):
    FINISHED ITEM | COMPONENT | QTY PER UNIT | UNIT | WASTAGE % | MATERIAL TYPE | ROUND UP | CREATE AS
FINISHED ITEM / COMPONENT: item code or exact item name. QTY may be a fraction ("1/36" = one carton per 36 tins).
ROUND UP = Y for whole pieces per order (tins, cartons). CREATE AS = RM or PM creates a missing component item.
A finished item that already has a BOM is skipped (make a new revision on the BOM screen instead).
"""
import io
import re
from collections import OrderedDict
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

import openpyxl
from sqlalchemy import text

COLS = {"finished item": "fg", "component": "comp", "qty per unit": "qty", "unit": "unit", "wastage %": "wastage",
        "material type": "mtype", "round up": "round_up", "create as": "create_as"}
MTYPES = {"RAW_MATERIAL", "PACKAGING", "PREMIX", "CONSUMABLE", "SUB_ASSEMBLY"}


def qty(v) -> Optional[Decimal]:
    s = str(v if v is not None else "").strip()
    try:
        if "/" in s:
            a, b = s.split("/", 1)
            return (Decimal(a.strip()) / Decimal(b.strip())).quantize(Decimal("0.00000001"))
        return Decimal(s) if s else None
    except (InvalidOperation, ZeroDivisionError):
        return None


def parse(data: bytes) -> list[dict]:
    ws = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True).active
    rows = [(i, r) for i, r in enumerate(ws.iter_rows(values_only=True), 1) if any(v not in (None, "") for v in r)]
    if not rows:
        raise ValueError("The sheet is empty.")
    head = [re.sub(r"\s+", " ", str(v or "").strip().lower()) for v in rows[0][1]]
    idx = {COLS[h]: k for k, h in enumerate(head) if h in COLS}
    if not {"fg", "comp", "qty"} <= set(idx):
        raise ValueError("Header row must have FINISHED ITEM, COMPONENT and QTY PER UNIT.")
    out = []
    for i, r in rows[1:]:
        g = lambda k: (r[idx[k]] if k in idx and idx[k] < len(r) else None)  # noqa: E731
        out.append({"row": i, "fg": str(g("fg") or "").strip(), "comp": str(g("comp") or "").strip(), "qty_raw": g("qty"),
                    "qty": qty(g("qty")), "unit": str(g("unit") or "").strip().upper() or None, "wastage": qty(g("wastage")) or Decimal(0),
                    "mtype": str(g("mtype") or "").strip().upper().replace(" ", "_") or None,
                    "round_up": str(g("round_up") or "").strip().upper() in ("Y", "YES", "TRUE", "1"),
                    "create_as": str(g("create_as") or "").strip().upper() or None})
    return out


async def _find(db, key: str) -> list[dict]:
    return [dict(r) for r in (await db.execute(text("""SELECT id, item_code, name, item_type, UPPER(COALESCE(unit, 'PCS')) AS unit FROM products
        WHERE UPPER(item_code) = UPPER(:k) OR UPPER(name) = UPPER(:k) ORDER BY (UPPER(item_code) = UPPER(:k)) DESC, id LIMIT 3"""), {"k": key})).mappings()]


async def plan(db, rows: list[dict]) -> dict:
    boms: "OrderedDict[str, dict]" = OrderedDict()
    for r in rows:
        problems = []
        if not r["fg"] or not r["comp"]:
            problems.append("finished item and component are required")
        if r["qty"] is None or r["qty"] <= 0:
            problems.append(f"quantity “{r['qty_raw']}” is not a positive number")
        if not (0 <= r["wastage"] <= 100):
            problems.append("wastage % must be 0–100")
        if r["create_as"] not in (None, "RM", "PM"):
            problems.append("CREATE AS must be RM or PM")
        b = boms.setdefault(r["fg"].upper(), {"fg_key": r["fg"], "lines": [], "problems": []})
        if r["fg"] and "fg" not in b:
            f = await _find(db, r["fg"])
            b["fg"] = f[0] if f else None
            if not f:
                b["problems"].append(f"finished item “{r['fg']}” not found — import the items first")
            elif f[0]["item_type"] not in ("FG", "SFG"):
                b["problems"].append(f"“{f[0]['name']}” is not a finished / semi-finished item")
            else:
                n = (await db.execute(text("SELECT bom_no FROM mfg_boms WHERE product_id = :p AND status NOT IN ('REJECTED', 'OBSOLETE') ORDER BY id DESC LIMIT 1"),
                                      {"p": f[0]["id"]})).scalar()
                if n:
                    b["exists"] = n
        c = await _find(db, r["comp"]) if r["comp"] else []
        line = {**r, "qty": float(r["qty"]) if r["qty"] is not None else None, "wastage": float(r["wastage"]), "item": c[0] if c else None,
                "will_create": not c and r["create_as"] in ("RM", "PM")}
        if not c and not line["will_create"] and r["comp"]:
            problems.append(f"component “{r['comp']}” not found (put RM or PM in CREATE AS to create it)")
        if c and b.get("fg") and c[0]["id"] == b["fg"]["id"]:
            problems.append("an item cannot be its own component")
        mt = r["mtype"] or ("PACKAGING" if (c and c[0]["item_type"] == "PM") or r["create_as"] == "PM" else "RAW_MATERIAL")
        if mt not in MTYPES:
            problems.append(f"material type must be one of {', '.join(sorted(MTYPES))}")
        line["mtype"], line["unit"] = mt, r["unit"] or (c[0]["unit"] if c else ("KG" if r["create_as"] == "RM" else "PCS"))
        line["problems"] = problems
        b["lines"].append(line)
    out = list(boms.values())
    for b in out:
        b["ok"] = not b["problems"] and not b.get("exists") and all(not ln["problems"] for ln in b["lines"])
    return {"boms": out, "summary": {"boms": len(out), "ready": sum(b["ok"] for b in out), "exists": sum(1 for b in out if b.get("exists")),
                                     "with_problems": sum(1 for b in out if b["problems"] or any(ln["problems"] for ln in b["lines"])),
                                     "new_components": len({ln["comp"].upper() for b in out for ln in b["lines"] if ln["will_create"]})}}


async def commit(db, p: dict, user) -> dict:
    """Creates missing components, then one DRAFT BOM per ready finished item (BOMs with problems are left out)."""
    from app.models.product import product
    from app.schemas.manufacturing import BomCreate, BomItemCreate
    from app.services import manufacturing_service
    from app.services.auth_service import write_audit
    created: dict[str, int] = {}
    made = {"boms": [], "components": 0}
    for b in p["boms"]:
        if not b["ok"]:
            continue
        for ln in b["lines"]:
            if ln["will_create"] and ln["comp"].upper() not in created:
                found = await _find(db, ln["comp"])
                if found:
                    created[ln["comp"].upper()] = found[0]["id"]
                    continue
                rm = ln["create_as"] == "RM"
                pr = product(name=ln["comp"][:150], category="Raw Material" if rm else "Packing Material", unit="KG" if rm else "PCS",
                             item_type="RM" if rm else "PM", is_sellable=False, is_raw_material=rm, is_raw_non_sellable=True, is_active=True,
                             item_remarks="Created by the BOM import")
                db.add(pr)
                await db.flush()
                pr.item_code = f"{'RM' if rm else 'PM'}-{pr.id:05d}"
                created[ln["comp"].upper()] = pr.id
                made["components"] += 1
        fg = b["fg"]
        body = BomCreate(bom_name=f"{fg['name']} BOM"[:150], product_id=fg["id"], batch_size=Decimal(1), batch_unit=fg["unit"],
                         valid_from=date.today(), notes="Created by the BOM import",
                         items=[BomItemCreate(product_id=ln["item"]["id"] if ln["item"] else created[ln["comp"].upper()], material_type=ln["mtype"],
                                              quantity=Decimal(str(ln["qty"])), unit=ln["unit"], wastage_pct=Decimal(str(ln["wastage"])),
                                              round_up=ln["round_up"], sequence=k, stage="Mixing" if ln["mtype"] in ("RAW_MATERIAL", "PREMIX") else "Packing")
                                for k, ln in enumerate(b["lines"], 1)])
        bom = await manufacturing_service.create_bom(db=db, data=body, user_id=user.user_id)     # commits
        made["boms"].append({"bom_no": bom.bom_no, "item": fg["name"]})
        await write_audit(db=db, module="manufacturing", action="create_bom", record_id=bom.id, record_no=bom.bom_no,
                          description=f"BOM {bom.bom_no} for {fg['name']} created by import", user_id=user.user_id, user_name=user.username)
        await db.commit()
    return made


if __name__ == "__main__":
    assert qty("1/36") == Decimal("0.02777778") and qty(0.2) == Decimal("0.2") and qty("x") is None and qty("1/0") is None
    assert (qty("1/36") * 10800 - Decimal("0.0001")).to_integral_value(rounding="ROUND_CEILING") == 300
    print("mfg_bom_import OK")
