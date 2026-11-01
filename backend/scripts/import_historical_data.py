import asyncio
import sys
import os
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import select
from app.core.database import async_session_factory
from app.models.outlet import outlet
from app.routers.sync import run_sync, sync_sales_returns, sync_purchase_summary, sync_purchase_items

# Configure logging or print to stdout
def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

async def sync_all_stores_historical(start_date_str="2026-04-01"):
    log(f"Starting historical sync from {start_date_str}...")
    
    start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    end_date = datetime.now().date()
    
    async with async_session_factory() as session:
        # 1. Fetch all connected outlets
        res = await session.execute(select(outlet).where(outlet.is_connected == True))
        stores = res.scalars().all()
        
        log(f"Found {len(stores)} connected stores.")
        
        current_date = start_date
        while current_date <= end_date:
            date_str = current_date.strftime("%Y-%m-%d")
            log(f"--- Processing Date: {date_str} ---")
            
            for store in stores:
                log(f"Syncing {store.outlet_name} ({store.unit_code})...")
                try:
                    # Sync Sales
                    sales_res = await run_sync(store.id, date_str, session)
                    log(f"  Sales: {sales_res.get('message')}")
                    
                    # Sync Returns
                    ret_res = await sync_sales_returns(store.id, date_str, session)
                    log(f"  Returns: {ret_res.get('message')}")
                    
                    # Sync Purchases
                    pur_res = await sync_purchase_summary(store.id, date_str, session)
                    log(f"  Purchases: {pur_res.get('message')}")
                    
                    # Sync Purchase Items
                    item_res = await sync_purchase_items(store.id, date_str, session)
                    log(f"  Items: {item_res.get('message')}")
                    
                except Exception as e:
                    log(f"  ERROR syncing {store.outlet_name}: {e}")
            
            current_date += timedelta(days=1)
            # Commit after each day to persist progress
            await session.commit()
            
    log("Historical sync complete!")

if __name__ == "__main__":
    # Ensure we are in the backend directory for imports to work
    # Or set PYTHONPATH=.
    asyncio.run(sync_all_stores_historical())
