// Bill Entry (SPS): enter each supplier invoice against its GRN. Bill = GRN (within ₹1) -> verified & payable;
// a bigger difference -> disputed until accounts accepts it with a reason (or raises a debit note).
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { accounts_api, type grn_row } from '../../api/accounts'
import { cash_api } from '../../api/cash'
import { useAuthStore } from '../../store/authStore'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import { dmy, errMsg, inr, today } from './acc_ui'

const TABS = [['pending', 'To verify'], ['disputed', 'Disputed'], ['verified', 'Verified'], ['', 'All']] as const
const TONE: Record<string, string> = { pending: 'bg-amber-100 text-amber-700', disputed: 'bg-red-100 text-red-700', verified: 'bg-green-100 text-green-700' }

export default function BillEntry() {
  const me = useAuthStore(s => s.user)
  const isAccounts = me?.role === 'admin' || me?.role === 'superadmin'
  const [tab, setTab] = useState<string>('pending')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<grn_row[]>([])
  const [g, setG] = useState<grn_row | null>(null)
  const [f, setF] = useState({ bill_no: '', bill_date: today(), bill_amount: '', attachment: '', remarks: '', accept: false })
  const [busy, setBusy] = useState(false)

  const load = () => accounts_api.grns({ bill_status: tab || undefined, search: search.trim() || undefined })
    .then(r => setRows(r.data)).catch(e => toast.error(errMsg(e)))
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h) }, [tab, search])

  const open = (r: grn_row) => {
    setG(r)
    setF({ bill_no: r.bill_no || r.invoice_no || '', bill_date: r.bill_date || r.invoice_date || today(), bill_amount: r.bill_amount || '',
           attachment: r.bill_attachment || '', remarks: r.bill_remarks || '', accept: false })
  }
  const diff = g && f.bill_amount !== '' ? Number(f.bill_amount) - Number(g.total_amount) : 0
  const bigDiff = Math.abs(diff) > 1

  const upload = async (file?: File) => {
    if (!file) return
    try { const p = (await cash_api.upload(file)).data.path; setF(x => ({ ...x, attachment: p })); toast.success('Bill copy attached') } catch (e) { toast.error(errMsg(e)) }
  }

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!g) return
    setBusy(true)
    try {
      const r = await accounts_api.enter_bill(g.id, { bill_no: f.bill_no.trim(), bill_date: f.bill_date, bill_amount: Number(f.bill_amount),
        attachment: f.attachment, remarks: f.remarks.trim() || undefined, accept_difference: f.accept })
      r.data.status === 'verified' ? toast.success(`${g.purchase_no} verified — now payable`) : toast.error(`${g.purchase_no} marked DISPUTED: bill differs by ${inr(r.data.difference)}`)
      setG(null); load()
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Bill Entry (SPS)" subtitle="Match every supplier invoice to its GRN before it can be paid" />
      <div className="bg-app-card border border-border rounded-fiori flex flex-wrap items-center gap-2 pr-3">
        <div className="tab-bar !px-2 !border-0 flex-1" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab-item ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <input className="form-input !w-72" placeholder="GRN, invoice, bill no., supplier…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
        <table className="ent-table min-w-[1100px]">
          <thead><tr><th>GRN</th><th>Supplier</th><th>GRN date</th><th className="!text-right">GRN amount</th><th>Supplier bill</th><th className="!text-right">Bill amount</th>
            <th className="!text-right">Difference</th><th className="!text-right">Due</th><th>Status</th><th>Verified by</th><th></th></tr></thead>
          <tbody>
            {!rows.length ? <tr><td colSpan={11} className="text-center text-text-muted !py-10">No GRNs here</td></tr> : rows.map(r => {
              const d = r.bill_amount != null ? Number(r.bill_amount) - Number(r.total_amount) : null
              return (
                <tr key={r.id}>
                  <td className="font-mono text-[12px]">{r.purchase_no}<div className="text-text-muted font-sans">{r.outlet_name}</div></td>
                  <td>{r.supplier_name}</td>
                  <td>{dmy(r.invoice_date)}</td>
                  <td className="text-right">{inr(r.total_amount)}</td>
                  <td className="text-[12px]">{r.bill_no ? <><span className="font-mono">{r.bill_no}</span><div className="text-text-muted">{dmy(r.bill_date)}</div></> : <span className="text-text-muted">—</span>}
                    {r.bill_attachment && <a href={r.bill_attachment} target="_blank" rel="noreferrer" className="text-text-link"><i className="fas fa-paperclip mr-1" />copy</a>}</td>
                  <td className="text-right">{r.bill_amount != null ? inr(r.bill_amount) : '—'}</td>
                  <td className={`text-right ${d != null && Math.abs(d) > 1 ? 'text-red-600 font-semibold' : ''}`}>{d != null ? inr(d) : '—'}</td>
                  <td className="text-right">{inr(r.due_amount)}{r.due_on && Number(r.due_amount) > 0 && <div className={`text-[11px] ${new Date(r.due_on) < new Date() ? 'text-red-600' : 'text-text-muted'}`}>by {dmy(r.due_on)}</div>}</td>
                  <td><span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${TONE[r.bill_status]}`}>{r.bill_status === 'pending' ? 'To verify' : r.bill_status}</span>
                    {r.bill_remarks && <div className="text-[11px] text-text-muted italic max-w-[160px] truncate" title={r.bill_remarks}>“{r.bill_remarks}”</div>}</td>
                  <td className="text-[12px]">{r.verified_by_name ? <>{r.verified_by_name}<div className="text-text-muted">{dmy(r.bill_verified_at)}</div></> : '—'}</td>
                  <td className="text-right">{isAccounts && r.bill_status !== 'verified' && (
                    r.created_by === me?.id ? <span className="text-[11px] text-text-muted" title="You made this GRN">Another user verifies</span>
                      : <button className="btn btn-primary !py-1 !px-2 text-[12px]" onClick={() => open(r)}>{r.bill_status === 'disputed' ? 'Resolve' : 'Enter bill'}</button>)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal open={!!g} onClose={() => setG(null)} title={g ? `Supplier bill • ${g.purchase_no} • ${g.supplier_name}` : ''} width="max-w-xl">
        {g && <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 bg-app-bg rounded-lg p-3 text-[13px] flex justify-between"><span>GRN {g.purchase_no} · {dmy(g.invoice_date)} · by {g.created_by_name || '—'}</span><b>{inr(g.total_amount)}</b></div>
          <div><label className="form-label">Supplier bill no. <span className="text-red-500">*</span></label>
            <input className="form-input font-mono" required value={f.bill_no} onChange={e => setF({ ...f, bill_no: e.target.value })} /></div>
          <div><label className="form-label">Bill date <span className="text-red-500">*</span></label>
            <input className="form-input" type="date" required max={today()} value={f.bill_date} onChange={e => setF({ ...f, bill_date: e.target.value })} /></div>
          <div><label className="form-label">Bill amount (₹) <span className="text-red-500">*</span></label>
            <input className="form-input" type="number" step="0.01" min={0.01} required value={f.bill_amount} onChange={e => setF({ ...f, bill_amount: e.target.value })} /></div>
          <div className={`self-end text-[14px] font-semibold pb-2 ${f.bill_amount === '' ? 'text-text-muted' : bigDiff ? 'text-red-600' : 'text-green-600'}`}>
            {f.bill_amount === '' ? 'Enter the bill amount' : bigDiff ? `Differs from GRN by ${inr(diff)}` : 'Matches GRN'}</div>
          <div className="sm:col-span-2"><label className="form-label">Copy of supplier bill <span className="text-red-500">*</span></label>
            <input className="form-input" type="file" accept="image/*,application/pdf" onChange={e => upload(e.target.files?.[0])} />
            {f.attachment && <a className="form-helper !text-green-700" href={f.attachment} target="_blank" rel="noreferrer"><i className="fas fa-check mr-1" />Attached — view</a>}</div>
          {bigDiff && <label className="sm:col-span-2 flex items-start gap-2 text-[13px] bg-red-50 text-red-700 rounded-lg p-2">
            <input type="checkbox" className="mt-1" checked={f.accept} onChange={e => setF({ ...f, accept: e.target.checked })} />
            <span>Accept the difference and make it payable. Otherwise it is saved as <b>disputed</b> (not payable) — raise a debit note or get the GRN corrected. Payable stays the GRN due.</span></label>}
          <div className="sm:col-span-2"><label className="form-label">Remarks{bigDiff && f.accept && <span className="text-red-500"> *</span>}</label>
            <textarea className="form-input !h-auto" rows={2} value={f.remarks} onChange={e => setF({ ...f, remarks: e.target.value })} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" className="btn btn-secondary" onClick={() => setG(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !f.attachment || (bigDiff && f.accept && f.remarks.trim().length < 5)}>
              {busy ? 'Saving…' : bigDiff && !f.accept ? 'Save as disputed' : 'Verify bill'}</button>
          </div>
        </form>}
      </Modal>
    </div>
  )
}
