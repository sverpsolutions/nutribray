// Promotions → Schemes. Port of NCG Schemes (index / create / edit / view / simulate / report).
// The scheme engine runs on the server (POST /schemes/evaluate); POS bills re-run it at save.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { schemes_api, type scheme_form, type scheme_row, type scheme_type, type eval_result } from '../../api/schemes'
import { masters_api } from '../../api/masters'
import { customers_api, type customer_list_item } from '../../api/customers'
import type { product_search_item } from '../../api/products'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import ProductSearchInput from '../../components/ProductSearchInput'

const TYPES: { code: scheme_type; label: string; help: string }[] = [
  { code: 'QTY_SLAB', label: 'Quantity Slab (Buy X Get Y Free)', help: 'Buy a quantity of an item → free qty and/or discount. Add slabs for tiers (1–9, 10–24, 25+).' },
  { code: 'VALUE_DISC', label: 'Value-Based Discount', help: '% or ₹ off when the eligible value reaches a minimum. Value slabs give bigger % on bigger bills.' },
  { code: 'FREE_ITEM', label: 'Free Item (Same / Different)', help: 'Buying the trigger item(s) gives one or more free products.' },
  { code: 'MIX_MATCH', label: 'Mix and Match', help: 'Every group must be bought (min qty from each) → discount or a free item on the whole mix.' },
  { code: 'CARTON', label: 'Carton-Based', help: 'Triggered by full cartons (qty ÷ carton size).' },
  { code: 'CHEAPEST_FREE', label: 'Buy N — Cheapest Free (2+1)', help: 'Pick any N qualifying items; the lowest-MRP one(s) are free. Min Qty = group size (2+1 → 3).' },
  { code: 'CASH_DISC', label: 'Cash Discount', help: 'Extra % off the bill when paid by cash / UPI / card (not credit).' },
  { code: 'TARGET', label: 'Customer Target Bonus', help: "Bonus % once a customer's purchases in the scheme period cross the target. Paid once per customer." },
  { code: 'CREDIT_NOTE', label: 'Credit Note Scheme', help: 'No discount on the bill — records a credit note % earned, for settlement later.' },
]
const APPLY_ON = [['item', 'Selected items'], ['brand', 'Brand'], ['category', 'Category'], ['brand_category', 'Brand + Category'], ['invoice', 'Whole bill (all items)']]
export const STATE_CLS: Record<string, string> = {
  active: 'bg-green-100 text-green-700', upcoming: 'bg-blue-100 text-blue-700', expired: 'bg-slate-100 text-slate-500', inactive: 'bg-red-100 text-red-600',
}
const today = () => new Date().toISOString().slice(0, 10)
export const inr = (v: string | number) => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const errMsg = (e: any): string => {
  const d = e?.response?.data?.detail
  if (typeof d !== 'string') return e?.message || 'Something went wrong'
  const msgs = [...d.matchAll(/'msg': ["'](?:Value error, )?(.*?)["'], 'input'/g)].map(m => m[1])
  return msgs.length ? msgs.join(' • ') : d
}
export const EMPTY: scheme_form = {
  name: '', scheme_type: 'VALUE_DISC', apply_on: 'item', priority: 5, start_date: today(), end_date: today(),
  start_time: null, end_time: null, is_active: true, outlet_ids: [], customer_ids: [], product_ids: [],
  customer_types: [], qty_basis: 'line',
  brand_id: null, category_id: null, min_qty: 0, min_value: 0, discount_percent: 0, discount_percent2: 0, discount_value: 0,
  free_qty: 0, free_item_id: null, is_recursive: false, is_combination_allowed: true, max_benefit_per_invoice: 0,
  expiry_days_trigger: null, target_amount: 0, credit_note_percent: 0, credit_note_timing: 'immediate', carton_size: 1,
  slabs: [], free_items: [], mix_groups: [], notes: null,
}

function benefit(r: scheme_row) {
  const p = Number(r.discount_percent), p2 = Number(r.discount_percent2), v = Number(r.discount_value), f = Number(r.free_qty)
  const parts = []
  if (r.scheme_type === 'CHEAPEST_FREE') return `Buy ${Number(r.min_qty) - (f || 1)} get ${f || 1} free`
  if (p) parts.push(`${p}%` + (p2 ? ` + ${p2}%` : ''))
  if (v) parts.push(inr(v) + ' off')
  if (f) parts.push(`${f} free` + (Number(r.min_qty) ? ` on ${Number(r.min_qty)}` : ''))
  return parts.join(', ') || 'see slabs'
}

export default function Schemes() {
  const [tab, setTab] = useState<'list' | 'sim' | 'report'>('list')
  const [rows, setRows] = useState<scheme_row[]>([])
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<scheme_form | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})   // product id -> name for chips
  const [custNames, setCustNames] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [outlets, setOutlets] = useState<{ id: number; outlet_name: string; unit_code: string }[]>([])
  const [brands, setBrands] = useState<{ id: number; name: string }[]>([])
  const [cats, setCats] = useState<{ id: number; name: string }[]>([])

  const load = () => {
    setLoading(true)
    schemes_api.list({ status, search }).then(r => setRows(r.data)).catch(e => toast.error(errMsg(e))).finally(() => setLoading(false))
  }
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h) }, [status, search])
  useEffect(() => {
    masters_api.get_outlets().then(r => setOutlets(r.data || [])).catch(() => {})
    masters_api.get_brands().then(r => setBrands((r.data as any[]) || [])).catch(() => {})
    masters_api.get_item_categories().then(r => setCats((r.data as any[]) || [])).catch(() => {})
  }, [])

  const openNew = () => { setEditId(null); setForm({ ...EMPTY }); setNames({}); setCustNames({}) }
  const openEdit = async (id: number) => {
    try {
      const { data } = await schemes_api.get(id)
      const f = { ...EMPTY } as any
      for (const k of Object.keys(EMPTY)) f[k] = (data as any)[k] ?? (EMPTY as any)[k]
      for (const k of ['min_qty', 'min_value', 'discount_percent', 'discount_percent2', 'discount_value', 'free_qty',
                       'max_benefit_per_invoice', 'target_amount', 'credit_note_percent']) f[k] = Number(f[k])
      f.start_time = f.start_time?.slice(0, 5) || null; f.end_time = f.end_time?.slice(0, 5) || null
      setEditId(id); setForm(f); setNames(data.product_names); setCustNames(data.customer_names)
    } catch (e) { toast.error(errMsg(e)) }
  }
  const set = <K extends keyof scheme_form>(k: K, v: scheme_form[K]) => setForm(f => f && ({ ...f, [k]: v }))
  const nameOf = (p: product_search_item) => setNames(n => ({ ...n, [p.id]: p.name }))

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      if (editId) await schemes_api.update(editId, form)
      else await schemes_api.create(form)
      toast.success(editId ? 'Scheme updated' : 'Scheme created')
      setForm(null); load()
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast.success(msg); load() } catch (e) { toast.error(errMsg(e)) } }

  const counts = rows.reduce((a, r) => ({ ...a, [r.state]: (a[r.state] || 0) + 1 }), {} as Record<string, number>)

  return (
    <div className="space-y-4">
      <PageHeader title="Schemes" subtitle="Quantity slabs, value discounts, free items, mix & match, 2+1, cash discount, targets and credit notes — applied automatically at the POS"
        action={<button className="btn btn-primary" onClick={openNew}><i className="fas fa-plus mr-2" />New Scheme</button>} />

      <div className="flex gap-1 border-b border-border">
        {([['list', 'Schemes', 'fa-tags'], ['sim', 'Simulator', 'fa-calculator'], ['report', 'Report', 'fa-chart-bar']] as const).map(([k, l, i]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === k ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
            <i className={`fas ${i} mr-2`} />{l}
          </button>
        ))}
      </div>

      {tab === 'list' && <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(['active', 'upcoming', 'expired', 'inactive'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`bg-app-card border rounded-fiori p-3 text-left ${status === s ? 'border-primary' : 'border-border'}`}>
              <span className="block text-[12px] text-text-secondary capitalize">{s}</span>
              <span className="block text-[18px] font-semibold">{status === 'all' || status === s ? (counts[s] || 0) : '—'}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input className="form-input !w-72" placeholder="Search scheme name…" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="form-input !w-auto" value={status} onChange={e => setStatus(e.target.value)}>
            {['all', 'active', 'upcoming', 'expired', 'inactive'].map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
          <table className="ent-table min-w-[1100px]">
            <thead><tr>
              <th>Scheme</th><th>Type</th><th>Applies to</th><th>Benefit</th><th>Validity</th><th className="!text-center">Priority</th>
              <th className="!text-right">Used</th><th>Status</th><th className="!text-right">Actions</th>
            </tr></thead>
            <tbody>
              {loading && !rows.length ? <tr><td colSpan={9} className="text-center text-text-muted !py-10">Loading…</td></tr>
                : !rows.length ? <tr><td colSpan={9} className="text-center text-text-muted !py-10">No schemes yet — click <b>New Scheme</b></td></tr>
                : rows.map(r => (
                  <tr key={r.id}>
                    <td>
                      <button className="font-semibold text-text-link hover:underline text-left" onClick={() => openEdit(r.id)}>{r.name}</button>
                      {!r.is_combination_allowed && <div className="text-[11px] text-amber-600">Exclusive — stops other schemes</div>}
                    </td>
                    <td className="text-[12px]">{r.type_label}</td>
                    <td className="text-[12px]">
                      {r.apply_on === 'item' ? (r.item_count ? `${r.item_count} item(s)` : 'All items')
                        : r.apply_on === 'brand' ? r.brand_name : r.apply_on === 'category' ? r.category_name
                        : r.apply_on === 'brand_category' ? `${r.brand_name} / ${r.category_name}` : r.apply_on === 'mix_match' ? 'Mix groups' : 'Whole bill'}
                      <div className="text-text-muted">{r.outlet_ids?.length ? `${r.outlet_ids.length} outlet(s)` : 'All outlets'}</div>
                    </td>
                    <td className="text-[12px] font-semibold">{benefit(r)}{Number(r.min_value) > 0 && <div className="text-text-muted font-normal">min {inr(r.min_value)}</div>}</td>
                    <td className="text-[12px] whitespace-nowrap">{r.start_date} → {r.end_date}
                      {r.start_time && <div className="text-text-muted">{r.start_time.slice(0, 5)}–{r.end_time?.slice(0, 5)}</div>}</td>
                    <td className="!text-center">{r.priority}</td>
                    <td className="!text-right text-[12px]">{r.bills} bills<div className="text-text-muted">{inr(r.discount_given)}</div></td>
                    <td><span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${STATE_CLS[r.state]}`}>{r.state}</span></td>
                    <td className="!text-right whitespace-nowrap">
                      <button className="btn btn-secondary !px-2" title="Edit" onClick={() => openEdit(r.id)}><i className="fas fa-pen" /></button>{' '}
                      <button className="btn btn-secondary !px-2" title={r.is_active ? 'Deactivate' : 'Activate'}
                        onClick={() => act(() => schemes_api.toggle(r.id), r.is_active ? 'Deactivated' : 'Activated')}>
                        <i className={`fas ${r.is_active ? 'fa-pause' : 'fa-play'}`} /></button>{' '}
                      <button className="btn btn-secondary !px-2" title="Clone (saved inactive)" onClick={() => act(() => schemes_api.clone(r.id), 'Cloned — edit and activate it')}><i className="fas fa-copy" /></button>{' '}
                      <button className="btn btn-secondary !px-2 text-red-600" title="Delete"
                        onClick={() => window.confirm(`Delete scheme "${r.name}"?`) && act(() => schemes_api.remove(r.id), 'Deleted')}><i className="fas fa-trash" /></button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </>}

      {tab === 'sim' && <Simulator outlets={outlets} />}
      {tab === 'report' && <Report outlets={outlets} rows={rows} />}

      {form && (
        <Modal title={editId ? `Edit scheme — ${form.name}` : 'New scheme'} open onClose={() => setForm(null)} width="max-w-5xl">
          <SchemeFormBody form={form} set={set} names={names} nameOf={nameOf} custNames={custNames} setCustNames={setCustNames}
            outlets={outlets} brands={brands} cats={cats} />
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border">
            <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : editId ? 'Update scheme' : 'Create scheme'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── form ────────────────────────────────────────────────────────────────────

type FormProps = {
  form: scheme_form; set: <K extends keyof scheme_form>(k: K, v: scheme_form[K]) => void
  names: Record<string, string>; nameOf: (p: product_search_item) => void
  custNames: Record<string, string>; setCustNames: (f: (n: Record<string, string>) => Record<string, string>) => void
  outlets: { id: number; outlet_name: string; unit_code: string }[]; brands: { id: number; name: string }[]; cats: { id: number; name: string }[]
}

export const Sec = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border border-border rounded-lg p-3 space-y-3">
    <div className="text-[12px] font-bold uppercase tracking-wide text-text-secondary">{title}</div>{children}
  </div>
)
export const Num = ({ label, value, onChange, step = '0.01', hint }: { label: string; value: number | null; onChange: (v: number) => void; step?: string; hint?: string }) => (
  <div><label className="form-label">{label}</label>
    <input className="form-input" type="number" min="0" step={step} value={value ?? ''} onChange={e => onChange(Number(e.target.value || 0))} />
    {hint && <div className="text-[11px] text-text-muted mt-0.5">{hint}</div>}</div>
)
export const Chk = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-[13px] cursor-pointer"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />{label}</label>
)

export function Chips({ ids, names, onRemove }: { ids: number[]; names: Record<string, string>; onRemove: (id: number) => void }) {
  if (!ids.length) return null
  return <div className="flex flex-wrap gap-1.5">{ids.map(id => (
    <span key={id} className="text-[12px] bg-primary-light text-primary rounded-full pl-2.5 pr-1 py-0.5 flex items-center gap-1">
      {names[id] || `#${id}`}<button className="w-5 h-5 rounded-full hover:bg-white/60" onClick={() => onRemove(id)}>&times;</button></span>))}</div>
}

function SchemeFormBody({ form: f, set, names, nameOf, custNames, setCustNames, outlets, brands, cats }: FormProps) {
  const t = f.scheme_type
  const help = TYPES.find(x => x.code === t)?.help
  const [custQ, setCustQ] = useState('')
  const [custHits, setCustHits] = useState<customer_list_item[]>([])
  useEffect(() => {
    if (custQ.trim().length < 2) { setCustHits([]); return }
    const h = setTimeout(() => customers_api.list({ search: custQ.trim(), per_page: 10 }).then(r => setCustHits(r.data.data)).catch(() => {}), 250)
    return () => clearTimeout(h)
  }, [custQ])
  const addPid = (k: 'product_ids', p: product_search_item) => { nameOf(p); if (!f[k].includes(p.id)) set(k, [...f[k], p.id]) }
  const showApplyOn = t !== 'MIX_MATCH' && t !== 'CASH_DISC'
  const slab = (i: number, k: string, v: number) => set('slabs', f.slabs.map((s, j) => j === i ? { ...s, [k]: v } : s))
  const newSlab = { min_qty: 0, max_qty: 0, min_value: 0, free_qty: 0, discount_percent: 0, discount_percent2: 0, discount_value: 0, free_item_id: null }
  const pctFields = <>
    <Num label="Discount %" value={f.discount_percent} onChange={v => set('discount_percent', v)} />
    <Num label="+ Extra % (on the rest)" value={f.discount_percent2} onChange={v => set('discount_percent2', v)} hint="20% + 10% = 28% off, not 30%" />
  </>
  const freePick = (label: string) => (
    <div className="md:col-span-2"><label className="form-label">{label}</label>
      {f.free_item_id ? <Chips ids={[f.free_item_id]} names={names} onRemove={() => set('free_item_id', null)} />
        : <ProductSearchInput placeholder="Free product (blank = same item)…" onSelect={p => { nameOf(p); set('free_item_id', p.id) }} />}</div>
  )

  return (
    <div className="space-y-3">
      <Sec title="Scheme">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2"><label className="form-label">Scheme name *</label>
            <input className="form-input" value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Amul Lassi Buy 10 Get 1" /></div>
          <div className="md:col-span-2"><label className="form-label">Scheme type *</label>
            <select className="form-input" value={t} onChange={e => set('scheme_type', e.target.value as scheme_type)}>
              {TYPES.map(x => <option key={x.code} value={x.code}>{x.label}</option>)}</select></div>
        </div>
        {help && <div className="text-[12px] bg-blue-50 text-blue-800 rounded-md px-3 py-2"><i className="fas fa-info-circle mr-1.5" />{help}</div>}
        <div className="flex flex-wrap gap-5 items-end">
          <div className="w-28"><Num label="Priority (1 = first)" value={f.priority} step="1" onChange={v => set('priority', Math.max(1, v))} /></div>
          <Chk label="Active" checked={f.is_active} onChange={v => set('is_active', v)} />
          <Chk label="Can combine with other schemes" checked={f.is_combination_allowed} onChange={v => set('is_combination_allowed', v)} />
        </div>
      </Sec>

      <Sec title="Validity & who gets it">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="form-label">From date *</label><input className="form-input" type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} /></div>
          <div><label className="form-label">To date *</label><input className="form-input" type="date" value={f.end_date} onChange={e => set('end_date', e.target.value)} /></div>
          <div><label className="form-label">From time (optional)</label><input className="form-input" type="time" value={f.start_time ?? ''} onChange={e => set('start_time', e.target.value || null)} /></div>
          <div><label className="form-label">To time</label><input className="form-input" type="time" value={f.end_time ?? ''} onChange={e => set('end_time', e.target.value || null)} />
            <div className="text-[11px] text-text-muted mt-0.5">Happy hours; 22:00→02:00 works overnight</div></div>
        </div>
        <div>
          <label className="form-label">Outlets — none ticked = all outlets</label>
          <div className="flex flex-wrap gap-x-4 gap-y-1 max-h-28 overflow-y-auto">
            {outlets.map(o => <Chk key={o.id} label={o.outlet_name} checked={f.outlet_ids.includes(o.id)}
              onChange={v => set('outlet_ids', v ? [...f.outlet_ids, o.id] : f.outlet_ids.filter(x => x !== o.id))} />)}
          </div>
        </div>
        <CustTypes value={f.customer_types} onChange={v => set('customer_types', v)} />
        <div>
          <label className="form-label">Customers — none = every customer (incl. walk-in)</label>
          <Chips ids={f.customer_ids} names={custNames} onRemove={id => set('customer_ids', f.customer_ids.filter(x => x !== id))} />
          <div className="relative mt-1.5">
            <input className="form-input" placeholder="Add a customer — type name / phone…" value={custQ} onChange={e => setCustQ(e.target.value)} />
            {custHits.length > 0 && <div className="absolute z-10 bg-app-card border border-border rounded-md shadow-lg w-full max-h-48 overflow-y-auto">
              {custHits.map(c => <button key={c.id} className="block w-full text-left px-3 py-1.5 text-[13px] hover:bg-app-bg"
                onClick={() => { setCustNames(n => ({ ...n, [c.id]: c.name })); if (!f.customer_ids.includes(c.id)) set('customer_ids', [...f.customer_ids, c.id]); setCustQ(''); setCustHits([]) }}>
                {c.name} <span className="text-text-muted">{c.phone}</span></button>)}</div>}
          </div>
        </div>
      </Sec>

      {showApplyOn && <Sec title="Applies on">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="form-label">Apply on</label>
            <select className="form-input" value={f.apply_on} onChange={e => set('apply_on', e.target.value)}>
              {APPLY_ON.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          {(f.apply_on === 'brand' || f.apply_on === 'brand_category') && <div><label className="form-label">Brand *</label>
            <select className="form-input" value={f.brand_id ?? ''} onChange={e => set('brand_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— select —</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
          {(f.apply_on === 'category' || f.apply_on === 'brand_category') && <div><label className="form-label">Category *</label>
            <select className="form-input" value={f.category_id ?? ''} onChange={e => set('category_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— select —</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
          <div><Num label="Near-expiry only (days)" value={f.expiry_days_trigger} step="1" onChange={v => set('expiry_days_trigger', v || null)}
            hint="Blank = always. e.g. 30 = only stock expiring within 30 days" /></div>
        </div>
        {f.apply_on === 'item' && <div className="space-y-1.5">
          <label className="form-label">Items {['VALUE_DISC', 'CREDIT_NOTE', 'TARGET'].includes(t) ? '(none = all items)' : '*'}</label>
          <ProductSearchInput placeholder="Add item — name / code / barcode…" onSelect={p => addPid('product_ids', p)} />
          <Chips ids={f.product_ids} names={names} onRemove={id => set('product_ids', f.product_ids.filter(x => x !== id))} />
        </div>}
      </Sec>}

      <Sec title="Benefit">
        {t === 'QTY_SLAB' && <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Num label="Buy qty (min)" value={f.min_qty} onChange={v => set('min_qty', v)} />
            <Num label="Get free qty" value={f.free_qty} onChange={v => set('free_qty', v)} />
            {pctFields}
            <Num label="Flat ₹ off per line" value={f.discount_value} onChange={v => set('discount_value', v)} />
            {freePick('Free product')}
          </div>
          <Chk label="Repeat (buy 10 get 1 → buy 20 get 2)" checked={f.is_recursive} onChange={v => set('is_recursive', v)} />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between"><label className="form-label !mb-0">Quantity slabs (optional — override the above per tier)</label>
              <button className="btn btn-secondary !py-1" onClick={() => set('slabs', [...f.slabs, { ...newSlab }])}><i className="fas fa-plus mr-1" />Slab</button></div>
            {f.slabs.length > 0 && <table className="ent-table"><thead><tr><th>Min qty</th><th>Max qty (0 = no limit)</th><th>Free qty</th><th>Disc %</th><th>+ Extra %</th><th>₹ off</th><th /></tr></thead>
              <tbody>{f.slabs.map((s, i) => <tr key={i}>
                {(['min_qty', 'max_qty', 'free_qty', 'discount_percent', 'discount_percent2', 'discount_value'] as const).map(k =>
                  <td key={k}><input className="form-input !h-8" type="number" min="0" value={s[k]} onChange={e => slab(i, k, Number(e.target.value || 0))} /></td>)}
                <td><button className="text-red-600" onClick={() => set('slabs', f.slabs.filter((_, j) => j !== i))}><i className="fas fa-trash" /></button></td></tr>)}</tbody></table>}
          </div>
        </>}

        {t === 'VALUE_DISC' && <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Num label="Min eligible value ₹" value={f.min_value} onChange={v => set('min_value', v)} />
            {pctFields}
            <Num label="or Flat ₹ off" value={f.discount_value} onChange={v => set('discount_value', v)} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between"><label className="form-label !mb-0">Value slabs (optional — e.g. ₹1000 → 5%, ₹2500 → 8%)</label>
              <button className="btn btn-secondary !py-1" onClick={() => set('slabs', [...f.slabs, { ...newSlab }])}><i className="fas fa-plus mr-1" />Slab</button></div>
            {f.slabs.length > 0 && <table className="ent-table"><thead><tr><th>Bill value from ₹</th><th>Disc %</th><th>+ Extra %</th><th>₹ off</th><th /></tr></thead>
              <tbody>{f.slabs.map((s, i) => <tr key={i}>
                {(['min_value', 'discount_percent', 'discount_percent2', 'discount_value'] as const).map(k =>
                  <td key={k}><input className="form-input !h-8" type="number" min="0" value={s[k]} onChange={e => slab(i, k, Number(e.target.value || 0))} /></td>)}
                <td><button className="text-red-600" onClick={() => set('slabs', f.slabs.filter((_, j) => j !== i))}><i className="fas fa-trash" /></button></td></tr>)}</tbody></table>}
          </div>
        </>}

        {t === 'FREE_ITEM' && <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Num label="Min qty of trigger item" value={f.min_qty} onChange={v => set('min_qty', v)} />
            <Num label="Min value ₹" value={f.min_value} onChange={v => set('min_value', v)} />
          </div>
          <Chk label="Repeat for every multiple of min qty" checked={f.is_recursive} onChange={v => set('is_recursive', v)} />
          <label className="form-label">Free products *</label>
          <ProductSearchInput placeholder="Add free product…" onSelect={p => { nameOf(p); if (!f.free_items.some(x => x.product_id === p.id)) set('free_items', [...f.free_items, { product_id: p.id, qty: 1 }]) }} />
          {f.free_items.map((fi, i) => <div key={fi.product_id} className="flex items-center gap-2 text-[13px]">
            <span className="flex-1">{names[fi.product_id] || `#${fi.product_id}`}</span>
            <span>Qty</span><input className="form-input !w-24 !h-8" type="number" min="1" value={fi.qty}
              onChange={e => set('free_items', f.free_items.map((x, j) => j === i ? { ...x, qty: Number(e.target.value || 1) } : x))} />
            <button className="text-red-600" onClick={() => set('free_items', f.free_items.filter((_, j) => j !== i))}><i className="fas fa-trash" /></button></div>)}
        </>}

        {t === 'MIX_MATCH' && <>
          <div className="flex items-center justify-between"><label className="form-label !mb-0">Groups — the customer must buy the min qty from EVERY group</label>
            <button className="btn btn-secondary !py-1" onClick={() => set('mix_groups', [...f.mix_groups, { name: `Group ${String.fromCharCode(65 + f.mix_groups.length)}`, min_qty: 1, product_ids: [] }])}>
              <i className="fas fa-plus mr-1" />Group</button></div>
          {f.mix_groups.map((g, i) => {
            const upd = (v: Partial<typeof g>) => set('mix_groups', f.mix_groups.map((x, j) => j === i ? { ...x, ...v } : x))
            return <div key={i} className="border border-border rounded-md p-2 space-y-1.5">
              <div className="flex gap-2 items-center">
                <input className="form-input !w-40 !h-8" value={g.name} onChange={e => upd({ name: e.target.value })} />
                <span className="text-[12px]">min qty</span>
                <input className="form-input !w-20 !h-8" type="number" min="1" value={g.min_qty} onChange={e => upd({ min_qty: Number(e.target.value || 1) })} />
                <button className="text-red-600 ml-auto" onClick={() => set('mix_groups', f.mix_groups.filter((_, j) => j !== i))}><i className="fas fa-trash" /></button>
              </div>
              <ProductSearchInput placeholder="Add item to this group…" onSelect={p => { nameOf(p); if (!g.product_ids.includes(p.id)) upd({ product_ids: [...g.product_ids, p.id] }) }} />
              <Chips ids={g.product_ids} names={names} onRemove={id => upd({ product_ids: g.product_ids.filter(x => x !== id) })} />
            </div>
          })}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {pctFields}
            <Num label="or Flat ₹ off" value={f.discount_value} onChange={v => set('discount_value', v)} />
            <Num label="or Free qty" value={f.free_qty} onChange={v => set('free_qty', v)} />
            {f.free_qty > 0 && freePick('Free product *')}
          </div>
        </>}

        {t === 'CARTON' && <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Num label="Min cartons" value={f.min_qty} step="1" onChange={v => set('min_qty', v)} />
            <Num label="Carton size (if item has none)" value={f.carton_size} step="1" onChange={v => set('carton_size', Math.max(1, v))} />
            <Num label="Free pcs" value={f.free_qty} onChange={v => set('free_qty', v)} />
            {pctFields}
            {freePick('Free product')}
          </div>
          <Chk label="Repeat per carton multiple" checked={f.is_recursive} onChange={v => set('is_recursive', v)} />
        </>}

        {t === 'CHEAPEST_FREE' && <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Num label="Group size (2+1 → 3) *" value={f.min_qty} step="1" onChange={v => set('min_qty', v)} />
            <Num label="Free per group" value={f.free_qty || 1} step="1" onChange={v => set('free_qty', v)} />
          </div>
          <Chk label="Repeat (6 items → 2 free)" checked={f.is_recursive} onChange={v => set('is_recursive', v)} />
          {f.min_qty >= 2 && <div className="text-[12px] text-text-secondary">= Buy {f.min_qty - (f.free_qty || 1)} get {f.free_qty || 1} free; the lowest-MRP items are the free ones.</div>}
        </>}

        {t === 'CASH_DISC' && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Num label="Min bill value ₹" value={f.min_value} onChange={v => set('min_value', v)} />{pctFields}</div>}

        {t === 'TARGET' && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Num label="Target purchase ₹ (in scheme dates)" value={f.target_amount} onChange={v => set('target_amount', v)} />
          <Num label="Bonus % (on the bill that crosses it)" value={f.discount_percent} onChange={v => set('discount_percent', v)} /></div>}

        {t === 'CREDIT_NOTE' && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Num label="Min value ₹" value={f.min_value} onChange={v => set('min_value', v)} />
          <Num label="Credit note %" value={f.credit_note_percent} onChange={v => set('credit_note_percent', v)} />
          <div><label className="form-label">Issued</label><select className="form-input" value={f.credit_note_timing} onChange={e => set('credit_note_timing', e.target.value)}>
            <option value="immediate">Immediately</option><option value="end_of_month">End of month</option><option value="end_of_quarter">End of quarter</option></select></div>
        </div>}

        {t !== 'CREDIT_NOTE' && <div className="w-56"><Num label="Max benefit per bill ₹ (0 = no cap)" value={f.max_benefit_per_invoice} onChange={v => set('max_benefit_per_invoice', v)} /></div>}
      </Sec>

      <div><label className="form-label">Notes</label><textarea className="form-input" rows={2} value={f.notes ?? ''} onChange={e => set('notes', e.target.value || null)} /></div>
    </div>
  )
}

export const CUSTOMER_TYPES = [['retail', 'Retail'], ['wholesale', 'Wholesale'], ['hotel', 'Hotel / HoReCa'], ['institution', 'Institution']]
export function CustTypes({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return <div><label className="form-label">Customer types — none ticked = all types</label>
    <div className="flex flex-wrap gap-x-4">{CUSTOMER_TYPES.map(([k, l]) => <Chk key={k} label={l} checked={value.includes(k)}
      onChange={v => onChange(v ? [...value, k] : value.filter(x => x !== k))} />)}</div></div>
}

// ── simulator: try a cart against live schemes ──────────────────────────────

export function Simulator({ outlets }: { outlets: { id: number; outlet_name: string }[] }) {
  const [items, setItems] = useState<{ id: number; name: string; qty: number; rate: number; mrp: number; gst: number }[]>([])
  const [outletId, setOutletId] = useState<number | ''>('')
  const [mode, setMode] = useState('cash')
  const [billDate, setBillDate] = useState(today())
  const [at, setAt] = useState(new Date().toTimeString().slice(0, 5))
  const [cust, setCust] = useState<{ id: number; name: string } | null>(null)
  const [custQ, setCustQ] = useState('')
  const [custHits, setCustHits] = useState<customer_list_item[]>([])
  const [res, setRes] = useState<eval_result | null>(null)
  useEffect(() => {
    if (custQ.trim().length < 2) { setCustHits([]); return }
    const h = setTimeout(() => customers_api.list({ search: custQ.trim(), per_page: 10 }).then(r => setCustHits(r.data.data)).catch(() => {}), 250)
    return () => clearTimeout(h)
  }, [custQ])
  const run = () => schemes_api.evaluate({
    items: items.map(i => ({ product_id: i.id, qty: i.qty, rate: i.rate, gst: i.gst })), customer_id: cust?.id ?? 1,
    outlet_id: outletId || null, payment_mode: mode, bill_date: billDate, at: at + ':00',
  }).then(r => setRes(r.data)).catch(e => toast.error(errMsg(e)))
  const value = items.reduce((s, i) => s + i.qty * i.rate, 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-app-card border border-border rounded-fiori p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="form-label">Outlet</label><select className="form-input" value={outletId} onChange={e => setOutletId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">—</option>{outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></div>
          <div><label className="form-label">Payment</label><select className="form-input" value={mode} onChange={e => setMode(e.target.value)}>
            {['cash', 'upi', 'card', 'credit'].map(m => <option key={m}>{m}</option>)}</select></div>
          <div><label className="form-label">Bill date</label><input className="form-input" type="date" value={billDate} onChange={e => setBillDate(e.target.value)} /></div>
          <div><label className="form-label">Time</label><input className="form-input" type="time" value={at} onChange={e => setAt(e.target.value)} /></div>
        </div>
        <div className="relative"><label className="form-label">Customer {cust ? `— ${cust.name}` : '(Walk-in)'}</label>
          <input className="form-input" placeholder="Search customer…" value={custQ} onChange={e => setCustQ(e.target.value)} />
          {custHits.length > 0 && <div className="absolute z-10 bg-app-card border border-border rounded-md shadow-lg w-full max-h-48 overflow-y-auto">
            {custHits.map(c => <button key={c.id} className="block w-full text-left px-3 py-1.5 text-[13px] hover:bg-app-bg"
              onClick={() => { setCust({ id: c.id, name: c.name }); setCustQ(''); setCustHits([]) }}>{c.name} <span className="text-text-muted">{c.phone}</span></button>)}</div>}
        </div>
        <ProductSearchInput placeholder="Add item to the test bill…" onSelect={p => setItems(xs => [...xs, {
          id: p.id, name: p.name, qty: 1, rate: Number(p.selling_price || p.mrp || 0), mrp: Number(p.mrp || 0), gst: Number(p.gst_percent || 0) }])} />
        <table className="ent-table"><thead><tr><th>Item</th><th>Qty</th><th>Rate (incl. GST)</th><th className="!text-right">Value</th><th /></tr></thead>
          <tbody>{items.map((it, i) => <tr key={i}>
            <td className="text-[12px]">{it.name}<div className="text-text-muted">MRP {inr(it.mrp)}</div></td>
            <td><input className="form-input !w-20 !h-8" type="number" min="0" value={it.qty} onChange={e => setItems(xs => xs.map((x, j) => j === i ? { ...x, qty: Number(e.target.value || 0) } : x))} /></td>
            <td><input className="form-input !w-24 !h-8" type="number" min="0" value={it.rate} onChange={e => setItems(xs => xs.map((x, j) => j === i ? { ...x, rate: Number(e.target.value || 0) } : x))} /></td>
            <td className="!text-right">{inr(it.qty * it.rate)}{res && Number(res.line_discount[i]) > 0 && <div className="text-green-700 text-[12px]">−{inr(res.line_discount[i])}</div>}</td>
            <td><button className="text-red-600" onClick={() => { setItems(xs => xs.filter((_, j) => j !== i)); setRes(null) }}><i className="fas fa-trash" /></button></td></tr>)}</tbody></table>
        <div className="flex justify-between items-center"><span className="text-[13px]">Bill value <b>{inr(value)}</b></span>
          <button className="btn btn-primary" disabled={!items.length} onClick={run}><i className="fas fa-play mr-2" />Run schemes</button></div>
      </div>

      <div className="bg-app-card border border-border rounded-fiori p-4 space-y-3">
        {!res ? <div className="text-text-muted text-center py-16">Add items and click <b>Run schemes</b> to see exactly what the POS will give.</div> : <>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-app-bg rounded-md p-2"><div className="text-[12px] text-text-secondary">Bill value</div><div className="font-semibold">{inr(value)}</div></div>
            <div className="bg-green-50 rounded-md p-2"><div className="text-[12px] text-green-700">Scheme discount</div><div className="font-semibold text-green-700">−{inr(res.total_discount)}</div></div>
            <div className="bg-app-bg rounded-md p-2"><div className="text-[12px] text-text-secondary">Customer pays</div><div className="font-semibold">{inr(value - Number(res.total_discount))}</div></div>
          </div>
          {!res.applied.length && <div className="text-text-muted text-[13px]">No scheme applies to this bill.</div>}
          {res.applied.map((a, i) => <div key={i} className="border border-border rounded-md p-2 text-[13px]">
            <div className="flex justify-between font-semibold"><span><i className="fas fa-tag text-primary mr-1.5" />{a.scheme_name}</span>
              {Number(a.discount) > 0 && <span className="text-green-700">−{inr(a.discount)}</span>}</div>
            <div className="text-text-secondary">{a.note}</div>
            {a.free_items.map((fi, j) => <div key={j} className="text-purple-700"><i className="fas fa-gift mr-1" />{fi.name} × {Number(fi.qty)} FREE</div>)}
            {a.credit_note && <div className="text-blue-700"><i className="fas fa-file-invoice mr-1" />Credit note {inr(a.credit_note.amount)} ({a.credit_note.timing})</div>}
          </div>)}
          {res.info.map((x, i) => <div key={i} className="text-[12px] text-amber-700"><i className="fas fa-bullseye mr-1" />{x}</div>)}
        </>}
      </div>
    </div>
  )
}

// ── report ──────────────────────────────────────────────────────────────────

export function Report({ outlets, rows }: { outlets: { id: number; outlet_name: string }[]; rows: scheme_row[] }) {
  const first = today().slice(0, 8) + '01'
  const [p, setP] = useState({ from_date: first, to_date: today(), scheme_id: '', outlet_id: '' })
  const [data, setData] = useState<{ summary: any[]; detail: any[] } | null>(null)
  const run = () => schemes_api.report({ from_date: p.from_date, to_date: p.to_date, scheme_id: p.scheme_id ? Number(p.scheme_id) : undefined,
    outlet_id: p.outlet_id ? Number(p.outlet_id) : undefined }).then(r => setData(r.data)).catch(e => toast.error(errMsg(e)))
  useEffect(() => { run() }, [])
  const total = data?.summary.reduce((s, r) => s + Number(r.discount_given || 0), 0) ?? 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <div><label className="form-label">From</label><input className="form-input" type="date" value={p.from_date} onChange={e => setP({ ...p, from_date: e.target.value })} /></div>
        <div><label className="form-label">To</label><input className="form-input" type="date" value={p.to_date} onChange={e => setP({ ...p, to_date: e.target.value })} /></div>
        <div><label className="form-label">Scheme</label><select className="form-input" value={p.scheme_id} onChange={e => setP({ ...p, scheme_id: e.target.value })}>
          <option value="">All</option>{rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        <div><label className="form-label">Outlet</label><select className="form-input" value={p.outlet_id} onChange={e => setP({ ...p, outlet_id: e.target.value })}>
          <option value="">All</option>{outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></div>
        <button className="btn btn-primary" onClick={run}><i className="fas fa-search mr-2" />Show</button>
      </div>
      {data && <>
        <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
          <table className="ent-table"><thead><tr><th>Scheme</th><th>Type</th><th className="!text-right">Bills</th><th className="!text-right">Customers</th>
            <th className="!text-right">Free qty</th><th className="!text-right">Discount given</th></tr></thead>
            <tbody>{!data.summary.length ? <tr><td colSpan={6} className="text-center text-text-muted !py-8">No scheme was applied in this period</td></tr>
              : data.summary.map((r, i) => <tr key={i}><td className="font-semibold">{r.scheme_name}</td><td className="text-[12px]">{r.scheme_type}</td>
                <td className="!text-right">{r.bills}</td><td className="!text-right">{r.customers}</td><td className="!text-right">{Number(r.free_qty)}</td>
                <td className="!text-right">{inr(r.discount_given)}</td></tr>)}
              {data.summary.length > 0 && <tr className="font-bold"><td colSpan={5}>Total</td><td className="!text-right">{inr(total)}</td></tr>}</tbody></table>
        </div>
        {data.detail.length > 0 && <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
          <table className="ent-table min-w-[900px]"><thead><tr><th>When</th><th>Bill</th><th>Outlet</th><th>Customer</th><th>Scheme</th><th>Benefit</th><th className="!text-right">Discount</th></tr></thead>
            <tbody>{data.detail.map((r, i) => <tr key={i}>
              <td className="text-[12px] whitespace-nowrap">{String(r.applied_at).slice(0, 16).replace('T', ' ')}</td>
              <td><a className="text-text-link hover:underline" href={`/billing/invoices/${r.invoice_id}`}>{r.invoice_no}</a></td>
              <td className="text-[12px]">{r.outlet_name}</td><td className="text-[12px]">{r.customer}</td><td className="text-[12px]">{r.scheme_name}</td>
              <td className="text-[12px]">{r.benefit_type === 'free_item' ? `${Number(r.free_qty)} × ${r.free_product} free` : r.note}</td>
              <td className="!text-right">{Number(r.discount_given) > 0 ? inr(r.discount_given) : '—'}</td></tr>)}</tbody></table>
        </div>}
      </>}
    </div>
  )
}
