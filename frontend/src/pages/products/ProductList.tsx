import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { products_api, type product_list_item, type paginated } from '../../api/products'
import { masters_api, type unit_type, type product_classification_type } from '../../api/masters'
import PageHeader from '../../components/ui/PageHeader'
import StatusBadge from '../../components/ui/StatusBadge'

export default function product_list_page() {
  const [result, set_result] = useState<paginated<product_list_item> | null>(null)
  const [page, set_page] = useState(1)
  const [search, set_search] = useState('')
  const [loading, set_loading] = useState(true)
  const [low_stock_only, set_low_stock_only] = useState(false)
  const [units, set_units] = useState<unit_type[]>([])
  const [classifications, setClassifications] = useState<product_classification_type[]>([])
  const [base_uom_filter, set_base_uom_filter] = useState<number | undefined>()
  const [classification_filter, set_classification_filter] = useState<number | undefined>()

  async function load(p = page, s = search, ls = low_stock_only, uom = base_uom_filter, cls = classification_filter) {
    set_loading(true)
    try {
      const res = await products_api.list({ 
        page: p, 
        per_page: 25, 
        search: s, 
        low_stock: ls, 
        base_uom_id: uom,
        classification_id: cls 
      })
      set_result(res.data)
    } finally { set_loading(false) }
  }

  useEffect(() => { load(page, search, low_stock_only, base_uom_filter, classification_filter) }, [page])
  useEffect(() => {
    masters_api.get_units().then(r => set_units(r.data))
    masters_api.get_product_classifications().then(r => setClassifications(r.data))
  }, [])

  function handle_search(val: string) { set_search(val); set_page(1); load(1, val, low_stock_only, base_uom_filter, classification_filter) }
  function toggle_low_stock() { const ls = !low_stock_only; set_low_stock_only(ls); set_page(1); load(1, search, ls, base_uom_filter) }

  async function handle_delete(id: number, name: string) {
    if (!confirm(`Deactivate "${name}"?`)) return
    await products_api.delete(id)
    load()
  }

  const rows = result?.data ?? []

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={result ? `${result.total} products total` : 'Product master'}
        action={
          <Link to="/products/add"
            className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 shadow-lg shadow-blue-600/20 active:scale-95 transition-all">
            <i className="fas fa-plus mr-2"></i> Add New Item
          </Link>
        }
      />

      {/* filters */}
      <div className="flex gap-4 mb-6 flex-wrap items-center bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div className="relative">
          <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
          <input value={search} onChange={e => handle_search(e.target.value)}
            placeholder="Search name, code, barcode…"
            className="pl-10 pr-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 w-72 dark:bg-slate-800 transition-all outline-none" />
        </div>

        <select 
          value={base_uom_filter || ''} 
          onChange={e => {
            const v = e.target.value ? Number(e.target.value) : undefined;
            set_base_uom_filter(v); set_page(1); load(1, search, low_stock_only, v, classification_filter);
          }}
          className="px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white dark:bg-slate-800 outline-none cursor-pointer min-w-[140px]"
        >
          <option value="">— Base UOM —</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
        </select>

        <select 
          value={classification_filter || ''} 
          onChange={e => {
            const v = e.target.value ? Number(e.target.value) : undefined;
            set_classification_filter(v); set_page(1); load(1, search, low_stock_only, base_uom_filter, v);
          }}
          className="px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white dark:bg-slate-800 outline-none cursor-pointer min-w-[160px]"
        >
          <option value="">— Classification —</option>
          {classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <button onClick={toggle_low_stock}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${low_stock_only ? 'bg-amber-100 text-amber-700 border-amber-200 shadow-inner' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>
          <i className={`fas fa-exclamation-triangle ${low_stock_only ? 'text-amber-500' : 'text-slate-400'}`}></i>
          Low Stock Only
        </button>

        <button onClick={() => { set_search(''); set_base_uom_filter(undefined); set_classification_filter(undefined); set_low_stock_only(false); set_page(1); load(1, '', false, undefined, undefined); }}
          className="p-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-all" title="Clear Filters">
          <i className="fas fa-undo-alt"></i>
        </button>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{result?.total ?? 0} ITEMS FOUND</span>
          <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-700"></div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-black tracking-widest border-b dark:bg-slate-800/50 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3">IMG</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-center">Unit</th>
                <th className="px-4 py-3 text-center">Inner Pack</th>
                <th className="px-4 py-3 text-center">Outer Qty</th>
                <th className="px-4 py-3 text-center">Total PCS</th>
                <th className="px-4 py-3 text-right">Selling</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={11} className="text-center py-10 text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-10 text-gray-400">No products found</td></tr>
              ) : rows.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors border-b dark:border-slate-800/50">
                  <td className="px-4 py-3">
                    {p.thumbnail_img ? (
                      <img src={p.thumbnail_img} className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shadow-sm" alt="" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-300 dark:text-slate-600 border border-slate-100 dark:border-slate-700">
                        <i className="fas fa-image"></i>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400">{p.item_code}</td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800 dark:text-slate-200">{p.name}</div>
                    <div className="text-[10px] text-slate-400 font-medium">{p.brand || 'No Brand'}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 font-medium">{p.category}</td>
                  <td className="px-4 py-3 text-center text-xs font-bold text-slate-600 dark:text-slate-400">{p.unit}</td>
                  <td className="px-4 py-3 text-center text-xs font-mono">{p.inner_pack_qty || '—'}</td>
                  <td className="px-4 py-3 text-center text-xs font-mono">{p.outer_carton_qty || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-mono text-[11px] font-black">
                      {p.total_pcs_in_carton || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-green-600 dark:text-green-400">₹{parseFloat(p.selling_price).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-mono font-bold ${parseFloat(p.stock_qty) <= 5 ? 'text-rose-500' : 'text-slate-700 dark:text-slate-300'}`}>
                      {parseFloat(p.stock_qty).toFixed(0)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge active={p.is_active} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <Link to={`/products/edit/${p.id}`} className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all" title="Edit">
                        <i className="fas fa-edit"></i>
                      </Link>
                      <button onClick={() => handle_delete(p.id, p.name)} className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-all" title="Deactivate">
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {result && result.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-600">
            <span>Showing {rows.length} of {result.total} products</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => set_page(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">Prev</button>
              <span className="px-3 py-1">Page {page} / {result.total_pages}</span>
              <button disabled={page === result.total_pages} onClick={() => set_page(p => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
