// Supplier payments (maker-checker) + outstanding/aging, supplier ledger, bank book and receivables.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { accounts_api, type aging_row, type book_line, type open_bill, type recv_row, type supplier_payment } from '../../api/accounts'
import { cash_api, type bank_account } from '../../api/cash'
import { suppliers_api } from '../../api/suppliers'
import { useAuthStore } from '../../store/authStore'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import { Section, csv, daysAgo, dmy, errMsg, inr, today } from './acc_ui'

const STATUS: Record<string, string> = { pending: 'bg-amber-100 text-amber-700', posted: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700', void: 'bg-gray-100 text-gray-500' }
const MODES = [['neft', 'NEFT'], ['rtgs', 'RTGS'], ['imps', 'IMPS'], ['upi', 'UPI'], ['cheque', 'Cheque']]
type Alloc = Record<number, { amount: string; discount: string }>

function AllocGrid({ bills, alloc, setAlloc }: { bills: open_bill[]; alloc: Alloc; setAlloc: (a: Alloc) => void }) {
  if (!bills.length) return <p className="text-[13px] text-text-muted">No verified open bills for this supplier — the whole amount will be an advance.</p>
  const set = (id: number, k: 'amount' | 'discount', v: string) => setAlloc({ ...alloc, [id]: { amount: alloc[id]?.amount ?? '', discount: alloc[id]?.discount ?? '', [k]: v } })
  return (
    <table className="ent-table">
      <thead><tr><th>GRN / bill</th><th>Due by</th><th className="!text-right">Open</th><th className="!text-right">Pay</th><th className="!text-right">Discount</th></tr></thead>
      <tbody>{bills.map(b => {
        const over = Number(alloc[b.id]?.amount || 0) + Number(alloc[b.id]?.discount || 0) > Number(b.open_amount) + 0.001
        return (
          <tr key={b.id}>
            <td className="text-[12px]"><span className="font-mono">{b.purchase_no}</span>{b.bill_no && <span className="text-text-muted"> · {b.bill_no}</span>}</td>
            <td className={`text-[12px] ${new Date(b.due_on) < new Date() ? 'text-red-600' : ''}`}>{dmy(b.due_on)}</td>
            <td className="text-right">{inr(b.open_amount)}</td>
            <td className="text-right"><input className={`form-input !w-28 !px-2 text-right ml-auto ${over ? '!border-red-500' : ''}`} type="number" min={0} step="0.01" value={alloc[b.id]?.amount ?? ''} onChange={e => set(b.id, 'amount', e.target.value)} aria-label={`Pay ${b.purchase_no}`} /></td>
            <td className="text-right"><input className="form-input !w-24 !px-2 text-right ml-auto" type="number" min={0} step="0.01" value={alloc[b.id]?.discount ?? ''} onChange={e => set(b.id, 'discount', e.target.value)} aria-label={`Discount ${b.purchase_no}`} /></td>
          </tr>
        )
      })}</tbody>
    </table>
  )
}

const allocList = (a: Alloc) => Object.entries(a).map(([id, v]) => ({ purchase_id: Number(id), amount: Number(v.amount || 0), discount: Number(v.discount || 0) }))
  .filter(x => x.amount > 0 || x.discount > 0)

export default function Payments() {
  const me = useAuthStore(s => s.user)
  const isAccounts = me?.role === 'admin' || me?.role === 'superadmin'
  const [tab, setTab] = useState('payments')
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([])
  const [banks, setBanks] = useState<bank_account[]>([])
  const [rows, setRows] = useState<supplier_payment[]>([])
  const [status, setStatus] = useState('')
  const [aging, setAging] = useState<aging_row[]>([])
  const [recv, setRecv] = useState<recv_row[]>([])
  const [book, setBook] = useState<{ opening: string; lines: book_line[]; closing: string } | null>(null)
  const [bq, setBq] = useState({ id: '', from: daysAgo(30), to: today() })
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const [bills, setBills] = useState<open_bill[]>([])
  const [alloc, setAlloc] = useState<Alloc>({})
  const [act, setAct] = useState<{ p: supplier_payment; kind: 'approve' | 'reject' | 'void' | 'adjust'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    suppliers_api.list({ per_page: 200 }).then(r => setSuppliers(r.data.data.map((s: any) => ({ id: s.id, name: s.name })))).catch(() => {})
    cash_api.meta().then(r => setBanks(r.data.bank_accounts.filter(b => b.is_active))).catch(() => {})
  }, [])
  const load = () => {
    if (tab === 'payments') accounts_api.payments({ status: status || undefined }).then(r => setRows(r.data)).catch(e => toast.error(errMsg(e)))
    if (tab === 'aging') accounts_api.aging().then(r => setAging(r.data)).catch(e => toast.error(errMsg(e)))
    if (tab === 'receivables') accounts_api.receivables().then(r => setRecv(r.data)).catch(e => toast.error(errMsg(e)))
  }
  useEffect(load, [tab, status])
  useEffect(() => { setBook(null); setBq(q => ({ ...q, id: '' })) }, [tab])

  const loadBills = (supplierId: string) => {
    setAlloc({}); setBills([])
    if (supplierId) accounts_api.open_bills(Number(supplierId)).then(r => setBills(r.data)).catch(e => toast.error(errMsg(e)))
  }
  const allocTotal = useMemo(() => allocList(alloc).reduce((t, a) => t + a.amount, 0), [alloc])
  const discTotal = useMemo(() => allocList(alloc).reduce((t, a) => t + a.discount, 0), [alloc])
  const autoFill = () => {  // oldest due first, up to the payment amount
    let left = Number(form?.amount || 0)
    const a: Alloc = {}
    for (const b of bills) { if (left <= 0) break; const take = Math.min(left, Number(b.open_amount)); a[b.id] = { amount: take.toFixed(2), discount: '' }; left -= take }
    setAlloc(a)
  }

  const savePayment = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form) return
    setBusy(true)
    try {
      await accounts_api.create_payment({ supplier_id: Number(form.supplier_id), bank_account_id: Number(form.bank_account_id), payment_date: form.payment_date,
        mode: form.mode, reference_no: form.reference_no.trim(), amount: Number(form.amount), allocations: allocList(alloc), remarks: form.remarks || undefined })
      toast.success('Payment created — another accounts user must approve it before it posts')
      setForm(null); load()
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  const doAct = async () => {
    if (!act) return
    setBusy(true)
    try {
      if (act.kind === 'approve' || act.kind === 'reject') await accounts_api.decide(act.p.id, act.kind === 'approve', act.text || undefined)
      if (act.kind === 'void') await accounts_api.void(act.p.id, act.text)
      if (act.kind === 'adjust') await accounts_api.allocate(act.p.id, allocList(alloc))
      toast.success('Done'); setAct(null); load()
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  const showBook = () => {
    if (!bq.id) return toast.error(tab === 'ledger' ? 'Select a supplier' : 'Select a bank account')
    const call = tab === 'ledger' ? accounts_api.ledger(Number(bq.id), bq.from, bq.to) : accounts_api.bank_book(Number(bq.id), bq.from, bq.to)
    call.then(r => setBook(r.data)).catch(e => toast.error(errMsg(e)))
  }

  const tabs = [['payments', 'Payments'], ['aging', 'Outstanding & Aging'], ['ledger', 'Supplier Ledger'], ['bank', 'Bank Book'], ['receivables', 'Receivables']]
  const agingCols = (r: aging_row | recv_row) => [r.not_due, r.d30, r.d60, r.d90, r.d90p]

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Supplier Payments" subtitle="Pay verified bills from the bank · every payment needs a second approver"
        action={isAccounts && <button className="btn btn-primary" onClick={() => { setForm({ supplier_id: '', bank_account_id: String(banks[0]?.id ?? ''), payment_date: today(), mode: 'neft', reference_no: '', amount: '', remarks: '' }); setBills([]); setAlloc({}) }}>
          <i className="fas fa-plus-circle mr-2" />New Payment</button>} />

      <div className="tab-bar !px-2 bg-app-card border border-border rounded-fiori overflow-x-auto" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab-item whitespace-nowrap ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'payments' && <Section title="Supplier payments" right={
        <select className="form-input !w-auto" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="">All</option><option value="pending">Waiting approval</option><option value="posted">Posted</option><option value="rejected">Rejected</option><option value="void">Void</option>
        </select>}>
        <div className="overflow-x-auto"><table className="ent-table min-w-[1100px]">
          <thead><tr><th>No.</th><th>Date</th><th>Supplier</th><th>Bank · mode · ref</th><th>Against bills</th><th className="!text-right">Amount</th><th className="!text-right">Advance</th><th>Status</th><th>By</th><th></th></tr></thead>
          <tbody>{!rows.length ? <tr><td colSpan={10} className="text-center text-text-muted !py-8">No payments</td></tr> : rows.map(p => {
            const adv = Number(p.amount) - Number(p.allocated)
            return (
              <tr key={p.id}>
                <td className="font-mono text-[12px]">{p.payment_no}</td>
                <td>{dmy(p.payment_date)}</td>
                <td>{p.supplier_name}</td>
                <td className="text-[12px]">{p.bank_name}<div className="text-text-muted uppercase">{p.mode} · <span className="font-mono normal-case">{p.reference_no}</span></div></td>
                <td className="text-[12px] max-w-[220px] truncate" title={p.bills || ''}>{p.bills || '—'}{Number(p.discount) > 0 && <div className="text-text-muted">discount {inr(p.discount)}</div>}</td>
                <td className="text-right font-semibold">{inr(p.amount)}</td>
                <td className={`text-right ${adv > 0 ? 'text-amber-600' : 'text-text-muted'}`}>{adv > 0 ? inr(adv) : '—'}</td>
                <td><span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${STATUS[p.status]}`}>{p.status === 'pending' ? 'Waiting approval' : p.status}</span>
                  {p.action_remarks && <div className="text-[11px] text-text-muted italic max-w-[150px] truncate" title={p.action_remarks}>“{p.action_remarks}”</div>}</td>
                <td className="text-[12px]">{p.created_by_name}{p.actioned_by_name && <div className="text-text-muted">✓ {p.actioned_by_name}</div>}</td>
                <td className="text-right whitespace-nowrap">{isAccounts && <>
                  {p.status === 'pending' && p.created_by !== me?.id && <>
                    <button className="btn btn-primary !py-1 !px-2 text-[12px] mr-1" onClick={() => setAct({ p, kind: 'approve', text: '' })}>Approve</button>
                    <button className="btn btn-secondary !py-1 !px-2 text-[12px]" onClick={() => setAct({ p, kind: 'reject', text: '' })}>Reject</button></>}
                  {p.status === 'pending' && p.created_by === me?.id && <span className="text-[11px] text-text-muted">Needs another approver</span>}
                  {p.status === 'posted' && adv > 0 && <button className="btn btn-secondary !py-1 !px-2 text-[12px] mr-1" onClick={() => { setAct({ p, kind: 'adjust', text: '' }); setAlloc({}); accounts_api.open_bills(p.supplier_id).then(r => setBills(r.data)) }}>Adjust advance</button>}
                  {p.status === 'posted' && <button className="btn btn-secondary !py-1 !px-2 text-[12px] text-red-600" onClick={() => setAct({ p, kind: 'void', text: '' })}>Void</button>}
                </>}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      </Section>}

      {(tab === 'aging' || tab === 'receivables') && <Section title={tab === 'aging' ? 'Supplier outstanding by age (days past due)' : 'Customer receivables by age (days past credit period)'}
        right={<button className="btn btn-secondary !py-1" onClick={() => tab === 'aging'
          ? csv('supplier_aging.csv', ['supplier_name', 'not_due', 'd30', 'd60', 'd90', 'd90p', 'total', 'unverified', 'advance'], aging as any)
          : csv('receivables.csv', ['customer_name', 'phone', 'bills', 'not_due', 'd30', 'd60', 'd90', 'd90p', 'total', 'oldest'], recv as any)}><i className="fas fa-file-csv mr-2" />Export</button>}>
        <div className="overflow-x-auto"><table className="ent-table min-w-[900px]">
          <thead><tr><th>{tab === 'aging' ? 'Supplier' : 'Customer'}</th><th className="!text-right">Not due</th><th className="!text-right">1–30</th><th className="!text-right">31–60</th><th className="!text-right">61–90</th><th className="!text-right">90+</th><th className="!text-right">Total</th>
            {tab === 'aging' ? <><th className="!text-right">Bill not verified</th><th className="!text-right">Advance paid</th></> : <th>Oldest bill</th>}</tr></thead>
          <tbody>{(tab === 'aging' ? aging : recv).length === 0 ? <tr><td colSpan={9} className="text-center text-text-muted !py-8">Nothing outstanding</td></tr> :
            (tab === 'aging' ? aging : recv).map((r: any) => (
              <tr key={r.supplier_id ?? r.customer_id}>
                <td className="font-semibold">{r.supplier_name ?? r.customer_name}{r.phone && <div className="text-[12px] text-text-muted font-normal">{r.phone}</div>}</td>
                {agingCols(r).map((v, i) => <td key={i} className={`text-right ${i >= 2 && Number(v) ? 'text-red-600' : i === 1 && Number(v) ? 'text-amber-600' : ''}`}>{Number(v) ? inr(v) : '—'}</td>)}
                <td className="text-right font-semibold">{inr(r.total)}</td>
                {tab === 'aging' ? <><td className="text-right text-amber-600">{Number(r.unverified) ? inr(r.unverified) : '—'}</td><td className="text-right">{Number(r.advance) ? inr(r.advance) : '—'}</td></>
                  : <td>{dmy(r.oldest)}</td>}
              </tr>))}</tbody>
        </table></div>
      </Section>}

      {(tab === 'ledger' || tab === 'bank') && <Section title={tab === 'ledger' ? 'Supplier ledger' : 'Bank book'}>
        <div className="flex flex-wrap gap-2 items-end mb-3">
          <div className="min-w-[240px]"><label className="form-label">{tab === 'ledger' ? 'Supplier' : 'Bank account'}</label>
            <select className="form-input" value={bq.id} onChange={e => setBq({ ...bq, id: e.target.value })}>
              <option value="">Select</option>
              {tab === 'ledger' ? suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>) : banks.map(b => <option key={b.id} value={b.id}>{b.name} · ****{b.account_no.slice(-4)}</option>)}
            </select></div>
          <div><label className="form-label">From</label><input className="form-input" type="date" value={bq.from} onChange={e => setBq({ ...bq, from: e.target.value })} /></div>
          <div><label className="form-label">To</label><input className="form-input" type="date" value={bq.to} onChange={e => setBq({ ...bq, to: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={showBook}>Show</button>
          {book && <button className="btn btn-secondary" onClick={() => csv(`${tab}_${bq.from}_${bq.to}.csv`, ['d', 'type', 'ref', 'doc', ...(tab === 'ledger' ? ['debit', 'credit'] : ['receipt', 'payment']), 'balance'], book.lines as any)}><i className="fas fa-file-csv mr-2" />Export</button>}
        </div>
        {book && <div className="overflow-x-auto"><table className="ent-table min-w-[800px]">
          <thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Details</th><th className="!text-right">{tab === 'ledger' ? 'Debit (paid / less)' : 'Receipt'}</th><th className="!text-right">{tab === 'ledger' ? 'Credit (bill)' : 'Payment'}</th><th className="!text-right">Balance</th></tr></thead>
          <tbody>
            <tr className="font-semibold"><td colSpan={6}>Opening balance</td><td className="text-right">{inr(book.opening)}</td></tr>
            {book.lines.map((l, i) => <tr key={i}><td>{dmy(l.d)}</td><td>{l.type}</td><td className="font-mono text-[12px]">{l.ref}</td><td className="text-[12px]">{l.doc}</td>
              <td className="text-right">{Number(l.debit ?? l.receipt) ? inr(l.debit ?? l.receipt) : '—'}</td><td className="text-right">{Number(l.credit ?? l.payment) ? inr(l.credit ?? l.payment) : '—'}</td>
              <td className="text-right font-semibold">{inr(l.balance)}</td></tr>)}
            <tr className="font-semibold"><td colSpan={6}>Closing balance {tab === 'ledger' && <span className="text-text-muted font-normal text-[12px]">(payable to supplier)</span>}</td><td className="text-right">{inr(book.closing)}</td></tr>
          </tbody></table></div>}
        {tab === 'bank' && <p className="text-[11px] text-text-muted mt-2 mb-0">Shows what the system knows: opening balance (set in Cash Management → Setup), verified cash deposits and posted supplier payments. Card/UPI settlements and charges come from the bank statement.</p>}
      </Section>}

      <Modal open={!!form} onClose={() => setForm(null)} title="New supplier payment" width="max-w-3xl">
        {form && <form onSubmit={savePayment} className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2"><label className="form-label">Supplier <span className="text-red-500">*</span></label>
              <select className="form-input" required value={form.supplier_id} onChange={e => { setForm({ ...form, supplier_id: e.target.value }); loadBills(e.target.value) }}>
                <option value="">Select</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className="form-label">Payment date</label><input className="form-input" type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} /></div>
            <div><label className="form-label">From bank <span className="text-red-500">*</span></label>
              <select className="form-input" required value={form.bank_account_id} onChange={e => setForm({ ...form, bank_account_id: e.target.value })}>
                <option value="">Select</option>{banks.map(b => <option key={b.id} value={b.id}>{b.name} · ****{b.account_no.slice(-4)}</option>)}</select>
              {!banks.length && <span className="form-helper !text-red-600">Add a bank account in Cash Management → Setup</span>}</div>
            <div><label className="form-label">Mode</label>
              <select className="form-input" value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className="form-label">{form.mode === 'cheque' ? 'Cheque no.' : 'UTR / reference'} <span className="text-red-500">*</span></label>
              <input className="form-input font-mono" required minLength={3} value={form.reference_no} onChange={e => setForm({ ...form, reference_no: e.target.value })} /></div>
            <div><label className="form-label">Amount paid (₹) <span className="text-red-500">*</span></label>
              <input className="form-input" type="number" min={0.01} step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="form-label">Remarks</label>
              <input className="form-input" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} /></div>
          </div>
          {form.supplier_id && <>
            <div className="flex items-center justify-between"><h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary m-0">Against verified bills</h4>
              {bills.length > 0 && <button type="button" className="btn btn-secondary !py-1" disabled={!form.amount} onClick={autoFill}>Fill oldest first</button>}</div>
            <AllocGrid bills={bills} alloc={alloc} setAlloc={setAlloc} />
            <div className={`text-[13px] font-semibold rounded-lg px-3 py-2 ${allocTotal > Number(form.amount || 0) ? 'bg-red-50 text-red-700' : 'bg-app-bg'}`}>
              Against bills {inr(allocTotal)}{discTotal > 0 && <> + discount {inr(discTotal)}</>} · Advance {inr(Math.max(0, Number(form.amount || 0) - allocTotal))}
              {allocTotal > Number(form.amount || 0) && ' — more than the payment'}</div>
          </>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || allocTotal > Number(form.amount || 0)}>{busy ? 'Saving…' : 'Create payment (for approval)'}</button>
          </div>
        </form>}
      </Modal>

      <Modal open={!!act} onClose={() => setAct(null)} title={act ? `${{ approve: 'Approve', reject: 'Reject', void: 'Void', adjust: 'Adjust advance of' }[act.kind]} ${act.p.payment_no}` : ''} width={act?.kind === 'adjust' ? 'max-w-3xl' : 'max-w-lg'}>
        {act && <div className="space-y-3">
          <div className="bg-app-bg rounded-lg p-3 text-[13px] flex justify-between"><span>{act.p.supplier_name} · {act.p.mode.toUpperCase()} {act.p.reference_no} · by {act.p.created_by_name}</span><b>{inr(act.p.amount)}</b></div>
          {act.kind === 'approve' && <p className="text-[13px] text-amber-700 m-0">Check the {act.p.mode.toUpperCase()} reference in the bank before approving. Approving takes it off the bills: {act.p.bills || 'none (advance)'}.</p>}
          {act.kind === 'void' && <p className="text-[13px] text-red-700 m-0">Voiding puts every bill this payment settled back to due (use for bounced cheques / wrong supplier).</p>}
          {act.kind === 'adjust' ? <>
            <p className="text-[13px] m-0">Advance available: <b>{inr(Number(act.p.amount) - Number(act.p.allocated))}</b></p>
            <AllocGrid bills={bills} alloc={alloc} setAlloc={setAlloc} />
          </> : <div><label className="form-label">{act.kind === 'approve' ? 'Remarks' : 'Reason'}{act.kind !== 'approve' && <span className="text-red-500"> *</span>}</label>
            <textarea className="form-input !h-auto" rows={2} value={act.text} onChange={e => setAct({ ...act, text: e.target.value })} /></div>}
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setAct(null)}>Back</button>
            <button className={`btn ${act.kind === 'reject' || act.kind === 'void' ? 'bg-red-600 text-white hover:bg-red-700' : 'btn-primary'}`}
              disabled={busy || (act.kind !== 'approve' && act.kind !== 'adjust' && act.text.trim().length < 5) || (act.kind === 'adjust' && !allocList(alloc).length)} onClick={doAct}>
              {busy ? 'Saving…' : { approve: 'Approve & post', reject: 'Reject', void: 'Void payment', adjust: 'Adjust' }[act.kind]}</button>
          </div>
        </div>}
      </Modal>
    </div>
  )
}
