import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { stock_take_api, type StockTakeSummary } from '../../api/stockTake'
import { masters_api } from '../../api/masters'

export default function StockTakeList() {
  const navigate = useNavigate()

  const [takes, setTakes] = useState<StockTakeSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage] = useState(25)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [inProgressAlert, setInProgressAlert] = useState<any | null>(null)

  // Start New Modal State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [outlets, setOutlets] = useState<any[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState<number | ''>('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)

  const loadData = () => {
    setLoading(true)
    stock_take_api.list({ page, per_page: perPage, status: statusFilter || undefined })
      .then(res => {
        setTakes(res.data.data || [])
        setTotal(res.data.total || 0)
        setInProgressAlert(res.data.in_progress_alert || null)
      })
      .catch(() => toast.error('Failed to load stock takes'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [page, statusFilter])

  useEffect(() => {
    masters_api.get_outlets()
      .then(r => {
        const list = r.data || []
        setOutlets(list)
        if (list.length > 0 && !selectedLocationId) {
          setSelectedLocationId(list[0].id)
        }
      })
      .catch(() => {})
  }, [])

  const handleStartTake = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLocationId) {
      toast.error('Please select an outlet location')
      return
    }

    setCreating(true)
    try {
      const res = await stock_take_api.create({
        location_id: Number(selectedLocationId),
        notes: notes.trim() || undefined,
      })
      toast.success(`Stock take ${res.data.take_no} started with ${res.data.total_items} items!`)
      setShowCreateModal(false)
      navigate(`/inventory/stock-take/count/${res.data.id}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to start stock take')
    } finally {
      setCreating(false)
    }
  }

  const handleCancelTake = async (id: number, takeNo: string) => {
    if (!window.confirm(`Are you sure you want to cancel stock take ${takeNo}? This will mark it cancelled.`)) return
    try {
      await stock_take_api.cancel(id)
      toast.success(`Stock take ${takeNo} cancelled`)
      loadData()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to cancel')
    }
  }

  return (
    <div className="p-4 space-y-4 font-sans text-slate-800">
      {/* ── HEADER ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
            <span className="bg-blue-900 text-white p-2 rounded-lg flex items-center justify-center">
              <i className="fas fa-clipboard-check text-sm"></i>
            </span>
            Stock Takes (Physical Stock Count)
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Conduct physical counts, verify variances against system stock, and adjust inventory with full audit logs
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-700 hover:bg-blue-800 text-white font-bold py-2 px-5 rounded-xl shadow transition-colors text-xs flex items-center gap-1.5"
        >
          <i className="fas fa-plus text-xs"></i> + New Stock Take
        </button>
      </div>

      {/* ── IN PROGRESS ALERT BANNER ── */}
      {inProgressAlert && (
        <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl shadow-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-lg shrink-0">
              <i className="fas fa-exclamation-triangle"></i>
            </div>
            <div>
              <div className="text-sm font-bold text-amber-900">
                In-Progress Stock Take Active: <span className="font-mono">{inProgressAlert.take_no}</span>
              </div>
              <div className="text-xs text-amber-700">
                Location: <b>{inProgressAlert.location_name}</b> &nbsp;·&nbsp; Started: {inProgressAlert.started_at} &nbsp;·&nbsp; Counted: <b>{inProgressAlert.counted_items} / {inProgressAlert.total_items}</b>
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate(`/inventory/stock-take/count/${inProgressAlert.id}`)}
            className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow transition-colors flex items-center gap-1.5"
          >
            <i className="fas fa-play text-xs"></i> Continue Counting
          </button>
        </div>
      )}

      {/* ── FILTER TOOLBAR ── */}
      <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Status:</span>
          {['', 'in_progress', 'completed', 'cancelled'].map(st => (
            <button
              key={st}
              onClick={() => { setStatusFilter(st); setPage(1) }}
              className={`px-3 py-1 text-xs rounded-lg font-semibold transition-colors ${
                statusFilter === st
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st === '' ? 'All' : st === 'in_progress' ? 'In Progress' : st === 'completed' ? 'Completed' : 'Cancelled'}
            </button>
          ))}
        </div>
        <button
          onClick={loadData}
          className="text-xs text-slate-600 hover:text-slate-900 px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-1"
        >
          <i className="fas fa-sync-alt text-[10px]"></i> Refresh
        </button>
      </div>

      {/* ── TABLE ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white uppercase text-[11px] tracking-wider font-semibold">
                <th className="py-3 px-4">Take #</th>
                <th className="py-3 px-4">Location</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 w-48">Progress</th>
                <th className="py-3 px-4">Started By</th>
                <th className="py-3 px-4">Started At</th>
                <th className="py-3 px-4">Finalized By</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    <i className="fas fa-spinner fa-spin text-2xl mb-2 block"></i> Loading stock takes…
                  </td>
                </tr>
              ) : takes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-slate-400">
                    <div className="text-3xl mb-2">📋</div>
                    No stock take sessions found. Click "+ New Stock Take" to begin counting inventory.
                  </td>
                </tr>
              ) : (
                takes.map(t => {
                  const isInProgress = t.status === 'in_progress'
                  const isCompleted = t.status === 'completed'
                  const isCancelled = t.status === 'cancelled'

                  return (
                    <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-blue-700">
                        {t.take_no}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800">
                        {t.location_name}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            isInProgress
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : isCompleted
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-slate-100 text-slate-600 border border-slate-300'
                          }`}
                        >
                          {t.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="w-full bg-slate-100 rounded-full h-2 mb-1 overflow-hidden">
                          <div
                            className={`h-2 rounded-full ${isCompleted ? 'bg-emerald-600' : 'bg-blue-600'}`}
                            style={{ width: `${Math.min(100, t.progress_percent)}%` }}
                          ></div>
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono flex justify-between">
                          <span>{t.counted_items} / {t.total_items} items</span>
                          <span className="font-bold">{t.progress_percent}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {t.started_by_name}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                        {t.started_at ? new Date(t.started_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {t.finalized_by_name || '—'}
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {isInProgress ? (
                          <>
                            <button
                              onClick={() => navigate(`/inventory/stock-take/count/${t.id}`)}
                              className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1 rounded text-[11px] shadow-xs inline-flex items-center gap-1"
                              title="Continue scanning items"
                            >
                              <i className="fas fa-barcode"></i> Continue
                            </button>
                            <button
                              onClick={() => navigate(`/inventory/stock-take/view/${t.id}`)}
                              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-2.5 py-1 rounded text-[11px] shadow-xs inline-flex items-center gap-1"
                              title="View session details"
                            >
                              <i className="fas fa-eye"></i> View
                            </button>
                            <button
                              onClick={() => handleCancelTake(t.id, t.take_no)}
                              className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-semibold px-2 py-1 rounded text-[11px]"
                              title="Cancel stock take"
                            >
                              <i className="fas fa-times"></i>
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => navigate(`/inventory/stock-take/view/${t.id}`)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-3 py-1 rounded text-[11px] inline-flex items-center gap-1"
                          >
                            <i className="fas fa-eye"></i> View
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── START NEW STOCK TAKE MODAL (Screen 2.2) ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center">
              <h2 className="text-base font-bold flex items-center gap-2">
                <i className="fas fa-boxes"></i> Start New Stock Take
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-white/70 hover:text-white text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleStartTake} className="p-6 space-y-4 text-xs">
              {/* Alert box */}
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl flex items-start gap-2.5">
                <i className="fas fa-info-circle text-amber-600 mt-0.5 text-sm shrink-0"></i>
                <div className="leading-relaxed">
                  Starting a new stock take will automatically cancel any existing in-progress stock take for the selected location. All active products will be pre-loaded with their current stock for verification.
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Location / Outlet<span className="text-red-500">*</span>:
                </label>
                <select
                  value={selectedLocationId}
                  onChange={e => setSelectedLocationId(Number(e.target.value))}
                  required
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:border-blue-500 focus:outline-hidden"
                >
                  {outlets.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.outlet_name} {o.type === 'H' ? '(Head Office / Central)' : '(Retail Outlet)'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Audit Notes / Purpose (optional):
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Monthly physical stock audit, End of financial year count…"
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold shadow transition-colors flex items-center gap-1.5"
                >
                  {creating ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Initializing…
                    </>
                  ) : (
                    <>
                      <i className="fas fa-play text-xs"></i> ▶ Start Stock Take
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
