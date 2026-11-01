from decimal import Decimal
from datetime import datetime, date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query
from app.core.dependencies import get_current_user
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, text, update
import asyncio

from app.core.database import get_db
from app.models.outlet import outlet
from app.models.invoice import invoice as inv_model, invoice_item as item_model, invoice_payment as pay_model
from app.models.sync import (
    unit_wise_purchase, unit_wise_purchase_item,
    unit_wise_purchase_return, unit_wise_purchase_return_item,
    unit_wise_stock_transfer, unit_wise_stock_transfer_item,
    outlet_stock, sync_log,
)
from app.models.sync_validation import sync_validation_error

async def log_validation_error(db: AsyncSession, outlet_id: int, sync_type: str, date_str: str, error_type: str, details: str, raw_data: dict = None):
    err = sync_validation_error(
        outlet_id=outlet_id,
        sync_type=sync_type,
        sync_date=date_str,
        error_type=error_type,
        details=details,
        raw_data=raw_data
    )
    db.add(err)
    await db.flush()

router = APIRouter(prefix="/sync", tags=["sync"], dependencies=[Depends(get_current_user)])


# ── helpers ───────────────────────────────────────────────────────────────────

def _mssql_conn(server: str, user: str, password: str, database: str):
    """Open a fresh pymssql connection using plain strings (no ORM objects)."""
    import pymssql
    return pymssql.connect(
        server=server,
        user=user,
        password=password,
        database=database,
        login_timeout=5,
        timeout=15,
    )


def _snap(store) -> dict:
    """DO NOT CALL DIRECTLY — use _get_outlet() which returns the dict."""
    raise RuntimeError("Use _get_outlet() — it returns the snapshot dict.")


def _conn(s: dict):
    """Open a fresh connection from a store snapshot dict."""
    return _mssql_conn(
        server  =s["server_name"],
        user    =s["db_username"],
        password=s["db_password"],
        database=s["database_name"],
    )


def _d(val) -> Decimal:
    """Safe Decimal — treats None/empty as 0, never raises."""
    if val is None:
        return Decimal("0")
    try:
        return Decimal(str(val))
    except Exception:
        return Decimal("0")


def _half(val: Decimal) -> Decimal:
    return (val / 2).quantize(Decimal("0.01"))


def _get(d: dict, *keys: str):
    """Case-insensitive dictionary getter for multiple possible keys."""
    if not d: return None
    # normalize all keys in d to lower case
    d_lower = {k.lower(): v for k, v in d.items()}
    for k in keys:
        kl = k.lower()
        if kl in d_lower and d_lower[kl] is not None:
            return d_lower[kl]
    return None


def _to_date(val, fallback):
    """Convert datetime/string to date safely."""
    if val is None:
        return fallback
    if hasattr(val, "date"):
        return val.date()
    if isinstance(val, str):
        try:
            return datetime.strptime(val[:10], "%Y-%m-%d").date()
        except Exception:
            pass
    return fallback


async def _get_outlet(id: int, db: AsyncSession) -> dict:
    """
    Fetch outlet and return a plain dict with all connection attrs.
    Reading ORM attrs HERE (inside the async session greenlet) is safe.
    Returning the dict means callers never touch the ORM object and
    never risk MissingGreenlet lazy-load errors.
    """
    result = await db.execute(select(outlet).where(outlet.id == id))
    store = result.scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=404, detail="Outlet not found")
    if not store.is_connected:
        raise HTTPException(status_code=400, detail="Outlet offline. Check connection first.")
    # Read ALL attributes NOW while the session greenlet is active
    return {
        "id"           : int(store.id),
        "outlet_name"  : str(store.outlet_name  or ""),
        "server_name"  : str(store.server_name  or ""),
        "database_name": str(store.database_name or ""),
        "db_username"  : str(store.db_username  or "sysuser"),
        "db_password"  : str(store.db_password  or ""),
    }


async def _log(db: AsyncSession, outlet_id: int, sync_type: str, status: str, message: str, count: int = 0):
    db.add(sync_log(
        outlet_id=outlet_id,
        sync_type=sync_type,
        status=status,
        message=message,
        records_synced=count,
    ))


# ── describe (debug) ──────────────────────────────────────────────────────────

@router.get("/debug-payments/{id}")
async def debug_payments(id: int, sync_date: str, db: AsyncSession = Depends(get_db)):
    """
    Debug: checks what payment data exists in SQL Server for a given date.
    Returns raw counts from SALES_HDR, SALES_PAYMENT_DTL, PAYMENT_MODE
    so you can diagnose why payments sync returns empty.
    """
    s = await _get_outlet(id, db)

    def _check():
        info: dict = {}

        def _q(label: str, sql: str, params=None):
            """Run one query on a fresh connection; store result or error."""
            try:
                c = _conn(s)
                cur = c.cursor(as_dict=True)
                cur.execute(sql, params or ())
                row = cur.fetchone()
                info[label] = list(row.values())[0] if row else None
                c.close()
            except Exception as exc:
                info[label] = f"ERROR: {exc}"
                try: c.close()
                except Exception: pass

        def _qcols(label: str, sql: str, params=None):
            """Return column names of first row."""
            try:
                c = _conn(s)
                cur = c.cursor(as_dict=True)
                cur.execute(sql, params or ())
                row = cur.fetchone()
                info[label] = ",".join(row.keys()) if row else "no rows"
                c.close()
            except Exception as exc:
                info[label] = f"ERROR: {exc}"
                try: c.close()
                except Exception: pass

        # 1. All SALES_HDR for date (NO filters)
        _q("1_sales_hdr_any_date",
           "SELECT COUNT(*) AS cnt FROM SALES_HDR WHERE CAST(BILL_DATE AS DATE) = %s",
           (sync_date,))

        # 2. ISPOSTED=1 only
        _q("2_sales_hdr_isposted_1",
           "SELECT COUNT(*) AS cnt FROM SALES_HDR WHERE CAST(BILL_DATE AS DATE) = %s AND ISPOSTED = 1",
           (sync_date,))

        # 3. Distinct ISPOSTED values in SALES_HDR for that date
        try:
            c = _conn(s)
            cur = c.cursor(as_dict=True)
            cur.execute("SELECT DISTINCT ISPOSTED FROM SALES_HDR WHERE CAST(BILL_DATE AS DATE) = %s", (sync_date,))
            info["3_isposted_values"] = str([r["ISPOSTED"] for r in cur.fetchall()])
            c.close()
        except Exception as e:
            info["3_isposted_values"] = f"ERROR: {e}"

        # 4. Latest date with any ISPOSTED=1 record
        _q("4_latest_posted_date",
           "SELECT TOP 1 CAST(BILL_DATE AS DATE) AS d FROM SALES_HDR WHERE ISPOSTED = 1 ORDER BY BILL_DATE DESC")

        # 5. SALES_HDR column: ISPOSTED type sample
        _qcols("5_sales_hdr_cols",
               "SELECT TOP 1 * FROM SALES_HDR")

        # 6. SALES_PAYMENT_DTL total rows
        _q("6_spd_total_rows",
           "SELECT COUNT(*) AS cnt FROM SALES_PAYMENT_DTL")

        # 7. SALES_PAYMENT_DTL columns
        _qcols("7_spd_cols",
               "SELECT TOP 1 * FROM SALES_PAYMENT_DTL")

        # 8. PAYMENT_MODE rows
        _q("8_payment_mode_count",
           "SELECT COUNT(*) AS cnt FROM PAYMENT_MODE")

        # 9. Payment join WITHOUT ISPOSTED filter
        _q("9_payment_join_no_filter",
           """SELECT COUNT(*) AS cnt
              FROM SALES_HDR SH
              INNER JOIN SALES_PAYMENT_DTL SPD ON SH.BILL_NO = SPD.BILL_NO
              INNER JOIN PAYMENT_MODE PM ON SPD.PAY_CODE = PM.PAYCODE
              WHERE CAST(SH.BILL_DATE AS DATE) = %s AND SH.ISCANCELLED = 0""",
           (sync_date,))

        # 10. View check
        _q("10_view_payments_count",
           "SELECT COUNT(*) AS cnt FROM VW_TRANSFER_TO_HO_PAYMENTS WHERE CAST(BILL_DATE AS DATE) = %s",
           (sync_date,))

        return info

    return await asyncio.to_thread(_check)


@router.get("/describe/{id}")
async def describe_tables(id: int, db: AsyncSession = Depends(get_db)):
    """Returns column names of SALES_HDR and SALES_DTL from SQL Server outlet."""
    s = await _get_outlet(id, db)

    def _describe():
        conn = _conn(s)
        cursor = conn.cursor()
        result = {}
        for tbl in ["SALES_HDR", "SALES_DTL"]:
            try:
                cursor.execute(f"""
                    SELECT COLUMN_NAME, DATA_TYPE
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME = '{tbl}'
                    ORDER BY ORDINAL_POSITION
                """)
                result[tbl] = [{"col": r[0], "type": r[1]} for r in cursor.fetchall()]
            except Exception as e:
                result[tbl] = f"ERROR: {e}"
        try:
            cursor.execute("SELECT TOP 1 * FROM SALES_HDR WHERE ISPOSTED = 1")
            cols = [desc[0] for desc in cursor.description]
            row  = cursor.fetchone()
            result["SALES_HDR_sample"] = dict(zip(cols, [str(v) for v in row])) if row else {}
        except Exception as e:
            result["SALES_HDR_sample"] = f"ERROR: {e}"
        conn.close()
        return result

    return await asyncio.to_thread(_describe)


# ── 1. Sync Sales (SALES_HDR + SALES_DTL) ────────────────────────────────────

@router.post("/run/{id}")
async def run_sync(
    id: int,
    sync_date: str,
    db: AsyncSession = Depends(get_db),
):
    """Sync sales invoices + items from SQL Server → unit_wise_invoices + items."""
    s = await _get_outlet(id, db)

    def _pull_sales():
        conn = _conn(s)
        cursor = conn.cursor(as_dict=True)
        # Note: some POS systems never set ISPOSTED=1; we sync all non-cancelled bills
        cursor.execute("""
            SELECT * FROM SALES_HDR
            WHERE CAST(BILL_DATE AS DATE) = %s
              AND ISCANCELLED = 0
        """, (sync_date,))
        
        # Validation: Check for required columns
        cols = [desc[0] for desc in cursor.description]
        required = ["BILL_NO", "BILL_DATE", "GRAND_TOTAL"]
        missing = [c for c in required if c not in cols]
        if missing:
            raise Exception(f"Missing required columns in SALES_HDR: {', '.join(missing)}")

        headers = cursor.fetchall()
        rows = []
        for hdr in headers:
            cursor.execute("SELECT * FROM SALES_DTL WHERE BILL_NO = %s", (hdr["BILL_NO"],))
            rows.append({"header": hdr, "items": cursor.fetchall()})
        conn.close()
        return rows

    try:
        sales_rows = await asyncio.to_thread(_pull_sales)
    except Exception as e:
        await log_validation_error(db, id, "sales", sync_date, "SourceError", str(e))
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")

    if not sales_rows:
        await log_validation_error(db, id, "sales", sync_date, "NoData", "No posted sales found")
        return {"success": True, "message": f"No posted sales found for {sync_date}", "imported": 0, "skipped": 0}

    imported = skipped = 0
    errors = []

    for rec in sales_rows:
        h = rec["header"]
        bill_no = str(h["BILL_NO"])

        dup = await db.execute(
            select(inv_model).where(
                inv_model.invoice_no == bill_no,
                inv_model.outlet_id  == s["id"],
            )
        )
        existing_inv = dup.scalar_one_or_none()
        is_stub = False
        if existing_inv:
            if existing_inv.notes and ("Auto-stub" in existing_inv.notes or "payment sync" in existing_inv.notes):
                is_stub = True
            elif existing_inv.subtotal == 0 and existing_inv.total_gst == 0:
                is_stub = True
            
            if not is_stub:
                skipped += 1
                continue

        try:
            # Try multiple common column names for financial totals (Case-Insensitive)
            subtotal    = _d(_get(h, "SUBTOTAL_AMOUNT", "SUBTOTAL", "BILL_AMOUNT", "GROSS_AMOUNT", "AMOUNT"))
            discount    = _d(_get(h, "DISC_AMOUNT", "TOTAL_DISCOUNT", "DISCOUNT", "BILL_DISC"))
            total_tax   = _d(_get(h, "SALES_TAX_AMOUNT", "TAX_AMOUNT", "TOTAL_TAX", "GST_AMOUNT", "TOTAL_GST"))
            grand_total = _d(_get(h, "GRAND_TOTAL", "NET_AMOUNT", "BILL_TOTAL", "BILL_AMT", "TOTAL_AMOUNT"))
            
            taxable     = subtotal - discount
            round_off   = _d(_get(h, "RoundOffBillAmount", "ROUND_OFF", "ROUNDOFF"))
            tendered    = _d(_get(h, "TENDERED_AMOUNT", "PAID_AMOUNT", "CASH_PAID") or grand_total)
            balance     = _d(_get(h, "BALANCE_AMOUNT", "DUE_AMOUNT", "BALANCE"))
            
            is_cancelled = bool(_get(h, "ISCANCELLED", "IS_CANCELLED", "CANCELLED") or 0)
            status = "cancelled" if is_cancelled else ("paid" if balance <= Decimal("0") else "unpaid")
            bill_date = _get(h, "BILL_DATE", "BILLDATE")
            ent_dt = _get(h, "ENT_DT", "ENTRY_DATE", "BILL_DATETIME")
            if not bill_date:
                bill_date = ent_dt
            inv_date  = _to_date(bill_date, sync_date)
            inv_datetime = ent_dt if isinstance(ent_dt, datetime) else (bill_date if isinstance(bill_date, datetime) else None)

            # Pre-calculate item totals if header totals are suspiciously low/zero
            calc_items = []
            sum_taxable = Decimal("0")
            sum_tax = Decimal("0")
            sum_discount = Decimal("0")
            sum_total = Decimal("0")

            for row in rec["items"]:
                i_qty      = _d(_get(row, "QTY", "QUANTITY", "UNIT_QTY") or 1)
                i_rate     = _d(_get(row, "RATE", "UNIT_RATE", "PRICE") or 0)
                i_disc     = _d(_get(row, "Line_Disc_Amount", "DISC_AMOUNT", "DISCOUNT", "ITEM_DISC") or 0)
                
                i_tax_pct  = _d(_get(row, "TAX_PERCENT", "GST_PERCENT", "TAX_PER", "GST_PER", "VAT_PERCENT") or 0)
                i_tax_amt  = _d(_get(row, "TAX_AMOUNT", "GST_AMOUNT", "TAX_AMT", "GST_AMT", "VAT_AMOUNT") or 0)
                
                # If item tax amount is 0 but pct is > 0, try to calculate
                if i_tax_amt == 0 and i_tax_pct > 0:
                    i_taxable_calc = (i_qty * i_rate) - i_disc
                    i_tax_amt = (i_taxable_calc * i_tax_pct / 100).quantize(Decimal("0.01"))
                
                # Try to get taxable amount directly, or calculate it
                # We check if it's 0 because many POS put 0 in AMOUNT column and use NET_AMOUNT for total
                i_taxable = _d(_get(row, "TAXABLE_VALUE", "TAXABLE_AMT", "TAXABLE_AMOUNT", "AMOUNT"))
                if i_taxable == 0:
                    i_taxable = (i_qty * i_rate) - i_disc

                i_total   = _d(_get(row, "TOTAL", "NET_TOTAL", "NET_AMOUNT", "NET_SALES", "TOTAL_AMOUNT"))
                if i_total == 0:
                    i_total = i_taxable + i_tax_amt
                
                sum_taxable += i_taxable
                sum_tax     += i_tax_amt
                sum_discount += i_disc
                sum_total   += i_total
                calc_items.append({**row, "_taxable": i_taxable, "_tax_amt": i_tax_amt, "_tax_pct": i_tax_pct, "_total": i_total})

            # Fallback: if header values are 0 but items have values, use item sums
            if subtotal == 0 and sum_taxable > 0:
                subtotal = sum_taxable
                taxable = sum_taxable
            if total_tax == 0 and sum_tax > 0:
                total_tax = sum_tax
            if discount == 0 and sum_discount > 0:
                discount = sum_discount
            if grand_total == 0 and sum_total > 0:
                grand_total = sum_total

            if is_stub:
                inv = existing_inv
                inv.invoice_date     = inv_date
                inv.invoice_datetime = inv_datetime
                inv.subtotal         = subtotal
                inv.discount         = discount
                inv.taxable_amount   = taxable
                inv.cgst_amount      = _half(total_tax)
                inv.sgst_amount      = _half(total_tax)
                inv.igst_amount      = Decimal("0")
                inv.total_gst        = total_tax
                inv.total_amount     = grand_total
                inv.round_off        = round_off
                inv.paid_amount      = tendered
                inv.due_amount       = balance
                inv.status           = status
                inv.notes            = (inv.notes + " | " if inv.notes else "") + str(h.get("BILL_REMARKS") or "")
            else:
                inv = inv_model(
                    invoice_no       = bill_no,
                    outlet_id        = s["id"],
                    customer_id      = 1,
                    invoice_date     = inv_date,
                    invoice_datetime = inv_datetime,
                    invoice_type     = "retail",
                    payment_mode     = "cash",
                    is_interstate    = False,
                    subtotal         = subtotal,
                    discount         = discount,
                    taxable_amount   = taxable,
                    cgst_amount      = _half(total_tax),
                    sgst_amount      = _half(total_tax),
                    igst_amount      = Decimal("0"),
                    total_gst        = total_tax,
                    cd_percent       = Decimal("0"),
                    cd_amount        = Decimal("0"),
                    total_amount     = grand_total,
                    round_off        = round_off,
                    paid_amount      = tendered,
                    due_amount       = balance,
                    status           = status,
                    notes            = str(h.get("BILL_REMARKS") or ""),
                    created_by       = 1,
                )

            async with db.begin_nested():
                if is_stub:
                    await db.execute(delete(item_model).where(item_model.invoice_id == inv.id))
                else:
                    db.add(inv)
                await db.flush()

                for row in calc_items:
                    db.add(item_model(
                        invoice_id   = inv.id,
                        product_id   = int(row.get("SERVICEORPRODUCTCODE") or 0) or 1,
                        item_code    = str(row.get("SERVICEORPRODUCTCODE") or ""),
                        name         = str(row.get("Particulars") or row.get("DESCRIPTION") or ""),
                        qty          = _d(row.get("QTY") or 1),
                        pcs          = Decimal("0"),
                        unit         = "PCS",
                        rate         = _d(row.get("RATE") or 0),
                        disc_val     = _d(row.get("Line_Disc_Amount") or row.get("DISC_AMOUNT") or 0),
                        disc_type    = "₹",
                        taxable_amt  = row["_taxable"],
                        gst_percent  = row["_tax_pct"],
                        cgst_percent = row["_tax_pct"] / 2,
                        sgst_percent = row["_tax_pct"] / 2,
                        igst_percent = Decimal("0"),
                        cgst_amount  = _half(row["_tax_amt"]),
                        sgst_amount  = _half(row["_tax_amt"]),
                        igst_amount  = Decimal("0"),
                        total        = row["_total"],
                        hsn_code     = str(row.get("HSNSACCODE") or ""),
                    ))

            imported += 1

        except Exception as e:
            errors.append({"bill_no": bill_no, "error": str(e)})
            continue

    await db.commit()
    await _log(db, s["id"], "sales", "success", f"Imported {imported} | Skipped {skipped} | Errors {len(errors)}", imported)
    await db.commit()

    return {
        "success"  : True,
        "sync_date": sync_date,
        "outlet"   : s["outlet_name"],
        "imported" : imported,
        "skipped"  : skipped,
        "errors"   : errors,
        "message"  : f"Imported {imported} | Skipped {skipped} | Errors {len(errors)}",
    }


# ── 2. Sync Sales Returns ─────────────────────────────────────────────────────

@router.post("/sales-returns/{id}")
async def sync_sales_returns(
    id: int,
    sync_date: str,
    db: AsyncSession = Depends(get_db),
):
    """Sync sales returns from VW_TRANSFER_TO_HO_SALES_RETURNS → unit_wise_invoices (type=return)."""
    s = await _get_outlet(id, db)

    def _pull():
        # Pre-connection check (propagate exception on connection failure)
        _conn(s).close()

        # attempt 1: VW view
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("SELECT * FROM VW_TRANSFER_TO_HO_SALES_RETURNS WHERE CAST(BILL_DATE AS DATE) = %s", (sync_date,))
            rows = cur.fetchall(); conn.close(); return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # attempt 2: SALES_RETURN_HDR + SALES_RETURN_DTL
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    H.BILL_RTN_NO         AS BILL_NO,
                    H.BILL_RTN_DATE       AS BILL_DATE,
                    H.GRAND_TOTAL         AS bill_total,
                    D.SERVICEORPRODUCTCODE AS product_code,
                    D.QTY                 AS qty,
                    D.RATE                AS rate,
                    D.TAX_AMOUNT          AS tax_amount,
                    D.AMOUNT              AS net_sales,
                    D.SERVICEORPRODUCTCODE AS DESCRIPTION
                FROM SALES_RETURN_HDR H
                INNER JOIN SALES_RETURN_DTL D ON H.BILL_RTN_NO = D.BILL_RTN_NO
                WHERE CAST(H.BILL_RTN_DATE AS DATE) = %s
            """, (sync_date,))
            rows = cur.fetchall(); conn.close(); return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        return []

    try:
        rows = await asyncio.to_thread(_pull)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")

    if not rows:
        return {"success": True, "message": f"No sales returns for {sync_date}", "imported": 0}

    imported = 0
    errors   = []
    processed_bills: dict[str, int] = {}   # bill_no → invoice.id

    for row in rows:
        bill_no = str(row.get("BILL_NO") or "").strip()
        if not bill_no:
            continue

        rtn_no = f"RTN_{bill_no}"

        try:
            bill_date = row.get("BILL_DATE")
            ent_dt = row.get("ENT_DT") or row.get("ENTRY_DATE")
            if not bill_date:
                bill_date = ent_dt
            inv_date  = _to_date(bill_date, sync_date)
            inv_datetime = ent_dt if isinstance(ent_dt, datetime) else (bill_date if isinstance(bill_date, datetime) else None)

            async with db.begin_nested():
                # ── ensure header exists (delete items first, then header) ───────
                if bill_no not in processed_bills:
                    # find existing invoice id to cascade-delete items
                    existing_inv = (await db.execute(
                        select(inv_model).where(
                            inv_model.invoice_no == rtn_no,
                            inv_model.outlet_id  == s["id"],
                        )
                    )).scalar_one_or_none()
                    if existing_inv:
                        await db.execute(
                            delete(item_model).where(item_model.invoice_id == existing_inv.id)
                        )
                        await db.execute(
                            delete(inv_model).where(inv_model.id == existing_inv.id)
                        )
                    grand_total = _d(row.get("bill_total") or row.get("GRANDTOTAL") or 0)
                    inv = inv_model(
                        invoice_no       = rtn_no,
                        outlet_id        = s["id"],
                        customer_id      = 1,
                        invoice_type     = "return",
                        invoice_date     = inv_date,
                        invoice_datetime = inv_datetime,
                        is_interstate    = False,
                        subtotal         = grand_total,
                        discount         = Decimal("0"),
                        taxable_amount   = grand_total,
                        cgst_amount      = Decimal("0"),
                        sgst_amount      = Decimal("0"),
                        igst_amount      = Decimal("0"),
                        total_gst        = Decimal("0"),
                        cd_percent       = Decimal("0"),
                        cd_amount        = Decimal("0"),
                        total_amount     = grand_total,
                        paid_amount      = grand_total,
                        due_amount       = Decimal("0"),
                        status           = "paid",
                        payment_mode     = "cash",
                        created_by       = 1,
                    )
                    db.add(inv)
                    await db.flush()
                    processed_bills[bill_no] = inv.id
                else:
                    inv_id = processed_bills[bill_no]

                inv_id = processed_bills[bill_no]

                # ── item row ──────────────────────────────────────────────────
                prod_code = str(row.get("product_code") or "").strip()
                prod_res  = await db.execute(
                    text("SELECT id FROM products WHERE item_code = :code LIMIT 1"),
                    {"code": prod_code}
                )
                prod_row  = prod_res.fetchone()
                prod_id   = prod_row[0] if prod_row else 1

                qty      = _d(row.get("qty") or row.get("QTY") or 0)
                rate     = _d(row.get("rate") or row.get("RATE") or 0)
                tax_amt  = _d(row.get("tax_amount") or row.get("TAX_AMOUNT") or 0)
                total_i  = _d(row.get("net_sales") or row.get("NET_SALES") or qty * rate)

                db.add(item_model(
                    invoice_id   = inv_id,
                    product_id   = prod_id,
                    item_code    = prod_code,
                    name         = str(row.get("DESCRIPTION") or prod_code),
                    qty          = qty,
                    pcs          = Decimal("0"),
                    unit         = "PCS",
                    rate         = rate,
                    disc_val     = Decimal("0"),
                    disc_type    = "₹",
                    taxable_amt  = qty * rate,
                    gst_percent  = Decimal("0"),
                    cgst_percent = Decimal("0"),
                    sgst_percent = Decimal("0"),
                    igst_percent = Decimal("0"),
                    cgst_amount  = _half(tax_amt),
                    sgst_amount  = _half(tax_amt),
                    igst_amount  = Decimal("0"),
                    total        = total_i,
                    hsn_code     = "",
                ))
            imported += 1

        except Exception as e:
            errors.append({"bill_no": bill_no, "error": str(e)})

    await db.commit()
    await _log(db, s["id"], "sales_returns", "success", f"Synced {imported} return items | {len(errors)} errors", imported)
    await db.commit()

    return {
        "success"  : True,
        "sync_date": sync_date,
        "outlet"   : s["outlet_name"],
        "imported" : imported,
        "errors"   : errors,
        "message"  : f"Synced {imported} return items | {len(errors)} errors",
    }


# ── 3. Sync Purchase Summary ──────────────────────────────────────────────────

@router.post("/purchase-summary/{id}")
async def sync_purchase_summary(
    id: int,
    sync_date: str,
    db: AsyncSession = Depends(get_db),
):
    """Sync GRN headers from VW_TRANSFER_TO_HO_PURCHASES → unit_wise_purchases."""
    s = await _get_outlet(id, db)

    def _pull():
        # Pre-connection check (propagate exception on connection failure)
        _conn(s).close()

        # attempt 1: VW view
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("SELECT * FROM VW_TRANSFER_TO_HO_PURCHASES WHERE CAST(AUTH_DATE AS DATE) = %s", (sync_date,))
            rows = cur.fetchall(); conn.close(); return rows
        except Exception:
            try: conn.close()
            except Exception: pass
        return []  # no standard purchase header table found in this outlet

    try:
        rows = await asyncio.to_thread(_pull)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")

    if not rows:
        return {"success": True, "message": f"No purchase records for {sync_date}", "synced": 0}

    synced = 0
    errors = []

    for row in rows:
        grn_no = str(row.get("GRN_NO") or "").strip()
        if not grn_no:
            continue
        try:
            # resolve supplier by GSTIN
            supp_id = 1
            gstin = str(row.get("SUPPLIER_GSTIN") or "").strip()
            if gstin:
                s = (await db.execute(
                    text("SELECT id FROM suppliers WHERE gst_number = :g LIMIT 1"),
                    {"g": gstin}
                )).fetchone()
                if s:
                    supp_id = s[0]

            inv_date = _to_date(row.get("INVOICE_DATE"), sync_date)
            data = {
                "purchase_no" : grn_no,
                "outlet_id"   : s["id"],
                "supplier_id" : supp_id,
                "invoice_no"  : str(row.get("INVOICENO") or ""),
                "invoice_date": inv_date,
                "total_qty"   : float(_d(row.get("TOTALQTY"))),
                "total_amount": float(_d(row.get("GRANDTOTAL"))),
                "status"      : "received",
                "created_by"  : 1,
            }

            exists = (await db.execute(
                select(unit_wise_purchase).where(
                    unit_wise_purchase.purchase_no == grn_no,
                    unit_wise_purchase.outlet_id   == s["id"],
                )
            )).scalar_one_or_none()

            if exists:
                await db.execute(
                    update(unit_wise_purchase)
                    .where(unit_wise_purchase.id == exists.id)
                    .values(**data)
                )
            else:
                db.add(unit_wise_purchase(**data))

            synced += 1

        except Exception as e:
            errors.append({"grn_no": grn_no, "error": str(e)})

    await db.commit()
    await _log(db, s["id"], "purchase_summary", "success", f"Synced {synced} GRNs | {len(errors)} errors", synced)
    await db.commit()

    return {
        "success"  : True,
        "sync_date": sync_date,
        "outlet"   : s["outlet_name"],
        "synced"   : synced,
        "errors"   : errors,
        "message"  : f"Synced {synced} purchase summaries | {len(errors)} errors",
    }


# ── 4. Sync Purchase Items ────────────────────────────────────────────────────

@router.post("/purchase-items/{id}")
async def sync_purchase_items(
    id: int,
    sync_date: str,
    db: AsyncSession = Depends(get_db),
):
    """Sync GRN line items from VW_TRANSFER_TO_HO_PURCHASE_ITEMS → unit_wise_purchase_items."""
    s = await _get_outlet(id, db)

    def _pull():
        # Pre-connection check (propagate exception on connection failure)
        _conn(s).close()

        # attempt 1: VW view
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("SELECT * FROM VW_TRANSFER_TO_HO_PURCHASE_ITEMS WHERE CAST(AUTH_DATE AS DATE) = %s", (sync_date,))
            rows = cur.fetchall(); conn.close(); return rows
        except Exception:
            try: conn.close()
            except Exception: pass
        return []  # no standard purchase items table found in this outlet

    try:
        rows = await asyncio.to_thread(_pull)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")

    if not rows:
        return {"success": True, "message": f"No purchase items for {sync_date}", "synced": 0}

    synced   = 0
    skipped  = 0
    errors   = []
    cleared_grns: set[str] = set()

    for row in rows:
        grn_no    = str(row.get("GRN_NO") or "").strip()
        prod_code = str(row.get("product_code") or "").strip()
        if not grn_no or not prod_code:
            skipped += 1
            continue

        try:
            # find parent purchase
            purchase = (await db.execute(
                select(unit_wise_purchase).where(
                    unit_wise_purchase.purchase_no == grn_no,
                    unit_wise_purchase.outlet_id   == s["id"],
                )
            )).scalar_one_or_none()
            if not purchase:
                skipped += 1
                continue

            # resolve product
            prod_res = (await db.execute(
                text("SELECT id FROM products WHERE item_code = :c LIMIT 1"),
                {"c": prod_code}
            )).fetchone()
            prod_id = prod_res[0] if prod_res else 1

            # clear items for this GRN once
            if grn_no not in cleared_grns:
                await db.execute(
                    delete(unit_wise_purchase_item).where(
                        unit_wise_purchase_item.purchase_id == purchase.id
                    )
                )
                cleared_grns.add(grn_no)

            qty   = _d(_get(row, "QTY", "QUANTITY"))
            rate  = _d(_get(row, "RATE", "UNIT_RATE"))
            basic = qty * rate

            db.add(unit_wise_purchase_item(
                purchase_id      = purchase.id,
                product_id       = prod_id,
                qty              = qty,
                unit             = str(_get(row, "UNIT") or "PCS"),
                price            = rate,
                basic_amount     = basic,
                discount_percent = _d(_get(row, "DISC_PER", "DISC_PERCENT")),
                discount_amount  = _d(_get(row, "DISC_AMT", "DISCOUNT_AMOUNT")),
                taxable_amount   = _d(_get(row, "TAXABLE_VALUE", "TAXABLE_AMOUNT") or basic),
                gst_percent      = _d(_get(row, "TAX_PERCENT", "GST_PERCENT")),
                gst_amount       = _d(_get(row, "TAX_AMOUNT", "GST_AMOUNT")),
                total            = _d(_get(row, "NET_AMOUNT", "TOTAL", "GRAND_TOTAL")),
            ))
            synced += 1

        except Exception as e:
            errors.append({"grn_no": grn_no, "error": str(e)})

    await db.commit()
    await _log(db, s["id"], "purchase_items", "success", f"Synced {synced} items | {len(errors)} errors", synced)
    await db.commit()

    return {
        "success"  : True,
        "sync_date": sync_date,
        "outlet"   : s["outlet_name"],
        "synced"   : synced,
        "skipped"  : skipped,
        "errors"   : errors,
        "message"  : f"Synced {synced} items from {len(cleared_grns)} GRNs | {len(errors)} errors",
    }


# ── 5. Sync PRN Summary ───────────────────────────────────────────────────────

@router.post("/prn-summary/{id}")
async def sync_prn_summary(
    id: int,
    sync_date: str,
    db: AsyncSession = Depends(get_db),
):
    """Sync Purchase Return Notes header from VW_TRANSFER_TO_HO_PRN → unit_wise_purchase_returns."""
    s = await _get_outlet(id, db)

    def _pull():
        # Pre-connection check (propagate exception on connection failure)
        _conn(s).close()

        # attempt 1: VW view
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("SELECT * FROM VW_TRANSFER_TO_HO_PRN WHERE CAST(AUTH_DATE AS DATE) = %s", (sync_date,))
            rows = cur.fetchall(); conn.close(); return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # attempt 2: PRN_HDR direct
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    H.PRN_NO        AS PRN_NO,
                    H.PRN_DATE      AS AUTH_DATE,
                    H.SUPPLIERCODE  AS SUPPLIERCODE,
                    H.TOTALQTY      AS TOTALQTY,
                    H.GRANDTOTAL    AS GRANDTOTAL,
                    ''              AS REMARKS
                FROM PRN_HDR H
                WHERE CAST(H.PRN_DATE AS DATE) = %s
            """, (sync_date,))
            rows = cur.fetchall(); conn.close(); return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        return []

    try:
        rows = await asyncio.to_thread(_pull)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")

    if not rows:
        return {"success": True, "message": f"No PRN records for {sync_date}", "synced": 0}

    synced = 0
    errors = []

    for row in rows:
        prn_no = str(row.get("PRN_NO") or "").strip()
        if not prn_no:
            continue
        try:
            supp_id = 1
            gstin = str(row.get("SUPPLIER_GSTIN") or "").strip()
            if gstin:
                s = (await db.execute(
                    text("SELECT id FROM suppliers WHERE gst_number = :g LIMIT 1"),
                    {"g": gstin}
                )).fetchone()
                if s:
                    supp_id = s[0]

            ret_date = _to_date(row.get("AUTH_DATE"), sync_date)
            data = {
                "prn_no"      : prn_no,
                "outlet_id"   : s["id"],
                "supplier_id" : supp_id,
                "return_date" : ret_date,
                "total_qty"   : float(_d(row.get("TOTALQTY"))),
                "total_amount": float(_d(row.get("GRANDTOTAL"))),
                "reason"      : str(row.get("REMARKS") or "Sync Transfer"),
                "created_by"  : 1,
            }

            exists = (await db.execute(
                select(unit_wise_purchase_return).where(
                    unit_wise_purchase_return.prn_no    == prn_no,
                    unit_wise_purchase_return.outlet_id == s["id"],
                )
            )).scalar_one_or_none()

            if exists:
                await db.execute(
                    update(unit_wise_purchase_return)
                    .where(unit_wise_purchase_return.id == exists.id)
                    .values(**data)
                )
            else:
                db.add(unit_wise_purchase_return(**data))

            synced += 1

        except Exception as e:
            errors.append({"prn_no": prn_no, "error": str(e)})

    await db.commit()
    await _log(db, s["id"], "prn_summary", "success", f"Synced {synced} PRNs | {len(errors)} errors", synced)
    await db.commit()

    return {
        "success"  : True,
        "sync_date": sync_date,
        "outlet"   : s["outlet_name"],
        "synced"   : synced,
        "errors"   : errors,
        "message"  : f"Synced {synced} PRN summaries | {len(errors)} errors",
    }


# ── 6. Sync PRN Items ─────────────────────────────────────────────────────────

@router.post("/prn-items/{id}")
async def sync_prn_items(
    id: int,
    sync_date: str,
    db: AsyncSession = Depends(get_db),
):
    """Sync PRN line items from VW_TRANSFER_TO_HO_PRN_ITEMS → unit_wise_purchase_return_items."""
    s = await _get_outlet(id, db)

    def _pull():
        # Pre-connection check (propagate exception on connection failure)
        _conn(s).close()

        # attempt 1: VW view
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("SELECT * FROM VW_TRANSFER_TO_HO_PRN_ITEMS WHERE CAST(AUTH_DATE AS DATE) = %s", (sync_date,))
            rows = cur.fetchall(); conn.close(); return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # attempt 2: PRN_HDR + PRN_DTL direct
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    H.PRN_NO        AS PRN_NO,
                    H.PRN_DATE      AS AUTH_DATE,
                    D.ITEM_CODE     AS product_code,
                    D.RTN_QTY       AS qty,
                    D.BASIC_COST    AS price,
                    D.AMOUNT        AS basic_amount,
                    D.TAX_PERCENT   AS gst_percent,
                    D.TAX_AMOUNT    AS gst_amount,
                    D.AMOUNT        AS total
                FROM PRN_HDR H
                INNER JOIN PRN_DTL D ON H.PRN_NO = D.PRN_NO
                WHERE CAST(H.PRN_DATE AS DATE) = %s
            """, (sync_date,))
            rows = cur.fetchall(); conn.close(); return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        return []

    try:
        rows = await asyncio.to_thread(_pull)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")

    if not rows:
        return {"success": True, "message": f"No PRN items for {sync_date}", "synced": 0}

    synced   = 0
    skipped  = 0
    errors   = []
    cleared_prns: set[str] = set()

    for row in rows:
        prn_no    = str(row.get("PRN_NO") or "").strip()
        prod_code = str(row.get("product_code") or "").strip()
        if not prn_no or not prod_code:
            skipped += 1
            continue

        try:
            prn = (await db.execute(
                select(unit_wise_purchase_return).where(
                    unit_wise_purchase_return.prn_no    == prn_no,
                    unit_wise_purchase_return.outlet_id == s["id"],
                )
            )).scalar_one_or_none()
            if not prn:
                skipped += 1
                continue

            prod_res = (await db.execute(
                text("SELECT id FROM products WHERE item_code = :c LIMIT 1"),
                {"c": prod_code}
            )).fetchone()
            prod_id = prod_res[0] if prod_res else 1

            if prn_no not in cleared_prns:
                await db.execute(
                    delete(unit_wise_purchase_return_item).where(
                        unit_wise_purchase_return_item.prn_id == prn.id
                    )
                )
                cleared_prns.add(prn_no)

            qty  = _d(row.get("QTY"))
            rate = _d(row.get("RATE"))

            db.add(unit_wise_purchase_return_item(
                prn_id       = prn.id,
                product_id   = prod_id,
                qty          = qty,
                unit         = str(row.get("UNIT") or "PCS"),
                price        = rate,
                basic_amount = qty * rate,
                gst_percent  = _d(row.get("TAX_PERCENT")),
                gst_amount   = _d(row.get("TAX_AMOUNT")),
                total        = _d(row.get("NET_AMOUNT")),
            ))
            synced += 1

        except Exception as e:
            errors.append({"prn_no": prn_no, "error": str(e)})

    await db.commit()
    await _log(db, s["id"], "prn_items", "success", f"Synced {synced} PRN items | {len(errors)} errors", synced)
    await db.commit()

    return {
        "success"  : True,
        "sync_date": sync_date,
        "outlet"   : s["outlet_name"],
        "synced"   : synced,
        "skipped"  : skipped,
        "errors"   : errors,
        "message"  : f"Synced {synced} PRN items from {len(cleared_prns)} returns | {len(errors)} errors",
    }


# ── 7. Sync Stock Transfer (IN or OUT) ────────────────────────────────────────

@router.post("/stock-transfer/{id}")
async def sync_stock_transfer(
    id: int,
    sync_date: str,
    type: str = "out",          # query param: "in" or "out"
    db: AsyncSession = Depends(get_db),
):
    """
    Sync stock transfers from VW_TRANSFER_TO_HO_STK_OUT (or IN) →
    unit_wise_stock_transfers + items + outlet_stock adjustment.
    """
    s = await _get_outlet(id, db)
    view = "VW_TRANSFER_TO_HO_STK_OUT" if type.lower() in ("out", "transfer_out") else "VW_TRANSFER_TO_HO_STK_IN"
    # MTN_TYPE filter: OUT transfers from this outlet = type IN/OUT in MTN
    mtn_type_filter = "OUT" if type.lower() in ("out", "transfer_out") else "IN"

    def _pull():
        # Pre-connection check (propagate exception on connection failure)
        _conn(s).close()

        # attempt 1: VW view
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute(f"SELECT * FROM {view} WHERE CAST(AUTH_DATE AS DATE) = %s", (sync_date,))
            rows = cur.fetchall(); conn.close(); return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # attempt 2: MTN_HDR + MTN_DTL direct
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    H.MTN_NO            AS MTN_NO,
                    H.MTN_DATE          AS MTN_DATE,
                    H.AUTH_DATE         AS AUTH_DATE,
                    H.FROM_LOCATION     AS from_unit_code,
                    H.TO_LOCATION       AS to_unit_code,
                    H.REMARKS           AS REMARKS,
                    D.ITEM_CODE         AS product_code,
                    D.QTY               AS QTY,
                    D.CP                AS CP,
                    D.MRP               AS MRP
                FROM MTN_HDR H
                INNER JOIN MTN_DTL D ON H.MTN_NO = D.MTN_NO
                WHERE H.MTN_TYPE = %s
                  AND CAST(H.MTN_DATE AS DATE) = %s
            """, (mtn_type_filter, sync_date))
            rows = cur.fetchall(); conn.close(); return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        return []

    try:
        rows = await asyncio.to_thread(_pull)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")

    if not rows:
        return {"success": True, "message": f"No {type} transfers for {sync_date}", "synced": 0}

    synced   = 0
    skipped  = 0
    errors   = []
    processed_mtns: dict[str, int] = {}   # mtn_no → transfer.id

    for row in rows:
        mtn_no    = str(row.get("MTN_NO") or "").strip()
        prod_code = str(row.get("product_code") or "").strip()
        if not mtn_no or not prod_code:
            skipped += 1
            continue

        try:
            # resolve product (use id=1 if not in HO products yet)
            prod_res = (await db.execute(
                text("SELECT id FROM products WHERE item_code = :c LIMIT 1"),
                {"c": prod_code}
            )).fetchone()
            prod_id = prod_res[0] if prod_res else 1

            # resolve from/to outlet by grp_code
            from_code = str(row.get("from_unit_code") or "").strip()
            to_code   = str(row.get("to_unit_code") or "").strip()

            from_res = (await db.execute(
                text("SELECT id FROM outlets WHERE grp_code = :c LIMIT 1"),
                {"c": from_code}
            )).fetchone()
            to_res = (await db.execute(
                text("SELECT id FROM outlets WHERE grp_code = :c LIMIT 1"),
                {"c": to_code}
            )).fetchone()
            from_id = from_res[0] if from_res else 1
            to_id   = to_res[0]   if to_res   else 1

            async with db.begin_nested():
                # create transfer header once per MTN_NO
                if mtn_no not in processed_mtns:
                    await db.execute(
                        delete(unit_wise_stock_transfer).where(
                            unit_wise_stock_transfer.transfer_no == mtn_no
                        )
                    )
                    mtn_date = _to_date(row.get("MTN_DATE") or row.get("AUTH_DATE"), sync_date)
                    tr = unit_wise_stock_transfer(
                        transfer_no    = mtn_no,
                        from_outlet_id = from_id,
                        to_outlet_id   = to_id,
                        transfer_date  = mtn_date,
                        type           = type.upper().replace("TRANSFER_", ""),
                        status         = "completed",
                        remarks        = str(row.get("REMARKS") or ""),
                        created_by     = 1,
                    )
                    db.add(tr)
                    await db.flush()
                    processed_mtns[mtn_no] = tr.id

                transfer_id = processed_mtns[mtn_no]
                qty         = float(_d(row.get("QTY")))
                cp          = _d(row.get("CP"))
                mrp         = _d(row.get("MRP"))

                db.add(unit_wise_stock_transfer_item(
                    transfer_id = transfer_id,
                    product_id  = prod_id,
                    qty         = _d(qty),
                    unit        = "PCS",
                    cost_price  = cp,
                    mrp         = mrp,
                    total_val   = _d(qty) * cp,
                ))

                # ── outlet_stock adjustment ───────────────────────────────────
                # decrement from_outlet
                from_stock = (await db.execute(
                    select(outlet_stock).where(
                        outlet_stock.outlet_id  == from_id,
                        outlet_stock.product_id == prod_id,
                    )
                )).scalar_one_or_none()
                if from_stock:
                    from_stock.current_stock = max(Decimal("0"), from_stock.current_stock - _d(qty))
                    from_stock.last_sync = datetime.now()

                # upsert to_outlet
                to_stock = (await db.execute(
                    select(outlet_stock).where(
                        outlet_stock.outlet_id  == to_id,
                        outlet_stock.product_id == prod_id,
                    )
                )).scalar_one_or_none()
                if to_stock:
                    to_stock.current_stock = to_stock.current_stock + _d(qty)
                    to_stock.last_sync = datetime.now()
                else:
                    db.add(outlet_stock(
                        outlet_id     = to_id,
                        product_id    = prod_id,
                        current_stock = _d(qty),
                        last_sync     = datetime.now(),
                    ))

            synced += 1

        except Exception as e:
            errors.append({"mtn_no": mtn_no, "error": str(e)})

    await db.commit()
    await _log(db, s["id"], f"stock_transfer_{type}", "success", f"Synced {synced} | {len(errors)} errors", synced)
    await db.commit()

    return {
        "success"  : True,
        "sync_date": sync_date,
        "outlet"   : s["outlet_name"],
        "type"     : type,
        "synced"   : synced,
        "skipped"  : skipped,
        "errors"   : errors,
        "message"  : f"Synced {synced} stock transfer ({type}) | {len(errors)} errors",
    }


# ── 8. Sync Bill Payments (Media Reports) ────────────────────────────────────

@router.post("/payments/{id}")
async def sync_payments(
    id: int,
    sync_date: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Sync payment modes from SQL Server → unit_wise_payments + bill_wise_sales_summary + media_reports.
    Uses VW_TRANSFER_TO_HO_PAYMENTS view; falls back to SALES_PAYMENT_DTL + PAYMENT_MODE if view missing.
    """
    s = await _get_outlet(id, db)

    def _pull_payments():
        # Pre-connection check (propagate exception on connection failure)
        _conn(s).close()

        rows = []

        # ── attempt 1: dedicated view ─────────────────────────────────────
        try:
            conn = _conn(s)
            cur  = conn.cursor(as_dict=True)
            cur.execute(
                "SELECT * FROM VW_TRANSFER_TO_HO_PAYMENTS WHERE CAST(BILL_DATE AS DATE) = %s",
                (sync_date,)
            )
            rows = cur.fetchall()
            conn.close()
            return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # ── attempt 2: direct join SALES_PAYMENT_DTL + PAYMENT_MODE ──────
        try:
            conn = _conn(s)
            cur  = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    SH.BILL_NO            AS bill_no,
                    SH.BILL_DATE          AS paid_at,
                    SPD.PAY_AMOUNT        AS amount,
                    PM.PAYMODE            AS payment_mode,
                    SH.POSID              AS posid,
                    SH.SHIFT_ID           AS shift_id,
                    SH.CUSTOMER           AS customer,
                    SH.RoundOffBillAmount AS roundoff
                FROM SALES_HDR SH
                INNER JOIN SALES_PAYMENT_DTL SPD ON SH.BILL_NO = SPD.BILL_NO
                INNER JOIN PAYMENT_MODE PM       ON SPD.PAY_CODE = PM.PAYCODE
                WHERE CAST(SH.BILL_DATE AS DATE) = %s
                  AND SH.ISCANCELLED = 0
            """, (sync_date,))
            rows = cur.fetchall()
            conn.close()
            return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # ── attempt 3: SALES_HDR only — treat GRAND_TOTAL as CASH ────────
        try:
            conn = _conn(s)
            cur  = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    SH.BILL_NO            AS bill_no,
                    SH.BILL_DATE          AS paid_at,
                    SH.GRAND_TOTAL        AS amount,
                    'CASH'                AS payment_mode,
                    SH.POSID              AS posid,
                    SH.SHIFT_ID           AS shift_id,
                    SH.CUSTOMER           AS customer,
                    SH.RoundOffBillAmount AS roundoff
                FROM SALES_HDR SH
                WHERE CAST(SH.BILL_DATE AS DATE) = %s
                  AND SH.ISCANCELLED = 0
            """, (sync_date,))
            rows = cur.fetchall()
            conn.close()
            return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        return rows

    try:
        payment_rows = await asyncio.to_thread(_pull_payments)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")

    if not payment_rows:
        return {"success": True, "message": f"No payments found for {sync_date}", "synced": 0}

    # Pre-compute per-bill totals so auto-created stub invoices get correct total_amount
    _bill_totals: dict[str, Decimal] = {}
    _bill_dates:  dict[str, object]  = {}
    for _r in payment_rows:
        _bn = str(_r.get("bill_no") or _r.get("BILL_NO", "")).strip()
        if _bn:
            _bill_totals[_bn] = _bill_totals.get(_bn, Decimal("0")) + _d(_r.get("amount") or _r.get("PAY_AMOUNT") or 0)
            if _bn not in _bill_dates:
                _bill_dates[_bn] = _r.get("paid_at") or _r.get("BILL_DATE")

    synced        = 0
    skipped       = 0
    auto_created  = 0
    errors        = []
    processed_bills: set[str]          = set()
    stub_cache:     dict[str, object]  = {}   # bill_no → newly created stub invoice

    for row in payment_rows:
        bill_no = str(row.get("bill_no") or row.get("BILL_NO", "")).strip()
        if not bill_no:
            continue

        inv_res = await db.execute(
            select(inv_model).where(
                inv_model.invoice_no == bill_no,
                inv_model.outlet_id  == s["id"],
            )
        )
        inv = inv_res.scalar_one_or_none()

        # ── Auto-create stub invoice when sales sync hasn't run yet ──────────
        if not inv:
            if bill_no in stub_cache:
                inv = stub_cache[bill_no]          # reuse stub created this run
            else:
                _paid_at   = _bill_dates.get(bill_no)
                _inv_date  = _to_date(_paid_at, sync_date)
                _total_amt = _bill_totals.get(bill_no, Decimal("0"))
                inv = inv_model(
                    invoice_no   = bill_no,
                    outlet_id    = s["id"],
                    customer_id  = 1,
                    invoice_date = _inv_date,
                    total_amount = _total_amt,
                    paid_amount  = _total_amt,
                    due_amount   = Decimal("0"),
                    status       = "paid",
                    invoice_type = "retail",
                    created_by   = 1,
                    notes        = "Auto-stub — created by payment sync (sales not yet synced)",
                )
                db.add(inv)
                await db.flush()           # assigns inv.id
                stub_cache[bill_no] = inv
                auto_created += 1

        try:
            if bill_no not in processed_bills:
                await db.execute(
                    delete(pay_model).where(
                        pay_model.invoice_id == inv.id,
                        pay_model.notes      == "POS Sync",
                    )
                )
                processed_bills.add(bill_no)

            amount   = _d(row.get("amount") or row.get("PAY_AMOUNT") or 0)
            paymode  = str(row.get("payment_mode") or row.get("PAYMODE") or "cash").lower()
            paid_at  = row.get("paid_at") or row.get("BILL_DATE")
            pay_date = _to_date(paid_at, sync_date)
            pay_no   = f"SYNC-{sync_date.replace('-','')}-{bill_no}"

            db.add(pay_model(
                payment_no   = pay_no,
                outlet_id    = s["id"],
                customer_id  = inv.customer_id,
                invoice_id   = inv.id,
                amount       = amount,
                payment_date = pay_date,
                payment_mode = paymode,
                notes        = "POS Sync",
                created_by   = 1,
            ))

            inv.paid_amount  = inv.total_amount
            inv.due_amount   = Decimal("0")
            inv.status       = "paid"
            inv.payment_mode = paymode
            synced += 1

        except Exception as e:
            errors.append({"bill_no": bill_no, "error": str(e)})

    await db.flush()

    # ── bill_wise_sales_summary ───────────────────────────────────────────────
    _sd = date_type.fromisoformat(sync_date) if isinstance(sync_date, str) else sync_date
    await db.execute(text(
        "DELETE FROM bill_wise_sales_summary WHERE outlet_id = :oid AND bill_date = :dt"
    ), {"oid": s["id"], "dt": _sd})

    for row in payment_rows:
        bill_no   = str(row.get("bill_no") or row.get("BILL_NO", "")).strip()
        paid_at   = row.get("paid_at") or row.get("BILL_DATE")
        bill_date = _to_date(paid_at, sync_date)
        await db.execute(text("""
            INSERT INTO bill_wise_sales_summary
                (outlet_id, bill_no, bill_date, type, refund_against_bill, customer,
                 pay_amount, paymode, roundoff_amount, posid, shift_id, ip_address)
            VALUES
                (:oid, :bill_no, :bill_date, 'S', '0', :customer,
                 :pay_amount, :paymode, :roundoff, :posid, :shift_id, 'Sync')
        """), {
            "oid"       : s["id"],
            "bill_no"   : bill_no,
            "bill_date" : bill_date,
            "customer"  : str(row.get("customer") or row.get("CUSTOMER") or ""),
            "pay_amount": float(_d(row.get("amount") or row.get("PAY_AMOUNT") or 0)),
            "paymode"   : str(row.get("payment_mode") or row.get("PAYMODE") or "cash"),
            "roundoff"  : float(_d(row.get("roundoff") or row.get("RoundOffBillAmount") or 0)),
            "posid"     : str(row.get("posid") or row.get("POSID") or ""),
            "shift_id"  : str(row.get("shift_id") or row.get("SHIFT_ID") or ""),
        })

    # ── media_reports ─────────────────────────────────────────────────────────
    await db.execute(text(
        "DELETE FROM media_reports WHERE outlet_id = :oid AND report_date = :dt"
    ), {"oid": s["id"], "dt": _sd})

    await db.execute(text("""
        INSERT INTO media_reports (outlet_id, report_date, report_type, total_amount, record_count, raw_data)
        SELECT
            outlet_id,
            bill_date        AS report_date,
            paymode          AS report_type,
            SUM(pay_amount)  AS total_amount,
            COUNT(*)         AS record_count,
            'Sync'           AS raw_data
        FROM bill_wise_sales_summary
        WHERE outlet_id = :oid AND bill_date = :dt
        GROUP BY outlet_id, bill_date, paymode
    """), {"oid": s["id"], "dt": _sd})

    await db.commit()
    await _log(db, s["id"], "payments", "success",
               f"Synced {synced} payments | Stubs {auto_created} | Skipped {skipped} | Errors {len(errors)}", synced)
    await db.commit()

    return {
        "success"      : True,
        "sync_date"    : sync_date,
        "outlet"       : s["outlet_name"],
        "synced"       : synced,
        "auto_created" : auto_created,
        "skipped"      : skipped,
        "errors"       : errors,
        "message"      : f"Synced {synced} payments | Auto-stubs {auto_created} | Skipped {skipped} | Errors {len(errors)}",
    }


# ── 9. Sync Bill Summary ──────────────────────────────────────────────────────

@router.post("/bill-summary/{id}")
async def sync_bill_summary(
    id: int,
    sync_date: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Full bill summary sync (sales + returns with payment modes) →
    bill_wise_sales_summary + media_reports. Uses complex SQL from CI3 Sync_model.
    Falls back to simple SALES_HDR join if view unavailable.
    """
    s = await _get_outlet(id, db)

    def _pull():
        # Pre-connection check (propagate exception on connection failure)
        _conn(s).close()

        rows = []

        # ── attempt 1: dedicated view ─────────────────────────────────────
        try:
            conn = _conn(s)
            cur  = conn.cursor(as_dict=True)
            cur.execute(
                "SELECT * FROM VW_TRANSFER_TO_HO_BILL_SUMMARY WHERE CAST(BILL_DATE AS DATE) = %s",
                (sync_date,)
            )
            rows = cur.fetchall()
            conn.close()
            return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # ── attempt 2: inline subquery (no DECLARE — pymssql limitation) ─
        try:
            conn = _conn(s)
            cur  = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    (SELECT TOP 1 GRP_CODE FROM sysfile) + '-'
                        + CAST(SH.BILL_NO AS VARCHAR(100)) AS bill_no,
                    SH.BILL_DATE          AS bill_date,
                    'S'                   AS type,
                    '0'                   AS refund_against_bill,
                    SH.CUSTOMER           AS customer,
                    SPD.PAY_AMOUNT        AS pay_amount,
                    PM.PAYMODE            AS paymode,
                    SH.RoundOffBillAmount AS roundoff_amount,
                    SH.POSID              AS posid,
                    SH.SHIFT_ID           AS shift_id
                FROM SALES_HDR SH
                INNER JOIN SALES_PAYMENT_DTL SPD ON SH.BILL_NO = SPD.BILL_NO
                INNER JOIN PAYMENT_MODE PM       ON SPD.PAY_CODE = PM.PAYCODE
                WHERE SH.ISCANCELLED = 0
                  AND CAST(SH.BILL_DATE AS DATE) = %s
            """, (sync_date,))
            rows = cur.fetchall()
            conn.close()
            return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # ── attempt 3: SALES_HDR only (no payment tables) ────────────────
        try:
            conn = _conn(s)
            cur  = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    CAST(SH.BILL_NO AS VARCHAR(100)) AS bill_no,
                    SH.BILL_DATE          AS bill_date,
                    'S'                   AS type,
                    '0'                   AS refund_against_bill,
                    SH.CUSTOMER           AS customer,
                    SH.GRAND_TOTAL        AS pay_amount,
                    'CASH'                AS paymode,
                    SH.RoundOffBillAmount AS roundoff_amount,
                    SH.POSID              AS posid,
                    SH.SHIFT_ID           AS shift_id
                FROM SALES_HDR SH
                WHERE SH.ISCANCELLED = 0
                  AND CAST(SH.BILL_DATE AS DATE) = %s
            """, (sync_date,))
            rows = cur.fetchall()
            conn.close()
            return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        return rows

    try:
        rows = await asyncio.to_thread(_pull)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")

    if not rows:
        return {"success": True, "message": f"No bill summary for {sync_date}", "synced": 0}

    # clear old data for this outlet + date
    _sd = date_type.fromisoformat(sync_date) if isinstance(sync_date, str) else sync_date
    await db.execute(text(
        "DELETE FROM bill_wise_sales_summary WHERE outlet_id = :oid AND bill_date = :dt"
    ), {"oid": s["id"], "dt": _sd})

    synced = 0
    for row in rows:
        bill_no   = str(row.get("bill_no") or row.get("BILL_NO") or "").strip()
        paid_at   = row.get("bill_date") or row.get("BILL_DATE")
        bill_date = _to_date(paid_at, sync_date)
        await db.execute(text("""
            INSERT INTO bill_wise_sales_summary
                (outlet_id, bill_no, bill_date, type, refund_against_bill, customer,
                 pay_amount, paymode, roundoff_amount, posid, shift_id, ip_address)
            VALUES
                (:oid, :bill_no, :bill_date, :type, :refund, :customer,
                 :pay_amount, :paymode, :roundoff, :posid, :shift_id, 'BillSync')
        """), {
            "oid"      : s["id"],
            "bill_no"  : bill_no,
            "bill_date": bill_date,
            "type"     : str(row.get("type") or "S"),
            "refund"   : str(row.get("refund_against_bill") or "0"),
            "customer" : str(row.get("customer") or ""),
            "pay_amount": float(_d(row.get("pay_amount") or row.get("PAY_AMOUNT") or 0)),
            "paymode"  : str(row.get("paymode") or row.get("PAYMODE") or "cash"),
            "roundoff" : float(_d(row.get("roundoff_amount") or row.get("RoundOffBillAmount") or 0)),
            "posid"    : str(row.get("posid") or row.get("POSID") or ""),
            "shift_id" : str(row.get("shift_id") or row.get("SHIFT_ID") or ""),
        })
        synced += 1

    # refresh media_reports
    await db.execute(text(
        "DELETE FROM media_reports WHERE outlet_id = :oid AND report_date = :dt"
    ), {"oid": s["id"], "dt": _sd})

    await db.execute(text("""
        INSERT INTO media_reports (outlet_id, report_date, report_type, total_amount, record_count, raw_data)
        SELECT outlet_id, bill_date, paymode,
               SUM(pay_amount), COUNT(*), 'BillSync'
        FROM bill_wise_sales_summary
        WHERE outlet_id = :oid AND bill_date = :dt
        GROUP BY outlet_id, bill_date, paymode
    """), {"oid": s["id"], "dt": _sd})

    await db.commit()
    await _log(db, s["id"], "bill_summary", "success", f"Synced {synced} bill summary rows", synced)
    await db.commit()

    return {
        "success"  : True,
        "sync_date": sync_date,
        "outlet"   : s["outlet_name"],
        "synced"   : synced,
        "message"  : f"Synced {synced} bill summary rows",
    }


# ── 10. Refresh Store Stock (QOH) ─────────────────────────────────────────────

@router.post("/stock/{id}")
async def sync_stock(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Refresh outlet_stock (QOH) from VW_TRANSFER_TO_HO_STOCK.
    No date filter — pulls current stock snapshot from the outlet.
    """
    s = await _get_outlet(id, db)

    def _pull():
        # Pre-connection check (propagate exception on connection failure)
        _conn(s).close()

        # attempt 1: items_dept (User confirmed priority)
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    ITEM_CODE   AS product_code,
                    QOH         AS qty
                FROM items_dept
                WHERE QOH <> 0
            """)
            rows = cur.fetchall(); conn.close()
            if rows: return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # attempt 2: VW view
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("SELECT * FROM VW_TRANSFER_TO_HO_STOCK")
            rows = cur.fetchall(); conn.close()
            if rows: return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # attempt 3: ITEM_STOCK_LOC_WISE direct
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    ITEM_CODE   AS product_code,
                    STOCK_QTY   AS qty
                FROM ITEM_STOCK_LOC_WISE
                WHERE STOCK_QTY <> 0
            """)
            rows = cur.fetchall(); conn.close()
            if rows: return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        # attempt 4: unit_wise_stock direct
        try:
            conn = _conn(s); cur = conn.cursor(as_dict=True)
            cur.execute("""
                SELECT
                    CODE   AS product_code,
                    QOH    AS qty
                FROM unit_wise_stock
                WHERE QOH <> 0
            """)
            rows = cur.fetchall(); conn.close()
            if rows: return rows
        except Exception:
            try: conn.close()
            except Exception: pass

        return []

    try:
        rows = await asyncio.to_thread(_pull)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")

    if not rows:
        return {"success": True, "message": "No stock data returned from outlet", "synced": 0}

    synced  = 0
    skipped = 0

    for row in rows:
        prod_code = str(row.get("product_code") or "").strip()
        if not prod_code:
            skipped += 1
            continue

        # use item_code as prod_id marker; insert with prod_id=0 if not in HO yet
        prod_res = (await db.execute(
            text("SELECT id FROM products WHERE item_code = :c LIMIT 1"),
            {"c": prod_code}
        )).fetchone()
        prod_id = prod_res[0] if prod_res else None
        if prod_id is None:
            skipped += 1
            continue

        qty = _d(row.get("qty") or row.get("QTY") or 0)

        # Update/Insert outlet_stock (Historical/Summary tracking)
        existing = (await db.execute(
            select(outlet_stock).where(
                outlet_stock.outlet_id  == s["id"],
                outlet_stock.product_id == prod_id,
            )
        )).scalar_one_or_none()

        if existing:
            existing.stock_qty = qty
            existing.updated_at = datetime.now()
        else:
            db.add(outlet_stock(
                outlet_id     = s["id"],
                product_id    = prod_id,
                stock_qty     = qty,
                updated_at    = datetime.now(),
            ))

        # ── CRITICAL: Also update outlet_pricing.stock_qty for the live Sidebar ──
        from app.models.product import outlet_pricing
        pricing_row = (await db.execute(
            select(outlet_pricing).where(
                outlet_pricing.outlet_id == s["id"],
                outlet_pricing.product_id == prod_id
            )
        )).scalar_one_or_none()

        if pricing_row:
            pricing_row.stock_qty = qty
            pricing_row.updated_at = datetime.now()
        else:
            db.add(outlet_pricing(
                outlet_id=s["id"],
                product_id=prod_id,
                stock_qty=qty,
                is_active=True,
                updated_at=datetime.now()
            ))

        synced += 1

    await db.commit()
    await _log(db, s["id"], "stock", "success", f"Refreshed stock for {synced} products", synced)
    await db.commit()

    return {
        "success" : True,
        "outlet"  : s["outlet_name"],
        "synced"  : synced,
        "skipped" : skipped,
        "message" : f"Refreshed stock for {synced} products | {skipped} skipped (not in HO)",
    }


# ── 11. Complete Data Sync (all in sequence) ──────────────────────────────────

@router.post("/complete/{id}")
async def complete_sync(
    id: int,
    sync_date: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Run ALL sync steps in order for the given date:
    1. Sales + items  2. Sales Returns  3. Payment Modes
    4. Bill Summary   5. Purchase Summary  6. Purchase Items
    7. PRN Summary    8. PRN Items  9. Stock Transfer OUT
    10. Stock Transfer IN  11. Refresh QOH
    """
    s = await _get_outlet(id, db)
    results = {}

    async def _run(name: str, coro):
        try:
            res = await coro
            results[name] = {"success": True, "message": res.get("message", "ok")}
        except Exception as e:
            results[name] = {"success": False, "error": str(e)}

    await _run("sales",            run_sync(id, sync_date, db))
    await _run("sales_returns",    sync_sales_returns(id, sync_date, db))
    await _run("payments",         sync_payments(id, sync_date, db))
    await _run("bill_summary",     sync_bill_summary(id, sync_date, db))
    await _run("purchase_summary", sync_purchase_summary(id, sync_date, db))
    await _run("purchase_items",   sync_purchase_items(id, sync_date, db))
    await _run("prn_summary",      sync_prn_summary(id, sync_date, db))
    await _run("prn_items",        sync_prn_items(id, sync_date, db))
    await _run("stock_out",        sync_stock_transfer(id, sync_date, "out", db))
    await _run("stock_in",         sync_stock_transfer(id, sync_date, "in", db))
    await _run("stock_qoh",        sync_stock(id, db))

    all_ok = all(v["success"] for v in results.values())
    return {
        "success"  : all_ok,
        "sync_date": sync_date,
        "outlet"   : s["outlet_name"],
        "steps"    : results,
        "message"  : "Complete sync finished" if all_ok else "Complete sync finished with some errors",
    }


@router.get("/monitor")
async def get_sync_monitor(db: AsyncSession = Depends(get_db)):
    """Returns a list of all outlets with their connection status and latest sync timestamps."""
    outlets_res = await db.execute(select(outlet))
    all_outlets = outlets_res.scalars().all()
    
    result = []
    for s in all_outlets:
        # Get latest success log for this outlet
        log_res = await db.execute(
            select(sync_log)
            .where(sync_log.outlet_id == s.id, sync_log.status == "success")
            .order_by(sync_log.id.desc())
            .limit(5) # Get last 5 to check different types
        )
        recent_logs = log_res.scalars().all()
        
        last_syncs = {}
        for l in recent_logs:
            if l.sync_type not in last_syncs:
                last_syncs[l.sync_type] = l.created_at.isoformat() if l.created_at else None
        
        result.append({
            "id": s.id,
            "unit_code": s.unit_code,
            "outlet_name": s.outlet_name,
            "is_connected": s.is_connected,
            "last_connected_at": s.last_connected_at.isoformat() if s.last_connected_at else None,
            "last_syncs": last_syncs,
            "city": s.city,
            "grp_code": s.grp_code
        })
        
    return result

# ── 12. Sync Logs ─────────────────────────────────────────────────────────────

@router.get("/logs/{id}")
async def get_sync_logs(id: int, limit: int = 20, db: AsyncSession = Depends(get_db)):
    """Return last N sync log entries for an outlet."""
    res = await db.execute(
        select(sync_log)
        .where(sync_log.outlet_id == id)
        .order_by(sync_log.id.desc())
        .limit(limit)
    )
    logs = res.scalars().all()
    return [
        {
            "id"            : l.id,
            "sync_type"     : l.sync_type,
            "status"        : l.status,
            "message"       : l.message,
            "records_synced": l.records_synced,
            "created_at"    : l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


@router.post("/tax-breakup/{id}")
async def sync_tax_breakup(id: int, sync_date: str = Query(None), from_date: str = Query(None), to_date: str = Query(None), db: AsyncSession = Depends(get_db)):
    """Fast sync for Tax Breakup only. Supports date range."""
    from app.models.tax_summary import unit_wise_tax_summary
    s = await _get_outlet(id, db)
    
    fd = from_date or sync_date
    td = to_date or sync_date
    
    def _pull_tax():
        _conn(s).close()
        conn = _conn(s)
        cur = conn.cursor(as_dict=True)
        # Verify columns first to prevent crashing on older POS
        cur.execute("SELECT TOP 1 * FROM SALES_DTL")
        cols = [d[0].upper() for d in cur.description]
        cess_col = "CESS_AMOUNT" if "CESS_AMOUNT" in cols else "0"
        
        tax_val_col = "TAXABLE_VALUE"
        if "TAXABLE_VALUE" not in cols:
            if "TAXABLE_AMT" in cols: tax_val_col = "TAXABLE_AMT"
            elif "TAXABLE_AMOUNT" in cols: tax_val_col = "TAXABLE_AMOUNT"
            elif "AMOUNT" in cols: tax_val_col = "AMOUNT"
            else: tax_val_col = "(QTY * RATE)" # fallback
            
        tax_pct_col = "TAX_PERCENT"
        if "TAX_PERCENT" not in cols:
            if "GST_PERCENT" in cols: tax_pct_col = "GST_PERCENT"
            elif "TAX_PER" in cols: tax_pct_col = "TAX_PER"
            elif "GST_PER" in cols: tax_pct_col = "GST_PER"
            else: tax_pct_col = "0"
            
        tax_amt_col = "TAX_AMOUNT"
        if "TAX_AMOUNT" not in cols:
            if "GST_AMOUNT" in cols: tax_amt_col = "GST_AMOUNT"
            elif "TAX_AMT" in cols: tax_amt_col = "TAX_AMT"
            elif "GST_AMT" in cols: tax_amt_col = "GST_AMT"
            else: tax_amt_col = "0"
        
        # Attempt to use the user's standard view first (VWGST_TAX_DETAIL_ON_BILL)
        try:
            cur.execute("""
                SELECT 
                    CAST(BILL_DATE AS DATE) as summary_date,
                    SUM(ISNULL(CGST_TAXABLE_SALES, 0) + ISNULL(IGST_TAXABLE_SALES, 0) + ISNULL(TAX_AMOUNT, 0) + ISNULL(EXEMPTED, 0) + ISNULL(CESS_AMOUNT, 0) + ISNULL(SD_SPL_CESS_AMT, 0)) as sales_value,
                    SUM(ISNULL(CGST_TAXABLE_SALES, 0) + ISNULL(IGST_TAXABLE_SALES, 0) + ISNULL(EXEMPTED, 0)) as basic_value,
                    SUM(ISNULL(EXEMPTED, 0)) as gst_0,
                    SUM(CASE WHEN TAX_PERCENT = 5 THEN (ISNULL(CGST_TAXABLE_SALES, 0) + ISNULL(IGST_TAXABLE_SALES, 0)) ELSE 0 END) as taxable_5,
                    SUM(CASE WHEN TAX_PERCENT = 5 THEN ISNULL(TAX_AMOUNT, 0) ELSE 0 END) as gst_5,
                    SUM(CASE WHEN TAX_PERCENT = 12 THEN (ISNULL(CGST_TAXABLE_SALES, 0) + ISNULL(IGST_TAXABLE_SALES, 0)) ELSE 0 END) as taxable_12,
                    SUM(CASE WHEN TAX_PERCENT = 12 THEN ISNULL(TAX_AMOUNT, 0) ELSE 0 END) as gst_12,
                    SUM(CASE WHEN TAX_PERCENT = 18 THEN (ISNULL(CGST_TAXABLE_SALES, 0) + ISNULL(IGST_TAXABLE_SALES, 0)) ELSE 0 END) as taxable_18,
                    SUM(CASE WHEN TAX_PERCENT = 18 THEN ISNULL(TAX_AMOUNT, 0) ELSE 0 END) as gst_18,
                    SUM(CASE WHEN TAX_PERCENT = 28 THEN (ISNULL(CGST_TAXABLE_SALES, 0) + ISNULL(IGST_TAXABLE_SALES, 0)) ELSE 0 END) as taxable_28,
                    SUM(CASE WHEN TAX_PERCENT = 28 THEN ISNULL(TAX_AMOUNT, 0) ELSE 0 END) as gst_28,
                    SUM(CASE WHEN TAX_PERCENT = 40 THEN (ISNULL(CGST_TAXABLE_SALES, 0) + ISNULL(IGST_TAXABLE_SALES, 0)) ELSE 0 END) as taxable_40,
                    SUM(CASE WHEN TAX_PERCENT = 40 THEN ISNULL(TAX_AMOUNT, 0) ELSE 0 END) as gst_40,
                    SUM(ISNULL(CESS_AMOUNT, 0) + ISNULL(SD_SPL_CESS_AMT, 0)) as cess
                FROM VWGST_TAX_DETAIL_ON_BILL
                WHERE BILL_DATE >= %s AND BILL_DATE < DATEADD(day, 1, CAST(%s AS DATETIME))
                GROUP BY CAST(BILL_DATE AS DATE)
            """, (fd, td))
            rows = cur.fetchall()
            if rows:
                conn.close()
                return rows
        except Exception:
            pass # Fallback if view doesn't exist

        # Pull aggregated tax data using CTE fallback
        cur.execute(f"""
            WITH HDR_SUM AS (
                SELECT 
                    CAST(BILL_DATE AS DATE) as summary_date, 
                    SUM(GRAND_TOTAL) as sales_value
                FROM SALES_HDR 
                WHERE CAST(BILL_DATE AS DATE) BETWEEN %s AND %s AND ISCANCELLED = 0
                GROUP BY CAST(BILL_DATE AS DATE)
            ),
            DTL_SUM AS (
                SELECT 
                    CAST(H.BILL_DATE AS DATE) as summary_date,
                    SUM(D.{tax_val_col}) as basic_value,
                    SUM(CASE WHEN D.{tax_pct_col} = 0 THEN D.{tax_val_col} ELSE 0 END) as gst_0,
                    SUM(CASE WHEN D.{tax_pct_col} = 5 THEN D.{tax_val_col} ELSE 0 END) as taxable_5,
                    SUM(CASE WHEN D.{tax_pct_col} = 5 THEN D.{tax_amt_col} ELSE 0 END) as gst_5,
                    SUM(CASE WHEN D.{tax_pct_col} = 12 THEN D.{tax_val_col} ELSE 0 END) as taxable_12,
                    SUM(CASE WHEN D.{tax_pct_col} = 12 THEN D.{tax_amt_col} ELSE 0 END) as gst_12,
                    SUM(CASE WHEN D.{tax_pct_col} = 18 THEN D.{tax_val_col} ELSE 0 END) as taxable_18,
                    SUM(CASE WHEN D.{tax_pct_col} = 18 THEN D.{tax_amt_col} ELSE 0 END) as gst_18,
                    SUM(CASE WHEN D.{tax_pct_col} = 28 THEN D.{tax_val_col} ELSE 0 END) as taxable_28,
                    SUM(CASE WHEN D.{tax_pct_col} = 28 THEN D.{tax_amt_col} ELSE 0 END) as gst_28,
                    SUM(CASE WHEN D.{tax_pct_col} = 40 THEN D.{tax_val_col} ELSE 0 END) as taxable_40,
                    SUM(CASE WHEN D.{tax_pct_col} = 40 THEN D.{tax_amt_col} ELSE 0 END) as gst_40,
                    SUM(ISNULL(D.{cess_col}, 0)) as cess
                FROM SALES_HDR H
                INNER JOIN SALES_DTL D ON H.BILL_NO = D.BILL_NO
                WHERE CAST(H.BILL_DATE AS DATE) BETWEEN %s AND %s AND H.ISCANCELLED = 0
                GROUP BY CAST(H.BILL_DATE AS DATE)
            )
            SELECT 
                H.summary_date,
                H.sales_value,
                D.basic_value,
                D.gst_0,
                D.taxable_5,
                D.gst_5,
                D.taxable_12,
                D.gst_12,
                D.taxable_18,
                D.gst_18,
                D.taxable_28,
                D.gst_28,
                D.taxable_40,
                D.gst_40,
                D.cess
            FROM HDR_SUM H
            INNER JOIN DTL_SUM D ON H.summary_date = D.summary_date
        """, (fd, td, fd, td))
        rows = cur.fetchall()
        conn.close()
        return rows
        
    try:
        rows = await asyncio.to_thread(_pull_tax)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL Server error: {e}")
        
    if not rows:
        return {"success": True, "message": f"No tax data for {fd} to {td}", "synced": 0}
        
    synced = 0
    _fd = date_type.fromisoformat(fd) if isinstance(fd, str) else fd
    _td = date_type.fromisoformat(td) if isinstance(td, str) else td
    
    await db.execute(delete(unit_wise_tax_summary).where(
        unit_wise_tax_summary.outlet_id == s["id"],
        unit_wise_tax_summary.summary_date.between(_fd, _td)
    ))
    
    for row in rows:
        db.add(unit_wise_tax_summary(
            outlet_id=s["id"],
            summary_date=row.get("summary_date"),
            sales_value=_d(row.get("sales_value")),
            basic_value=_d(row.get("basic_value")),
            gst_0=_d(row.get("gst_0")),
            taxable_5=_d(row.get("taxable_5")),
            gst_5=_d(row.get("gst_5")),
            taxable_12=_d(row.get("taxable_12")),
            gst_12=_d(row.get("gst_12")),
            taxable_18=_d(row.get("taxable_18")),
            gst_18=_d(row.get("gst_18")),
            taxable_28=_d(row.get("taxable_28")),
            gst_28=_d(row.get("gst_28")),
            taxable_40=_d(row.get("taxable_40")),
            gst_40=_d(row.get("gst_40")),
            cess=_d(row.get("cess"))
        ))
        synced += 1
        
    await db.commit()
    await _log(db, s["id"], "tax_breakup", "success", f"Synced tax summary for {sync_date}", synced)
    await db.commit()
    
    return {
        "success": True,
        "sync_date": sync_date,
        "outlet": s["outlet_name"],
        "synced": synced,
        "message": f"Synced {synced} tax summary records"
    }
