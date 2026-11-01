// Day & Shift control (NCG process): Day Open → Shift Open → billing → Shift Close (count + reconcile) → Day Close.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { masters_api } from '../../api/masters'
import { shifts_api, type day_detail, type day_row, type shift_detail, type shift_row, type shift_status } from '../../api/shifts'
import { getCompanySettings } from '../../api/company'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import StoreShifts from './StoreShifts'

const OUTLET_KEY = 'pos_outlet_id'  // same counter location as the POS screen
const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1]
const SHIFT_NAMES = ['General', 'Morning', 'Afternoon', 'Evening', 'Night']

const inr = (v: unknown) => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dt = (v?: string | null) => v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const dmy = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const today = () => new Date().toLocaleDateString('en-CA')  // local YYYY-MM-DD
const errMsg = (e: any) => e?.response?.data?.detail || e?.message || 'Something went wrong'
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const sno = (s: { shift_no?: number | null; id: number }) => `Shift ${s.shift_no ?? s.id}`  // 1, 2, 3 … restarts every day
const title = (m: string) => m.replace(/\b\w/g, c => c.toUpperCase())

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="bg-app-bg rounded-lg px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`text-[16px] font-semibold ${tone || 'text-text-primary'}`}>{value}</div>
    </div>
  )
}

function ModeTable({ modes }: { modes: Record<string, string> | null | undefined }) {
  const rows = Object.entries(modes || {})
  if (!rows.length) return <p className="text-[13px] text-text-muted">No collections yet</p>
  return (
    <table className="ent-table">
      <thead><tr><th>Payment mode</th><th className="!text-right">Amount</th></tr></thead>
      <tbody>{rows.map(([m, a]) => <tr key={m}><td>{title(m)}</td><td className="text-right">{inr(a)}</td></tr>)}</tbody>
    </table>
  )
}

function ShiftsTable({ rows, onClose, onPrint }: { rows: shift_row[]; onClose?: (s: shift_row) => void; onPrint: (id: number) => void }) {
  if (!rows.length) return <p className="text-[13px] text-text-muted">No shifts yet</p>
  return (
    <div className="overflow-x-auto">
      <table className="ent-table min-w-[760px]">
        <thead><tr>
          <th>Shift</th><th>Cashier</th>{rows[0].business_date && <th>Date</th>}<th>Slot</th><th>Opened</th><th>Closed</th>
          <th className="!text-right">Bills</th><th className="!text-right">Sales</th><th className="!text-right">Short / Excess</th><th></th>
        </tr></thead>
        <tbody>{rows.map(s => (
          <tr key={s.id}>
            <td className="font-semibold" title={`ID ${s.id}`}>{s.shift_no ?? '—'}</td>
            <td>{s.cashier_name}</td>
            {rows[0].business_date && <td>{dmy(s.business_date)}</td>}
            <td>{s.shift_name}{s.terminal_no && <span className="text-text-muted"> · {s.terminal_no}</span>}</td>
            <td>{dt(s.opened_at)}</td>
            <td>{s.status === 'open' ? <span className="status-badge status-badge-active"><span className="dot dot-active" />Open</span> : dt(s.closed_at)}</td>
            <td className="text-right">{s.status === 'closed' ? s.total_bills : '—'}</td>
            <td className="text-right">{s.status === 'closed' ? inr(s.total_sales) : '—'}</td>
            <td className="text-right">
              {s.status === 'closed' && (Number(s.short_amount) > 0 || Number(s.excess_amount) > 0)
                ? <>{Number(s.short_amount) > 0 && <span className="text-red-600">−{inr(s.short_amount)}</span>} {Number(s.excess_amount) > 0 && <span className="text-amber-600">+{inr(s.excess_amount)}</span>}</>
                : s.status === 'closed' ? <span className="text-green-600">Tallied</span> : '—'}
            </td>
            <td className="text-right whitespace-nowrap">
              {s.status === 'open' && onClose && <button className="btn btn-secondary !py-1" onClick={() => onClose(s)}>Close</button>}
              {s.status === 'closed' && <button className="w-8 h-8 rounded-md text-text-secondary hover:bg-app-bg hover:text-primary" title="Print shift report" aria-label={`Print shift ${s.id}`} onClick={() => onPrint(s.id)}><i className="fas fa-print" /></button>}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function DaySummary({ day }: { day: day_detail }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Bills" value={<>{day.total_bills}{day.cancelled_bills > 0 && <span className="text-[12px] text-text-muted"> ({day.cancelled_bills} cancelled)</span>}</>} />
        <Stat label="Net sales" value={inr(day.net_sales)} />
        <Stat label="Collected" value={inr(day.total_collected)} />
        <Stat label="Net cash" value={inr(day.total_cash)} />
        <Stat label="Gross / Discount" value={<span className="text-[14px]">{inr(day.gross_sales)} / {inr(day.total_discount)}</span>} />
        <Stat label="GST" value={inr(day.total_gst)} />
        <Stat label="Returns" value={inr(day.total_returns)} />
        <Stat label="Credit (due)" value={inr(day.total_credit)} />
      </div>
      {(Number(day.total_shortage) > 0 || Number(day.total_excess) > 0) && (
        <div className="text-[13px]">Cash variance: <span className="text-red-600">shortage {inr(day.total_shortage)}</span> · <span className="text-amber-600">excess {inr(day.total_excess)}</span></div>
      )}
      {day.safe_counted != null && (
        <div className="text-[13px]">Safe count: expected {inr(day.safe_expected)} · counted {inr(day.safe_counted)} ·{' '}
          <span className={Number(day.safe_variance) < 0 ? 'text-red-600 font-semibold' : Number(day.safe_variance) > 0 ? 'text-amber-600 font-semibold' : 'text-green-600'}>
            {Number(day.safe_variance) ? `variance ${inr(day.safe_variance)}` : 'tallied'}</span></div>
      )}
      <ModeTable modes={day.mode_totals} />
    </div>
  )
}

async function printShift(id: number) {
  const [{ data: s }, co] = await Promise.all([shifts_api.get(id), getCompanySettings().catch(() => ({} as any))])
  const rows = (s.mode_totals || []).map(r => `<tr><td>${esc(title(r.mode))}</td><td class="r">${Number(r.system).toFixed(2)}</td><td class="r">${Number(r.actual).toFixed(2)}</td><td class="r">${Number(r.diff).toFixed(2)}</td></tr>`).join('')
  const den = s.denominations ? DENOMS.filter(d => Number(s.denominations![String(d)]) > 0)
    .map(d => `<tr><td>₹${d} × ${s.denominations![String(d)]}</td><td class="r">${(d * Number(s.denominations![String(d)])).toFixed(2)}</td></tr>`).join('')
    + (Number(s.denominations.coins) ? `<tr><td>Coins</td><td class="r">${Number(s.denominations.coins).toFixed(2)}</td></tr>` : '') : ''
  const line = (l: string, v: unknown) => `<tr><td>${l}</td><td class="r">${esc(v)}</td></tr>`
  // header like the bill receipt: logo, brand, then the store's address / phone / GSTIN (HO's when the store has none)
  const o = s.outlet
  const logo = co.logo_path ? new URL(co.logo_path, window.location.origin).href : ''
  const place = [o?.city, o?.state].filter(Boolean).join(', ') + (o?.pincode ? ' - ' + o.pincode : '')
  const hasPlace = !!o?.address && [o.pincode, o.city].some(v => v && o.address!.includes(v))  // many store addresses already end with city + PIN
  const addr = o?.address ? [o.address, hasPlace ? '' : place].filter(Boolean).join('<br>') : esc(co.ho_address)
  const phone = o?.store_phone || co.ho_phone, gstin = o?.gst_number || co.gstin
  const w = window.open('', '_blank', 'width=420,height=700')
  if (!w) return toast.error('Allow pop-ups to print')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${sno(s)}</title><style>
    body{font:12px/1.35 monospace;width:76mm;margin:0 auto;color:#000} h3,p{margin:2px 0;text-align:center}
    table{width:100%;border-collapse:collapse} td,th{padding:1px 0;text-align:left} .r{text-align:right}
    hr{border:0;border-top:1px dashed #000;margin:6px 0} th{border-bottom:1px solid #000}
  </style></head><body>
    ${logo ? `<p><img src="${esc(logo)}" style="max-height:48px;max-width:100%;object-fit:contain" onerror="this.remove()"></p>` : ''}
    <h3 style="text-transform:uppercase">${esc(co.brand_name || 'Shift Report')}</h3>
    <p style="font-size:10.5px">${esc(s.outlet_name)}<br>${o?.address ? addr.split('<br>').map(esc).join('<br>') : addr}${phone ? `<br>Ph: ${esc(phone)}` : ''}${gstin ? `<br>GSTIN: <b>${esc(gstin)}</b>` : ''}</p>
    <hr><p><b>SHIFT CLOSE REPORT · ${sno(s).toUpperCase()}</b></p><hr>
    <table>${line('Business date', dmy(s.business_date))}${line('Cashier', s.cashier_name)}${line('Shift', s.shift_name + (s.terminal_no ? ' / ' + s.terminal_no : ''))}
      ${line('Opened', dt(s.opened_at))}${line('Closed', dt(s.closed_at))}${s.closed_by_name ? line('Closed by', s.closed_by_name) : ''}</table><hr>
    <table>${line('Bills', s.total_bills)}</table>
    ${s.first_bill ? `<p style="text-align:left">Bill no.: ${esc(s.first_bill)}${s.last_bill !== s.first_bill ? ` to ${esc(s.last_bill)}` : ''}</p>` : ''}
    <table>
      ${line('Sales', Number(s.total_sales).toFixed(2))}${line('Returns', Number(s.total_returns).toFixed(2))}${line('Credit', Number(s.credit_sales).toFixed(2))}</table><hr>
    <table>${line('Opening float', Number(s.opening_cash).toFixed(2))}${line('Cash collected', Number(s.system_cash).toFixed(2))}
      ${line('Cash refunds', (Number(s.cash_refunds) ? '-' : '') + Number(s.cash_refunds).toFixed(2))}${line('<b>Expected cash</b>', Number(s.expected_cash).toFixed(2))}${line('<b>Counted cash</b>', Number(s.actual_cash).toFixed(2))}</table><hr>
    <table><tr><th>Mode</th><th class="r">System</th><th class="r">Actual</th><th class="r">Diff</th></tr>${rows}</table><hr>
    <table>${line('<b>Shortage</b>', Number(s.short_amount).toFixed(2))}${line('<b>Excess</b>', Number(s.excess_amount).toFixed(2))}</table>
    ${den ? `<hr><table>${den}</table>` : ''}${s.close_remarks ? `<hr><p style="text-align:left">Remarks: ${esc(s.close_remarks)}</p>` : ''}
    <br><br><table><tr><td>Cashier sign</td><td class="r">Manager sign</td></tr></table>
    <script>window.onload=()=>{window.print()}</script></body></html>`)
  w.document.close()
}

function ShiftCloseModal({ shiftId, onClose, onDone }: { shiftId: number | null; onClose: () => void; onDone: () => void }) {
  const [s, setS] = useState<shift_detail | null>(null)
  const [den, setDen] = useState<Record<string, string>>({})
  const [actual, setActual] = useState<Record<string, string>>({})
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!shiftId) return
    setS(null); setDen({}); setRemarks('')
    shifts_api.get(shiftId).then(r => {
      setS(r.data)
      // non-cash modes prefilled from system (verify against UPI/card statements); cash is counted blind
      setActual(Object.fromEntries(Object.entries(r.data.live?.modes || {}).filter(([m]) => m !== 'cash')))
    }).catch(e => { toast.error(errMsg(e)); onClose() })
  }, [shiftId])

  const live = s?.live
  const counted = DENOMS.reduce((t, d) => t + d * (Number(den[d]) || 0), 0) + (Number(den.coins) || 0)
  const rows = live ? [
    { mode: 'cash', system: Number(live.expected_cash), actual: counted },
    ...Object.keys({ ...live.modes, ...actual }).filter(m => m !== 'cash').sort()
      .map(m => ({ mode: m, system: Number(live.modes[m] || 0), actual: Number(actual[m] || 0) })),
  ] : []
  const variance = rows.reduce((t, r) => t + (r.actual - r.system), 0)
  const anyDiff = rows.some(r => Math.abs(r.actual - r.system) >= 0.005)

  const submit = async () => {
    if (!s) return
    if (anyDiff && !remarks.trim()) return toast.error('Enter a remark explaining the variance')
    setSaving(true)
    try {
      await shifts_api.close(s.id, {
        actual: Object.fromEntries(Object.entries(actual).map(([m, v]) => [m, Number(v) || 0])),
        denominations: { ...Object.fromEntries(DENOMS.map(d => [String(d), Number(den[d]) || 0])), coins: Number(den.coins) || 0 },
        remarks: remarks.trim() || undefined,
      })
      toast.success('Shift closed')
      onDone()
      if (confirm('Shift closed. Print the shift report?')) printShift(s.id)
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }

  return (
    <Modal open={!!shiftId} onClose={onClose} title={s ? `Close ${sno(s)} • ${s.shift_name} • ${s.cashier_name}` : 'Close Shift'} width="max-w-4xl">
      {!s || !live ? <p className="text-center text-text-muted py-8">Loading…</p> : (
        <div className="grid md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Bills" value={live.total_bills} />
              <Stat label="Sales" value={inr(live.total_sales)} />
              <Stat label="Opening float" value={inr(s.opening_cash)} />
              <Stat label="Expected cash" value={inr(live.expected_cash)} tone="text-primary" />
            </div>
            <p className="text-[12px] text-text-muted">Expected cash = float {inr(s.opening_cash)} + cash collected {inr(live.system_cash)} − cash refunds {inr(live.cash_refunds)}
              {Number(live.pay_ins) > 0 && <> + pay-ins {inr(live.pay_ins)}</>}{Number(live.expenses) > 0 && <> − expenses {inr(live.expenses)}</>}{Number(live.pickups) > 0 && <> − pickups to safe {inr(live.pickups)}</>}.
              Credit given this shift: {inr(live.credit_sales)}. Counted cash goes into the safe.</p>
            {live.pending_expenses > 0 && <p className="text-[12px] text-red-600 m-0">{live.pending_expenses} expense(s) are waiting for approval — they must be approved or rejected before closing.</p>}
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary border-b border-border pb-1">Cash count</h4>
            <div className="grid grid-cols-3 gap-2">
              {DENOMS.map(d => (
                <label key={d} className="flex items-center gap-2 text-[13px]">
                  <span className="w-14 shrink-0 whitespace-nowrap text-right text-text-secondary">₹{d} ×</span>
                  <input className="form-input !px-2" type="number" min={0} step={1} inputMode="numeric" value={den[d] ?? ''} onChange={e => setDen(x => ({ ...x, [d]: e.target.value }))} aria-label={`Count of ₹${d}`} />
                </label>
              ))}
              <label className="flex items-center gap-2 text-[13px] col-span-3">
                <span className="w-14 shrink-0 text-right text-text-secondary">Coins</span>
                <input className="form-input !px-2 !w-32" type="number" min={0} step="0.01" value={den.coins ?? ''} onChange={e => setDen(x => ({ ...x, coins: e.target.value }))} aria-label="Coins amount" />
                <span className="ml-auto font-semibold">Counted: {inr(counted)}</span>
              </label>
            </div>
          </div>
          <div className="space-y-3">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary border-b border-border pb-1">Reconciliation</h4>
            <table className="ent-table">
              <thead><tr><th>Mode</th><th className="!text-right">System</th><th className="!text-right">Actual</th><th className="!text-right">Diff</th></tr></thead>
              <tbody>{rows.map(r => {
                const d = r.actual - r.system
                return (
                  <tr key={r.mode}>
                    <td>{title(r.mode)}{r.mode === 'cash' && <div className="text-[11px] text-text-muted">from cash count</div>}</td>
                    <td className="text-right">{inr(r.system)}</td>
                    <td className="text-right">{r.mode === 'cash' ? inr(r.actual) :
                      <input className="form-input !w-28 !px-2 text-right ml-auto" type="number" min={0} step="0.01" value={actual[r.mode] ?? ''} onChange={e => setActual(x => ({ ...x, [r.mode]: e.target.value }))} aria-label={`Actual ${r.mode}`} />}</td>
                    <td className={`text-right font-semibold ${d < -0.004 ? 'text-red-600' : d > 0.004 ? 'text-amber-600' : 'text-green-600'}`}>{d.toFixed(2)}</td>
                  </tr>
                )
              })}</tbody>
            </table>
            <div className={`rounded-lg px-3 py-2 text-[14px] font-semibold ${!anyDiff ? 'bg-green-50 text-green-700' : variance < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
              {!anyDiff ? 'All modes tally' : `Net variance ${variance < 0 ? 'short' : 'excess'} ${inr(Math.abs(variance))}`}
            </div>
            <div>
              <label className="form-label">Remarks{anyDiff && <span className="text-red-500"> *</span>}</label>
              <textarea className="form-input !h-auto" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder={anyDiff ? 'Reason for shortage / excess' : 'Optional'} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? 'Closing…' : 'Close Shift'}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function DayShift() {
  const [outlets, setOutlets] = useState<{ id: number; outlet_name: string }[]>([])
  const [outletId, setOutletId] = useState<number>(() => { try { return Number(localStorage.getItem(OUTLET_KEY)) || 0 } catch { return 0 } })
  const [st, setSt] = useState<shift_status | null>(null)
  const [busy, setBusy] = useState(false)
  const [openForm, setOpenForm] = useState({ business_date: today(), remarks: '' })
  const [shiftForm, setShiftForm] = useState({ opening_cash: '', shift_name: 'General', terminal_no: '', remarks: '' })
  const [closeShiftId, setCloseShiftId] = useState<number | null>(null)
  const [dayClose, setDayClose] = useState<{ remarks: string; force: boolean; safe: string } | null>(null)
  const [tab, setTab] = useState<'days' | 'shifts'>('days')
  const [days, setDays] = useState<day_row[]>([])
  const [history, setHistory] = useState<shift_row[]>([])
  const [viewDay, setViewDay] = useState<day_detail | null>(null)

  useEffect(() => { masters_api.get_outlets().then(r => setOutlets(r.data || [])).catch(() => {}) }, [])
  const load = () => {
    shifts_api.status(outletId).then(r => {
      setSt(r.data)
      setShiftForm(f => ({ ...f, opening_cash: f.opening_cash || String(Number(r.data.suggested_opening) || ''),
        shift_name: r.data.current_slot || (r.data.shift_plan ? f.shift_name : SHIFT_NAMES.includes(f.shift_name) ? f.shift_name : 'General') }))
    }).catch(e => toast.error(errMsg(e)))
    shifts_api.days({ outlet_id: outletId }).then(r => setDays(r.data)).catch(() => {})
    shifts_api.list({ outlet_id: outletId }).then(r => setHistory(r.data)).catch(() => {})
  }
  useEffect(() => {
    if (outletId) try { localStorage.setItem(OUTLET_KEY, String(outletId)) } catch { /* storage blocked */ }
    load()
  }, [outletId])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast.success(ok); load(); return true } catch (e) { toast.error(errMsg(e)); return false } finally { setBusy(false) }
  }

  const day = st?.day
  const mine = st?.my_shift
  const mineElsewhere = mine && mine.outlet_id !== outletId
  const is24 = st?.operating_mode === '24H'
  const slots = st?.shift_plan?.map(s => s.name) ?? SHIFT_NAMES

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Day & Shift" subtitle="Day open → shift open → billing → shift close (cash count) → day close"
        action={
          <select className="form-input !w-auto" value={outletId} onChange={e => setOutletId(Number(e.target.value))} aria-label="Location">
            <option value={0}>Head Office</option>
            {outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}
          </select>
        } />

      {is24 && st && (
        <div className="rounded-fiori border border-primary/30 bg-primary/5 px-4 py-2 text-[13px] flex flex-wrap gap-x-4 gap-y-1 items-center">
          <span className="font-semibold text-primary"><i className="fas fa-clock mr-1" />24-hour store</span>
          <span>Now: <b>{st.current_slot}</b> shift</span>
          <span className="text-text-secondary">{st.shift_plan?.map(s => `${s.name} ${s.start}–${s.end}`).join(' · ')} · day-end 23:59</span>
          {st.auto_rollover && <span className="text-text-muted">Day not closed by 00:15 → closed automatically and sent for review</span>}
        </div>
      )}
      {outletId === 0 && <StoreShifts />}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── business day ── */}
        <section className="bg-app-card border border-border rounded-fiori p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold m-0"><i className="fas fa-calendar-day mr-2 text-primary" />Business Day</h3>
            {day && <span className="status-badge status-badge-active"><span className="dot dot-active" />Open · {dmy(day.business_date)}</span>}
          </div>
          {!st ? <p className="text-text-muted">Loading…</p> : !day ? (
            <>
              <p className="text-[13px] text-text-secondary m-0">
                No business day is open for <b>{st.outlet_name}</b> — billing, collections and returns are blocked.
                {st.last_closed_date && <> Last closed day: {dmy(st.last_closed_date)}.</>}
              </p>
              {st.can_manage_day ? (
                <div className="grid sm:grid-cols-3 gap-3 items-end">
                  <div><label className="form-label">Business date</label>
                    <input className="form-input" type="date" max={today()} value={openForm.business_date} onChange={e => setOpenForm(f => ({ ...f, business_date: e.target.value }))} /></div>
                  <div><label className="form-label">Remarks</label>
                    <input className="form-input" value={openForm.remarks} onChange={e => setOpenForm(f => ({ ...f, remarks: e.target.value }))} /></div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary flex-1" disabled={busy} onClick={() => act(() => shifts_api.day_open({ outlet_id: outletId, ...openForm }), 'Business day opened')}>
                      <i className="fas fa-door-open mr-2" />Day Open
                    </button>
                    {st.last_closed_date && (
                      <button className="btn btn-secondary" disabled={busy} title="Reopen the last closed day (goes to Approvals)"
                        onClick={() => { const r = prompt(`Reason for reopening ${dmy(st.last_closed_date!)} (required)`); if (r && r.trim().length >= 5)
                          act(() => shifts_api.day_reopen(outletId, r.trim()), 'Reopen request sent — it opens once approved'); else if (r) toast.error('Give a reason of at least 5 characters') }}>Reopen…</button>
                    )}
                  </div>
                </div>
              ) : <p className="text-[13px] text-amber-700 m-0">Ask a manager to open the day.</p>}
            </>
          ) : (
            <>
              <p className="text-[12px] text-text-muted m-0">Opened {dt(day.opened_at)} by {day.opened_by_name || '—'}{day.open_remarks && ` · ${day.open_remarks}`}</p>
              <DaySummary day={day} />
              <Checklist dayId={day.id} />
              <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary border-b border-border pb-1">Shifts today</h4>
              <ShiftsTable rows={day.shifts} onPrint={printShift}
                onClose={st.can_manage_day ? s => setCloseShiftId(s.id) : undefined} />
              {st.can_manage_day && (
                <div className="flex justify-end">
                  <button className="btn btn-primary" disabled={busy} onClick={() => setDayClose({ remarks: '', force: false, safe: '' })}>
                    <i className="fas fa-lock mr-2" />Day Close
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── my shift ── */}
        <section className="bg-app-card border border-border rounded-fiori p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold m-0"><i className="fas fa-cash-register mr-2 text-primary" />My Shift</h3>
            {mine && <span className="status-badge status-badge-active"><span className="dot dot-active" />{sno(mine)} open</span>}
          </div>
          {!st ? null : mine ? (
            <>
              {mineElsewhere && <p className="text-[13px] text-amber-700 m-0">This shift is open at <b>{mine.outlet_name}</b>.</p>}
              <p className="text-[12px] text-text-muted m-0">{mine.shift_name}{mine.terminal_no && ` · ${mine.terminal_no}`} · opened {dt(mine.opened_at)} · business date {dmy(mine.business_date)}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Bills" value={mine.live?.total_bills ?? 0} />
                <Stat label="Sales" value={inr(mine.live?.total_sales)} />
                <Stat label="Opening float" value={inr(mine.opening_cash)} />
                <Stat label="Cash in drawer" value={inr(mine.live?.expected_cash)} tone="text-primary" />
              </div>
              <ModeTable modes={mine.live?.modes} />
              <div className="flex justify-end">
                <button className="btn btn-primary" onClick={() => setCloseShiftId(mine.id)}><i className="fas fa-calculator mr-2" />Shift Close</button>
              </div>
            </>
          ) : !day ? (
            <p className="text-[13px] text-text-secondary m-0">A shift can be opened once the business day is open.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="form-label">Opening cash (float) <span className="text-red-500">*</span></label>
                <input className="form-input" type="number" min={0} step="0.01" value={shiftForm.opening_cash} onChange={e => setShiftForm(f => ({ ...f, opening_cash: e.target.value }))} />
                <span className="form-helper">Suggested from last closed shift: {inr(st.suggested_opening)}</span></div>
              <div><label className="form-label">Shift</label>
                <select className="form-input" value={shiftForm.shift_name} onChange={e => setShiftForm(f => ({ ...f, shift_name: e.target.value }))}>
                  {slots.map(n => <option key={n} value={n}>{n}{n === st.current_slot ? ' (now)' : ''}</option>)}
                </select></div>
              <div><label className="form-label">Counter / terminal</label>
                <input className="form-input" placeholder="e.g. POS-1" value={shiftForm.terminal_no} onChange={e => setShiftForm(f => ({ ...f, terminal_no: e.target.value }))} /></div>
              <div><label className="form-label">Remarks</label>
                <input className="form-input" value={shiftForm.remarks} onChange={e => setShiftForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              <div className="sm:col-span-2 flex justify-end">
                <button className="btn btn-primary" disabled={busy || shiftForm.opening_cash === ''}
                  onClick={() => act(() => shifts_api.open({ outlet_id: outletId, opening_cash: Number(shiftForm.opening_cash), shift_name: shiftForm.shift_name, terminal_no: shiftForm.terminal_no || undefined, remarks: shiftForm.remarks || undefined }), 'Shift opened — ready for billing')}>
                  <i className="fas fa-play mr-2" />Shift Open
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── history ── */}
      <section className="bg-app-card border border-border rounded-fiori">
        <div className="tab-bar !px-2" role="tablist">
          {(['days', 'shifts'] as const).map(t => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab-item ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'days' ? 'Day register' : 'Shift register'}
            </button>
          ))}
        </div>
        <div className="p-3">
          {tab === 'shifts' ? <ShiftsTable rows={history} onPrint={printShift} /> : !days.length ? <p className="text-[13px] text-text-muted">No business days yet</p> : (
            <div className="overflow-x-auto">
              <table className="ent-table min-w-[760px]">
                <thead><tr><th>Date</th><th>Status</th><th>Opened by</th><th>Closed</th><th className="!text-right">Bills</th><th className="!text-right">Net sales</th><th className="!text-right">Collected</th><th className="!text-right">Short / Excess</th><th></th></tr></thead>
                <tbody>{days.map(d => (
                  <tr key={d.id}>
                    <td className="font-semibold">{dmy(d.business_date)}</td>
                    <td><span className={`status-badge ${d.status === 'open' ? 'status-badge-active' : 'status-badge-inactive'}`}>{d.status === 'open' ? 'Open' : 'Closed'}</span></td>
                    <td>{d.opened_by_name || '—'}</td>
                    <td>{d.closed_at ? `${dt(d.closed_at)} · ${d.closed_by_name || ''}` : '—'}</td>
                    <td className="text-right">{d.status === 'closed' ? d.total_bills : '—'}</td>
                    <td className="text-right">{d.status === 'closed' ? inr(d.net_sales) : '—'}</td>
                    <td className="text-right">{d.status === 'closed' ? inr(d.total_collected) : '—'}</td>
                    <td className="text-right">{d.status === 'closed' ? <><span className="text-red-600">{inr(d.total_shortage)}</span> / <span className="text-amber-600">{inr(d.total_excess)}</span></> : '—'}</td>
                    <td className="text-right"><button className="w-8 h-8 rounded-md text-text-secondary hover:bg-app-bg hover:text-primary" title="View" aria-label={`View day ${d.business_date}`}
                      onClick={() => shifts_api.day(d.id).then(r => setViewDay(r.data)).catch(e => toast.error(errMsg(e)))}><i className="fas fa-eye" /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <ShiftCloseModal shiftId={closeShiftId} onClose={() => setCloseShiftId(null)} onDone={() => { setCloseShiftId(null); load() }} />

      {/* day close confirmation */}
      <Modal open={!!dayClose && !!day} onClose={() => setDayClose(null)} title={`Day Close • ${dmy(day?.business_date)} • ${st?.outlet_name ?? ''}`} width="max-w-3xl">
        {day && dayClose && (
          <div className="space-y-4">
            {day.open_shifts.length > 0 ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700 space-y-2">
                <div className="font-semibold"><i className="fas fa-exclamation-triangle mr-1" />{day.open_shifts.length} shift(s) still open: {day.open_shifts.map(s => `${s.cashier_name} (${sno(s)})`).join(', ')}</div>
                <div>Close each shift with a cash count first. In an emergency you can force-close them at system figures (no count, flagged on the shift).</div>
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={dayClose.force} onChange={e => setDayClose(d => d && ({ ...d, force: e.target.checked }))} /> Force-close open shifts (emergency day close)
                </label>
              </div>
            ) : <div className="rounded-lg bg-green-50 text-green-700 p-3 text-[13px]"><i className="fas fa-check-circle mr-1" />All shifts are closed. Totals below will be frozen for this day.</div>}
            <DaySummary day={day} />
            <div className="rounded-lg border border-border p-3 grid sm:grid-cols-3 gap-3 items-end">
              <div className="sm:col-span-3 text-[13px] font-semibold text-primary"><i className="fas fa-vault mr-1" />Safe count (all cash left at the location after shifts close)</div>
              <div><div className="text-[11px] uppercase text-text-muted">Safe should hold</div><div className="text-[18px] font-semibold">{inr(day.safe_expected_at_close)}</div></div>
              <div><label className="form-label">Counted in safe <span className="text-red-500">*</span></label>
                <input className="form-input" type="number" min={0} step="0.01" value={dayClose.safe} onChange={e => setDayClose(d => d && ({ ...d, safe: e.target.value }))} /></div>
              <div className={`text-[14px] font-semibold ${dayClose.safe === '' ? 'text-text-muted' : Math.abs(Number(dayClose.safe) - Number(day.safe_expected_at_close)) < 0.005 ? 'text-green-600' : 'text-red-600'}`}>
                {dayClose.safe === '' ? 'Enter the count' : Math.abs(Number(dayClose.safe) - Number(day.safe_expected_at_close)) < 0.005 ? 'Tallies'
                  : `${Number(dayClose.safe) < Number(day.safe_expected_at_close) ? 'Short' : 'Excess'} ${inr(Math.abs(Number(dayClose.safe) - Number(day.safe_expected_at_close)))} — will be posted and flagged`}</div>
            </div>
            <div><label className="form-label">Remarks{dayClose.safe !== '' && Math.abs(Number(dayClose.safe) - Number(day.safe_expected_at_close)) >= 0.005 && <span className="text-red-500"> *</span>}</label>
              <textarea className="form-input !h-auto" rows={2} value={dayClose.remarks} onChange={e => setDayClose(d => d && ({ ...d, remarks: e.target.value }))} /></div>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setDayClose(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || (day.open_shifts.length > 0 && !dayClose.force) || dayClose.safe === ''
                  || (Math.abs(Number(dayClose.safe) - Number(day.safe_expected_at_close)) >= 0.005 && !dayClose.remarks.trim())}
                onClick={() => act(() => shifts_api.day_close(day.id, { remarks: dayClose.remarks || undefined, force: dayClose.force, safe_counted: Number(dayClose.safe) }), 'Business day closed').then(ok => ok && setDayClose(null))}>
                <i className="fas fa-lock mr-2" />Close Day
              </button>
              {is24 && (
                <button className="btn btn-primary" title="Day-end, then open the next business day (from 23:30)"
                  disabled={busy || day.open_shifts.length > 0 || dayClose.safe === ''
                    || (Math.abs(Number(dayClose.safe) - Number(day.safe_expected_at_close)) >= 0.005 && !dayClose.remarks.trim())}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      const { data } = await shifts_api.close_and_open(day.id, { safe_counted: Number(dayClose.safe), remarks: dayClose.remarks || undefined })
                      toast.success(data.next_day ? `Day closed · ${dmy(data.next_day.business_date)} opened` : data.message || 'Business day closed')
                      setDayClose(null); load()
                    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
                  }}>
                  <i className="fas fa-forward mr-2" />Day End &amp; Open Next Day
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!viewDay} onClose={() => setViewDay(null)} title={`Business Day • ${dmy(viewDay?.business_date)} • ${viewDay?.outlet_name ?? ''}`} width="max-w-4xl">
        {viewDay && (
          <div className="space-y-3">
            <p className="text-[12px] text-text-muted m-0">Opened {dt(viewDay.opened_at)} by {viewDay.opened_by_name || '—'} · {viewDay.status === 'closed' ? `Closed ${dt(viewDay.closed_at)} by ${viewDay.closed_by_name || '—'}` : 'Still open (live figures)'}{viewDay.close_remarks && ` · ${viewDay.close_remarks}`}</p>
            <DaySummary day={viewDay} />
            <ShiftsTable rows={viewDay.shifts} onPrint={printShift} />
          </div>
        )}
      </Modal>
    </div>
  )
}

function Checklist({ dayId }: { dayId: number }) {
  const [rows, setRows] = useState<{ key: string; label: string; count: number; blocking: boolean }[]>([])
  useEffect(() => { shifts_api.day_checklist(dayId).then(r => setRows(r.data)).catch(() => setRows([])) }, [dayId])
  const open = rows.filter(r => r.count > 0)
  if (!rows.length) return null
  return (
    <div className={`text-[12px] border rounded p-2 ${open.some(r => r.blocking) ? 'border-red-300 bg-red-50' : open.length ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}`}>
      <b>Closing checklist:</b> {open.length === 0 ? 'nothing pending ✓' : open.map(r => (
        <span key={r.key} className={`ml-2 ${r.blocking ? 'text-red-700 font-semibold' : 'text-amber-800'}`}>{r.label}: {r.count}{r.blocking ? ' (must clear)' : ''}</span>))}
    </div>
  )
}
