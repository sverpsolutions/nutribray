import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { stock_take_api, type StockTakeDetail, type StockTakeItem } from '../../api/stockTake'

export default function StockTakeView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [session, setSession] = useState<StockTakeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterMode, setFilterMode] = useState<'all' | 'variance' | 'counted' | 'surplus' | 'shortage' | 'uncounted'>('all')
  const [search, setSearch] = useState('')
  const [adjustStock, setAdjustStock] = useState(true)
  const [finalizing, setFinalizing] = useState(false)

  const loadData = () => {
    if (!id) return
    setLoading(true)
    stock_take_api.get(Number(id))
      .then(r => setSession(r.data))
      .catch(() => {
        toast.error('Failed to load stock take details')
        navigate('/inventory/stock-take')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [id])

  const handleFinalize = async () => {
    if (!session) return
    if (!window.confirm('Finalize this stock take? This cannot be undone.')) return
    setFinalizing(true)
    try {
      await stock_take_api.finalize(session.id, { adjust_stock: adjustStock })
      toast.success('Stock take finalized successfully!')
      loadData()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to finalize')
    } finally {
      setFinalizing(false)
    }
  }

  const exportCSV = (varianceOnly = false) => {
    if (!session) return
    const exportItems = varianceOnly
      ? session.items.filter(i => i.variance !== null && i.variance !== 0)
      : session.items

    const headers = ['SI', 'Item Code', 'Product Name', 'Unit', 'System Qty', 'Counted Qty', 'Variance', 'Cost Price', 'Value Impact']
    const rows = exportItems.map((it, idx) => [
      idx + 1,
      `"${it.item_code || ''}"`,
      `"${it.product_name || ''}"`,
      it.unit,
      it.system_qty,
      it.counted_qty !== null ? it.counted_qty : '—',
      it.variance !== null ? it.variance : '—',
      it.cost_price,
      it.value_impact,
    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `${session.take_no}_${varianceOnly ? 'variance' : 'full'}_export.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        <i className="fas fa-spinner fa-spin text-2xl mr-2"></i> Loading stock take session…
      </div>
    )
  }

  if (!session) return null

  const isInProgress = session.status === 'in_progress'
  const isCompleted = session.status === 'completed'

  // Filter items
  const filteredItems = session.items.filter(it => {
    if (search.trim()) {
      const q = search.toLowerCase()
      const matchesSearch = it.product_name?.toLowerCase().includes(q) || it.item_code?.toLowerCase().includes(q)
      if (!matchesSearch) return false
    }

    if (filterMode === 'variance') return it.variance !== null && it.variance !== 0
    if (filterMode === 'counted') return it.counted_qty !== null
    if (filterMode === 'surplus') return it.variance !== null && it.variance > 0
    if (filterMode === 'shortage') return it.variance !== null && it.variance < 0
    if (filterMode === 'uncounted') return it.counted_qty === null
    return true
  })

  return (
    <div className="p-4 space-y-4 font-sans text-slate-800 max-w-7xl mx-auto">
      {/* ── HEADER ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl border border-slate-100 shadow-sm print:hidden">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <i className="fas fa-clipboard-check text-blue-700"></i> Stock Take — {session.take_no}
            </h1>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                isInProgress
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : isCompleted
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-slate-100 text-slate-600 border border-slate-300'
              }`}
            >
              {session.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Location: <b className="text-slate-700">{session.location_name}</b> &nbsp;·&nbsp; Started: {new Date(session.started_at).toLocaleString()}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isInProgress && (
            <button
              onClick={() => navigate(`/inventory/stock-take/count/${session.id}`)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs shadow transition-colors flex items-center gap-1.5"
            >
              <i className="fas fa-play"></i> ▶ Continue Counting
            </button>
          )}

          <button
            onClick={() => window.open(`/inventory/stock-take/variance-print/${session.id}`, '_blank')}
            className="px-3.5 py-2 border border-slate-300 text-slate-700 font-semibold rounded-xl text-xs hover:bg-slate-50 transition-colors flex items-center gap-1.5"
          >
            <i className="fas fa-print"></i> 🖨 Print Variance Report
          </button>

          <button
            onClick={() => exportCSV(true)}
            className="px-3 py-2 border border-emerald-300 text-emerald-700 font-semibold rounded-xl text-xs hover:bg-emerald-50 transition-colors flex items-center gap-1"
          >
            <i className="fas fa-file-csv"></i> Export Variance
          </button>

          <button
            onClick={() => exportCSV(false)}
            className="px-3 py-2 border border-blue-300 text-blue-700 font-semibold rounded-xl text-xs hover:bg-blue-50 transition-colors flex items-center gap-1"
          >
            <i className="fas fa-file-excel"></i> Export Full Sheet
          </button>

          <button
            onClick={() => navigate('/inventory/stock-take')}
            className="px-3 py-2 border border-slate-300 text-slate-600 font-semibold rounded-xl text-xs hover:bg-slate-50 transition-colors"
          >
            ← Back
          </button>
        </div>
      </div>

      {/* ── 4 SUMMARY CARDS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:grid-cols-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
          <div className="text-3xl font-black text-slate-800 font-mono">{session.total_items}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Total Items</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
          <div className="text-3xl font-black text-amber-600 font-mono">{session.items_with_variance}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Items with Variance</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
          <div className="text-3xl font-black text-blue-600 font-mono">+{session.surplus_items}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Surplus Items (+)</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-center">
          <div className="text-3xl font-black text-red-600 font-mono">−{session.shortage_items}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Shortage Items (−)</div>
        </div>
      </div>

      {/* ── VARIANCE VALUE & AUDIT STRIP ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex justify-between items-center">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Variance Value</div>
            <div
              className={`text-2xl font-black font-mono mt-1 ${
                session.total_variance_value >= 0 ? 'text-blue-700' : 'text-red-600'
              }`}
            >
              {session.total_variance_value >= 0 ? '+' : ''}₹{Number(session.total_variance_value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="text-slate-300 text-3xl">
            <i className="fas fa-coins"></i>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-xs space-y-1">
          <div>Started by: <b className="text-slate-800">{session.started_by_name || 'System'}</b></div>
          <div className="text-slate-500">Started at: {new Date(session.started_at).toLocaleString()}</div>
          {session.notes && <div className="text-slate-600 italic mt-1">"{session.notes}"</div>}
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs text-xs space-y-1">
          <div>Finalized by: <b className="text-slate-800">{session.finalized_by_name || '—'}</b></div>
          <div className="text-slate-500">
            Finalized at: {session.finalized_at ? new Date(session.finalized_at).toLocaleString() : 'Not finalized yet'}
          </div>
          <div className="pt-1">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                session.adjust_stock ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {session.adjust_stock ? 'Stock Adjusted' : 'Stock Not Adjusted'}
            </span>
          </div>
        </div>
      </div>

      {/* ── IN PROGRESS FINALIZE CARD ── */}
      {isInProgress && (
        <div className="bg-emerald-50 border border-emerald-300 p-4 rounded-xl shadow-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <div className="text-sm font-bold text-emerald-900">
              Ready to finalize this Stock Take?
            </div>
            <div className="text-xs text-emerald-700 mt-0.5 flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer font-semibold">
                <input
                  type="checkbox"
                  checked={adjustStock}
                  onChange={e => setAdjustStock(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                Adjust system stock to match physical count
              </label>
            </div>
          </div>
          <button
            onClick={handleFinalize}
            disabled={finalizing}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow transition-colors flex items-center gap-1.5"
          >
            {finalizing ? (
              <>
                <i className="fas fa-spinner fa-spin"></i> Finalizing…
              </>
            ) : (
              <>
                <i className="fas fa-check-circle"></i> Finalize Stock Take
              </>
            )}
          </button>
        </div>
      )}

      {/* ── ITEM SUMMARY TABLE WITH FILTER TABS ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Table Filters */}
        <div className="p-3 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { key: 'all', label: `All (${session.items.length})` },
              { key: 'variance', label: `Variance Only (${session.items_with_variance})` },
              { key: 'surplus', label: `Surplus (+${session.surplus_items})` },
              { key: 'shortage', label: `Shortage (−${session.shortage_items})` },
              { key: 'counted', label: `Counted (${session.counted_items})` },
              { key: 'uncounted', label: `Uncounted (${session.not_yet_scanned})` },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilterMode(tab.key as any)}
                className={`px-3 py-1 text-xs rounded-lg font-semibold transition-colors ${
                  filterMode === tab.key
                    ? 'bg-blue-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Search items or codes in table…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-blue-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-900 text-white uppercase text-[10.5px] font-semibold tracking-wider">
              <tr>
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Item Code</th>
                <th className="py-2.5 px-3">Product Name</th>
                <th className="py-2.5 px-3 text-center">Unit</th>
                <th className="py-2.5 px-3 text-right">System Qty</th>
                <th className="py-2.5 px-3 text-right">Counted Qty</th>
                <th className="py-2.5 px-3 text-right">Variance</th>
                <th className="py-2.5 px-3 text-right">Cost Price</th>
                <th className="py-2.5 px-3 text-right">Value Impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    No items match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredItems.map((it, idx) => {
                  const isPositive = (it.variance || 0) > 0
                  const isNegative = (it.variance || 0) < 0
                  const hasBatches = Boolean(it.batches && it.batches.length > 0)

                  return (
                    <React.Fragment key={it.id}>
                      <tr className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2 px-3 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-2 px-3 font-mono text-slate-600">{it.item_code || '—'}</td>
                        <td className="py-2 px-3 font-semibold text-slate-800">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{it.product_name}</span>
                            {hasBatches && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-purple-100 text-purple-800 border border-purple-200">
                                {it.batches!.length} Lots
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center text-slate-500">{it.unit}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {Number(it.system_qty).toFixed(3)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                          {it.counted_qty !== null ? Number(it.counted_qty).toFixed(3) : <span className="text-slate-400 font-normal">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold">
                          {it.variance === null ? (
                            <span className="text-slate-400 font-normal">—</span>
                          ) : (
                            <span className={isPositive ? 'text-blue-600' : isNegative ? 'text-red-600' : 'text-emerald-600'}>
                              {isPositive ? `+${it.variance.toFixed(3)}` : it.variance.toFixed(3)}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          ₹{Number(it.cost_price || 0).toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold">
                          {it.value_impact === 0 ? (
                            <span className="text-slate-400">₹0.00</span>
                          ) : (
                            <span className={it.value_impact > 0 ? 'text-blue-600' : 'text-red-600'}>
                              {it.value_impact > 0 ? '+' : ''}₹{Number(it.value_impact).toFixed(2)}
                            </span>
                          )}
                        </td>
                      </tr>

                      {hasBatches && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={9} className="py-1.5 px-6">
                            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-2xs">
                              <div className="bg-slate-100 px-3 py-1 font-bold text-[10px] text-slate-700 flex items-center justify-between">
                                <span className="flex items-center gap-1.5">
                                  <i className="fas fa-boxes text-purple-600"></i> Batch Verification Breakdown:
                                </span>
                                <span className="text-[10px] text-slate-500 font-normal">{it.batches!.length} lot(s)</span>
                              </div>
                              <table className="w-full text-left text-[11px]">
                                <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[9.5px]">
                                  <tr>
                                    <th className="py-1 px-3">Batch / Lot No</th>
                                    <th className="py-1 px-3">Mfg Date</th>
                                    <th className="py-1 px-3">Expiry Date</th>
                                    <th className="py-1 px-3 text-right">System Qty</th>
                                    <th className="py-1 px-3 text-right">Physical Count</th>
                                    <th className="py-1 px-3 text-right">Variance</th>
                                    <th className="py-1 px-3">Reason</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-mono">
                                  {it.batches!.map((b, bIdx) => {
                                    const bPos = (b.variance || 0) > 0
                                    const bNeg = (b.variance || 0) < 0
                                    return (
                                      <tr key={bIdx} className="hover:bg-slate-50/60">
                                        <td className="py-1 px-3 font-bold text-slate-800">{b.batch_no}</td>
                                        <td className="py-1 px-3 text-slate-500">{b.mfg_date || '—'}</td>
                                        <td className="py-1 px-3 text-slate-700">{b.expiry_date || (b as any).exp_date || '—'}</td>
                                        <td className="py-1 px-3 text-right text-slate-600">{Number(b.system_qty).toFixed(3)}</td>
                                        <td className="py-1 px-3 text-right font-bold text-slate-900">
                                          {b.counted_qty !== null ? Number(b.counted_qty).toFixed(3) : '—'}
                                        </td>
                                        <td className={`py-1 px-3 text-right font-bold ${
                                          bPos ? 'text-blue-600' : bNeg ? 'text-red-600' : 'text-slate-500'
                                        }`}>
                                          {bPos ? `+${Number(b.variance).toFixed(3)}` : Number(b.variance || 0).toFixed(3)}
                                        </td>
                                        <td className="py-1 px-3 text-slate-600 font-sans">{b.reason || '—'}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
