import asyncio
import sys, os
sys.path.insert(0, os.path.abspath('.'))
from app.core.database import engine
from sqlalchemy import text

async def check():
    async with engine.connect() as conn:
        res = await conn.execute(text("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'multi_transfer_session_items'
            ORDER BY ordinal_position
        """))
        print("multi_transfer_session_items columns:")
        for row in res.fetchall():
            print(f"  {row[0]}: {row[1]}")

        res2 = await conn.execute(text("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'unit_wise_stock_transfer_items'
            ORDER BY ordinal_position
        """))
        print("\nunit_wise_stock_transfer_items columns:")
        for row in res2.fetchall():
            print(f"  {row[0]}: {row[1]}")

if __name__ == "__main__":
    asyncio.run(check())
