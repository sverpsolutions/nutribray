"""Day-end closing on top of business_days / cashier_shifts (shift_service):
closing checklist, review (Submitted -> Approved / Rejected), reopen through the approval engine, HO closing board.

Status shown to users:
  Open                 day open, no shift counted yet
  Closing In Progress  day open, at least one cashier shift counted / closed
  Submitted            day closed, waiting for review (outlet has 'closing review' on)
  Approved             day closed and accepted (or no review needed)
  Rejected             review rejected — HO asks for a reopen / correction
  Reopened             day open again after a close (reopen_count > 0)
"""
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text

from app.core import access
from app.services.approval_service import handler
from app.services.auth_service import write_audit


def label(day: Optional[dict]) -> str:
    if not day:
        return "Not opened"
    if day["status"] == "open":
        if day.get("reopen_count"):
            return "Reopened"
        return "Closing In Progress" if day.get("closed_shifts") else "Open"
    return {"SUBMITTED": "Submitted", "REJECTED": "Rejected"}.get(day.get("review_status") or "", "Approved")


async def checklist(db, day: dict) -> list[dict]:
    """What is still pending at this store for this business day. `blocking` items stop the close."""
    o, d = day["outlet_id"], day["business_date"]
    q = lambda sql, p=None: db.execute(text(sql), {"o": o, "d": d, **(p or {})})  # noqa: E731
    rows = [
        ("open_shifts", "Cashier shifts still open", True,
         "SELECT COUNT(*) FROM cashier_shifts WHERE business_day_id = :day AND status = 'open'", {"day": day["id"]}),
        ("draft_bills", "Bills saved as draft (not completed)", True,
         "SELECT COUNT(*) FROM unit_wise_invoices WHERE outlet_id = :o AND invoice_date = :d AND status = 'draft'", None),
        ("pending_expenses", "Expenses waiting for approval", True,
         "SELECT COUNT(*) FROM cash_entries WHERE kind = 'expense' AND status = 'pending' AND outlet_id = :o", None),
        ("draft_grn", "GRNs saved as draft", False, "SELECT COUNT(*) FROM unit_wise_purchases WHERE outlet_id = :o AND status = 'draft'", None),
        ("po_pending", "Purchase orders awaiting approval", False,
         "SELECT COUNT(*) FROM po_headers WHERE outlet_id = :o AND COALESCE(approval_status, '') IN ('pending', 'pending_approval')", None),
        ("transfers_in", "Stock transfers sent to this store, not received", False,
         """SELECT (SELECT COUNT(*) FROM unit_wise_stock_transfers WHERE to_outlet_id = :o AND status IN ('pending', 'dispatched', 'in_transit'))
                 + (SELECT COUNT(*) FROM logistic_transfers WHERE destination_location_id = :o AND status IN ('DISPATCHED', 'IN_TRANSIT'))""", None),
        ("approvals", "Approval requests pending for this store", False,
         "SELECT COUNT(*) FROM approval_requests WHERE outlet_id = :o AND status = 'PENDING'", None),
        ("expired_stock", "Expired batches still in stock", False,
         """SELECT COUNT(*) FROM product_batch_stock s JOIN product_batches b ON b.id = s.batch_id
            WHERE s.location_id = :o AND s.current_qty > 0 AND b.exp_date <= :d""", None),
        ("negative_stock", "Items with negative stock", False, "SELECT COUNT(*) FROM outlet_stock WHERE outlet_id = :o AND stock_qty < 0", None),
    ]
    out = []
    for key, lab, blocking, sql, extra in rows:
        try:
            async with db.begin_nested():
                n = (await q(sql, extra)).scalar() or 0
        except Exception:          # a table this installation does not use
            n = 0
        out.append({"key": key, "label": lab, "count": int(n), "blocking": blocking and n > 0})
    return out


async def after_close(db, day_id: int, checks: list[dict]):
    """Called by shift_service.day_close: review status + checklist snapshot."""
    review = (await db.execute(text("""SELECT o.closing_review FROM business_days d LEFT JOIN outlets o ON o.id = d.outlet_id
        WHERE d.id = :i"""), {"i": day_id})).scalar()
    import json
    await db.execute(text("UPDATE business_days SET review_status = :r, checklist = CAST(:c AS JSONB), reviewed_by = NULL, reviewed_at = NULL "
                          "WHERE id = :i"), {"r": "SUBMITTED" if review else "APPROVED", "c": json.dumps(checks), "i": day_id})


async def review(db, day_id: int, action: str, note: Optional[str], user) -> dict:
    day = (await db.execute(text("SELECT * FROM business_days WHERE id = :i FOR UPDATE"), {"i": day_id})).mappings().first()
    if not day:
        raise HTTPException(404, "Business day not found")
    access.check_outlet(day["outlet_id"])
    if day["status"] != "closed" or day["review_status"] != "SUBMITTED":
        raise HTTPException(400, "Only a submitted (closed, not yet reviewed) day can be approved or rejected.")
    if day["closed_by"] == user.user_id and user.role not in ("admin", "superadmin"):
        raise HTTPException(403, "The person who closed the day cannot review it.")
    if action == "reject" and not (note and note.strip()):
        raise HTTPException(400, "Give a reason for rejecting the closing.")
    st = "APPROVED" if action == "approve" else "REJECTED"
    await db.execute(text("UPDATE business_days SET review_status = :s, reviewed_by = :u, reviewed_at = NOW(), review_note = :n WHERE id = :i"),
                     {"s": st, "u": user.user_id, "n": note, "i": day_id})
    await write_audit(db=db, module="day_shift", action=f"day_close_{action}", record_id=day_id, record_no=str(day["business_date"]),
                      description=f"Day closing {day['business_date']} {st.lower()}" + (f": {note}" if note else ""), user_id=user.user_id,
                      user_name=user.username, meta_data={"outlet_id": day["outlet_id"]})
    await db.commit()
    return {"review_status": st}


async def reopen_target(db, outlet_id: int) -> dict:
    if (await db.execute(text("SELECT 1 FROM business_days WHERE outlet_id = :o AND status = 'open'"), {"o": outlet_id})).first():
        raise HTTPException(400, "A business day is already open at this store.")
    day = (await db.execute(text("""SELECT * FROM business_days WHERE outlet_id = :o ORDER BY business_date DESC LIMIT 1"""),
                            {"o": outlet_id})).mappings().first()
    if not day or day["status"] != "closed":
        raise HTTPException(400, "No closed business day to reopen at this store.")
    return dict(day)


@handler("DAY_REOPEN")
class DayReopen:
    @staticmethod
    async def check(db, p: dict):
        day = await reopen_target(db, int(p["outlet_id"]))
        if day["id"] != int(p["day_id"]):
            raise HTTPException(400, "A later business day exists; only the latest closed day can be reopened.")
        if (await db.execute(text("""SELECT 1 FROM approval_requests WHERE request_type = 'DAY_REOPEN' AND status = 'PENDING'
                AND payload->>'day_id' = :d AND id <> COALESCE(:x, 0)"""), {"d": str(p["day_id"]), "x": p.get("_rid")})).first():
            raise HTTPException(400, "A reopen request for this day is already waiting for approval.")

    @staticmethod
    async def post(db, req: dict, approver) -> str:
        d = int(req["payload"]["day_id"])
        await db.execute(text("""UPDATE business_days SET status = 'open', closed_by = NULL, closed_at = NULL, review_status = NULL,
            reopen_count = reopen_count + 1, last_reopen_reason = :r WHERE id = :i AND status = 'closed'"""), {"r": req["reason"], "i": d})
        return f"DAY-{d}"


async def board(db, business_date) -> list[dict]:
    """Head Office closing board: every store in the caller's scope for one business date."""
    p: dict = {"d": business_date}
    rows = [dict(r) for r in (await db.execute(text(f"""
        SELECT o.id AS outlet_id, o.outlet_name AS store, o.closing_time, o.closing_review, d.id AS day_id, d.business_date, d.status,
               d.review_status, d.reopen_count, d.closed_at, cu.name AS closed_by, ru.name AS reviewed_by, d.review_note,
               d.net_sales, d.total_collected, d.total_cash, d.mode_totals, d.safe_variance,
               (SELECT string_agg(DISTINCT u.name, ', ') FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id WHERE s.business_day_id = d.id) AS cashiers,
               (SELECT COALESCE(SUM(s.expected_cash), 0) FROM cashier_shifts s WHERE s.business_day_id = d.id AND s.status = 'closed') AS expected_cash,
               (SELECT COALESCE(SUM(s.actual_cash), 0) FROM cashier_shifts s WHERE s.business_day_id = d.id AND s.status = 'closed') AS actual_cash,
               (SELECT COUNT(*) FROM cashier_shifts s WHERE s.business_day_id = d.id AND s.status = 'closed') AS closed_shifts,
               (SELECT COUNT(*) FROM cashier_shifts s WHERE s.business_day_id = d.id AND s.status = 'open') AS open_shifts
        FROM outlets o LEFT JOIN business_days d ON d.outlet_id = o.id AND d.business_date = :d
        LEFT JOIN users cu ON cu.id = d.closed_by LEFT JOIN users ru ON ru.id = d.reviewed_by
        WHERE COALESCE(o.is_active, TRUE) {access.outlet_filter('o.id', p)} ORDER BY o.outlet_name"""), p)).mappings()]
    now = datetime.utcnow() + timedelta(hours=5, minutes=30)
    for r in rows:
        r["status_label"] = label(r if r["day_id"] else None)
        r["difference"] = float(Decimal(r["actual_cash"] or 0) - Decimal(r["expected_cash"] or 0))
        due = r["closing_time"] and now.date() >= business_date and (now.date() > business_date or now.time() >= r["closing_time"])
        r["overdue"] = bool(r["status_label"] in ("Open", "Closing In Progress", "Reopened", "Not opened") and due)
        r["not_closed"] = r["status_label"] in ("Open", "Closing In Progress", "Reopened", "Not opened")
        for k in ("net_sales", "total_collected", "total_cash", "expected_cash", "actual_cash", "safe_variance"):
            r[k] = float(r[k] or 0)
        r["closing_time"] = r["closing_time"].strftime("%H:%M") if r["closing_time"] else None
    return rows
