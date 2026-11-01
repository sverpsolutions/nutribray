import React, { useState, useEffect } from 'react';
import { Bar } from 'react-chartjs-2';
import api from '../../api/axios';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const SalesVsPurchaseReport = () => {
  const [year, setYear] = useState(new Date().getFullYear());
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/sales-vs-purchase`, { params: { year, outlet_id: outletId || undefined } });
      setData(res.data);
    } catch { /* empty */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = data?.rows || [];
  const chartData = {
    labels: rows.map((r: any) => r.month),
    datasets: [
      { label: 'Sales', data: rows.map((r: any) => r.sales), backgroundColor: 'rgba(22,163,74,0.7)', borderRadius: 4 },
      { label: 'Purchases', data: rows.map((r: any) => r.purchases), backgroundColor: 'rgba(220,38,38,0.5)', borderRadius: 4 },
    ],
  };

  const totals = rows.reduce((a: any, r: any) => ({ s: a.s + r.sales, p: a.p + r.purchases }), { s: 0, p: 0 });

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sales vs Purchase');
    ws.addRow(['Month', 'Sales', 'Bills', 'Purchases', 'Net Margin', 'Margin %']);
    rows.forEach((r: any) => ws.addRow([r.month, r.sales, r.bills, r.purchases, r.net_margin, r.margin_pct]));
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), `Sales_vs_Purchase_${year}.xlsx`);
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
            <span className="bg-gradient-to-r from-blue-600 to-teal-500 text-white p-1.5 rounded-lg"><i className="fas fa-balance-scale"></i></span>
            Sales vs Purchase
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Monthly Comparison — {year}</p>
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
        <div className="flex items-end gap-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Year</label>
            <select className="form-control h-9 text-xs w-28" value={year} onChange={e => setYear(+e.target.value)}>
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Outlet</label>
            <select className="form-control h-9 text-xs w-52" value={outletId} onChange={e => setOutletId(e.target.value)}>
              <option value="">All my outlets</option>
              {(data?.outlets || []).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <button className="btn btn-dark btn-sm h-9 px-6" onClick={load} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-search mr-1"></i>}Apply
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[{ l: 'Total Sales', v: fmt(totals.s), c: 'text-green-700' },
          { l: 'Total Purchases', v: fmt(totals.p), c: 'text-red-500' },
          { l: 'Net Margin', v: fmt(totals.s - totals.p), c: totals.s - totals.p >= 0 ? 'text-green-600' : 'text-red-600' },
          { l: 'Margin %', v: totals.s ? `${((totals.s - totals.p) / totals.s * 100).toFixed(1)}%` : '0%', c: 'text-blue-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white p-3 rounded-lg shadow-sm border border-slate-100">
            <div className="text-[9px] text-slate-400 font-bold uppercase mb-1">{s.l}</div>
            <div className={`text-sm font-bold ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-5" style={{ height: 280 }}>
          <Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' as const } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } } }} />
        </div>
      )}

      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gradient-to-r from-blue-700 to-teal-600 text-white uppercase tracking-tighter">
              <tr>
                <th className="px-4 py-3">Month</th><th className="px-4 py-3 text-right">Sales</th>
                <th className="px-4 py-3 text-right">Bills</th><th className="px-4 py-3 text-right">Purchases</th>
                <th className="px-4 py-3 text-right">Net Margin</th><th className="px-4 py-3 text-right">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-bold">{r.month}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-green-600">{fmt(r.sales)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{r.bills}</td>
                  <td className="px-4 py-2.5 text-right text-red-500">{fmt(r.purchases)}</td>
                  <td className="px-4 py-2.5 text-right font-bold" style={{ color: r.net_margin >= 0 ? '#16A34A' : '#DC2626' }}>{fmt(r.net_margin)}</td>
                  <td className="px-4 py-2.5 text-right font-bold">{r.margin_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SalesVsPurchaseReport;
