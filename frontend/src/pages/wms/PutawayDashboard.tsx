import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import HHTLayout from '../../layouts/HHTLayout';
import api from '../../api/axios';

const PutawayDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pendingGRNs, setPendingGRNs] = useState<any[]>([]);
  const [stats, setStats] = useState({
    total_pending: 0,
    rack_util: 0,
    today_putaway: 0,
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      await api.post('/wms/sync-grns');
      const [grnRes, statsRes] = await Promise.all([
        api.get('/wms/pending-grns'),
        api.get('/wms/dashboard'),
      ]);
      setPendingGRNs(grnRes.data);
      setStats({
        total_pending: statsRes.data.total_pending_grn,
        rack_util: statsRes.data.rack_utilization_pct,
        today_putaway: statsRes.data.today_putaway_qty,
      });
    } catch (error) {
      console.error('Error fetching WMS data', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <HHTLayout title="WMS Putaway">

      {/* ── Stat Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-blue-600 text-white rounded-2xl p-4">
          <p className="text-3xl font-black">{stats.total_pending}</p>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-80 mt-1">Pending GRNs</p>
        </div>
        <div className="bg-green-600 text-white rounded-2xl p-4">
          <p className="text-3xl font-black">{stats.rack_util}%</p>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-80 mt-1">Rack Util.</p>
        </div>
      </div>

      {/* ── List Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-black text-blue-600 uppercase tracking-widest">Pending Putaway List</p>
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 rounded-full hover:bg-slate-100 transition-colors disabled:opacity-40"
        >
          <i className={`fas fa-sync-alt text-sm text-slate-500 ${loading ? 'animate-spin' : ''}`}></i>
        </button>
      </div>

      {/* ── GRN List Card ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden flex-1">
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse space-y-2">
                <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                <div className="h-3 bg-slate-100 rounded w-1/2"></div>
                <div className="h-2 bg-slate-100 rounded w-full"></div>
              </div>
            ))}
          </div>
        ) : pendingGRNs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="w-16 h-16 bg-green-100 text-green-500 rounded-2xl flex items-center justify-center mb-4 text-3xl">
              <i className="fas fa-check-circle"></i>
            </div>
            <p className="font-black text-slate-700 text-base">All Putaway Completed!</p>
            <p className="text-xs text-slate-400 mt-1">No pending GRNs at the moment.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pendingGRNs.map((grn) => {
              const progress = Math.round(((grn.placed_items ?? 0) / (grn.total_items || 1)) * 100);
              return (
                <li key={grn.id}>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-blue-50/40 transition-colors"
                    onClick={() => navigate(`/hht/putaway/${grn.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-slate-800 text-base leading-tight">{grn.grn_no}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Items: {grn.total_items} &nbsp;|&nbsp; Status: <span className="font-bold text-blue-600">{grn.status}</span>
                      </p>
                      {/* Progress bar */}
                      <div className="mt-2 w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-blue-500 h-full rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{progress}% placed</p>
                    </div>
                    <i className="fas fa-chevron-right text-slate-400 text-sm shrink-0"></i>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Quick Scan Button ────────────────────────────────────────────── */}
      <div className="mt-3">
        <button
          onClick={() => navigate('/hht/quick-scan')}
          className="w-full h-16 bg-blue-600 hover:bg-blue-700 text-white font-black text-lg uppercase tracking-widest rounded-2xl shadow-lg flex items-center justify-center gap-3 transition-all active:scale-95"
        >
          <i className="fas fa-barcode text-xl"></i>
          QUICK RACK SCAN
        </button>
      </div>

    </HHTLayout>
  );
};

export default PutawayDashboard;
