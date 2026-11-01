"""Scheme engine — port of NCG application/libraries/SchemeEngine.php.

evaluate() takes the bill lines and returns what every active scheme gives, per line, so the
POS preview and the saved invoice use the SAME numbers (create_invoice re-runs it server-side;
the client never sends a scheme discount).

Differences from NCG, on purpose:
  * value basis is the SELLING value (rate x qty, GST incl.), not MRP — same rule as CD here.
  * a discount is attributed to the lines it came from (CHEAPEST_FREE: the exact free units)
    and can never take a line below zero.
  * CREDIT_NOTE results are kept (NCG dropped them because their discount is 0).
"""
from datetime import date, datetime, time
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

D0 = Decimal("0")
CASH_LIKE = {"cash", "upi", "card", "neft", "cheque"}
TYPES = ("QTY_SLAB", "VALUE_DISC", "FREE_ITEM", "MIX_MATCH", "CARTON", "TARGET", "CASH_DISC", "CREDIT_NOTE", "CHEAPEST_FREE", "BULK_TIER")


def _d(v) -> Decimal:
    return Decimal(str(v or 0))


def _two(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _pct(p: Decimal) -> str:
    return f"{p.normalize():f}"


def cascade(base: Decimal, p1: Decimal, p2: Decimal = D0) -> tuple[Decimal, str]:
    """'20% + 10% extra': the 2nd % applies to what is left after the 1st (100 -> 80 -> 72 = 28 off)."""
    d1 = _two(base * p1 / 100)
    if p2 <= 0:
        return d1, f"{_pct(p1)}%"
    total = _two(d1 + _two((base - d1) * p2 / 100))
    eff = _two(total / base * 100) if base > 0 else D0
    return total, f"{_pct(p1)}% + {_pct(p2)}% extra (= {_pct(eff)}% effective)"


def _in_time(s, now: time) -> bool:
    st, et = s["start_time"], s["end_time"]
    if not st or not et or st == et:
        return True
    return st <= now <= et if st < et else (now >= st or now <= et)  # overnight window


def _matches(s, ln, today: date) -> bool:
    if s["expiry_days_trigger"] is not None:
        exp = ln.get("expiry_date")
        if not exp or not (0 <= (exp - today).days <= s["expiry_days_trigger"]):
            return False
    on = s["apply_on"]
    if on == "invoice":
        return True
    if on == "brand":
        return ln["brand_id"] == s["brand_id"]
    if on == "category":
        return ln["category_id"] == s["category_id"]
    if on == "brand_category":
        return ln["brand_id"] == s["brand_id"] and ln["category_id"] == s["category_id"]
    pids = s["product_ids"] or []
    return not pids or ln["product_id"] in pids


def _benefit(disc=D0, free=None, benefit="discount_percent", note="", lines=None, alloc=None, credit=None):
    return {"discount": disc, "free": free or [], "benefit": benefit, "note": note,
            "lines": lines or [], "alloc": alloc, "credit": credit}


# ── handlers: each returns _benefit(...) or None ─────────────────────────────

def _qty_slab(s, lines, m):
    slabs = sorted(s["slabs"] or [], key=lambda x: (_d(x.get("min_qty")), _d(x.get("min_value"))))
    if not slabs and _d(s["min_qty"]) > 0:  # header-only scheme = one implicit, uncapped slab
        slabs = [{"min_qty": s["min_qty"], "max_qty": 0, "free_qty": s["free_qty"], "discount_percent": s["discount_percent"],
                  "discount_value": s["discount_value"], "free_item_id": s["free_item_id"]}]
    if not slabs:
        return None
    out = _benefit(benefit="free_item")
    notes = []
    for i in m:
        ln = lines[i]
        q = ln["qty"]
        hit = None
        for sl in slabs:
            mx = _d(sl.get("max_qty"))
            if q >= _d(sl.get("min_qty")) and (mx <= 0 or q <= mx):
                hit = sl
        last = slabs[-1]
        if not hit and _d(last.get("max_qty")) > 0 and q > _d(last.get("max_qty")):
            hit = last
        if not hit:
            continue
        free, pct, pct2, val = (_d(hit.get("free_qty")), _d(hit.get("discount_percent")),
                                _d(hit.get("discount_percent2")), _d(hit.get("discount_value")))
        if free <= 0 and pct <= 0 and val <= 0:
            free, pct, pct2, val = _d(s["free_qty"]), _d(s["discount_percent"]), _d(s["discount_percent2"]), _d(s["discount_value"])
        if s["is_recursive"] and _d(hit.get("min_qty")) > 0:
            free *= (q / _d(hit.get("min_qty"))).to_integral_value(ROUND_DOWN)
        if free > 0:
            out["free"].append((hit.get("free_item_id") or s["free_item_id"] or ln["product_id"], free))
            notes.append(f"Buy {q:f} get {free:f} free")
        if pct > 0:
            d, lbl = cascade(ln["value"], pct, pct2)
            out["discount"] += d; out["benefit"] = "discount_percent"; out["lines"].append(i); notes.append(lbl)
        if val > 0:
            out["discount"] += min(val, ln["value"]); out["benefit"] = "discount_value"; out["lines"].append(i)
    out["note"] = "; ".join(notes)
    return out


def _value_disc(s, lines, m):
    eligible = sum((lines[i]["value"] for i in m), D0)
    if not m or eligible < _d(s["min_value"]):
        return None
    pct, pct2, val = _d(s["discount_percent"]), _d(s["discount_percent2"]), _d(s["discount_value"])
    for sl in sorted(s["slabs"] or [], key=lambda x: _d(x.get("min_value")), reverse=True):
        if eligible >= _d(sl.get("min_value")):
            if _d(sl.get("discount_percent")) > 0 or _d(sl.get("discount_value")) > 0:
                pct, val = _d(sl.get("discount_percent")), _d(sl.get("discount_value"))
                pct2 = _d(sl.get("discount_percent2")) or pct2
            break
    else:
        if s["slabs"]:
            return None
    if pct > 0:
        d, lbl = cascade(eligible, pct, pct2)
        return _benefit(d, note=f"{lbl} on ₹{eligible:f}", lines=m)
    if val > 0:
        return _benefit(min(val, eligible), benefit="discount_value", note=f"Flat ₹{val:f} off", lines=m)
    return None


def _free_item(s, lines, m):
    min_q, min_v = _d(s["min_qty"]), _d(s["min_value"])
    if not any(lines[i]["qty"] >= min_q and lines[i]["value"] >= min_v for i in m):
        return None
    times = Decimal(1)
    if s["is_recursive"] and min_q > 0:
        times = (sum((lines[i]["qty"] for i in m), D0) / min_q).to_integral_value(ROUND_DOWN)
    free = [(f["product_id"], _d(f.get("qty") or 1) * times) for f in (s["free_items"] or []) if f.get("product_id")]
    if not free and _d(s["free_qty"]) > 0:
        pid = s["free_item_id"] or (s["product_ids"] or [None])[0]
        if pid:
            free = [(pid, _d(s["free_qty"]) * times)]
    return _benefit(free=free, benefit="free_item", note="Free item scheme") if free else None


def _mix_match(s, lines, _m):
    groups = s["mix_groups"] or []
    if not groups:
        return None
    used, total = [], D0
    for g in groups:
        idx = [i for i, ln in enumerate(lines) if ln["product_id"] in (g.get("product_ids") or [])]
        if sum((lines[i]["qty"] for i in idx), D0) < _d(g.get("min_qty") or 1):
            return None
        used += idx
        total += sum((lines[i]["value"] for i in idx), D0)
    used = sorted(set(used))
    if _d(s["discount_percent"]) > 0:
        d, lbl = cascade(total, _d(s["discount_percent"]), _d(s["discount_percent2"]))
        return _benefit(d, note=f"Mix & Match {lbl} on ₹{total:f}", lines=used)
    if _d(s["discount_value"]) > 0:
        return _benefit(min(_d(s["discount_value"]), total), benefit="discount_value", note="Mix & Match flat", lines=used)
    if _d(s["free_qty"]) > 0 and s["free_item_id"]:
        return _benefit(free=[(s["free_item_id"], _d(s["free_qty"]))], benefit="free_item", note="Mix & Match free item")
    return None


def _carton(s, lines, m):
    min_q = _d(s["min_qty"]) or Decimal(1)
    out = _benefit(benefit="free_item")
    for i in m:
        ln = lines[i]
        size = Decimal(max(1, ln["carton_size"] or s["carton_size"] or 1))
        crt = (ln["qty"] / size).to_integral_value(ROUND_DOWN)
        if crt < min_q:
            continue
        times = (crt / min_q).to_integral_value(ROUND_DOWN) if s["is_recursive"] else Decimal(1)
        if _d(s["free_qty"]) > 0:
            out["free"].append((s["free_item_id"] or ln["product_id"], _d(s["free_qty"]) * times))
        if _d(s["discount_percent"]) > 0:
            d, _ = cascade(ln["value"], _d(s["discount_percent"]), _d(s["discount_percent2"]))
            out["discount"] += d; out["benefit"] = "discount_percent"; out["lines"].append(i)
        out["note"] += f"{crt:f} carton(s). "
    return out


async def _target(db, s, lines, m, customer_id, today):
    eligible = sum((lines[i]["value"] for i in m), D0)
    if not m or eligible <= 0 or _d(s["target_amount"]) <= 0:
        return None
    cond, params = "", {"cid": customer_id, "sd": s["start_date"], "d": today}
    if s["apply_on"] == "item" and s["product_ids"]:
        cond, params["pids"] = " AND ii.product_id = ANY(:pids)", list(s["product_ids"])
    elif s["apply_on"] in ("brand", "brand_category"):
        cond, params["b"] = " AND p.brand_id = :b", s["brand_id"]
    if s["apply_on"] in ("category", "brand_category"):
        cond += " AND p.category_id = :c"; params["c"] = s["category_id"]
    past = _d((await db.execute(text(
        "SELECT COALESCE(SUM(ii.total),0) FROM unit_wise_invoices i JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id "
        "JOIN products p ON p.id = ii.product_id WHERE i.customer_id = :cid AND i.status <> 'cancelled' "
        "AND i.invoice_date BETWEEN :sd AND :d" + cond), params)).scalar())
    target = _d(s["target_amount"])
    if past + eligible < target:
        return _benefit(note=f"Target ₹{target:f}: done ₹{past:f}, ₹{target - past:f} to go", lines=m)
    paid = (await db.execute(text("SELECT COALESCE(SUM(discount_given),0) FROM scheme_usage_log "
                                  "WHERE scheme_id = :s AND customer_id = :c"), {"s": s["id"], "c": customer_id})).scalar()
    if _d(paid) > 0 or _d(s["discount_percent"]) <= 0:
        return None  # one bonus per customer per scheme
    d, lbl = cascade(eligible, _d(s["discount_percent"]), _d(s["discount_percent2"]))
    return _benefit(d, note=f"Target ₹{target:f} achieved — bonus {lbl}", lines=m)


def _cash_disc(s, lines, m, bill_total, payment_mode):
    if payment_mode not in CASH_LIKE or bill_total < _d(s["min_value"]) or _d(s["discount_percent"]) <= 0:
        return None
    d, lbl = cascade(bill_total, _d(s["discount_percent"]), _d(s["discount_percent2"]))
    return _benefit(d, note=f"Cash discount {lbl}", lines=list(range(len(lines))))


def _credit_note(s, lines, m):
    eligible = sum((lines[i]["value"] for i in m), D0)
    if not m or eligible < _d(s["min_value"]):
        return None
    amt = _two(eligible * _d(s["credit_note_percent"]) / 100)
    if amt <= 0:
        return None
    return _benefit(benefit="credit_note", note=f"Credit note {_pct(_d(s['credit_note_percent']))}% = ₹{amt:f} ({s['credit_note_timing']})",
                    credit={"amount": amt, "timing": s["credit_note_timing"]})


def _cheapest_free(s, lines, m):
    group, free_each = int(_d(s["min_qty"])), int(_d(s["free_qty"]) or 1)
    if group < 2 or free_each < 1 or free_each >= group:
        return None
    units = [(lines[i]["mrp"] or lines[i]["rate"], lines[i]["rate"], i)
             for i in m for _ in range(int(lines[i]["qty"]))]
    if len(units) < group:
        return None
    units.sort(key=lambda u: (u[0], u[1]))
    groups = len(units) // group if s["is_recursive"] else 1
    alloc: dict[int, Decimal] = {}
    for _mrp, rate, i in units[: groups * free_each]:
        alloc[i] = alloc.get(i, D0) + rate
    total = sum(alloc.values(), D0)
    names = ", ".join(lines[i]["name"] for i in list(alloc)[:4])
    return _benefit(total, benefit="discount_value", alloc=alloc,
                    note=f"Buy {group - free_each} get {free_each} free — {groups * free_each} cheapest free: {names}")


def _bulk_tier(s, lines, m):
    """Bulk discount: qty tiers (10-24 = 5%, 25+ = 8% / Rs x per unit). Tier is picked by each line's own qty,
    or by the total qty of all matching lines (qty_basis = 'total': any 25 frozen items)."""
    tiers = sorted(s["slabs"] or [], key=lambda x: _d(x.get("min_qty")))
    if not tiers or not m:
        return None
    total = sum((lines[i]["qty"] for i in m), D0)
    alloc, notes, flat = {}, [], False
    for i in m:
        ln = lines[i]
        q = total if s.get("qty_basis") == "total" else ln["qty"]
        hit = None
        for t in tiers:
            mx = _d(t.get("max_qty"))
            if q >= _d(t.get("min_qty")) and (mx <= 0 or q <= mx):
                hit = t
        if not hit:
            continue
        pct, pct2, per_unit = _d(hit.get("discount_percent")), _d(hit.get("discount_percent2")), _d(hit.get("discount_value"))
        d, lbl = cascade(ln["value"], pct, pct2) if pct > 0 else (D0, "")
        if per_unit > 0:
            d += min(_two(per_unit * ln["qty"]), ln["value"] - d)
            lbl = (lbl + " + " if lbl else "") + f"₹{per_unit:f}/unit"
            flat = True
        if d > 0:
            alloc[i] = d
            notes.append(f"{ln['name']} ({q:f} → {lbl})")
    if not alloc:
        return None
    return _benefit(sum(alloc.values(), D0), benefit="discount_value" if flat else "discount_percent",
                    alloc=alloc, note="Bulk: " + "; ".join(notes[:4]) + ("…" if len(notes) > 4 else ""))


# ── main entry ───────────────────────────────────────────────────────────────

async def evaluate(db: AsyncSession, *, items: list[dict], customer_id: int | None, outlet_id: int | None,
                   payment_mode: str = "cash", bill_date: date | None = None, at: time | None = None) -> dict:
    """items: [{product_id, qty, rate (GST-incl. per unit)}] in bill order."""
    bill_date = bill_date or date.today()
    at = at or datetime.now().time()
    result = {"applied": [], "free_items": [], "credit_notes": [], "info": [],
              "line_discount": [D0] * len(items), "line_disc_val": [D0] * len(items), "total_discount": D0}
    if not items:
        return result

    schemes = [dict(r) for r in (await db.execute(text(
        "SELECT * FROM schemes WHERE is_active AND :d BETWEEN start_date AND end_date "
        "AND (outlet_ids IS NULL OR cardinality(outlet_ids) = 0 OR :o = ANY(outlet_ids)) "
        "AND (customer_ids IS NULL OR cardinality(customer_ids) = 0 OR :c = ANY(customer_ids)) "
        "ORDER BY priority, id"), {"d": bill_date, "o": outlet_id or 0, "c": customer_id or 0})).mappings()]
    schemes = [s for s in schemes if _in_time(s, at)]
    if any(s.get("customer_types") for s in schemes):
        ctype = (await db.execute(text("SELECT type FROM customers WHERE id = :c"), {"c": customer_id or 0})).scalar() or "retail"
        schemes = [s for s in schemes if not s.get("customer_types") or ctype in s["customer_types"]]
    if not schemes:
        return result

    pids = list({int(it["product_id"]) for it in items})
    prods = {r["id"]: r for r in (await db.execute(text(
        "SELECT id, name, brand_id, category_id, carton_size, mrp, gst_percent FROM products WHERE id = ANY(:p)"),
        {"p": pids})).mappings()}
    expiry = {}
    if any(s["expiry_days_trigger"] is not None for s in schemes):
        expiry = dict((await db.execute(text(
            "SELECT b.product_id, MIN(b.exp_date) FROM product_batches b JOIN product_batch_stock bs ON bs.batch_id = b.id "
            "WHERE b.product_id = ANY(:p) AND bs.location_id = :l AND bs.current_qty > 0 AND b.exp_date >= :d GROUP BY 1"),
            {"p": pids, "l": outlet_id or 1, "d": bill_date})).all())

    lines = []
    for it in items:
        p = prods.get(int(it["product_id"])) or {}
        qty, rate = _d(it["qty"]), _d(it["rate"])
        lines.append({"product_id": int(it["product_id"]), "name": p.get("name") or f"#{it['product_id']}",
                      "qty": qty, "rate": rate, "value": _two(qty * rate), "mrp": _d(p.get("mrp")),
                      "gst": _d(it.get("gst", p.get("gst_percent"))), "brand_id": p.get("brand_id"),
                      "category_id": p.get("category_id"), "carton_size": p.get("carton_size") or 1,
                      "expiry_date": expiry.get(int(it["product_id"]))})
    bill_total = sum((ln["value"] for ln in lines), D0)
    room = [ln["value"] for ln in lines]  # how much discount each line can still take

    for s in schemes:
        m = [i for i, ln in enumerate(lines) if ln["qty"] > 0 and _matches(s, ln, bill_date)]
        t = s["scheme_type"]
        if t == "TARGET":
            b = await _target(db, s, lines, m, customer_id, bill_date)
        elif t == "CASH_DISC":
            b = _cash_disc(s, lines, m, bill_total, payment_mode)
        else:
            b = {"QTY_SLAB": _qty_slab, "VALUE_DISC": _value_disc, "FREE_ITEM": _free_item, "MIX_MATCH": _mix_match,
                 "CARTON": _carton, "CREDIT_NOTE": _credit_note, "CHEAPEST_FREE": _cheapest_free, "BULK_TIER": _bulk_tier}[t](s, lines, m)
        if not b:
            continue
        if b["discount"] <= 0 and not b["free"] and not b["credit"]:
            if b["note"]:
                result["info"].append(f"{s['name']}: {b['note']}")
            continue

        disc = _two(b["discount"])
        cap = _d(s["max_benefit_per_invoice"])
        if cap > 0 and disc > cap:
            disc, b["note"] = cap, b["note"] + f" [capped at ₹{cap:f}]"

        # attribute the discount to lines (exact units, else by value share), never past a line's value
        given = D0
        if disc > 0:
            alloc = b["alloc"] or {}
            if not alloc:
                idx = sorted(set(b["lines"])) or list(range(len(lines)))
                base = sum((lines[i]["value"] for i in idx), D0)
                if base > 0:
                    alloc = {i: disc * lines[i]["value"] / base for i in idx}
            scale = disc / sum(alloc.values(), D0) if alloc and sum(alloc.values(), D0) > 0 else D0
            for i, a in alloc.items():
                take = min(_two(a * scale), room[i])
                room[i] -= take
                result["line_discount"][i] += take
                given += take

        free = []
        for pid, q in b["free"]:
            if q > 0:
                free.append({"product_id": int(pid), "qty": q, "scheme_id": s["id"], "scheme_name": s["name"]})
        result["free_items"] += free
        if b["credit"]:
            result["credit_notes"].append({**b["credit"], "scheme_id": s["id"], "scheme_name": s["name"]})
        result["applied"].append({"scheme_id": s["id"], "scheme_name": s["name"], "scheme_type": t,
                                  "benefit_type": b["benefit"], "discount": given, "note": b["note"].strip(),
                                  "free_items": free, "credit_note": b["credit"]})
        if not s["is_combination_allowed"]:
            break  # an exclusive scheme ends the run (NCG rule)

    # free item names / tax for the POS and the invoice lines
    fids = list({f["product_id"] for f in result["free_items"]} - set(prods))
    if fids:
        prods.update({r["id"]: r for r in (await db.execute(text(
            "SELECT id, name, brand_id, category_id, carton_size, mrp, gst_percent FROM products WHERE id = ANY(:p)"),
            {"p": fids})).mappings()})
    for f in result["free_items"]:
        p = prods.get(f["product_id"]) or {}
        f.update(name=p.get("name") or f"#{f['product_id']}", gst_percent=_d(p.get("gst_percent")), mrp=_d(p.get("mrp")))

    # per-unit GST-exclusive discount the invoice line carries (disc_type ₹), same rounding everywhere
    for i, ln in enumerate(lines):
        if result["line_discount"][i] > 0 and ln["qty"] > 0:
            ex_rate = (ln["rate"] / (1 + ln["gst"] / 100)).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
            dv = _two(result["line_discount"][i] / ln["qty"] / (1 + ln["gst"] / 100))
            result["line_disc_val"][i] = min(dv, ex_rate)
    result["total_discount"] = _two(sum(result["line_discount"], D0))
    return result


async def log_applied(db: AsyncSession, *, invoice_id: int, invoice_no: str, outlet_id, customer_id, result: dict, user_id):
    for a in result["applied"]:
        rows = [{"benefit_type": a["benefit_type"], "discount_given": a["discount"], "free_product_id": None, "free_qty": 0}]
        if a["credit_note"]:
            rows[0]["benefit_type"] = "credit_note"
        rows += [{"benefit_type": "free_item", "discount_given": 0, "free_product_id": f["product_id"], "free_qty": f["qty"]}
                 for f in a["free_items"]]
        if a["discount"] <= 0 and a["free_items"]:
            rows = rows[1:]
        for r in rows:
            await db.execute(text(
                "INSERT INTO scheme_usage_log (invoice_id, invoice_no, outlet_id, customer_id, scheme_id, scheme_name, "
                "scheme_type, benefit_type, discount_given, free_product_id, free_qty, note, applied_by) VALUES "
                "(:iid, :ino, :o, :c, :sid, :sn, :st, :bt, :dg, :fp, :fq, :n, :u)"),
                {"iid": invoice_id, "ino": invoice_no, "o": outlet_id, "c": customer_id, "sid": a["scheme_id"],
                 "sn": a["scheme_name"], "st": a["scheme_type"], "bt": r["benefit_type"], "dg": r["discount_given"],
                 "fp": r["free_product_id"], "fq": r["free_qty"], "n": a["note"], "u": user_id})


if __name__ == "__main__":  # pure-logic self-check: python -m app.services.scheme_service
    assert cascade(Decimal("100"), Decimal("20"), Decimal("10"))[0] == Decimal("28.00")
    S = {"min_qty": 3, "free_qty": 1, "is_recursive": True}
    L = [{"product_id": 1, "name": "A", "qty": Decimal(2), "rate": Decimal(50), "mrp": Decimal(60), "value": Decimal(100)},
         {"product_id": 2, "name": "B", "qty": Decimal(4), "rate": Decimal(30), "mrp": Decimal(30), "value": Decimal(120)}]
    b = _cheapest_free(S, L, [0, 1])          # 6 units -> 2 groups -> 2 cheapest (B @30) free
    assert b["discount"] == Decimal(60) and b["alloc"] == {1: Decimal(60)}, b
    S2 = {"slabs": [], "min_qty": Decimal(10), "free_qty": Decimal(1), "discount_percent": 0, "discount_percent2": 0,
          "discount_value": 0, "free_item_id": None, "is_recursive": True}
    L2 = [{"product_id": 7, "name": "X", "qty": Decimal(25), "rate": Decimal(10), "value": Decimal(250)}]
    assert _qty_slab(S2, L2, [0])["free"] == [(7, Decimal(2))]
    assert _in_time({"start_time": time(22), "end_time": time(2)}, time(1)) and not _in_time({"start_time": time(22), "end_time": time(2)}, time(12))
    S3 = {"slabs": [{"min_qty": 10, "max_qty": 24, "discount_percent": 5}, {"min_qty": 25, "max_qty": 0, "discount_percent": 8}],
          "qty_basis": "line"}
    L3 = [{"product_id": 1, "name": "A", "qty": Decimal(30), "rate": Decimal(10), "value": Decimal(300)},
          {"product_id": 2, "name": "B", "qty": Decimal(12), "rate": Decimal(10), "value": Decimal(120)},
          {"product_id": 3, "name": "C", "qty": Decimal(5), "rate": Decimal(10), "value": Decimal(50)}]
    b = _bulk_tier(S3, L3, [0, 1, 2])           # A 8% = 24, B 5% = 6, C below every tier
    assert b["alloc"] == {0: Decimal("24.00"), 1: Decimal("6.00")}, b["alloc"]
    b = _bulk_tier({**S3, "qty_basis": "total"}, L3, [0, 1, 2])  # 47 total -> 8% on all three
    assert b["alloc"] == {0: Decimal("24.00"), 1: Decimal("9.60"), 2: Decimal("4.00")}, b["alloc"]
    b = _bulk_tier({"slabs": [{"min_qty": 10, "max_qty": 0, "discount_value": 2}], "qty_basis": "line"}, L3, [0])
    assert b["discount"] == Decimal("60.00") and b["benefit"] == "discount_value"
    print("scheme_service OK")
