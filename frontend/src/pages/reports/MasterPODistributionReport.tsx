import { useState, useEffect } from 'react'
import { purchases_api, po_list_item } from '../../api/purchases'
import { Link } from 'react-router-dom'

export default function MasterPODistributionReport() {
  const [rows, setRows] = useState<po_list_item[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    purchases_api.list_pos({ per_page: 100, is_master: true }).then(res => {
      setRows(res.data.data)
    }).finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center text-xl shadow-inner">
          <i className="fas fa-sitemap"></i>
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-800 tracking-tight">Master PO Distribution Report</h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">Track HO Master Purchase Orders and their outlet allocations</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-bold uppercase tracking-wider">Master PO No</th>
                <th className="px-4 py-3 font-bold uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 font-bold uppercase tracking-wider">Supplier</th>
                <th className="px-4 py-3 font-bold uppercase tracking-wider text-center">Items</th>
                <th className="px-4 py-3 font-bold uppercase tracking-wider text-right">Total Amount</th>
                <th className="px-4 py-3 font-bold uppercase tracking-wider text-center">Status</th>
                <th className="px-4 py-3 font-bold uppercase tracking-wider text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400 font-medium">
                  <i className="fas fa-spinner fa-spin mr-2"></i>Loading Master POs...
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400">
                  <div className="text-3xl mb-2">📄</div>
                  <div className="font-semibold text-sm">No Master POs found</div>
                  <div className="text-xs mt-1">Create a PO with Multi-Outlet enabled to see it here.</div>
                </td></tr>
              ) : rows.map(po => (
                <tr key={po.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-black text-indigo-600 font-mono hover:underline">
                    <Link to={`/purchases/po/${po.id}`}>{po.po_no}</Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-medium">{new Date(po.po_date).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{po.supplier_name}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full">{po.item_count}</span>
                  </td>
                  <td className="px-4 py-3 font-bold text-right font-mono text-slate-800">
                    ₹{po.total_amount.toLocaleString('en-IN', {minimumFractionDigits:2})}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      po.approval_status === 'approved' ? 'bg-green-100 text-green-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {po.approval_status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Link to={`/purchases/po/${po.id}`} className="text-indigo-600 hover:text-indigo-800 font-semibold text-[11px] bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors inline-block">
                      View Distributions
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
