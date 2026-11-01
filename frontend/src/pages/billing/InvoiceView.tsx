import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { billing_api, type invoice_out } from '../../api/billing'
import Modal from '../../components/ui/Modal'

export default function invoice_view_page() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const [inv, set_inv] = useState<invoice_out | null>(null)
  const [pay_modal, set_pay_modal] = useState(false)
  const [pay_amount, set_pay_amount] = useState('')
  const [pay_mode, set_pay_mode] = useState('cash')
  const [pay_date, set_pay_date] = useState(new Date().toISOString().slice(0, 10))
  const [pay_ref, set_pay_ref] = useState('')
  const [saving_pay, set_saving_pay] = useState(false)
  const [cancel_modal, set_cancel_modal] = useState(false)
  const [cancel_reason, set_cancel_reason] = useState('')

  useEffect(() => {
    if (!id) return
    billing_api.get_invoice(Number(id)).then(r => set_inv(r.data))
  }, [id])

  async function add_payment() {
    if (!id || !pay_amount) return
    set_saving_pay(true)
    await billing_api.add_payment(Number(id), {
      amount: Number(pay_amount),
      payment_date: pay_date,
      payment_mode: pay_mode,
      reference_no: pay_ref || undefined,
    })
    const r = await billing_api.get_invoice(Number(id))
    set_inv(r.data)
    set_pay_modal(false); set_saving_pay(false); set_pay_amount('')
  }

  async function cancel() {
    if (!id || cancel_reason.length < 5) return
    await billing_api.cancel_invoice(Number(id), cancel_reason)
    const r = await billing_api.get_invoice(Number(id))
    set_inv(r.data)
    set_cancel_modal(false)
  }

  if (!inv) return <div className="text-center py-20 text-gray-400">Loading…</div>

  const status_colors: Record<string, string> = {
    unpaid: 'bg-red-100 text-red-700', partial: 'bg-yellow-100 text-yellow-700',
    paid: 'bg-green-100 text-green-700', cancelled: 'bg-gray-100 text-gray-500',
  }

  return (
    <div>
      {/* header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link to="/billing/invoices" className="text-gray-400 hover:text-gray-600 text-sm">← Back</Link>
            <h1 className="text-xl font-bold text-gray-800">{inv.invoice_no}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status_colors[inv.status] ?? ''}`}>{inv.status}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{inv.invoice_date} • {inv.payment_mode.toUpperCase()}{inv.is_interstate ? ' • IGST' : ' • CGST+SGST'}</p>
        </div>
        <div className="flex gap-2">
          {inv.status !== 'cancelled' && inv.status !== 'paid' && (
            <button onClick={() => set_pay_modal(true)}
              className="bg-green-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-green-700">
              + Payment
            </button>
          )}
          {inv.status !== 'cancelled' && (
            <button onClick={() => set_cancel_modal(true)}
              className="border border-red-300 text-red-600 px-4 py-2 text-sm rounded-lg hover:bg-red-50">
              Cancel
            </button>
          )}
          <button onClick={() => window.print()}
            className="border px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-50">
            🖨 Print
          </button>
        </div>
      </div>

      {/* totals */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Amount', val: `₹${Number(inv.total_amount).toFixed(2)}`, cls: 'text-gray-800' },
          { label: 'Paid',         val: `₹${Number(inv.paid_amount).toFixed(2)}`,  cls: 'text-green-600' },
          { label: 'Due',          val: `₹${Number(inv.due_amount).toFixed(2)}`,   cls: Number(inv.due_amount) > 0 ? 'text-red-600' : 'text-green-600' },
          { label: 'Total GST',    val: `₹${Number(inv.total_gst).toFixed(2)}`,    cls: 'text-gray-600' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-500">{card.label}</p>
            <p className={`text-2xl font-bold mt-1 ${card.cls}`}>{card.val}</p>
          </div>
        ))}
      </div>

      {/* items */}
      <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
        <div className="px-4 py-3 border-b">
          <p className="font-semibold text-gray-700 text-sm">Items ({inv.items.length})</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-left">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Rate</th>
              <th className="px-4 py-2 text-right">Disc</th>
              <th className="px-4 py-2 text-right">Taxable</th>
              <th className="px-4 py-2 text-right">GST%</th>
              {!inv.is_interstate ? <>
                <th className="px-4 py-2 text-right">CGST</th>
                <th className="px-4 py-2 text-right">SGST</th>
              </> : <th className="px-4 py-2 text-right">IGST</th>}
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {inv.items.map((it, i) => (
              <tr key={it.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                <td className="px-4 py-2">
                  <p className="font-medium text-gray-800">{it.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{it.item_code}{it.hsn_code ? ` • HSN: ${it.hsn_code}` : ''}</p>
                </td>
                <td className="px-4 py-2 text-right">{Number(it.qty).toFixed(3)} {it.unit}</td>
                <td className="px-4 py-2 text-right">₹{Number(it.rate).toFixed(2)}</td>
                <td className="px-4 py-2 text-right text-orange-600">
                  {Number(it.disc_val) > 0 ? `${it.disc_type === '%' ? it.disc_val + '%' : '₹' + Number(it.disc_val).toFixed(2)}` : '—'}
                </td>
                <td className="px-4 py-2 text-right">₹{Number(it.taxable_amt).toFixed(2)}</td>
                <td className="px-4 py-2 text-right">{Number(it.gst_percent)}%</td>
                {!inv.is_interstate ? <>
                  <td className="px-4 py-2 text-right">₹{Number(it.cgst_amount).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">₹{Number(it.sgst_amount).toFixed(2)}</td>
                </> : <td className="px-4 py-2 text-right">₹{Number(it.igst_amount).toFixed(2)}</td>}
                <td className="px-4 py-2 text-right font-semibold">₹{Number(it.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 text-sm font-semibold text-gray-700">
            <tr>
              <td colSpan={5} className="px-4 py-3 text-right">Taxable Amount</td>
              <td className="px-4 py-3 text-right">₹{Number(inv.taxable_amount).toFixed(2)}</td>
              <td colSpan={!inv.is_interstate ? 3 : 2}></td>
              <td className="px-4 py-3 text-right">₹{Number(inv.total_amount).toFixed(2)}</td>
            </tr>
            {Number(inv.cd_percent) > 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-2 text-right text-orange-600">CD ({Number(inv.cd_percent)}%) — included above</td>
                <td className="px-4 py-2 text-right text-orange-600">−₹{Number(inv.cd_amount).toFixed(2)}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {/* payments */}
      {inv.payments.length > 0 && (
        <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
          <div className="px-4 py-3 border-b">
            <p className="font-semibold text-gray-700 text-sm">Payments ({inv.payments.length})</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2 text-left">Payment No</th>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">Mode</th>
                <th className="px-4 py-2 text-left">Ref</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {inv.payments.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-mono text-xs">{p.payment_no}</td>
                  <td className="px-4 py-2 text-gray-500">{p.payment_date}</td>
                  <td className="px-4 py-2 capitalize">{p.payment_mode}</td>
                  <td className="px-4 py-2 text-gray-400">{p.reference_no ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-semibold text-green-600">₹{Number(p.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Payment Modal */}
      <Modal title="Record Payment" open={pay_modal} onClose={() => set_pay_modal(false)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Amount *</label>
              <input type="number" min={0} step={0.01} value={pay_amount}
                onChange={e => set_pay_amount(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={`Due: ₹${Number(inv.due_amount).toFixed(2)}`} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date</label>
              <input type="date" value={pay_date} onChange={e => set_pay_date(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mode</label>
              <select value={pay_mode} onChange={e => set_pay_mode(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {['cash','card','upi','bank_transfer'].map(m => (
                  <option key={m} value={m}>{m.replace('_', ' ').toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Reference No</label>
              <input type="text" value={pay_ref} onChange={e => set_pay_ref(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="UTR / Txn ID…" />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => set_pay_modal(false)} className="px-4 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={add_payment} disabled={saving_pay || !pay_amount}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
              {saving_pay ? 'Saving…' : 'Record Payment'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Cancel Modal */}
      <Modal title="Cancel Invoice" open={cancel_modal} onClose={() => set_cancel_modal(false)}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">This will restore stock and mark the invoice as cancelled. This action cannot be undone.</p>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reason (required, min 5 chars)</label>
            <textarea value={cancel_reason} onChange={e => set_cancel_reason(e.target.value)} rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder="Reason for cancellation…" />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => set_cancel_modal(false)} className="px-4 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50">Back</button>
            <button onClick={cancel} disabled={cancel_reason.length < 5}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
              Confirm Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
