// Reports home — same layout as NCG's Reports page: two banners, then sections of report cards
// (icon, title, one-line description, coloured arrow). Cards the user has no permission for are hidden.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { access_api } from '../../api/access'

type Card = { to: string; icon: string; title: string; desc: string; color: string; perm: string }
const C = (to: string, icon: string, title: string, desc: string, color: string, perm: string): Card => ({ to, icon, title, desc, color, perm })
const ok = 'text-emerald-600', blue = 'text-blue-600', grey = 'text-slate-500', dark = 'text-slate-800', warn = 'text-amber-500',
  red = 'text-red-600', info = 'text-cyan-600'

const SECTIONS: { title: string; cards: Card[] }[] = [
  { title: 'Standard Financial Reports', cards: [
    C('/reports/sales', '📈', 'Sales Report', 'Invoices, GST collected, payments', ok, 'rep_sales'),
    C('/reports/purchases', '🛒', 'Purchase Report', 'All purchases, GST input, dues', blue, 'rep_purchase'),
    C('/reports/stock', '📦', 'Stock Report', 'Current inventory valuation', grey, 'rep_stock'),
    C('/reports/pl', '💰', 'Profit & Loss', 'Revenue, COGS, gross margin', dark, 'rep_finance'),
    C('/reports/gst', '🧾', 'GST Report', 'GSTR-1 summary: B2B / B2C', warn, 'rep_gst'),
    C('/reports/outstanding', '⚠️', 'Outstanding Dues', 'Customer & supplier pending amounts', red, 'rep_finance'),
    C('/reports/r/credit_sales', '📋', 'Credit Sales', 'Pending credit bills, days outstanding & overdue', red, 'rep_finance'),
    C('/billing/returns/list', '↩️', 'Refunds & Returns', 'All sales returns / credit notes & stock restorations', warn, 'sales_return'),
    C('/inventory/status', '🏪', 'Location Stock', 'Per-location inventory breakdown & valuation', info, 'rep_stock'),
    C('/reports/r/stock_grid', '🔳', 'Stock by Location (Grid)', 'Every item across all locations, side by side', grey, 'rep_stock'),
    C('/reports/ledger', '🔄', 'Stock Movement', 'All stock in / out movements with balance', grey, 'rep_stock'),
    C('/reports/r/negative_stock', '⚠️', 'Negative Stock (Audit)', 'Items below zero with last sale & last GRN', red, 'rep_stock'),
    C('/reports/r/transfer_register', '🚚', 'Transfer Report', 'Inter-location transfers: sent, received, short', blue, 'rep_stock'),
    C('/reports/r/po_grn_variance', '📐', 'PO vs GRN Variance', 'Ordered vs received qty and rate by PO line', warn, 'rep_purchase'),
    C('/reports/item-velocity', '⚡', 'Fast & Slow Movement', 'Fast-moving, slow-moving & dead stock analysis', warn, 'rep_sales'),
    C('/reports/r/category_perf', '📊', 'Inventory Analytics', 'Category sales, margin & stock insights', blue, 'rep_sales'),
  ] },
  { title: 'Daily Reports', cards: [
    C('/reports/stock-as-at', '⏱️', 'Closing Stock / Stock as at Time', 'Stock on any date at any time & its valuation', info, 'rep_stock'),
    C('/reports/profitability', '💹', 'All Item Margin Report', 'Cost, MRP, selling price & margin for every item', ok, 'rep_sales'),
    C('/reports/hourly', '🕐', 'Hourly Sales', 'Sales by hour of the day, outlet-wise', blue, 'rep_sales'),
    C('/reports/sales-trend', '📉', 'Sales Trend', 'Day-by-day sales for the period', ok, 'rep_sales'),
    C('/reports/top-items', '🏆', 'Top Selling Items', 'Best sellers by quantity and value', warn, 'rep_sales'),
  ] },
  { title: 'POS Operations Reports', cards: [
    C('/reports/payments-matrix', '💳', 'Store-wise Media Report', 'Cash / UPI / card breakdown per store', ok, 'rep_finance'),
    C('/reports/r/counter_summary', '🏧', 'Counter-wise Media Report', 'Payment media, expected vs counted cash per counter', info, 'rep_sales'),
    C('/reports/r/day_end', '📊', 'Day End Metrics', 'Sales KPIs, basket value, payment modes, short / excess per day', blue, 'rep_sales'),
    C('/reports/payments', '🖨️', 'Bill-wise Collection', 'Every payment received, bill by bill', dark, 'rep_finance'),
  ] },
  { title: 'Operations & Shift Control Reports', cards: [
    C('/billing/day-shift', '☀️', 'Day Open / Close', 'Business days opened and closed, with reconciliation', warn, 'day_shift'),
    C('/billing/day-shift', '🔑', 'Shift Open / Close', 'Cashier shifts, floats and closing entries', ok, 'day_shift'),
    C('/accounts/cash', '💵', 'Cash, Expense & Bank Deposit', 'Cash in hand, handovers, expenses, deposits', blue, 'cash'),
    C('/reports/r/discount_report', '🏷️', 'Discount Report', 'Item, scheme and cash discounts given, outlet-wise', warn, 'rep_sales'),
    C('/reports/r/price_override', '💲', 'Price Override Report', 'Items billed below their standard selling price', red, 'rep_sales'),
    C('/inventory/stock-take', '⚖️', 'Stock-Take Variance', 'Shortage / surplus value across stock takes', red, 'stock_adjustment'),
    C('/schemes', '🎁', 'Scheme Report', 'Bills, customers and discount given per scheme', ok, 'schemes'),
    C('/reports/r/user_activity', '🕵️', 'User Activity Log', 'Per-user actions, logins and last activity', grey, 'audit'),
  ] },
  { title: 'Outlet / Location Reports', cards: [
    C('/reports/hierarchy', '🏪', 'Outlet-wise Sales', 'Compare sales across outlets side by side', ok, 'rep_sales'),
    C('/reports/unit-dashboard', '🖥️', 'Executive Unit Dashboard', "Today's outlet sales, month and week at a glance", blue, 'rep_sales'),
    C('/reports/r/stock_grid', '📦', 'Location Stock Grid', 'Per-location inventory, item by item', info, 'rep_stock'),
    C('/reports/r/transfer_register', '🚚', 'Transfer Report', 'Inter-location transfers history', blue, 'rep_stock'),
  ] },
  { title: 'Category, Brand & Supplier Reports', cards: [
    C('/reports/r/category_perf', '🗂️', 'Category Performance', 'Sales, margin and stock per category', ok, 'rep_sales'),
    C('/reports/r/brand_perf', '🏷️', 'Brand Performance', 'Sales, margin and stock per brand', blue, 'rep_sales'),
    C('/reports/category-sales', '📊', 'Category Sales', 'Category-wise sales for the period', info, 'rep_sales'),
    C('/reports/r/supplier_scorecard', '🤝', 'Supplier Scorecard', 'Fill rate, on-time %, lead days, returns', warn, 'rep_purchase'),
    C('/reports/r/purchase_items', '🧾', 'Purchase Item-wise', 'Every GRN line with batch, expiry and tax', blue, 'rep_purchase'),
    C('/reports/sales-vs-purchase', '⚖️', 'Sales vs Purchase', 'Month-by-month sales against purchases', dark, 'rep_purchase'),
    C('/reports/customer-analytics', '👥', 'Customer Analytics', 'Top customers, visits, spend and average bill', ok, 'rep_sales'),
  ] },
  { title: 'GST & Compliance', cards: [
    C('/reports/r/gstr1_b2b', '📋', 'GSTR-1 · B2B', 'Sales to registered customers + GSTR-1 JSON download', warn, 'rep_gst'),
    C('/reports/r/gstr1_b2cl', '📋', 'GSTR-1 · B2C Large', 'Inter-state B2C invoices above ₹1 lakh', warn, 'rep_gst'),
    C('/reports/r/gstr1_b2cs', '📋', 'GSTR-1 · B2C Small', 'Other B2C sales by place of supply & rate', warn, 'rep_gst'),
    C('/reports/r/gstr1_cdnr', '📋', 'GSTR-1 · Credit Notes', 'Credit notes to registered customers', warn, 'rep_gst'),
    C('/reports/r/hsn_sales', '🔢', 'HSN Summary · Sales', 'GSTR-1 Table 12, B2B / B2C split', info, 'rep_gst'),
    C('/reports/r/hsn_purchase', '🔢', 'HSN Summary · Purchase', 'HSN-wise inward supplies', info, 'rep_gst'),
    C('/reports/r/itc_register', '📋', 'GSTR-2 · ITC Register', 'Input tax credit from purchases, less debit notes', info, 'rep_gst'),
    C('/reports/r/gstr3b', '📋', 'GSTR-3B', 'Net GST payable summary', red, 'rep_gst'),
    C('/reports/r/gst2b_recon', '🔍', 'GSTR-2B Reconciliation', 'Portal 2B JSON vs your purchase register', red, 'rep_gst'),
    C('/reports/tax-breakup', '🧾', 'Tax Breakup Report', 'Date-wise sales split by GST slab', blue, 'rep_gst'),
    C('/reports/hsn-mismatch', '🚩', 'HSN Mismatch', 'Items whose HSN does not match their category', red, 'rep_gst'),
    C('/reports/r/tally_vouchers', '📤', 'Tally Export', 'Sales vouchers as Tally XML', dark, 'rep_finance'),
  ] },
  { title: 'Audit & Compliance', cards: [
    C('/reports/r/audit_trail', '🕵️', 'Audit Log (Full)', 'Every action: who, what, when and from which IP', dark, 'audit'),
    C('/reports/r/user_activity', '👤', 'User Activity Summary', 'Logins, creates, edits, approvals, cancels per user', blue, 'audit'),
    C('/reports/r/login_history', '🔐', 'Login History', 'Successful and failed logins with time and IP', ok, 'audit'),
    C('/reports/r/security_denials', '⛔', 'Blocked Access Attempts', 'Requests refused by User Management', red, 'audit'),
    C('/reports/r/permission_changes', '🛡️', 'Permission Changes', 'Changes to user access and role templates', warn, 'audit'),
    C('/reports/r/sensitive_actions', '⚠️', 'Sensitive Actions', 'Deletes, cancels, approvals, adjustments, day close, password resets', red, 'audit'),
    C('/reports/r/activity_by_module', '📊', 'Activity by Module', 'How often each action happens, and by how many users', info, 'audit'),
  ] },
  { title: 'Store Operations', cards: [
    C('/ho-dashboard', '🏢', 'Head Office Dashboard', 'All stores: sales, closing, expiry, approvals', 'text-blue-600', 'dashboard'),
    C('/reports/r/day_closing', '🔒', 'Day-End Closing Register', 'Expected vs counted cash, collections, review & reopen', 'text-slate-800', 'day_shift'),
    C('/reports/r/discount_audit', '🏷️', 'Discount Audit', 'Item / scheme / bill / loyalty discount and approvals', 'text-amber-500', 'rep_sales'),
    C('/reports/r/loyalty_ledger', '🎁', 'Loyalty Ledger', 'Points earned, redeemed, expired, reversed, adjusted', 'text-emerald-600', 'loyalty'),
  ] },
  { title: 'Expiry & Batches', cards: [
    C('/reports/r/exp_near_expiry', '⏳', 'Near-Expiry Batches', 'Store-wise batches inside the warning bands, with GRN', 'text-amber-500', 'rep_stock'),
    C('/reports/r/exp_expired', '⛔', 'Expired Stock in Stores', 'Expired batches still holding stock', 'text-red-600', 'rep_stock'),
    C('/reports/r/exp_summary', '🗂️', 'Expiry Summary (HO)', 'Store × band: batches, qty, value', 'text-blue-600', 'rep_stock'),
    C('/reports/r/exp_category', '🏷️', 'Expiry by Category', 'Expired and near-expiry qty / value per category', 'text-slate-800', 'rep_stock'),
    C('/reports/r/exp_batch_inventory', '📦', 'Batch-wise Inventory', 'Every batch with GRN, mfg & expiry, qty, value', 'text-slate-500', 'rep_stock'),
    C('/reports/r/exp_removals', '🗑️', 'Expired Stock Removed', 'Approved expired-item-out register', 'text-red-600', 'rep_stock'),
    C('/reports/r/exp_corrections', '🔁', 'Batch & Expiry Corrections', 'Original vs corrected batch / expiry, who approved', 'text-amber-500', 'rep_stock'),
    C('/reports/r/approval_register', '✅', 'Approval Register', 'All approval requests and decisions', 'text-emerald-600', 'approvals'),
  ] },
  { title: 'Manufacturing (Nutribray)', cards: [
    C('/reports/r/mfg_store_stock', '🏭', 'Department Stock', 'Physical, reserved & available per department store', ok, 'manufacturing'),
    C('/reports/r/mfg_item_stock', '📦', 'Item-wise Plant Stock', 'Available / WIP / QC / rejected / damaged — counted once', grey, 'manufacturing'),
    C('/reports/r/mfg_customer_pack_stock', '🎨', 'Customer Packaging Stock', 'Printed tins, caps, labels per customer & artwork', blue, 'manufacturing'),
    C('/reports/r/mfg_stock_ledger', '📒', 'Plant Stock Ledger', 'Every plant movement: in, out, transfer, reversal', dark, 'manufacturing'),
    C('/reports/r/mfg_print_issue', '🖨️', 'Printing Issue Register', 'Tins sent to printing, by job and vendor', blue, 'manufacturing'),
    C('/reports/r/mfg_print_receipt', '✅', 'Printing Receipt & QC', 'Accepted / rejected / damaged with artwork checks', ok, 'manufacturing'),
    C('/reports/r/mfg_print_pending', '⏳', 'Pending & Overdue Printing', 'Vendor-wise tins still with the printer', warn, 'manufacturing'),
    C('/reports/r/mfg_print_recon', '⚖️', 'Printing Reconciliation', 'Issued = accepted + rejected + damaged + lost + returned', dark, 'manufacturing'),
    C('/reports/r/mfg_prod_register', '🗓️', 'Production Plan & Register', 'Orders, planned vs good output, shortfall', blue, 'manufacturing'),
    C('/reports/r/mfg_material_req', '🧮', 'Material Requirement & Shortage', 'Required, reserved, free, shortage, locations', red, 'manufacturing'),
    C('/reports/r/mfg_shortage', '🚨', 'Order-wise RM & PM Shortage', 'Per customer / production order: required, available, shortage, transfer & purchase suggestion', red, 'manufacturing'),
    C('/reports/r/mfg_variance', '📏', 'Production Variance', 'BOM standard vs actual consumption, cost and reasons', warn, 'manufacturing'),
    C('/reports/r/mfg_issue_register', '📤', 'Material Issue Register', 'Issue slips and unused returns', grey, 'manufacturing'),
    C('/reports/r/mfg_consumption', '📐', 'Actual vs Standard Consumption', 'BOM standard vs actual, with reconciliation', warn, 'manufacturing'),
    C('/reports/r/mfg_output', '🥫', 'Production Output (Batch)', 'Good, rejected, QC approved by batch', ok, 'manufacturing'),
    C('/reports/r/mfg_wip', '🔄', 'Work in Progress', 'Material at printing and in production', info, 'manufacturing'),
    C('/reports/r/mfg_damage_register', '💥', 'Damage Register', 'Department / item / customer damage with tolerance alerts', red, 'manufacturing'),
    C('/reports/r/mfg_damage_summary', '📉', 'Damage % & Yield', 'Yield and damage percentage per order', warn, 'manufacturing'),
    C('/reports/r/mfg_qc_rejection', '🚫', 'QC Rejection Report', 'Printed material and finished goods rejections', red, 'manufacturing'),
    C('/reports/r/mfg_pending_variance', '🕒', 'Pending Variance Approval', 'Damage entries awaiting a decision', warn, 'manufacturing'),
    C('/reports/r/mfg_fg_stock', '🏬', 'Finished Goods Stock', 'Customer / batch-wise with cartons + loose', ok, 'manufacturing'),
    C('/reports/r/mfg_order_fulfilment', '🎯', 'Order Fulfilment', 'Ordered → produced → approved → issued → billed → dispatched', blue, 'manufacturing'),
    C('/reports/r/mfg_handover_register', '🤝', 'Store Issue to Dispatch', 'Finished goods handed to billing / dispatch', grey, 'manufacturing'),
    C('/reports/r/mfg_dispatch_register', '🚚', 'Dispatch Register', 'Cartons + loose units, invoice, vehicle, LR', dark, 'manufacturing'),
    C('/reports/r/mfg_pending_orders', '📋', 'Pending Customer Orders', 'Customer-wise pending production / billing / dispatch', red, 'manufacturing'),
  ] },
  { title: 'Margin & Channel Analytics', cards: [
    C('/reports/low-margin', '📉', 'Low Margin Items', 'Items selling below the minimum margin', red, 'rep_analytics'),
    C('/reports/markdown-items', '🏷️', 'Markdown Items', 'Items with markdown pricing', warn, 'rep_analytics'),
    C('/reports/channel-margin', '🛵', 'Channel Margin', 'Swiggy / Zomato / online channel margins', blue, 'rep_analytics'),
    C('/reports/master-po', '🧮', 'Master PO Distribution', 'Multi-outlet PO allocation', grey, 'purchase_order'),
  ] },
]

export default function ReportCenter() {
  const nav = useNavigate()
  const [perms, setPerms] = useState<{ admin: boolean; set: Set<string> } | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { access_api.me().then(r => setPerms({ admin: r.data.admin, set: new Set(r.data.permissions) })).catch(() => setPerms({ admin: true, set: new Set() })) }, [])
  const allowed = (c: Card) => !perms || perms.admin || perms.set.has(`${c.perm}.view`)
  const sections = useMemo(() => SECTIONS.map(s => ({ ...s, cards: s.cards.filter(c => allowed(c)
    && (!q.trim() || `${c.title} ${c.desc}`.toLowerCase().includes(q.trim().toLowerCase()))) })).filter(s => s.cards.length), [perms, q])

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Reports</h1>
          <p className="text-[12px] text-slate-500">Business intelligence for every outlet</p>
        </div>
        <div className="relative">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
          <input className="form-input !pl-8 !w-72" placeholder="Find a report…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      {!q && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <button onClick={() => nav('/dashboard')} className="text-left rounded-lg p-5 bg-gradient-to-r from-blue-600 to-blue-500 text-white flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex-1">
            <div className="text-lg font-bold"><i className="fas fa-tachometer-alt mr-2" />Dashboard</div>
            <div className="text-[13px] opacity-90 mt-1">Today's sales, monthly sales, stock alerts, daily &amp; monthly charts — your home screen at a glance.</div>
          </div>
          <span className="bg-white text-blue-700 text-[13px] font-semibold px-4 py-1.5 rounded-md shrink-0">Open →</span>
        </button>
        <button onClick={() => nav('/reports/unit-dashboard')} className="text-left rounded-lg p-5 bg-gradient-to-r from-[#1e3a6e] to-[#22427c] text-white flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex-1">
            <div className="text-lg font-bold"><i className="fas fa-chart-area mr-2" />Executive Summary</div>
            <div className="text-[13px] opacity-90 mt-1">Sales, branch performance, stock and month-to-date figures across every outlet.</div>
          </div>
          <span className="bg-white text-[#1e3a6e] text-[13px] font-semibold px-4 py-1.5 rounded-md shrink-0">Open →</span>
        </button>
      </div>}

      {sections.map(s => (
        <section key={s.title}>
          <h2 className="text-[12px] font-bold uppercase tracking-[.08em] text-slate-500 mb-3">{s.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {s.cards.map(c => (
              <button key={c.title + c.to} onClick={() => nav(c.to)}
                className="group text-left bg-white rounded-lg p-4 flex items-start gap-3 shadow-sm border border-slate-100 hover:shadow-md hover:-translate-y-px transition-all">
                <span className="text-[30px] leading-none w-9 text-center shrink-0" aria-hidden>{c.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-slate-900 text-[14px]">{c.title}</span>
                  <span className="block text-[12px] text-slate-500 mt-1">{c.desc}</span>
                </span>
                <i className={`fas fa-chevron-right text-xs mt-2 ${c.color} group-hover:translate-x-0.5 transition-transform`} />
              </button>))}
          </div>
        </section>))}
      {!sections.length && <div className="text-center text-slate-500 py-16">No report matches “{q}”.</div>}
    </div>
  )
}
