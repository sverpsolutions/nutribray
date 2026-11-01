"""Loyalty programme: earn on eligible bill value, redeem as the 'loyalty' tender, expire, reverse on cancel / return,
manual adjustments through approval. The ledger is the only source of a customer's balance.

Earned rows keep `remaining`; redemptions and expiries consume the oldest points first. Each bill can earn once and
redeem once (unique index), so a double submit cannot credit points twice.
"""
from datetime import date, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text

from app.services.approval_service import handler
from app.services.mfg_stock_service import today

D = lambda v: Decimal(str(v or 0))  # noqa: E731
P2 = Decimal("0.01")


async def config(db) -> dict:
    return dict((await db.execute(text("SELECT * FROM loyalty_config WHERE id = 1"))).mappings().one())


async def member(db, customer_id: Optional[int], lock: bool = False) -> Optional[dict]:
    if not customer_id:
        return None
    r = (await db.execute(text("SELECT id, name, phone, loyalty_no, loyalty_status FROM customers WHERE id = :c" + (" FOR UPDATE" if lock else "")),
                          {"c": customer_id})).mappings().first()
    return dict(r) if r and r["loyalty_status"] == "ACTIVE" else None


async def _consume(db, customer_id: int, points: Decimal, outlet_id: Optional[int], consolidated: bool):
    """Take `points` from the oldest still-valid earned rows (remaining)."""
    rows = (await db.execute(text("""SELECT id, remaining FROM loyalty_ledger WHERE customer_id = :c AND remaining > 0
        AND (expires_on IS NULL OR expires_on >= :t) AND (:cons OR outlet_id = :o) ORDER BY COALESCE(expires_on, '9999-12-31'), id FOR UPDATE"""),
        {"c": customer_id, "t": today(), "cons": consolidated, "o": outlet_id})).all()
    left = points
    for rid, rem in rows:
        take = min(D(rem), left)
        await db.execute(text("UPDATE loyalty_ledger SET remaining = remaining - :q WHERE id = :i"), {"q": take, "i": rid})
        left -= take
        if left <= 0:
            break
    return left


async def expire_due(db, customer_id: int):
    """Lazy expiry: earned points past their date become an EXPIRE entry (once)."""
    for rid, rem, out in (await db.execute(text("""SELECT id, remaining, outlet_id FROM loyalty_ledger WHERE customer_id = :c AND remaining > 0
            AND expires_on < :t FOR UPDATE"""), {"c": customer_id, "t": today()})).all():
        await db.execute(text("UPDATE loyalty_ledger SET remaining = 0 WHERE id = :i"), {"i": rid})
        await db.execute(text("""INSERT INTO loyalty_ledger (customer_id, outlet_id, txn_type, points, reference, reason)
            VALUES (:c, :o, 'EXPIRE', :p, :ref, 'Points expired')"""), {"c": customer_id, "o": out, "p": -D(rem), "ref": f"L{rid}"})


async def balance(db, customer_id: int, outlet_id: Optional[int] = None) -> dict:
    cfg = await config(db)
    await expire_due(db, customer_id)
    cons = cfg["consolidated"] or outlet_id is None
    r = (await db.execute(text("""SELECT COALESCE(SUM(points), 0) AS current,
        COALESCE(SUM(points) FILTER (WHERE txn_type = 'EARN'), 0) AS earned,
        COALESCE(-SUM(points) FILTER (WHERE txn_type = 'REDEEM'), 0) AS redeemed,
        COALESCE(-SUM(points) FILTER (WHERE txn_type = 'EXPIRE'), 0) AS expired,
        MIN(expires_on) FILTER (WHERE remaining > 0) AS next_expiry
        FROM loyalty_ledger WHERE customer_id = :c AND (:cons OR outlet_id = :o)"""), {"c": customer_id, "cons": cons, "o": outlet_id})).mappings().one()
    return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()} | {"point_value": float(cfg["point_value"])}


async def rule_for(db, outlet_id: Optional[int], on: date) -> Optional[dict]:
    """Best active earning rule for this store and date (campaigns beat the standard rule)."""
    r = (await db.execute(text("""SELECT * FROM loyalty_rules WHERE is_active AND (valid_from IS NULL OR valid_from <= :d)
        AND (valid_to IS NULL OR valid_to >= :d) AND (outlet_ids IS NULL OR CAST(:o AS INT) = ANY(outlet_ids))
        ORDER BY is_campaign DESC, multiplier / spend_per_point DESC, id LIMIT 1"""), {"d": on, "o": outlet_id})).mappings().first()
    return dict(r) if r else None


async def eligible_amount(db, rule: dict, lines: list[tuple[int, Decimal]]) -> Decimal:
    """Sum of line totals for items the rule covers (category / item lists, exclusions)."""
    if not lines:
        return Decimal(0)
    cats = dict((await db.execute(text("SELECT id, category_id FROM products WHERE id = ANY(:p)"), {"p": [p for p, _ in lines]})).all())
    total = Decimal(0)
    for pid, amt in lines:
        cat = cats.get(pid)
        if rule["excluded_product_ids"] and pid in rule["excluded_product_ids"]:
            continue
        if rule["excluded_category_ids"] and cat in rule["excluded_category_ids"]:
            continue
        if (rule["product_ids"] or rule["category_ids"]) and not ((rule["product_ids"] and pid in rule["product_ids"]) or
                                                                   (rule["category_ids"] and cat in rule["category_ids"])):
            continue
        total += D(amt)
    return total


async def redeem(db, *, customer_id: int, outlet_id: Optional[int], amount: Decimal, bill_total: Decimal, invoice_id: int, invoice_no: str,
                 user_id: Optional[int]) -> Decimal:
    """Validate and post a redemption paid as the 'loyalty' tender. Returns points used."""
    cfg = await config(db)
    if not cfg["enabled"]:
        raise HTTPException(400, "The loyalty programme is switched off.")
    m = await member(db, customer_id, lock=True)
    if not m:
        raise HTTPException(400, "This customer is not an active loyalty member.")
    if cfg["redeem_outlet_ids"] and outlet_id not in cfg["redeem_outlet_ids"]:
        raise HTTPException(400, "Points cannot be redeemed at this store.")
    pts = (D(amount) / D(cfg["point_value"])).quantize(P2)
    bal = D((await balance(db, customer_id, outlet_id))["current"])
    if pts < D(cfg["min_redeem_points"]):
        raise HTTPException(400, f"Minimum redemption is {D(cfg['min_redeem_points']):f} points.")
    if cfg["max_redeem_points"] and pts > D(cfg["max_redeem_points"]):
        raise HTTPException(400, f"At most {D(cfg['max_redeem_points']):f} points per bill.")
    if D(amount) > (D(bill_total) * D(cfg["max_redeem_pct"]) / 100).quantize(P2):
        raise HTTPException(400, f"Points can pay at most {D(cfg['max_redeem_pct']):f}% of the bill.")
    if pts > bal:
        raise HTTPException(400, f"Only {bal:f} points available; {pts:f} needed.")
    short = await _consume(db, customer_id, pts, outlet_id, cfg["consolidated"])
    if short > 0:
        raise HTTPException(400, "Points are no longer available (expired or used).")
    await db.execute(text("""INSERT INTO loyalty_ledger (customer_id, outlet_id, txn_type, points, invoice_id, amount, reference, created_by)
        VALUES (:c, :o, 'REDEEM', :p, :i, :a, :ref, :u)"""), {"c": customer_id, "o": outlet_id, "p": -pts, "i": invoice_id, "a": amount,
                                                              "ref": invoice_no, "u": user_id})
    return pts


async def earn(db, *, customer_id: int, outlet_id: Optional[int], on: date, lines: list[tuple[int, Decimal]], paid_by_points: Decimal,
               invoice_id: int, invoice_no: str, user_id: Optional[int]) -> Decimal:
    cfg = await config(db)
    if not cfg["enabled"] or not await member(db, customer_id):
        return Decimal(0)
    rule = await rule_for(db, outlet_id, on)
    if not rule:
        return Decimal(0)
    eligible = max(await eligible_amount(db, rule, lines) - D(paid_by_points), Decimal(0))
    if eligible < D(rule["min_bill"]) or eligible <= 0:
        return Decimal(0)
    pts = ((eligible / D(rule["spend_per_point"])).to_integral_value(rounding=ROUND_DOWN) * D(rule["multiplier"])).quantize(P2)
    if rule["max_points"]:
        pts = min(pts, D(rule["max_points"]))
    if pts <= 0:
        return Decimal(0)
    await db.execute(text("""INSERT INTO loyalty_ledger (customer_id, outlet_id, txn_type, points, remaining, expires_on, invoice_id, rule_id,
        eligible_amount, reference, created_by) VALUES (:c, :o, 'EARN', :p, :p, :e, :i, :r, :ea, :ref, :u)
        ON CONFLICT (invoice_id, txn_type) WHERE invoice_id IS NOT NULL AND txn_type IN ('EARN','REDEEM') DO NOTHING"""),
        {"c": customer_id, "o": outlet_id, "p": pts, "e": on + timedelta(days=rule["expiry_days"]) if rule["expiry_days"] else None,
         "i": invoice_id, "r": rule["id"], "ea": eligible, "ref": invoice_no, "u": user_id})
    return pts


async def reverse_bill(db, invoice_id: int, user_id: Optional[int], share: Decimal = Decimal(1), reason: str = "Bill cancelled",
                       ref: Optional[str] = None):
    """Cancel (share = 1) or return (share = returned / original): take back the earned points and give back redeemed ones."""
    ref = ref or "CANCEL"
    if (await db.execute(text("SELECT 1 FROM loyalty_ledger WHERE invoice_id = :i AND txn_type = 'REVERSAL' AND reference = :r"),
                         {"i": invoice_id, "r": ref})).first():
        return                                       # this cancel / credit note was already reversed
    rows = (await db.execute(text("""SELECT id, customer_id, outlet_id, txn_type, points, remaining FROM loyalty_ledger
        WHERE invoice_id = :i AND txn_type IN ('EARN','REDEEM') FOR UPDATE"""), {"i": invoice_id})).mappings().all()
    for r in rows:
        if r["txn_type"] == "EARN":
            back = (D(r["points"]) * share).quantize(P2)
            take = min(back, D(r["remaining"]))
            await db.execute(text("UPDATE loyalty_ledger SET remaining = remaining - :q WHERE id = :i"), {"q": take, "i": r["id"]})
            if back > take:   # some of the earned points were already used: take the rest from other points (may go negative)
                await _consume(db, r["customer_id"], back - take, r["outlet_id"], True)
            delta = -back
        else:
            delta = (-D(r["points"]) * share).quantize(P2)     # redeemed points come back (as a fresh, non-expiring credit)
        if delta:
            await db.execute(text("""INSERT INTO loyalty_ledger (customer_id, outlet_id, txn_type, points, remaining, invoice_id, reference, reason, created_by)
                VALUES (:c, :o, 'REVERSAL', :p, :rem, :i, :ref, :why, :u)"""),
                {"c": r["customer_id"], "o": r["outlet_id"], "p": delta, "rem": delta if delta > 0 else None, "i": invoice_id,
                 "ref": ref, "why": f"{reason} ({r['txn_type'].lower()})", "u": user_id})


@handler("LOYALTY_ADJUST")
class LoyaltyAdjust:
    @staticmethod
    async def check(db, p: dict):
        if not await member(db, int(p["customer_id"])):
            raise HTTPException(400, "Customer is not an active loyalty member.")
        pts = D(p["points"])
        if pts == 0:
            raise HTTPException(400, "Points cannot be zero.")
        if pts < 0 and -pts > D((await balance(db, int(p["customer_id"])))["current"]):
            raise HTTPException(400, "Cannot deduct more points than the customer has.")

    @staticmethod
    async def post(db, req: dict, approver) -> str:
        p = req["payload"]
        pts = D(p["points"])
        if pts < 0:
            await _consume(db, int(p["customer_id"]), -pts, None, True)
        lid = (await db.execute(text("""INSERT INTO loyalty_ledger (customer_id, outlet_id, txn_type, points, remaining, reference, reason, created_by)
            VALUES (:c, :o, 'ADJUST', :p, :rem, :ref, :why, :u) RETURNING id"""),
            {"c": int(p["customer_id"]), "o": req.get("outlet_id"), "p": pts, "rem": pts if pts > 0 else None, "ref": req["request_no"],
             "why": req["reason"], "u": approver.user_id})).scalar()
        return f"LOY-{lid}"


if __name__ == "__main__":
    assert (Decimal("1250") / Decimal("100")).to_integral_value(rounding=ROUND_DOWN) == 12
    print("loyalty_service OK")
