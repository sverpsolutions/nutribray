"""User management: employee fields, all-outlet / all-category flags, group (sub-category) access,
permission audit, module/action permission catalogue + starting role templates.

Reuses the existing tables: users, roles, permissions, role_permissions, user_granular_permissions,
user_store_assignments (outlets), user_category_assignments (categories).

Existing non-admin users keep working as before: one with no outlet assignments gets all_outlets = TRUE,
one with no category assignments gets all_categories = TRUE, and their role gets its starting template.

Revision ID: f8a0b2c4d6e7
Revises: e7f9a1b3c5d6
Create Date: 2026-10-23 15:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'f8a0b2c4d6e7'
down_revision: Union[str, None] = 'e7f9a1b3c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLS = [("employee_code", "VARCHAR(30)"), ("mobile", "VARCHAR(20)"), ("department", "VARCHAR(60)"),
        ("designation", "VARCHAR(60)"), ("valid_from", "DATE"), ("valid_until", "DATE"),
        ("all_outlets", "BOOLEAN NOT NULL DEFAULT FALSE"), ("all_categories", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ("created_by", "INTEGER"), ("updated_by", "INTEGER")]


def upgrade() -> None:
    from app.core.access import MODULES, ROLE_TEMPLATES
    for c, t in COLS:
        op.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {c} {t}")
    op.execute("""UPDATE users u SET all_outlets = TRUE WHERE role NOT IN ('admin','superadmin') AND u.outlet_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM user_store_assignments a WHERE a.user_id = u.id)
                  AND NOT EXISTS (SELECT 1 FROM user_region_assignments a WHERE a.user_id = u.id)
                  AND NOT EXISTS (SELECT 1 FROM user_zone_assignments a WHERE a.user_id = u.id)""")
    op.execute("""UPDATE users u SET all_categories = TRUE WHERE role NOT IN ('admin','superadmin')
                  AND NOT EXISTS (SELECT 1 FROM user_category_assignments a WHERE a.user_id = u.id)""")
    op.execute("""CREATE TABLE user_subcategory_assignments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subcategory_id INTEGER NOT NULL REFERENCES item_subcategories(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_subcategory UNIQUE (user_id, subcategory_id))""")
    op.execute("CREATE INDEX ix_user_subcat_user ON user_subcategory_assignments (user_id)")
    op.execute("""CREATE TABLE user_permission_audit (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        changed_by INTEGER,
        changed_by_name VARCHAR(100),
        before JSONB,
        after JSONB,
        summary TEXT,
        ip_address VARCHAR(45),
        created_at TIMESTAMP NOT NULL DEFAULT NOW())""")
    op.execute("CREATE INDEX ix_user_perm_audit_user ON user_permission_audit (user_id, created_at)")

    conn = op.get_bind()
    for key, label, _kind, acts in MODULES:
        for a in acts:
            conn.execute(sa.text("""INSERT INTO permissions (module, name, slug) VALUES (:m, :n, :s)
                                    ON CONFLICT (slug) DO NOTHING"""), {"m": key, "n": f"{label} — {a}", "s": f"{key}.{a}"})
    for role_slug, slugs in ROLE_TEMPLATES.items():
        conn.execute(sa.text("""INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id FROM roles r JOIN permissions p ON p.slug = ANY(:s) WHERE r.slug = :r
            AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id)
            ON CONFLICT DO NOTHING"""), {"s": slugs, "r": role_slug})


def downgrade() -> None:
    op.execute("DROP TABLE user_permission_audit")
    op.execute("DROP TABLE user_subcategory_assignments")
    for c, _ in COLS:
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {c}")
