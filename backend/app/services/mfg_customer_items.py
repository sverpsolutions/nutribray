"""Customer-wise finished-goods list (plant inventory) from the company-grouped Excel:

    ALPHA HEALTH LIFESCIENCES PVT LTD            <- company row (customer)
    Brand Name | SIZE | PACKING TYPE             <- header (repeats per company)
    ALPHALACT PREMIUM-1. | 36 x 200 | TINS       <- item: 36 units of 200 g per carton

Each company is matched to an existing customer (name, ignoring PVT / LTD / punctuation). The customer's brand
(mfg_brands) gives the short code; items are numbered <CODE>-001, -002 … continuing after existing codes.
One HSN and one MRP for every item (changed later per item). Re-running skips items that already exist.
"""
import difflib
import io
import re
from decimal import Decimal
from typing import Optional

import openpyxl
from sqlalchemy import text

STOP = {"PVT", "PRIVATE", "LTD", "LIMITED", "LLP", "THE", "AND", "CO", "EXPORT", "INDIA", "PVTLTD"}
PACK = {"TINS": "TIN", "TIN": "TIN", "BIB": "BIB", "CARTON": "CARTON"}


def norm(s: str) -> str:
    w = re.sub(r"[^A-Z0-9 ]", " ", str(s or "").upper()).split()
    return " ".join(x for x in w if x not in STOP)


def short_code(name: str, taken: set) -> str:
    words = norm(name).split() or ["X"]
    code = "".join(w[0] for w in words)
    if len(code) < 3:                              # DHATRI FOODS -> DF -> DHF
        code = (words[0][: 4 - len(code)] + "".join(w[0] for w in words[1:]))[:4]
    code = code[:6]
    base, n = code, 2
    while code in taken:
        code = f"{base}{n}"
        n += 1
    taken.add(code)
    return code


def parse_size(s) -> tuple[Optional[int], Optional[Decimal], Optional[str], Optional[str]]:
    """'36 x 200' -> (36, 200, 'G', None). Returns (units per carton, unit qty, G/KG, problem)."""
    t = str(s or "").strip().upper().replace(",", ".")
    nums = re.findall(r"\d+(?:\.\d+)?", t)
    uom = "KG" if "KG" in t else "G" if re.search(r"\dG|\sG\b|GM", t) else None
    if len(nums) == 2 and re.search(r"\d\s*X\s*\d", t):
        upc, q = int(float(nums[0])), Decimal(nums[1])
        if uom is None:
            uom = "G" if q >= 50 else None
        return upc, q, uom, None if uom else f"size “{s}”: is {nums[1]} grams or kg?"
    if len(nums) == 1:
        return None, Decimal(nums[0]), uom or ("G" if float(nums[0]) >= 50 else None), f"size “{s}”: no carton quantity — 1 per carton used"
    return None, None, None, f"size “{s}” not understood — fix it on the item"


def item_name(brand: str, q, uom, pack) -> str:
    b = re.sub(r"\s+", " ", str(brand).strip().rstrip(".").strip())
    size = f"{q.normalize():f}{uom}" if q is not None and uom else ""
    if size and size in b.upper().replace(" ", ""):      # "WELLFEED-1 1KG" already says its size
        size = ""
    return " ".join(x for x in [b, size, pack] if x)[:150]


PM_PREFIX = {"CAP": "CAP", "TAPE": "TAP", "ROLLS": "ROL", "ROLL": "ROL", "STICKER": "STK", "POUCH": "PCH", "POUCH LOGO": "PCL",
             "OUTERCOVER": "OUT", "OUTER COVER": "OUT", "SCOOPS": "SCP", "SCOOP": "SCP", "BOTTOM": "BTM", "LABEL": "LBL", "CARTON": "CTN"}


def parse_pm(rows: list) -> Optional[list[dict]]:
    """Flat packing-material list: CATEGORY | ITEM NAME (any columns). None when the sheet is not in that layout."""
    for hi, (i, r) in enumerate(rows):
        cells = [str(v or "").strip().upper() for v in r]
        if "CATEGORY" in cells and "ITEM NAME" in cells:
            ci, ni = cells.index("CATEGORY"), cells.index("ITEM NAME")
            groups: dict = {}
            for j, rr in rows[hi + 1:]:
                cat, name = (str(rr[ci] or "").strip() if ci < len(rr) else ""), (str(rr[ni] or "").strip() if ni < len(rr) else "")
                if not name:
                    continue
                cat = cat.upper() or "OTHER"
                groups.setdefault(cat, {"company": cat, "row": j, "items": [], "kind": "PM"})["items"].append(
                    {"row": j, "brand_name": name, "size": "", "pack": ""})
            return list(groups.values())
        if hi > 5:
            return None
    return None


def parse(data: bytes) -> list[dict]:
    ws = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True).active
    rows = [(i, r) for i, r in enumerate(ws.iter_rows(values_only=True), 1) if any(v is not None for v in r)]
    pm = parse_pm(rows)
    if pm is not None:
        return pm
    groups, cur = [], None
    for i, r in rows:
        a, b, c = (list(r) + [None] * 3)[:3]
        if a is None and b is None:
            continue
        if b is None and c is None:
            cur = {"company": str(a).strip(), "row": i, "items": []}
            groups.append(cur)
            continue
        if str(a).strip().lower() in ("brand name", "item name", "product"):
            continue
        if cur is None:
            raise ValueError(f"Row {i}: an item before any company name row.")
        cur["items"].append({"row": i, "brand_name": str(a or "").strip(), "size": str(b or "").strip(), "pack": str(c or "").strip()})
    return groups


async def plan(db, groups: list[dict], hsn: str, mrp: Decimal) -> dict:
    """What an import would do — nothing is written."""
    cust = (await db.execute(text("SELECT id, name, customer_code FROM customers WHERE COALESCE(status, TRUE)"))).mappings().all()
    by_norm = {}
    for c in cust:
        by_norm.setdefault(norm(c["name"]), c)
    brands = (await db.execute(text("SELECT id, code, name, customer_id, is_own_brand FROM mfg_brands"))).mappings().all()
    taken = {b["code"].upper() for b in brands}
    existing = {r[0] for r in (await db.execute(text("SELECT UPPER(name) FROM products"))).all()}
    codes = {r[0] for r in (await db.execute(text("SELECT UPPER(item_code) FROM products WHERE item_code IS NOT NULL"))).all()}
    gst = (await db.execute(text("SELECT gst_percent FROM hsn_master WHERE hsn_code = :h"), {"h": hsn})).scalar()
    out, seen = [], set()
    for g in groups:
        if g.get("kind") == "PM":
            code = "PM-" + PM_PREFIX.get(g["company"], re.sub(r"[^A-Z]", "", g["company"])[:3] or "OTH")
            nxt = 1 + max([int(x.rsplit("-", 1)[1]) for x in codes if x.startswith(code + "-") and x.rsplit("-", 1)[1].isdigit()] or [0])
            items = []
            for it in g["items"]:
                name = re.sub(r"\s+", " ", it["brand_name"]).strip()[:150]
                status = "exists" if name.upper() in existing else "duplicate" if name.upper() in seen else "new"
                seen.add(name.upper())
                row = {"row": it["row"], "brand_name": it["brand_name"], "size": "", "pack": None, "name": name, "units_per_carton": 1,
                       "unit_qty": None, "unit_uom": None, "status": status, "problem": None, "item_code": None}
                if status == "new":
                    row["item_code"] = f"{code}-{nxt:03d}"
                    nxt += 1
                items.append(row)
            out.append({"company": g["company"], "row": g["row"], "customer_id": None, "customer_name": None, "match": "packing material",
                        "brand_id": None, "brand_code": code, "new_brand": False, "kind": "PM", "items": items})
            continue
        n = norm(g["company"])
        c, how = by_norm.get(n), "exact"
        if not c:
            m = difflib.get_close_matches(n, list(by_norm), n=1, cutoff=0.88)
            c, how = (by_norm[m[0]], "close") if m else (None, None)
        own = next((b for b in brands if b["is_own_brand"] and norm(b["name"]) and (norm(b["name"]) in n or n in norm(b["name"]))), None)
        brand = own or (next((b for b in brands if c and b["customer_id"] == c["id"]), None))
        code = brand["code"].upper() if brand else short_code(g["company"], taken)
        nxt = 1 + max([int(x.rsplit("-", 1)[1]) for x in codes if x.startswith(code + "-") and x.rsplit("-", 1)[1].isdigit()] or [0])
        items = []
        for it in g["items"]:
            upc, q, uom, problem = parse_size(it["size"])
            pack = PACK.get(it["pack"].upper(), it["pack"].upper()[:10] or None)
            name = item_name(it["brand_name"], q, uom, pack)
            key = (code, name.upper())
            status = "exists" if name.upper() in existing else "duplicate" if key in seen else "new"
            seen.add(key)
            row = {"row": it["row"], "brand_name": it["brand_name"], "size": it["size"], "pack": pack, "name": name,
                   "units_per_carton": upc or 1, "unit_qty": float(q) if q is not None else None, "unit_uom": uom,
                   "status": status, "problem": problem, "item_code": None}
            if status == "new":
                row["item_code"] = f"{code}-{nxt:03d}"
                nxt += 1
            items.append(row)
        out.append({"company": g["company"], "row": g["row"], "customer_id": c["id"] if c else None, "customer_name": c["name"] if c else None,
                    "match": "own brand" if own else how, "brand_id": brand["id"] if brand else None, "brand_code": code,
                    "new_brand": not brand, "items": items})
    new = sum(1 for g in out for i in g["items"] if i["status"] == "new")
    return {"companies": out, "hsn": hsn, "mrp": float(mrp), "gst_percent": float(gst) if gst is not None else None,
            "kind": "PM" if out and all(g.get("kind") == "PM" for g in out) else "FG",
            "summary": {"companies": len(out), "matched": sum(1 for g in out if g["customer_id"] or g["match"] == "own brand"),
                        "unmatched": sum(1 for g in out if not g["customer_id"] and g["match"] not in ("own brand", "packing material")), "items": sum(len(g["items"]) for g in out),
                        "new": new, "exists": sum(1 for g in out for i in g["items"] if i["status"] == "exists"),
                        "duplicates": sum(1 for g in out for i in g["items"] if i["status"] == "duplicate"),
                        "check": sum(1 for g in out for i in g["items"] if i["problem"] and i["status"] == "new")}}


async def commit(db, p: dict, create_missing: bool, user) -> dict:
    """Creates missing customers (if asked), customer brands, items with carton packing. One transaction."""
    from app.models.packaging import item_packaging_master
    from app.models.party import customer
    from app.models.product import product
    made = {"customers": 0, "brands": 0, "items": 0, "skipped_companies": []}
    gst = Decimal(str(p["gst_percent"] or 0))
    for g in p["companies"]:
        new_items = [i for i in g["items"] if i["status"] == "new"]
        if not new_items:
            continue
        if g.get("kind") == "PM":
            for i in new_items:
                db.add(product(name=i["name"], item_code=i["item_code"], category=g["company"].title()[:100], hsn_code=p["hsn"] or None,
                               gst_percent=gst, sale_tax_percent=gst, purchase_tax_percent=gst, unit="PCS", carton_size=1,
                               item_type="PM", is_sellable=False, is_raw_material=False, is_raw_non_sellable=True, is_consumable=False,
                               is_active=True, item_remarks=f"Packing material import · {g['company']}"))
                made["items"] += 1
            await db.flush()
            continue
        cid = g["customer_id"]
        if not cid and g["match"] != "own brand":
            if not create_missing:
                made["skipped_companies"].append(g["company"])
                continue
            c = customer(name=g["company"][:100], phone="", type="wholesale", notes="Created by the plant item import")
            db.add(c)
            await db.flush()
            c.customer_code = f"CUST{c.id:05d}"
            cid = c.id
            made["customers"] += 1
        bid = g["brand_id"]
        if not bid:
            bid = (await db.execute(text("""INSERT INTO mfg_brands (code, name, customer_id, is_own_brand, notes, created_by)
                VALUES (:c, :n, :cu, FALSE, 'Created by the plant item import', :u) RETURNING id"""),
                {"c": g["brand_code"], "n": g["company"][:120], "cu": cid, "u": user.user_id})).scalar()
            made["brands"] += 1
        for i in new_items:
            q, uom = i["unit_qty"], i["unit_uom"]
            kg = (Decimal(str(q)) / 1000 if uom == "G" else Decimal(str(q))) if q is not None and uom else None
            pr = product(name=i["name"], item_code=i["item_code"], category="Finished Goods", brand=g["company"][:100],
                         manufacturer_name=g["company"][:100], hsn_code=p["hsn"], gst_percent=gst, sale_tax_percent=gst, purchase_tax_percent=gst,
                         unit="PCS", carton_size=i["units_per_carton"], mrp=Decimal(str(p["mrp"])), selling_price=Decimal(str(p["mrp"])),
                         size=f"{q:g} {uom}" if q is not None and uom else i["size"][:50], weight_kg=kg, item_type="FG", is_sellable=True,
                         is_active=True, item_remarks=f"Plant item import · {i['brand_name']} · {i['size']} · {i['pack'] or ''}"[:500])
            db.add(pr)
            await db.flush()
            db.add(item_packaging_master(product_id=pr.id, item_code=i["item_code"], packaging_type="CARTON", inner_pack_qty=1,
                                         inner_packs_per_carton=i["units_per_carton"], outer_carton_qty=i["units_per_carton"],
                                         total_units_per_carton=i["units_per_carton"],
                                         net_weight_kg=kg * i["units_per_carton"] if kg is not None else None))
            made["items"] += 1
    from app.services.auth_service import write_audit
    await write_audit(db=db, module="manufacturing", action="item_import", record_id=0, record_no=f"{made['items']} items",
                      description=f"Plant item import: {made['items']} items, {made['brands']} brands, {made['customers']} customers created",
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return made


if __name__ == "__main__":
    assert parse_size("36 x 200") == (36, Decimal("200"), "G", None)
    assert parse_size("24 x 300g")[:3] == (24, Decimal("300"), "G") and parse_size("60X100")[:3] == (60, Decimal("100"), "G")
    assert parse_size("9 x 1kg")[:3] == (9, Decimal("1"), "KG") and parse_size("9x1")[3]
    assert parse_size("240G")[0] is None and parse_size("475X360X210")[3]
    t: set = set()
    assert short_code("ALPHA HEALTH LIFESCIENCES PVT LTD", t) == "AHL" and short_code("DHATRI FOODS", t) == "DHF"
    assert short_code("INCITE", t) == "INC" and short_code("ALPHA HEALTH LABS", t) == "AHL2"
    assert norm("M.J. ENTERPRISE") == "M J ENTERPRISE" and norm("Priva Health Nutrition Pvt. Ltd.") == "PRIVA HEALTH NUTRITION"
    assert item_name("ALPHALACT PREMIUM-1.", Decimal("200"), "G", "TIN") == "ALPHALACT PREMIUM-1 200G TIN"
    pm = parse_pm([(1, (None, "CATEGORY", "ITEM NAME")), (2, (None, "CAP", "RED CAP")), (3, (None, "TAPE", "TAP BROWN")), (4, (None, "CAP", "BLUE CAP"))])
    assert [(g["company"], len(g["items"])) for g in pm] == [("CAP", 2), ("TAPE", 1)]
    assert parse_pm([(1, ("ALPHA PVT LTD", None, None)), (2, ("Brand Name", "SIZE", "PACKIING TYPE"))]) is None
    print("mfg_customer_items OK")
