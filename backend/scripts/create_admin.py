"""First administrator + NUTRIBAY company settings on a fresh nutribay_erp. Password is random and written to
backend/FIRST_LOGIN.txt (change it after the first login, then delete that file). Does nothing if 'admin' exists."""
import asyncio
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


async def main():
    from sqlalchemy import text
    from app.core.database import engine
    from app.core.security import hash_password
    async with engine.begin() as c:
        if (await c.execute(text("SELECT 1 FROM users WHERE username = 'admin'"))).first():
            print("admin already exists — nothing done")
            return
        pw = secrets.token_urlsafe(12)
        role_id = (await c.execute(text("SELECT id FROM roles WHERE LOWER(name) IN ('super admin', 'admin') ORDER BY id LIMIT 1"))).scalar()
        await c.execute(text("""INSERT INTO users (name, username, password, role, role_id, status, all_outlets, all_categories)
            VALUES ('Administrator', 'admin', :p, 'admin', :r, TRUE, TRUE, TRUE)"""), {"p": hash_password(pw), "r": role_id})
        if not (await c.execute(text("SELECT 1 FROM company_settings"))).first():
            await c.execute(text("""INSERT INTO company_settings (key_name, brand_name, legal_name, logo_path, enable_manufacturing, mfg_company_name)
                VALUES ('general', 'NUTRIBAY', 'Nutribay', '/nutribay_logo.svg', TRUE, 'NUTRIBAY')"""))
    (ROOT / "FIRST_LOGIN.txt").write_text(
        "Nutribay Manufacturing ERP — first login\nURL: http://localhost:5174\nUsername: admin\n"
        f"Password: {pw}\n\nChange this password after logging in, then delete this file.\n", encoding="utf-8")
    await engine.dispose()
    print("admin created — credentials in backend/FIRST_LOGIN.txt")


asyncio.run(main())
