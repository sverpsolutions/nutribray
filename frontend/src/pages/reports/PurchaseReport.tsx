import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PurchaseReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(today);
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const params: any = { from_date: fromDate, to_date: toDate };
      if (outletId) params.outlet_id = outletId;
      const res = await api.get(`/reports/purchase`, { params });
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
            <span className="bg-blue-600 text-white p-1 rounded"><i className="fas fa-shopping-cart"></i></span>
            Purchase Report
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">GRN & Input GST Audit</p>
        </div>
        <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}><i className="fas fa-print mr-2"></i>Print</button>
      </div>

      {/* Filters */}
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
          <button className="btn btn-dark btn-sm h-9 px-6 text-[10px] font-bold uppercase" onClick={fetch} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-search mr-1"></i>}Apply
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Total GRNs',   value: s.total_purchases, color: 'text-slate-800', fmt: false },
          { label: 'Total Amount', value: s.total_amount,    color: 'text-green-700 font-black', fmt: true },
        ].map((c, i) => (
          <div key={i} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-center">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">{c.label}</div>
            <div className={`text-xl font-bold ${c.color}`}>{c.fmt ? fmt(+c.value) : c.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-body p-0 overflow-x-auto">
          {loading ? <div className="p-10 text-center text-slate-400"><i className="fas fa-spinner fa-spin text-2xl"></i></div> : (
            <table className="w-full text-xs">
              <thead className="bg-[#1a1a2e] text-white uppercase tracking-tighter">
                <tr>
                  <th className="px-4 py-3 text-left">Outlet</th>
                  <th className="px-4 py-3 text-left">GRN No</th>
                  <th className="px-4 py-3 text-left">Invoice No</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.rows || []).map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-500 text-[10px]">{r.outlet_name}</td>
                    <td className="px-4 py-2.5 font-bold text-blue-600">{r.purchase_no}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.invoice_no || '—'}</td>
                    <td className="px-4 py-2.5">{r.supplier_name || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.invoice_date}</td>
                    <td className="px-4 py-2.5 text-right font-black font-mono">{fmt(+r.total_amount)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-green-100 text-green-700">{r.status}</span>
                    </td>
                  </tr>
                ))}
                {!loading && !data?.rows?.length && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No purchase records found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default PurchaseReport;
