import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
const fmtFull = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const HierarchyReport = () => {
  const [fromDate, setFromDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/hierarchy`, { params: { from_date: fromDate, to_date: toDate } });
      setData(res.data);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const outlets = data?.by_outlet || [];
  const totalSales = outlets.reduce((s: number, o: any) => s + (o.sales || 0), 0);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-blue-700 text-white p-1 rounded"><i className="fas fa-chart-bar"></i></span>
            Hierarchy Sales Analysis
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Outlet-wise · Date Drill-Down · Comparative BI</p>
        </div>
        <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}><i className="fas fa-print mr-2"></i>Print</button>
      </div>

      <div className="card shadow-sm border-0 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">From Date</label>
            <input type="date" className="form-control h-9 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">To Date</label>
            <input type="date" className="form-control h-9 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          <button className="btn btn-dark btn-sm h-9 px-6 text-[10px] font-bold uppercase" onClick={fetch} disabled={loading}>Apply</button>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-2xl"></i></div>
      ) : (
        <>
          {/* Outlet performance cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {outlets.map((o: any, i: number) => {
              const pct = totalSales ? Math.round((o.sales / totalSales) * 100) : 0;
              const colors = ['from-blue-600 to-blue-800','from-indigo-600 to-purple-800','from-teal-600 to-cyan-800','from-green-600 to-emerald-800'];
              return (
                <div key={i} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className={`bg-gradient-to-r ${colors[i % colors.length]} text-white p-4`}>
                    <div className="text-xs font-bold opacity-80 uppercase tracking-widest mb-1">{o.outlet}</div>
                    <div className="text-2xl font-black">{fmt(o.sales)}</div>
                    <div className="text-xs opacity-70 mt-1">{o.bills} bills · {pct}% of total</div>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[9px] font-bold uppercase text-slate-400">Outstanding</div>
                      <div className="text-sm font-bold text-red-600">{fmtFull(o.outstanding)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-bold uppercase text-slate-400">GST Collected</div>
                      <div className="text-sm font-bold text-blue-600">{fmtFull(o.gst)}</div>
                    </div>
                  </div>
                  <div className="px-4 pb-4">
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full bg-gradient-to-r ${colors[i % colors.length]}`} style={{ width: `${pct}%` }}></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Comparison Table */}
          <div className="card shadow-sm border-0 overflow-hidden bg-white">
            <div className="bg-[#1a1a2e] text-white px-6 py-3 flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-widest">Outlet Comparison</span>
              <span className="text-xs opacity-60">Total: {fmtFull(totalSales)}</span>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Outlet</th>
                  <th className="px-6 py-3 text-center text-[10px] uppercase font-bold text-slate-500">Bills</th>
                  <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Sales</th>
                  <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Outstanding</th>
                  <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">GST</th>
                  <th className="px-6 py-3 text-center text-[10px] uppercase font-bold text-slate-500">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {outlets.map((o: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-bold">{o.outlet}</td>
                    <td className="px-6 py-3 text-center">{o.bills}</td>
                    <td className="px-6 py-3 text-right font-bold font-mono text-green-700">{fmtFull(o.sales)}</td>
                    <td className="px-6 py-3 text-right font-mono text-red-600">{fmtFull(o.outstanding)}</td>
                    <td className="px-6 py-3 text-right font-mono text-blue-600">{fmtFull(o.gst)}</td>
                    <td className="px-6 py-3 text-center">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                        {totalSales ? Math.round((o.sales / totalSales) * 100) : 0}%
                      </span>
                    </td>
                  </tr>
                ))}
                {outlets.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400">No data for selected period</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Daily drill-down */}
          {data?.daily?.length > 0 && (
            <div className="card shadow-sm border-0 overflow-hidden bg-white">
              <div className="bg-slate-700 text-white px-6 py-3">
                <span className="text-xs font-bold uppercase tracking-widest">Daily × Outlet Drill-Down</span>
              </div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Date</th>
                      <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Outlet</th>
                      <th className="px-4 py-3 text-center text-[10px] uppercase font-bold text-slate-500">Bills</th>
                      <th className="px-4 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.daily.map((r: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium">{r.date}</td>
                        <td className="px-4 py-2.5 text-slate-600">{r.outlet}</td>
                        <td className="px-4 py-2.5 text-center">{r.bills}</td>
                        <td className="px-4 py-2.5 text-right font-bold font-mono text-green-700">{fmtFull(r.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HierarchyReport;
