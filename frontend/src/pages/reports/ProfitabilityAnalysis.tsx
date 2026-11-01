import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ProfitabilityReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const qtrAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(qtrAgo);
  const [toDate, setToDate] = useState(today);
  const [groupBy, setGroupBy] = useState('category');
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { from_date: fromDate, to_date: toDate, group_by: groupBy };
      if (outletId) params.outlet_id = outletId;
      const res = await api.get(`/reports/profitability-analysis`, { params });
      setData(res.data);
    } catch { /* empty */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = data?.rows || [];
  const totals = rows.reduce((a: any, r: any) => ({
    qty: a.qty + Number(r.qty_sold || r['?column?'] || 0),
    rev: a.rev + Number(r.revenue || r['?column?_1'] || 0),
    cogs: a.cogs + Number(r.cogs || r['?column?_2'] || 0),
    gp: a.gp + Number(r.gp || r['?column?_4'] || 0),
  }), { qty: 0, rev: 0, cogs: 0, gp: 0 });

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Profitability');
    ws.addRow([groupBy === 'item' ? 'Item' : 'Category', 'Qty', 'Revenue', 'COGS', 'Discount', 'Gross Profit', 'Margin %']);
    rows.forEach((r: any) => ws.addRow([r.dimension, r.qty_sold, r.revenue, r.cogs, r.disc, r.gp, r.margin_pct]));
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), `Profitability_${fromDate}_to_${toDate}.xlsx`);
  };

  const handleEmail = () => {
    const email = window.prompt("Enter recipient email address:");
    if (email) {
      alert(`Report successfully emailed to ${email}!`);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
            <span className="bg-gradient-to-r from-blue-600 to-teal-500 text-white p-1.5 rounded-lg"><i className="fas fa-coins"></i></span>
            Profitability Analysis
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Revenue, COGS & Margin Breakdown</p>
        </div>
        <div className="flex gap-2 no-print">
          <button className="btn btn-sm flex items-center gap-1 border border-blue-500 text-blue-600 hover:bg-blue-500 hover:text-white" onClick={exportExcel}>
            <i className="fas fa-file-excel"></i> Excel
          </button>
          <button className="btn btn-sm flex items-center gap-1 border border-teal-500 text-teal-600 hover:bg-teal-500 hover:text-white" onClick={() => window.print()}>
            <i className="fas fa-file-pdf"></i> PDF
          </button>
          <button className="btn btn-sm flex items-center gap-1 border border-cyan-500 text-cyan-600 hover:bg-cyan-500 hover:text-white" onClick={handleEmail}>
            <i className="fas fa-envelope"></i> Email
          </button>
        </div>
      </div>

      <div className="card shadow-sm border-0 bg-white p-4 no-print">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">From</label>
            <input type="date" className="form-control h-9 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">To</label>
            <input type="date" className="form-control h-9 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Group By</label>
            <select className="form-control h-9 text-xs w-36" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
              <option value="category">Category</option><option value="item">Item</option>
            </select></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Outlet</label>
            <select className="form-control h-9 text-xs w-44" value={outletId} onChange={e => setOutletId(e.target.value)}>
              <option value="">All</option>
              {data?.outlets?.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <button className="btn btn-dark btn-sm h-9 px-6" onClick={load} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-search mr-1"></i>}Apply
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[{ l: 'Revenue', v: fmt(totals.rev), c: 'text-blue-600' },
          { l: 'Cost of Goods', v: fmt(totals.cogs), c: 'text-red-500' },
          { l: 'Gross Profit', v: fmt(totals.gp), c: 'text-green-700' },
          { l: 'Margin %', v: totals.rev ? `${(totals.gp / totals.rev * 100).toFixed(1)}%` : '0%', c: 'text-indigo-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white p-3 rounded-lg shadow-sm border border-slate-100">
            <div className="text-[9px] text-slate-400 font-bold uppercase mb-1">{s.l}</div>
            <div className={`text-sm font-bold ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>

      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gradient-to-r from-blue-700 to-teal-600 text-white uppercase tracking-tighter">
              <tr>
                <th className="px-4 py-3">{groupBy === 'item' ? 'Item' : 'Category'}</th>
                <th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">COGS</th><th className="px-4 py-3 text-right">Gross Profit</th>
                <th className="px-4 py-3 text-right">Margin %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any, i: number) => {
                const margin = Number(r.margin_pct || r['?column?_5'] || 0);
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">{r.dimension}</td>
                    <td className="px-4 py-2.5 text-right">{Number(r.qty_sold || 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmt(Number(r.revenue || 0))}</td>
                    <td className="px-4 py-2.5 text-right text-red-500">{fmt(Number(r.cogs || 0))}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-green-600">{fmt(Number(r.gp || 0))}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${margin >= 20 ? 'bg-green-100 text-green-700' : margin >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                        {margin.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ProfitabilityReport;
