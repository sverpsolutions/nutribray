// POS billing screen — layout and shortcuts follow NCG billing/create_v2.php ("v2" POS beta):
// navy top bar, compact customer row, Search & Scan, dense items grid, fixed totals footer,
// F-key bar, and a centered two-column Pay & Save dialog.
// Prices are GST-inclusive shelf prices (products.selling_price == MRP); they are converted to
// GST-exclusive rates for the billing API, which adds GST back. Round-off keeps the total exact.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { billing_api, type invoice_out } from '../../api/billing'
import { products_api, type product_search_item } from '../../api/products'
import { customers_api, type customer_list_item } from '../../api/customers'
import { getCompanySettings } from '../../api/company'
import { masters_api } from '../../api/masters'
import { shifts_api, type shift_status } from '../../api/shifts'
import { useAuthStore } from '../../store/authStore'
import { printReceipt } from '../../utils/printReceipt'
import { schemes_api, type eval_result } from '../../api/schemes'
import api from '../../api/axios'

interface Line { key: number; product_id: number; name: string; item_code: string | null; barcode: string | null
  hsn_code: string | null; unit: string; mrp: number; rate: number; qty: number; gst: number }
interface Held { at: string; customer: Cust; lines: Line[] }
interface Cust { id: number; name: string; phone?: string }
type SplitMode = string   // any active SALE mode of the Payment Mode Master (incl. loyalty points)

const WALK_IN: Cust = { id: 1, name: 'Walk-in Customer' }
const NAVY = '#1D2D3D', NAVY_SOFT = '#2C455D', ACCENT = '#5980A6'
const r2 = (v: number) => Math.round(v * 100) / 100
const exRate = (l: { rate: number; gst: number }) => Math.round(l.rate / (1 + l.gst / 100) * 10000) / 10000  // GST-exclusive rate sent to the API
const inr = (v: number) => `₹ ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const errMsg = (e: any) => e?.response?.data?.detail || e?.message || 'Something went wrong'
const HOLD_KEY = 'pos_held_bills'
const OUTLET_KEY = 'pos_outlet_id'
const loadHeld = (): Held[] => { try { return JSON.parse(localStorage.getItem(HOLD_KEY) || '[]') } catch { return [] } }
const saveHeld = (h: Held[]) => { try { localStorage.setItem(HOLD_KEY, JSON.stringify(h)) } catch { /* storage blocked */ } }
let keySeq = 1

export default function PosBilling() {
  const nav = useNavigate()
  const cashier = useAuthStore(s => s.user?.name) || 'Staff'
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const [customer, setCustomer] = useState<Cust>(WALK_IN)
  useEffect(() => {   // loyalty balance of the selected customer (members only)
    setPoints(null)
    if (customer.id && customer.id !== WALK_IN.id) api.get(`/loyalty/customers/${customer.id}`)
      .then(r => r.data.balance && setPoints({ current: r.data.balance.current, point_value: r.data.balance.point_value })).catch(() => {})
  }, [customer.id])
  const [custQ, setCustQ] = useState('')
  const [custHits, setCustHits] = useState<customer_list_item[]>([])
  const [custHi, setCustHi] = useState(-1)  // arrow-key highlight in customer dropdown, -1 = none
  const [newCust, setNewCust] = useState<{ name: string; phone: string; city: string } | null>(null)
  const [invType, setInvType] = useState('retail')
  // billing location: user's own outlet if assigned, else last one picked on this counter, else HO
  const userOutlet = useAuthStore(s => s.user?.outlet_id) ?? null
  const [outlets, setOutlets] = useState<{ id: number; unit_code: string; outlet_name: string }[]>([])
  const [outletId, setOutletId] = useState<number | null>(() => {
    try { const picked = Number(localStorage.getItem(OUTLET_KEY)); if (picked) return picked } catch { /* storage blocked */ }   // header store switcher
    return userOutlet
  })
  useEffect(() => {
    masters_api.get_outlets().then(r => {
      const list = r.data || []
      setOutlets(list)
      setOutletId(id => (id && list.some((o: { id: number }) => o.id === id)) ? id
        : (list.find((o: { unit_code: string }) => o.unit_code === 'MB_WHS') ?? list[0])?.id ?? null)
    }).catch(() => {})
  }, [])
  useEffect(() => { if (outletId && !userOutlet) try { localStorage.setItem(OUTLET_KEY, String(outletId)) } catch { /* storage blocked */ } }, [outletId, userOutlet])
  useEffect(() => {
    if (outletId) api.get('/payment-modes', { params: { active_only: true, applies_to: 'SALE', outlet_id: outletId } })
      .then(r => r.data?.length && setPayModes(r.data.filter((m: any) => m.code !== 'credit'))).catch(() => {})
  }, [outletId])
  const [invDate, setInvDate] = useState(new Date().toISOString().slice(0, 10))
  // day/shift control: bills are dated on the open business day; the API blocks billing when the day is closed
  const [dayShift, setDayShift] = useState<shift_status | null>(null)
  useEffect(() => {
    if (!outletId) return
    shifts_api.status(outletId).then(r => {
      setDayShift(r.data)
      if (r.data.day) setInvDate(r.data.day.business_date)
    }).catch(() => setDayShift(null))
  }, [outletId])
  const [lines, setLines] = useState<Line[]>([])
  const [active, setActive] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<product_search_item[]>([])
  const [hi, setHi] = useState(0)
  const [status, setStatus] = useState('')
  const [clock, setClock] = useState(new Date())
  const [payOpen, setPayOpen] = useState(false)
  const [mode, setMode] = useState<'cash' | 'card' | 'upi' | 'credit' | 'split'>('cash')
  const [split, setSplit] = useState<{ mode: SplitMode; amt: string }[]>([{ mode: 'cash', amt: '' }, { mode: 'upi', amt: '' }])
  const [cdPct, setCdPct] = useState(0)
  const [discApproval, setDiscApproval] = useState('')
  const [payModes, setPayModes] = useState<{ code: string; name: string }[]>([{ code: 'cash', name: 'Cash' }, { code: 'card', name: 'Card' }, { code: 'upi', name: 'UPI' }])
  const [points, setPoints] = useState<{ current: number; point_value: number } | null>(null)
  const [roundOff, setRoundOff] = useState(true)
  const [tendered, setTendered] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [held, setHeld] = useState<Held[]>(loadHeld)
  const [recallOpen, setRecallOpen] = useState(false)
  const [priceOpen, setPriceOpen] = useState(false)
  const [priceQ, setPriceQ] = useState('')
  const [priceHits, setPriceHits] = useState<product_search_item[]>([])
  const [lastInvoice, setLastInvoice] = useState<{ inv: invoice_out; cust: Cust; mrp: Record<number, number>; tendered?: number } | null>(null)

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 30000); return () => clearInterval(t) }, [])

  // ── schemes: the server engine decides (and re-decides at save); the screen only shows its answer ──
  const schPay = mode === 'split' ? 'cash' : mode  // split = cash + card + UPI, all paid now
  const schKey = JSON.stringify([lines.map(l => [l.product_id, l.qty, l.rate]), customer.id, outletId, schPay, invDate])
  const [sch, setSch] = useState<{ key: string; res: eval_result } | null>(null)
  useEffect(() => {
    if (!lines.length) { setSch(null); return }
    const key = schKey
    const h = setTimeout(() => schemes_api.evaluate({
      items: lines.map(l => ({ product_id: l.product_id, qty: l.qty, rate: l.rate, gst: l.gst })),
      customer_id: customer.id, outlet_id: outletId, payment_mode: schPay, bill_date: invDate,
    }).then(r => setSch({ key, res: r.data })).catch(() => setSch(null)), 300)
    return () => clearTimeout(h)
  }, [schKey])
  const schRes = sch?.key === schKey ? sch.res : null

  // ── totals: same rounding steps as billing_service._calc_item so screen == saved bill ──
  // GST is inside the shelf price; CD % comes off each line before GST, i.e. CD % off the selling price
  const t = useMemo(() => {
    let gross = 0, taxable = 0, mrpTotal = 0, qty = 0, net = 0, cd = 0, scheme = 0
    const gstBy = { cgst: 0, sgst: 0 }
    lines.forEach((l, i) => {
      const sd = r2(Number(schRes?.line_disc_val[i] || 0) * l.qty)   // scheme discount, GST-excl., as the server books it
      const ex = r2(r2(l.qty * exRate(l)) - sd), cdTx = r2(ex * cdPct / 100), tx = r2(ex - cdTx), half = r2(r2(l.gst / 2) * tx / 100)
      gross += l.qty * l.rate; taxable += tx; mrpTotal += l.qty * (l.mrp || l.rate); qty += l.qty; scheme += r2(sd * (1 + l.gst / 100))
      gstBy.cgst += half; gstBy.sgst += half; net += r2(tx + 2 * half); cd += r2(cdTx * (1 + l.gst / 100))
    })
    const beforeRound = r2(net)
    const grand = roundOff ? Math.round(beforeRound) : beforeRound
    return { gross: r2(gross), taxable: r2(taxable), cgst: r2(gstBy.cgst), sgst: r2(gstBy.sgst), cd: r2(cd), roundOffAmt: r2(grand - beforeRound),
             grand, mrpTotal: r2(mrpTotal), itemDisc: r2(mrpTotal - gross), save: r2(mrpTotal - grand), qty, scheme: r2(scheme) }
  }, [lines, cdPct, roundOff, schRes])

  // split: 2nd amount defaults to whatever the 1st leaves of the bill
  const splitAmts = [Number(split[0].amt || 0), split[1].amt === '' ? Math.max(0, r2(t.grand - Number(split[0].amt || 0))) : Number(split[1].amt)]
  const paid = mode === 'credit' ? 0 : mode === 'split' ? r2(splitAmts[0] + splitAmts[1]) : Math.min(Number(tendered || t.grand), t.grand)
  const change = mode === 'cash' && Number(tendered) > t.grand ? r2(Number(tendered) - t.grand) : 0
  const due = r2(t.grand - paid)

  // ── product search & scan ──
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return }
    const h = setTimeout(() => products_api.search(q.trim(), 20).then(r => { setHits(r.data); setHi(0) }).catch(() => {}), 250)
    return () => clearTimeout(h)
  }, [q])

  function addProduct(p: product_search_item, qty = 1) {
    const gst = Number(p.gst_percent || 0), mrp = Number(p.mrp || 0), rate = Number(p.selling_price || mrp)
    if (!rate) { toast.error(`${p.name} has no selling price`); return }
    const ex = lines.find(l => l.product_id === p.id && l.rate === rate)  // same item scanned again -> qty + 1
    if (ex) {
      setLines(lines.map(l => l.key === ex.key ? { ...l, qty: r2(l.qty + qty) } : l)); setActive(ex.key)
    } else {
      const key = keySeq++
      setLines([...lines, { key, product_id: p.id, name: p.name, item_code: p.item_code, barcode: p.barcode, hsn_code: p.hsn_code ?? null,
                            unit: p.unit || 'PCS', mrp, rate, qty, gst }])
      setActive(key)
    }
    setStatus(`✔ Added: ${p.name}`); setQ(''); setHits([]); searchRef.current?.focus()
  }

  async function onSearchEnter() {
    const term = q.trim()
    if (!term) return
    if (hits.length && hi < hits.length) {
      const exact = hits.find(h => [h.barcode, h.item_code, h.barcode_crt].some(c => c && c === term))
      return addProduct(exact ?? hits[hi])
    }
    const r = await products_api.search(term, 20).catch(() => null)
    const list = r?.data ?? []
    const exact = list.find(h => [h.barcode, h.item_code, h.barcode_crt].some(c => c && c === term))
    if (exact || list.length === 1) return addProduct(exact ?? list[0])
    if (!list.length) setStatus(`✖ No item found for "${term}"`)
    setHits(list); setHi(0)
  }

  // ── customer search ──
  useEffect(() => {
    if (custQ.trim().length < 2) { setCustHits([]); return }
    let live = true  // drop responses that land after the box changed (e.g. customer picked on Enter)
    const h = setTimeout(() => customers_api.list({ search: custQ.trim(), per_page: 10 }).then(r => live && setCustHits(r.data.data || [])).catch(() => {}), 250)
    return () => { live = false; clearTimeout(h) }
  }, [custQ])
  useEffect(() => setCustHi(-1), [custHits])

  function pickCustomer(c: Cust) {
    setCustomer(c); setCustQ(''); setCustHits([]); searchRef.current?.focus()
  }

  // Enter on phone box: exact phone match -> select; one hit -> select; nothing -> quick-add dialog
  async function onCustEnter() {
    const term = custQ.trim()
    if (!term) return
    const sel = custHits[custHi]
    if (sel) return pickCustomer({ id: sel.id, name: sel.name, phone: sel.phone })
    const r = await customers_api.list({ search: term, per_page: 10 }).catch(() => null)
    if (!r) return toast.error('Customer search failed — check the server/database connection')  // never offer "new" when we couldn't look
    const list = r.data.data ?? []
    const exact = list.find(c => c.phone === term) ?? (list.length === 1 ? list[0] : undefined)
    if (exact) return pickCustomer({ id: exact.id, name: exact.name, phone: exact.phone })
    if (list.length) { setCustHits(list); return }
    const digits = /^\d+$/.test(term)
    setNewCust({ name: digits ? '' : term, phone: digits ? term : '', city: '' })
  }

  async function saveNewCust() {
    if (!newCust) return
    const name = newCust.name.trim(), phone = newCust.phone.trim()
    if (!name) return toast.error('Customer name is required')
    if (!/^\d{10}$/.test(phone)) return toast.error('Enter a 10-digit mobile number')
    try {
      const res = await customers_api.create({ name, phone, city: newCust.city.trim() || null, type: invType })
      toast.success('Customer saved')
      setNewCust(null); pickCustomer({ id: res.data.id, name: res.data.name, phone: res.data.phone })
    } catch (e) { toast.error(errMsg(e)) }
  }

  // ── price check (F3): look up without adding ──
  useEffect(() => {
    if (priceQ.trim().length < 2) { setPriceHits([]); return }
    const h = setTimeout(() => products_api.search(priceQ.trim(), 10).then(r => setPriceHits(r.data)).catch(() => {}), 250)
    return () => clearTimeout(h)
  }, [priceQ])

  const update = (key: number, patch: Partial<Line>) => setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  const focusCell = (field: 'qty' | 'rate') => {
    const key = active ?? lines[lines.length - 1]?.key
    if (key == null) return toast('Add an item first')
    const el = document.getElementById(`pos-${field}-${key}`) as HTMLInputElement | null
    el?.focus(); el?.select()
  }

  function reset() {
    setLines([]); setCustomer(WALK_IN); setCustQ(''); setCdPct(0); setDiscApproval(''); setTendered(''); setNotes(''); setMode('cash'); setSplit([{ mode: 'cash', amt: '' }, { mode: 'upi', amt: '' }])
    setPayOpen(false); setActive(null); setStatus(''); setInvDate(new Date().toISOString().slice(0, 10)); searchRef.current?.focus()
  }

  function openPay() {
    if (!lines.length) return toast.error('Add at least one item')
    if (lines.some(l => !(l.qty > 0) || !(l.rate > 0))) return toast.error('Every item needs qty and rate above 0')
    setTendered(''); setPayOpen(true)
  }

  function holdBill() {
    if (!lines.length) return toast('Nothing to hold')
    const h = [{ at: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), customer, lines }, ...held].slice(0, 20)
    setHeld(h); saveHeld(h); reset(); toast.success('Bill held (F6 to recall)')
  }
  function recall(i: number) {
    const h = held[i]; const rest = held.filter((_, j) => j !== i)
    setLines(h.lines); setCustomer(h.customer); setHeld(rest); saveHeld(rest); setRecallOpen(false)
  }

  async function reprint() {
    if (!lastInvoice) return toast('No bill printed in this session yet')
    printReceipt(lastInvoice.inv, await getCompanySettings(), { customer_name: lastInvoice.cust.name, customer_phone: lastInvoice.cust.phone,
      cashier, mrp: lastInvoice.mrp, tendered: lastInvoice.tendered })
  }

  async function save() {
    if (saving) return
    if (mode === 'credit' && customer.id === WALK_IN.id) return toast.error('Credit bills need a customer (not Walk-in)')
    if (!outletId) return toast.error('Select the billing location first')
    if (mode === 'split' && paid > t.grand) return toast.error(`Split total ${inr(paid)} is more than the bill ${inr(t.grand)}`)
    if (!schRes) return toast('Checking schemes… press Save again in a moment')
    const payments = mode === 'split' ? split.map((p, i) => ({ payment_mode: p.mode, amount: r2(splitAmts[i]) })).filter(p => p.amount > 0) : undefined
    setSaving(true)
    try {
      const res = await billing_api.create_invoice({
        outlet_id: outletId ?? undefined, customer_id: customer.id, invoice_type: invType, invoice_date: invDate, payment_mode: mode,
        cd_percent: cdPct, round_off: roundOff, notes: notes.trim() || undefined, paid_amount: paid, payments, apply_schemes: true,
        discount_approval_no: discApproval.trim() || undefined,
        items: lines.map(l => ({
          product_id: l.product_id, item_code: l.item_code ?? undefined, name: l.name, qty: l.qty, unit: l.unit,
          rate: exRate(l), disc_val: 0, disc_type: '₹',
          gst_percent: l.gst, hsn_code: l.hsn_code ?? undefined,
        })),
      })
      const mrp = Object.fromEntries(lines.map(l => [l.product_id, l.mrp || l.rate]))
      const tend = mode === 'cash' && Number(tendered) > 0 ? Number(tendered) : undefined
      setLastInvoice({ inv: res.data, cust: customer, mrp, tendered: tend })
      toast.success(`Saved ${res.data.invoice_no} — ${inr(Number(res.data.total_amount))}`)
      printReceipt(res.data, await getCompanySettings(), { customer_name: customer.name, customer_phone: customer.phone, cashier, mrp, tendered: tend })
      reset()
    } catch (e) {
      toast.error(errMsg(e))
    } finally { setSaving(false) }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else rootRef.current?.requestFullscreen?.()
  }

  // ── shortcut keys (only while this tab is visible) ──
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (!rootRef.current || rootRef.current.offsetParent === null) return
    const map: Record<string, () => void> = {
      F1: () => searchRef.current?.focus(), F2: () => focusCell('qty'), F3: () => setPriceOpen(true),
      F4: () => (payOpen ? save() : openPay()), F5: holdBill, F6: () => setRecallOpen(true), F7: reprint,
      F8: () => focusCell('rate'), F11: toggleFullscreen,
    }
    if (map[e.key]) { e.preventDefault(); map[e.key]() }
    else if (e.key === 'Escape') { setNewCust(null); setPayOpen(false); setRecallOpen(false); setPriceOpen(false); setHits([]); setCustHits([]) }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const lbl = 'text-[10px] tracking-[.12em] uppercase font-semibold text-[#7A7A7D]'
  const fkeys: [string, string, () => void][] = [
    ['F1', 'Focus Search', () => searchRef.current?.focus()], ['F2', 'Edit Qty', () => focusCell('qty')],
    ['F3', 'Price Check', () => setPriceOpen(true)], ['F4', 'Pay & Save', openPay], ['F5', 'Hold Bill', holdBill],
    ['F6', `Recall${held.length ? ` (${held.length})` : ''}`, () => setRecallOpen(true)], ['F7', 'Reprint', reprint],
    ['F8', 'Edit Price', () => focusCell('rate')], ['F11', 'Fullscreen', toggleFullscreen],
  ]

  return (
    <div ref={rootRef} className="flex flex-col h-full bg-[#F2F2F3] text-[#1D1F20] p-2 gap-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {/* ── top bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-1.5 rounded-sm text-[#e2e8f0]" style={{ background: NAVY }}>
        <div className="flex items-center gap-2 font-extrabold text-white">
          <i className="fas fa-shopping-cart text-sky-400" /> NUTRIBAY <span className="font-extrabold">| BILLING</span>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-400">
          <span>INVOICE: <strong className="text-white">#UNSAVED (NEW)</strong></span>
          <span>CASHIER: <strong className="text-white">{cashier}</strong></span>
          {dayShift && (dayShift.day
            ? <span>DAY: <strong className="text-white">{dayShift.day.business_date.split('-').reverse().join('-')}</strong>
                {' · '}SHIFT: <strong className={dayShift.my_shift?.outlet_id === outletId ? 'text-white' : 'text-amber-300'}>
                  {dayShift.my_shift?.outlet_id === outletId ? `Shift ${dayShift.my_shift.shift_no ?? dayShift.my_shift.id} · ${dayShift.my_shift.shift_name}` : 'NOT OPEN'}</strong></span>
            : <button onClick={() => nav('/billing/day-shift')} className="font-bold text-red-300 hover:text-white">
                <i className="fas fa-exclamation-triangle mr-1" />DAY NOT OPEN — open Day &amp; Shift</button>)}
          <span>TIME: <strong className="text-white">{clock.toLocaleDateString('en-CA')} {clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</strong></span>
        </div>
        <div className="flex items-center gap-4 text-slate-400 text-sm">
          <button onClick={() => nav('/billing/invoices')} title="Invoice list" className="hover:text-white"><i className="fas fa-arrow-left" /></button>
          <button onClick={toggleFullscreen} className="hover:text-white font-semibold text-xs"><i className="fas fa-expand mr-1" /> Fullscreen</button>
        </div>
      </div>

      {/* ── customer / invoice header ── */}
      <div className="bg-white rounded-sm border border-black/10 px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
        <div className="relative flex-[1.3_1_170px] min-w-[170px]">
          <div className="flex">
            <span className="px-2 flex items-center border border-r-0 border-sky-500 bg-slate-50 text-sky-600"><i className="fas fa-mobile-alt" /></span>
            <input value={custQ} onChange={e => setCustQ(e.target.value)} placeholder="Phone or name search... (Enter)"
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); onCustEnter() }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setCustHi(i => Math.min(i + 1, custHits.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setCustHi(i => Math.max(i - 1, 0)) }
              }}
              className="flex-1 border border-sky-500 px-2 py-1 outline-none text-sm min-w-0" />
          </div>
          {custHits.length > 0 && (
            <div className="absolute z-30 bg-white border shadow-lg w-full max-h-52 overflow-y-auto">
              {custHits.map((c, i) => (
                <button key={c.id} onMouseEnter={() => setCustHi(i)} onClick={() => pickCustomer({ id: c.id, name: c.name, phone: c.phone })}
                  className={`block w-full text-left px-2 py-1.5 border-b text-sm ${i === custHi ? 'bg-sky-100' : 'hover:bg-sky-50'}`}>
                  {c.name} <span className="text-xs text-gray-400">{c.phone}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-[1.6_1_190px] min-w-[190px] flex items-center gap-2 border border-black/15 px-2 py-1 bg-white">
          <span>👤</span><span className="truncate font-medium">{customer.name}</span>
          {customer.phone && <span className="text-xs text-gray-400">({customer.phone})</span>}
          {customer.id !== WALK_IN.id && <button onClick={() => setCustomer(WALK_IN)} className="ml-auto text-gray-400 hover:text-red-600" title="Back to Walk-in"><i className="fas fa-times" /></button>}
        </div>
        <select value={outletId ?? ''} onChange={e => setOutletId(Number(e.target.value) || null)} disabled={!!userOutlet}
          title="Billing location" className="w-[170px] border border-black/15 px-2 py-1 disabled:bg-slate-100">
          {outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}
        </select>
        <select value={invType} onChange={e => setInvType(e.target.value)} className="w-[115px] border border-black/15 px-2 py-1">
          <option value="retail">Retail</option><option value="wholesale">Wholesale</option>
        </select>
        <input type="date" value={invDate} onChange={e => setInvDate(e.target.value)} disabled={!!dayShift?.day}
          title={dayShift?.day ? 'Bill date is the open business day' : undefined} className="w-[148px] border border-black/15 px-2 py-1 disabled:bg-slate-100" />
        <div className="flex items-center gap-1.5 bg-slate-100 px-3 h-[31px] font-extrabold text-slate-700" title="Items in this bill">
          <i className="fas fa-boxes text-gray-400" /> {lines.length}
        </div>
      </div>

      {/* ── search & scan ── */}
      <div className="bg-white rounded-sm border border-black/10 border-l-4 border-l-green-600 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <label className="font-bold text-green-700 text-xs whitespace-nowrap"><i className="fas fa-barcode mr-1" />Search &amp; Scan</label>
          <div className="relative flex-1">
            <input ref={searchRef} autoFocus value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); onSearchEnter() }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(i + 1, hits.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, 0)) }
              }}
              placeholder="Scan Barcode or Search Item Name / Code (F1)..."
              className="w-full border border-green-600 px-2 py-1.5 text-sm font-medium outline-none" />
            {hits.length > 0 && (
              <div className="absolute z-30 bg-white border shadow-xl w-full max-h-72 overflow-y-auto">
                {hits.map((p, i) => (
                  <button key={p.id} onMouseEnter={() => setHi(i)} onClick={() => addProduct(p)}
                    className={`flex w-full justify-between items-center px-3 py-1.5 text-sm border-b text-left ${i === hi ? 'bg-sky-100' : 'hover:bg-sky-50'}`}>
                    <span><span className="font-medium">{p.name}</span> <span className="text-xs text-gray-400 font-mono">{p.item_code}{p.barcode ? ` · ${p.barcode}` : ''}</span></span>
                    <span className="text-xs whitespace-nowrap">
                      {Number(p.mrp) > Number(p.selling_price) && <span className="line-through text-gray-400 mr-1">₹{Number(p.mrp)}</span>}
                      <strong>₹{Number(p.selling_price)}</strong> <span className="text-gray-400">GST {Number(p.gst_percent || 0)}%</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => nav('/products/add')} className="border border-green-600 text-green-700 px-2 py-1 text-xs hover:bg-green-50"><i className="fas fa-box-open" /> New Item</button>
          <button onClick={() => nav('/masters/customers')} className="border border-sky-600 text-sky-700 px-2 py-1 text-xs hover:bg-sky-50"><i className="fas fa-user-plus" /> New Customer</button>
        </div>
        <div className="text-[11px] font-bold text-gray-500 min-h-[14px] mt-0.5">{status}</div>
      </div>

      {/* ── items grid ── */}
      <div className="bg-white rounded-sm border border-black/10 flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-1 flex justify-between items-center border-b text-xs">
          <span className="font-bold">Items <span className="bg-gray-500 text-white px-1.5 rounded">{lines.length}</span></span>
          <span className="text-gray-500"><kbd>F2</kbd> Qty • <kbd>F8</kbd> Price • <kbd>F4</kbd> Pay &amp; Save • <kbd>Enter</kbd> on scan box to add</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-[13px] border-collapse">
            <thead className="sticky top-0 bg-[#E7E7EA] text-[11px] tracking-[.12em] uppercase">
              <tr>{['#', 'Product', 'Qty', 'MRP (₹)', 'Disc%', 'Rate (₹)', 'EAN / Item Code', 'GST%', 'Total', ''].map((h, i) =>
                <th key={i} className={`border border-black/15 px-2 py-1.5 ${i >= 2 && i <= 8 && i !== 6 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={10} className="text-center text-gray-400 py-16"><i className="fas fa-barcode text-3xl block mb-2 text-gray-300" />Scan a barcode or search an item to start billing</td></tr>
              )}
              {lines.map((l, i) => {
                const disc = l.mrp > 0 ? r2((l.mrp - l.rate) / l.mrp * 100) : 0
                return (
                  <tr key={l.key} onClick={() => setActive(l.key)} className={active === l.key ? 'bg-sky-50' : ''}>
                    <td className="border border-black/15 px-2">{i + 1}</td>
                    <td className="border border-black/15 px-2 py-1"><div className="font-semibold">{l.name}</div><div className="text-[11px] text-gray-400">{l.unit}{l.hsn_code ? ` · HSN ${l.hsn_code}` : ''}</div>
                      {Number(schRes?.line_discount[i] || 0) > 0 && <div className="text-[11px] font-semibold text-green-700"><i className="fas fa-tag mr-1" />Scheme − {inr(Number(schRes!.line_discount[i]))}</div>}</td>
                    <td className="border border-black/15 px-1 text-right">
                      <input id={`pos-qty-${l.key}`} type="number" min={0} step="0.001" value={l.qty} onFocus={() => setActive(l.key)}
                        onChange={e => update(l.key, { qty: Number(e.target.value) })} onKeyDown={e => e.key === 'Enter' && searchRef.current?.focus()}
                        className={`w-20 text-right px-1 py-0.5 border ${l.qty > 0 ? 'border-black/15' : 'border-red-500'}`} />
                    </td>
                    <td className="border border-black/15 px-2 text-right text-[#7A7A7D]">
                      <span className={disc > 0 ? 'line-through' : ''}>{l.mrp ? l.mrp.toFixed(2) : '—'}</span>
                    </td>
                    <td className="border border-black/15 px-1 text-right">
                      <input type="number" min={0} max={100} step="0.01" value={disc} disabled={!l.mrp}
                        onChange={e => update(l.key, { rate: r2(l.mrp * (1 - Number(e.target.value) / 100)) })}
                        className="w-16 text-right px-1 py-0.5 border border-black/15" />
                    </td>
                    <td className="border border-black/15 px-1 text-right">
                      <input id={`pos-rate-${l.key}`} type="number" min={0} step="0.01" value={l.rate} onFocus={() => setActive(l.key)}
                        onChange={e => update(l.key, { rate: Number(e.target.value) })} onKeyDown={e => e.key === 'Enter' && searchRef.current?.focus()}
                        className={`w-24 text-right px-1 py-0.5 border font-semibold ${l.rate > 0 ? 'border-black/15' : 'border-red-500'}`} />
                    </td>
                    <td className="border border-black/15 px-2 font-mono text-[11px]">{l.barcode || l.item_code}</td>
                    <td className="border border-black/15 px-2 text-right">{l.gst}%</td>
                    <td className="border border-black/15 px-2 text-right font-bold">{(l.qty * l.rate).toFixed(2)}</td>
                    <td className="border border-black/15 px-1 text-center">
                      <button onClick={e => { e.stopPropagation(); setLines(lines.filter(x => x.key !== l.key)) }} className="text-gray-400 hover:text-red-600"><i className="fas fa-times" /></button>
                    </td>
                  </tr>
                )
              })}
              {schRes?.free_items.map((f, i) => (
                <tr key={`free-${i}`} className="bg-purple-50 text-purple-800">
                  <td className="border border-black/15 px-2"><i className="fas fa-gift" /></td>
                  <td className="border border-black/15 px-2 py-1 font-semibold">{f.name} <span className="text-[11px] font-normal">— FREE ({f.scheme_name})</span></td>
                  <td className="border border-black/15 px-2 text-right">{Number(f.qty)}</td>
                  <td colSpan={5} className="border border-black/15 px-2 text-[11px]">Added to the bill at ₹0 on save</td>
                  <td className="border border-black/15 px-2 text-right font-bold">0.00</td><td className="border border-black/15" />
                </tr>
              ))}
            </tbody>
            {lines.length > 0 && (
              <tfoot className="bg-[#E7E7EA] font-bold"><tr>
                <td colSpan={8} className="border border-black/15 px-2 py-1 text-right">Totals:</td>
                <td className="border border-black/15 px-2 text-right">{t.gross.toFixed(2)}</td><td className="border border-black/15" />
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── totals footer + Pay & Save ── */}
      <div className="flex flex-wrap items-stretch text-[#F2F2F3] rounded-sm" style={{ background: NAVY }}>
        {[['Items', String(lines.length)], ['Total Qty', String(r2(t.qty))], ['MRP Total', inr(t.mrpTotal)], ['You Save', inr(Math.max(0, t.save))]].map(([k, v]) => (
          <div key={k} className="flex flex-col justify-center px-5 py-2 border-r border-white/15">
            <span className="text-[10px] tracking-[.12em] uppercase text-slate-400 font-semibold">{k}</span>
            <span className="text-lg font-semibold">{v}</span>
          </div>
        ))}
        <div className="ml-auto flex items-stretch">
          <div className="flex flex-col justify-center px-6" style={{ background: NAVY_SOFT }}>
            <span className="text-[10px] tracking-[.12em] uppercase text-slate-300 font-semibold">Grand Total</span>
            <span className="text-2xl font-bold">{inr(t.grand)}</span>
          </div>
          <button onClick={openPay} className="px-8 text-white font-bold text-lg hover:brightness-110" style={{ background: ACCENT }}>
            Pay &amp; Save <kbd className="ml-1 text-xs bg-white/25 px-1.5 rounded">F4</kbd>
          </button>
        </div>
      </div>

      {/* ── F-key bar ── */}
      <div className="flex flex-wrap items-center px-4 py-1.5 text-[13px] text-[#e2e8f0] rounded-sm" style={{ background: NAVY }}>
        <span className="font-extrabold text-white mr-3 tracking-wide">SHORTCUT KEYS</span>
        {fkeys.map(([k, label, fn]) => (
          <button key={k} onClick={fn} className="px-3 border-r border-white/20 last:border-0 font-semibold hover:text-green-300 hover:underline whitespace-nowrap">
            <b className="text-white">{k}:</b> {label}
          </button>
        ))}
      </div>

      {/* ── Pay & Save dialog ── */}
      {payOpen && (
        <>
          <div className="fixed inset-0 z-[1055]" style={{ background: 'rgba(29,45,61,.55)' }} onClick={() => setPayOpen(false)} />
          <div className="fixed z-[1060] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(1100px,92vw)] max-h-[92vh] overflow-y-auto bg-[#F2F2F3] border p-6 grid md:grid-cols-2 gap-x-10 gap-y-4" style={{ borderColor: NAVY }}>
            {/* bill summary */}
            <div className="space-y-3">
              <div className={lbl}>Bill Summary</div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={1} placeholder="Notes / payment terms..." className="w-full border px-2 py-1 text-sm" />
              <div className="border bg-white text-sm">
                <div className="px-4 py-2 space-y-1 bg-gray-50">
                  <Row l="MRP Total" v={inr(t.mrpTotal)} />
                  <Row l="Item Discount (MRP→SP)" v={inr(t.itemDisc)} c="text-green-700" />
                  {t.scheme > 0 && <Row l={`Scheme Discount (${schRes?.applied.filter(a => Number(a.discount) > 0).map(a => a.scheme_name).join(', ')})`} v={'- ' + inr(t.scheme)} c="text-green-700" />}
                  {schRes?.credit_notes.map((c, i) => <Row key={i} l={`Credit note earned — ${c.scheme_name}`} v={inr(Number(c.amount))} c="text-blue-700" />)}
                  <Row l="CGST (incl.)" v={inr(t.cgst)} /><Row l="SGST (incl.)" v={inr(t.sgst)} />
                  <div className="flex justify-between pt-1 border-t border-dashed border-green-600 font-bold text-green-700"><span>🎉 Total Saving</span><span>{inr(Math.max(0, t.save))}</span></div>
                </div>
                <div className="px-4 py-2 bg-amber-50 border-t border-amber-200">
                  <div className="flex justify-between font-bold text-amber-800 mb-1"><span>CD Discount (on selling price)</span><span className="text-red-600">- {inr(t.cd)}</span></div>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={100} step="0.01" value={cdPct} onChange={e => setCdPct(Math.min(100, Math.max(0, Number(e.target.value))))} className="w-20 border px-2 py-1" />
                    <span className="text-amber-800 text-xs">%</span>
                  </div>
                </div>
                <label className="px-4 py-2 bg-sky-50 border-t border-sky-200 flex justify-between items-center font-bold text-sky-900 cursor-pointer">
                  <span><input type="checkbox" checked={roundOff} onChange={e => setRoundOff(e.target.checked)} className="mr-2" />Round Off (nearest ₹1)</span>
                  <span>{inr(t.roundOffAmt)}</span>
                </label>
                <div className="px-4 py-2 flex justify-between text-white font-bold" style={{ background: NAVY }}>
                  <span className="text-slate-300 tracking-wide">GRAND TOTAL</span><span className="text-green-300 text-lg">{inr(t.grand)}</span>
                </div>
                <div className="px-4 py-1.5 flex justify-between bg-red-50 border-t border-red-200 font-bold">
                  <span className="text-red-800 text-xs uppercase tracking-wide">Amount Due</span><span className="text-red-600">{inr(due)}</span>
                </div>
              </div>
            </div>

            {/* payment */}
            <div className="md:border-l md:pl-10 border-black/15 space-y-3">
              <div className="flex justify-between items-center text-white px-4 py-2 font-extrabold text-sm" style={{ background: NAVY }}>
                <span><i className="fas fa-wallet mr-1" /> PAYMENT MODE</span>
                <button onClick={() => setPayOpen(false)} className="border border-white/40 px-2 text-[11px] uppercase">Close · Esc</button>
              </div>
              <div className="grid grid-cols-5 gap-1 border border-slate-300 p-1 bg-white">
                {(['cash', 'card', 'upi', 'credit', 'split'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`py-1.5 font-bold text-sm ${mode === m ? 'text-white' : 'hover:bg-slate-200 text-slate-800'}`} style={mode === m ? { background: NAVY } : {}}>
                    [{m === 'upi' ? 'UPI' : m.charAt(0).toUpperCase() + m.slice(1)}]
                  </button>
                ))}
              </div>
              {points && <p className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 px-2 py-1">
                Loyalty: <b>{points.current} pts</b> = {inr(points.current * points.point_value)} — use Split with “Loyalty Points” to redeem.</p>}
              <div className="flex gap-2 items-center text-xs">
                <input value={discApproval} onChange={e => setDiscApproval(e.target.value)} placeholder="High-discount approval no (if asked)"
                  className="flex-1 border px-2 py-1 bg-white" />
                <button type="button" className="underline text-slate-600" onClick={async () => {
                  const pct = prompt('Discount % needed for this bill'); const why = pct && prompt('Reason')
                  if (!pct || !why || !outletId) return
                  try { const r = await api.post('/discount-policy/request', { outlet_id: outletId, discount_pct: Number(pct), bill_amount: t.grand, customer: customer.name, reason: why })
                    toast.success(`Request ${r.data.request_no} sent — enter it here once approved`) } catch (e) { toast.error(errMsg(e)) }
                }}>Request approval</button>
              </div>
              {mode === 'credit' && <p className="text-xs text-red-700">Credit bill — full amount stays due on {customer.name}{customer.id === WALK_IN.id ? ' (select a customer first)' : ''}.</p>}
              {mode === 'split' ? (
                <div className="border border-sky-300 bg-sky-50 p-2 space-y-2">
                  {split.map((p, i) => (
                    <div key={i} className="flex gap-2">
                      <select value={p.mode} onChange={e => setSplit(split.map((x, j) => j === i ? { ...x, mode: e.target.value as SplitMode } : x))}
                        className="w-28 border px-2 py-1.5 font-bold bg-white">
                        {payModes.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
                      </select>
                      <input type="number" min={0} step="1" autoFocus={i === 0} value={p.amt} placeholder={i === 1 ? String(splitAmts[1]) : 'Amount'}
                        onChange={e => setSplit(split.map((x, j) => j === i ? { ...x, amt: e.target.value } : x))}
                        onKeyDown={e => e.key === 'Enter' && (i === 0 ? (e.currentTarget.parentElement?.nextElementSibling?.querySelector('input') as HTMLInputElement | null)?.focus() : save())}
                        className="flex-1 border px-2 py-1.5 text-xl font-bold text-right bg-white" />
                    </div>
                  ))}
                  <div className={`flex justify-between text-sm font-bold ${paid > t.grand ? 'text-red-600' : 'text-green-700'}`}>
                    <span>Split total</span><span>{inr(paid)} of {inr(t.grand)}</span>
                  </div>
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center p-2 bg-green-50 border border-green-300">
                  <div className={lbl}>Payable Now</div>
                  <div className="text-2xl font-bold text-green-700">{inr(paid)}</div>
                </div>
                <div className="text-center p-2 bg-sky-50 border border-sky-300">
                  <div className={lbl}>{mode === 'cash' ? 'Cash Received (₹)' : 'Amount Paid (₹)'}</div>
                  <input type="number" min={0} step="1" autoFocus value={tendered} disabled={mode === 'credit'} placeholder={String(t.grand)}
                    onChange={e => setTendered(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()}
                    className="w-full text-center text-2xl font-bold bg-transparent outline-none" />
                </div>
              </div>
              )}
              <div className="text-center p-2 bg-[#e2f0d9] border border-[#c5e0b4]">
                <div className="text-[11px] font-bold uppercase text-green-700">Change to Return</div>
                <div className="text-xl font-bold text-green-700">{inr(change)}</div>
              </div>
              <button onClick={save} disabled={saving} className="w-full py-3 text-white font-bold text-base disabled:opacity-60" style={{ background: ACCENT }}>
                <i className="fas fa-check-circle mr-2" />{saving ? 'Saving…' : 'Save & Print'} <kbd className="ml-1 text-xs bg-white/25 px-1.5 rounded">F4</kbd>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Recall held bills (F6) ── */}
      {recallOpen && (
        <Dialog title="Recall Held Bill" onClose={() => setRecallOpen(false)}>
          {held.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No held bills on this counter</p> : (
            <div className="divide-y">
              {held.map((h, i) => (
                <div key={i} className="flex items-center justify-between py-2 text-sm">
                  <span><strong>{h.at}</strong> · {h.customer.name} · {h.lines.length} items · {inr(r2(h.lines.reduce((a, l) => a + l.qty * l.rate, 0)))}</span>
                  <span className="space-x-2">
                    <button onClick={() => recall(i)} className="text-white px-3 py-1 text-xs" style={{ background: ACCENT }}>Recall</button>
                    <button onClick={() => { const r = held.filter((_, j) => j !== i); setHeld(r); saveHeld(r) }} className="text-gray-400 hover:text-red-600"><i className="fas fa-trash" /></button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Dialog>
      )}

      {/* ── New customer (Enter on unknown phone) ── */}
      {newCust && (
        <Dialog title="New Customer" onClose={() => setNewCust(null)}>
          <form onSubmit={e => { e.preventDefault(); saveNewCust() }} className="space-y-3 text-sm">
            <p className="text-xs text-gray-500">No customer found. Save a new one for this bill.</p>
            <label className="block"><span className="font-semibold">Mobile *</span>
              <input value={newCust.phone} onChange={e => setNewCust({ ...newCust, phone: e.target.value })} inputMode="numeric" maxLength={10}
                className="w-full border px-3 py-2 mt-1" /></label>
            <label className="block"><span className="font-semibold">Name *</span>
              <input autoFocus value={newCust.name} onChange={e => setNewCust({ ...newCust, name: e.target.value })}
                className="w-full border px-3 py-2 mt-1" /></label>
            <label className="block"><span className="font-semibold">City</span>
              <input value={newCust.city} onChange={e => setNewCust({ ...newCust, city: e.target.value })} className="w-full border px-3 py-2 mt-1" /></label>
            <button type="submit" className="w-full py-2 text-white font-bold" style={{ background: ACCENT }}>
              <i className="fas fa-save mr-2" />Save &amp; Select (Enter)
            </button>
          </form>
        </Dialog>
      )}

      {/* ── Price check (F3) ── */}
      {priceOpen && (
        <Dialog title="Price Check" onClose={() => { setPriceOpen(false); setPriceQ('') }}>
          <input autoFocus value={priceQ} onChange={e => setPriceQ(e.target.value)} placeholder="Scan or type item…" className="w-full border px-3 py-2 text-sm mb-2" />
          <div className="divide-y max-h-80 overflow-y-auto">
            {priceHits.map(p => (
              <div key={p.id} className="flex justify-between py-2 text-sm">
                <span>{p.name} <span className="text-xs text-gray-400 font-mono">{p.item_code}</span></span>
                <span>MRP <span className={Number(p.mrp) > Number(p.selling_price) ? 'line-through text-gray-400' : ''}>₹{Number(p.mrp)}</span> · <strong>₹{Number(p.selling_price)}</strong></span>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  )
}

function Row({ l, v, c = '' }: { l: string; v: string; c?: string }) {
  return <div className={`flex justify-between ${c}`}><span className="font-semibold">{l}</span><span className="font-bold">{v}</span></div>
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-[1055]" style={{ background: 'rgba(29,45,61,.55)' }} onClick={onClose} />
      <div className="fixed z-[1060] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(640px,92vw)] bg-white border shadow-xl" style={{ borderColor: NAVY }}>
        <div className="flex justify-between items-center text-white px-4 py-2 font-bold" style={{ background: NAVY }}>
          <span>{title}</span><button onClick={onClose} className="text-xs border border-white/40 px-2 uppercase">Close · Esc</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </>
  )
}
