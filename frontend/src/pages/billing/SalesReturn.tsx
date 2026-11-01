import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader'
import { returns_api, type bill_lookup } from '../../api/returns'
import { getCompanySettings } from '../../api/company'
import { printCreditNote } from '../../utils/printCreditNote'

const inr = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const errMsg = (e: any) => e?.response?.data?.detail || e?.message || 'Something went wrong'

export default function SalesReturn() {
  const nav = useNavigate()
  const [billNo, setBillNo] = useState('')
  const [bill, setBill] = useState<bill_lookup | null>(null)
  const [qty, setQty] = useState<Record<number, string>>({})
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<'cash' | 'adjust'>('cash')
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  async function find() {
    if (!billNo.trim()) return
    setBusy(true)
    try {
      const r = await returns_api.lookup(billNo.trim())
      setBill(r.data); setQty({}); setMethod(Number(r.data.due_amount) > 0 ? 'adjust' : 'cash')
    } catch (e) {
      setBill(null); toast.error(errMsg(e))
    } finally { setBusy(false) }
  }

  const lines = bill?.lines ?? []
  const picked = lines
    .map(l => ({ l, q: Math.min(Number(qty[l.product_id] || 0), Number(l.returnable_qty)) }))
    .filter(x => x.q > 0)
  const estimate = picked.reduce((s, { l, q }) => s + Number(l.unit_price) * q, 0)
  const due = Number(bill?.due_amount || 0)
  const adjust = method === 'adjust' ? Math.min(estimate, due) : 0
  const canSave = picked.length > 0 && reason.trim().length >= 3 && !busy

  async function save() {
    if (!bill || !canSave) return
    if (!confirm(`Create credit note for ${inr(estimate)} against bill ${bill.invoice_no}?`)) return
    setBusy(true)
    try {
      const res = await returns_api.create({
        invoice_no: bill.invoice_no,
        items: picked.map(({ l, q }) => ({ product_id: l.product_id, qty: q })),
        reason: reason.trim(), refund_method: method, return_date: returnDate, notes: notes.trim() || undefined,
      })
      toast.success(`Credit note ${res.data.invoice_no} created`)
      const [cn, company] = await Promise.all([returns_api.get(res.data.id), getCompanySettings()])
      printCreditNote(cn.data, company)
      nav('/billing/returns/list')
    } catch (e) {
      toast.error(errMsg(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Sales Return / Credit Note" subtitle="Return goods against any bill — stock comes back to HO" />

      <div className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs text-gray-500 mb-1">Original Bill No *</label>
          <input value={billNo} onChange={e => setBillNo(e.target.value)} onKeyDown={e => e.key === 'Enter' && find()}
            autoFocus placeholder="Scan or type bill number"
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400" />
        </div>
        <button onClick={find} disabled={busy || !billNo.trim()}
          className="bg-red-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
          <i className="fas fa-search mr-1" /> Find Bill
        </button>
      </div>

      {bill && (<>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            ['Bill No', bill.invoice_no], ['Bill Date', bill.invoice_date], ['Outlet', bill.outlet_name || '—'],
            ['Bill Total', inr(Number(bill.total_amount))], ['Due', inr(due)],
          ].map(([k, v]) => (
            <div key={k} className="bg-white rounded-xl shadow p-3">
              <p className="text-xs text-gray-500">{k}</p>
              <p className="font-semibold text-gray-800 truncate">{v}</p>
            </div>
          ))}
        </div>

        <div className="bg-amber-50 border-l-4 border-amber-400 text-amber-800 text-sm px-4 py-2 rounded">
          <i className="fas fa-exclamation-triangle mr-1" />
          Make sure this bill was not already returned at the outlet POS — outlet returns are not linked to bill numbers and would be counted twice.
        </div>

        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <p className="font-semibold text-gray-700 text-sm">Items ({lines.length}) · {bill.is_interstate ? 'IGST' : 'CGST + SGST'}</p>
            <button onClick={() => setQty(Object.fromEntries(lines.map(l => [l.product_id, String(Number(l.returnable_qty))])))}
              className="text-xs text-red-600 hover:underline">Return all</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-red-50 text-gray-600 text-left">
              <tr>
                <th className="px-3 py-2">#</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">HSN</th>
                <th className="px-3 py-2 text-right">Sold</th><th className="px-3 py-2 text-right">Returned</th>
                <th className="px-3 py-2 text-right">Returnable</th><th className="px-3 py-2 text-right">Paid / unit</th>
                <th className="px-3 py-2 text-right">Return Qty</th><th className="px-3 py-2 text-right">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l, i) => {
                const max = Number(l.returnable_qty)
                const q = Math.min(Number(qty[l.product_id] || 0), max)
                return (
                  <tr key={l.product_id} className={max <= 0 ? 'opacity-50' : ''}>
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-800">{l.name}</p>
                      <p className="text-xs text-gray-400 font-mono">
                        {l.item_code} · GST {Number(l.gst_percent)}%
                        {!l.ho_product_id && <span className="ml-2 text-orange-600 font-sans">not in HO item master — stock not updated</span>}
                      </p>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{l.hsn_code || '—'}</td>
                    <td className="px-3 py-2 text-right">{Number(l.sold_qty)} {l.unit}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{Number(l.returned_qty) || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold">{max}</td>
                    <td className="px-3 py-2 text-right">{inr(Number(l.unit_price))}</td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" min={0} max={max} step="0.001" disabled={max <= 0}
                        value={qty[l.product_id] ?? ''} placeholder="0"
                        onChange={e => setQty({ ...qty, [l.product_id]: e.target.value })}
                        className={`w-24 border rounded px-2 py-1 text-right ${Number(qty[l.product_id] || 0) > max ? 'border-red-500' : ''}`} />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{q > 0 ? inr(Number(l.unit_price) * q) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-4 space-y-3 md:col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Return Date</label>
                <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reason *</label>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Damaged, expired, wrong item"
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Refund Method</label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={method === 'cash'} onChange={() => setMethod('cash')} /> Refund in Cash
                </label>
                <label className={`flex items-center gap-2 ${due <= 0 ? 'opacity-40' : ''}`}>
                  <input type="radio" disabled={due <= 0} checked={method === 'adjust'} onChange={() => setMethod('adjust')} />
                  Adjust against bill due ({inr(due)})
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 flex flex-col">
            <p className="text-xs text-gray-500">Refund total (estimate)</p>
            <p className="text-3xl font-bold text-red-600">{inr(estimate)}</p>
            {method === 'adjust' && estimate > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {inr(adjust)} off bill due{estimate > adjust ? ` + ${inr(estimate - adjust)} cash` : ''}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">{picked.length} item(s) · final GST split calculated on save</p>
            <button onClick={save} disabled={!canSave}
              className="mt-auto bg-red-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save & Print Credit Note'}
            </button>
          </div>
        </div>
      </>)}
    </div>
  )
}
