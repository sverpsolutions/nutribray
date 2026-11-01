import asyncio, sys, os
sys.path.insert(0, os.path.abspath('.'))
from app.core.database import engine
from sqlalchemy import text

async def migrate():
    async with engine.begin() as conn:
        print("Adding batch columns to multi_transfer_session_items...")
        await conn.execute(text("""
            ALTER TABLE multi_transfer_session_items 
            ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL;
        """))
        await conn.execute(text("""
            ALTER TABLE multi_transfer_session_items 
            ADD COLUMN IF NOT EXISTS batch_no VARCHAR(100);
        """))
        await conn.execute(text("""
            ALTER TABLE multi_transfer_session_items 
            ADD COLUMN IF NOT EXISTS mfg_date DATE;
        """))
        await conn.execute(text("""
            ALTER TABLE multi_transfer_session_items 
            ADD COLUMN IF NOT EXISTS expiry_date DATE;
        """))
        print("Migration completed successfully!")

if __name__ == "__main__":
    asyncio.run(migrate())
