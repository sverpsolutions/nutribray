// Accounts dashboard: payables, receivables, cash and bank in one view (live data).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { accounts_api, type acc_dashboard } from '../../api/accounts'
import PageHeader from '../../components/ui/PageHeader'
import { Section, Stat, dmy, errMsg, inr } from './acc_ui'

const PAY_STATUS: Record<string, string> = { pending: 'bg-amber-100 text-amber-700', posted: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700', void: 'bg-gray-100 text-gray-500' }

export default function AccountsDashboard() {
  const nav = useNavigate()
  const [d, setD] = useState<acc_dashboard | null>(null)
  useEffect(() => { accounts_api.dashboard().then(r => setD(r.data)).catch(e => toast.error(errMsg(e))) }, [])

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Accounts Dashboard" subtitle="Payables, receivables, cash and bank — live"
        action={<div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => nav('/accounts/bills')}><i className="fas fa-file-invoice mr-2" />Bill Entry (SPS)</button>
          <button className="btn btn-primary" onClick={() => nav('/accounts/payments')}><i className="fas fa-money-check-alt mr-2" />Supplier Payments</button>
        </div>} />
      {!d ? <p className="text-text-muted">Loading…</p> : <>
        {Number(d.rec_walkin_due) > 0 && (
          <div className="rounded-fiori border border-amber-300 bg-amber-50 text-amber-800 px-4 py-2 text-[13px]">
            <i className="fas fa-exclamation-triangle mr-2" /><b>{inr(d.rec_walkin_due)}</b> shows as unpaid on {d.rec_walkin_bills.toLocaleString('en-IN')} walk-in bills.
            A walk-in customer cannot buy on credit, so this is unreconciled (mostly outlet-synced) bill data, not a receivable — it is left out of the totals below.
          </div>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Total payable" value={inr(d.payable)} tone="text-red-600" hint={<>Overdue {inr(d.overdue)} · due in 7 days {inr(d.due_7d)}</>} onClick={() => nav('/accounts/payments')} />
          <Stat label="Total receivable" value={inr(d.rec_receivable)} tone="text-green-700" hint={<>Overdue {inr(d.rec_overdue)}</>} />
          <Stat label="Cash (safes + people)" value={inr(Number(d.in_safes) + Number(d.with_people))}
            hint={<>In transit {inr(d.in_transit)} · deposits to verify {inr(d.deposits_unverified)}</>} onClick={() => nav('/accounts/cash')} />
          <Stat label="Bank (system book)" value={inr(d.banks.reduce((t, b) => t + Number(b.balance), 0))} hint={`${d.banks.length} account(s)`} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Bills to verify" value={d.bills_pending} tone={d.bills_pending ? 'text-amber-600' : undefined} hint={inr(d.bills_pending_amt)} onClick={() => nav('/accounts/bills')} />
          <Stat label="Disputed bills" value={d.bills_disputed} tone={d.bills_disputed ? 'text-red-600' : undefined} hint="Bill ≠ GRN — not payable" onClick={() => nav('/accounts/bills')} />
          <Stat label="Payments to approve" value={d.payments_pending} tone={d.payments_pending ? 'text-amber-600' : undefined} hint={inr(d.payments_pending_amt)} onClick={() => nav('/accounts/payments')} />
          <Stat label="Cash deposits to verify" value={inr(d.deposits_unverified)} tone={Number(d.deposits_unverified) ? 'text-amber-600' : undefined} hint="Match with bank statement" onClick={() => nav('/accounts/cash')} />
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <Section title="Top supplier payables">
            {!d.top_payables.length ? <p className="text-[13px] text-text-muted">Nothing payable</p> :
              <table className="ent-table"><thead><tr><th>Supplier</th><th className="!text-right">Not due</th><th className="!text-right">Overdue</th><th className="!text-right">Total</th></tr></thead>
                <tbody>{d.top_payables.map(a => {
                  const od = Number(a.d30) + Number(a.d60) + Number(a.d90) + Number(a.d90p)
                  return <tr key={a.supplier_id}><td>{a.supplier_name}</td><td className="text-right">{inr(a.not_due)}</td>
                    <td className={`text-right ${od ? 'text-red-600 font-semibold' : ''}`}>{inr(od)}</td><td className="text-right font-semibold">{inr(a.total)}</td></tr>
                })}</tbody></table>}
          </Section>
          <Section title="Recent supplier payments">
            {!d.recent_payments.length ? <p className="text-[13px] text-text-muted">No payments yet</p> :
              <table className="ent-table"><thead><tr><th>No.</th><th>Date</th><th>Supplier</th><th className="!text-right">Amount</th><th>Status</th></tr></thead>
                <tbody>{d.recent_payments.map(p => <tr key={p.id}><td className="font-mono text-[12px]">{p.payment_no}</td><td>{dmy(p.payment_date)}</td><td>{p.supplier_name}</td>
                  <td className="text-right">{inr(p.amount)}</td><td><span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${PAY_STATUS[p.status]}`}>{p.status}</span></td></tr>)}</tbody></table>}
          </Section>
          <Section title="Bank accounts">
            {!d.banks.length ? <p className="text-[13px] text-text-muted">Add bank accounts in Cash Management → Setup</p> :
              <table className="ent-table"><thead><tr><th>Account</th><th className="!text-right">Balance (system)</th></tr></thead>
                <tbody>{d.banks.map(b => <tr key={b.id}><td>{b.name} <span className="text-text-muted text-[12px]">****{b.last4}</span></td><td className="text-right font-semibold">{inr(b.balance)}</td></tr>)}</tbody></table>}
            <p className="text-[11px] text-text-muted mt-2 mb-0">Opening balance + verified cash deposits − posted supplier payments. Reconcile with the bank statement.</p>
          </Section>
          <Section title="Cash position">
            <table className="ent-table"><tbody>
              <tr><td>In branch safes</td><td className="text-right font-semibold">{inr(d.in_safes)}</td></tr>
              <tr><td>With people (area managers / HO)</td><td className="text-right font-semibold">{inr(d.with_people)}</td></tr>
              <tr><td>Handovers in transit</td><td className="text-right text-amber-600">{inr(d.in_transit)}</td></tr>
              <tr><td>Deposits awaiting bank check</td><td className="text-right text-amber-600">{inr(d.deposits_unverified)}</td></tr>
            </tbody></table>
          </Section>
        </div>
      </>}
    </div>
  )
}
