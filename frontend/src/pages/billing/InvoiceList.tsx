import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { billing_api, type invoice_list_out } from '../../api/billing'
import { customers_api } from '../../api/customers'
import { masters_api } from '../../api/masters'
import { getCompanySettings } from '../../api/company'
import { printReceipt } from '../../utils/printReceipt'
import PageHeader from '../../components/ui/PageHeader'

async function print_invoice(inv: invoice_list_out) {
  try {
    const [full, cust, settings] = await Promise.all([
      billing_api.get_invoice(inv.id), customers_api.get(inv.customer_id).catch(() => null), getCompanySettings(),
    ])
    printReceipt(full.data, settings, { customer_name: cust?.data.name, customer_phone: cust?.data.phone })
  } catch {
    toast.error(`Could not print ${inv.invoice_no}`)
  }
}

const status_colors: Record<string, string> = {
  unpaid:    'bg-red-100 text-red-700',
  partial:   'bg-yellow-100 text-yellow-700',
  paid:      'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

export default function invoice_list_page() {
  const [items, set_items] = useState<invoice_list_out[]>([])
  const [total, set_total] = useState(0)
  const [page, set_page] = useState(1)
  const [status_filter, set_status_filter] = useState('')
  const [outlet_filter, set_outlet_filter] = useState('')
  const [outlets, set_outlets] = useState<{ id: number; outlet_name: string; unit_code: string }[]>([])
  const [loading, set_loading] = useState(false)
  const per_page = 25

  async function load() {
    set_loading(true)
    try {
      const params: Record<string, unknown> = { page, per_page }
      if (status_filter) params.status = status_filter
      if (outlet_filter) params.outlet_id = outlet_filter
      const res = await billing_api.list_invoices(params)
      set_items(res.data.data)
      set_total(res.data.total)
    } finally {
      set_loading(false)
    }
  }

  useEffect(() => { load() }, [page, status_filter, outlet_filter])
  useEffect(() => { masters_api.get_outlets().then(r => set_outlets(r.data || [])).catch(() => {}) }, [])

  const total_pages = Math.ceil(total / per_page)

  return (
    <div>
      <PageHeader
        title="Sales Invoices"
        subtitle={`${total} invoices`}
        action={
          <Link to="/billing/invoices/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">
            + New Invoice
          </Link>
        }
      />

      {/* filters */}
      <div className="flex gap-3 mb-4">
        {['', 'unpaid', 'partial', 'paid', 'cancelled'].map(s => (
          <button key={s} onClick={() => { set_status_filter(s); set_page(1) }}
            className={`px-3 py-1.5 text-sm rounded-lg border transition ${
              status_filter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}>
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        {outlets.length > 1 && (
          <select value={outlet_filter} onChange={e => { set_outlet_filter(e.target.value); set_page(1) }}
            className="ml-auto px-3 py-1.5 text-sm rounded-lg border bg-white text-gray-700">
            <option value="">All Locations</option>
            {outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name} ({o.unit_code})</option>)}
          </select>
        )}
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-left">
            <tr>
              <th className="px-4 py-3">Invoice No</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Paid</th>
              <th className="px-4 py-3 text-right">Due</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={9} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-10 text-gray-400">No invoices found</td></tr>
            ) : items.map(inv => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-blue-600">
                  <Link to={`/billing/invoices/${inv.id}`}>{inv.invoice_no}</Link>
                </td>
                <td className="px-4 py-3 text-gray-500">{inv.invoice_date}</td>
                <td className="px-4 py-3 text-gray-600">{inv.outlet_name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">
                  {inv.split?.length
                    ? inv.split.map(p => `${p.payment_mode === 'upi' ? 'UPI' : p.payment_mode.charAt(0).toUpperCase() + p.payment_mode.slice(1)} ₹${Number(p.amount).toFixed(2)}`).join(' + ')
                    : <span className="capitalize">{inv.payment_mode}</span>}
                </td>
                <td className="px-4 py-3 text-right font-semibold">₹{Number(inv.total_amount).toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-green-600">₹{Number(inv.paid_amount).toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-red-600">₹{Number(inv.due_amount).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status_colors[inv.status] ?? ''}`}>
                    {inv.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                  <button onClick={() => print_invoice(inv)} className="text-xs text-gray-600 hover:text-blue-600" title="Print bill">
                    <i className="fas fa-print" /> Print
                  </button>
                  <Link to={`/billing/invoices/${inv.id}`}
                    className="text-xs text-blue-600 hover:underline">View</Link>
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
    </div>
  )
}
