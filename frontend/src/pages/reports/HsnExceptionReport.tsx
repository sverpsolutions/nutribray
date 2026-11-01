import React, { useState, useEffect } from 'react';
import api from '../../api/axios';


const HsnExceptionReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const params = { from_date: fromDate, to_date: toDate };
      const res = await api.get(`/reports/hsn-exceptions`, { params });
      setData(res.data);
    } catch { /* empty */ } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center no-print">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-indigo-600 text-white p-1 rounded"><i className="fas fa-history"></i></span>
            HSN Exception & Override Logs
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Audit trail of all manual HSN overrides and mismatches</p>
        </div>
        <div className="flex space-x-2">
          <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}><i className="fas fa-print mr-2"></i>Print</button>
        </div>
      </div>

      <div className="card shadow-sm border-0 bg-white p-4 no-print">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">From Date</label>
            <input type="date" className="form-control h-9 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">To Date</label>
            <input type="date" className="form-control h-9 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <button className="btn btn-dark btn-sm h-9 px-6 font-bold uppercase tracking-widest text-[10px]" onClick={fetch} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-2"></i> : <i className="fas fa-search mr-2"></i>}Filter
          </button>
        </div>
      </div>

      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-body p-0 overflow-x-auto">
          {loading ? (
            <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-2xl"></i></div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#1a1a2e] text-white uppercase tracking-tighter">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Item Info</th>
                  <th className="px-4 py-3">Suggested</th>
                  <th className="px-4 py-3">Entered</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.rows || []).map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800">{r.item_name}</span>
                        <span className="text-[9px] font-mono text-blue-600">{r.item_code}</span>
                        <span className="text-[9px] text-slate-400 uppercase font-black">{r.subcategory_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className="px-2 py-1 bg-green-50 text-green-700 rounded font-mono font-bold">{r.suggested_hsn}</span></td>
                    <td className="px-4 py-3"><span className="px-2 py-1 bg-rose-50 text-rose-700 rounded font-mono font-bold">{r.entered_hsn}</span></td>
                    <td className="px-4 py-3 font-bold text-slate-600">{r.user_name}</td>
                    <td className="px-4 py-3 text-slate-500 italic">{r.reason || 'Manual override'}</td>
                  </tr>
                ))}
                {!loading && !data?.rows?.length && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No exception logs found for selected period</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default HsnExceptionReport;
