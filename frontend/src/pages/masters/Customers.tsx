// Customer Master: retail + wholesale (B2B) customers with GSTIN, billing/shipping address and credit terms.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { customers_api, type customer_list_item, type customer_summary, type customer_query, type ledger_row } from '../../api/customers'
import { states_api, type state_item } from '../../api/suppliers'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import StatusBadge from '../../components/ui/StatusBadge'

const TYPES = [['retail', 'Retail'], ['wholesale', 'Wholesale'], ['hotel', 'Hotel / HoReCa'], ['institution', 'Institution']]
const REG_TYPES = ['Regular', 'Composition', 'Unregistered', 'Consumer', 'SEZ']
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const PER_PAGE = 25

const EMPTY = {
  customer_code: '', name: '', contact_person: '', phone: '', alt_phone: '', email: '', type: 'retail',
  gst_registration_type: 'Unregistered', gst_number: '', pan_number: '', state: 'Delhi',
  address: '', city: '', pincode: '',
  shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: '',
  credit_limit: '0', credit_days: '0', discount_percent: '0', opening_balance: '0',
  show_outstanding_in_print: false, status: true, notes: '',
}
type Form = typeof EMPTY

const inr = (v: string | number) => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// backend 422s arrive as "VALIDATION ERROR: [{... 'msg': 'Value error, ...'}]" — pull out the readable messages
const errMsg = (e: any): string => {
  const d = e?.response?.data?.detail
  if (typeof d !== 'string') return e?.message || 'Something went wrong'
  const msgs = [...d.matchAll(/'msg': ["'](?:Value error, )?(.*?)["'], 'input'/g)].map(m => m[1])
  return msgs.length ? msgs.join(' • ') : d
}

export default function Customers() {
  const [rows, setRows] = useState<customer_list_item[]>([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<customer_summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState<customer_query>({ page: 1, status: 'active' })
  const [search, setSearch] = useState('')
  const [states, setStates] = useState<state_item[]>([])

  const [editId, setEditId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY)
  const [sameShip, setSameShip] = useState(true)
  const [gstMsg, setGstMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const [ledgerOf, setLedgerOf] = useState<customer_list_item | null>(null)
  const [ledger, setLedger] = useState<ledger_row[] | null>(null)

  const load = () => {
    setLoading(true)
    customers_api.list({ ...q, per_page: PER_PAGE })
      .then(r => { setRows(r.data.data); setTotal(r.data.total) })
      .catch(e => toast.error(errMsg(e)))
      .finally(() => setLoading(false))
    customers_api.summary().then(r => setSummary(r.data)).catch(() => {})
  }
  useEffect(load, [q])
  useEffect(() => { states_api.list().then(r => setStates(r.data)).catch(() => {}) }, [])
  // debounce the search box into the query
  useEffect(() => {
    const h = setTimeout(() => setQ(p => (p.search ?? '') === search.trim() ? p : { ...p, search: search.trim(), page: 1 }), 300)
    return () => clearTimeout(h)
  }, [search])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }))
  const filter = (patch: Partial<customer_query>) => setQ(p => ({ ...p, ...patch, page: 1 }))

  const openNew = () => { setEditId(null); setForm(EMPTY); setSameShip(true); setGstMsg(null); setFormOpen(true) }

  const openEdit = async (id: number) => {
    try {
      const c = (await customers_api.get(id)).data
      const f = Object.fromEntries(Object.keys(EMPTY).map(k => {
        const v = (c as any)[k]
        return [k, typeof (EMPTY as any)[k] === 'boolean' ? !!v : v == null ? '' : String(v)]
      })) as Form
      setForm(f)
      setSameShip(!f.shipping_address && !f.shipping_city && !f.shipping_pincode)
      setGstMsg(null); setEditId(id); setFormOpen(true)
    } catch (e) { toast.error(errMsg(e)) }
  }

  // GSTIN drives state + PAN + registration type; server re-checks everything on save
  const onGstin = async (raw: string) => {
    const g = raw.toUpperCase().replace(/\s/g, '')
    set('gst_number', g)
    setGstMsg(null)
    if (g.length !== 15) return
    if (!GSTIN_RE.test(g)) return setGstMsg({ ok: false, text: 'Invalid GSTIN format' })
    try {
      const r = (await states_api.validate_gstin(g)).data
      if (!r.valid) return setGstMsg({ ok: false, text: r.error || 'Invalid GSTIN' })
      setForm(f => ({
        ...f, pan_number: r.pan || g.slice(2, 12), state: r.state_name || f.state,
        gst_registration_type: ['Unregistered', 'Consumer'].includes(f.gst_registration_type) ? 'Regular' : f.gst_registration_type,
      }))
      setGstMsg({ ok: true, text: `Valid • ${r.state_name} (${r.state_code}) • PAN ${r.pan}` })
    } catch { /* offline check failed; server validates on save */ }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const { opening_balance, customer_code, status, ...rest } = form
    const body: Record<string, unknown> = {
      ...rest,
      credit_limit: Number(form.credit_limit || 0), credit_days: Number(form.credit_days || 0),
      discount_percent: Number(form.discount_percent || 0),
      ...(sameShip && { shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: '' }),
    }
    try {
      if (editId) await customers_api.update(editId, { ...body, status })
      else await customers_api.create({ ...body, customer_code, opening_balance: Number(opening_balance || 0) })
      toast.success(editId ? 'Customer updated' : 'Customer created')
      setFormOpen(false); load()
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }

  const toggleActive = async (c: customer_list_item) => {
    if (c.status && !confirm(`Deactivate ${c.name}? They will no longer appear in billing.`)) return
    try {
      if (c.status) await customers_api.delete(c.id)
      else await customers_api.update(c.id, { status: true })
      toast.success(c.status ? 'Customer deactivated' : 'Customer re-activated'); load()
    } catch (e) { toast.error(errMsg(e)) }
  }

  const openLedger = (c: customer_list_item) => {
    setLedgerOf(c); setLedger(null)
    customers_api.ledger(c.id).then(r => setLedger(r.data)).catch(e => { toast.error(errMsg(e)); setLedger([]) })
  }

  const exportCsv = async () => {
    const all: customer_list_item[] = []
    for (let page = 1; ; page++) {
      const r = (await customers_api.list({ ...q, page, per_page: 200 })).data
      all.push(...r.data)
      if (page >= r.total_pages) break
    }
    const cols: (keyof customer_list_item)[] = ['customer_code', 'name', 'contact_person', 'phone', 'email', 'type', 'gst_registration_type', 'gst_number', 'city', 'state', 'credit_limit', 'credit_days', 'balance']
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [cols.join(','), ...all.map(r => cols.map(c => cell(r[c])).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `customers_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const page = q.page ?? 1
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))
  const gstRequired = ['Regular', 'Composition', 'SEZ'].includes(form.gst_registration_type)
  const stateOptions = states.some(s => s.state_name === form.state) || !form.state ? states : [...states, { id: -1, state_name: form.state, state_code: '', is_ut: false }]

  const field = (label: string, k: keyof Form, opts: { type?: string; required?: boolean; placeholder?: string; span?: string; maxLength?: number } = {}) => (
    <div className={opts.span}>
      <label className="form-label">{label}{opts.required && <span className="text-red-500"> *</span>}</label>
      <input className="form-input" type={opts.type || 'text'} required={opts.required} placeholder={opts.placeholder} maxLength={opts.maxLength}
        step={opts.type === 'number' ? '0.01' : undefined} min={opts.type === 'number' && k !== 'opening_balance' ? 0 : undefined}
        value={form[k] as string} onChange={e => set(k, e.target.value as never)} />
    </div>
  )
  const stateSelect = (k: 'state' | 'shipping_state', required = false) => (
    <select className="form-input" required={required} value={form[k]} onChange={e => set(k, e.target.value)}>
      <option value="">Select state</option>
      {stateOptions.map(s => <option key={s.id} value={s.state_name}>{s.state_code ? `${s.state_code} - ` : ''}{s.state_name}</option>)}
    </select>
  )
  const section = (title: string) => <h4 className="col-span-full text-[12px] font-semibold uppercase tracking-wider text-primary border-b border-border pb-1 mt-2">{title}</h4>

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Customer Master" subtitle="Retail, wholesale & B2B customers with GST details and credit terms"
        action={<div className="flex gap-2">
          <button className="btn btn-secondary" onClick={exportCsv}><i className="fas fa-file-csv mr-2" />Export</button>
          <button className="btn btn-primary" onClick={openNew}><i className="fas fa-user-plus mr-2" />New Customer</button>
        </div>} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Active customers', summary?.active ?? '—', 'fa-users', () => filter({ status: 'active', type: undefined, gst: undefined })],
          ['Wholesale', summary?.wholesale ?? '—', 'fa-boxes', () => filter({ status: 'active', type: 'wholesale' })],
          ['B2B (GST registered)', summary?.b2b ?? '—', 'fa-file-invoice', () => filter({ status: 'active', gst: 'b2b' })],
          ['Total receivable', summary ? inr(summary.outstanding) : '—', 'fa-rupee-sign', null],
        ].map(([label, val, icon, onClick]) => (
          <button key={label as string} type="button" onClick={onClick as (() => void) | undefined} disabled={!onClick}
            className="bg-app-card border border-border rounded-fiori p-4 text-left flex items-center gap-3 enabled:hover:border-primary transition-colors">
            <span className="w-10 h-10 rounded-lg bg-primary-light text-primary flex items-center justify-center"><i className={`fas ${icon}`} /></span>
            <span>
              <span className="block text-[12px] text-text-secondary">{label as string}</span>
              <span className="block text-[18px] font-semibold text-text-primary">{val as string}</span>
            </span>
          </button>
        ))}
      </div>

      {/* filters */}
      <div className="bg-app-card border border-border rounded-fiori p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm" />
          <input className="form-input !pl-9" placeholder="Search name, code, phone, GSTIN, city, contact…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-input !w-auto" value={q.type ?? ''} onChange={e => filter({ type: e.target.value || undefined })}>
          <option value="">All types</option>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="form-input !w-auto" value={q.gst ?? ''} onChange={e => filter({ gst: (e.target.value || undefined) as customer_query['gst'] })}>
          <option value="">B2B + B2C</option>
          <option value="b2b">B2B (with GSTIN)</option>
          <option value="b2c">B2C (no GSTIN)</option>
        </select>
        <select className="form-input !w-auto" value={q.status} onChange={e => filter({ status: e.target.value as customer_query['status'] })}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>

      {/* table */}
      <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
        <table className="ent-table min-w-[1000px]">
          <thead>
            <tr>
              <th>Code</th><th>Customer</th><th>Phone</th><th>Type</th><th>GSTIN</th><th>City / State</th>
              <th className="!text-right">Credit</th><th className="!text-right">Balance</th><th>Status</th><th className="!text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? (
              <tr><td colSpan={10} className="text-center text-text-muted !py-10">Loading…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={10} className="text-center text-text-muted !py-10">No customers found</td></tr>
            ) : rows.map(c => {
              const over = Number(c.credit_limit) > 0 && Number(c.balance) > Number(c.credit_limit)
              return (
                <tr key={c.id}>
                  <td className="font-mono text-[12px] text-text-secondary">{c.customer_code}</td>
                  <td>
                    <button className="font-semibold text-text-link hover:underline text-left" onClick={() => openEdit(c.id)}>{c.name}</button>
                    {c.contact_person && <div className="text-[12px] text-text-muted">{c.contact_person}</div>}
                  </td>
                  <td>{c.phone}</td>
                  <td><span className="text-[12px] px-2 py-0.5 rounded-full bg-primary-light text-primary capitalize">{c.type}</span></td>
                  <td>
                    {c.gst_number
                      ? <><code className="text-[12px] font-mono">{c.gst_number}</code><div className="text-[11px] text-text-muted">{c.gst_registration_type}</div></>
                      : <span className="text-[12px] text-text-muted">{c.gst_registration_type || 'Unregistered'}</span>}
                  </td>
                  <td>{[c.city, c.state].filter(Boolean).join(', ') || '—'}</td>
                  <td className="text-right text-[12px]">
                    {Number(c.credit_limit) > 0 ? inr(c.credit_limit) : '—'}
                    {!!c.credit_days && <div className="text-text-muted">{c.credit_days} days</div>}
                  </td>
                  <td className={`text-right font-semibold ${over ? 'text-red-600' : Number(c.balance) > 0 ? 'text-amber-600' : 'text-text-secondary'}`}
                    title={over ? 'Over credit limit' : undefined}>
                    {inr(c.balance)}{over && <i className="fas fa-exclamation-triangle ml-1" />}
                  </td>
                  <td><StatusBadge active={c.status} /></td>
                  <td className="text-right whitespace-nowrap">
                    <button className="w-8 h-8 rounded-md text-text-secondary hover:bg-app-bg hover:text-primary" title="Edit" aria-label={`Edit ${c.name}`} onClick={() => openEdit(c.id)}><i className="fas fa-pen" /></button>
                    <button className="w-8 h-8 rounded-md text-text-secondary hover:bg-app-bg hover:text-primary" title="Ledger" aria-label={`Ledger of ${c.name}`} onClick={() => openLedger(c)}><i className="fas fa-book" /></button>
                    <button className={`w-8 h-8 rounded-md text-text-secondary hover:bg-app-bg ${c.status ? 'hover:text-red-600' : 'hover:text-green-600'}`}
                      title={c.status ? 'Deactivate' : 'Activate'} aria-label={`${c.status ? 'Deactivate' : 'Activate'} ${c.name}`} onClick={() => toggleActive(c)}>
                      <i className={`fas ${c.status ? 'fa-ban' : 'fa-undo'}`} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-[13px] text-text-secondary">
          <span>{total} customer{total === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setQ(p => ({ ...p, page: page - 1 }))}>Prev</button>
            <span>Page {page} of {pages}</span>
            <button className="btn btn-secondary" disabled={page >= pages} onClick={() => setQ(p => ({ ...p, page: page + 1 }))}>Next</button>
          </div>
        </div>
      </div>

      {/* create / edit */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editId ? `Edit Customer • ${form.customer_code}` : 'New Customer'} width="max-w-4xl">
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-3">
          {section('Basic details')}
          {field('Customer / Firm name', 'name', { required: true, span: 'md:col-span-2' })}
          {editId
            ? <div><label className="form-label">Customer code</label><input className="form-input" disabled value={form.customer_code} /></div>
            : field('Customer code', 'customer_code', { placeholder: 'Auto (CUST00001)', maxLength: 20 })}
          <div>
            <label className="form-label">Customer type <span className="text-red-500">*</span></label>
            <select className="form-input" value={form.type} onChange={e => set('type', e.target.value)}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {field('Contact person', 'contact_person')}
          {field('Mobile', 'phone', { required: true, type: 'tel', maxLength: 15 })}
          {field('Alternate phone', 'alt_phone', { type: 'tel', maxLength: 15 })}
          {field('Email', 'email', { type: 'email', span: 'md:col-span-2' })}

          {section('GST & tax')}
          <div>
            <label className="form-label">GST registration <span className="text-red-500">*</span></label>
            <select className="form-input" value={form.gst_registration_type} onChange={e => set('gst_registration_type', e.target.value)}>
              {REG_TYPES.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">GSTIN{gstRequired && <span className="text-red-500"> *</span>}</label>
            <input className="form-input font-mono uppercase" maxLength={15} required={gstRequired} placeholder="e.g. 07ABCDE1234F1Z5"
              value={form.gst_number} onChange={e => onGstin(e.target.value)} />
            {gstMsg && <span className={`form-helper ${gstMsg.ok ? '!text-green-600' : '!text-red-600'}`}>{gstMsg.text}</span>}
          </div>
          <div>
            <label className="form-label">PAN</label>
            <input className="form-input font-mono uppercase" maxLength={10} disabled={!!form.gst_number} placeholder="ABCDE1234F"
              value={form.pan_number} onChange={e => set('pan_number', e.target.value.toUpperCase())} />
            {form.gst_number && <span className="form-helper">Taken from GSTIN</span>}
          </div>

          {section('Billing address')}
          {field('Address', 'address', { span: 'md:col-span-3' })}
          {field('City', 'city')}
          <div>
            <label className="form-label">State (place of supply) <span className="text-red-500">*</span></label>
            {stateSelect('state', true)}
            {form.gst_number && <span className="form-helper">Taken from GSTIN</span>}
          </div>
          {field('Pincode', 'pincode', { maxLength: 6 })}

          <div className="col-span-full flex items-center justify-between border-b border-border pb-1 mt-2">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary">Shipping address</h4>
            <label className="text-[13px] text-text-secondary flex items-center gap-2">
              <input type="checkbox" checked={sameShip} onChange={e => setSameShip(e.target.checked)} /> Same as billing
            </label>
          </div>
          {!sameShip && <>
            {field('Address', 'shipping_address', { span: 'md:col-span-3' })}
            {field('City', 'shipping_city')}
            <div><label className="form-label">State</label>{stateSelect('shipping_state')}</div>
            {field('Pincode', 'shipping_pincode', { maxLength: 6 })}
          </>}

          {section('Credit & pricing')}
          {field('Credit limit (₹)', 'credit_limit', { type: 'number' })}
          {field('Credit period (days)', 'credit_days', { type: 'number' })}
          {field('Default discount %', 'discount_percent', { type: 'number' })}
          {editId
            ? <div><label className="form-label">Opening balance</label><input className="form-input" disabled value={inr(form.opening_balance)} /></div>
            : <div>{field('Opening balance (₹)', 'opening_balance', { type: 'number' })}<span className="form-helper">Positive = receivable (Dr), negative = advance (Cr)</span></div>}
          <label className="md:col-span-2 flex items-center gap-2 text-[13px] text-text-secondary self-end pb-2">
            <input type="checkbox" checked={form.show_outstanding_in_print} onChange={e => set('show_outstanding_in_print', e.target.checked)} />
            Print outstanding balance on invoices
          </label>

          {section('Other')}
          <div className="col-span-full">
            <label className="form-label">Notes</label>
            <textarea className="form-input !h-auto" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
          {editId && (
            <label className="col-span-full flex items-center gap-2 text-[13px] text-text-secondary">
              <input type="checkbox" checked={form.status} onChange={e => set('status', e.target.checked)} /> Active
            </label>
          )}

          <div className="col-span-full flex justify-end gap-2 pt-3 border-t border-border">
            <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editId ? 'Update Customer' : 'Save Customer'}</button>
          </div>
        </form>
      </Modal>

      {/* ledger */}
      <Modal open={!!ledgerOf} onClose={() => setLedgerOf(null)} title={`Ledger • ${ledgerOf?.name ?? ''}`} width="max-w-4xl">
        {!ledger ? <p className="text-text-muted text-center py-8">Loading…</p> : !ledger.length ? <p className="text-text-muted text-center py-8">No transactions yet</p> : (
          <table className="ent-table">
            <thead><tr><th>Date</th><th>Ref no.</th><th>Description</th><th className="!text-right">Debit</th><th className="!text-right">Credit</th><th className="!text-right">Balance</th></tr></thead>
            <tbody>
              {ledger.map((r, i) => (
                <tr key={i}>
                  <td>{r.date}</td><td className="font-mono text-[12px]">{r.ref_no}</td><td>{r.description}</td>
                  <td className="text-right">{Number(r.debit) ? inr(r.debit) : '—'}</td>
                  <td className="text-right">{Number(r.credit) ? inr(r.credit) : '—'}</td>
                  <td className="text-right font-semibold">{inr(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  )
}
