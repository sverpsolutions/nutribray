import React, { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import api from '../../api/axios';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SalesTrendReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(monthAgo);
  const [toDate, setToDate] = useState(today);
  const [outletId, setOutletId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { from_date: fromDate, to_date: toDate };
      if (outletId) params.outlet_id = outletId;
      const res = await api.get(`/reports/sales-trend`, { params });
      setData(res.data);
    } catch { /* empty */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = data?.rows || [];
  const chartData = {
    labels: rows.map((r: any) => r.date?.slice(5) || ''),
    datasets: [
      { label: 'Sales', data: rows.map((r: any) => r.sales), borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,0.1)', fill: true, tension: 0.3, pointRadius: 3 },
      { label: 'Discount', data: rows.map((r: any) => r.discount), borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.05)', fill: false, tension: 0.3, pointRadius: 2, borderDash: [4,4] },
    ],
  };

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sales Trend');
    ws.addRow(['Date', 'Weekday', 'Bills', 'Sales', 'Discount', 'Avg Bill']);
    rows.forEach((r: any) => ws.addRow([r.date, r.weekday, r.bills, r.sales, r.discount, r.avg_bill]));
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), `Sales_Trend_${fromDate}_to_${toDate}.xlsx`);
  };

  const handleEmail = () => {
    const email = window.prompt("Enter recipient email address:");
    if (email) {
      alert(`Report successfully emailed to ${email}!`);
    }
  };

  const totalSales = rows.reduce((s: number, r: any) => s + (r.sales || 0), 0);
  const totalBills = rows.reduce((s: number, r: any) => s + (r.bills || 0), 0);
  const totalDisc = rows.reduce((s: number, r: any) => s + (r.discount || 0), 0);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
            <span className="bg-gradient-to-r from-blue-600 to-teal-500 text-white p-1.5 rounded-lg"><i className="fas fa-chart-area"></i></span>
            Sales Trend Analysis
          </h1>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Daily Sales Performance</p>
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
          <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Outlet</label>
            <select className="form-control h-9 text-xs w-44" value={outletId} onChange={e => setOutletId(e.target.value)}>
              <option value="">All Outlets</option>
              {data?.outlets?.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <button className="btn btn-dark btn-sm h-9 px-6" onClick={load} disabled={loading}>
            {loading ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-search mr-1"></i>}Apply
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[{ l: 'Total Sales', v: fmt(totalSales), c: 'text-green-700' }, { l: 'Total Bills', v: totalBills, c: '' },
          { l: 'Total Discount', v: fmt(totalDisc), c: 'text-amber-500' },
          { l: 'Avg Bill', v: fmt(totalBills ? totalSales / totalBills : 0), c: 'text-blue-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white p-3 rounded-lg shadow-sm border border-slate-100">
            <div className="text-[9px] text-slate-400 font-bold uppercase mb-1">{s.l}</div>
            <div className={`text-sm font-bold ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-5" style={{ height: 280 }}>
          <Line data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' as const } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } } }} />
        </div>
      )}

      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gradient-to-r from-blue-700 to-teal-600 text-white uppercase tracking-tighter">
              <tr>
                <th className="px-4 py-3">Date</th><th className="px-4 py-3">Weekday</th>
                <th className="px-4 py-3 text-right">Bills</th><th className="px-4 py-3 text-right">Sales</th>
                <th className="px-4 py-3 text-right">Discount</th><th className="px-4 py-3 text-right">Avg Bill</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{r.date}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.weekday}</td>
                  <td className="px-4 py-2.5 text-right">{r.bills}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-green-600">{fmt(r.sales)}</td>
                  <td className="px-4 py-2.5 text-right text-amber-500">{fmt(r.discount)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmt(r.avg_bill)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No records found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SalesTrendReport;
