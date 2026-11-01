# Nutribay Manufacturing ERP

Independent copy of the GEOM365 / ModernBazaarHO software for NUTRIBAY (manufacturing + inventory).
Nothing here is shared with `C:\xampp\htdocs\ModernBazaarHO` at run time.

| | ModernBazaarHO (original) | Nutribay |
|---|---|---|
| Folder | `C:\xampp\htdocs\ModernBazaarHO` | `C:\xampp\htdocs\Nutribay` |
| Database | `modernbazaar` | `nutribay_erp` |
| Database login | postgres | `nutribay` (owns only `nutribay_erp`; refused on `modernbazaar`) |
| API | http://localhost:8000 | http://localhost:8100 |
| App | http://localhost:5173 | http://localhost:5174 |
| Settings | `backend\.env` | `backend\.env` (own secret key — logins never cross) |
| Uploads / backups | its own folders | `backend\uploads`, default backup path `C:\Backups\Nutribay` |
| Outlet sync worker | runs | **not started** (Nutribay never connects to stores or the old MySQL) |

## Start / stop

`run_nutribay.bat` (opens http://localhost:5174) · `stop_nutribay.bat`

First login: `backend\FIRST_LOGIN.txt` — change the password after logging in, then delete that file.

## What the database holds

Structure: identical to the live geom365 database (257 tables, latest migration). Data: **no business data** — only
configuration needed to run (roles, permissions, approval rules, payment modes, plant stores, units, GST rates, states,
countries, storage / temperature types, product classifications) and the first administrator.
Company details and logo: Settings → Company Profile.

## Getting started (manufacturing)

1. Settings → Company Profile: legal name, GSTIN, addresses, logo.
2. Settings → Users: create users and roles.
3. Manufacturing → Customer Packaging Masters → Customer Brands → **Import item list** (customer product list,
   packing material list).
4. Item Master: raw materials (powder, premix).
5. Bill of Materials → **Import BOMs** (or New BOM) → BOM Approvals.
6. Customer Orders & Dispatch → order in cartons → Material Planning & Shortage → purchase / transfer the shortfall.
7. Purchase → GRN → inward to plant stores → Production order → approve → reserve → release → issue → report
   output → QC → finalize → Finished Goods → dispatch.

Tested end to end on this copy (3 cartons x 24 tins = 72; issued, consumed, 70 good, 2 rejected, QC, finished goods),
rolled back afterwards.

## Fresh database (re-create)

1. Create `nutribay_erp` owned by `nutribay`; load a structure-only dump; insert the latest revision into `alembic_version`.
2. `venv\Scripts\python scripts\seed_config.py` — configuration rows from every migration.
3. `venv\Scripts\python scripts\create_admin.py` — first administrator + NUTRIBAY company row.

Later code updates from the original: copy the changed files, then `venv\Scripts\python -m alembic upgrade head`.
