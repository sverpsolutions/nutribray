import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { purchases_api, type item_intel, type po_item_payload, type po_term_payload } from '../../api/purchases'
import { masters_api } from '../../api/masters'
import { suppliers_api } from '../../api/suppliers'
import { products_api } from '../../api/products'

// ── Types ─────────────────────────────────────────────────────────────────────
interface grid_row {
  rid: string
  product_id: number
  name: string
  item_code: string
  intel: item_intel
  order_qty: number
  rate: number
  mrp: number
  gst_percent: number
  markdown_percent: number
  distributions: Record<number, number>
}

interface dyn_term { title: string; description: string }
interface fixed_term { field: string; label: string; text: string }

// ── Helpers ───────────────────────────────────────────────────────────────────
function doh_class(doh: number | null) {
  if (doh === null) return 'bg-slate-100 text-slate-400'
  if (doh < 3)  return 'bg-red-100 text-red-700 font-bold'
  if (doh <= 7) return 'bg-orange-100 text-orange-700 font-bold'
  return 'bg-green-100 text-green-700 font-bold'
}

function fmt(n: number, d = 0) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function uid() { return 'r' + Date.now() + Math.floor(Math.random() * 9999) }

// ── Component ─────────────────────────────────────────────────────────────────
export default function POCreate() {
  const { id } = useParams<{ id?: string }>()
  const is_edit = Boolean(id)
  const navigate = useNavigate()

  // Header state
  const [po_no, set_po_no] = useState('')
  const [po_date, set_po_date] = useState(new Date().toISOString().slice(0, 10))
  const [supplier_id, set_supplier_id] = useState('')
  const [outlet_id, set_outlet_id] = useState('')
  const [lead_days, set_lead_days] = useState(7)
  const [expected_date, set_expected_date] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10)
  })
  const [notes, set_notes] = useState('')
  const [markdown_mode, set_markdown_mode] = useState(false)
  const [global_md_pct, set_global_md_pct] = useState(0)

  // Multi-Outlet State
  const [is_multi_outlet, set_is_multi_outlet] = useState(false)
  const [selected_outlets, set_selected_outlets] = useState<number[]>([])

  // Dropdowns
  const [suppliers, set_suppliers] = useState<any[]>([])
  const [outlets, set_outlets]     = useState<any[]>([])

  // Grid
  const [rows, set_rows]           = useState<grid_row[]>([])
  const [inc_outlet_stock, set_inc_outlet_stock] = useState(false)

  // Terms
  const [fixed_terms, set_fixed_terms]   = useState<fixed_term[]>([])
  const [dyn_terms, set_dyn_terms]       = useState<dyn_term[]>([])

  // Search
  const [search_q, set_search_q]         = useState('')
  const [search_results, set_search_results] = useState<any[]>([])
  const [search_open, set_search_open]   = useState(false)
  const [search_loading, set_search_loading] = useState(false)
  const search_timer = useRef<ReturnType<typeof setTimeout>>()

  // DOH popup
  const [doh_popup, set_doh_popup]       = useState<{ name: string; rows: any[] } | null>(null)

  // Saving
  const [saving, set_saving]             = useState(false)
  const [error, set_error]               = useState('')

  // Auto-save
  const autosave_timer = useRef<ReturnType<typeof setInterval>>()

  // ── Load dropdowns ────────────────────────────────────────────────────────
  useEffect(() => {
    suppliers_api.list({ per_page: 500 }).then(r => set_suppliers(r.data.data || [])).catch(() => {})
    masters_api.get_outlets().then(r => set_outlets(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    if (!is_edit) {
      purchases_api.get_next_po_no().then(r => set_po_no(r.data.po_no)).catch(() => {})
    }
  }, [])

  // ── Load existing PO ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!is_edit || !id) return
    purchases_api.get_po(Number(id)).then(res => {
      const po = res.data
      set_po_no(po.po_no)
      set_po_date(po.po_date)
      set_supplier_id(String(po.supplier_id))
      set_outlet_id(String(po.outlet_id || ''))
      set_lead_days(po.delivery_days || 7)
      set_expected_date(po.expected_date || '')
      set_notes(po.notes || '')
      set_markdown_mode(po.markdown_enabled || false)

      const items_rows: grid_row[] = po.items.map((it: any) => ({
        rid: uid(),
        product_id: it.product_id,
        name: it.product_name || '',
        item_code: it.item_code || '',
        intel: {
          product_id: it.product_id, soh: it.warehouse_stock, outlet_stock: it.outlet_stock,
          doh: it.doh_value || null, sale_7d: it.sale_7d, sale_30d: it.sale_30d,
          avg_daily_sale: it.avg_daily_sale, last_rate: it.rate, suggested_qty: it.suggested_qty,
          last_purchases: [],
        },
        order_qty: it.order_qty,
        rate: it.rate,
        mrp: it.mrp || 0,
        gst_percent: it.gst_percent || 0,
        markdown_percent: it.markdown_percent || 0,
        distributions: {},
      }))
      set_rows(items_rows)

      const dyn = po.terms_conditions.filter((t: any) => t.term_type === 'DYNAMIC')
        .map((t: any) => ({ title: t.title, description: t.description || '' }))
      set_dyn_terms(dyn)
    }).catch(() => {})
  }, [id])

  // ── Lead days → expected date ─────────────────────────────────────────────
  function on_lead_change(days: number) {
    set_lead_days(days)
    const d = new Date(po_date)
    d.setDate(d.getDate() + days)
    set_expected_date(d.toISOString().slice(0, 10))
  }

  // ── Supplier change ───────────────────────────────────────────────────────
  async function on_supplier_change(sid: string) {
    set_supplier_id(sid)
    if (!sid) { set_fixed_terms([]); return }
    try {
      const res = await purchases_api.get_supplier_terms(Number(sid))
      set_fixed_terms(res.data.terms || [])
      if (res.data.default_lead_days) on_lead_change(res.data.default_lead_days)
    } catch {}
  }

  // ── Item search ───────────────────────────────────────────────────────────
  function on_search(q: string) {
    set_search_q(q)
    clearTimeout(search_timer.current)
    if (q.trim().length < 2) { set_search_open(false); set_search_results([]); return }
    set_search_loading(true)
    set_search_open(true)
    search_timer.current = setTimeout(async () => {
      try {
        const { data } = await products_api.search(q.trim(), 25)
        set_search_results(Array.isArray(data) ? data : [])
      } catch {
        set_search_results([])
      } finally {
        set_search_loading(false)
      }
    }, 200)
  }

  async function add_item(p: any) {
    set_search_q('')
    set_search_open(false)
    if (rows.find(r => r.product_id === p.id)) {
      return // already in grid
    }
    try {
      const res = await purchases_api.get_item_intel(p.id, outlet_id ? Number(outlet_id) : undefined, lead_days)
      const intel = res.data
      set_rows(prev => [...prev, {
        rid: uid(),
        product_id: p.id,
        name: p.name,
        item_code: p.item_code || '',
        intel,
        order_qty: 0,
        rate: Number(intel.last_rate) || Number(p.selling_price) || 0,
        mrp: Number(p.mrp) || 0,
        gst_percent: Number(p.gst_percent) || 0,
        markdown_percent: global_md_pct,
        distributions: {},
      }])
    } catch {}
  }

  function remove_row(rid: string) {
    set_rows(prev => prev.filter(r => r.rid !== rid))
  }

  function update_row(rid: string, field: keyof grid_row | 'distributions', value: any) {
    set_rows(prev => prev.map(r => {
      if (r.rid !== rid) return r
      let updated = { ...r }
      if (field === 'distributions') {
        const dists = { ...r.distributions, [value.oid]: value.val }
        updated.distributions = dists
        updated.order_qty = Object.values(dists).reduce((a, b) => a + (b || 0), 0)
      } else {
        (updated as any)[field] = value
      }
      
      // Markdown auto-calc
      if (markdown_mode && (field === 'mrp' || field === 'markdown_percent')) {
        updated.rate = updated.mrp - (updated.mrp * updated.markdown_percent / 100)
      }
      return updated
    }))
  }

  function apply_global_markdown() {
    set_rows(prev => prev.map(r => ({
      ...r,
      markdown_percent: global_md_pct,
      rate: r.mrp > 0 ? r.mrp - (r.mrp * global_md_pct / 100) : r.rate,
    })))
  }

  // ── Computed values ───────────────────────────────────────────────────────
  function suggested_qty(row: grid_row) {
    const avg = row.intel.avg_daily_sale
    const stock = row.intel.soh + (inc_outlet_stock ? row.intel.outlet_stock : 0)
    return Math.max(0, avg * lead_days - stock)
  }

  const grand_total = rows.reduce((s, r) => s + r.order_qty * r.rate, 0)

  // ── DOH popup ─────────────────────────────────────────────────────────────
  async function show_doh(product_id: number, name: string) {
    try {
      const res = await purchases_api.get_doh_popup(product_id)
      set_doh_popup({ name, rows: res.data.rows })
    } catch {}
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submit(status: string) {
    if (!supplier_id) { set_error('Select a Supplier'); return }
    if (!is_multi_outlet && !outlet_id) { set_error('Select a Delivery Outlet'); return }
    if (is_multi_outlet && selected_outlets.length === 0) { set_error('Select at least one outlet for distribution'); return }
    if (!rows.length) { set_error('Add at least one item'); return }

    set_saving(true)
    set_error('')

    const items: po_item_payload[] = rows.map(r => ({
      product_id: r.product_id,
      order_qty: r.order_qty,
      rate: r.rate,
      gst_percent: r.gst_percent,
      mrp: r.mrp,
      markdown_percent: r.markdown_percent,
      warehouse_stock: r.intel.soh,
      outlet_stock: r.intel.outlet_stock,
      doh_value: r.intel.doh || 0,
      sale_7d: r.intel.sale_7d,
      sale_30d: r.intel.sale_30d,
      avg_daily_sale: r.intel.avg_daily_sale,
      suggested_qty: suggested_qty(r),
      distributions: r.distributions,
    }))

    const fixed: po_term_payload[] = fixed_terms.map((t, i) => ({
      term_type: 'FIXED', title: t.label, description: t.text, sequence_no: i + 1,
    }))
    const dynamic: po_term_payload[] = dyn_terms
      .filter(t => t.title.trim())
      .map((t, i) => ({ term_type: 'DYNAMIC', title: t.title, description: t.description, sequence_no: i + 1 }))

    try {
      if (is_edit) {
        await purchases_api.update_po(Number(id), {
          supplier_id: Number(supplier_id), outlet_id: Number(outlet_id),
          expected_date, delivery_days: lead_days, notes,
          total_amount: grand_total, markdown_enabled: markdown_mode,
          items, dynamic_terms: dynamic,
        })
        navigate(`/purchases/po/${id}`)
      } else {
        if (is_multi_outlet) {
          const res = await purchases_api.create_multi_po({
            po_no, supplier_id: Number(supplier_id),
            po_date, expected_date, delivery_days: lead_days,
            total_amount: grand_total, notes, markdown_enabled: markdown_mode, status,
            items: items as any, fixed_terms: fixed, dynamic_terms: dynamic,
          })
          navigate(`/purchases/po/${res.data.po_id}`)
        } else {
          const res = await purchases_api.create_po({
            po_no, supplier_id: Number(supplier_id), outlet_id: Number(outlet_id),
            po_date, expected_date, delivery_days: lead_days,
            total_amount: grand_total, notes, markdown_enabled: markdown_mode, status,
            items, fixed_terms: fixed, dynamic_terms: dynamic,
          })
          navigate(`/purchases/po/${res.data.po_id}`)
        }
      }
    } catch (e: any) {
      set_error(e?.response?.data?.detail || 'Save failed')
    } finally {
      set_saving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-8">

      {/* ── Page Header Banner ── */}
      <div className="rounded-2xl overflow-hidden shadow-md"
        style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0E5C63 60%, #0E5C63 100%)' }}>
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg"
              style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)' }}>
              <i className="fas fa-file-invoice text-white text-xl"></i>
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">
                {is_edit ? `Edit Purchase Order` : 'Create Purchase Order'}
              </h1>
              {po_no && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-blue-200 text-xs font-semibold font-mono">{po_no}</span>
                  <span className="w-1 h-1 rounded-full bg-blue-400 inline-block"></span>
                  <span className="text-blue-300 text-xs">Smart purchasing with stock intelligence</span>
                </div>
              )}
              {!po_no && (
                <p className="text-blue-300 text-xs mt-0.5">Smart purchasing with stock intelligence</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right mr-4 hidden md:block">
              <div className="text-blue-200 text-[10px] uppercase font-semibold tracking-wider">Grand Total</div>
              <div className="text-white text-2xl font-black font-mono">
                ₹{grand_total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <button onClick={() => navigate('/purchases/po')}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-all"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.25)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}>
              <i className="fas fa-arrow-left text-xs"></i> Back to List
            </button>
          </div>
        </div>
        {/* Status bar */}
        <div className="px-6 pb-3 flex items-center gap-4 text-xs text-blue-200">
          <span><i className="fas fa-calendar-alt mr-1"></i> {po_date || '—'}</span>
          <span><i className="fas fa-truck mr-1"></i> Lead: {lead_days}d → {expected_date || '—'}</span>
          <span><i className="fas fa-boxes mr-1"></i> {rows.length} item{rows.length !== 1 ? 's' : ''}</span>
          {markdown_mode && <span className="bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full font-bold"><i className="fas fa-tag mr-1"></i>Markdown Mode ON</span>}
        </div>
      </div>

      {/* ── Order Details Card ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* Card top accent */}
        <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg,#0E5C63,#7c3aed,#0ea5e9)' }}></div>
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <i className="fas fa-clipboard-list text-white text-xs"></i>
            </div>
            <span className="text-sm font-bold text-slate-700 tracking-wide">Order Details</span>
          </div>

          {/* Row 1: PO No | Date | Supplier | Outlet */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-3">
            {/* PO Number */}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">PO Number</label>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <i className="fas fa-hashtag text-blue-400 text-xs"></i>
                <input value={po_no} readOnly
                  className="bg-transparent text-sm font-black text-blue-700 font-mono w-full outline-none" />
              </div>
            </div>
            {/* Date */}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Order Date</label>
              <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 hover:border-blue-300 transition-colors">
                <i className="fas fa-calendar text-slate-400 text-xs"></i>
                <input type="date" value={po_date} onChange={e => set_po_date(e.target.value)}
                  className="bg-transparent text-sm text-slate-700 w-full outline-none" />
              </div>
            </div>
            {/* Supplier */}
            <div className="md:col-span-4">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Supplier <span className="text-red-400">*</span>
              </label>
              <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 hover:border-blue-300 transition-colors focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                <i className="fas fa-truck text-indigo-400 text-xs shrink-0"></i>
                <select value={supplier_id} onChange={e => on_supplier_change(e.target.value)}
                  className="bg-transparent text-sm text-slate-700 w-full outline-none appearance-none cursor-pointer">
                  <option value="">— Choose Supplier —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.city ? ` (${s.city})` : ''}</option>)}
                </select>
                <i className="fas fa-chevron-down text-slate-300 text-[10px] shrink-0"></i>
              </div>
            </div>
            {/* Delivery / Multi-Outlet Mode */}
            <div className="md:col-span-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Delivery Outlet <span className="text-red-400">*</span>
                </label>
                {!is_edit && (
                  <label className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-500 cursor-pointer hover:text-indigo-600 transition-colors">
                    <input type="checkbox" className="rounded text-indigo-500 focus:ring-indigo-400"
                      checked={is_multi_outlet} onChange={e => {
                        set_is_multi_outlet(e.target.checked)
                        if (e.target.checked) set_outlet_id('')
                      }} />
                    Multi-Outlet Distribution
                  </label>
                )}
              </div>
              
              {!is_multi_outlet ? (
                <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 hover:border-blue-300 transition-colors focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                  <i className="fas fa-store text-emerald-400 text-xs shrink-0"></i>
                  <select value={outlet_id} onChange={e => set_outlet_id(e.target.value)}
                    className="bg-transparent text-sm text-slate-700 w-full outline-none appearance-none cursor-pointer">
                    <option value="">— Select Outlet —</option>
                    {outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}{o.city ? ` — ${o.city}` : ''}</option>)}
                  </select>
                  <i className="fas fa-chevron-down text-slate-300 text-[10px] shrink-0"></i>
                </div>
              ) : (
                <div className="border border-indigo-200 bg-indigo-50/30 rounded-xl p-2 max-h-24 overflow-y-auto">
                  <div className="flex flex-wrap gap-1.5">
                    {outlets.map(o => (
                      <label key={o.id} className="flex items-center gap-1 text-[11px] bg-white border border-slate-200 px-2 py-1 rounded cursor-pointer hover:bg-slate-50 transition-colors">
                        <input type="checkbox" checked={selected_outlets.includes(o.id)}
                          onChange={e => {
                            if (e.target.checked) set_selected_outlets(p => [...p, o.id])
                            else set_selected_outlets(p => p.filter(id => id !== o.id))
                          }}
                          className="rounded text-indigo-500 w-3 h-3" />
                        <span className={selected_outlets.includes(o.id) ? 'font-bold text-indigo-700' : 'text-slate-600'}>{o.outlet_name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Lead Days | Expected Delivery | Markdown toggle */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            {/* Lead Days */}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Lead Days</label>
              <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 hover:border-blue-300 transition-colors">
                <i className="fas fa-clock text-amber-400 text-xs"></i>
                <input type="number" value={lead_days} min={1} max={90}
                  onChange={e => on_lead_change(Number(e.target.value))}
                  className="bg-transparent text-sm font-black text-slate-700 w-full text-center outline-none" />
                <span className="text-[10px] text-slate-400 shrink-0">days</span>
              </div>
            </div>
            {/* Expected Delivery */}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Expected Delivery</label>
              <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 hover:border-blue-300 transition-colors">
                <i className="fas fa-calendar-check text-green-400 text-xs"></i>
                <input type="date" value={expected_date} onChange={e => set_expected_date(e.target.value)}
                  className="bg-transparent text-sm text-slate-700 w-full outline-none" />
              </div>
            </div>
            {/* Markdown toggle */}
            <div className="md:col-span-4 flex items-center gap-4 pb-1">
              <button onClick={() => set_markdown_mode(m => !m)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 font-semibold text-sm transition-all ${
                  markdown_mode
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300'
                }`}>
                <div className={`relative w-9 h-5 rounded-full transition-colors ${markdown_mode ? 'bg-blue-500' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${markdown_mode ? 'left-4' : 'left-0.5'}`}></span>
                </div>
                <span><i className="fas fa-tag mr-1.5"></i>Markdown Mode</span>
              </button>
              {markdown_mode && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center border-2 border-blue-300 rounded-xl overflow-hidden">
                    <input type="number" value={global_md_pct} min={0} max={99} step={0.5}
                      onChange={e => set_global_md_pct(Number(e.target.value))}
                      className="w-16 text-center text-sm font-bold text-blue-700 px-2 py-2 outline-none" placeholder="%" />
                    <span className="px-2 text-blue-400 text-xs font-bold bg-blue-50">%</span>
                  </div>
                  <button onClick={apply_global_markdown}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors">
                    Apply All
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Terms & Conditions ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="h-1 w-full bg-amber-400"></div>
        <div className="p-5">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center">
                <i className="fas fa-file-contract text-white text-xs"></i>
              </div>
              <span className="text-sm font-bold text-slate-700 tracking-wide">Terms & Conditions</span>
            </div>
            <button onClick={() => set_dyn_terms(t => [...t, { title: '', description: '' }])}
              className="flex items-center gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg font-bold transition-colors">
              <i className="fas fa-plus text-[10px]"></i> Add Condition
            </button>
          </div>

        {/* Fixed terms */}
        {fixed_terms.length > 0 ? (
          <div className="mb-3">
            <div className="text-xs text-slate-400 font-semibold mb-1">🔒 Fixed (from supplier):</div>
            {fixed_terms.map((t, i) => (
              <div key={i} className="bg-blue-50 border-l-4 border-blue-400 px-3 py-1.5 rounded-r text-xs mb-1">
                <b className="text-blue-700">{t.label}:</b> {t.text}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic mb-2">Select a supplier to auto-load terms…</div>
        )}

        {/* Dynamic terms */}
        {dyn_terms.length > 0 && (
          <div className="space-y-2 mt-2">
            <div className="text-xs text-slate-400 font-semibold mb-1">✏️ Dynamic (PO-specific):</div>
            {dyn_terms.map((t, i) => (
              <div key={i} className="flex gap-2 items-start bg-green-50 border border-green-200 rounded-xl p-3">
                <div className="flex-1 space-y-1.5">
                  <input value={t.title} onChange={e => {
                    const next = [...dyn_terms]; next[i] = { ...next[i], title: e.target.value }; set_dyn_terms(next)
                  }} placeholder="Condition title…"
                  className="w-full border border-green-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-300 bg-white" />
                  <input value={t.description} onChange={e => {
                    const next = [...dyn_terms]; next[i] = { ...next[i], description: e.target.value }; set_dyn_terms(next)
                  }} placeholder="Description (optional)…"
                  className="w-full border border-green-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-300 bg-white" />
                </div>
                <button onClick={() => set_dyn_terms(prev => prev.filter((_, j) => j !== i))}
                  className="w-7 h-7 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-sm font-bold transition-colors mt-0.5">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* Items Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-4 py-2.5 flex justify-between items-center">
          <div className="font-bold text-sm flex items-center gap-2">
            <span>📦</span> Items Grid
            <span className="bg-white/20 text-xs px-2 py-0.5 rounded-full">{rows.length} items</span>
          </div>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="checkbox" checked={inc_outlet_stock}
              onChange={e => set_inc_outlet_stock(e.target.checked)}
              className="rounded" />
            Include Outlet Stock in Suggestions
          </label>
        </div>

        <div className="overflow-x-auto" style={{ maxHeight: '55vh' }}>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600 min-w-[180px]">Item</th>
                <th className="px-2 py-2 text-center font-semibold text-blue-700 min-w-[70px]" title="Stock On Hand">SOH</th>
                <th className="px-2 py-2 text-center font-semibold min-w-[80px]" title="Days On Hand — click for breakdown">DOH ℹ</th>
                <th className="px-2 py-2 text-center font-semibold text-slate-500 min-w-[60px]">7d Sale</th>
                <th className="px-2 py-2 text-center font-semibold text-slate-500 min-w-[60px]">30d Sale</th>
                <th className="px-2 py-2 text-center font-semibold text-cyan-700 bg-cyan-50 min-w-[65px]">Avg/Day</th>
                <th className="px-2 py-2 text-center font-semibold text-amber-700 bg-amber-50 min-w-[75px]">Suggested</th>
                {is_multi_outlet ? selected_outlets.map(oid => {
                  const outl = outlets.find(o => o.id === oid)
                  return <th key={oid} className="px-2 py-2 text-center font-bold text-indigo-800 bg-indigo-100 min-w-[70px]">{outl?.outlet_name?.substring(0, 10)}</th>
                }) : (
                  <th className="px-2 py-2 text-center font-bold text-yellow-800 bg-yellow-100 min-w-[85px]">Order Qty</th>
                )}
                {is_multi_outlet && <th className="px-2 py-2 text-center font-bold text-slate-800 bg-slate-200 min-w-[85px]">Total Qty</th>}
                {markdown_mode ? (
                  <>
                    <th className="px-2 py-2 text-center font-semibold min-w-[80px]">MRP</th>
                    <th className="px-2 py-2 text-center font-semibold min-w-[65px]">MD%</th>
                  </>
                ) : null}
                <th className="px-2 py-2 text-center font-semibold min-w-[80px]">Rate</th>
                <th className="px-2 py-2 text-right font-semibold min-w-[90px]">Amount</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(row => {
                const sugg = suggested_qty(row)
                const amt  = row.order_qty * row.rate
                return (
                  <tr key={row.rid} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-blue-700 leading-tight">{row.name}</div>
                      <div className="text-slate-400 font-mono text-[10px]">{row.item_code}</div>
                    </td>
                    <td className="px-2 py-2 text-center font-bold text-blue-700 bg-blue-50/50">
                      {fmt(row.intel.soh)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] cursor-pointer ${doh_class(row.intel.doh)}`}
                        onClick={() => show_doh(row.product_id, row.name)}
                        title="Click for outlet breakdown"
                      >
                        {row.intel.doh !== null ? `${row.intel.doh.toFixed(1)}d` : 'N/A'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center text-slate-500">{fmt(row.intel.sale_7d, 1)}</td>
                    <td className="px-2 py-2 text-center text-slate-500">{fmt(row.intel.sale_30d, 1)}</td>
                    <td className="px-2 py-2 text-center text-cyan-700 bg-cyan-50/30 font-semibold">
                      {fmt(row.intel.avg_daily_sale, 2)}
                    </td>
                    <td className="px-2 py-2 text-center text-amber-700 bg-amber-50/30 font-bold">
                      {fmt(sugg, 1)}
                    </td>
                    {is_multi_outlet ? selected_outlets.map(oid => (
                      <td key={oid} className="px-1 py-1">
                        <input
                          type="number" min={0} step={1}
                          value={row.distributions[oid] || ''}
                          onChange={e => update_row(row.rid, 'distributions', { oid, val: Number(e.target.value) })}
                          className="w-full text-center font-black text-sm border border-indigo-200 rounded px-1 py-0.5 focus:outline-none focus:border-indigo-500"
                          placeholder="0"
                        />
                      </td>
                    )) : (
                      <td className="px-2 py-1">
                        <input
                          type="number" min={0} step={1}
                          value={row.order_qty || ''}
                          onChange={e => update_row(row.rid, 'order_qty', Number(e.target.value))}
                          className="w-full text-center font-black text-base border-2 border-yellow-400 rounded px-1 py-0.5 focus:outline-none focus:border-yellow-500"
                          placeholder="0"
                        />
                      </td>
                    )}
                    {is_multi_outlet && (
                      <td className="px-2 py-2 text-center font-bold text-lg text-slate-700 bg-slate-50/50">
                        {row.order_qty}
                      </td>
                    )}
                    {markdown_mode ? (
                      <>
                        <td className="px-2 py-1">
                          <input type="number" min={0} step={0.01}
                            value={row.mrp || ''}
                            onChange={e => update_row(row.rid, 'mrp', Number(e.target.value))}
                            className="w-full text-center border rounded px-1 py-0.5 bg-yellow-50 focus:outline-none focus:ring-1 focus:ring-yellow-400"
                            placeholder="MRP"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" min={0} max={99} step={0.5}
                            value={row.markdown_percent || ''}
                            onChange={e => update_row(row.rid, 'markdown_percent', Number(e.target.value))}
                            className="w-full text-center border rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                            placeholder="%"
                          />
                        </td>
                      </>
                    ) : null}
                    <td className="px-2 py-1">
                      <input type="number" min={0} step={0.01}
                        value={row.rate || ''}
                        onChange={e => update_row(row.rid, 'rate', Number(e.target.value))}
                        className={`w-full text-center border rounded px-1 py-0.5 font-semibold focus:outline-none focus:ring-1 focus:ring-blue-400 ${markdown_mode ? 'bg-slate-50' : ''}`}
                        readOnly={markdown_mode}
                        placeholder="Rate"
                      />
                    </td>
                    <td className={`px-2 py-2 text-right font-bold font-mono ${row.mrp > 0 && row.rate > row.mrp ? 'text-red-600' : 'text-slate-800'}`}>
                      ₹{fmt(amt, 2)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button onClick={() => remove_row(row.rid)}
                        className="text-slate-300 hover:text-red-500 transition-colors text-base">×</button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-slate-400">
                    <div className="text-3xl mb-2">📦</div>
                    Search and add items using the search box below
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Search bar */}
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
            <input
              value={search_q}
              onChange={e => on_search(e.target.value)}
              onBlur={() => setTimeout(() => set_search_open(false), 180)}
              onFocus={() => search_results.length && set_search_open(true)}
              placeholder="Search item by name, code, barcode…"
              className="w-full border border-slate-200 rounded-lg pl-7 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {search_open && search_q.trim().length >= 2 && (
              <div className="absolute z-50 left-0 right-0 bottom-full mb-1 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-72 overflow-y-auto">
                {search_loading ? (
                  <div className="px-4 py-5 text-center text-slate-400 text-xs">
                    <i className="fas fa-spinner fa-spin mr-2 text-blue-400"></i>
                    Searching for "<b className="text-slate-600">{search_q}</b>"…
                  </div>
                ) : search_results.length === 0 ? (
                  <div className="px-4 py-5 text-center text-slate-400 text-xs">
                    <div className="text-2xl mb-1">🔍</div>
                    No items found for "<b className="text-slate-600">{search_q}</b>"
                    <div className="text-[10px] mt-1 text-slate-300">Try item code, barcode, or different keywords</div>
                  </div>
                ) : (
                  search_results.map(p => (
                    <button key={p.id} onMouseDown={() => add_item(p)}
                      className="w-full text-left px-3 py-2.5 hover:bg-blue-50 flex justify-between items-center border-b border-slate-50 last:border-0 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                          <i className="fas fa-box text-blue-500 text-[10px]"></i>
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800 text-xs leading-tight">{p.name}</div>
                          <div className="text-slate-400 text-[10px] font-mono">{p.item_code}{p.barcode ? ` · ${p.barcode}` : ''}</div>
                        </div>
                      </div>
                      <div className="text-right text-[10px] text-slate-500 shrink-0 ml-2">
                        <div className="font-bold text-slate-700">₹{p.mrp}</div>
                        <div className="text-slate-400">{p.unit} · {p.gst_percent}% GST</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="text-xs text-slate-500">
            Total Ordered: <b className="text-blue-700">{fmt(rows.reduce((s,r)=>s+r.order_qty,0))}</b>
            &nbsp;|&nbsp;
            Suggested Total: <b className="text-amber-600">{fmt(rows.reduce((s,r)=>s+suggested_qty(r),0))}</b>
          </div>
          <div className="ml-auto font-black text-lg text-red-600">
            ₹{fmt(grand_total, 2)}
          </div>
        </div>
      </div>

      {/* Notes + Actions */}
      <div className="flex gap-4 items-start">
        <textarea value={notes} onChange={e => set_notes(e.target.value)}
          rows={2} placeholder="Internal notes / remarks…"
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
        <div className="flex gap-2 flex-col items-end">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => submit('draft')} disabled={saving}
              className="px-4 py-2.5 bg-slate-600 text-white rounded-xl text-sm font-bold hover:bg-slate-700 disabled:opacity-50">
              {saving ? '…' : '💾 Save Draft'}
            </button>
            <button onClick={() => submit('pending_approval')} disabled={saving}
              className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
              📤 Submit for Approval
            </button>
            <button onClick={() => submit('approved')} disabled={saving}
              className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-50 shadow-md">
              ✓ Approve & Finalize
            </button>
          </div>
        </div>
      </div>

      {/* DOH Modal */}
      {doh_popup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-5 py-3 rounded-t-2xl flex justify-between">
              <div>
                <div className="font-bold">📦 DOH Breakdown</div>
                <div className="text-xs text-slate-300">{doh_popup.name}</div>
              </div>
              <button onClick={() => set_doh_popup(null)} className="text-white/70 hover:text-white text-xl">×</button>
            </div>
            <div className="p-4">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Outlet</th>
                    <th className="px-3 py-2 text-center">Stock</th>
                    <th className="px-3 py-2 text-center">Avg Sale/Day</th>
                    <th className="px-3 py-2 text-center">DOH</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {doh_popup.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium">{r.outlet_name}</td>
                      <td className="px-3 py-2 text-center">{fmt(r.current_qty, 1)}</td>
                      <td className="px-3 py-2 text-center">{fmt(r.avg_sale, 2)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full ${doh_class(r.doh)}`}>
                          {r.doh !== null ? `${r.doh.toFixed(1)}d` : 'N/A'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex gap-3 text-[10px] text-slate-500">
                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">&lt;3d Critical</span>
                <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold">3–7d Low</span>
                <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">&gt;7d OK</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
