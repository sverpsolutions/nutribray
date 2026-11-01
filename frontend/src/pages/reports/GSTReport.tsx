import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const SLAB_COLORS: Record<string, string> = {
  '0%': 'bg-slate-100 text-slate-700',
  '5%': 'bg-green-100 text-green-700',
  '12%': 'bg-blue-100 text-blue-700',
  '18%': 'bg-orange-100 text-orange-700',
  '28%': 'bg-red-100 text-red-700',
};

const GSTReport = () => {
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
      const res = await api.get(`/reports/gst`, { params });
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
            <span className="bg-orange-600 text-white p-1 rounded"><i className="fas fa-receipt"></i></span>
            GST Report — GSTR-1
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Output Tax · Slab-wise Breakup · B2C / B2B</p>
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

      {/* Summary Totals */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Taxable Amount', value: s.taxable_amount, color: 'text-slate-800' },
          { label: 'CGST',           value: s.cgst,           color: 'text-blue-600' },
          { label: 'SGST',           value: s.sgst,           color: 'text-purple-600' },
          { label: 'IGST',           value: s.igst,           color: 'text-indigo-600' },
          { label: 'Total GST',      value: s.total_gst,      color: 'text-orange-600 font-black text-base' },
        ].map((c, i) => (
          <div key={i} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-center">
            <div className="text-[9px] font-bold uppercase text-slate-400 mb-1">{c.label}</div>
            <div className={`text-sm font-bold ${c.color}`}>{fmt(c.value || 0)}</div>
          </div>
        ))}
      </div>

      {/* Slab Table */}
      {loading ? (
        <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-2xl"></i></div>
      ) : (
        <div className="card shadow-sm border-0 overflow-hidden bg-white">
          <div className="bg-[#1a1a2e] text-white px-6 py-3">
            <span className="text-xs font-bold uppercase tracking-widest">GST Slab-wise Breakup</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-[10px] uppercase font-bold text-slate-500">GST Slab</th>
                <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Invoices</th>
                <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Taxable Amt</th>
                <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">CGST</th>
                <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">SGST</th>
                <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">IGST</th>
                <th className="px-6 py-3 text-right text-[10px] uppercase font-bold text-slate-500">Total GST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.slabs || []).map((r: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-6 py-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-black ${SLAB_COLORS[r.slab] || 'bg-slate-100 text-slate-700'}`}>
                      {r.slab}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right text-slate-600">{r.invoices}</td>
                  <td className="px-6 py-3 text-right font-mono">{fmt(r.taxable)}</td>
                  <td className="px-6 py-3 text-right font-mono text-blue-600">{fmt(r.cgst)}</td>
                  <td className="px-6 py-3 text-right font-mono text-purple-600">{fmt(r.sgst)}</td>
                  <td className="px-6 py-3 text-right font-mono text-indigo-600">{fmt(r.igst)}</td>
                  <td className="px-6 py-3 text-right font-black font-mono text-orange-700">{fmt(r.total_gst)}</td>
                </tr>
              ))}
              {!loading && !data?.slabs?.length && (
                <tr><td colSpan={7} className="px-6 py-10 text-center text-slate-400">No GST data found for selected period</td></tr>
              )}
              {data?.slabs?.length > 0 && (
                <tr className="bg-slate-900">
                  <td className="px-6 py-3 text-white font-black text-xs uppercase">TOTAL</td>
                  <td className="px-6 py-3 text-right text-white font-bold">
                    {data.slabs.reduce((a: number, r: any) => a + r.invoices, 0)}
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-white font-bold">{fmt(s.taxable_amount)}</td>
                  <td className="px-6 py-3 text-right font-mono text-blue-300 font-bold">{fmt(s.cgst)}</td>
                  <td className="px-6 py-3 text-right font-mono text-purple-300 font-bold">{fmt(s.sgst)}</td>
                  <td className="px-6 py-3 text-right font-mono text-indigo-300 font-bold">{fmt(s.igst)}</td>
                  <td className="px-6 py-3 text-right font-mono text-orange-300 font-black text-sm">{fmt(s.total_gst)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default GSTReport;
