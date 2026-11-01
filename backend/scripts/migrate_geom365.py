import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
from app.core.database import async_session_factory
from sqlalchemy import text

async def migrate_and_seed():
    async with async_session_factory() as session:
        print("Starting GEOM365 Database Migration & Seeding...")
        
        # 1. Create regions table
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS regions (
                id SERIAL PRIMARY KEY,
                code VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                manager_name VARCHAR(100),
                contact_phone VARCHAR(20),
                email VARCHAR(100),
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        print("[OK] Created/verified regions table")

        # 2. Enhance outlet_zones
        await session.execute(text("""
            ALTER TABLE outlet_zones 
            ADD COLUMN IF NOT EXISTS region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS zone_code VARCHAR(20),
            ADD COLUMN IF NOT EXISTS manager_name VARCHAR(100),
            ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20),
            ADD COLUMN IF NOT EXISTS email VARCHAR(100),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        """))
        print("[OK] Enhanced outlet_zones table")

        # 3. Enhance outlets table
        await session.execute(text("""
            ALTER TABLE outlets
            ADD COLUMN IF NOT EXISTS region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES outlet_zones(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
        """))
        print("[OK] Enhanced outlets table")

        # 4. User region and zone assignments for hierarchy scope
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS user_region_assignments (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, region_id)
            )
        """))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS user_zone_assignments (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                zone_id INTEGER NOT NULL REFERENCES outlet_zones(id) ON DELETE CASCADE,
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, zone_id)
            )
        """))
        print("[OK] Created user_region_assignments and user_zone_assignments")

        # 5. Update Company Settings (ID 2 or insert if missing)
        await session.execute(text("""
            UPDATE company_settings
            SET 
                brand_name = 'geom365',
                legal_name = 'Geomett Box Private Limited',
                ho_address = 'TR-311, 312, ALTF Mohan Cooperative Industrial Estate, Plot No. A-26, Block B, Opposite Metro Pillar No. 292, South Delhi – 110076',
                ho_phone = '74003 39365',
                alt_phone = '82934 14222',
                ho_email = 'care@geom365.com',
                company_website = 'https://www.geom365.com',
                logo_path = '/geom365_logo.png',
                reg_address = 'TR-311, 312, ALTF Mohan Cooperative Industrial Estate, Plot No. A-26, Block B, Opposite Metro Pillar No. 292, South Delhi – 110076',
                reg_city = 'South Delhi',
                reg_state = 'Delhi',
                reg_pincode = '110076',
                ho_city = 'South Delhi',
                ho_pincode = '110076',
                gstin = '07AAACG1234F1Z5',
                company_pan = 'AAACG1234F',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 2;
        """))
        print("[OK] Updated company_settings with GEOM365 official details")

        # 6. Seed Region
        await session.execute(text("""
            INSERT INTO regions (code, name, manager_name, contact_phone, email, is_active)
            VALUES ('NCR01', 'North India / Delhi NCR', 'Rajesh Sharma', '+91 98100 12345', 'rajesh.s@geom365.com', TRUE)
            ON CONFLICT (code) DO UPDATE 
            SET name = EXCLUDED.name, manager_name = EXCLUDED.manager_name, contact_phone = EXCLUDED.contact_phone, email = EXCLUDED.email;
        """))
        reg_res = await session.execute(text("SELECT id FROM regions WHERE code = 'NCR01'"))
        region_id = reg_res.scalar_one()
        print(f"[OK] Seeded Region NCR01 (id: {region_id})")

        # 7. Seed Zones
        zones_data = [
            ('Z-SD', 'South Delhi & Transit', 'Vikram Malhotra', '+91 98111 23456', 'vikram.m@geom365.com'),
            ('Z-SE', 'South-East & Industrial', 'Amitabh Sen', '+91 98112 34567', 'amitabh.s@geom365.com'),
            ('Z-WN', 'West & Central Delhi', 'Sanjay Verma', '+91 98113 45678', 'sanjay.v@geom365.com'),
            ('Z-NOI', 'Noida & East NCR', 'Pooja Aggarwal', '+91 98114 56789', 'pooja.a@geom365.com'),
            ('Z-GGN', 'Gurugram & Highway', 'Manish Rao', '+91 98115 67890', 'manish.r@geom365.com')
        ]
        zone_map = {}
        for zcode, zname, zmgr, zphone, zemail in zones_data:
            # Check by zone_code or name
            chk = await session.execute(text("SELECT id FROM outlet_zones WHERE zone_code = :zc OR name = :zn"), {"zc": zcode, "zn": zname})
            existing_zid = chk.scalar_one_or_none()
            if existing_zid:
                await session.execute(text("""
                    UPDATE outlet_zones 
                    SET region_id = :rid, zone_code = :zc, name = :zn, manager_name = :zm, contact_phone = :zp, email = :ze, is_active = TRUE
                    WHERE id = :zid
                """), {"rid": region_id, "zc": zcode, "zn": zname, "zm": zmgr, "zp": zphone, "ze": zemail, "zid": existing_zid})
                zone_map[zcode] = existing_zid
            else:
                ins = await session.execute(text("""
                    INSERT INTO outlet_zones (region_id, zone_code, name, manager_name, contact_phone, email, is_active)
                    VALUES (:rid, :zc, :zn, :zm, :zp, :ze, TRUE)
                    RETURNING id
                """), {"rid": region_id, "zc": zcode, "zn": zname, "zm": zmgr, "zp": zphone, "ze": zemail})
                zone_map[zcode] = ins.scalar_one()
        print(f"[OK] Seeded/Updated 5 Zones: {zone_map}")

        # 8. Seed/Update 20 Verified Stores (Preserve ID 43)
        stores_data = [
            {
                "unit_code": "G0001",
                "name": "geom365 - Connaught Place",
                "display_name": "GEOM365 Connaught Place (Inner Circle)",
                "zone_code": "Z-WN",
                "address": "Block M, Inner Circle, Connaught Place, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110001",
                "manager_name": "Arun Kumar",
                "manager_mobile": "+91 98711 00001",
                "manager_email": "cp@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Flagship Retail",
                "store_size": "2,400 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0002",
                "name": "geom365 - WorldMark Aerocity",
                "display_name": "GEOM365 Aerocity WorldMark 1",
                "zone_code": "Z-SD",
                "address": "WorldMark 1, Asset Area 8, Hospitality District, Aerocity, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110037",
                "manager_name": "Rohit Mehta",
                "manager_mobile": "+91 98711 00002",
                "manager_email": "aerocity@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Transit Hub",
                "store_size": "1,850 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0003",
                "name": "geom365 - Daryaganj",
                "display_name": "GEOM365 Daryaganj Netaji Subhash Marg",
                "zone_code": "Z-WN",
                "address": "Netaji Subhash Marg, Near Golcha Cinema, Daryaganj, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110002",
                "manager_name": "Mohd. Tariq",
                "manager_mobile": "+91 98711 00003",
                "manager_email": "daryaganj@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Convenience Retail",
                "store_size": "1,400 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0004",
                "name": "geom365 - Dwarka Sector 3",
                "display_name": "GEOM365 Dwarka Sector 3 Main Market",
                "zone_code": "Z-WN",
                "address": "Plot No. 12, Main Market, Sector 3, Dwarka, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110078",
                "manager_name": "Deepak Joshi",
                "manager_mobile": "+91 98711 00004",
                "manager_email": "dwarka.sec3@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Neighbourhood Retail",
                "store_size": "1,600 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0005",
                "name": "geom365 - Dwarka Sector 9",
                "display_name": "GEOM365 Dwarka Sector 9 Metro",
                "zone_code": "Z-WN",
                "address": "Metro Station Complex, Sector 9, Dwarka, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110077",
                "manager_name": "Alok Mishra",
                "manager_mobile": "+91 98711 00005",
                "manager_email": "dwarka.sec9@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Transit Retail",
                "store_size": "1,200 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0006",
                "name": "geom365 - Vasant Kunj",
                "display_name": "GEOM365 Vasant Kunj Sector B",
                "zone_code": "Z-SD",
                "address": "Sector B, Pocket 8, DDA Market, Vasant Kunj, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110070",
                "manager_name": "Kavita Rao",
                "manager_mobile": "+91 98711 00006",
                "manager_email": "vasantkunj@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Premium Retail",
                "store_size": "2,100 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0007",
                "name": "geom365 - Panchsheel Park",
                "display_name": "GEOM365 Panchsheel / Soami Nagar",
                "zone_code": "Z-SD",
                "address": "Commercial Complex, Panchsheel Park / Soami Nagar, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110017",
                "manager_name": "Siddharth Jain",
                "manager_mobile": "+91 98711 00007",
                "manager_email": "panchsheel@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Convenience Retail",
                "store_size": "1,550 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0008",
                "name": "geom365 - Okhla Phase 3",
                "display_name": "GEOM365 Okhla Phase 3 Industrial Hub",
                "zone_code": "Z-SE",
                "address": "Okhla Industrial Estate Phase III, Near Modi Mill, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110020",
                "manager_name": "Gaurav Bansal",
                "manager_mobile": "+91 98711 00008",
                "manager_email": "okhla@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Corporate & Industrial",
                "store_size": "1,750 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0009",
                "name": "geom365 - Mohan Cooperative (Flagship)",
                "display_name": "GEOM365 Mohan Cooperative Flagship & Experience Centre",
                "zone_code": "Z-SE",
                "address": "TR-311, ALTF Mohan Cooperative Ind. Estate, Mathura Road, South Delhi",
                "city": "South Delhi",
                "state": "Delhi",
                "pincode": "110076",
                "manager_name": "Praveen Tiwari",
                "manager_mobile": "+91 74003 39365",
                "manager_email": "care@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Super Flagship & HO Outlet",
                "store_size": "3,200 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0010",
                "name": "geom365 - Sarita Vihar",
                "display_name": "GEOM365 Sarita Vihar Pocket A",
                "zone_code": "Z-SE",
                "address": "Pocket A, Central Market, Sarita Vihar, South Delhi",
                "city": "South Delhi",
                "state": "Delhi",
                "pincode": "110076",
                "manager_name": "Naveen Saxena",
                "manager_mobile": "+91 98711 00010",
                "manager_email": "saritavihar@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Convenience Retail",
                "store_size": "1,450 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0011",
                "name": "geom365 - Pitampura",
                "display_name": "GEOM365 Netaji Subhash Place Pitampura",
                "zone_code": "Z-WN",
                "address": "Netaji Subhash Place / Pitampura Hub, North-West Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110034",
                "manager_name": "Ramesh Chander",
                "manager_mobile": "+91 98711 00011",
                "manager_email": "pitampura@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Urban Hub",
                "store_size": "1,900 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                # PRESERVED EXISTING OUTLET ID 43
                "unit_code": "G0012",
                "name": "G0012 - Adchini",
                "display_name": "GEOM365 Adchini (Sri Aurobindo Marg)",
                "zone_code": "Z-SD",
                "address": "81, Sri Aurobindo Marg, Adchini, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110017",
                "manager_name": "Sunil Rawat",
                "manager_mobile": "+91 98711 00012",
                "manager_email": "adchini@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Convenience Retail",
                "store_size": "1,500 sq.ft",
                "store_timing": "24 Hours / 7 Days Open",
                "preserve_id": 43
            },
            {
                "unit_code": "G0013",
                "name": "geom365 - Vikaspuri",
                "display_name": "GEOM365 Vikaspuri PVR Complex",
                "zone_code": "Z-WN",
                "address": "PVR Complex, District Centre, Vikaspuri, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110018",
                "manager_name": "Karan Singhal",
                "manager_mobile": "+91 98711 00013",
                "manager_email": "vikaspuri@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Neighbourhood Retail",
                "store_size": "1,650 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0014",
                "name": "geom365 - Subroto Park",
                "display_name": "GEOM365 Subroto Park AF Station",
                "zone_code": "Z-SD",
                "address": "Air Force Station Commercial Complex, Subroto Park, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110010",
                "manager_name": "Virender Tyagi",
                "manager_mobile": "+91 98711 00014",
                "manager_email": "subrotopark@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Community Store",
                "store_size": "1,350 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0015",
                "name": "geom365 - Mahipalpur",
                "display_name": "GEOM365 Mahipalpur NH-8",
                "zone_code": "Z-SD",
                "address": "National Highway 8, Near IGI T3 Road, Mahipalpur, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110037",
                "manager_name": "Anil Yadav",
                "manager_mobile": "+91 98711 00015",
                "manager_email": "mahipalpur@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Highway Transit",
                "store_size": "1,800 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0016",
                "name": "geom365 - APS Colony",
                "display_name": "GEOM365 APS Colony Delhi Cantt",
                "zone_code": "Z-SD",
                "address": "Shopping Complex, APS Colony, Delhi Cantt, New Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "pincode": "110010",
                "manager_name": "Manoj Negi",
                "manager_mobile": "+91 98711 00016",
                "manager_email": "apscolony@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Convenience Retail",
                "store_size": "1,400 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0017",
                "name": "geom365 - Noida Sector 21",
                "display_name": "GEOM365 Noida Sector 21 Jalvayu Vihar",
                "zone_code": "Z-NOI",
                "address": "Block E Market, Jalvayu Vihar, Sector 21, Noida",
                "city": "Noida",
                "state": "Uttar Pradesh",
                "pincode": "201301",
                "manager_name": "Pradeep Bhati",
                "manager_mobile": "+91 98711 00017",
                "manager_email": "noida.sec21@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Convenience Retail",
                "store_size": "1,700 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0018",
                "name": "geom365 - Noida Sector 41",
                "display_name": "GEOM365 Noida Sector 41 Aghapur",
                "zone_code": "Z-NOI",
                "address": "Aghapur Main Road, Sector 41, Noida",
                "city": "Noida",
                "state": "Uttar Pradesh",
                "pincode": "201303",
                "manager_name": "Harish Rawal",
                "manager_mobile": "+91 98711 00018",
                "manager_email": "noida.sec41@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Neighbourhood Retail",
                "store_size": "1,550 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0019",
                "name": "geom365 - Udyog Vihar Gurugram",
                "display_name": "GEOM365 Udyog Vihar Phase 4",
                "zone_code": "Z-GGN",
                "address": "Phase 4, Electronic City, Udyog Vihar, Gurugram",
                "city": "Gurugram",
                "state": "Haryana",
                "pincode": "122016",
                "manager_name": "Devendra Sehgal",
                "manager_mobile": "+91 98711 00019",
                "manager_email": "udyogvihar@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Tech Park & Corporate",
                "store_size": "2,200 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            },
            {
                "unit_code": "G0020",
                "name": "geom365 - Ambience Mall NH-8",
                "display_name": "GEOM365 Ambience Mall NH-8 Gurugram",
                "zone_code": "Z-GGN",
                "address": "Ambience Island, NH-8, DLF Phase 3, Gurugram",
                "city": "Gurugram",
                "state": "Haryana",
                "pincode": "122002",
                "manager_name": "Ashish Kapoor",
                "manager_mobile": "+91 98711 00020",
                "manager_email": "ambience@geom365.com",
                "store_type": "Company Operated",
                "store_category": "24/7 Premium Destination",
                "store_size": "2,600 sq.ft",
                "store_timing": "24 Hours / 7 Days Open"
            }
        ]

        for s in stores_data:
            zid = zone_map.get(s["zone_code"])
            # Check if store exists by unit_code or preserve_id
            existing = None
            if s.get("preserve_id"):
                chk = await session.execute(text("SELECT id FROM outlets WHERE id = :pid"), {"pid": s["preserve_id"]})
                existing = chk.scalar_one_or_none()
            if not existing:
                chk = await session.execute(text("SELECT id FROM outlets WHERE unit_code = :uc"), {"uc": s["unit_code"]})
                existing = chk.scalar_one_or_none()

            if existing:
                await session.execute(text("""
                    UPDATE outlets
                    SET region_id = :rid,
                        zone_id = :zid,
                        outlet_name = :name,
                        display_name = :dname,
                        address = :addr,
                        city = :city,
                        state = :state,
                        country = 'India',
                        pincode = :pin,
                        manager_name = :mgr,
                        manager_mobile = :mob,
                        manager_email = :email,
                        store_type = :stype,
                        store_category = :scat,
                        store_size = :ssize,
                        store_timing = :stim,
                        is_active = TRUE
                    WHERE id = :id
                """), {
                    "rid": region_id,
                    "zid": zid,
                    "name": s["name"],
                    "dname": s["display_name"],
                    "addr": s["address"],
                    "city": s["city"],
                    "state": s["state"],
                    "pin": s["pincode"],
                    "mgr": s["manager_name"],
                    "mob": s["manager_mobile"],
                    "email": s["manager_email"],
                    "stype": s["store_type"],
                    "scat": s["store_category"],
                    "ssize": s["store_size"],
                    "stim": s["store_timing"],
                    "id": existing
                })
                print(f"[OK] Updated store {s['unit_code']} (ID {existing})")
            else:
                ins = await session.execute(text("""
                    INSERT INTO outlets (
                        unit_code, outlet_code, outlet_name, display_name, region_id, zone_id,
                        address, city, state, country, pincode, manager_name, manager_mobile, manager_email,
                        store_type, store_category, store_size, store_timing, is_active, is_connected,
                        sync_required, sales_sync_required, closing_sync_required, schemes_sync_required, type
                    ) VALUES (
                        :uc, :uc, :name, :dname, :rid, :zid,
                        :addr, :city, :state, 'India', :pin, :mgr, :mob, :email,
                        :stype, :scat, :ssize, :stim, TRUE, TRUE,
                        FALSE, FALSE, FALSE, FALSE, 'O'
                    )
                    RETURNING id
                """), {
                    "uc": s["unit_code"],
                    "name": s["name"],
                    "dname": s["display_name"],
                    "rid": region_id,
                    "zid": zid,
                    "addr": s["address"],
                    "city": s["city"],
                    "state": s["state"],
                    "pin": s["pincode"],
                    "mgr": s["manager_name"],
                    "mob": s["manager_mobile"],
                    "email": s["manager_email"],
                    "stype": s["store_type"],
                    "scat": s["store_category"],
                    "ssize": s["store_size"],
                    "stim": s["store_timing"]
                })
                new_id = ins.scalar_one()
                print(f"[OK] Inserted store {s['unit_code']} - {s['name']} (ID {new_id})")

        await session.commit()
        print("\nALL GEOM365 MIGRATIONS AND SEEDING COMPLETED SUCCESSFULLY!")

asyncio.run(migrate_and_seed())
