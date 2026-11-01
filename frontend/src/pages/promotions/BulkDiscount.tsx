// Promotions → Bulk Discount: quantity-tier pricing (10–24 = 5%, 25–49 = 8%, 50+ = 12% / ₹ per unit).
// Saved as scheme type BULK_TIER, so the POS preview, the server-side apply at save, the usage log and the
// report are the same engine as Schemes.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { schemes_api, type scheme_form, type scheme_row, type scheme_slab } from '../../api/schemes'
import { masters_api } from '../../api/masters'
import type { product_search_item } from '../../api/products'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import ProductSearchInput from '../../components/ProductSearchInput'
import { EMPTY, Sec, Num, Chk, Chips, CustTypes, CUSTOMER_TYPES, Simulator, Report, errMsg, inr, STATE_CLS } from './Schemes'

const APPLY_ON = [['category', 'Category'], ['brand', 'Brand'], ['brand_category', 'Brand + Category'], ['item', 'Selected items'], ['invoice', 'All items']]
const tier = (min = 0): scheme_slab => ({ min_qty: min, max_qty: 0, min_value: 0, free_qty: 0, discount_percent: 0, discount_percent2: 0, discount_value: 0, free_item_id: null })
const NEW: scheme_form = { ...EMPTY, scheme_type: 'BULK_TIER', apply_on: 'category', priority: 3, end_date: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
  slabs: [{ ...tier(10), max_qty: 24, discount_percent: 5 }, { ...tier(25), max_qty: 49, discount_percent: 8 }, { ...tier(50), discount_percent: 12 }] }
const tierText = (s: scheme_slab) => [Number(s.discount_percent) ? `${Number(s.discount_percent)}%` : '', Number(s.discount_value) ? `₹${Number(s.discount_value)}/unit` : '']
  .filter(Boolean).join(' + ')

export default function BulkDiscount() {
  const [tab, setTab] = useState<'list' | 'sim' | 'report'>('list')
  const [rows, setRows] = useState<scheme_row[]>([])
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<scheme_form | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [outlets, setOutlets] = useState<{ id: number; outlet_name: string; unit_code: string }[]>([])
  const [brands, setBrands] = useState<{ id: number; name: string }[]>([])
  const [cats, setCats] = useState<{ id: number; name: string }[]>([])

  const load = () => {
    setLoading(true)
    schemes_api.list({ status, search, kind: 'bulk' }).then(r => setRows(r.data)).catch(e => toast.error(errMsg(e))).finally(() => setLoading(false))
  }
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h) }, [status, search])
  useEffect(() => {
    masters_api.get_outlets().then(r => setOutlets(r.data || [])).catch(() => {})
    masters_api.get_brands().then(r => setBrands((r.data as any[]) || [])).catch(() => {})
    masters_api.get_item_categories().then(r => setCats((r.data as any[]) || [])).catch(() => {})
  }, [])

  const openEdit = async (id: number) => {
    try {
      const { data } = await schemes_api.get(id)
      const f = { ...NEW } as any
      for (const k of Object.keys(NEW)) f[k] = (data as any)[k] ?? (NEW as any)[k]
      f.max_benefit_per_invoice = Number(f.max_benefit_per_invoice)
      f.slabs = (data.slabs || []).map(s => ({ ...tier(), ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'free_item_id' ? v : Number(v)])) }))
      f.start_time = f.start_time?.slice(0, 5) || null; f.end_time = f.end_time?.slice(0, 5) || null
      setEditId(id); setForm(f); setNames(data.product_names)
    } catch (e) { toast.error(errMsg(e)) }
  }
  const set = <K extends keyof scheme_form>(k: K, v: scheme_form[K]) => setForm(f => f && ({ ...f, [k]: v }))
  async function save() {
    if (!form) return
    setSaving(true)
    try {
      if (editId) await schemes_api.update(editId, form); else await schemes_api.create(form)
      toast.success(editId ? 'Rule updated' : 'Rule created'); setForm(null); load()
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast.success(msg); load() } catch (e) { toast.error(errMsg(e)) } }
  const counts = rows.reduce((a, r) => ({ ...a, [r.state]: (a[r.state] || 0) + 1 }), {} as Record<string, number>)
  const target = (r: scheme_row) => r.apply_on === 'brand' ? r.brand_name : r.apply_on === 'category' ? r.category_name
    : r.apply_on === 'brand_category' ? `${r.brand_name} / ${r.category_name}` : r.apply_on === 'item' ? `${r.item_count} item(s)` : 'All items'

  return (
    <div className="space-y-4">
      <PageHeader title="Bulk Discount" subtitle="Quantity-tier pricing — buy more, pay less per unit. Applied automatically at the POS and re-checked on save."
        action={<button className="btn btn-primary" onClick={() => { setEditId(null); setForm({ ...NEW, slabs: NEW.slabs.map(s => ({ ...s })) }); setNames({}) }}>
          <i className="fas fa-plus mr-2" />New Rule</button>} />

      <div className="flex gap-1 border-b border-border">
        {([['list', 'Rules', 'fa-layer-group'], ['sim', 'Test a bill', 'fa-calculator'], ['report', 'Report', 'fa-chart-bar']] as const).map(([k, l, i]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === k ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
            <i className={`fas ${i} mr-2`} />{l}</button>))}
      </div>

      {tab === 'list' && <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(['active', 'upcoming', 'expired', 'inactive'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`bg-app-card border rounded-fiori p-3 text-left ${status === s ? 'border-primary' : 'border-border'}`}>
              <span className="block text-[12px] text-text-secondary capitalize">{s} rules</span>
              <span className="block text-[18px] font-semibold">{status === 'all' || status === s ? (counts[s] || 0) : '—'}</span></button>))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input className="form-input !w-72" placeholder="Search rule…" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="form-input !w-auto" value={status} onChange={e => setStatus(e.target.value)}>
            {['all', 'active', 'upcoming', 'expired', 'inactive'].map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select>
        </div>
        <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
          <table className="ent-table min-w-[1050px]">
            <thead><tr><th>Rule</th><th>Applies to</th><th>Tiers</th><th>Customers</th><th>Validity</th><th className="!text-right">Used</th><th>Status</th><th className="!text-right">Actions</th></tr></thead>
            <tbody>
              {loading && !rows.length ? <tr><td colSpan={8} className="text-center text-text-muted !py-10">Loading…</td></tr>
                : !rows.length ? <tr><td colSpan={8} className="text-center text-text-muted !py-10">No bulk rules yet — click <b>New Rule</b></td></tr>
                : rows.map(r => (
                  <tr key={r.id}>
                    <td><button className="font-semibold text-text-link hover:underline text-left" onClick={() => openEdit(r.id)}>{r.name}</button>
                      <div className="text-[11px] text-text-muted">{r.qty_basis === 'total' ? 'Tier by total qty of all matching items' : 'Tier by each item’s qty'}</div></td>
                    <td className="text-[12px]">{target(r)}<div className="text-text-muted">{r.outlet_ids?.length ? `${r.outlet_ids.length} outlet(s)` : 'All outlets'}</div></td>
                    <td><div className="flex flex-wrap gap-1">{r.slabs.map((s, i) => (
                      <span key={i} className="text-[11px] bg-orange-50 text-orange-800 border border-orange-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                        {Number(s.min_qty)}{Number(s.max_qty) ? `–${Number(s.max_qty)}` : '+'}: <b>{tierText(s)}</b></span>))}</div></td>
                    <td className="text-[12px] capitalize">{r.customer_types?.length ? r.customer_types.join(', ') : 'All'}</td>
                    <td className="text-[12px] whitespace-nowrap">{r.start_date} → {r.end_date}</td>
                    <td className="!text-right text-[12px]">{r.bills} bills<div className="text-text-muted">{inr(r.discount_given)}</div></td>
                    <td><span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${STATE_CLS[r.state]}`}>{r.state}</span></td>
                    <td className="!text-right whitespace-nowrap">
                      <button className="btn btn-secondary !px-2" title="Edit" onClick={() => openEdit(r.id)}><i className="fas fa-pen" /></button>{' '}
                      <button className="btn btn-secondary !px-2" title={r.is_active ? 'Pause' : 'Activate'}
                        onClick={() => act(() => schemes_api.toggle(r.id), r.is_active ? 'Paused' : 'Activated')}><i className={`fas ${r.is_active ? 'fa-pause' : 'fa-play'}`} /></button>{' '}
                      <button className="btn btn-secondary !px-2" title="Clone (saved paused)" onClick={() => act(() => schemes_api.clone(r.id), 'Cloned — edit and activate it')}><i className="fas fa-copy" /></button>{' '}
                      <button className="btn btn-secondary !px-2 text-red-600" title="Delete"
                        onClick={() => window.confirm(`Delete rule "${r.name}"?`) && act(() => schemes_api.remove(r.id), 'Deleted')}><i className="fas fa-trash" /></button>
                    </td>
                  </tr>))}
            </tbody>
          </table>
        </div>
      </>}

      {tab === 'sim' && <Simulator outlets={outlets} />}
      {tab === 'report' && <Report outlets={outlets} rows={rows} />}

      {form && (
        <Modal title={editId ? `Edit bulk rule — ${form.name}` : 'New bulk discount rule'} open onClose={() => setForm(null)} width="max-w-4xl">
          <BulkForm f={form} set={set} names={names} nameOf={(p: product_search_item) => setNames(n => ({ ...n, [p.id]: p.name }))} outlets={outlets} brands={brands} cats={cats} />
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border">
            <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : editId ? 'Update rule' : 'Create rule'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BulkForm({ f, set, names, nameOf, outlets, brands, cats }: {
  f: scheme_form; set: <K extends keyof scheme_form>(k: K, v: scheme_form[K]) => void; names: Record<string, string>; nameOf: (p: product_search_item) => void
  outlets: { id: number; outlet_name: string }[]; brands: { id: number; name: string }[]; cats: { id: number; name: string }[]
}) {
  const upd = (i: number, k: keyof scheme_slab, v: number) => set('slabs', f.slabs.map((s, j) => j === i ? { ...s, [k]: v } : s))
  const last = f.slabs[f.slabs.length - 1]
  const example = f.slabs.find(s => s.min_qty > 0 && (s.discount_percent > 0 || s.discount_value > 0))
  return (
    <div className="space-y-3">
      <Sec title="Rule">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2"><label className="form-label">Rule name *</label>
            <input className="form-input" value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Beverages wholesale slab" /></div>
          <div><label className="form-label">Apply on</label>
            <select className="form-input" value={f.apply_on} onChange={e => set('apply_on', e.target.value)}>{APPLY_ON.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <Num label="Priority (1 = first)" value={f.priority} step="1" onChange={v => set('priority', Math.max(1, v))} />
          {(f.apply_on === 'brand' || f.apply_on === 'brand_category') && <div><label className="form-label">Brand *</label>
            <select className="form-input" value={f.brand_id ?? ''} onChange={e => set('brand_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— select —</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
          {(f.apply_on === 'category' || f.apply_on === 'brand_category') && <div><label className="form-label">Category *</label>
            <select className="form-input" value={f.category_id ?? ''} onChange={e => set('category_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— select —</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        </div>
        {f.apply_on === 'item' && <div className="space-y-1.5">
          <ProductSearchInput placeholder="Add item — name / code / barcode…" onSelect={p => { nameOf(p); if (!f.product_ids.includes(p.id)) set('product_ids', [...f.product_ids, p.id]) }} />
          <Chips ids={f.product_ids} names={names} onRemove={id => set('product_ids', f.product_ids.filter(x => x !== id))} /></div>}
        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-[13px]"><input type="radio" checked={f.qty_basis === 'line'} onChange={() => set('qty_basis', 'line')} />Tier by each item’s own qty</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="radio" checked={f.qty_basis === 'total'} onChange={() => set('qty_basis', 'total')} />Tier by total qty of all matching items (mix any)</label>
        </div>
      </Sec>

      <Sec title="Quantity tiers">
        <table className="ent-table">
          <thead><tr><th>From qty *</th><th>To qty (blank = and above)</th><th>Discount %</th><th>+ Extra %</th><th>₹ off per unit</th><th /></tr></thead>
          <tbody>{f.slabs.map((s, i) => <tr key={i}>
            <td><input className="form-input !h-8" type="number" min="0" value={s.min_qty || ''} onChange={e => upd(i, 'min_qty', Number(e.target.value || 0))} /></td>
            <td><input className="form-input !h-8" type="number" min="0" value={s.max_qty || ''} placeholder="∞" onChange={e => upd(i, 'max_qty', Number(e.target.value || 0))} /></td>
            <td><input className="form-input !h-8" type="number" min="0" max="100" step="0.01" value={s.discount_percent || ''} onChange={e => upd(i, 'discount_percent', Number(e.target.value || 0))} /></td>
            <td><input className="form-input !h-8" type="number" min="0" max="100" step="0.01" value={s.discount_percent2 || ''} onChange={e => upd(i, 'discount_percent2', Number(e.target.value || 0))} /></td>
            <td><input className="form-input !h-8" type="number" min="0" step="0.01" value={s.discount_value || ''} onChange={e => upd(i, 'discount_value', Number(e.target.value || 0))} /></td>
            <td><button className="text-red-600" onClick={() => set('slabs', f.slabs.filter((_, j) => j !== i))}><i className="fas fa-trash" /></button></td>
          </tr>)}</tbody>
        </table>
        <div className="flex items-center justify-between">
          <button className="btn btn-secondary !py-1" onClick={() => set('slabs', [...f.slabs, tier(last ? (last.max_qty || last.min_qty) + 1 : 1)])}><i className="fas fa-plus mr-1" />Add tier</button>
          {example && <span className="text-[12px] text-text-secondary">e.g. {example.min_qty} pcs at ₹100 → pay {inr(
            Math.max(0, example.min_qty * 100 * (1 - example.discount_percent / 100) * (1 - example.discount_percent2 / 100) - example.discount_value * example.min_qty))} instead of {inr(example.min_qty * 100)}</span>}
        </div>
        <div className="text-[11px] text-text-muted">Tiers can’t overlap; only the last one may be open-ended. Discount is on the selling price (GST incl.).</div>
      </Sec>

      <Sec title="Validity & who gets it">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="form-label">From date *</label><input className="form-input" type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} /></div>
          <div><label className="form-label">To date *</label><input className="form-input" type="date" value={f.end_date} onChange={e => set('end_date', e.target.value)} /></div>
          <Num label="Max discount per bill ₹ (0 = no cap)" value={f.max_benefit_per_invoice} onChange={v => set('max_benefit_per_invoice', v)} />
        </div>
        <CustTypes value={f.customer_types} onChange={v => set('customer_types', v)} />
        {!f.customer_types.length && <div className="text-[11px] text-amber-700">Tip: tick <b>{CUSTOMER_TYPES[1][1]}</b> for trade-only slabs — walk-in retail customers then pay the normal price.</div>}
        <div><label className="form-label">Outlets — none ticked = all outlets</label>
          <div className="flex flex-wrap gap-x-4 gap-y-1 max-h-24 overflow-y-auto">{outlets.map(o => <Chk key={o.id} label={o.outlet_name} checked={f.outlet_ids.includes(o.id)}
            onChange={v => set('outlet_ids', v ? [...f.outlet_ids, o.id] : f.outlet_ids.filter(x => x !== o.id))} />)}</div></div>
        <div className="flex flex-wrap gap-5">
          <Chk label="Active" checked={f.is_active} onChange={v => set('is_active', v)} />
          <Chk label="Can combine with other schemes" checked={f.is_combination_allowed} onChange={v => set('is_combination_allowed', v)} />
        </div>
      </Sec>
    </div>
  )
}
