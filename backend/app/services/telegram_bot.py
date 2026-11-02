"""Telegram Business Assistant — read-only live reports for linked software users.

How it stays safe:
* Every report is the EXISTING report endpoint, called in-process as the linked user (short-lived JWT that never
  leaves the process). So the user's outlets, categories, role and module permissions (core/access.py) and the
  approved calculations apply exactly as on screen; an outlet the user cannot see returns nothing or "access denied".
* No SQL from messages: text is matched to a fixed list of reports; arguments (dates, outlet, item, limit) are parsed
  and bounded. Only GET endpoints are called. Nothing is written except bot logs / account bookkeeping.
* Accounts are linked only with a one-time code an administrator generates (15 min, single use, stored hashed);
  private chats only — group membership never grants access. Financial reports need an explicit per-account switch.
* Bot token only in the server .env (TELEGRAM_BOT_TOKEN); scrubbed from every error. Webhook calls must carry the
  secret header derived from SECRET_KEY + token.
"""
import asyncio
import hashlib
import hmac
import html
import logging
import math
import os
import re
import secrets
import time as _time
from collections import defaultdict, deque
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy import text

from app.core.database import async_session_factory
from app.services.store_shifts import now_ist

log = logging.getLogger("telegram")
e = html.escape
CODE_TTL_MIN = 15
MAX_DAYS = 92
RATE = (20, 60)          # messages per seconds, per chat


# ── Telegram API ─────────────────────────────────────────────────────────────
class TgError(Exception):
    pass


def token() -> str:
    return os.getenv("TELEGRAM_BOT_TOKEN", "").strip()


def scrub(s) -> str:
    t = token()
    s = str(s)
    return s.replace(t, "***") if t else s


def webhook_secret() -> str:
    from app.core.config import get_settings
    return hmac.new(get_settings().secret_key.encode(), b"telegram-webhook:" + token().encode(), hashlib.sha256).hexdigest()[:48]


async def api(method: str, **payload):
    tok = token()
    if not tok:
        raise TgError("TELEGRAM_BOT_TOKEN is not set on the server")
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f"https://api.telegram.org/bot{tok}/{method}", json=payload)
        j = r.json()
    except Exception as ex:   # network / JSON — the URL holds the token, so scrub
        raise TgError(f"Telegram not reachable: {scrub(type(ex).__name__)}") from None
    if not j.get("ok"):
        raise TgError(scrub(j.get("description") or f"HTTP {r.status_code}"))
    return j["result"]


def _chunks(s: str, n: int = 3800) -> list[str]:
    out, cur = [], ""
    for line in s.split("\n"):
        if len(cur) + len(line) + 1 > n and cur:
            out.append(cur)
            cur = ""
        cur += line + "\n"
    return out + [cur] if cur.strip() else out


async def send(chat_id: int, body: str, buttons: Optional[list] = None):
    """Long reports go out as several messages (never cut silently); buttons on the last one."""
    parts = _chunks(body) or ["(empty)"]
    for i, p in enumerate(parts):
        kw = {"chat_id": chat_id, "text": p, "parse_mode": "HTML", "disable_web_page_preview": True}
        if buttons and i == len(parts) - 1:
            kw["reply_markup"] = {"inline_keyboard": [[{"text": t, "callback_data": d} for t, d in row] for row in buttons]}
        await api("sendMessage", **kw)


# ── formatting ───────────────────────────────────────────────────────────────
def inr(v) -> str:
    v = float(v or 0)
    i, d = f"{abs(v):.2f}".split(".")
    if len(i) > 3:
        i = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", i[:-3]) + "," + i[-3:]
    return ("-" if v < 0 else "") + "₹" + i + "." + d


def num(v) -> str:
    return (f"{float(v or 0):.3f}").rstrip("0").rstrip(".")


def dmy(d) -> str:
    return (d if isinstance(d, date) else date.fromisoformat(str(d)[:10])).strftime("%d-%b-%Y")


def updated() -> str:
    return f"\n<i>Last updated: {now_ist():%d-%b-%Y %H:%M} IST</i>"


def head(title: str, a: dict, period=True) -> str:
    s = f"<b>{e(title)}</b>\n"
    if period:
        s += f"Date: {dmy(a['fd'])}\n" if a["fd"] == a["td"] else f"Period: {dmy(a['fd'])} to {dmy(a['td'])}\n"
    s += f"Outlet: {e(a['outlet_name'])}\n" if a.get("outlet_id") else "Outlets: all your outlets\n"
    return s + "\n"


MAIN_KB = [[("Sales by Outlet", "r|sales_outlet"), ("Top Selling Items", "r|top_items")],
           [("Hourly Sales", "r|hourly_sales"), ("Stock Summary", "r|stock")], [("Main Menu", "m")]]


def paged(top: str, lines: list[str], report: str, page: int, per: int = 15, foot: str = "") -> tuple[str, list]:
    pages = max(1, math.ceil(len(lines) / per))
    page = min(max(1, page), pages)
    body = lines[(page - 1) * per: page * per]
    s = top + ("\n".join(body) if body else "<i>Nothing to show.</i>")
    if pages > 1:
        s += f"\n\nShowing {(page - 1) * per + 1}–{(page - 1) * per + len(body)} of {len(lines)} (page {page}/{pages})"
    nav = ([("◀ Prev", f"pg|{report}|{page - 1}")] if page > 1 else []) + ([("Next ▶", f"pg|{report}|{page + 1}")] if page < pages else [])
    return s + foot + updated(), ([nav] if nav else []) + [[("Main Menu", "m")]]


# ── calling the existing reports as the user ─────────────────────────────────
class Denied(Exception):
    pass


class Ask(Exception):
    """Ambiguous / invalid request: reply with this short question (optionally with choice buttons)."""
    def __init__(self, msg, buttons=None):
        super().__init__(msg)
        self.buttons = buttons


async def get(u: dict, path: str, params: Optional[dict] = None):
    from app.core.security import create_access_token
    from app.main import app
    q = {k: v for k, v in (params or {}).items() if v is not None}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://bot/api/v1", timeout=90,
                                 headers={"Authorization": f"Bearer {create_access_token(u['user_id'], u['role'])}"}) as c:
        r = await c.get(path, params=q)
    if r.status_code in (401, 403):
        try:
            d = r.json().get("detail")
        except Exception:
            d = None
        raise Denied(d if isinstance(d, str) else "You do not have access to this report.")
    if r.status_code >= 400:
        raise RuntimeError(f"report {path} failed ({r.status_code})")
    return r.json()


async def opt(coro):
    """A side figure the user may not have access to: None instead of failing the whole report."""
    try:
        return await coro
    except (Denied, RuntimeError):
        return None


def P(a: dict) -> dict:
    return {"from_date": a["fd"].isoformat(), "to_date": a["td"].isoformat(), "outlet_id": a.get("outlet_id")}


def SP(a: dict) -> dict:
    return {"outlet_ids": [a["outlet_id"]]} if a.get("outlet_id") else {}


# ── reports (each reuses an existing endpoint) ───────────────────────────────
async def r_sales(u, a):
    s = (await get(u, "/reports/sales", P(a)))["summary"]
    cat = await opt(get(u, "/reports/category-sales", P(a)))
    pay = await opt(get(u, "/reports/payments", P(a)))
    rt = await opt(get(u, "/billing/returns", {"from_date": a["fd"].isoformat(), "to_date": a["td"].isoformat(), "outlet_id": a.get("outlet_id"), "per_page": 200}))
    bills, net = s["total_invoices"], s["net_sales"]
    t = head(a["title"], a)
    t += (f"Total Sales (net, incl. GST): <b>{inr(net)}</b>\n"
          f"Total Bills: {bills}\n")
    if cat:
        t += f"Quantity Sold: {num(sum(float(r['qty'] or 0) for r in cat['rows']))}\n"
    t += (f"Average Bill Value: {inr(net / bills if bills else 0)}\n\n"
          f"Gross (before discount): {inr(s['gross_sales'])}\n"
          f"Discount: {inr(s['total_discount'])}\n"
          f"Taxable Value: {inr(s['taxable'])} · GST: {inr(s['total_gst'])}\n"
          f"Paid on these bills: {inr(s['collected'])} · Credit due: {inr(s['outstanding'])}\n")
    if rt is not None:
        live = [r for r in rt["items"] if r.get("status") != "cancelled"]
        more = " (first 200 shown)" if rt["total"] > len(rt["items"]) else ""
        t += f"Returns (credit notes): {inr(sum(float(r['total_amount'] or 0) for r in live))} · {len(live)}{more}\n"
    if pay and pay.get("by_mode"):
        t += "\n<b>Collections by payment mode</b>\n" + "\n".join(f"  {e(str(m['paymode']))}: {inr(m['amount'])}" for m in pay["by_mode"]) + "\n"
    t += "\n<i>Cancelled bills excluded; returns shown separately, not deducted.</i>"
    if a.get("running"):
        t += f"\n<i>Committed bills up to {now_ist():%H:%M} IST; store POS bills count once synced.</i>"
    return t + updated(), MAIN_KB


async def r_sales_outlet(u, a):
    outlets = [{"id": a["outlet_id"], "name": a["outlet_name"]}] if a.get("outlet_id") else await my_outlets(u)
    rows = []
    for o in outlets:   # the scoped sales report per outlet (works for outlet-limited users too)
        s = (await get(u, "/reports/sales", {**P(a), "outlet_id": o["id"]}))["summary"]
        if s["total_invoices"]:
            rows.append({"outlet": o["name"], "sales": s["net_sales"], "bills": s["total_invoices"]})
    rows.sort(key=lambda r: -float(r["sales"] or 0))
    total = sum(float(r["sales"] or 0) for r in rows)
    lines = [f"{i}. {e(str(r['outlet']))}: <b>{inr(r['sales'])}</b> · {r['bills']} bills" for i, r in enumerate(rows, 1)]
    return paged(head("SALES BY OUTLET", {**a, "outlet_id": None}) + f"Total: <b>{inr(total)}</b>\n\n", lines, "sales_outlet", a.get("page", 1))


async def r_top_items(u, a):
    n = a.get("limit") or 10
    rows = (await get(u, "/reports/top-items", {**P(a), "top_n": n}))["rows"]
    lines = [f"{i}. {e(r['item_name'] or '')} ({e(str(r['item_code']))}) — {num(r['qty_sold'])} qty · {inr(r['total_sales'])}" for i, r in enumerate(rows, 1)]
    return paged(head(f"TOP {n} SELLING ITEMS", a), lines, "top_items", a.get("page", 1))


async def r_hourly(u, a):
    hrs = (await get(u, "/reports/hourly", P(a)))["hours"]
    lines = [f"{h['label']}  {inr(h['sales'])} · {h['bills']} bills" for h in hrs if h["sales"] or h["bills"]]
    peak = max(hrs, key=lambda h: h["sales"], default=None)
    foot = f"\n\nPeak hour: {peak['label']} ({inr(peak['sales'])})" if peak and peak["sales"] else ""
    return paged(head("HOURLY SALES", a), lines, "hourly_sales", a.get("page", 1), per=24, foot=foot)


async def r_sales_category(u, a):
    rows = sorted((await get(u, "/reports/category-sales", P(a)))["rows"], key=lambda r: -float(r["sales"] or 0))
    lines = [f"{e(str(r['category']))}: <b>{inr(r['sales'])}</b> · {num(r['qty'])} qty · {r['bills']} bills" for r in rows]
    return paged(head("SALES BY CATEGORY", a), lines, "sales_category", a.get("page", 1))


async def r_compare(u, a):
    d = a["td"]
    async def net(fd, td):
        s = (await get(u, "/reports/sales", {**P(a), "from_date": fd.isoformat(), "to_date": td.isoformat()}))["summary"]
        return float(s["net_sales"]), s["total_invoices"]
    ms = d.replace(day=1)
    pm_end = ms - timedelta(days=1)
    pm_same = pm_end.replace(day=min(d.day, pm_end.day))
    rows = [("Today" if d == now_ist().date() else dmy(d), *await net(d, d)), ("Previous day", *await net(d - timedelta(1), d - timedelta(1))),
            ("Same day last week", *await net(d - timedelta(7), d - timedelta(7))),
            ("Month to date", *await net(ms, d)), ("Last month, same days", *await net(pm_end.replace(day=1), pm_same))]

    def ch(x, y):
        return "—" if not y else f"{(x - y) / y * 100:+.1f}%"
    t = head("SALES COMPARISON", {**a, "fd": d, "td": d}, period=False)
    t += "\n".join(f"{n}: <b>{inr(v)}</b> · {b} bills" for n, v, b in rows)
    t += f"\n\n{rows[0][0]} vs previous day: {ch(rows[0][1], rows[1][1])}\nvs same day last week: {ch(rows[0][1], rows[2][1])}\nMonth to date vs last month (same days): {ch(rows[3][1], rows[4][1])}"
    return t + "\n<i>Net sales incl. GST, cancelled bills excluded.</i>" + updated(), MAIN_KB


async def r_sales_return(u, a):
    rt = await get(u, "/billing/returns", {"from_date": a["fd"].isoformat(), "to_date": a["td"].isoformat(), "outlet_id": a.get("outlet_id"), "per_page": 200})
    live = [r for r in rt["items"] if r.get("status") != "cancelled"]
    lines = [f"{dmy(r['invoice_date'])} {e(str(r['invoice_no']))}: {inr(r['total_amount'])}" + (f" — {e(str(r['return_reason']))}" if r.get("return_reason") else "") for r in live]
    top = head("SALES RETURNS", a) + f"Returns: <b>{inr(sum(float(r['total_amount'] or 0) for r in live))}</b> · {len(live)} credit notes\n\n"
    return paged(top, lines, "sales_return", a.get("page", 1), foot="\n(first 200 credit notes)" if rt["total"] > len(rt["items"]) else "")


async def r_stock(u, a):
    d = (await get(u, "/stock-reports/summary", SP(a)))["dashboard"]
    t = head("STOCK SUMMARY", a, period=False)
    t += (f"Active items: {d['active_skus']}\nTotal quantity: {num(d['total_qty'])}\n"
          f"Stock value (cost): <b>{inr(d['total_value'])}</b>\nMRP value: {inr(d['total_mrp_value'])}\n\n"
          f"Low stock: {d['low_stock_items']} · Zero: {d['zero_items']} · Negative: {d['negative_items']}\n"
          "<i>From the outlet stock ledger (sales, returns, GRNs, transfers, adjustments posted).</i>")
    return t + updated(), [[("Low Stock", "r|low_stock"), ("Stock by Outlet", "r|stock_outlet")], [("Main Menu", "m")]]


async def r_stock_item(u, a):
    q = (a.get("item") or "").strip()
    if not q:
        raise Ask("Which item? Send e.g. <code>/stock_item 10025</code> or <code>/stock_item basmati rice</code>.")
    rows = (await get(u, "/stock-reports/summary", {**SP(a), "search": q, "active_only": False}))["rows"]
    items = {}
    for r in rows:
        items.setdefault(str(r["item_code"]), []).append(r)
    exact = items.get(q) or next((v for k, v in items.items() if v[0]["barcode"] == q), None)
    if not exact and len(items) > 1:
        names = list(items.items())[:8]
        raise Ask(f"{len(items)} items match “{e(q)}”. Which one?",
                  [[(f"{v[0]['item_name'][:40]} ({k})", f"si|{k[:50]}")] for k, v in names])
    rs = exact or (next(iter(items.values())) if items else None)
    if not rs:
        return f"Item “{e(q)}” not found in your outlets / categories.", [[("Main Menu", "m")]]
    r0 = rs[0]
    lines = [f"{e(str(r['outlet']))}: <b>{num(r['current_stock'])}</b> {e(r['uom'] or '')}" for r in rs if r["outlet"] != "N/A"]
    top = (f"<b>ITEM STOCK</b>\n{e(r0['item_name'])} ({e(str(r0['item_code']))})\nMRP {inr(r0['mrp'])} · Selling {inr(r0['selling_price'])}\n"
           f"Total: <b>{num(sum(float(r['current_stock'] or 0) for r in rs))}</b> {e(r0['uom'] or '')}\n\n")
    return paged(top, lines, "stock_item", a.get("page", 1))


def _stock_flag(flag, title, report):
    async def f(u, a):
        j = await get(u, "/stock-reports/summary", {**SP(a), flag: True})
        lines = [f"{e(r['item_name'] or '')} ({e(str(r['item_code']))}) · {e(str(r['outlet']))}: <b>{num(r['current_stock'])}</b>" for r in j["rows"]]
        return paged(head(title, a, period=False) + f"Items: {len(lines)}\n\n", lines, report, a.get("page", 1),
                     foot="\n(first 2000 rows)" if len(lines) >= 2000 else "")
    return f


async def r_stock_value(u, a):
    j = await get(u, "/stock-reports/summary", {**SP(a), "group_by": "outlet"})
    d = j["dashboard"]
    rows = sorted(j["rows"], key=lambda r: -float(r["stock_value"] or 0))
    top = head("INVENTORY VALUATION", a, period=False) + (
        f"At cost (incl. tax): <b>{inr(d['total_value'])}</b>\nBasic cost: {inr(d['total_basic_value'])} · Tax: {inr(d['total_tax_value'])}\n"
        f"At selling price: {inr(d['total_selling_value'])}\nAt MRP: {inr(d['total_mrp_value'])}\n\n<b>By outlet (cost)</b>\n")
    return paged(top, [f"{e(str(r['outlet']))}: {inr(r['stock_value'])}" for r in rows], "stock_value", a.get("page", 1),
                 foot="\n<i>Valued at the item master cost price.</i>")


def _stock_group(group, title, report):
    async def f(u, a):
        rows = sorted((await get(u, "/stock-reports/summary", {**SP(a), "group_by": group}))["rows"], key=lambda r: -float(r["stock_value"] or 0))
        return paged(head(title, a, period=False), [f"{e(str(r['outlet']))}: {num(r['current_stock'])} qty · {inr(r['stock_value'])}" for r in rows],
                     report, a.get("page", 1))
    return f


def _velocity(v, title, report, note):
    async def f(u, a):
        j = await get(u, "/reports/item-velocity", {"velocity": v, "outlet_id": a.get("outlet_id")})
        rows = j["rows"]
        lines = [f"{e(r['item_name'] or '')} ({e(str(r['item_code']))}) · stock {num(r['stock_qty'])} · sold {num(r['qty_sold_90d'])}"
                 + (f" · last sale {r['days_since_sold']}d ago" if r.get("days_since_sold") not in (None, 9999) else " · never sold") for r in rows]
        return paged(head(title, a, period=False) + f"<i>{note}</i>\nItems: {len(rows)}\n\n", lines, report, a.get("page", 1))
    return f


async def r_expiry(u, a):
    rows = await get(u, "/expiry/summary", {"outlet_id": a.get("outlet_id")})
    lines = [f"{e(r['status'])} · {e(r['store'])}: {r['batches']} batches · {num(r['qty'])} qty · {inr(r['value'])}" for r in rows]
    return paged(head("NEAR-EXPIRY STOCK", a, period=False), lines, "near_expiry", a.get("page", 1))


async def r_purchase(u, a):
    j = await get(u, "/reports/purchase", P(a))
    rows = j["rows"]
    live = [r for r in rows if (r.get("status") or "").lower() not in ("draft", "cancelled")]
    skipped = len(rows) - len(live)
    lines = [f"{dmy(r['invoice_date'])} {e(str(r['supplier_name'] or ''))}: <b>{inr(r['total_amount'])}</b> · {e(str(r['purchase_no'] or r['invoice_no'] or ''))} ({e(str(r['status']))})" for r in live]
    top = head(a["title"], a) + f"Purchase value: <b>{inr(sum(float(r['total_amount'] or 0) for r in live))}</b> · {len(live)} invoices\n"
    top += (f"<i>{skipped} draft / cancelled not counted.</i>\n" if skipped else "") + "\n"
    return paged(top, lines, a["report"], a.get("page", 1))


async def r_supplier_out(u, a):
    rows = sorted(await get(u, "/accounts/aging"), key=lambda r: -float(r["total"] or 0))
    tot = sum(float(r["total"] or 0) for r in rows)
    lines = [f"{e(r['supplier_name'])}: <b>{inr(r['total'])}</b>" + (f" · 90+ days {inr(r['d90p'])}" if r["d90p"] else "") for r in rows]
    return paged(head("SUPPLIER OUTSTANDING", {**a, "outlet_id": None}, period=False) + f"Total payable: <b>{inr(tot)}</b>\n\n", lines,
                 "supplier_outstanding", a.get("page", 1), foot="\n<i>From the accounts payable ledger (bills less payments / advances).</i>")


async def r_customer_out(u, a):
    s = (await get(u, "/reports/outstanding", {"outlet_id": a.get("outlet_id")}))["summary"]
    rec = await opt(get(u, "/accounts/receivables")) or []
    lines = [f"{e(r['customer_name'] or '')}: <b>{inr(r['total'])}</b> · {r['bills']} bills" + (f" · 90+ days {inr(r['d90p'])}" if r["d90p"] else "")
             for r in sorted(rec, key=lambda r: -float(r["total"] or 0))]
    top = head("CUSTOMER OUTSTANDING", a, period=False) + f"Unpaid bills: {s['total_invoices']} · Due: <b>{inr(s['total_due'])}</b>\n\n<b>By customer</b>\n"
    return paged(top, lines, "customer_outstanding", a.get("page", 1))


async def r_cash(u, a):
    d = await get(u, "/accounts/dashboard")
    t = head("CASH POSITION", {**a, "outlet_id": None}, period=False) + (
        f"In store safes: <b>{inr(d['in_safes'])}</b>\nWith people (handover): {inr(d['with_people'])}\n"
        f"In transit: {inr(d['in_transit'])}\nDeposits not yet verified: {inr(d['deposits_unverified'])}\n"
        "<i>From the cash book; cashier drawers of open shifts are counted at shift close.</i>")
    return t + updated(), [[("Bank Balance", "r|bank_balance"), ("Main Menu", "m")]]


async def r_bank(u, a):
    d = await get(u, "/accounts/dashboard")
    banks = d.get("banks") or []
    if not banks:
        return "<b>BANK BALANCE</b>\n\nNo bank accounts are set up in Cash &amp; Bank." + updated(), [[("Main Menu", "m")]]
    t = "<b>BANK BALANCE</b>\n\n" + "\n".join(f"{e(b['name'])} (…{e(str(b['last4']))}): <b>{inr(b['balance'])}</b>" for b in banks)
    return t + f"\n\nTotal: <b>{inr(sum(float(b['balance'] or 0) for b in banks))}</b>\n<i>Bank book closing balance (entries recorded in the software).</i>" + updated(), [[("Main Menu", "m")]]


async def r_expense(u, a):
    rows = await get(u, "/cash/entries", {"kind": "expense", "from_date": a["fd"].isoformat(), "to_date": a["td"].isoformat(), "outlet_id": a.get("outlet_id"), "limit": 2000})
    by = defaultdict(float)
    for r in rows:
        by[r["status"]] += float(r["amount"] or 0)
    lines = [f"{e(str(r.get('outlet_name') or ''))} · {e(str(r.get('category_name') or ''))}: {inr(r['amount'])} ({e(r['status'])})" for r in rows]
    top = head("EXPENSES", a) + "\n".join(f"{e(k.title())}: <b>{inr(v)}</b>" for k, v in by.items()) + "\n\n"
    return paged(top, lines, "today_expense", a.get("page", 1))


async def r_payment_due(u, a):
    d = await get(u, "/accounts/dashboard")
    t = head("SUPPLIER PAYMENTS DUE", {**a, "outlet_id": None}, period=False) + (
        f"Total payable: <b>{inr(d['payable'])}</b>\nOverdue: <b>{inr(d['overdue'])}</b>\nDue in next 7 days: {inr(d['due_7d'])}\n"
        f"Bills awaiting entry: {d['bills_pending']} ({inr(d['bills_pending_amt'])})\nPayments awaiting approval: {d['payments_pending']} ({inr(d['payments_pending_amt'])})\n")
    if d.get("top_payables"):
        t += "\n<b>Largest payables</b>\n" + "\n".join(f"{e(r['supplier_name'])}: {inr(r['total'])}" for r in d["top_payables"][:10])
    return t + updated(), [[("Supplier Outstanding", "r|supplier_outstanding"), ("Main Menu", "m")]]


async def r_gst(u, a):
    j = await get(u, "/reports/gst", P(a))
    s = j["summary"]
    t = head("GST SUMMARY (OUTPUT, SALES)", a) + (
        f"Taxable: <b>{inr(s['taxable_amount'])}</b>\nCGST: {inr(s['cgst'])} · SGST: {inr(s['sgst'])} · IGST: {inr(s['igst'])}\n"
        f"Total GST: <b>{inr(s['total_gst'])}</b>\n\n<b>By rate</b>\n"
        + "\n".join(f"{e(str(r['slab']))}: taxable {inr(r['taxable'])} · GST {inr(r['total_gst'])}" for r in j["slabs"])
        + "\n<i>Cancelled bills excluded; credit notes not netted. Not a GSTR filing figure.</i>")
    return t + updated(), [[("Main Menu", "m")]]


async def r_profit(u, a):
    s = (await get(u, "/reports/pl", P(a)))["summary"]
    t = head("PROFIT SUMMARY — PROVISIONAL", a) + (
        f"Net sales (after returns): {inr(s['net_sales'])}\nLess GST: {inr(s['total_gst_out'])}\nSales excl. GST: <b>{inr(s['net_excl_gst'])}</b>\n"
        f"Purchases booked in period: {inr(s['cost_of_goods'])}\nGross margin estimate: <b>{inr(s['gross_profit'])}</b> ({s['gp_percent']}%)\n\n"
        "<i>PROVISIONAL, not accounting profit: purchases of the period are used instead of the cost of goods actually sold, "
        "stock change and expenses are not deducted.</i>")
    return t + updated(), [[("Main Menu", "m")]]


# key: (title, group, financial, handler, default period)
REPORTS: dict[str, tuple] = {
    "today_sales": ("Today's sales", "Sales", False, r_sales, "today"),
    "yesterday_sales": ("Yesterday's sales", "Sales", False, r_sales, "yesterday"),
    "running_sales": ("Running sales (today so far)", "Sales", False, r_sales, "today"),
    "month_sales": ("This month's sales", "Sales", False, r_sales, "month"),
    "sales_outlet": ("Sales by outlet", "Sales", False, r_sales_outlet, "today"),
    "top_items": ("Top selling items", "Sales", False, r_top_items, "month"),
    "hourly_sales": ("Hourly sales", "Sales", False, r_hourly, "today"),
    "sales_category": ("Sales by category", "Sales", False, r_sales_category, "today"),
    "sales_comparison": ("Sales comparison", "Sales", False, r_compare, "today"),
    "sales_return": ("Sales returns", "Sales", False, r_sales_return, "today"),
    "stock": ("Stock summary", "Inventory", False, r_stock, None),
    "stock_item": ("Stock of an item", "Inventory", False, r_stock_item, None),
    "low_stock": ("Low stock / reorder", "Inventory", False, _stock_flag("low_stock", "LOW STOCK (REORDER)", "low_stock"), None),
    "zero_stock": ("Zero stock", "Inventory", False, _stock_flag("zero_stock", "ZERO STOCK", "zero_stock"), None),
    "negative_stock": ("Negative stock", "Inventory", False, _stock_flag("negative_stock", "NEGATIVE STOCK", "negative_stock"), None),
    "stock_value": ("Inventory valuation", "Inventory", False, r_stock_value, None),
    "stock_outlet": ("Stock by outlet", "Inventory", False, _stock_group("outlet", "STOCK BY OUTLET", "stock_outlet"), None),
    "stock_category": ("Stock by category", "Inventory", False, _stock_group("category", "STOCK BY CATEGORY", "stock_category"), None),
    "fast_moving": ("Fast moving items", "Inventory", False, _velocity("fast", "FAST MOVING ITEMS", "fast_moving", "50 or more sold in the last 90 days"), None),
    "non_moving": ("Non-moving items", "Inventory", False, _velocity("dead", "NON-MOVING ITEMS", "non_moving", "No sale in the last 90 days"), None),
    "near_expiry": ("Near-expiry stock", "Inventory", False, r_expiry, None),
    "today_purchase": ("Today's purchases", "Purchase & Accounts", False, r_purchase, "today"),
    "month_purchase": ("This month's purchases", "Purchase & Accounts", False, r_purchase, "month"),
    "supplier_outstanding": ("Supplier outstanding", "Purchase & Accounts", True, r_supplier_out, None),
    "customer_outstanding": ("Customer outstanding", "Purchase & Accounts", True, r_customer_out, None),
    "cash_balance": ("Cash balance", "Purchase & Accounts", True, r_cash, None),
    "bank_balance": ("Bank balance", "Purchase & Accounts", True, r_bank, None),
    "today_expense": ("Expenses", "Purchase & Accounts", True, r_expense, "today"),
    "payment_due": ("Payments due", "Purchase & Accounts", True, r_payment_due, None),
    "gst_summary": ("GST summary", "Purchase & Accounts", True, r_gst, "month"),
    "profit_summary": ("Profit summary (provisional)", "Purchase & Accounts", True, r_profit, "month"),
}
TITLES = {"today_sales": "TODAY SALES REPORT", "yesterday_sales": "YESTERDAY SALES REPORT", "running_sales": "RUNNING SALES (TODAY SO FAR)",
          "month_sales": "MONTH SALES REPORT", "today_purchase": "TODAY PURCHASE", "month_purchase": "MONTH PURCHASE"}


# ── understanding a message (deterministic; no AI, no SQL) ───────────────────
DATE_RX = r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})"


def parse_period(t: str, default: Optional[str]) -> tuple[date, date, bool]:
    """(from, to, explicit) — bounded to MAX_DAYS and not in the future."""
    today = now_ist().date()
    explicit = True
    m = re.findall(DATE_RX, t)
    if m:
        try:
            ds = [date(int(y), int(mo), int(d)) for d, mo, y in m[:2]]
        except ValueError:
            raise Ask("That date is not valid. Use DD-MM-YYYY, e.g. 29-10-2026.")
        fd, td = ds[0], ds[-1]
    elif "yesterday" in t:
        fd = td = today - timedelta(days=1)
    elif "last month" in t or "previous month" in t:
        td = today.replace(day=1) - timedelta(days=1)
        fd = td.replace(day=1)
    elif re.search(r"last (\d{1,3}) days", t):
        n = int(re.search(r"last (\d{1,3}) days", t).group(1))
        fd, td = today - timedelta(days=n - 1), today
    elif re.search(r"\b(this )?week\b", t):
        fd, td = today - timedelta(days=6), today
    elif re.search(r"\b(this month|month|mtd|monthly)\b", t):
        fd, td = today.replace(day=1), today
    elif "today" in t:
        fd = td = today
    else:
        explicit = False
        if default == "yesterday":
            fd = td = today - timedelta(days=1)
        elif default == "month":
            fd, td = today.replace(day=1), today
        else:
            fd = td = today
    if fd > td:
        fd, td = td, fd
    if td > today:
        raise Ask("That date is in the future.")
    if (td - fd).days + 1 > MAX_DAYS:
        raise Ask(f"Please choose a period of up to {MAX_DAYS} days.")
    return fd, td, explicit


INTENTS = [   # first match wins; order matters
    (r"compar|vs\.?|versus", "sales_comparison"),
    (r"hour", "hourly_sales"),
    (r"top|best ?sell|highest sell|most sold", "top_items"),
    (r"(supplier|vendor).*(due|pay)|payment.?due|due payment|pending (supplier )?payment|payables? due", "payment_due"),
    (r"supplier|vendor|payable", "supplier_outstanding"),
    (r"customer|receivable|debtor|credit due", "customer_outstanding"),
    (r"bank", "bank_balance"),
    (r"cash", "cash_balance"),
    (r"expense", "today_expense"),
    (r"\bgst\b|\btax\b", "gst_summary"),
    (r"profit|margin|p ?& ?l\b", "profit_summary"),
    (r"expir", "near_expiry"),
    (r"negative", "negative_stock"),
    (r"zero stock|out of stock|stock ?out|no stock", "zero_stock"),
    (r"low stock|below min|minimum stock|reorder|re-order", "low_stock"),
    (r"stock value|inventory value|valuation|value of (stock|inventory)", "stock_value"),
    (r"fast", "fast_moving"),
    (r"non.?moving|dead stock|not (moving|selling)|slow", "non_moving"),
    (r"return", "sales_return"),
    (r"purchase|grn|bought", "purchase"),
    (r"categor", "category"),
    (r"(outlet|store|branch).?wise|by (outlet|store|branch)|each (outlet|store)|all (outlets|stores)|outlets", "outlet_list"),
    (r"stock (of|for)|item|product|sku", "stock_item"),
    (r"stock|inventory", "stock"),
    (r"running|so far|live|right now|till now", "running_sales"),
    (r"sale|sold|revenue|turnover|business", "sales"),
]


def detect(t: str) -> Optional[str]:
    for rx, key in INTENTS:
        if re.search(rx, t):
            if key == "purchase":
                return "month_purchase" if re.search(r"month|mtd", t) else "today_purchase"
            if key == "category":
                return "stock_category" if re.search(r"stock|inventory", t) else "sales_category"
            if key == "outlet_list":
                return "stock_outlet" if re.search(r"stock|inventory", t) else "sales_outlet"
            if key == "sales":
                return "yesterday_sales" if "yesterday" in t else "month_sales" if re.search(r"month|mtd", t) else "today_sales"
            return key
    return None


async def my_outlets(u: dict) -> list[dict]:
    """The user's own outlets, as every report lists them (cheap empty-date call)."""
    return (await get(u, "/reports/top-items", {"from_date": "2000-01-01", "to_date": "2000-01-01", "top_n": 1}))["outlets"]


async def resolve_outlet(u: dict, t: str, explicit: Optional[str]) -> Optional[dict]:
    """Outlet named in the message, among the user's own outlets only. Ask when several match."""
    if not explicit and not re.search(r"outlet|store|branch|shop|\bat\b|\bin\b", t):
        return None
    outlets = await my_outlets(u)
    term = (explicit or "").lower().strip()
    hits = []
    for o in outlets:
        name = o["name"].lower()
        parts = {name, *[p.strip() for p in name.split(" - ")]}
        if term:
            if any(term == p for p in parts) or term in name:
                hits.append(o)
        elif any(len(p) >= 4 and re.search(r"\b" + re.escape(p) + r"\b", t) for p in parts):
            hits.append(o)
    exact = [o for o in hits if term and term in {p.strip() for p in o["name"].lower().split(" - ")} | {o["name"].lower()}]
    hits = exact or hits
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        raise Ask("Which outlet?", [[(o["name"][:40], f"o|{o['id']}")] for o in hits[:8]])
    if term:
        raise Ask(f"Outlet “{e(explicit)}” is not one of your outlets. Send /menu to see reports for all your outlets.")
    return None


def parse_args(report: str, rest: str, t_full: str) -> dict:
    """Arguments from the text after a command (or the whole natural-language message)."""
    t = t_full.lower()
    a: dict = {"report": report}
    lm = re.search(r"\b(?:top|limit|first)\s*(\d{1,3})\b", t) or (re.match(r"\s*(\d{1,2})\s*$", rest) if report == "top_items" else None)
    if lm:
        a["limit"] = max(1, min(50, int(lm.group(1))))
    om = re.search(r"(?:outlet|store|branch|shop)\s*[:=]?\s+(?!wise|sales|stock|by\b)([a-z0-9][\w .&'()-]{1,40}?)\s*(?:$|\?|,| for | sales| stock| today| yesterday| this| last)", t)
    a["outlet_term"] = om.group(1).strip() if om else None
    if report == "sales_outlet" and rest.strip() and not re.search(DATE_RX + r"|today|yesterday|month|week|days", rest.lower()):
        a["outlet_term"] = rest.strip()[:40]
    if report == "stock_item":
        item = rest.strip() if rest.strip() else None
        if not item:
            im = re.search(r"(?:stock|qty|quantity)\s+(?:of|for)?\s*(?:item|product|code|sku)?\s*[:#]?\s*(.+)$", t) or \
                 re.search(r"(?:item|product|code|sku)\s*[:#]?\s*(.+)$", t)
            item = im.group(1) if im else None
        if item:
            item = re.split(r"\s+(?:in|at)\s+(?:outlet|store|branch)?", item.strip(" ?.!"))[0]
            item = re.sub(r"^(?:item|product|code|sku)\s*[:#]?\s*", "", item.strip(), flags=re.I)
        a["item"] = (item or "")[:60]
    return a


# ── accounts, linking, logging ───────────────────────────────────────────────
async def account_for_chat(db, chat_id: int) -> Optional[dict]:
    r = (await db.execute(text("""SELECT a.id AS account_id, a.user_id, a.allow_financial, a.blocked_reports, a.alerts, a.chat_id,
            u.role, u.name, u.username FROM telegram_accounts a JOIN users u ON u.id = a.user_id
        WHERE a.chat_id = :c AND a.status = 'ACTIVE' AND u.status
          AND (u.valid_from IS NULL OR u.valid_from <= CURRENT_DATE) AND (u.valid_until IS NULL OR u.valid_until >= CURRENT_DATE)"""),
        {"c": chat_id})).mappings().first()
    return dict(r) if r else None


def code_hash(code: str) -> str:
    return hashlib.sha256(code.strip().encode()).hexdigest()


async def new_link_code(db, user_id: int, allow_financial: bool, by: int) -> tuple[str, datetime]:
    code = secrets.token_urlsafe(12).replace("-", "x").replace("_", "y")    # 16 chars, deep-link safe
    exp = datetime.utcnow() + timedelta(minutes=CODE_TTL_MIN)
    await db.execute(text("""INSERT INTO telegram_link_codes (code_hash, user_id, allow_financial, created_by, expires_at)
        VALUES (:h, :u, :f, :b, :x)"""), {"h": code_hash(code), "u": user_id, "f": allow_financial, "b": by, "x": exp})
    return code, exp


async def link(db, code: str, chat: dict, frm: dict) -> Optional[dict]:
    """Single use, not expired. The Telegram chat is bound to the software user who received the code."""
    r = (await db.execute(text("""UPDATE telegram_link_codes SET used_at = NOW(), used_chat_id = :c
        WHERE code_hash = :h AND used_at IS NULL AND expires_at > NOW() RETURNING user_id, allow_financial, created_by"""),
        {"h": code_hash(code), "c": chat["id"]})).mappings().first()
    if not r:
        return None
    await db.execute(text("""INSERT INTO telegram_accounts (user_id, chat_id, tg_username, tg_name, allow_financial, linked_by)
        VALUES (:u, :c, :un, :n, :f, :b)
        ON CONFLICT (chat_id) DO UPDATE SET user_id = :u, tg_username = :un, tg_name = :n, allow_financial = :f, linked_by = :b,
            status = 'ACTIVE', linked_at = NOW(), revoked_at = NULL, revoked_by = NULL, blocked_reports = '{}'"""),
        {"u": r["user_id"], "c": chat["id"], "un": (frm.get("username") or "")[:100],
         "n": f"{frm.get('first_name', '')} {frm.get('last_name', '')}".strip()[:200], "f": r["allow_financial"], "b": r["created_by"]})
    from app.services.auth_service import write_audit
    await write_audit(db=db, module="telegram", action="link", record_id=r["user_id"], record_no=f"chat {chat['id']}",
                      description="Telegram account linked with a one-time code", user_id=r["user_id"], user_name="telegram")
    await db.commit()
    return dict(r)


_hits: dict[int, deque] = defaultdict(deque)   # ponytail: per-process limiter; move to Redis if the API runs several workers


def rate_ok(chat_id: int) -> bool:
    n, win = RATE
    q, now = _hits[chat_id], _time.monotonic()
    while q and now - q[0] > win:
        q.popleft()
    if len(q) >= n:
        return False
    q.append(now)
    return True


_last: dict[tuple[int, str], dict] = {}        # chat + report -> last arguments (for page buttons); per process
_pending: dict[int, tuple[str, dict]] = {}      # chat -> request waiting for an outlet choice


async def _log(log_id: Optional[int], **kw):
    if not log_id:
        return
    async with async_session_factory() as db:
        sets = ", ".join(f"{k} = :{k}" for k in kw)
        await db.execute(text(f"UPDATE telegram_logs SET {sets} WHERE id = :i"), {**kw, "i": log_id})
        await db.commit()


def menu_text() -> str:
    out, g = ["<b>Nutribray Business Assistant</b>\nAsk in plain words (e.g. <i>today's sales</i>, <i>stock of item 10025</i>) or use a command:"], None
    for k, (title, grp, fin, _, _) in REPORTS.items():
        if grp != g:
            out.append(f"\n<b>{grp}</b>")
            g = grp
        out.append(f"/{k} — {title}{' 🔒' if fin else ''}")
    out.append("\nAdd a date (<i>yesterday</i>, <i>this month</i>, <i>01-10-2026 to 15-10-2026</i>), an outlet (<i>outlet Adchini</i>) or <i>top 20</i>.\n"
               "🔒 = financial report, needs approval by your administrator.\n/status — your access")
    return "\n".join(out)


MENU_KB = [[("Today Sales", "r|today_sales"), ("Running Sales", "r|running_sales")], [("Sales by Outlet", "r|sales_outlet"), ("Top Items", "r|top_items")],
           [("Hourly Sales", "r|hourly_sales"), ("Stock Summary", "r|stock")], [("Low Stock", "r|low_stock"), ("Month Sales", "r|month_sales")]]


async def run_report(u: dict, key: str, a: dict) -> tuple[str, list]:
    """Report-level permission + the report itself (outlet / category / role checks happen inside the endpoint)."""
    title, _, fin, fn, _ = REPORTS[key]
    if key in (u.get("blocked_reports") or []):
        raise Denied(f"“{title}” is not enabled for your Telegram access.")
    if fin and not u.get("allow_financial"):
        raise Denied(f"“{title}” is a financial report. Ask your administrator to allow financial reports for your Telegram account.")
    a.setdefault("title", TITLES.get(key, title.upper()))
    a["running"] = key == "running_sales"
    return await fn(u, a)


async def handle_text(u: dict, chat_id: int, msg: str) -> tuple[str, list, Optional[str]]:
    t = re.sub(r"\s+", " ", msg.strip())[:300]
    m = re.match(r"/([a-z_]+)(?:@\w+)?\s*(.*)$", t, re.I)
    if m:
        key, rest = m.group(1).lower(), m.group(2)
        if key in ("start", "menu", "help"):
            return menu_text(), MENU_KB, key
        if key == "status":
            return await status_text(u), [[("Main Menu", "m")]], key
        if key not in REPORTS:
            return f"Unknown command /{e(key)}. Send /menu for the list.", MENU_KB, None
    else:
        key, rest = detect(t.lower()), ""
        if not key:
            return ("I can answer questions about sales, stock, purchases and accounts. Try:\n• <i>How much is today's sales?</i>\n"
                    "• <i>Show stock of item 10025</i>\n• <i>Which items are below minimum stock?</i>\nor send /menu."), MENU_KB, None
    a = parse_args(key, rest, t)
    a["fd"], a["td"], a["explicit_period"] = parse_period(t.lower(), REPORTS[key][4])
    o = await resolve_outlet(u, t.lower(), a.pop("outlet_term", None)) if key not in ("supplier_outstanding", "cash_balance", "bank_balance", "payment_due") else None
    if o:
        a["outlet_id"], a["outlet_name"] = o["id"], o["name"]
    _last[(chat_id, key)] = a
    body, kb = await run_report(u, key, dict(a))
    return body, kb, key


async def status_text(u: dict) -> str:
    async with async_session_factory() as db:
        r = (await db.execute(text("""SELECT u.all_outlets, (SELECT COUNT(*) FROM user_store_assignments s WHERE s.user_id = u.id) AS stores,
            u.all_categories FROM users u WHERE u.id = :u"""), {"u": u["user_id"]})).mappings().first()
    outlets = "all outlets" if (r and r["all_outlets"]) or u["role"] in ("admin", "superadmin") else f"{r['stores'] if r else 0} assigned outlet(s)"
    return (f"<b>YOUR ACCESS</b>\nUser: {e(u['name'] or u['username'])} ({e(u['role'])})\nOutlets: {outlets}\n"
            f"Categories: {'all' if not r or r['all_categories'] else 'your assigned categories'}\n"
            f"Financial reports: {'allowed' if u['allow_financial'] else 'not allowed'}\n"
            f"Alerts: {', '.join(u['alerts'] or []) or 'none'}\n<i>Same permissions as in the software. Read-only.</i>")


async def process_update(upd: dict, log_id: Optional[int] = None):
    t0 = _time.monotonic()
    cq = upd.get("callback_query")
    msg = upd.get("message") or (cq or {}).get("message") or {}
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    frm = (cq or msg).get("from") or {}
    if not chat_id:
        return await _log(log_id, status="ignored")
    if cq:
        try:
            await api("answerCallbackQuery", callback_query_id=cq["id"])
        except TgError:
            pass
    if chat.get("type") != "private":     # reports only in private chats; group membership is not authorisation
        return await _log(log_id, status="group_ignored")
    if not rate_ok(chat_id):
        await _log(log_id, status="rate_limited")
        return
    txt = (msg.get("text") or "") if not cq else ""
    report = None
    try:
        m = re.match(r"/(?:start|link)\s+([A-Za-z0-9]{8,64})$", txt.strip())
        ok = None
        async with async_session_factory() as db:
            if m:
                ok = await link(db, m.group(1), chat, frm)
            u = await account_for_chat(db, chat_id)
            if u and not m:
                await db.execute(text("UPDATE telegram_accounts SET last_seen_at = NOW() WHERE id = :i"), {"i": u["account_id"]})
            await db.commit()
        if m:
            ms = int((_time.monotonic() - t0) * 1000)
            if not ok:
                await _log(log_id, request="/start ****", status="link_failed", ms=ms)
                return await send(chat_id, "This link code is invalid, already used or expired. Ask your administrator for a new one.")
            await _log(log_id, request="/start ****", status="linked", user_id=ok["user_id"], account_id=u["account_id"] if u else None, ms=ms)
            return await send(chat_id, f"✅ Linked to <b>{e(u['name'] or u['username'])}</b>. You see the same outlets and reports as in the software.\n\n" + menu_text(), MENU_KB)
        if not u:
            await _log(log_id, request=txt[:200] if not cq else "[button]", status="unlinked")
            return await send(chat_id, "This Telegram account is not linked to a NUTRIBRAY user. Ask your administrator for a link code, then send <code>/start CODE</code>.")
        await _log(log_id, account_id=u["account_id"], user_id=u["user_id"])
        if cq:
            data = cq.get("data") or ""
            parts = data.split("|")
            if data == "m":
                body, kb, report = menu_text(), MENU_KB, "menu"
            elif parts[0] == "r" and len(parts) == 2 and parts[1] in REPORTS:
                report = parts[1]
                body, kb, _ = await handle_text(u, chat_id, "/" + report)
            elif parts[0] == "pg" and len(parts) == 3 and parts[1] in REPORTS and parts[2].isdigit():
                report = parts[1]
                a = _last.get((chat_id, report))
                if not a:
                    raise Ask("That list has expired. Please run the command again.")
                body, kb = await run_report(u, report, {**a, "page": int(parts[2])})
            elif parts[0] == "si" and len(parts) == 2:
                report = "stock_item"
                body, kb, _ = await handle_text(u, chat_id, "/stock_item " + parts[1])
            elif parts[0] == "o" and len(parts) == 2 and parts[1].isdigit() and chat_id in _pending:
                report, a = _pending.pop(chat_id)
                o = next((x for x in await my_outlets(u) if x["id"] == int(parts[1])), None)
                if not o:
                    raise Denied("That outlet is not one of your outlets.")
                a.update(outlet_id=o["id"], outlet_name=o["name"])
                _last[(chat_id, report)] = a
                body, kb = await run_report(u, report, dict(a))
            else:
                raise Ask("That button has expired. Send /menu.")
            await _log(log_id, request=f"[button] {data}"[:200])
        else:
            await _log(log_id, request=txt[:200])
            try:
                body, kb, report = await handle_text(u, chat_id, txt)
            except Ask as ex:
                if ex.buttons and ex.buttons[0][0][1].startswith("o|"):   # remember the request until an outlet is chosen
                    key = (re.match(r"/([a-z_]+)", txt.strip().lower()) or [None, None])[1] or detect(txt.lower())
                    if key in REPORTS:
                        a = parse_args(key, txt.split(" ", 1)[1] if " " in txt and txt.startswith("/") else "", txt)
                        a.pop("outlet_term", None)
                        a["fd"], a["td"], _ = parse_period(txt.lower(), REPORTS[key][4])
                        _pending[chat_id] = (key, a)
                raise
        await send(chat_id, body, kb)
        await _log(log_id, status="ok", report=report, ms=int((_time.monotonic() - t0) * 1000))
        async with async_session_factory() as db:
            await db.execute(text("UPDATE telegram_settings SET last_ok_at = NOW() WHERE id = 1"))
            await db.commit()
    except Ask as ex:
        await send(chat_id, str(ex), ex.buttons)
        await _log(log_id, status="clarify", report=report, ms=int((_time.monotonic() - t0) * 1000))
    except Denied as ex:
        await send(chat_id, f"⛔ {e(str(ex))}", [[("Main Menu", "m")]])
        await _log(log_id, status="denied", report=report, error=scrub(ex)[:300])
    except TgError as ex:
        await _record_error(scrub(ex))
        await _log(log_id, status="send_failed", report=report, error=scrub(ex)[:300])
    except Exception as ex:
        log.exception("telegram update failed")
        await _log(log_id, status="error", report=report, error=scrub(f"{type(ex).__name__}: {ex}")[:300])
        try:
            await send(chat_id, "Sorry, this report could not be generated right now. Please try again in a minute.")
        except TgError:
            pass


async def _record_error(msg: str):
    async with async_session_factory() as db:
        await db.execute(text("UPDATE telegram_settings SET last_error = :m, last_error_at = NOW() WHERE id = 1"), {"m": msg[:500]})
        await db.commit()


_tasks: set = set()


def spawn(coro):
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)
    return t


# ── automatic alerts ─────────────────────────────────────────────────────────
ALERT_DEFAULTS = {"daily_summary": "22:30", "running_snapshot": "12:00,16:00,20:00", "low_stock": "09:00", "out_of_stock": "09:00",
                  "approvals": "10:00,16:00", "payment_due": "10:00", "unusual": "21:00", "discount_pct": 10, "return_pct": 5}
ALERTS = {   # key: (title, financial)
    "daily_summary": ("Daily sales summary", False), "running_snapshot": ("Running-sales snapshots", False),
    "low_stock": ("Low-stock alert", False), "out_of_stock": ("Out-of-stock alert (selling items)", False),
    "approvals": ("Pending approval reminder (purchase & others)", False), "payment_due": ("Supplier payment due reminder", True),
    "unusual": ("Unusual discount / return alert", False),
}


async def build_alert(u: dict, alert: str, cfg: dict) -> Optional[str]:
    today = now_ist().date()
    a = {"fd": today, "td": today, "report": alert}
    if alert == "daily_summary":
        return (await run_report(u, "today_sales", {**a, "title": "DAILY SALES SUMMARY"}))[0]
    if alert == "running_snapshot":
        return (await run_report(u, "running_sales", a))[0]
    if alert == "low_stock":
        j = await get(u, "/stock-reports/summary", {"low_stock": True})
        if not j["rows"]:
            return None
        return (await run_report(u, "low_stock", a))[0]
    if alert == "out_of_stock":
        d = await get(u, "/dashboard/summary", {"on": today.isoformat()})
        if not d.get("stockout_count"):
            return None
        lines = [f"{e(r['name'] or '')} ({e(str(r['item_code']))}) · {e(r['outlet'])}: stock {num(r['stock_qty'])}, sold {num(r['sold_qty'])}" for r in d["stockouts"]]
        return f"<b>OUT OF STOCK — SELLING ITEMS</b>\n{d['stockout_count']} item-outlet(s) sold recently but now at zero (top {len(lines)}):\n\n" + "\n".join(lines) + updated()
    if alert == "approvals":
        rows = await get(u, "/approvals", {"status": "PENDING"})
        if not rows:
            return None
        by = defaultdict(int)
        for r in rows:
            by[r.get("label") or r.get("request_type")] += 1
        return "<b>PENDING APPROVALS</b>\n" + "\n".join(f"{e(str(k))}: {v}" for k, v in by.items()) + "\nOpen Approvals in NUTRIBRAY to act." + updated()
    if alert == "payment_due":
        d = await get(u, "/accounts/dashboard")
        if not (d["overdue"] or d["due_7d"]):
            return None
        return (await run_report(u, "payment_due", a))[0]
    if alert == "unusual":
        s = (await get(u, "/reports/sales", P(a)))["summary"]
        rt = await opt(get(u, "/billing/returns", {"from_date": today.isoformat(), "to_date": today.isoformat(), "per_page": 200}))
        gross = float(s["gross_sales"] or 0)
        disc = float(s["total_discount"] or 0) / gross * 100 if gross else 0
        ret = sum(float(r["total_amount"] or 0) for r in (rt or {}).get("items", []) if r.get("status") != "cancelled")
        retp = ret / gross * 100 if gross else 0
        out = []
        if disc >= float(cfg.get("discount_pct") or 10):
            out.append(f"Discount today is {disc:.1f}% of gross sales ({inr(s['total_discount'])}) — limit {cfg.get('discount_pct')}%.")
        if retp >= float(cfg.get("return_pct") or 5):
            out.append(f"Returns today are {retp:.1f}% of gross sales ({inr(ret)}) — limit {cfg.get('return_pct')}%.")
        return ("<b>⚠ UNUSUAL ACTIVITY</b>\n" + "\n".join(out) + updated()) if out else None
    return None


def due_slots(cfg: dict, alert: str, now: datetime) -> list[str]:
    """Slots (HH:MM) of this alert that are due now: from the time until 2 hours after (survives a restart)."""
    out = []
    for s in str(cfg.get(alert) or "").split(","):
        s = s.strip()
        if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", s):
            continue
        at = datetime.combine(now.date(), datetime.strptime(s, "%H:%M").time())
        if at <= now < at + timedelta(hours=2):
            out.append(s)
    return out


async def alerts_tick(now: Optional[datetime] = None) -> int:
    now = now or now_ist()
    sent = 0
    async with async_session_factory() as db:
        st = (await db.execute(text("SELECT enabled, alerts FROM telegram_settings WHERE id = 1"))).mappings().first()
        if not st or not st["enabled"] or not token():
            return 0
        cfg = {**ALERT_DEFAULTS, **(st["alerts"] or {})}
        accounts = (await db.execute(text("""SELECT a.chat_id FROM telegram_accounts a JOIN users u ON u.id = a.user_id
            WHERE a.status = 'ACTIVE' AND u.status AND a.alerts <> '{}'"""))).scalars().all()
    for chat_id in accounts:
        async with async_session_factory() as db:
            u = await account_for_chat(db, chat_id)
        if not u:
            continue
        for alert in u["alerts"] or []:
            if alert not in ALERTS or (ALERTS[alert][1] and not u["allow_financial"]):
                continue
            for slot in due_slots(cfg, alert, now):
                period = f"{now.date()}@{slot}"
                async with async_session_factory() as db:     # claim first: one delivery per account / alert / slot
                    claimed = (await db.execute(text("""INSERT INTO telegram_alerts_sent (account_id, alert, period, status)
                        VALUES (:a, :k, :p, 'sending') ON CONFLICT DO NOTHING RETURNING id"""), {"a": u["account_id"], "k": alert, "p": period})).scalar()
                    await db.commit()
                if not claimed:
                    continue
                status, err = "nothing", None
                try:
                    body = await build_alert(u, alert, cfg)
                    if body:
                        await send(chat_id, body, [[("Main Menu", "m")]])
                        status = "sent"
                        sent += 1
                except Denied as ex:
                    status, err = "denied", str(ex)[:300]
                except Exception as ex:
                    status, err = "failed", scrub(f"{type(ex).__name__}: {ex}")[:300]
                async with async_session_factory() as db:
                    await db.execute(text("UPDATE telegram_alerts_sent SET status = :s, error = :e, sent_at = NOW() WHERE id = :i"),
                                     {"s": status, "e": err, "i": claimed})
                    await db.commit()
    return sent


async def alerts_worker():
    await asyncio.sleep(90)
    while True:
        try:
            await alerts_tick()
        except Exception:
            log.exception("telegram alerts")
        await asyncio.sleep(60)


if __name__ == "__main__":
    assert inr(1234567.5) == "₹12,34,567.50" and inr(-950) == "-₹950.00" and inr(123456) == "₹1,23,456.00"
    assert detect("how much is today's sales?") == "today_sales" and detect("show running sales") == "running_sales"
    assert detect("compare today's sales with yesterday") == "sales_comparison" and detect("which are our top-selling products?") == "top_items"
    assert detect("show stock of item 10025") == "stock_item" and detect("which items are below minimum stock?") == "low_stock"
    assert detect("show pending supplier payments") == "payment_due" and detect("what is our purchase value this month?") == "month_purchase"
    assert detect("show green park outlet sales") == "today_sales" and detect("outlet wise sales") == "sales_outlet"
    assert parse_args("stock_item", "", "show stock of item 10025")["item"] == "10025"
    assert parse_args("today_sales", "", "show sales outlet green park today")["outlet_term"] == "green park"
    assert parse_args("top_items", "15", "/top_items 15")["limit"] == 15
    assert _chunks("x\n" * 5000, 3800) and all(len(c) <= 3802 for c in _chunks("abc\n" * 3000))
    pt, pk = paged("H ", [f"row {i}" for i in range(40)], "zero_stock", 3)
    assert "Showing 31–40 of 40 (page 3/3)" in pt and pk[0] == [("◀ Prev", "pg|zero_stock|2")]
    n = datetime(2026, 10, 29, 12, 30)
    assert due_slots({"s": "12:00,16:00"}, "s", n) == ["12:00"] and due_slots({"s": "15:00"}, "s", n) == []
    try:
        parse_period("01-01-2026 to 30-06-2026", None)
        raise AssertionError("range not bounded")
    except Ask:
        pass
    print("telegram_bot OK")
