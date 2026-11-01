import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { purchases_api, type po_list_item } from '../../api/purchases'

const STATUS_STYLE: Record<string, string> = {
  draft:            'bg-slate-100 text-slate-600',
  pending_approval: 'bg-yellow-100 text-yellow-700',
  approved:         'bg-green-100 text-green-700',
  partial:          'bg-blue-100 text-blue-700',
  completed:        'bg-emerald-100 text-emerald-700',
  cancelled:        'bg-red-100 text-red-600',
}

function fmt_amt(n: number) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmt_date(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function POList() {
  const navigate = useNavigate()

  const [rows, set_rows]         = useState<po_list_item[]>([])
  const [loading, set_loading]   = useState(true)
  const [total, set_total]       = useState(0)
  const [page, set_page]         = useState(1)
  const [status_f, set_status_f] = useState('')
  const per_page = 20

  useEffect(() => {
    set_loading(true)
    purchases_api.list_pos({ page, per_page, status: status_f || undefined })
      .then(r => {
        set_rows(r.data.data)
        set_total(r.data.total)
      })
      .catch(() => {})
      .finally(() => set_loading(false))
  }, [page, status_f])

  const total_pages = Math.ceil(total / per_page)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <span className="bg-yellow-400 text-yellow-900 p-1.5 rounded-lg">
              <i className="fas fa-file-invoice"></i>
            </span>
            Purchase Orders
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Head Office → Supplier order management</p>
        </div>
        <button
          onClick={() => navigate('/purchases/po/create')}
          className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold px-5 py-2.5 rounded-xl shadow-sm flex items-center gap-2 transition-colors"
        >
          <i className="fas fa-plus"></i> New PO
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'draft', 'pending_approval', 'approved', 'partial', 'completed', 'cancelled'].map(s => (
          <button
            key={s}
            onClick={() => { set_status_f(s); set_page(1) }}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
              status_f === s
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
            }`}
          >
            {s === '' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-4 py-3 text-left">PO Number</th>
                <th className="px-4 py-3 text-left">Supplier</th>
                <th className="px-4 py-3 text-left">Outlet</th>
                <th className="px-4 py-3 text-left">PO Date</th>
                <th className="px-4 py-3 text-left">Exp. Delivery</th>
                <th className="px-4 py-3 text-center">Items</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Approval</th>
                <th className="px-4 py-3 text-center w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <i className="fas fa-spinner fa-spin mr-2"></i> Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <div className="text-3xl mb-2">📋</div>
                    No purchase orders found
                    <div className="mt-3">
                      <button onClick={() => navigate('/purchases/po/create')}
                        className="text-blue-600 underline text-xs">
                        Create your first PO
                      </button>
                    </div>
                  </td>
                </tr>
              ) : rows.map(po => (
                <tr key={po.id}
                  className="hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/purchases/po/${po.id}`)}>
                  <td className="px-4 py-3 font-black text-blue-700 font-mono hover:underline">
                    <div className="flex items-center gap-2">
                      {po.po_no}
                      {po.is_master && <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[9px] uppercase">Master</span>}
                      {po.parent_po_id && <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[9px] uppercase">Child</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700">{po.supplier_name}</td>
                  <td className="px-4 py-3 text-slate-500">{po.outlet_name || <span className="italic text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-slate-500">{fmt_date(po.po_date)}</td>
                  <td className="px-4 py-3 text-slate-500">{po.expected_date ? fmt_date(po.expected_date) : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full">
                      {po.item_count ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono text-slate-800">
                    {fmt_amt(po.total_amount)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLE[po.status] || 'bg-slate-100 text-slate-500'}`}>
                      {po.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      po.approval_status === 'approved' ? 'bg-green-100 text-green-700' :
                      po.approval_status === 'rejected' ? 'bg-red-100 text-red-600' :
                      'bg-slate-100 text-slate-500'
                    }`}>
                      {po.approval_status || 'pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-center gap-1">
                      <button
                        onClick={() => navigate(`/purchases/po/${po.id}`)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
                        title="View">
                        <i className="fas fa-eye text-xs"></i>
                      </button>
                      {(po.status === 'draft') && (
                        <button
                          onClick={() => navigate(`/purchases/po/edit/${po.id}`)}
                          className="p-1.5 text-slate-400 hover:text-amber-600 transition-colors"
                          title="Edit">
                          <i className="fas fa-edit text-xs"></i>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total_pages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Showing {(page - 1) * per_page + 1}–{Math.min(page * per_page, total)} of {total} POs
            </span>
            <div className="flex gap-1">
              <button
                disabled={page === 1}
                onClick={() => set_page(p => p - 1)}
                className="px-2.5 py-1 rounded border border-slate-200 text-xs disabled:opacity-40 hover:bg-slate-50">
                ‹ Prev
              </button>
              <span className="px-3 py-1 text-xs text-slate-600 font-semibold">{page} / {total_pages}</span>
              <button
                disabled={page >= total_pages}
                onClick={() => set_page(p => p + 1)}
                className="px-2.5 py-1 rounded border border-slate-200 text-xs disabled:opacity-40 hover:bg-slate-50">
                Next ›
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
