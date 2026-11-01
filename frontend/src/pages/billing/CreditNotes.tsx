import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import { returns_api, type credit_note_row } from '../../api/returns'
import { getCompanySettings } from '../../api/company'
import { printCreditNote } from '../../utils/printCreditNote'

const inr = (v: unknown) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const today = new Date().toISOString().slice(0, 10)
const monthStart = today.slice(0, 8) + '01'

export default function CreditNotes() {
  const [rows, setRows] = useState<credit_note_row[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [cancelRow, setCancelRow] = useState<credit_note_row | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const perPage = 50

  async function load() {
    setLoading(true)
    try {
      const r = await returns_api.list({ page, per_page: perPage, from_date: from, to_date: to, source: source || undefined, search })
      setRows(r.data.items); setTotal(r.data.total)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [page, from, to, source])

  async function print(id: number) {
    const [cn, company] = await Promise.all([returns_api.get(id), getCompanySettings()])
    printCreditNote(cn.data, company)
  }

  async function cancel() {
    if (!cancelRow) return
    try {
      await returns_api.cancel(cancelRow.id, cancelReason)
      toast.success(`${cancelRow.invoice_no} cancelled — stock and bill due reversed`)
      setCancelRow(null); setCancelReason(''); load()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not cancel')
    }
  }

  const sum = (k: keyof credit_note_row) => rows.filter(r => r.status !== 'cancelled').reduce((s, r) => s + Number(r[k] || 0), 0)
  const pages = Math.max(1, Math.ceil(total / perPage))

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Sales Returns / Credit Notes" subtitle={`${total} credit notes`}
        action={<Link to="/billing/returns" className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700">+ New Return</Link>} />

      <div className="bg-white rounded-xl shadow p-3 flex flex-wrap gap-3 items-end text-sm">
        <div><label className="block text-xs text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }} className="border rounded-lg px-2 py-1.5" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }} className="border rounded-lg px-2 py-1.5" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Source</label>
          <select value={source} onChange={e => { setSource(e.target.value); setPage(1) }} className="border rounded-lg px-2 py-1.5">
            <option value="">All</option><option value="HO">HO credit notes</option><option value="OUTLET">Outlet POS returns</option>
          </select></div>
        <div className="flex-1 min-w-[200px]"><label className="block text-xs text-gray-500 mb-1">Search</label>
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && (setPage(1), load())}
            placeholder="Credit note, bill no, reason…" className="w-full border rounded-lg px-2 py-1.5" /></div>
        <button onClick={() => { setPage(1); load() }} className="border px-4 py-1.5 rounded-lg hover:bg-gray-50">Search</button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-red-50 text-gray-600 text-left">
            <tr>
              <th className="px-3 py-2">Credit Note No</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Outlet</th>
              <th className="px-3 py-2">Against Bill</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2 text-right">Taxable</th><th className="px-3 py-2 text-right">GST</th>
              <th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Refund</th><th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={12} className="text-center py-8 text-gray-400">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={12} className="text-center py-8 text-gray-400">No credit notes in this period</td></tr>}
            {!loading && rows.map(r => (
              <tr key={r.id} className={r.status === 'cancelled' ? 'bg-gray-50 text-gray-400 line-through' : 'hover:bg-gray-50'}>
                <td className="px-3 py-2 font-mono text-xs font-semibold">{r.invoice_no}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${r.source === 'HO' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                    {r.source === 'HO' ? 'HO' : 'Outlet POS'}</span>
                </td>
                <td className="px-3 py-2">{r.outlet_name || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.ref_invoice_no || '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.invoice_date}</td>
                <td className="px-3 py-2 max-w-[180px] truncate" title={r.return_reason || ''}>{r.return_reason || '—'}</td>
                <td className="px-3 py-2 text-right">{inr(r.taxable_amount)}</td>
                <td className="px-3 py-2 text-right">{inr(r.total_gst)}</td>
                <td className="px-3 py-2 text-right font-semibold">{inr(r.total_amount)}</td>
                <td className="px-3 py-2 capitalize">{r.refund_method || '—'}</td>
                <td className="px-3 py-2 no-underline">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${r.status === 'cancelled' ? 'bg-gray-200 text-gray-500' : 'bg-green-100 text-green-700'}`}>
                    {r.status === 'cancelled' ? 'Cancelled' : 'Confirmed'}</span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => print(r.id)} title="Print" className="text-gray-600 hover:text-red-600 px-2"><i className="fas fa-print" /></button>
                  {r.source === 'HO' && r.status !== 'cancelled' && (
                    <button onClick={() => setCancelRow(r)} title="Cancel" className="text-gray-600 hover:text-red-600 px-2"><i className="fas fa-ban" /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-gray-50 font-semibold text-gray-700">
              <tr>
                <td colSpan={6} className="px-3 py-2 text-right">Page total (excl. cancelled)</td>
                <td className="px-3 py-2 text-right">{inr(sum('taxable_amount'))}</td>
                <td className="px-3 py-2 text-right">{inr(sum('total_gst'))}</td>
                <td className="px-3 py-2 text-right">{inr(sum('total_amount'))}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {pages > 1 && (
        <div className="flex justify-end gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="border px-3 py-1 rounded disabled:opacity-40">Prev</button>
          <span className="px-2 py-1">Page {page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="border px-3 py-1 rounded disabled:opacity-40">Next</button>
        </div>
      )}

      <Modal title={`Cancel ${cancelRow?.invoice_no ?? ''}`} open={!!cancelRow} onClose={() => setCancelRow(null)}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Stock goes back out of HO and any amount adjusted is added back to the bill's due.</p>
          <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3}
            placeholder="Reason (min 5 characters)" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-3 justify-end">
            <button onClick={() => setCancelRow(null)} className="px-4 py-2 text-sm border rounded-lg">Back</button>
            <button onClick={cancel} disabled={cancelReason.trim().length < 5}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg disabled:opacity-50">Confirm Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
