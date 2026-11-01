import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const MODE_COLORS: Record<string, string> = {
  CASH: 'bg-green-500', CARD: 'bg-blue-500', UPI: 'bg-purple-500',
  PAYTM: 'bg-indigo-500', PHONEPAY: 'bg-indigo-400', MOBIKWIK: 'bg-pink-500',
  GPAY: 'bg-yellow-500', CHEQUE: 'bg-slate-500', CREDIT: 'bg-orange-500', NEFT: 'bg-teal-500',
};
const modeColor = (m: string) => MODE_COLORS[m?.toUpperCase()] || 'bg-slate-400';

const PaymentCollectionReport = () => {
  const [fromDate, setFromDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const params: any = { from_date: fromDate, to_date: toDate };
      if (outletId) params.outlet_id = outletId;
      const res = await api.get(`/reports/payments`, { params });
      setData(res.data);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);
  const s = data?.summary || {};

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-cyan-600 text-white p-1 rounded"><i className="fas fa-credit-card"></i></span>
            Payment Collection Report
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Cash · UPI · Card · Wallets · Mode-wise Breakup</p>
        </div>
        <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}><i className="fas fa-print mr-2"></i>Print</button>
      </div>

      <div className="card shadow-sm border-0 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">From Date</label>
            <input type="date" className="form-control h-9 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">To Date</label>
            <input type="date" className="form-control h-9 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Outlet</label>
            <select className="form-control h-9 text-xs w-44" value={outletId} onChange={e => setOutletId(e.target.value)}>
              <option value="">All Outlets</option>
              {data?.outlets?.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <button className="btn btn-dark btn-sm h-9 px-6 text-[10px] font-bold uppercase" onClick={fetch} disabled={loading}>Apply</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 text-center">
          <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Total Collected</div>
          <div className="text-2xl font-black text-green-700">{fmt(s.total_collected || 0)}</div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 text-center">
          <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Payment Modes</div>
          <div className="text-2xl font-black text-cyan-700">{s.payment_modes || 0}</div>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-2xl"></i></div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Mode-wise breakdown */}
            <div className="card shadow-sm border-0 bg-white overflow-hidden">
              <div className="bg-[#1a1a2e] text-white px-6 py-3">
                <span className="text-xs font-bold uppercase tracking-widest">By Payment Mode</span>
              </div>
              <div className="p-4 space-y-3">
                {(data?.by_mode || []).map((r: any, i: number) => (
                  <div key={i}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="flex items-center gap-2 text-xs font-bold">
                        <span className={`w-3 h-3 rounded-full ${modeColor(r.paymode)}`}></span>
                        {r.paymode}
                      </span>
                      <span className="text-xs font-black text-slate-700">{fmt(r.amount)} <span className="text-slate-400 font-normal">({r.pct}%)</span></span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className={`h-2 rounded-full ${modeColor(r.paymode)} transition-all duration-500`} style={{ width: `${r.pct}%` }}></div>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{r.transactions} transactions</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Outlet-wise breakdown */}
            <div className="card shadow-sm border-0 bg-white overflow-hidden">
              <div className="bg-[#1a1a2e] text-white px-6 py-3">
                <span className="text-xs font-bold uppercase tracking-widest">By Outlet</span>
              </div>
              <div className="p-4 space-y-3">
                {(data?.by_outlet || []).map((r: any, i: number) => (
                  <div key={i}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-bold text-slate-700">{r.outlet}</span>
                      <span className="text-xs font-black text-indigo-700">{fmt(r.amount)} <span className="text-slate-400 font-normal">({r.pct}%)</span></span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="h-2 rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${r.pct}%` }}></div>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{r.transactions} transactions</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Daily trend */}
          <div className="card shadow-sm border-0 bg-white overflow-hidden">
            <div className="bg-[#1a1a2e] text-white px-6 py-3 flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-widest">Store-wise Daily Collection Trend</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Ordered by Date (Latest First)</span>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-4 text-left text-[10px] uppercase font-bold text-slate-500 tracking-widest">Date</th>
                    <th className="px-6 py-4 text-left text-[10px] uppercase font-bold text-slate-500 tracking-widest">Outlet Name</th>
                    <th className="px-6 py-4 text-center text-[10px] uppercase font-bold text-slate-500 tracking-widest">Bills</th>
                    <th className="px-6 py-4 text-right text-[10px] uppercase font-bold text-slate-500 tracking-widest">Collection</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data?.daily || []).map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-3.5 font-bold text-slate-600">{r.date}</td>
                      <td className="px-6 py-3.5 font-bold text-indigo-600 uppercase tracking-tight">{r.outlet}</td>
                      <td className="px-6 py-3.5 text-center font-mono font-bold text-slate-500">{r.bills}</td>
                      <td className="px-6 py-3.5 text-right font-black font-mono text-green-700">{fmt(r.total)}</td>
                    </tr>
                  ))}
                  {!data?.daily?.length && (
                    <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-400 font-bold uppercase tracking-widest">No daily data available for selected period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentCollectionReport;
