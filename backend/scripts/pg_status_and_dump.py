import asyncio
import os
import sys
import subprocess
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.core.database import async_session_factory

async def inspect_and_clean_activity():
    async with async_session_factory() as session:
        # Check active locks / idle in transaction
        sql = """
        SELECT pid, usename, client_addr, state, wait_event_type, wait_event, query 
        FROM pg_stat_activity 
        WHERE datname = 'modernbazaar'
        """
        res = await session.execute(text(sql))
        rows = res.fetchall()
        print(f"Total sessions connected to modernbazaar: {len(rows)}")
        for r in rows:
            print(f"PID: {r[0]} | User: {r[1]} | State: {r[3]} | Wait: {r[4]}/{r[5]} | Query: {str(r[6])[:80]}")

if __name__ == "__main__":
    asyncio.run(inspect_and_clean_activity())
