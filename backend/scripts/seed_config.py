"""Fill configuration rows on a database whose STRUCTURE was created from a schema dump (migrations stamped, never run):
replays only the data statements (INSERT / UPDATE) of every migration — permissions, role grants, approval policies,
payment modes, plant stores, tolerances, single-row settings — and skips structure changes (already present).
Idempotent: the migrations' inserts use ON CONFLICT / NOT EXISTS, so running it twice is harmless.

    venv\\Scripts\\python scripts\\seed_config.py
"""
import asyncio
import importlib.util
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DML = re.compile(r"^\s*(INSERT|UPDATE|WITH)\b", re.I)


def _sql(s) -> str:
    return str(getattr(s, "text", s))


class Bind:
    """Connection proxy: data statements run, anything else (DDL) is skipped."""
    def __init__(self, conn, log):
        self.conn, self.log = conn, log

    def execute(self, stmt, *a, **k):
        if DML.match(_sql(stmt)):
            self.log.append(_sql(stmt).split("(")[0].strip()[:60])
            return self.conn.execute(stmt, *a, **k)
        return _Empty()

    def __getattr__(self, n):
        return getattr(self.conn, n)


class _Empty:
    def __iter__(self):
        return iter(())

    def fetchall(self):
        return []

    def first(self):
        return None

    def scalar(self):
        return None

    def mappings(self):
        return self


class Op:
    """Stand-in for alembic `op`: only execute()/get_bind() do anything, and only for data statements."""
    def __init__(self, bind):
        self.bind = bind

    def get_bind(self):
        return self.bind

    def execute(self, stmt, *a, **k):
        return self.bind.execute(stmt if not isinstance(stmt, str) else __import__("sqlalchemy").text(stmt), *a, **k)

    def __getattr__(self, n):          # add_column, create_table, create_index, … : structure exists already
        return lambda *a, **k: None


def ordered_migrations():
    mods = {}
    for f in (ROOT / "migrations" / "versions").glob("*.py"):
        spec = importlib.util.spec_from_file_location(f.stem, f)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        mods[m.revision] = m
    by_down = {m.down_revision: m for m in mods.values()}
    out, cur = [], by_down.get(None)
    while cur:
        out.append(cur)
        cur = by_down.get(cur.revision)
    return out


def run(sync_conn):
    import alembic.op as real_op_module
    for m in ordered_migrations():
        log: list = []
        op = Op(Bind(sync_conn, log))
        m.op = op                                   # the migration module did `from alembic import op`
        sp = sync_conn.begin_nested()
        try:
            m.upgrade()
            sp.commit()
        except Exception as e:      # structure-only migrations that inspect the database: nothing to seed
            sp.rollback()
            print(f"{m.revision}: skipped ({type(e).__name__})" + (" — HAD DATA STATEMENTS" if log else ""))
            continue
        if log:
            print(f"{m.revision}: {len(log)} data statement(s)")
    _ = real_op_module


async def main():
    from app.core.database import engine
    async with engine.begin() as conn:
        await conn.run_sync(run)
    await engine.dispose()
    print("configuration rows seeded")


if __name__ == "__main__":
    asyncio.run(main())
