import asyncio
import json
import os
import sys
from datetime import datetime, timedelta
from sqlalchemy import select
from app.core.database import async_session_factory, engine
from app.models.outlet import outlet
from app.routers.sync import complete_sync

# Configuration
SCHEDULED_HOURS = [9, 11, 13, 15, 17, 19, 21, 23, 1]
SLOT_FILE = "last_global_sync_slot.json"

def get_last_run_slot():
    if os.path.exists(SLOT_FILE):
        try:
            with open(SLOT_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error reading slot file: {e}")
    return None

def save_last_run_slot(date_str, hour):
    try:
        with open(SLOT_FILE, "w") as f:
            json.dump({"date": date_str, "hour": hour}, f)
    except Exception as e:
        print(f"Error saving slot file: {e}")

async def run_global_sync_cycle(sync_date: str):
    print(f"\n[{datetime.now()}] STARTING AUTOMATED GLOBAL SYNC CYCLE FOR DATE: {sync_date}...")
    
    async with async_session_factory() as db:
        try:
            # 1. Fetch active outlets
            result = await db.execute(select(outlet).where(outlet.is_active == True))
            active_outlets = result.scalars().all()
            
            if not active_outlets:
                print("No active outlets found for global sync.")
                return

            print(f"Found {len(active_outlets)} active outlets to sync.")
            
            # 2. Sync each outlet in sequence
            for store in active_outlets:
                print(f"\n  > Processing complete sync for: {store.outlet_name} (ID: {store.id})")
                try:
                    # Run the complete sequential sync
                    res = await complete_sync(id=store.id, sync_date=sync_date, db=db)
                    if res.get("success"):
                        print(f"    [SUCCESS] {store.outlet_name}: {res.get('message')}")
                    else:
                        print(f"    [WARNING] {store.outlet_name} completed with some warnings: {res.get('message')}")
                except Exception as store_err:
                    print(f"    [FAILED] {store.outlet_name} -> Error: {str(store_err)}")
            
            print(f"\n[{datetime.now()}] GLOBAL SYNC CYCLE COMPLETE.")
            
        except Exception as e:
            print(f"CRITICAL ERROR in global sync cycle: {str(e)}")

async def main():
    # Handle immediate execution flag
    if len(sys.argv) > 1 and sys.argv[1] in ("--now", "--test"):
        sync_date = datetime.now().strftime("%Y-%m-%d")
        if len(sys.argv) > 2:
            sync_date = sys.argv[2]  # Allow custom date pass for tests
        print(f"=== Running Immediate Test Sync for Date: {sync_date} ===")
        await run_global_sync_cycle(sync_date)
        print("=== Test Sync Completed. Exiting. ===")
        return

    print("====================================================")
    print(" MODERN BAZAAR - AUTO GLOBAL SYNC WORKER")
    print(f" Schedule: Every 2 hours from 9 AM to 1 AM")
    print(f" Target Hours: {SCHEDULED_HOURS}")
    print("====================================================")

    while True:
        try:
            now = datetime.now()
            current_date = now.strftime("%Y-%m-%d")
            current_hour = now.hour
            
            # Determine if we should trigger a sync
            if current_hour in SCHEDULED_HOURS:
                last_slot = get_last_run_slot()
                
                # Check if this slot has already run
                if not last_slot or last_slot.get("date") != current_date or last_slot.get("hour") != current_hour:
                    # Calculate target business date
                    if current_hour == 1:
                        # 1:00 AM run syncs yesterday's business day data
                        target_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
                    else:
                        target_date = current_date
                    
                    print(f"\nTriggering sync for scheduled hour slot: {current_hour}:00 on date: {current_date}")
                    await run_global_sync_cycle(target_date)
                    save_last_run_slot(current_date, current_hour)
                else:
                    # Already completed sync for this slot
                    pass
            
        except Exception as e:
            print(f"Unhandled scheduler error: {e}")
        
        # Sleep for 30 seconds before next check
        await asyncio.sleep(30)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nWorker stopped by user.")
    finally:
        # Cleanup
        loop = asyncio.get_event_loop()
        loop.run_until_complete(engine.dispose())
