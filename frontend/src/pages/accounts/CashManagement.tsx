// Cash Management: branch safe & drawers, expenses, pay-ins, pickups, handovers (receiver accepts),
// bank deposits (accounts verifies), approvals, HO cash control and the cash book. Rules live in cash_service.py.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { masters_api } from '../../api/masters'
import { cash_api, type cash_approvals, type cash_control, type cash_entry, type cash_meta, type cash_position, type my_cash } from '../../api/cash'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'

const OUTLET_KEY = 'pos_outlet_id'
const inr = (v: unknown) => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dt = (v?: string | null) => v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const dmy = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const today = () => new Date().toLocaleDateString('en-CA')
const errMsg = (e: any) => { const d = e?.response?.data?.detail; return typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join(', ') : e?.message || 'Something went wrong' }

const KIND: Record<string, string> = { expense: 'Expense', pay_in: 'Pay-in', pickup: 'Pickup', float_out: 'Float', shift_close: 'Shift close', handover: 'Handover', deposit: 'Bank deposit', adjustment: 'Count variance' }
const STATUS: Record<string, string> = {
  posted: 'bg-green-100 text-green-700', pending: 'bg-amber-100 text-amber-700', rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500', void: 'bg-gray-100 text-gray-500',
}
const statusLabel = (e: cash_entry) => e.status === 'pending'
  ? (e.kind === 'expense' ? 'Awaiting approval' : e.kind === 'handover' ? 'In transit' : 'Awaiting bank check')
  : e.status === 'posted' && e.kind === 'deposit' ? 'Verified' : e.status === 'posted' && e.kind === 'handover' ? 'Accepted' : e.status

type Mode = 'expense' | 'pay_in' | 'handover' | 'deposit' | 'pickup'

function Stat({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="bg-app-card border border-border rounded-fiori px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`text-[20px] font-semibold ${tone || 'text-text-primary'}`}>{value}</div>
      {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
    </div>
  )
}

function Entries({ rows, actions, empty = 'Nothing here' }: { rows: cash_entry[]; actions?: (e: cash_entry) => React.ReactNode; empty?: string }) {
  if (!rows.length) return <p className="text-[13px] text-text-muted px-1">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="ent-table min-w-[980px]">
        <thead><tr><th>No.</th><th>Date</th><th>Type</th><th>From → To</th><th>Details</th><th className="!text-right">Amount</th><th>Status</th><th>By</th>{actions && <th></th>}</tr></thead>
        <tbody>{rows.map(e => (
          <tr key={e.id}>
            <td className="font-mono text-[12px] whitespace-nowrap">{e.entry_no}</td>
            <td className="whitespace-nowrap">{dmy(e.business_date)}</td>
            <td>{KIND[e.kind]}</td>
            <td className="text-[12px] min-w-[200px]">{e.from_label} <span className="text-text-muted">→</span> {e.to_label}</td>
            <td className="text-[12px] max-w-[260px]">
              {e.category_name && <b>{e.category_name}</b>}{e.party && <> · {e.party}</>}{e.ref_no && <> · <span className="font-mono">{e.ref_no}</span></>}
              {e.description && <div className="text-text-muted truncate" title={e.description}>{e.description}</div>}
              {e.attachment && <a href={e.attachment} target="_blank" rel="noreferrer" className="text-text-link"><i className="fas fa-paperclip mr-1" />proof</a>}
              {e.kind === 'deposit' && e.status === 'posted' && <div className="text-text-muted">Credited {inr(e.credited_amount)} · {e.bank_ref} · {dmy(e.credited_date)}</div>}
              {e.action_remarks && <div className="text-text-muted italic truncate" title={e.action_remarks}>“{e.action_remarks}”</div>}
            </td>
            <td className="text-right font-semibold whitespace-nowrap">{inr(e.amount)}</td>
            <td><span className={`text-[11px] px-2 py-0.5 rounded-full capitalize whitespace-nowrap ${STATUS[e.status]}`}>{statusLabel(e)}</span></td>
            <td className="text-[12px] whitespace-nowrap">{e.created_by_name}<div className="text-text-muted">{dt(e.created_at)}</div>
              {e.actioned_by_name && <div className="text-text-muted">✓ {e.actioned_by_name}</div>}</td>
            {actions && <td className="text-right whitespace-nowrap">{actions(e)}</td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function EntryForm({ mode, outletId, outletName, meta, outlets, position, onClose, onDone }: {
  mode: Mode | null; outletId: number; outletName: string; meta: cash_meta; outlets: { id: number; outlet_name: string }[]
  position: cash_position | null; onClose: () => void; onDone: () => void
}) {
  const [f, setF] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!mode) return
    setF({ source: mode === 'expense' ? 'drawer' : 'safe', from_type: 'safe', to_type: 'person', deposit_date: today(),
           shift_id: String(position?.drawers[0]?.shift_id ?? '') })
  }, [mode])
  const set = (k: string, v: string) => setF(x => ({ ...x, [k]: v }))
  const cats = meta.categories.filter(c => c.is_active && c.type === (mode === 'pay_in' ? 'pay_in' : 'expense'))
  const cat = cats.find(c => String(c.id) === f.category_id)
  const needsOk = mode === 'expense' && cat?.approval_limit != null && Number(f.amount || 0) > Number(cat.approval_limit)

  const upload = async (file?: File) => {
    if (!file) return
    try { set('attachment', (await cash_api.upload(file)).data.path); toast.success('Photo attached') } catch (e) { toast.error(errMsg(e)) }
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setBusy(true)
    const amount = Number(f.amount)
    const fromRef = f.from_type === 'safe' ? outletId : undefined
    try {
      if (mode === 'expense') await cash_api.expense({ outlet_id: outletId, source: f.source, category_id: Number(f.category_id), amount, party: f.party, ref_no: f.ref_no, description: f.description, attachment: f.attachment })
      if (mode === 'pay_in') await cash_api.pay_in({ outlet_id: outletId, target: f.source, category_id: Number(f.category_id), amount, party: f.party, description: f.description })
      if (mode === 'pickup') await cash_api.pickup({ shift_id: Number(f.shift_id), amount, description: f.description })
      if (mode === 'handover') await cash_api.handover({ from_type: f.from_type, from_ref: fromRef, to_type: f.to_type, to_ref: Number(f.to_ref), amount, description: f.description })
      if (mode === 'deposit') await cash_api.deposit({ from_type: f.from_type, from_ref: fromRef, bank_account_id: Number(f.bank_account_id), amount, slip_no: f.slip_no, deposit_date: f.deposit_date, attachment: f.attachment, description: f.description })
      toast.success(mode === 'handover' ? 'Handover sent — waiting for the receiver to accept'
        : mode === 'deposit' ? 'Deposit recorded — waiting for accounts to verify'
        : needsOk ? 'Expense sent for approval — do not pay until approved' : 'Saved')
      onDone()
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  const fromSelect = (
    <div><label className="form-label">From</label>
      <select className="form-input" value={f.from_type} onChange={e => set('from_type', e.target.value)}>
        {meta.is_manager && <option value="safe">Safe · {outletName}</option>}
        <option value="person">My cash in hand</option>
      </select></div>
  )
  const titles: Record<Mode, string> = { expense: 'Record Expense', pay_in: 'Cash Pay-in', handover: 'Cash Handover', deposit: 'Bank Deposit', pickup: 'Cash Pickup from Drawer' }

  return (
    <Modal open={!!mode} onClose={onClose} title={mode ? `${titles[mode]} • ${outletName}` : ''} width="max-w-2xl">
      {mode && (
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3">
          {(mode === 'expense' || mode === 'pay_in') && <>
            <div><label className="form-label">{mode === 'expense' ? 'Pay from' : 'Put into'}</label>
              <select className="form-input" value={f.source} onChange={e => set('source', e.target.value)}>
                <option value="drawer">My drawer (open shift)</option>
                {meta.is_manager && <option value="safe">Safe · {outletName}</option>}
              </select></div>
            <div><label className="form-label">Category <span className="text-red-500">*</span></label>
              <select className="form-input" required value={f.category_id ?? ''} onChange={e => set('category_id', e.target.value)}>
                <option value="">Select</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}{c.approval_limit != null ? ` (approval above ₹${Number(c.approval_limit)})` : ''}</option>)}
              </select></div>
            <div className="sm:col-span-2"><label className="form-label">{mode === 'expense' ? 'Paid to' : 'Received from'} <span className="text-red-500">*</span></label>
              <input className="form-input" required minLength={2} value={f.party ?? ''} onChange={e => set('party', e.target.value)} /></div>
          </>}
          {mode === 'pickup' && (
            <div className="sm:col-span-2"><label className="form-label">Drawer</label>
              <select className="form-input" required value={f.shift_id} onChange={e => set('shift_id', e.target.value)}>
                {(position?.drawers || []).map(d => <option key={d.shift_id} value={d.shift_id}>{d.cashier_name} · shift #{d.shift_id} · holds {inr(d.expected_cash)}</option>)}
              </select></div>
          )}
          {mode === 'handover' && <>
            {fromSelect}
            <div><label className="form-label">To</label>
              <select className="form-input" value={f.to_type} onChange={e => { set('to_type', e.target.value); set('to_ref', '') }}>
                <option value="person">A person (area manager / HO cashier)</option>
                <option value="safe">Another location's safe</option>
              </select></div>
            <div className="sm:col-span-2"><label className="form-label">Receiver <span className="text-red-500">*</span></label>
              <select className="form-input" required value={f.to_ref ?? ''} onChange={e => set('to_ref', e.target.value)}>
                <option value="">Select</option>
                {f.to_type === 'person'
                  ? meta.users.filter(u => u.id !== meta.me.id).map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)
                  : [{ id: 0, outlet_name: 'Head Office' }, ...outlets].filter(o => !(f.from_type === 'safe' && o.id === outletId)).map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}
              </select>
              <span className="form-helper">The cash stays “in transit” until the receiver counts it and accepts.</span></div>
          </>}
          {mode === 'deposit' && <>
            {fromSelect}
            <div><label className="form-label">Bank account <span className="text-red-500">*</span></label>
              <select className="form-input" required value={f.bank_account_id ?? ''} onChange={e => set('bank_account_id', e.target.value)}>
                <option value="">Select</option>
                {meta.bank_accounts.filter(b => b.is_active).map(b => <option key={b.id} value={b.id}>{b.name} · ****{b.account_no.slice(-4)}</option>)}
              </select>
              {!meta.bank_accounts.some(b => b.is_active) && <span className="form-helper !text-red-600">No bank account yet — admin adds it under Setup</span>}</div>
            <div><label className="form-label">Deposit slip no. <span className="text-red-500">*</span></label>
              <input className="form-input" required value={f.slip_no ?? ''} onChange={e => set('slip_no', e.target.value)} /></div>
            <div><label className="form-label">Deposit date</label>
              <input className="form-input" type="date" max={today()} value={f.deposit_date} onChange={e => set('deposit_date', e.target.value)} /></div>
          </>}
          <div><label className="form-label">Amount (₹) <span className="text-red-500">*</span></label>
            <input className="form-input" type="number" min={0.01} step="0.01" required value={f.amount ?? ''} onChange={e => set('amount', e.target.value)} />
            {needsOk && <span className="form-helper !text-amber-700">Above ₹{Number(cat!.approval_limit)} — goes to a manager for approval first</span>}</div>
          {mode === 'expense' && <div><label className="form-label">Bill no.{cat?.requires_bill && <span className="text-red-500"> *</span>}</label>
            <input className="form-input" required={!!cat?.requires_bill} value={f.ref_no ?? ''} onChange={e => set('ref_no', e.target.value)} /></div>}
          {(mode === 'expense' || mode === 'deposit') && (
            <div className="sm:col-span-2"><label className="form-label">{mode === 'deposit' ? 'Photo of stamped deposit slip' : 'Bill photo'}{(mode === 'deposit' || cat?.requires_bill) && <span className="text-red-500"> *</span>}</label>
              <input className="form-input" type="file" accept="image/*,application/pdf" capture="environment" onChange={e => upload(e.target.files?.[0])} />
              {f.attachment && <a className="form-helper !text-green-700" href={f.attachment} target="_blank" rel="noreferrer"><i className="fas fa-check mr-1" />Attached — view</a>}</div>
          )}
          <div className="sm:col-span-2"><label className="form-label">Remarks</label>
            <textarea className="form-input !h-auto" rows={2} value={f.description ?? ''} onChange={e => set('description', e.target.value)} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || ((mode === 'deposit' || (mode === 'expense' && cat?.requires_bill)) && !f.attachment)}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}

type Decision = { e: cash_entry; action: 'approve' | 'reject' | 'accept' | 'verify' | 'cancel' | 'void' }

function DecisionModal({ d, onClose, onDone }: { d: Decision | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (d) setF({ credited_amount: d.e.amount, credited_date: today() }) }, [d])
  if (!d) return null
  const { e, action } = d
  const isNo = action === 'reject' || action === 'cancel' || action === 'void'
  const go = async () => {
    setBusy(true)
    try {
      const r = f.remarks?.trim() || undefined
      if (e.kind === 'expense' && (action === 'approve' || action === 'reject')) await cash_api.expense_decision(e.id, action === 'approve', r)
      else if (e.kind === 'handover' && (action === 'accept' || action === 'reject')) await cash_api.handover_decision(e.id, action === 'accept', r)
      else if (e.kind === 'deposit' && (action === 'verify' || action === 'reject')) await cash_api.verify(e.id, action === 'verify'
        ? { ok: true, credited_amount: Number(f.credited_amount), bank_ref: f.bank_ref, credited_date: f.credited_date, remarks: r } : { ok: false, remarks: r })
      else if (action === 'cancel') await cash_api.cancel(e.id, r || '')
      else if (action === 'void') await cash_api.void(e.id, r || '')
      toast.success('Done'); onDone()
    } catch (err) { toast.error(errMsg(err)) } finally { setBusy(false) }
  }
  const verb = { approve: 'Approve expense', reject: 'Reject', accept: 'Accept cash', verify: 'Verify with bank statement', cancel: 'Cancel entry', void: 'Void entry' }[action]
  return (
    <Modal open onClose={onClose} title={`${verb} • ${e.entry_no}`} width="max-w-lg">
      <div className="space-y-3 text-[14px]">
        <div className="bg-app-bg rounded-lg p-3">
          <div className="flex justify-between"><span>{KIND[e.kind]} · {e.from_label} → {e.to_label}</span><b>{inr(e.amount)}</b></div>
          <div className="text-[12px] text-text-muted">{[e.category_name, e.party, e.ref_no, e.description].filter(Boolean).join(' · ')} · by {e.created_by_name}</div>
          {e.attachment && <a href={e.attachment} target="_blank" rel="noreferrer" className="text-text-link text-[12px]"><i className="fas fa-paperclip mr-1" />View proof</a>}
        </div>
        {action === 'accept' && <p className="text-amber-700 text-[13px] m-0">Count the cash first. Accept only if you received exactly {inr(e.amount)} — otherwise reject with the amount you got.</p>}
        {action === 'verify' && <div className="grid grid-cols-2 gap-3">
          <div><label className="form-label">Credited amount</label><input className="form-input" type="number" step="0.01" value={f.credited_amount} onChange={x => setF(v => ({ ...v, credited_amount: x.target.value }))} /></div>
          <div><label className="form-label">Credit date</label><input className="form-input" type="date" value={f.credited_date} onChange={x => setF(v => ({ ...v, credited_date: x.target.value }))} /></div>
          <div className="col-span-2"><label className="form-label">Bank reference / UTR <span className="text-red-500">*</span></label><input className="form-input" value={f.bank_ref ?? ''} onChange={x => setF(v => ({ ...v, bank_ref: x.target.value }))} /></div>
        </div>}
        <div><label className="form-label">{isNo ? 'Reason' : 'Remarks'}{isNo && <span className="text-red-500"> *</span>}</label>
          <textarea className="form-input !h-auto" rows={2} value={f.remarks ?? ''} onChange={x => setF(v => ({ ...v, remarks: x.target.value }))} /></div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>Back</button>
          <button className={`btn ${isNo ? 'bg-red-600 text-white hover:bg-red-700' : 'btn-primary'}`} disabled={busy} onClick={go}>{busy ? 'Saving…' : verb}</button>
        </div>
      </div>
    </Modal>
  )
}

export default function CashManagement() {
  const [meta, setMeta] = useState<cash_meta | null>(null)
  const [outlets, setOutlets] = useState<{ id: number; outlet_name: string }[]>([])
  const [outletId, setOutletId] = useState<number>(() => { try { return Number(localStorage.getItem(OUTLET_KEY)) || 0 } catch { return 0 } })
  const [tab, setTab] = useState('branch')
  const [pos, setPos] = useState<cash_position | null>(null)
  const [my, setMy] = useState<my_cash | null>(null)
  const [appr, setAppr] = useState<cash_approvals | null>(null)
  const [ctl, setCtl] = useState<cash_control | null>(null)
  const [book, setBook] = useState<cash_entry[]>([])
  const [bq, setBq] = useState({ from_date: today().slice(0, 8) + '01', to_date: today(), kind: '', status: '', search: '', all: false })
  const [mode, setMode] = useState<Mode | null>(null)
  const [dec, setDec] = useState<Decision | null>(null)

  const outletName = outletId === 0 ? 'Head Office' : outlets.find(o => o.id === outletId)?.outlet_name || `Outlet #${outletId}`
  useEffect(() => {
    cash_api.meta().then(r => setMeta(r.data)).catch(e => toast.error(errMsg(e)))
    masters_api.get_outlets().then(r => setOutlets(r.data || [])).catch(() => {})
  }, [])
  const load = () => {
    if (tab === 'branch') cash_api.position(outletId).then(r => setPos(r.data)).catch(e => toast.error(errMsg(e)))
    if (tab === 'my') cash_api.my().then(r => setMy(r.data)).catch(e => toast.error(errMsg(e)))
    if (tab === 'control') cash_api.control().then(r => setCtl(r.data)).catch(e => toast.error(errMsg(e)))
    if (tab === 'book') cash_api.entries({ ...bq, outlet_id: bq.all ? undefined : outletId, kind: bq.kind || undefined, status: bq.status || undefined, all: undefined })
      .then(r => setBook(r.data)).catch(e => toast.error(errMsg(e)))
    cash_api.approvals().then(r => setAppr(r.data)).catch(() => {})
  }
  useEffect(() => {
    try { localStorage.setItem(OUTLET_KEY, String(outletId)) } catch { /* storage blocked */ }
    load()
  }, [outletId, tab])
  const done = () => { setMode(null); setDec(null); load() }
  const pendingCount = (appr?.expenses.length || 0) + (appr?.safe_handovers.length || 0) + (appr?.deposits.length || 0)

  const mine = (e: cash_entry) => meta && e.created_by === meta.me.id
  const rowActions = (e: cash_entry) => <>
    {e.status === 'pending' && mine(e) && <button className="btn btn-secondary !py-1 !px-2 text-[12px]" onClick={() => setDec({ e, action: 'cancel' })}>Cancel</button>}
    {e.status === 'posted' && meta?.is_accounts && ['expense', 'pay_in', 'pickup'].includes(e.kind) && pos?.business_date === e.business_date &&
      <button className="btn btn-secondary !py-1 !px-2 text-[12px] text-red-600" onClick={() => setDec({ e, action: 'void' })}>Void</button>}
  </>

  const exportCsv = () => {
    const cols: (keyof cash_entry)[] = ['entry_no', 'business_date', 'kind', 'status', 'outlet_name', 'from_label', 'to_label', 'category_name', 'party', 'ref_no', 'amount', 'credited_amount', 'bank_ref', 'description', 'created_by_name', 'created_at', 'actioned_by_name', 'action_remarks']
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([[cols.join(','), ...book.map(r => cols.map(c => cell(r[c])).join(','))].join('\n')], { type: 'text/csv' }))
    a.download = `cash_book_${bq.from_date}_${bq.to_date}.csv`; a.click()
  }
  const bookTotals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const e of book) if (e.status === 'posted') t[e.kind] = (t[e.kind] || 0) + Number(e.amount)
    return t
  }, [book])

  const tabs = [['branch', 'Branch Cash'], ['my', 'My Cash'], ['approvals', `Approvals${pendingCount ? ` (${pendingCount})` : ''}`], ['book', 'Cash Book'],
    ...(meta?.is_accounts ? [['control', 'HO Cash Control'], ['setup', 'Setup']] : [])]

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Cash Management" subtitle="Drawer → safe → handover → bank, every rupee accounted for"
        action={<select className="form-input !w-auto" value={outletId} onChange={e => setOutletId(Number(e.target.value))} aria-label="Location">
          <option value={0}>Head Office</option>{outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}
        </select>} />

      <div className="tab-bar !px-2 bg-app-card border border-border rounded-fiori overflow-x-auto" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab-item whitespace-nowrap ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'branch' && pos && meta && <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Cash in safe" value={inr(pos.safe_balance)} tone="text-primary" hint={pos.business_date ? `Business day ${dmy(pos.business_date)}` : 'Day not open — entries blocked'} />
          <Stat label="In drawers" value={inr(pos.drawers.reduce((t, d) => t + Number(d.expected_cash), 0))} hint={`${pos.drawers.length} open shift(s)`} />
          <Stat label="Sent, not yet received" value={inr(pos.out_in_transit)} tone={Number(pos.out_in_transit) ? 'text-amber-600' : undefined} hint="Handovers / deposits in transit" />
          <Stat label="Waiting" value={`${pos.pending_expenses.length + pos.incoming.length}`} hint="Expenses to approve · cash to receive" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => setMode('expense')}><i className="fas fa-receipt mr-2" />Expense</button>
          <button className="btn btn-secondary" onClick={() => setMode('pay_in')}><i className="fas fa-plus-circle mr-2" />Pay-in</button>
          {meta.is_manager && <>
            <button className="btn btn-secondary" disabled={!pos.drawers.length} onClick={() => setMode('pickup')}><i className="fas fa-hand-holding-usd mr-2" />Pickup from drawer</button>
            <button className="btn btn-secondary" onClick={() => setMode('handover')}><i className="fas fa-people-arrows mr-2" />Handover</button>
            <button className="btn btn-secondary" onClick={() => setMode('deposit')}><i className="fas fa-university mr-2" />Bank deposit</button>
          </>}
        </div>
        {pos.drawers.length > 0 && <section className="bg-app-card border border-border rounded-fiori p-3">
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary mb-2">Open drawers</h4>
          <table className="ent-table"><thead><tr><th>Cashier</th><th>Shift</th><th className="!text-right">Float</th><th className="!text-right">Pay-ins</th><th className="!text-right">Expenses</th><th className="!text-right">Pickups</th><th className="!text-right">Should hold</th></tr></thead>
            <tbody>{pos.drawers.map(d => <tr key={d.shift_id}><td>{d.cashier_name}</td><td>#{d.shift_id} {d.shift_name}</td><td className="text-right">{inr(d.opening_cash)}</td><td className="text-right">{inr(d.pay_ins)}</td><td className="text-right">{inr(d.expenses)}</td><td className="text-right">{inr(d.pickups)}</td><td className="text-right font-semibold">{inr(d.expected_cash)}</td></tr>)}</tbody></table>
        </section>}
        {(pos.incoming.length > 0 || pos.pending_expenses.length > 0 || pos.outgoing.length > 0) && <section className="bg-app-card border border-amber-200 rounded-fiori p-3 space-y-3">
          {pos.incoming.length > 0 && <><h4 className="text-[12px] font-semibold uppercase tracking-wider text-amber-700">Cash coming to this safe</h4>
            <Entries rows={pos.incoming} actions={e => meta.is_manager && !mine(e) && <>
              <button className="btn btn-primary !py-1 !px-2 text-[12px] mr-1" onClick={() => setDec({ e, action: 'accept' })}>Accept</button>
              <button className="btn btn-secondary !py-1 !px-2 text-[12px]" onClick={() => setDec({ e, action: 'reject' })}>Reject</button></>} /></>}
          {pos.pending_expenses.length > 0 && <><h4 className="text-[12px] font-semibold uppercase tracking-wider text-amber-700">Expenses waiting for approval (do not pay yet)</h4>
            <Entries rows={pos.pending_expenses} actions={e => mine(e) ? rowActions(e) : meta.is_manager && <>
              <button className="btn btn-primary !py-1 !px-2 text-[12px] mr-1" onClick={() => setDec({ e, action: 'approve' })}>Approve</button>
              <button className="btn btn-secondary !py-1 !px-2 text-[12px]" onClick={() => setDec({ e, action: 'reject' })}>Reject</button></>} /></>}
          {pos.outgoing.length > 0 && <><h4 className="text-[12px] font-semibold uppercase tracking-wider text-amber-700">Sent from this safe, not yet received / verified</h4>
            <Entries rows={pos.outgoing} actions={rowActions} /></>}
        </section>}
        <section className="bg-app-card border border-border rounded-fiori p-3">
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary mb-2">Today's cash book · {outletName}</h4>
          <Entries rows={pos.entries} actions={rowActions} empty="No cash entries for this business day yet" />
        </section>
      </>}

      {tab === 'my' && my && meta && <>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label="Cash in my hand" value={inr(my.balance)} tone="text-primary" hint="Accepted handovers minus what you passed on / deposited" />
          <Stat label="Coming to me" value={inr(my.incoming.reduce((t, e) => t + Number(e.amount), 0))} hint={`${my.incoming.length} handover(s) to accept`} />
          <Stat label="Sent by me, pending" value={inr(my.outgoing.reduce((t, e) => t + Number(e.amount), 0))} />
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={!Number(my.balance)} onClick={() => setMode('deposit')}><i className="fas fa-university mr-2" />Deposit my cash</button>
          <button className="btn btn-secondary" disabled={!Number(my.balance)} onClick={() => setMode('handover')}><i className="fas fa-people-arrows mr-2" />Hand over my cash</button>
        </div>
        {my.incoming.length > 0 && <section className="bg-app-card border border-amber-200 rounded-fiori p-3">
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-amber-700 mb-2">Cash handed to me — count, then accept</h4>
          <Entries rows={my.incoming} actions={e => <>
            <button className="btn btn-primary !py-1 !px-2 text-[12px] mr-1" onClick={() => setDec({ e, action: 'accept' })}>Accept</button>
            <button className="btn btn-secondary !py-1 !px-2 text-[12px]" onClick={() => setDec({ e, action: 'reject' })}>Reject</button></>} />
        </section>}
        <section className="bg-app-card border border-border rounded-fiori p-3">
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary mb-2">My entries</h4>
          <Entries rows={my.entries} actions={rowActions} />
        </section>
      </>}

      {tab === 'approvals' && appr && <div className="space-y-4">
        {[['Expenses to approve', appr.expenses, ['approve', 'reject']], ['Cash coming into a safe', appr.safe_handovers, ['accept', 'reject']], ['Bank deposits to verify against statement', appr.deposits, ['verify', 'reject']]]
          .map(([title, rows, acts]) => (
            <section key={title as string} className="bg-app-card border border-border rounded-fiori p-3">
              <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary mb-2">{title as string}</h4>
              <Entries rows={rows as cash_entry[]} empty="Nothing waiting" actions={e => (acts as Decision['action'][]).map((a, i) => (
                <button key={a} className={`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'} !py-1 !px-2 text-[12px] ${i === 0 ? 'mr-1' : ''}`} onClick={() => setDec({ e, action: a })}>{a[0].toUpperCase() + a.slice(1)}</button>))} />
            </section>
          ))}
      </div>}

      {tab === 'book' && <section className="bg-app-card border border-border rounded-fiori p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div><label className="form-label">From</label><input className="form-input" type="date" value={bq.from_date} onChange={e => setBq(q => ({ ...q, from_date: e.target.value }))} /></div>
          <div><label className="form-label">To</label><input className="form-input" type="date" value={bq.to_date} onChange={e => setBq(q => ({ ...q, to_date: e.target.value }))} /></div>
          <div><label className="form-label">Type</label><select className="form-input" value={bq.kind} onChange={e => setBq(q => ({ ...q, kind: e.target.value }))}><option value="">All</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="form-label">Status</label><select className="form-input" value={bq.status} onChange={e => setBq(q => ({ ...q, status: e.target.value }))}><option value="">All</option>{Object.keys(STATUS).map(s => <option key={s}>{s}</option>)}</select></div>
          <div className="flex-1 min-w-[180px]"><label className="form-label">Search</label><input className="form-input" placeholder="No., party, bill / slip no." value={bq.search} onChange={e => setBq(q => ({ ...q, search: e.target.value }))} /></div>
          <label className="flex items-center gap-2 text-[13px] pb-2"><input type="checkbox" checked={bq.all} onChange={e => setBq(q => ({ ...q, all: e.target.checked }))} />All locations</label>
          <button className="btn btn-primary" onClick={load}>Show</button>
          <button className="btn btn-secondary" disabled={!book.length} onClick={exportCsv}><i className="fas fa-file-csv mr-2" />Export</button>
        </div>
        {book.length > 0 && <div className="flex flex-wrap gap-3 text-[13px]">{Object.entries(bookTotals).map(([k, v]) => <span key={k} className="bg-app-bg rounded-lg px-3 py-1">{KIND[k]}: <b>{inr(v)}</b></span>)}</div>}
        <Entries rows={book} empty="No entries for these filters" />
      </section>}

      {tab === 'control' && ctl && <div className="space-y-4">
        <section className="bg-app-card border border-border rounded-fiori p-3">
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary mb-2">Cash by location</h4>
          <div className="overflow-x-auto"><table className="ent-table min-w-[900px]">
            <thead><tr><th>Location</th><th className="!text-right">In safe</th><th className="!text-right">Handover in transit</th><th className="!text-right">Deposits unverified</th><th>Last verified deposit</th><th className="!text-right">Count shortage (30d)</th><th className="!text-right">Pending expenses</th><th>Day</th></tr></thead>
            <tbody>{ctl.locations.map(l => {
              const stale = !l.last_verified_deposit || (Date.now() - new Date(l.last_verified_deposit).getTime()) / 864e5 > 2
              return <tr key={l.outlet_id}>
                <td className="font-semibold"><button className="text-text-link hover:underline" onClick={() => { setOutletId(l.outlet_id); setTab('branch') }}>{l.outlet_name}</button></td>
                <td className="text-right font-semibold">{inr(l.safe_balance)}</td>
                <td className={`text-right ${Number(l.handover_in_transit) ? 'text-amber-600' : ''}`}>{inr(l.handover_in_transit)}</td>
                <td className={`text-right ${Number(l.deposits_unverified) ? 'text-amber-600' : ''}`}>{inr(l.deposits_unverified)}</td>
                <td className={stale && Number(l.safe_balance) > 0 ? 'text-red-600' : ''}>{l.last_verified_deposit ? dmy(l.last_verified_deposit) : 'Never'}</td>
                <td className={`text-right ${Number(l.shortage_30d) ? 'text-red-600 font-semibold' : ''}`}>{inr(l.shortage_30d)}</td>
                <td className="text-right">{l.pending_expenses || '—'}</td>
                <td className="capitalize">{l.day_status || '—'}</td>
              </tr>
            })}</tbody></table></div>
        </section>
        <div className="grid lg:grid-cols-2 gap-4">
          <section className="bg-app-card border border-border rounded-fiori p-3">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary mb-2">Cash held by people</h4>
            {!ctl.people.length ? <p className="text-[13px] text-text-muted">Nobody is holding cash</p> :
              <table className="ent-table"><thead><tr><th>Person</th><th>Holding since</th><th className="!text-right">Amount</th></tr></thead>
                <tbody>{ctl.people.map(p => <tr key={p.id}><td>{p.name} <span className="text-text-muted text-[12px]">({p.role})</span></td><td>{dt(p.holding_since)}</td><td className="text-right font-semibold">{inr(p.balance)}</td></tr>)}</tbody></table>}
          </section>
          <section className="bg-app-card border border-border rounded-fiori p-3">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary mb-2">Bank accounts</h4>
            <table className="ent-table"><thead><tr><th>Account</th><th className="!text-right">Verified</th><th className="!text-right">Awaiting check</th><th className="!text-right">Bank shortfall</th></tr></thead>
              <tbody>{ctl.banks.map(b => <tr key={b.id}><td>{b.name} <span className="text-text-muted text-[12px]">****{b.last4}</span></td><td className="text-right">{inr(b.verified_total)}</td><td className="text-right text-amber-600">{inr(b.awaiting_verification)}</td><td className={`text-right ${Number(b.bank_shortfall) ? 'text-red-600' : ''}`}>{inr(b.bank_shortfall)}</td></tr>)}</tbody></table>
          </section>
        </div>
      </div>}

      {tab === 'setup' && meta && <Setup meta={meta} onSaved={() => cash_api.meta().then(r => setMeta(r.data))} />}

      {meta && <EntryForm mode={mode} outletId={outletId} outletName={outletName} meta={meta} outlets={outlets} position={pos} onClose={() => setMode(null)} onDone={done} />}
      <DecisionModal d={dec} onClose={() => setDec(null)} onDone={done} />
    </div>
  )
}

function Setup({ meta, onSaved }: { meta: cash_meta; onSaved: () => void }) {
  const [cat, setCat] = useState<Record<string, any> | null>(null)
  const [bank, setBank] = useState<Record<string, any> | null>(null)
  const save = async (fn: () => Promise<unknown>, close: () => void) => {
    try { await fn(); toast.success('Saved'); close(); onSaved() } catch (e) { toast.error(errMsg(e)) }
  }
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <section className="bg-app-card border border-border rounded-fiori p-3">
        <div className="flex justify-between items-center mb-2"><h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary m-0">Expense & pay-in categories</h4>
          <button className="btn btn-secondary !py-1" onClick={() => setCat({ type: 'expense', approval_limit: '500', requires_bill: false, is_active: true, sort_order: 0, name: '' })}>+ Add</button></div>
        <table className="ent-table"><thead><tr><th>Name</th><th>Type</th><th className="!text-right">Approval above</th><th>Bill</th><th></th></tr></thead>
          <tbody>{meta.categories.map(c => <tr key={c.id} className={c.is_active ? '' : 'opacity-50'}><td>{c.name}</td><td>{c.type === 'pay_in' ? 'Pay-in' : 'Expense'}</td>
            <td className="text-right">{c.approval_limit == null ? 'Never' : Number(c.approval_limit) === 0 ? 'Always' : inr(c.approval_limit)}</td><td>{c.requires_bill ? 'Required' : '—'}</td>
            <td className="text-right"><button className="text-text-link" onClick={() => setCat({ ...c, approval_limit: c.approval_limit ?? '' })}>Edit</button></td></tr>)}</tbody></table>
      </section>
      <section className="bg-app-card border border-border rounded-fiori p-3">
        <div className="flex justify-between items-center mb-2"><h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary m-0">Bank accounts for deposits</h4>
          <button className="btn btn-secondary !py-1" onClick={() => setBank({ name: '', bank_name: '', account_no: '', ifsc: '', branch: '', is_active: true })}>+ Add</button></div>
        {!meta.bank_accounts.length ? <p className="text-[13px] text-text-muted">Add the accounts branches deposit into.</p> :
          <table className="ent-table"><thead><tr><th>Name</th><th>Bank</th><th>Account</th><th>IFSC</th><th></th></tr></thead>
            <tbody>{meta.bank_accounts.map(b => <tr key={b.id} className={b.is_active ? '' : 'opacity-50'}><td>{b.name}</td><td>{b.bank_name}</td><td className="font-mono">****{b.account_no.slice(-4)}</td><td className="font-mono">{b.ifsc}</td>
              <td className="text-right"><button className="text-text-link" onClick={() => setBank({ ...b, ifsc: b.ifsc ?? '', branch: b.branch ?? '' })}>Edit</button></td></tr>)}</tbody></table>}
      </section>

      <Modal open={!!cat} onClose={() => setCat(null)} title={cat?.id ? 'Edit category' : 'New category'}>
        {cat && <div className="space-y-3">
          <div><label className="form-label">Name</label><input className="form-input" value={cat.name} onChange={e => setCat({ ...cat, name: e.target.value })} /></div>
          <div><label className="form-label">Type</label><select className="form-input" value={cat.type} onChange={e => setCat({ ...cat, type: e.target.value })}><option value="expense">Expense</option><option value="pay_in">Pay-in</option></select></div>
          {cat.type === 'expense' && <>
            <div><label className="form-label">Manager approval above (₹)</label><input className="form-input" type="number" min={0} value={cat.approval_limit} onChange={e => setCat({ ...cat, approval_limit: e.target.value })} />
              <span className="form-helper">0 = always needs approval · empty = never</span></div>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={cat.requires_bill} onChange={e => setCat({ ...cat, requires_bill: e.target.checked })} /> Bill number + photo required</label>
          </>}
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={cat.is_active} onChange={e => setCat({ ...cat, is_active: e.target.checked })} /> Active</label>
          <div className="flex justify-end gap-2"><button className="btn btn-secondary" onClick={() => setCat(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => save(() => cash_api.save_category({
              name: cat.name, type: cat.type, approval_limit: cat.type === 'expense' && cat.approval_limit !== '' ? Number(cat.approval_limit) : null,
              requires_bill: cat.type === 'expense' && cat.requires_bill, is_active: cat.is_active, sort_order: cat.sort_order || 0 }, cat.id), () => setCat(null))}>Save</button></div>
        </div>}
      </Modal>
      <Modal open={!!bank} onClose={() => setBank(null)} title={bank?.id ? 'Edit bank account' : 'New bank account'}>
        {bank && <div className="space-y-3">
          {([['name', 'Display name (e.g. HDFC Current – Saket)'], ['bank_name', 'Bank'], ['account_no', 'Account number'], ['ifsc', 'IFSC'], ['branch', 'Branch']] as const).map(([k, l]) => (
            <div key={k}><label className="form-label">{l}</label><input className="form-input" value={bank[k]} onChange={e => setBank({ ...bank, [k]: k === 'ifsc' ? e.target.value.toUpperCase() : e.target.value })} /></div>))}
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={bank.is_active} onChange={e => setBank({ ...bank, is_active: e.target.checked })} /> Active</label>
          <div className="flex justify-end gap-2"><button className="btn btn-secondary" onClick={() => setBank(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => save(() => cash_api.save_bank({ name: bank.name, bank_name: bank.bank_name, account_no: bank.account_no, ifsc: bank.ifsc || null, branch: bank.branch || null, is_active: bank.is_active }, bank.id), () => setBank(null))}>Save</button></div>
        </div>}
      </Modal>
    </div>
  )
}
