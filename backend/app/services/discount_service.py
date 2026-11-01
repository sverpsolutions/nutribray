"""Discount control: which discount types may be used and combined, the hard cap, and the approval limit.
Checked on the server for every bill — the till cannot bypass it."""
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text

from app.services.approval_service import handler

LABEL = {"item": "item discount", "bill": "bill discount", "scheme": "scheme / promotion", "loyalty": "loyalty redemption"}
PAIRS = {("item", "bill"): "item_with_bill", ("item", "scheme"): "item_with_scheme", ("bill", "scheme"): "bill_with_scheme"}


async def policy(db) -> dict:
    return dict((await db.execute(text("SELECT * FROM discount_policy WHERE id = 1"))).mappings().one())


def violations(pol: dict, used: set[str]) -> list[str]:
    """Rules broken by this combination of discount types (pure; see __main__)."""
    out = [f"{LABEL[k].capitalize()} is not allowed." for k in sorted(used) if not pol[f"{k}_allowed"]]
    for (a, b), col in PAIRS.items():
        if a in used and b in used and not pol[col]:
            out.append(f"{LABEL[a].capitalize()} cannot be combined with {LABEL[b]}.")
    if "loyalty" in used and used - {"loyalty"} and not pol["loyalty_with_discount"]:
        out.append("Loyalty points cannot be redeemed on a bill that already has a discount.")
    return out


async def enforce(db, *, used: set[str], pct: Decimal, outlet_id: Optional[int], role: str, approval_no: Optional[str],
                  invoice_no: str) -> Optional[str]:
    """Raise 400 when the bill breaks the policy. Returns the approval request no consumed (if any)."""
    pol = await policy(db)
    override = role in (pol["override_roles"] or [])
    bad = [] if override else violations(pol, used)
    if bad:
        raise HTTPException(400, "Discount not allowed: " + " ".join(bad))
    if pct > Decimal(pol["max_discount_pct"]):
        raise HTTPException(400, f"Total discount {pct:.2f}% is above the maximum {Decimal(pol['max_discount_pct']):f}% allowed.")
    limit = pol["approval_above_pct"]
    if limit is None or pct <= Decimal(limit) or override:
        return None
    if not approval_no:
        raise HTTPException(400, f"Discount {pct:.2f}% is above {Decimal(limit):f}%: get a High Discount approval and enter its request number.")
    a = (await db.execute(text("""SELECT id, outlet_id, payload, posted_ref FROM approval_requests WHERE request_no = :n AND request_type = 'HIGH_DISCOUNT'
        AND status = 'APPROVED' FOR UPDATE"""), {"n": approval_no.strip()})).mappings().first()
    if not a:
        raise HTTPException(400, f"{approval_no} is not an approved High Discount request.")
    if a["posted_ref"] and a["posted_ref"] != "APPROVED":
        raise HTTPException(400, f"{approval_no} was already used on bill {a['posted_ref']}.")
    if a["outlet_id"] and outlet_id and a["outlet_id"] != outlet_id:
        raise HTTPException(400, f"{approval_no} was approved for another store.")
    if pct > Decimal(str(a["payload"].get("discount_pct", 0))) + Decimal("0.01"):
        raise HTTPException(400, f"{approval_no} approved up to {a['payload'].get('discount_pct')}%; this bill has {pct:.2f}%.")
    await db.execute(text("UPDATE approval_requests SET posted_ref = :b WHERE id = :i"), {"b": invoice_no, "i": a["id"]})
    return approval_no.strip()


@handler("HIGH_DISCOUNT")
class HighDiscount:
    @staticmethod
    async def check(db, p: dict):
        pct = Decimal(str(p.get("discount_pct", 0)))
        pol = await policy(db)
        if pct <= 0 or pct > Decimal(pol["max_discount_pct"]):
            raise HTTPException(400, f"Discount must be above 0 and at most {Decimal(pol['max_discount_pct']):f}%.")

    @staticmethod
    async def post(db, req: dict, approver) -> str:
        return "APPROVED"          # the approval itself is the authority; the bill that uses it stamps posted_ref


if __name__ == "__main__":
    base = {"item_allowed": True, "bill_allowed": True, "scheme_allowed": True, "loyalty_allowed": True, "item_with_bill": False,
            "item_with_scheme": True, "bill_with_scheme": True, "loyalty_with_discount": False}
    assert violations(base, {"item"}) == []
    assert violations(base, {"item", "bill"}) == ["Item discount cannot be combined with bill discount."]
    assert violations(base, {"scheme", "loyalty"}) == ["Loyalty points cannot be redeemed on a bill that already has a discount."]
    assert violations({**base, "bill_allowed": False}, {"bill"}) == ["Bill discount is not allowed."]
    print("discount_service OK")
