import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { billing_api, type estimate_list_out } from '../../api/billing'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'

const status_colors: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-700',
  converted: 'bg-green-100 text-green-700',
  closed:    'bg-gray-100 text-gray-500',
}

export default function estimate_list_page() {
  const nav = useNavigate()
  const [items, set_items]     = useState<estimate_list_out[]>([])
  const [total, set_total]     = useState(0)
  const [page, set_page]       = useState(1)
  const [status_f, set_status_f] = useState('')
  const [loading, set_loading] = useState(false)

  // convert modal
  const [conv_id, set_conv_id]         = useState<number | null>(null)
  const [conv_mode, set_conv_mode]     = useState('cash')
  const [conv_paid, set_conv_paid]     = useState('')
  const [converting, set_converting]   = useState(false)

  const per_page = 25

  async function load() {
    set_loading(true)
    try {
      const params: Record<string, unknown> = { page, per_page }
      if (status_f) params.status = status_f
      const res = await billing_api.list_estimates(params)
      set_items(res.data.data)
      set_total(res.data.total)
    } finally {
      set_loading(false)
    }
  }

  useEffect(() => { load() }, [page, status_f])

  async function do_convert() {
    if (!conv_id) return
    set_converting(true)
    try {
      const res = await billing_api.convert_estimate(conv_id, conv_mode, Number(conv_paid || 0))
      nav(`/billing/invoices/${res.data.id}`)
    } catch {
      set_converting(false)
    }
  }

  async function close_est(id: number) {
    if (!confirm('Mark this estimate as closed?')) return
    await billing_api.close_estimate(id)
    load()
  }

  const total_pages = Math.ceil(total / per_page)

  return (
    <div>
      <PageHeader
        title="Estimates / Quotations"
        subtitle={`${total} estimates`}
        action={
          <Link to="/billing/estimates/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">
            + New Estimate
          </Link>
        }
      />

      {/* status filter */}
      <div className="flex gap-3 mb-4">
        {['', 'pending', 'converted', 'closed'].map(s => (
          <button key={s} onClick={() => { set_status_f(s); set_page(1) }}
            className={`px-3 py-1.5 text-sm rounded-lg border transition ${
              status_f === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}>
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-left">
            <tr>
              <th className="px-4 py-3">Est No</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Valid Until</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">No estimates found</td></tr>
            ) : items.map(est => (
              <tr key={est.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-blue-600">{est.estimate_no}</td>
                <td className="px-4 py-3 text-gray-700">{est.customer_name}</td>
                <td className="px-4 py-3 text-gray-500">{est.estimate_date}</td>
                <td className="px-4 py-3 text-gray-400">{est.valid_until ?? '—'}</td>
                <td className="px-4 py-3 text-right font-semibold">₹{Number(est.total_amount).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status_colors[est.status] ?? ''}`}>
                    {est.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2 text-xs">
                    {est.status === 'pending' && <>
                      <button onClick={() => { set_conv_id(est.id); set_conv_paid('') }}
                        className="text-green-600 hover:underline">Convert</button>
                      <button onClick={() => close_est(est.id)}
                        className="text-gray-400 hover:text-gray-600 hover:underline">Close</button>
                    </>}
                    {est.status === 'converted' && est.converted_to && (
                      <Link to={`/billing/invoices/${est.converted_to}`}
                        className="text-blue-600 hover:underline">View Invoice</Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-600">
            <span>Page {page} of {total_pages} ({total} records)</span>
            <div className="flex gap-2">
              <button onClick={() => set_page(p => p - 1)} disabled={page === 1}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
              <button onClick={() => set_page(p => p + 1)} disabled={page === total_pages}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Convert to Invoice Modal */}
      <Modal title="Convert to Invoice" open={conv_id !== null} onClose={() => set_conv_id(null)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment Mode</label>
              <select value={conv_mode} onChange={e => set_conv_mode(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {['cash','card','upi','bank_transfer','credit'].map(m => (
                  <option key={m} value={m}>{m.replace('_', ' ').toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Paid Amount (advance)</label>
              <input type="number" min={0} step={0.01} value={conv_paid}
                onChange={e => set_conv_paid(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00" />
            </div>
          </div>
          <p className="text-xs text-gray-400">Stock will be deducted automatically on conversion.</p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => set_conv_id(null)} className="px-4 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={do_convert} disabled={converting}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {converting ? 'Converting…' : 'Convert to Invoice'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
