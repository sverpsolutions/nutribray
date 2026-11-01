import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const OutstandingReport = () => {
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (outletId) params.outlet_id = outletId;
      const res = await api.get(`/reports/outstanding`, { params });
      setData(res.data);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);
  const s = data?.summary || {};
  const collectionRate = s.total_billed ? Math.round((s.total_paid / s.total_billed) * 100) : 0;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-red-600 text-white p-1 rounded"><i className="fas fa-exclamation-triangle"></i></span>
            Outstanding Dues
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Pending Receivables — All Outlets</p>
        </div>
        <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}><i className="fas fa-print mr-2"></i>Print</button>
      </div>

      <div className="card shadow-sm border-0 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Outlet</label>
            <select className="form-control h-9 text-xs w-44" value={outletId} onChange={e => setOutletId(e.target.value)}>
              <option value="">All Outlets</option>
              {data?.outlets?.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <button className="btn btn-dark btn-sm h-9 px-6 text-[10px] font-bold uppercase" onClick={fetch} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-1"></i> : null}Apply
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Invoices',  value: s.total_invoices, fmt: false, color: 'text-slate-800', bg: 'bg-white' },
          { label: 'Total Billed',    value: s.total_billed,   fmt: true,  color: 'text-slate-800', bg: 'bg-white' },
          { label: 'Total Collected', value: s.total_paid,     fmt: true,  color: 'text-green-700', bg: 'bg-green-50' },
          { label: 'Total Pending',   value: s.total_due,      fmt: true,  color: 'text-red-700 text-2xl font-black', bg: 'bg-red-50' },
        ].map((c, i) => (
          <div key={i} className={`${c.bg} p-5 rounded-xl shadow-sm border border-slate-100 text-center`}>
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-2">{c.label}</div>
            <div className={`text-xl font-black ${c.color}`}>{c.fmt ? fmt(c.value || 0) : (c.value || 0)}</div>
          </div>
        ))}
      </div>

      {/* Collection rate bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-bold uppercase text-slate-500">Collection Rate</span>
          <span className="text-lg font-black text-green-700">{collectionRate}%</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-3">
          <div
            className="h-3 rounded-full bg-gradient-to-r from-green-500 to-emerald-600 transition-all duration-700"
            style={{ width: `${collectionRate}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
          <span>0%</span><span>50%</span><span>100%</span>
        </div>
      </div>

      {/* Table */}
      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="bg-red-700 text-white px-6 py-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">Pending Invoices</span>
          <span className="text-xs opacity-70">{s.total_invoices || 0} records</span>
        </div>
        <div className="overflow-x-auto">
          {loading ? <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-2xl"></i></div> : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Outlet</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Invoice #</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase font-bold text-slate-500">Date</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Billed</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Paid</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Due</th>
                  <th className="px-4 py-3 text-center text-[10px] uppercase font-bold text-slate-500">Days</th>
                  <th className="px-4 py-3 text-center text-[10px] uppercase font-bold text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.rows || []).map((r: any, i: number) => {
                  const days = parseInt(r.days_overdue) || 0;
                  const urgency = days > 90 ? 'text-red-700 bg-red-50' : days > 30 ? 'text-amber-700 bg-amber-50' : 'text-slate-600';
                  return (
                    <tr key={i} className={`hover:bg-slate-50 ${days > 90 ? 'border-l-4 border-red-500' : ''}`}>
                      <td className="px-4 py-2.5 text-slate-500 text-[10px]">{r.outlet_name}</td>
                      <td className="px-4 py-2.5 font-bold text-blue-600">{r.invoice_no}</td>
                      <td className="px-4 py-2.5 text-slate-500">{r.invoice_date}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{fmt(+r.total_amount)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-green-600">{fmt(+r.paid_amount)}</td>
                      <td className="px-4 py-2.5 text-right font-black font-mono text-red-700">{fmt(+r.due_amount)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${urgency}`}>{days}d</span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-100 text-amber-700">{r.status}</span>
                      </td>
                    </tr>
                  );
                })}
                {!loading && !data?.rows?.length && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-green-600 font-bold">
                    <i className="fas fa-check-circle mr-2"></i>No outstanding dues — all invoices collected!
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default OutstandingReport;
