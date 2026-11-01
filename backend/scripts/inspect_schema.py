import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
from app.core.database import async_session_factory
from sqlalchemy import text

async def check_schema():
    async with async_session_factory() as session:
        # Check tables
        res = await session.execute(text("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('regions', 'outlet_zones', 'outlets', 'company_settings')
        """))
        print('Existing tables:', [r[0] for r in res.fetchall()])

        for table in ['outlet_zones', 'outlets', 'company_settings']:
            cols = await session.execute(text(f"""
                SELECT column_name, data_type FROM information_schema.columns 
                WHERE table_name = '{table}'
            """))
            print(f'\nColumns in {table}:', [r[0] for r in cols.fetchall()])

        # Check existing company_settings rows
        cs = await session.execute(text("SELECT * FROM company_settings LIMIT 5"))
        print('\nCompany settings rows count:', len(cs.fetchall()))
        
        # Check outlet 43
        out43 = await session.execute(text("SELECT id, unit_code, outlet_name, address, city, state, pincode FROM outlets WHERE id = 43 OR unit_code = 'G0012'"))
        print('\nOutlet G0012 / ID 43:', out43.fetchall())

asyncio.run(check_schema())
