import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import { useSyncStore } from '../../store/syncStore';


type SyncAction = {
  key: string;
  label: string;
  icon: string;
  color: string;
  endpoint: (id: number, startDate: string, endDate: string) => string;
  method?: 'POST' | 'GET';
  needsDate: boolean;
};

const SYNC_ACTIONS: SyncAction[] = [
  {
    key: 'sales',
    label: 'Sync Sales Records',
    icon: 'fa-receipt',
    color: 'indigo',
    endpoint: (id, start, end) => `/sync/run/${id}?sync_date=${start}&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'tax_breakup',
    label: 'Sync Tax Breakup (Fast)',
    icon: 'fa-percentage',
    color: 'teal',
    endpoint: (id, start, end) => `/sync/tax-breakup/${id}?sync_date=${start}&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'sales_returns',
    label: 'Sync Sales Returns',
    icon: 'fa-undo-alt',
    color: 'orange',
    endpoint: (id, start, end) => `/sync/sales-returns/${id}?sync_date=${start}&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'payments',
    label: 'Sync Bill Payments',
    icon: 'fa-money-bill-wave',
    color: 'green',
    endpoint: (id, start, end) => `/sync/payments/${id}?sync_date=${start}&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'bill_summary',
    label: 'Sync Bill Summary',
    icon: 'fa-file-invoice',
    color: 'teal',
    endpoint: (id, start, end) => `/sync/bill-summary/${id}?sync_date=${start}&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'purchase_summary',
    label: 'Sync Purchase Summary',
    icon: 'fa-truck',
    color: 'blue',
    endpoint: (id, start, end) => `/sync/purchase-summary/${id}?sync_date=${start}&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'purchase_items',
    label: 'Sync Purchase Items',
    icon: 'fa-boxes',
    color: 'cyan',
    endpoint: (id, start, end) => `/sync/purchase-items/${id}?sync_date=${start}&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'prn_summary',
    label: 'Sync PRN Summary',
    icon: 'fa-redo',
    color: 'yellow',
    endpoint: (id, start, end) => `/sync/prn-summary/${id}?sync_date=${start}&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'prn_items',
    label: 'Sync PRN Items',
    icon: 'fa-list-alt',
    color: 'amber',
    endpoint: (id, start, end) => `/sync/prn-items/${id}?sync_date=${start}&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'stock_out',
    label: 'Stock Transfer OUT',
    icon: 'fa-arrow-circle-right',
    color: 'red',
    endpoint: (id, start, end) => `/sync/stock-transfer/${id}?sync_date=${start}&type=out&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'stock_in',
    label: 'Stock Transfer IN',
    icon: 'fa-arrow-circle-left',
    color: 'purple',
    endpoint: (id, start, end) => `/sync/stock-transfer/${id}?sync_date=${start}&type=in&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
  {
    key: 'stock_qoh',
    label: 'Refresh Store Stock (QOH)',
    icon: 'fa-warehouse',
    color: 'slate',
    endpoint: (id, start, end) => `/sync/stock/${id}`,
    needsDate: false,
  },
  {
    key: 'complete',
    label: 'Complete Data Sync',
    icon: 'fa-sync-alt',
    color: 'pink',
    endpoint: (id, start, end) => `/sync/complete/${id}?sync_date=${start}&from_date=${start}&to_date=${end}`,
    needsDate: true,
  },
];

const COLOR_MAP: Record<string, { bg: string; text: string; hover: string; badge: string }> = {
  indigo : { bg: 'bg-indigo-50',  text: 'text-indigo-600',  hover: 'hover:bg-indigo-600',  badge: 'bg-indigo-100' },
  orange : { bg: 'bg-orange-50',  text: 'text-orange-600',  hover: 'hover:bg-orange-600',  badge: 'bg-orange-100' },
  green  : { bg: 'bg-green-50',   text: 'text-green-600',   hover: 'hover:bg-green-600',   badge: 'bg-green-100'  },
  teal   : { bg: 'bg-teal-50',    text: 'text-teal-600',    hover: 'hover:bg-teal-600',    badge: 'bg-teal-100'   },
  blue   : { bg: 'bg-blue-50',    text: 'text-blue-600',    hover: 'hover:bg-blue-600',    badge: 'bg-blue-100'   },
  cyan   : { bg: 'bg-cyan-50',    text: 'text-cyan-600',    hover: 'hover:bg-cyan-600',    badge: 'bg-cyan-100'   },
  yellow : { bg: 'bg-yellow-50',  text: 'text-yellow-600',  hover: 'hover:bg-yellow-600',  badge: 'bg-yellow-100' },
  amber  : { bg: 'bg-amber-50',   text: 'text-amber-600',   hover: 'hover:bg-amber-600',   badge: 'bg-amber-100'  },
  red    : { bg: 'bg-red-50',     text: 'text-red-600',     hover: 'hover:bg-red-600',     badge: 'bg-red-100'    },
  purple : { bg: 'bg-purple-50',  text: 'text-purple-600',  hover: 'hover:bg-purple-600',  badge: 'bg-purple-100' },
  slate  : { bg: 'bg-slate-50',   text: 'text-slate-600',   hover: 'hover:bg-slate-600',   badge: 'bg-slate-100'  },
  pink   : { bg: 'bg-pink-50',    text: 'text-pink-600',    hover: 'hover:bg-pink-600',    badge: 'bg-pink-100'   },
};

type StatusEntry = { success: boolean; message: string };

const GlobalSync = () => {
  const [outlets, setOutlets]         = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate]         = useState<string>(new Date().toISOString().split('T')[0]);
  const [runningKey, setRunningKey]   = useState<string | null>(null); // "outletId_actionKey"
  const [results, setResults]         = useState<Record<string, StatusEntry>>({});
  const [logs, setLogs]               = useState<Record<number, any[]>>({});
  const [openLogs, setOpenLogs]       = useState<number | null>(null);
  const [selectedOutlet, setSelectedOutlet] = useState<number | null>(null);
  
  const { setRunning, setGlobalStatus } = useSyncStore();

  useEffect(() => { fetchOutlets(); }, []);

  const fetchOutlets = async () => {
    try {
      const res = await api.get(`/outlets`);
      setOutlets(res.data);
    } catch (err) {
      console.error('Failed to fetch outlets', err);
    } finally {
      setLoading(false);
    }
  };

  const runSync = async (outlet: any, action: SyncAction) => {
    const key = `${outlet.id}_${action.key}`;
    setRunningKey(key);
    setRunning(outlet.id, true);
    setResults(prev => ({ ...prev, [key]: { success: false, message: 'Running...' } }));
    try {
      const url = `${action.endpoint(outlet.id, selectedDate, endDate)}`;
      const res = await api.post(url);
      const msg = res.data?.message || 'Done';
      setResults(prev => ({ ...prev, [key]: { success: true, message: msg } }));
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Sync failed';
      setResults(prev => ({ ...prev, [key]: { success: false, message: msg } }));
    } finally {
      setRunningKey(null);
      setRunning(outlet.id, false);
    }
  };

  const runAllForOutlet = async (outlet: any) => {
    for (const action of SYNC_ACTIONS) {
      await runSync(outlet, action);
    }
  };

  const fetchLogs = async (id: number) => {
    try {
      const res = await api.get(`/sync/logs/${id}?limit=15`);
      setLogs(prev => ({ ...prev, [id]: res.data }));
      setOpenLogs(id);
    } catch {
      setOpenLogs(null);
    }
  };

  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [debugOutlet, setDebugOutlet] = useState<string>('');

  const runDebug = async (outlet: any) => {
    try {
      const res = await api.get(`/sync/debug-payments/${outlet.id}?sync_date=${selectedDate}`);
      setDebugInfo(res.data);
      setDebugOutlet(outlet.outlet_name);
    } catch (err: any) {
      setDebugInfo({ error: err.response?.data?.detail || 'Debug failed' });
      setDebugOutlet(outlet.outlet_name);
    }
  };

  const runGlobalSync = async (action: SyncAction) => {
    const connected = outlets.filter(o => o.is_connected);
    if (connected.length === 0) {
      alert("No online outlets to sync.");
      return;
    }
    
    // Set a special running key for global progress
    const globalKey = `global_${action.key}`;
    setRunningKey(globalKey);
    setGlobalStatus(`Processing ${action.label}...`);
    setResults(prev => ({ ...prev, [globalKey]: { success: false, message: `Running for ${connected.length} outlets...` } }));
    
    let successCount = 0;
    for (const outlet of connected) {
      const key = `${outlet.id}_${action.key}`;
      setRunning(outlet.id, true);
      
      // Update global message to display the unit name currently in progress
      setResults(prev => ({ 
        ...prev, 
        [globalKey]: { 
          success: false, 
          message: `In Progress: Syncing ${outlet.unit_code}... (${successCount}/${connected.length} done)` 
        } 
      }));

      setResults(prev => ({ ...prev, [key]: { success: false, message: 'Queueing...' } }));
      
      try {
        const url = `${action.endpoint(outlet.id, selectedDate, endDate)}`;
        const res = await api.post(url);
        if (res.data) successCount++;
        setResults(prev => ({ ...prev, [key]: { success: true, message: res.data?.message || 'Done' } }));
      } catch (err: any) {
        const msg = err.response?.data?.detail || 'Sync failed';
        setResults(prev => ({ ...prev, [key]: { success: false, message: msg } }));
      } finally {
        setRunning(outlet.id, false);
      }
    }
    
    const allSucceeded = successCount === connected.length;
    const noneSucceeded = successCount === 0;
    
    let finalMessage = '';
    if (allSucceeded) {
      finalMessage = `Completed for ${successCount}/${connected.length} outlets`;
    } else if (noneSucceeded) {
      finalMessage = `Failed for all ${connected.length} outlets`;
    } else {
      finalMessage = `Partial: ${successCount}/${connected.length} outlets succeeded`;
    }

    setResults(prev => ({ 
      ...prev, 
      [globalKey]: { success: allSucceeded, message: finalMessage } 
    }));
    setRunningKey(null);
    setGlobalStatus(null);
  };

  const connectedOutlets = outlets.filter(o => o.is_connected);
  const offlineOutlets   = outlets.filter(o => !o.is_connected);

  const [showGlobal, setShowGlobal] = useState(false);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center text-slate-800">
            <span className="bg-indigo-600 text-white p-2 rounded-lg mr-3 shadow-lg shadow-indigo-200">
              <i className="fas fa-sync-alt"></i>
            </span>
            Global Store Synchronization
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Pull sales, purchases, stock data from remote outlets into Head Office
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setShowGlobal(!showGlobal); setSelectedOutlet(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all shadow-lg ${
              showGlobal 
                ? 'bg-rose-500 text-white shadow-rose-200' 
                : 'bg-white text-rose-500 border border-rose-200 hover:bg-rose-50'
            }`}
          >
            <i className={`fas ${showGlobal ? 'fa-times' : 'fa-globe-americas'}`}></i>
            {showGlobal ? 'Close Global' : 'Global Operations'}
          </button>
          <div className="flex items-center bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm gap-2">
            <i className="far fa-calendar-alt text-indigo-500 text-sm"></i>
            <div className="flex flex-col">
              <span className="text-[9px] text-slate-400 font-bold uppercase leading-tight">From</span>
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="text-xs font-bold text-slate-700 outline-none border-none bg-transparent p-0 leading-tight"
              />
            </div>
            <span className="text-slate-300 mx-1">|</span>
            <div className="flex flex-col">
              <span className="text-[9px] text-slate-400 font-bold uppercase leading-tight">To</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="text-xs font-bold text-slate-700 outline-none border-none bg-transparent p-0 leading-tight"
              />
            </div>
          </div>
          <span className="text-xs font-medium text-slate-500 bg-white px-3 py-2 rounded-xl border border-slate-200">
            <i className="fas fa-store mr-1 text-green-500"></i>
            {connectedOutlets.length} Online &nbsp;
            <i className="fas fa-store ml-2 mr-1 text-red-400"></i>
            {offlineOutlets.length} Offline
          </span>
        </div>
      </div>

      {/* ── Global Sync Panel ── */}
      {showGlobal && (
        <div className="bg-slate-900 rounded-[2rem] p-8 text-white relative overflow-hidden shadow-2xl animate-in slide-in-from-top-4 duration-500">
           {/* Abstract Background Shapes */}
           <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl"></div>
           <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl"></div>

           <div className="relative z-10">
              <div className="flex justify-between items-start mb-8">
                 <div>
                    <h2 className="text-2xl font-black flex items-center gap-3">
                       <i className="fas fa-globe-americas text-rose-500"></i>
                       GLOBAL OPERATIONS CENTER
                    </h2>
                    <p className="text-slate-400 text-sm font-medium mt-1">
                       Trigger sync actions across all <span className="text-green-400 font-bold">{connectedOutlets.length} online stores</span> simultaneously
                    </p>
                 </div>
                 <div className="bg-white/10 px-4 py-2 rounded-2xl border border-white/10 backdrop-blur-md">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Processing Range</p>
                    <p className="text-sm font-mono font-bold text-indigo-300">{selectedDate} - {endDate}</p>
                 </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                 {SYNC_ACTIONS.map(action => {
                    const globalKey = `global_${action.key}`;
                    const result = results[globalKey];
                    const isRunning = runningKey === globalKey;
                    const c = COLOR_MAP[action.color];

                    return (
                       <div key={action.key} className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/10 transition-all group">
                          <div className="flex items-center gap-3 mb-4">
                             <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.bg.replace('bg-', 'bg-opacity-20 bg-')}`}>
                                <i className={`fas ${action.icon} ${c.text} text-lg`}></i>
                             </div>
                             <p className="text-sm font-bold text-white group-hover:text-rose-400 transition-colors leading-tight">{action.label}</p>
                          </div>

                          {result && (
                             <div className={`mb-4 p-3 rounded-xl text-[10px] font-bold flex items-center gap-2 ${
                                result.success ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'
                             }`}>
                                <i className={`fas ${isRunning ? 'fa-spinner fa-spin' : result.success ? 'fa-check-double' : 'fa-info-circle'}`}></i>
                                {result.message}
                             </div>
                          )}

                          <button
                             disabled={runningKey !== null || connectedOutlets.length === 0}
                             onClick={() => runGlobalSync(action)}
                             className="w-full bg-white text-slate-900 font-black py-2.5 rounded-xl text-[10px] uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                          >
                             {isRunning ? (
                                <><i className="fas fa-spinner fa-spin"></i> Processing...</>
                             ) : (
                                <><i className="fas fa-play-circle"></i> Run Globally</>
                             )}
                          </button>
                       </div>
                    );
                 })}
              </div>
           </div>
        </div>
      )}

      {/* ── Outlet Selector ── */}
      {loading ? (
        <div className="text-center py-20 text-slate-400">Loading outlets...</div>
      ) : outlets.length === 0 ? (
        <div className="text-center py-20 text-slate-400 bg-white rounded-xl border-2 border-dashed border-slate-200">
          No outlets registered. Add outlets in <b>Outlet Master</b> first.
        </div>
      ) : (
        <>
          {/* Outlet cards row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {outlets.map(o => {
              // Check if any sync is running for this outlet
              const isAnyRunning = SYNC_ACTIONS.some(a => runningKey === `${o.id}_${a.key}`);
              // Check if any global sync is running (we don't show that per outlet unless we want to)
              
              return (
                <button
                  key={o.id}
                  onClick={() => { setSelectedOutlet(selectedOutlet === o.id ? null : o.id); setShowGlobal(false); }}
                  className={`relative rounded-xl border-2 p-4 text-left transition-all overflow-hidden ${
                    selectedOutlet === o.id
                      ? 'border-indigo-500 bg-indigo-50 shadow-md'
                      : 'border-slate-100 bg-white hover:border-indigo-200 hover:shadow-sm'
                  }`}
                >
                  {/* Progress Bar Background */}
                  {isAnyRunning && (
                    <div className="absolute bottom-0 left-0 h-1 bg-indigo-100 w-full">
                       <div className="h-full bg-indigo-600 animate-progress-indeterminate"></div>
                    </div>
                  )}

                  <div className="flex justify-between items-start relative z-10">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-800 text-sm truncate">{o.outlet_name}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">{o.unit_code}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        o.is_connected
                          ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]'
                          : 'bg-red-400'
                      }`}></span>
                      {isAnyRunning && (
                        <div className="flex items-center gap-1 text-indigo-600">
                           <span className="text-[9px] font-black uppercase animate-pulse">Syncing</span>
                           <i className="fas fa-sync-alt fa-spin text-[10px]"></i>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2 relative z-10">
                    {o.grp_code && (
                      <span className="text-[8px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded uppercase">
                        {o.grp_code}
                      </span>
                    )}
                    {o.city && (
                      <span className="text-[8px] bg-indigo-50 text-indigo-500 font-bold px-1.5 py-0.5 rounded uppercase">
                        {o.city}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Sync panel for selected outlet */}
          {selectedOutlet !== null && (() => {
            const outlet = outlets.find(o => o.id === selectedOutlet);
            if (!outlet) return null;

            return (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                {/* Outlet header */}
                <div className="flex justify-between items-center px-6 py-4 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white">
                  <div>
                    <h2 className="font-bold text-lg">{outlet.outlet_name}</h2>
                    <p className="text-indigo-200 text-xs font-medium">
                      {outlet.server_name} &nbsp;|&nbsp; {outlet.database_name}
                      &nbsp;|&nbsp; Sync Range: <b>{selectedDate}</b> to <b>{endDate}</b>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => runDebug(outlet)}
                      className="bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all"
                      title="Debug payment tables for selected date"
                    >
                      <i className="fas fa-bug mr-1"></i> Debug
                    </button>
                    <button
                      onClick={() => fetchLogs(outlet.id)}
                      className="bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all"
                    >
                      <i className="fas fa-history mr-1"></i> Logs
                    </button>
                    {outlet.is_connected && (
                      <button
                        disabled={runningKey !== null}
                        onClick={() => runAllForOutlet(outlet)}
                        className="bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all disabled:opacity-50"
                      >
                        <i className="fas fa-bolt mr-1"></i> Complete Sync
                      </button>
                    )}
                  </div>
                </div>

                {!outlet.is_connected && (
                  <div className="mx-6 mt-4 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs font-bold text-red-500 flex items-center">
                    <i className="fas fa-exclamation-triangle mr-2"></i>
                    This outlet is offline. Test connection in Outlet Master before syncing.
                  </div>
                )}

                {/* Action grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-6">
                  {SYNC_ACTIONS.map(action => {
                    const key    = `${outlet.id}_${action.key}`;
                    const result = results[key];
                    const isRunning = runningKey === key;
                    const c      = COLOR_MAP[action.color] ?? COLOR_MAP.slate;

                    return (
                      <div
                        key={action.key}
                        className={`rounded-xl border border-slate-100 p-4 flex flex-col gap-3 transition-all ${c.bg}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.badge}`}>
                            <i className={`fas ${action.icon} ${c.text} text-sm`}></i>
                          </span>
                          <p className={`text-[11px] font-bold ${c.text} leading-tight`}>{action.label}</p>
                        </div>

                        {result && (
                          <p className={`text-[10px] font-medium leading-tight rounded px-2 py-1 ${
                            result.message === 'Running...'
                              ? 'bg-yellow-50 text-yellow-600'
                              : result.success
                                ? 'bg-green-50 text-green-600'
                                : 'bg-red-50 text-red-500'
                          }`}>
                            <i className={`fas ${
                              result.message === 'Running...' ? 'fa-spinner fa-spin' :
                              result.success ? 'fa-check' : 'fa-times'
                            } mr-1`}></i>
                            {result.message.length > 60 ? result.message.slice(0, 60) + '…' : result.message}
                          </p>
                        )}

                        <button
                          disabled={!outlet.is_connected || runningKey !== null}
                          onClick={() => runSync(outlet, action)}
                          className={`mt-auto text-[11px] font-bold py-2 px-3 rounded-lg text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                            action.color === 'pink' ? 'bg-pink-500 hover:bg-pink-600' :
                            action.color === 'indigo' ? 'bg-indigo-500 hover:bg-indigo-600' :
                            action.color === 'green' ? 'bg-green-500 hover:bg-green-600' :
                            action.color === 'orange' ? 'bg-orange-500 hover:bg-orange-600' :
                            action.color === 'teal' ? 'bg-teal-500 hover:bg-teal-600' :
                            action.color === 'blue' ? 'bg-blue-500 hover:bg-blue-600' :
                            action.color === 'cyan' ? 'bg-cyan-500 hover:bg-cyan-600' :
                            action.color === 'yellow' ? 'bg-yellow-500 hover:bg-yellow-600' :
                            action.color === 'amber' ? 'bg-amber-500 hover:bg-amber-600' :
                            action.color === 'red' ? 'bg-red-500 hover:bg-red-600' :
                            action.color === 'purple' ? 'bg-purple-500 hover:bg-purple-600' :
                            'bg-slate-500 hover:bg-slate-600'
                          }`}
                        >
                          {isRunning
                            ? <><i className="fas fa-spinner fa-spin mr-1"></i> Running…</>
                            : <><i className={`fas ${action.icon} mr-1`}></i> Run</>
                          }
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Debug Modal */}
          {debugInfo && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800">
                    <i className="fas fa-bug mr-2 text-orange-500"></i>
                    Payment Debug — {debugOutlet} ({selectedDate})
                  </h3>
                  <button onClick={() => setDebugInfo(null)} className="text-slate-400 hover:text-slate-600">
                    <i className="fas fa-times text-xl"></i>
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 p-5 space-y-2">
                  {Object.entries(debugInfo).map(([key, val]) => (
                    <div key={key} className="flex items-start gap-3 bg-slate-50 rounded-lg px-4 py-2.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase w-52 shrink-0 mt-0.5">{key.replace(/_/g,' ')}</span>
                      <span className={`text-xs font-bold break-all ${
                        String(val).includes('error') || String(val).startsWith('ERROR') || key.includes('error')
                          ? 'text-red-500' : 'text-slate-700'
                      }`}>
                        {String(val)}
                      </span>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-400 pt-2">
                    If <b>payment_join_count = 0</b> but <b>sales_hdr_posted &gt; 0</b>, the SALES_PAYMENT_DTL table has no matching rows for this date.<br/>
                    If <b>sales_payment_dtl_error</b> appears, the table doesn't exist on this outlet.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Sync Logs Modal */}
          {openLogs !== null && logs[openLogs] && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800 text-lg">
                    <i className="fas fa-history mr-2 text-indigo-500"></i>
                    Sync Logs — {outlets.find(o => o.id === openLogs)?.outlet_name}
                  </h3>
                  <button onClick={() => setOpenLogs(null)} className="text-slate-400 hover:text-slate-600">
                    <i className="fas fa-times text-xl"></i>
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 p-4 space-y-2">
                  {logs[openLogs].length === 0 ? (
                    <p className="text-center text-slate-400 py-10 text-sm">No sync logs yet.</p>
                  ) : (
                    logs[openLogs].map((log: any) => (
                      <div
                        key={log.id}
                        className={`flex items-start gap-3 rounded-xl px-4 py-3 ${
                          log.status === 'success' ? 'bg-green-50' : 'bg-red-50'
                        }`}
                      >
                        <i className={`fas mt-0.5 ${
                          log.status === 'success'
                            ? 'fa-check-circle text-green-500'
                            : 'fa-exclamation-circle text-red-500'
                        }`}></i>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold bg-white border border-slate-100 px-2 py-0.5 rounded-full text-slate-600 uppercase">
                              {log.sync_type}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {log.records_synced} records
                            </span>
                            <span className="text-[10px] text-slate-400 ml-auto">
                              {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1 truncate">{log.message}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default GlobalSync;
