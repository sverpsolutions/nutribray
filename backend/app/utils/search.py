"""Word-based search: every word must appear in some column, any order.

"maggi noodles" matches "MAGGI ATTA NOODLES".
"""
from sqlalchemy import and_, or_, true


def words(q: str | None) -> list[str]:
    return (q or "").split()


def word_match(q: str | None, *cols):
    """SQLAlchemy clause for ORM queries."""
    return and_(*(or_(*(c.ilike(f"%{w}%") for c in cols)) for w in words(q))) if words(q) else true()


def word_match_sql(q: str | None, cols: list[str], key: str = "w") -> tuple[str, dict]:
    """(sql_fragment, params) for raw text() queries."""
    parts, params = [], {}
    for i, w in enumerate(words(q)):
        params[f"{key}{i}"] = f"%{w.lower()}%"
        parts.append("(" + " OR ".join(f"LOWER(COALESCE({c}, '')) LIKE :{key}{i}" for c in cols) + ")")
    return (" AND ".join(parts) or "TRUE"), params


if __name__ == "__main__":
    sql, p = word_match_sql("Maggi  noodles", ["p.name", "p.item_code"])
    assert sql == "(LOWER(COALESCE(p.name, '')) LIKE :w0 OR LOWER(COALESCE(p.item_code, '')) LIKE :w0) AND (LOWER(COALESCE(p.name, '')) LIKE :w1 OR LOWER(COALESCE(p.item_code, '')) LIKE :w1)", sql
    assert p == {"w0": "%maggi%", "w1": "%noodles%"}
    assert word_match_sql("  ", ["x"]) == ("TRUE", {})
    print("ok")
