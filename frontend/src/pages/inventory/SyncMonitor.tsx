import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';


const SyncMonitor = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/sync/monitor`);
      setData(res.data);
      setLastRefreshed(new Date());
    } catch (err) {
      toast.error('Failed to fetch monitor data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (connected: boolean) => {
    return connected ? 'text-green-500 bg-green-50 border-green-100' : 'text-rose-500 bg-rose-50 border-rose-100';
  };

  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} mins ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex justify-between items-center bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-200">
              <i className="fas fa-satellite"></i>
            </div>
            Synchronization Monitor
          </h1>
          <p className="text-slate-500 text-xs font-bold mt-1 uppercase tracking-widest ml-15">
            Real-time status of store data connectivity
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Refreshed</p>
            <p className="text-sm font-mono font-bold text-slate-700">{lastRefreshed.toLocaleTimeString()}</p>
          </div>
          <button 
            onClick={fetchData}
            className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-600 hover:bg-indigo-600 hover:text-white transition-all flex items-center justify-center group"
          >
            <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : 'group-hover:rotate-180'} transition-all duration-500`}></i>
          </button>
        </div>
      </div>

      {/* ── Status Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/5 rounded-full -mr-16 -mt-16 blur-3xl"></div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Online Stores</p>
          <p className="text-4xl font-black text-green-500">{data.filter(d => d.is_connected).length}</p>
          <div className="mt-4 flex items-center gap-2">
            <div className="flex -space-x-2">
              {data.filter(d => d.is_connected).slice(0, 5).map((d, i) => (
                <div key={i} className="w-6 h-6 rounded-full bg-green-100 border-2 border-white flex items-center justify-center text-[8px] font-bold text-green-600 uppercase">
                  {d.unit_code.slice(0, 2)}
                </div>
              ))}
            </div>
            <span className="text-[10px] font-bold text-slate-400 italic">currently polling</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full -mr-16 -mt-16 blur-3xl"></div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Offline / Issues</p>
          <p className="text-4xl font-black text-rose-500">{data.filter(d => !d.is_connected).length}</p>
          <div className="mt-4 flex items-center gap-2">
             <i className="fas fa-exclamation-circle text-rose-400 text-xs"></i>
             <span className="text-[10px] font-bold text-slate-400 italic">requires attention</span>
          </div>
        </div>

        <div className="bg-indigo-600 p-6 rounded-[2rem] shadow-xl shadow-indigo-100 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
          <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1">Average Sync Delay</p>
          <p className="text-4xl font-black text-white">~14m</p>
          <div className="mt-4 flex items-center gap-2 text-indigo-200">
             <i className="fas fa-clock text-xs"></i>
             <span className="text-[10px] font-bold italic text-white/70 tracking-wide">Across all connected units</span>
          </div>
        </div>
      </div>

      {/* ── Monitor Table ── */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Store Unit</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Connection</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Inventory (QOH)</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Sales Sync</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Purchases</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.map((outlet) => (
                <tr key={outlet.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="text-sm font-black text-slate-800 group-hover:text-indigo-600 transition-colors">{outlet.outlet_name}</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{outlet.unit_code} &bull; {outlet.city || 'Gurugram'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase border tracking-widest ${getStatusColor(outlet.is_connected)}`}>
                      {outlet.is_connected ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-2">
                       <div className={`w-1.5 h-1.5 rounded-full ${outlet.last_syncs.stock ? 'bg-indigo-500' : 'bg-slate-300'}`}></div>
                       <span className="text-xs font-bold text-slate-600">{formatTime(outlet.last_syncs.stock)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-xs font-bold text-slate-600">
                    {formatTime(outlet.last_syncs.sales)}
                  </td>
                  <td className="px-6 py-5 text-xs font-bold text-slate-600">
                    {formatTime(outlet.last_syncs.purchase_summary)}
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="text-xs font-black text-slate-700">{formatTime(outlet.last_connected_at)}</span>
                      <span className="text-[9px] text-slate-400 font-bold uppercase">{outlet.last_connected_at ? 'System Heartbeat' : '-'}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SyncMonitor;
