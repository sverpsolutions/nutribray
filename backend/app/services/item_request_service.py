"""New item requested from the purchase module (against a PO / GRN = the Purchase ID), approved centrally, then created through
the normal item master service. Creating an item never creates stock — stock comes only from GRN / inward."""
from fastapi import HTTPException
from sqlalchemy import text

from app.services.approval_service import handler


async def duplicates(db, p: dict) -> list[str]:
    out = []
    name = (p.get("name") or "").strip()
    if p.get("item_code") and (await db.execute(text("SELECT 1 FROM products WHERE UPPER(item_code) = UPPER(:c)"), {"c": p["item_code"]})).first():
        out.append(f"item code {p['item_code']} already exists")
    if p.get("barcode"):
        hit = (await db.execute(text("""SELECT p.item_code FROM products p WHERE p.barcode = :b
            UNION SELECT p.item_code FROM product_barcodes pb JOIN products p ON p.id = pb.product_id WHERE pb.barcode = :b LIMIT 1"""),
            {"b": p["barcode"].strip()})).scalar()
        if hit:
            out.append(f"barcode {p['barcode']} is already on item {hit}")
    if name:
        hit = (await db.execute(text("SELECT item_code FROM products WHERE LOWER(TRIM(name)) = LOWER(:n) LIMIT 1"), {"n": name})).scalar()
        if hit:
            out.append(f"an item named '{name}' already exists ({hit})")
    return out


@handler("ITEM_CREATION")
class ItemCreation:
    @staticmethod
    async def check(db, p: dict):
        prod = p.get("product") or {}
        if not (prod.get("name") or "").strip():
            raise HTTPException(400, "Item name is required.")
        if not prod.get("category_id") or not (await db.execute(text("SELECT 1 FROM item_categories WHERE id = :c"), {"c": prod["category_id"]})).first():
            raise HTTPException(400, "Choose the item's category.")
        dup = await duplicates(db, prod)
        if dup:
            raise HTTPException(400, "Duplicate item: " + "; ".join(dup) + ".")
        if (await db.execute(text("""SELECT 1 FROM approval_requests WHERE request_type = 'ITEM_CREATION' AND status = 'PENDING'
                AND LOWER(TRIM(payload->'product'->>'name')) = LOWER(TRIM(:n)) AND id <> COALESCE(:x, 0)"""),
                             {"n": prod["name"], "x": p.get("_rid")})).first():
            raise HTTPException(400, f"A request to create '{prod['name']}' is already waiting for approval.")

    @staticmethod
    async def post(db, req: dict, approver) -> str:
        from app.schemas.product import product_create
        from app.services.product_service import create_product
        body = product_create(**{k: v for k, v in req["payload"]["product"].items() if v not in ("", None)})
        prod = await create_product(body, db, approver.user_id, approver.username)
        return prod.item_code or f"ID-{prod.id}"
