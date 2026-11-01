from datetime import date
from decimal import Decimal
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role, current_user_dep
from app.services import accounts_service as svc

router = APIRouter(prefix="/accounts", tags=["accounts"])
staff_view = require_role("superadmin", "admin", "manager")  # managers can see, only accounts acts


async def _run(coro):
    try:
        return await coro
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class bill_in(BaseModel):
    bill_no: str = Field(..., min_length=1, max_length=50)
    bill_date: date
    bill_amount: Decimal = Field(..., gt=0)
    attachment: str
    remarks: Optional[str] = None
    accept_difference: bool = False


class alloc_in(BaseModel):
    purchase_id: int
    amount: Decimal = Field(Decimal("0"), ge=0)
    discount: Decimal = Field(Decimal("0"), ge=0)


class payment_in(BaseModel):
    supplier_id: int
    bank_account_id: int
    payment_date: date = Field(default_factory=date.today)
    mode: Literal["neft", "rtgs", "imps", "upi", "cheque"]
    reference_no: str = Field(..., min_length=3, max_length=50)
    amount: Decimal = Field(..., gt=0, le=100_000_000)
    allocations: list[alloc_in] = []
    remarks: Optional[str] = None


class decide_in(BaseModel):
    approve: bool
    remarks: Optional[str] = None


class reason_in(BaseModel):
    reason: str = Field(..., min_length=5)


class allocate_in(BaseModel):
    allocations: list[alloc_in] = Field(..., min_length=1)


@router.get("/dashboard")
async def dashboard(db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(staff_view)):
    pay = (await db.execute(text(f"""
        SELECT COALESCE(SUM(g.due_amount), 0) AS payable,
               COALESCE(SUM(g.due_amount) FILTER (WHERE CURRENT_DATE > {svc.DUE_EXPR}), 0) AS overdue,
               COALESCE(SUM(g.due_amount) FILTER (WHERE {svc.DUE_EXPR} BETWEEN CURRENT_DATE AND CURRENT_DATE + 7), 0) AS due_7d,
               COUNT(*) FILTER (WHERE g.bill_status = 'pending') AS bills_pending,
               COALESCE(SUM(g.total_amount) FILTER (WHERE g.bill_status = 'pending'), 0) AS bills_pending_amt,
               COUNT(*) FILTER (WHERE g.bill_status = 'disputed') AS bills_disputed
        FROM unit_wise_purchases g JOIN suppliers s ON s.id = g.supplier_id
        WHERE g.status <> 'cancelled' AND (g.due_amount > 0 OR g.bill_status <> 'verified')"""))).mappings().one()
    pend = (await db.execute(text("SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM supplier_payments WHERE status = 'pending'"))).one()
    rec = (await db.execute(text("""
        SELECT COALESCE(SUM(i.due_amount) FILTER (WHERE c.id <> :w), 0) AS receivable,
               COALESCE(SUM(i.due_amount) FILTER (WHERE c.id <> :w AND CURRENT_DATE - i.invoice_date > COALESCE(c.credit_days, 0)), 0) AS overdue,
               COALESCE(SUM(i.due_amount) FILTER (WHERE c.id = :w), 0) AS walkin_due,
               COUNT(*) FILTER (WHERE c.id = :w) AS walkin_bills
        FROM unit_wise_invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.status <> 'cancelled' AND i.invoice_type <> 'return' AND i.due_amount > 0"""), {"w": svc.WALK_IN_ID})).mappings().one()
    cash = (await db.execute(text("""
        SELECT COALESCE(SUM(amount) FILTER (WHERE to_type = 'safe' AND status = 'posted'), 0)
             - COALESCE(SUM(amount) FILTER (WHERE from_type = 'safe' AND (status = 'posted' OR (status = 'pending' AND kind IN ('handover','deposit')))), 0) AS in_safes,
               COALESCE(SUM(amount) FILTER (WHERE to_type = 'person' AND status = 'posted'), 0)
             - COALESCE(SUM(amount) FILTER (WHERE from_type = 'person' AND (status = 'posted' OR (status = 'pending' AND kind IN ('handover','deposit')))), 0) AS with_people,
               COALESCE(SUM(amount) FILTER (WHERE kind = 'handover' AND status = 'pending'), 0) AS in_transit,
               COALESCE(SUM(amount) FILTER (WHERE kind = 'deposit' AND status = 'pending'), 0) AS deposits_unverified
        FROM cash_entries"""))).mappings().one()
    banks = []
    for b in (await db.execute(text("SELECT id, name, account_no FROM bank_accounts WHERE is_active ORDER BY name"))).mappings():
        bb = await svc.bank_book(db, b["id"], date.today(), date.today())
        banks.append({"id": b["id"], "name": b["name"], "last4": b["account_no"][-4:], "balance": bb["closing"]})
    recent = (await db.execute(text("""
        SELECT sp.id, sp.payment_no, sp.payment_date, sp.amount, sp.status, sp.mode, s.name AS supplier_name
        FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id ORDER BY sp.id DESC LIMIT 8"""))).mappings().all()
    return {**dict(pay), "payments_pending": pend[0], "payments_pending_amt": pend[1], **{f"rec_{k}": v for k, v in rec.items()},
            **dict(cash), "banks": banks, "recent_payments": [dict(r) for r in recent],
            "top_payables": (await svc.aging(db))[:8], "is_accounts": user.role in svc.ACCOUNTS}


@router.get("/grns")
async def grns(bill_status: Optional[str] = None, supplier_id: Optional[int] = None, search: str = "",
               limit: int = Query(200, le=1000), db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(staff_view)):
    rows = (await db.execute(text(f"""
        SELECT g.id, g.purchase_no, g.supplier_id, s.name AS supplier_name, g.invoice_no, g.invoice_date, g.total_amount,
               g.paid_amount, g.due_amount, g.status, g.bill_status, g.bill_no, g.bill_date, g.bill_amount, g.bill_attachment,
               g.bill_remarks, g.bill_verified_at, vu.name AS verified_by_name, cu.name AS created_by_name, g.created_by,
               {svc.DUE_EXPR} AS due_on, COALESCE(o.outlet_name, 'Head Office') AS outlet_name
        FROM unit_wise_purchases g JOIN suppliers s ON s.id = g.supplier_id
        LEFT JOIN users vu ON vu.id = g.bill_verified_by LEFT JOIN users cu ON cu.id = g.created_by
        LEFT JOIN outlets o ON o.id = g.outlet_id
        WHERE g.status <> 'cancelled' AND (CAST(:bs AS TEXT) IS NULL OR g.bill_status = :bs)
          AND (CAST(:s AS INT) IS NULL OR g.supplier_id = :s)
          AND (:q = '' OR g.purchase_no ILIKE :ql OR g.invoice_no ILIKE :ql OR g.bill_no ILIKE :ql OR s.name ILIKE :ql)
        ORDER BY g.id DESC LIMIT :lim"""),
        {"bs": bill_status, "s": supplier_id, "q": search.strip(), "ql": f"%{search.strip()}%", "lim": limit})).mappings().all()
    return [dict(r) for r in rows]


@router.post("/grns/{purchase_id}/bill")
async def enter_bill(purchase_id: int, b: bill_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.enter_bill(db, user, purchase_id, b.bill_no, b.bill_date, b.bill_amount, b.attachment, b.remarks, b.accept_difference))


@router.get("/open-bills")
async def open_bills(supplier_id: int, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(staff_view)):
    rows = (await db.execute(text(f"""
        SELECT g.id, g.purchase_no, g.bill_no, g.bill_date, g.total_amount, g.due_amount, {svc.DUE_EXPR} AS due_on,
               g.due_amount - COALESCE((SELECT SUM(a.amount + a.discount) FROM supplier_payment_allocations a
                   JOIN supplier_payments p ON p.id = a.payment_id
                   WHERE a.purchase_id = g.id AND a.status = 'active' AND p.status = 'pending'), 0) AS open_amount
        FROM unit_wise_purchases g JOIN suppliers s ON s.id = g.supplier_id
        WHERE g.supplier_id = :s AND g.status <> 'cancelled' AND g.bill_status = 'verified' AND g.due_amount > 0
        ORDER BY due_on, g.id"""), {"s": supplier_id})).mappings().all()
    return [dict(r) for r in rows if r["open_amount"] > 0]


@router.get("/payments")
async def payments(status: Optional[str] = None, supplier_id: Optional[int] = None, limit: int = Query(200, le=1000),
                   db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(staff_view)):
    rows = (await db.execute(text("""
        SELECT sp.*, s.name AS supplier_name, b.name AS bank_name, cu.name AS created_by_name, au.name AS actioned_by_name,
               COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a WHERE a.payment_id = sp.id AND a.status = 'active'), 0) AS allocated,
               COALESCE((SELECT SUM(a.discount) FROM supplier_payment_allocations a WHERE a.payment_id = sp.id AND a.status = 'active'), 0) AS discount,
               (SELECT STRING_AGG(g.purchase_no || COALESCE(' (' || g.bill_no || ')', ''), ', ') FROM supplier_payment_allocations a
                  JOIN unit_wise_purchases g ON g.id = a.purchase_id WHERE a.payment_id = sp.id AND a.status = 'active') AS bills
        FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id JOIN bank_accounts b ON b.id = sp.bank_account_id
        LEFT JOIN users cu ON cu.id = sp.created_by LEFT JOIN users au ON au.id = sp.actioned_by
        WHERE (CAST(:st AS TEXT) IS NULL OR sp.status = :st) AND (CAST(:s AS INT) IS NULL OR sp.supplier_id = :s)
        ORDER BY sp.id DESC LIMIT :lim"""), {"st": status, "s": supplier_id, "lim": limit})).mappings().all()
    return [dict(r) for r in rows]


@router.post("/payments")
async def create_payment(b: payment_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.create_payment(db, user, b.supplier_id, b.bank_account_id, b.payment_date, b.mode, b.reference_no,
                                         b.amount, [a.model_dump() for a in b.allocations], b.remarks))


@router.post("/payments/{pid}/decision")
async def decide(pid: int, b: decide_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.decide_payment(db, user, pid, b.approve, b.remarks))


@router.post("/payments/{pid}/void")
async def void(pid: int, b: reason_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.void_payment(db, user, pid, b.reason.strip()))


@router.post("/payments/{pid}/allocate")
async def allocate(pid: int, b: allocate_in, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(get_current_user)):
    return await _run(svc.allocate_advance(db, user, pid, [a.model_dump() for a in b.allocations]))


@router.get("/aging")
async def aging(supplier_id: Optional[int] = None, db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(staff_view)):
    return await svc.aging(db, supplier_id)


@router.get("/ledger")
async def ledger(supplier_id: int, from_date: date, to_date: date, db: AsyncSession = Depends(get_db),
                 user: current_user_dep = Depends(staff_view)):
    return await svc.ledger(db, supplier_id, from_date, to_date)


@router.get("/bank-book")
async def bank_book(bank_account_id: int, from_date: date, to_date: date, db: AsyncSession = Depends(get_db),
                    user: current_user_dep = Depends(staff_view)):
    return await _run(svc.bank_book(db, bank_account_id, from_date, to_date))


@router.get("/receivables")
async def receivables(db: AsyncSession = Depends(get_db), user: current_user_dep = Depends(staff_view)):
    return await svc.receivables(db)
