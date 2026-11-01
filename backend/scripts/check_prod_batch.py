import asyncio, sys, os
sys.path.insert(0, os.path.abspath('.'))
from app.core.database import engine
from sqlalchemy import text

async def check():
    async with engine.connect() as conn:
        res = await conn.execute(text("""
            SELECT id, name, is_batch_required, has_batch_tracking, has_expiry_tracking, exp_date_required
            FROM products 
            WHERE id = 1007 OR name ILIKE '%AMUL LASSI%'
            LIMIT 5
        """))
        print("Product check:")
        for r in res.fetchall():
            print(f"  ID: {r[0]} | Name: {r[1]} | is_batch_required: {r[2]} | has_batch_tracking: {r[3]} | has_expiry_tracking: {r[4]}")

        # Check batches for this product
        res2 = await conn.execute(text("""
            SELECT id, product_id, batch_no, exp_date, mrp, selling_price, status 
            FROM product_batches 
            WHERE product_id = 1007
        """))
        print("\nBatches for 1007:")
        batches = res2.fetchall()
        for b in batches:
            print(f"  BatchID: {b[0]} | No: {b[1]} | Exp: {b[2]} | MRP: {b[3]} | Status: {b[6]}")
        if not batches:
            print("  (No batches found for 1007)")

if __name__ == "__main__":
    asyncio.run(check())
